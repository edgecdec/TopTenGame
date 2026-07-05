const { createServer } = require("http");
const { parse } = require("url");
const crypto = require("crypto");
const { exec } = require("child_process");
const next = require("next");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");
const path = require("path");
const { randomUUID } = require("crypto");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = process.env.PORT || 3007;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "my_super_secret_topten_token";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const db = new Database(path.join(process.cwd(), "data", "topten.db"));
db.pragma("journal_mode = WAL");

function getQuestion(id) {
  const q = db
    .prepare(
      `SELECT id, theme, title, prompt, answer_type as answerType, seeded_depth as seededDepth,
              source_name, source_url, source_as_of, note
       FROM questions WHERE id = ?`
    )
    .get(id);
  if (!q) return null;
  const answers = db
    .prepare("SELECT rank, code, value FROM answers WHERE question_id = ? ORDER BY rank")
    .all(id);
  return {
    ...q,
    source: { name: q.source_name, url: q.source_url, asOf: q.source_as_of },
    answers,
  };
}

function labelForCode(code) {
  const row = db.prepare("SELECT name FROM countries WHERE code = ?").get(code);
  return row ? row.name : code;
}

function scorePick(mode, rank, topN, missPenalty) {
  if (rank === null || rank > topN) return -missPenalty;
  if (mode === "rank") return rank;
  if (mode === "inverse") return topN - rank + 1;
  return 1;
}

const rooms = new Map();

function defaultSettings() {
  return { scoringMode: "rank", topN: 10, missPenalty: 0, roundDurationSec: 60 };
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function publicState(room) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    isHost: p.id === room.hostId,
    connected: p.connected,
    score: p.score,
    submitted: p.submitted,
  }));
  return {
    roomCode: room.code,
    phase: room.phase,
    settings: room.settings,
    players,
    currentQuestionId: room.currentQuestionId,
    currentQuestionMeta: room.currentQuestionMeta,
    endsAt: room.endsAt,
    lastResults: room.lastResults,
  };
}

function broadcast(io, room) {
  io.to(room.code).emit("state_update", publicState(room));
}

function endRound(io, room) {
  if (room.phase !== "playing" || !room.currentQuestionId) return;
  const q = getQuestion(room.currentQuestionId);
  if (!q) return;

  const rankByCode = new Map(q.answers.map((a) => [a.code, a.rank]));
  const valueByCode = new Map(q.answers.map((a) => [a.code, a.value]));
  const topN = room.settings.topN;
  const mode = room.settings.scoringMode;
  const penalty = room.settings.missPenalty;

  const perPlayer = {};
  for (const p of room.players.values()) {
    const picksScored = p.picks.map((code) => {
      const rank = rankByCode.get(code) ?? null;
      const inRange = rank !== null && rank <= topN ? rank : null;
      const points = scorePick(mode, inRange, topN, penalty);
      return { code, label: labelForCode(code), rank: inRange, points };
    });
    const roundScore = picksScored.reduce((s, x) => s + x.points, 0);
    p.score += roundScore;
    perPlayer[p.id] = { picks: p.picks, roundScore, picksScored };
  }

  const correctAnswers = q.answers
    .filter((a) => a.rank <= topN)
    .map((a) => ({ rank: a.rank, code: a.code, value: a.value, label: labelForCode(a.code) }));

  room.lastResults = {
    correctAnswers,
    perPlayer,
    source: q.source,
    note: q.note,
    questionTitle: q.title,
  };
  room.phase = "results";
  room.endsAt = null;

  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
  io.to(room.code).emit("round_results", room.lastResults);
  broadcast(io, room);
}

function parseCookie(str, name) {
  if (!str) return null;
  const m = str.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      if (parsedUrl.pathname === "/api/webhook" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c.toString()));
        req.on("end", () => {
          const signature = req.headers["x-hub-signature-256"];
          if (!signature) {
            res.statusCode = 401;
            return res.end("No signature");
          }
          const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
          const digest = "sha256=" + hmac.update(body).digest("hex");
          if (signature === digest) {
            console.log("Webhook verified. Deploying...");
            res.statusCode = 200;
            res.end("Deploying");
            exec("nohup bash /var/www/TopTenGame/deploy_webhook.sh > /dev/null 2>&1 &", (err) => {
              if (err) console.error(`exec error: ${err}`);
            });
          } else {
            res.statusCode = 403;
            res.end("Forbidden");
          }
        });
        return;
      }
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const io = new Server(httpServer, { cors: { origin: true } });

  io.on("connection", (socket) => {
    let currentRoomCode = null;
    let userId = parseCookie(socket.request.headers.cookie, "topten_user_id") || randomUUID();
    socket.emit("state_update", null); // no-op ping, client may ignore

    socket.on("join_room", ({ roomCode, name }) => {
      if (!roomCode || typeof roomCode !== "string") return;
      let code = roomCode.toUpperCase();
      if (code === "NEW") code = generateRoomCode();

      if (!rooms.has(code)) {
        rooms.set(code, {
          code,
          hostId: userId,
          players: new Map(),
          phase: "lobby",
          settings: defaultSettings(),
          currentQuestionId: null,
          currentQuestionMeta: null,
          endsAt: null,
          lastResults: null,
          roundTimer: null,
        });
      }
      const room = rooms.get(code);
      currentRoomCode = code;
      socket.join(code);

      const existing = room.players.get(userId);
      if (existing) {
        existing.connected = true;
        if (name && typeof name === "string") existing.name = name.slice(0, 24);
      } else {
        room.players.set(userId, {
          id: userId,
          name: (name || `Player ${userId.slice(0, 4)}`).slice(0, 24),
          score: 0,
          picks: [],
          submitted: false,
          connected: true,
        });
      }
      socket.emit("state_update", publicState(room));
      broadcast(io, room);
    });

    socket.on("set_name", ({ name }) => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      const p = room.players.get(userId);
      if (p && typeof name === "string") {
        p.name = name.slice(0, 24) || p.name;
        broadcast(io, room);
      }
    });

    socket.on("update_settings", (partial) => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId || room.phase !== "lobby") return;
      const s = room.settings;
      if (partial.scoringMode === "rank" || partial.scoringMode === "inverse" || partial.scoringMode === "flat") s.scoringMode = partial.scoringMode;
      if (typeof partial.topN === "number" && partial.topN >= 3 && partial.topN <= 20) s.topN = Math.floor(partial.topN);
      if (typeof partial.missPenalty === "number" && partial.missPenalty >= 0 && partial.missPenalty <= 10) s.missPenalty = Math.floor(partial.missPenalty);
      if (typeof partial.roundDurationSec === "number" && partial.roundDurationSec >= 15 && partial.roundDurationSec <= 300) s.roundDurationSec = Math.floor(partial.roundDurationSec);
      broadcast(io, room);
    });

    socket.on("start_round", ({ questionId }) => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId) return;
      if (room.phase === "playing") return;
      const q = getQuestion(questionId);
      if (!q) {
        socket.emit("error_message", "Question not found");
        return;
      }
      const topN = Math.min(room.settings.topN, q.seededDepth);
      const endsAt = Date.now() + room.settings.roundDurationSec * 1000;
      room.phase = "playing";
      room.currentQuestionId = q.id;
      room.currentQuestionMeta = { id: q.id, title: q.title, prompt: q.prompt, topN, note: q.note };
      room.endsAt = endsAt;
      room.lastResults = null;
      for (const p of room.players.values()) {
        p.picks = [];
        p.submitted = false;
      }
      if (room.roundTimer) clearTimeout(room.roundTimer);
      room.roundTimer = setTimeout(() => endRound(io, room), room.settings.roundDurationSec * 1000);
      io.to(room.code).emit("round_started", {
        questionId: q.id,
        title: q.title,
        prompt: q.prompt,
        topN,
        endsAt,
        note: q.note,
      });
      broadcast(io, room);
    });

    socket.on("submit_picks", ({ picks }) => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.phase !== "playing" || !room.currentQuestionMeta) return;
      const p = room.players.get(userId);
      if (!p) return;
      if (!Array.isArray(picks)) return;
      const topN = room.currentQuestionMeta.topN;
      const unique = Array.from(new Set(picks.filter((x) => typeof x === "string"))).slice(0, topN);
      p.picks = unique;
      p.submitted = true;
      broadcast(io, room);

      const active = Array.from(room.players.values()).filter((x) => x.connected);
      if (active.length > 0 && active.every((x) => x.submitted)) {
        endRound(io, room);
      }
    });

    socket.on("return_to_lobby", () => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId) return;
      room.phase = "lobby";
      room.currentQuestionId = null;
      room.currentQuestionMeta = null;
      room.endsAt = null;
      for (const p of room.players.values()) {
        p.picks = [];
        p.submitted = false;
      }
      broadcast(io, room);
    });

    socket.on("disconnect", () => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      const p = room.players.get(userId);
      if (p) p.connected = false;
      broadcast(io, room);

      // Clean up empty rooms after a delay
      setTimeout(() => {
        const r = rooms.get(currentRoomCode);
        if (!r) return;
        const anyConnected = Array.from(r.players.values()).some((x) => x.connected);
        if (!anyConnected) {
          if (r.roundTimer) clearTimeout(r.roundTimer);
          rooms.delete(currentRoomCode);
          console.log(`Room ${currentRoomCode} cleaned up.`);
        }
      }, 30 * 60 * 1000);
    });
  });

  httpServer.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> TopTen running on http://localhost:${port}`);
  });
});

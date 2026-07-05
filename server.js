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
const SESSION_SECRET = process.env.SESSION_SECRET || "topten_dev_session_secret_change_me";

function signUserId(userId) {
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex").slice(0, 32);
  return `${userId}.${mac}`;
}

function verifySignedUserId(token) {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex").slice(0, 32);
  if (mac.length !== expected.length) return null;
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  return crypto.timingSafeEqual(macBuf, expectedBuf) ? userId : null;
}

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

function listQuestionIdsInTheme(theme) {
  return db.prepare("SELECT id FROM questions WHERE theme = ?").all(theme).map((r) => r.id);
}

function listThemes() {
  return db
    .prepare("SELECT theme, COUNT(*) as count FROM questions GROUP BY theme ORDER BY theme")
    .all();
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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rooms = new Map();

function defaultSettings() {
  return {
    theme: "Countries",
    numQuestions: 5,
    scoringMode: "rank",
    topN: 10,
    picksPerPlayer: 1,
    missPenalty: 0,
    roundDurationSec: 30,
  };
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
    currentQuestionIdx: room.currentQuestionIdx,
    totalQuestions: room.questionQueue?.length ?? 0,
    currentQuestionMeta: room.currentQuestionMeta,
    endsAt: room.endsAt,
    lastResults: room.lastResults,
    finalScoreboard: room.finalScoreboard,
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
  const topN = room.currentQuestionMeta.topN;
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
    questionTitle: q.title,
    correctAnswers,
    perPlayer,
    source: q.source,
    note: q.note,
  };
  room.phase = "intermission";
  room.endsAt = null;

  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
  broadcast(io, room);
}

function advanceToNextQuestion(io, room) {
  const nextIdx = room.currentQuestionIdx + 1;
  if (nextIdx >= room.questionQueue.length) {
    // Final scoreboard
    const scoreboard = Array.from(room.players.values())
      .map((p) => ({ playerId: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
    room.phase = "final_results";
    room.finalScoreboard = scoreboard;
    room.currentQuestionMeta = null;
    room.lastResults = null;
    room.endsAt = null;
    broadcast(io, room);
    return;
  }
  const q = getQuestion(room.questionQueue[nextIdx]);
  if (!q) return;
  const topN = Math.min(room.settings.topN, q.seededDepth);
  const picksPerPlayer = Math.min(room.settings.picksPerPlayer, topN);
  const endsAt = Date.now() + room.settings.roundDurationSec * 1000;
  room.phase = "playing";
  room.currentQuestionIdx = nextIdx;
  room.currentQuestionId = q.id;
  room.currentQuestionMeta = {
    id: q.id,
    title: q.title,
    prompt: q.prompt,
    topN,
    picksPerPlayer,
  };
  room.endsAt = endsAt;
  room.lastResults = null;
  for (const p of room.players.values()) {
    p.picks = [];
    p.submitted = false;
  }
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => endRound(io, room), room.settings.roundDurationSec * 1000);
  broadcast(io, room);
}

function startGame(io, room) {
  const theme = room.settings.theme;
  const allIds = listQuestionIdsInTheme(theme);
  if (allIds.length === 0) return;
  const requested = Math.max(1, Math.min(room.settings.numQuestions, allIds.length));
  room.questionQueue = shuffle(allIds).slice(0, requested);
  room.currentQuestionIdx = -1;
  room.finalScoreboard = null;
  for (const p of room.players.values()) {
    p.score = 0;
    p.picks = [];
    p.submitted = false;
  }
  advanceToNextQuestion(io, room);
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
    let userId = null;

    socket.on("join_room", ({ roomCode, name }) => {
      if (!roomCode || typeof roomCode !== "string") return;
      let code = roomCode.toUpperCase();
      if (code === "NEW") code = generateRoomCode();

      // Derive userId from the signed session cookie. Any client-sent userId is ignored.
      const cookieToken = parseCookie(socket.request.headers.cookie, "topten_session");
      const verified = verifySignedUserId(cookieToken);
      userId = verified || randomUUID();
      const token = signUserId(userId);
      // Client stores this and echoes it back on next connection via cookie.
      socket.emit("identity", { userId, sessionToken: token });

      if (!rooms.has(code)) {
        rooms.set(code, {
          code,
          hostId: userId,
          players: new Map(),
          phase: "lobby",
          settings: defaultSettings(),
          currentQuestionId: null,
          currentQuestionMeta: null,
          currentQuestionIdx: -1,
          questionQueue: [],
          endsAt: null,
          lastResults: null,
          finalScoreboard: null,
          roundTimer: null,
        });
      }
      const room = rooms.get(code);
      currentRoomCode = code;
      socket.join(code);

      const existing = room.players.get(userId);
      if (existing) {
        existing.connected = true;
        if (name && typeof name === "string") existing.name = name.slice(0, 24) || existing.name;
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
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      const p = room.players.get(userId);
      if (p && typeof name === "string") {
        p.name = name.slice(0, 24) || p.name;
        broadcast(io, room);
      }
    });

    socket.on("update_settings", (partial) => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId || room.phase !== "lobby") return;
      const s = room.settings;
      if (typeof partial.theme === "string") s.theme = partial.theme;
      if (typeof partial.numQuestions === "number" && partial.numQuestions >= 1 && partial.numQuestions <= 30) s.numQuestions = Math.floor(partial.numQuestions);
      if (partial.scoringMode === "rank" || partial.scoringMode === "inverse" || partial.scoringMode === "flat") s.scoringMode = partial.scoringMode;
      if (typeof partial.topN === "number" && partial.topN >= 3 && partial.topN <= 20) s.topN = Math.floor(partial.topN);
      if (typeof partial.picksPerPlayer === "number" && partial.picksPerPlayer >= 1 && partial.picksPerPlayer <= 20) s.picksPerPlayer = Math.floor(partial.picksPerPlayer);
      if (typeof partial.missPenalty === "number" && partial.missPenalty >= 0 && partial.missPenalty <= 10) s.missPenalty = Math.floor(partial.missPenalty);
      if (typeof partial.roundDurationSec === "number" && partial.roundDurationSec >= 15 && partial.roundDurationSec <= 300) s.roundDurationSec = Math.floor(partial.roundDurationSec);
      broadcast(io, room);
    });

    socket.on("start_game", () => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId || room.phase !== "lobby") return;
      startGame(io, room);
    });

    socket.on("next_question", () => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId || room.phase !== "intermission") return;
      advanceToNextQuestion(io, room);
    });

    socket.on("return_to_lobby", () => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId) return;
      room.phase = "lobby";
      room.currentQuestionId = null;
      room.currentQuestionMeta = null;
      room.currentQuestionIdx = -1;
      room.questionQueue = [];
      room.endsAt = null;
      room.lastResults = null;
      room.finalScoreboard = null;
      for (const p of room.players.values()) {
        p.picks = [];
        p.submitted = false;
      }
      broadcast(io, room);
    });

    socket.on("submit_picks", ({ picks }) => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.phase !== "playing" || !room.currentQuestionMeta) return;
      const p = room.players.get(userId);
      if (!p) return;
      if (!Array.isArray(picks)) return;
      const limit = room.currentQuestionMeta.picksPerPlayer;
      const unique = Array.from(new Set(picks.filter((x) => typeof x === "string"))).slice(0, limit);
      p.picks = unique;
      p.submitted = true;
      broadcast(io, room);

      const active = Array.from(room.players.values()).filter((x) => x.connected);
      if (active.length > 0 && active.every((x) => x.submitted)) {
        endRound(io, room);
      }
    });

    socket.on("disconnect", () => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      const p = room.players.get(userId);
      if (p) p.connected = false;
      broadcast(io, room);

      const rc = currentRoomCode;
      setTimeout(() => {
        const r = rooms.get(rc);
        if (!r) return;
        const anyConnected = Array.from(r.players.values()).some((x) => x.connected);
        if (!anyConnected) {
          if (r.roundTimer) clearTimeout(r.roundTimer);
          rooms.delete(rc);
          console.log(`Room ${rc} cleaned up.`);
        }
      }, 30 * 60 * 1000);
    });
  });

  httpServer.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> TopTen running on http://localhost:${port}`);
  });
});

const { createServer } = require("http");
const { parse } = require("url");
const crypto = require("crypto");
const { exec } = require("child_process");
const next = require("next");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");
const path = require("path");
const { randomUUID } = require("crypto");

const fs = require("fs");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = process.env.PORT || 3007;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "my_super_secret_topten_token";
const SESSION_SECRET = process.env.SESSION_SECRET || "topten_dev_session_secret_change_me";
const SNAPSHOT_PATH = path.join(process.cwd(), "data", "rooms-snapshot.json");
// Snapshots older than this are considered stale (games long abandoned).
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

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

// Best Picture WINNERS = union of every code referenced by any Movies question
// EXCEPT the Nominees subtheme. Those questions are winners-only by construction,
// so the union of their answers is the 96-film winners set.
let BEST_PICTURE_WINNERS = null;
function getBestPictureWinners() {
  if (BEST_PICTURE_WINNERS) return BEST_PICTURE_WINNERS;
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT a.code
         FROM answers a
         JOIN questions q ON q.id = a.question_id
         WHERE q.theme = 'Movies'
           AND (q.subtheme IS NULL OR q.subtheme != 'Movies - Nominees')`
      )
      .all();
    BEST_PICTURE_WINNERS = rows.map((r) => r.code);
    if (BEST_PICTURE_WINNERS.length < 20) {
      console.warn(`Best Picture winners load looked wrong (${BEST_PICTURE_WINNERS.length} codes); disabling scope.`);
      BEST_PICTURE_WINNERS = null;
    }
  } catch (err) {
    console.warn("Best Picture winners load failed:", err.message);
    BEST_PICTURE_WINNERS = null;
  }
  return BEST_PICTURE_WINNERS;
}

function getQuestion(id) {
  const q = db
    .prepare(
      `SELECT id, theme, subtheme, title, prompt, answer_type as answerType, seeded_depth as seededDepth,
              source_name, source_url, source_as_of, note, disclaimer, trivia, as_of_date as asOfDate
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

function listQuestionIdsInTheme(theme, subtheme) {
  if (subtheme && subtheme !== "*") {
    return db
      .prepare("SELECT id FROM questions WHERE theme = ? AND subtheme = ?")
      .all(theme, subtheme)
      .map((r) => r.id);
  }
  return db.prepare("SELECT id FROM questions WHERE theme = ?").all(theme).map((r) => r.id);
}

function listThemes() {
  return db
    .prepare("SELECT theme, COUNT(*) as count FROM questions GROUP BY theme ORDER BY theme")
    .all();
}

function labelForCode(answerType, code) {
  const row = db
    .prepare("SELECT name FROM answer_options WHERE answer_type = ? AND code = ?")
    .get(answerType, code);
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

function serializeRooms() {
  const out = [];
  for (const [code, room] of rooms) {
    out.push({
      code,
      hostId: room.hostId,
      phase: room.phase,
      settings: room.settings,
      currentQuestionId: room.currentQuestionId,
      currentQuestionMeta: room.currentQuestionMeta,
      currentQuestionIdx: room.currentQuestionIdx,
      questionQueue: room.questionQueue,
      endsAt: room.endsAt,
      lastResults: room.lastResults,
      finalScoreboard: room.finalScoreboard,
      players: Array.from(room.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        picks: p.picks,
        submitted: p.submitted,
        // Everyone comes back disconnected; client reconnects will flip this true.
        connected: false,
      })),
    });
  }
  return out;
}

function saveSnapshot() {
  try {
    if (rooms.size === 0) {
      if (fs.existsSync(SNAPSHOT_PATH)) fs.unlinkSync(SNAPSHOT_PATH);
      return;
    }
    const payload = { savedAt: Date.now(), rooms: serializeRooms() };
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(payload));
    console.log(`Saved snapshot: ${rooms.size} rooms.`);
  } catch (err) {
    console.error("Snapshot save failed:", err);
  }
}

function restoreSnapshot(io) {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return;
    const payload = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    if (!payload?.rooms) return;
    const age = Date.now() - (payload.savedAt || 0);
    if (age > SNAPSHOT_MAX_AGE_MS) {
      console.log(`Snapshot is ${Math.round(age / 1000)}s old — too stale, discarding.`);
      fs.unlinkSync(SNAPSHOT_PATH);
      return;
    }
    for (const r of payload.rooms) {
      const players = new Map();
      for (const p of r.players || []) players.set(p.id, p);
      const room = {
        code: r.code,
        hostId: r.hostId,
        players,
        phase: r.phase,
        settings: { ...defaultSettings(), ...r.settings },
        currentQuestionId: r.currentQuestionId,
        currentQuestionMeta: r.currentQuestionMeta,
        currentQuestionIdx: r.currentQuestionIdx,
        questionQueue: r.questionQueue || [],
        endsAt: r.endsAt,
        lastResults: r.lastResults,
        finalScoreboard: r.finalScoreboard,
        roundTimer: null,
      };
      // If a round was in progress and the timer hadn't expired yet, re-arm it.
      // If the timer already expired during downtime, end the round immediately.
      if (room.phase === "playing" && room.endsAt) {
        const remaining = room.endsAt - Date.now();
        if (remaining > 0) {
          room.roundTimer = setTimeout(() => endRound(io, room), remaining);
        } else {
          // Timer already elapsed — schedule an immediate end once the map has the room.
          setImmediate(() => endRound(io, room));
        }
      }
      rooms.set(room.code, room);
    }
    console.log(`Restored ${rooms.size} rooms from snapshot (age ${Math.round(age / 1000)}s).`);
    // Snapshot is only good for one restore; delete so we don't re-apply it.
    fs.unlinkSync(SNAPSHOT_PATH);
  } catch (err) {
    console.error("Snapshot restore failed:", err);
  }
}

function defaultSettings() {
  return {
    theme: "Countries",
    subtheme: "*",
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
      return { code, label: labelForCode(q.answerType, code), rank: inRange, points };
    });
    const roundScore = picksScored.reduce((s, x) => s + x.points, 0);
    p.score += roundScore;
    perPlayer[p.id] = { picks: p.picks, roundScore, picksScored };
  }

  const correctAnswers = q.answers
    .filter((a) => a.rank <= topN)
    .map((a) => ({ rank: a.rank, code: a.code, value: a.value, label: labelForCode(q.answerType, a.code) }));

  room.lastResults = {
    questionId: q.id,
    questionTitle: q.title,
    correctAnswers,
    perPlayer,
    source: q.source,
    note: q.note,
    disclaimer: q.disclaimer || null,
    trivia: q.trivia || null,
    asOfDate: q.asOfDate || q.source.asOf || null,
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
  // If the question's subtheme is a scoped sub-set of the answer pool,
  // tell the client which options to show. Either a prefix (cheap) or an
  // explicit list of allowed codes (used when the subset isn't prefix-shaped).
  let codeFilter = null;
  let allowedCodes = null;
  const st = q.subtheme || "";
  if (st === "Pro Sports - NBA") codeFilter = "NBA-";
  else if (st === "Pro Sports - NFL") codeFilter = "NFL-";
  else if (st === "Pro Sports - MLB") codeFilter = "MLB-";
  else if (st === "Pro Sports - NHL") codeFilter = "NHL-";
  // All Movies subthemes EXCEPT "Movies - Nominees" are winners-only —
  // scope the dropdown to the 96 Best Picture winners so players don't
  // wade through 500+ losers.
  else if (q.theme === "Movies" && st !== "Movies - Nominees") {
    const winners = getBestPictureWinners();
    if (winners) allowedCodes = winners;
  }
  room.phase = "playing";
  room.currentQuestionIdx = nextIdx;
  room.currentQuestionId = q.id;
  room.currentQuestionMeta = {
    id: q.id,
    title: q.title,
    prompt: q.prompt,
    topN,
    picksPerPlayer,
    answerType: q.answerType,
    codeFilter, // e.g. "NBA-" → client shows only NBA-* options
    allowedCodes, // explicit list of allowed codes, if any (e.g. Best Picture winners)
    disclaimer: q.disclaimer || null, // safe to show pre-round
    asOfDate: q.asOfDate || q.source.asOf || null,
  };
  room.endsAt = endsAt;
  room.lastResults = null;
  for (const p of room.players.values()) {
    p.picks = [];
    p.submitted = false;
  }
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => endRound(io, room), room.settings.roundDurationSec * 1000);
  recordRoomExposure(room);
  broadcast(io, room);
}

function startGame(io, room) {
  const theme = room.settings.theme;
  const subtheme = room.settings.subtheme || "*";
  const allIds = listQuestionIdsInTheme(theme, subtheme);
  if (allIds.length === 0) return;
  const requested = Math.max(1, Math.min(room.settings.numQuestions, allIds.length));
  // Pick questions that minimize aggregate exposure across the roster.
  // For each candidate, sum seen_count over every active player; sort asc,
  // random-tiebreak within each exposure bucket.
  const playerIds = Array.from(room.players.keys());
  let queue;
  if (playerIds.length === 0) {
    queue = shuffle(allIds).slice(0, requested);
  } else {
    const placeholders = playerIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT q.id, COALESCE(SUM(e.seen_count), 0) AS total_seen
         FROM questions q
         LEFT JOIN question_exposures e
           ON e.question_id = q.id AND e.user_id IN (${placeholders})
         WHERE q.id IN (${allIds.map(() => "?").join(",")})
         GROUP BY q.id`
      )
      .all(...playerIds, ...allIds);
    // Shuffle first so ties break randomly, then stable-sort by total_seen.
    shuffle(rows);
    rows.sort((a, b) => a.total_seen - b.total_seen);
    queue = rows.slice(0, requested).map((r) => r.id);
  }
  room.questionQueue = queue;
  room.currentQuestionIdx = -1;
  room.finalScoreboard = null;
  for (const p of room.players.values()) {
    p.score = 0;
    p.picks = [];
    p.submitted = false;
  }
  advanceToNextQuestion(io, room);
}

function recordRoomExposure(room) {
  const q = room.currentQuestionId;
  if (!q) return;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO question_exposures (question_id, user_id, seen_count, last_seen_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(question_id, user_id) DO UPDATE SET
       seen_count = seen_count + 1,
       last_seen_at = excluded.last_seen_at`
  );
  const tx = db.transaction((players) => {
    for (const p of players) {
      if (!p.connected) continue;
      stmt.run(q, p.id, now);
    }
  });
  tx(Array.from(room.players.values()));
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

      // If they had staged picks from before disconnect, echo them back so the
      // client can restore its Autocomplete state on rejoin.
      const room0 = rooms.get(code);
      const meta = room0 && room0.players.get(userId);
      if (meta && Array.isArray(meta.picks) && meta.picks.length > 0) {
        socket.emit("restore_picks", { picks: meta.picks });
      }

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
      if (typeof partial.theme === "string") {
        if (s.theme !== partial.theme) s.subtheme = "*"; // reset subtheme when theme changes
        s.theme = partial.theme;
      }
      if (typeof partial.subtheme === "string") s.subtheme = partial.subtheme;
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

    socket.on("transfer_host", ({ toPlayerId }) => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.hostId !== userId) return;
      if (typeof toPlayerId !== "string" || !room.players.has(toPlayerId)) return;
      if (toPlayerId === userId) return;
      room.hostId = toPlayerId;
      broadcast(io, room);
    });

    socket.on("leave_room", () => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      room.players.delete(userId);
      // If the host leaves, transfer to the earliest-joined connected player.
      if (room.hostId === userId) {
        const nextHost = Array.from(room.players.values()).find((p) => p.connected);
        if (nextHost) room.hostId = nextHost.id;
      }
      socket.leave(currentRoomCode);
      const rc = currentRoomCode;
      currentRoomCode = null;
      if (room.players.size === 0) {
        if (room.roundTimer) clearTimeout(room.roundTimer);
        rooms.delete(rc);
      } else {
        broadcast(io, room);
      }
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

    // stage_picks: store the player's current picks without locking in.
    // Fires on every autocomplete change. If the timer runs out with staged
    // (but not locked) picks, endRound scores whatever was last staged.
    socket.on("stage_picks", ({ picks }) => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room || room.phase !== "playing" || !room.currentQuestionMeta) return;
      const p = room.players.get(userId);
      if (!p || p.submitted) return;
      if (!Array.isArray(picks)) return;
      const limit = room.currentQuestionMeta.picksPerPlayer;
      p.picks = Array.from(new Set(picks.filter((x) => typeof x === "string"))).slice(0, limit);
      // No broadcast — this fires per-keystroke and doesn't change the UI for others.
    });

    // submit_picks: player clicks "Lock in". Marks submitted so the round can
    // end early once everyone has locked in.
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

    // Feedback: thumbs vote and/or text (up to 500 chars) on a specific question.
    // Only accepted while the round is in intermission or final_results, and
    // only for the just-played questions in the current room's queue.
    socket.on("submit_feedback", ({ questionId, thumbs, text }) => {
      if (!currentRoomCode || !userId) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      if (room.phase !== "intermission" && room.phase !== "final_results") return;
      if (typeof questionId !== "string") return;
      // Must be a question that was played (or is being played) this game.
      const playedIds = new Set(room.questionQueue.slice(0, room.currentQuestionIdx + 1));
      if (!playedIds.has(questionId)) return;
      const cleanThumbs = thumbs === 1 || thumbs === -1 ? thumbs : null;
      const cleanText = typeof text === "string" ? text.slice(0, 500).trim() : null;
      if (cleanThumbs === null && !cleanText) {
        // Delete existing feedback if both fields cleared
        db.prepare("DELETE FROM feedback WHERE question_id = ? AND user_id = ?")
          .run(questionId, userId);
        return;
      }
      const now = Date.now();
      db.prepare(
        `INSERT INTO feedback (question_id, user_id, thumbs, text, addressed, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(question_id, user_id) DO UPDATE SET
           thumbs = excluded.thumbs,
           text = excluded.text,
           updated_at = excluded.updated_at`
      ).run(questionId, userId, cleanThumbs, cleanText || null, now, now);
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
    // Restore in-flight games from snapshot (if any) so pm2 restart during a
    // deploy doesn't wipe active rooms. Runs after listen so io is ready.
    restoreSnapshot(io);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, saving snapshot and exiting.`);
    // Clear any pending round timers so they don't fire mid-shutdown.
    for (const r of rooms.values()) {
      if (r.roundTimer) {
        clearTimeout(r.roundTimer);
        r.roundTimer = null;
      }
    }
    saveSnapshot();
    // Give sockets a moment to flush, then exit.
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});

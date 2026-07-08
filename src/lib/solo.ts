import { randomUUID } from "crypto";
import { getDb, type Question } from "./db";
import { scorePick } from "./scoring";
import type { ScoringMode } from "./types";

export const SOLO_QUESTIONS_PER_GAME = 10;
export const SOLO_SECONDS_PER_QUESTION = 30;
export const SOLO_TOP_N = 10;
export const SOLO_MISS_PENALTY = 0;

export type SoloMode = ScoringMode;

export const ALL_THEME = "*";

export type SoloSessionRow = {
  id: string;
  user_id: string;
  display_name: string;
  mode: string;
  theme: string;
  question_ids: string;
  picks: string;
  current_idx: number;
  question_ends_at: number | null;
  score: number;
  finished: number;
  created_at: number;
};

export type SoloQuestionPublic = {
  id: string;
  title: string;
  prompt: string;
  answerType: string;
  disclaimer: string | null;
  asOfDate: string | null;
  topN: number;
  endsAt: number | null;
};

export type SoloRoundResult = {
  questionId: string;
  questionTitle: string;
  yourPick: { code: string; label: string } | null;
  yourRank: number | null;
  pointsEarned: number;
  correctAnswers: Array<{ rank: number; code: string; value: string; label: string }>;
  source: { name: string; url: string; asOf: string };
  trivia: string | null;
};

export type SoloClientState = {
  sessionId: string;
  mode: SoloMode;
  theme: string;
  displayName: string;
  currentIdx: number;
  totalQuestions: number;
  score: number;
  finished: boolean;
  currentQuestion: SoloQuestionPublic | null;
  lastResult: SoloRoundResult | null;
};

function labelForCode(answerType: string, code: string): string {
  const row = getDb()
    .prepare("SELECT name FROM answer_options WHERE answer_type = ? AND code = ?")
    .get(answerType, code) as { name: string } | undefined;
  return row ? row.name : code;
}

function getQuestionFull(id: string): Question | null {
  const row = getDb()
    .prepare(
      `SELECT id, theme, subtheme, title, prompt, answer_type as answerType, seeded_depth as seededDepth,
              source_name, source_url, source_as_of, note, disclaimer, trivia, as_of_date as asOfDate
       FROM questions WHERE id = ?`
    )
    .get(id) as (Question & { source_name: string; source_url: string; source_as_of: string }) | undefined;
  if (!row) return null;
  const answers = getDb()
    .prepare("SELECT rank, code, value FROM answers WHERE question_id = ? ORDER BY rank")
    .all(id) as Array<{ rank: number; code: string; value: string }>;
  return {
    id: row.id,
    theme: row.theme,
    subtheme: row.subtheme,
    title: row.title,
    prompt: row.prompt,
    answerType: row.answerType,
    seededDepth: row.seededDepth,
    source: { name: row.source_name, url: row.source_url, asOf: row.source_as_of },
    note: row.note,
    disclaimer: row.disclaimer,
    trivia: row.trivia,
    asOfDate: row.asOfDate,
    answers,
  };
}

function pickQuestionIds(count: number, theme: string): string[] {
  const rows =
    theme === ALL_THEME
      ? (getDb()
          .prepare(`SELECT id FROM questions WHERE seeded_depth >= ? ORDER BY RANDOM() LIMIT ?`)
          .all(SOLO_TOP_N, count) as Array<{ id: string }>)
      : (getDb()
          .prepare(`SELECT id FROM questions WHERE theme = ? AND seeded_depth >= ? ORDER BY RANDOM() LIMIT ?`)
          .all(theme, SOLO_TOP_N, count) as Array<{ id: string }>);
  return rows.map((r) => r.id);
}

export function listSoloThemes(): Array<{ theme: string; count: number }> {
  return getDb()
    .prepare(
      `SELECT theme, COUNT(*) as count FROM questions
       WHERE seeded_depth >= ?
       GROUP BY theme ORDER BY theme`
    )
    .all(SOLO_TOP_N) as Array<{ theme: string; count: number }>;
}

function toPublic(q: Question, endsAt: number | null): SoloQuestionPublic {
  return {
    id: q.id,
    title: q.title,
    prompt: q.prompt,
    answerType: q.answerType,
    disclaimer: q.disclaimer,
    asOfDate: q.asOfDate,
    topN: Math.min(SOLO_TOP_N, q.seededDepth),
    endsAt,
  };
}

export function createSession(userId: string, displayName: string, mode: SoloMode, theme: string): SoloClientState | null {
  const ids = pickQuestionIds(SOLO_QUESTIONS_PER_GAME, theme);
  if (ids.length < SOLO_QUESTIONS_PER_GAME) return null;
  const id = randomUUID();
  const endsAt = Date.now() + SOLO_SECONDS_PER_QUESTION * 1000;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO solo_sessions
       (id, user_id, display_name, mode, theme, question_ids, picks, current_idx, question_ends_at, score, finished, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?)`
    )
    .run(id, userId, displayName.slice(0, 24), mode, theme, JSON.stringify(ids), JSON.stringify([]), endsAt, now);
  const first = getQuestionFull(ids[0]);
  return {
    sessionId: id,
    mode,
    theme,
    displayName: displayName.slice(0, 24),
    currentIdx: 0,
    totalQuestions: SOLO_QUESTIONS_PER_GAME,
    score: 0,
    finished: false,
    currentQuestion: first ? toPublic(first, endsAt) : null,
    lastResult: null,
  };
}

function loadSession(sessionId: string): SoloSessionRow | null {
  return (
    (getDb().prepare("SELECT * FROM solo_sessions WHERE id = ?").get(sessionId) as SoloSessionRow | undefined) ?? null
  );
}

export function getState(sessionId: string, userId: string): SoloClientState | null {
  const s = loadSession(sessionId);
  if (!s || s.user_id !== userId) return null;
  const ids: string[] = JSON.parse(s.question_ids);
  const picks: Array<string | null> = JSON.parse(s.picks);
  const finished = !!s.finished || s.current_idx >= ids.length;
  const currentQuestion =
    finished || s.current_idx >= ids.length ? null : (() => {
      const q = getQuestionFull(ids[s.current_idx]);
      return q ? toPublic(q, s.question_ends_at) : null;
    })();

  // Build last-round result if there is one submitted round.
  let lastResult: SoloRoundResult | null = null;
  if (s.current_idx > 0) {
    const prevId = ids[s.current_idx - 1];
    const prevQ = getQuestionFull(prevId);
    if (prevQ) {
      const pick = picks[s.current_idx - 1] ?? null;
      const topN = Math.min(SOLO_TOP_N, prevQ.seededDepth);
      const match = pick ? prevQ.answers.find((a) => a.code === pick) : null;
      const inRange = match && match.rank <= topN ? match.rank : null;
      const points = scorePick(s.mode as SoloMode, inRange, topN, SOLO_MISS_PENALTY);
      lastResult = {
        questionId: prevQ.id,
        questionTitle: prevQ.title,
        yourPick: pick ? { code: pick, label: labelForCode(prevQ.answerType, pick) } : null,
        yourRank: inRange,
        pointsEarned: points,
        correctAnswers: prevQ.answers
          .filter((a) => a.rank <= topN)
          .map((a) => ({ ...a, label: labelForCode(prevQ.answerType, a.code) })),
        source: prevQ.source,
        trivia: prevQ.trivia,
      };
    }
  }

  return {
    sessionId,
    mode: s.mode as SoloMode,
    theme: s.theme,
    displayName: s.display_name,
    currentIdx: s.current_idx,
    totalQuestions: ids.length,
    score: s.score,
    finished,
    currentQuestion,
    lastResult,
  };
}

export function submitPick(sessionId: string, userId: string, pick: string | null): SoloClientState | null {
  const s = loadSession(sessionId);
  if (!s || s.user_id !== userId) return null;
  if (s.finished) return getState(sessionId, userId);
  const ids: string[] = JSON.parse(s.question_ids);
  const picks: Array<string | null> = JSON.parse(s.picks);
  if (s.current_idx >= ids.length) return getState(sessionId, userId);

  const q = getQuestionFull(ids[s.current_idx]);
  if (!q) return null;
  const topN = Math.min(SOLO_TOP_N, q.seededDepth);

  // Ignore submissions after the deadline unless pick is null (timeout auto-submit).
  const now = Date.now();
  const expired = s.question_ends_at !== null && now > s.question_ends_at + 2000;
  const effectivePick = expired ? null : pick;

  const match = effectivePick ? q.answers.find((a) => a.code === effectivePick) : null;
  const inRange = match && match.rank <= topN ? match.rank : null;
  const points = scorePick(s.mode as SoloMode, inRange, topN, SOLO_MISS_PENALTY);

  picks.push(effectivePick ?? null);
  const nextIdx = s.current_idx + 1;
  const nextScore = s.score + points;
  const isDone = nextIdx >= ids.length;

  // Do NOT start the next round's timer here — the player is now on the
  // intermission and the timer must only start when they click Next.
  // startRound() handles that transition.
  getDb()
    .prepare(
      `UPDATE solo_sessions SET picks = ?, current_idx = ?, score = ?, question_ends_at = NULL, finished = ? WHERE id = ?`
    )
    .run(JSON.stringify(picks), nextIdx, nextScore, isDone ? 1 : 0, sessionId);

  if (isDone) {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO solo_scores (session_id, user_id, display_name, mode, theme, score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(sessionId, userId, s.display_name, s.mode, s.theme, nextScore, now);
  }

  return getState(sessionId, userId);
}

export function startRound(sessionId: string, userId: string): SoloClientState | null {
  const s = loadSession(sessionId);
  if (!s || s.user_id !== userId) return null;
  if (s.finished) return getState(sessionId, userId);
  // Idempotent: if a timer is already set and not expired, don't reset it.
  const now = Date.now();
  if (!s.question_ends_at || s.question_ends_at < now) {
    getDb()
      .prepare("UPDATE solo_sessions SET question_ends_at = ? WHERE id = ?")
      .run(now + SOLO_SECONDS_PER_QUESTION * 1000, sessionId);
  }
  return getState(sessionId, userId);
}

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  score: number;
  createdAt: number;
  isYou: boolean;
};

export function getLeaderboard(mode: SoloMode, theme: string, userId: string | null, limit = 25): LeaderboardEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, display_name, MAX(score) as best, MAX(created_at) as created_at
       FROM solo_scores WHERE mode = ? AND theme = ?
       GROUP BY user_id
       ORDER BY best DESC, created_at ASC
       LIMIT ?`
    )
    .all(mode, theme, limit) as Array<{ user_id: string; display_name: string; best: number; created_at: number }>;
  return rows.map((r, i) => ({
    rank: i + 1,
    displayName: r.display_name,
    score: r.best,
    createdAt: r.created_at,
    isYou: !!userId && userId === r.user_id,
  }));
}

export function getUserBest(mode: SoloMode, theme: string, userId: string): { score: number; rank: number | null } | null {
  const row = getDb()
    .prepare(`SELECT MAX(score) as best FROM solo_scores WHERE mode = ? AND theme = ? AND user_id = ?`)
    .get(mode, theme, userId) as { best: number | null } | undefined;
  if (!row || row.best === null) return null;
  const rankRow = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT user_id) as ahead FROM solo_scores
       WHERE mode = ? AND theme = ? AND user_id != ? AND score > ?`
    )
    .get(mode, theme, userId, row.best) as { ahead: number };
  return { score: row.best, rank: rankRow.ahead + 1 };
}

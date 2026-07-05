import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  _db = new Database(path.join(dataDir, "topten.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS answer_options (
      answer_type TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (answer_type, code)
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      subtheme TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer_type TEXT NOT NULL,
      seeded_depth INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_as_of TEXT NOT NULL,
      note TEXT,
      disclaimer TEXT,
      trivia TEXT,
      as_of_date TEXT
    );
    CREATE TABLE IF NOT EXISTS answers (
      question_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      code TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (question_id, rank, code),
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
    CREATE INDEX IF NOT EXISTS idx_options_type ON answer_options(answer_type);
    CREATE INDEX IF NOT EXISTS idx_questions_theme ON questions(theme);
    CREATE TABLE IF NOT EXISTS feedback (
      question_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      thumbs INTEGER,               -- 1 = up, -1 = down, NULL = cleared
      text TEXT,                    -- max 500 chars, may be empty/NULL
      addressed INTEGER NOT NULL DEFAULT 0,  -- 0 = no, 1 = yes
      created_at INTEGER NOT NULL,  -- ms epoch
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (question_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_question ON feedback(question_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_addressed ON feedback(addressed);
  `);
  // In-place migration for legacy DBs
  const cols = _db.prepare("PRAGMA table_info(questions)").all() as Array<{ name: string }>;
  const has = (n: string) => cols.some((c) => c.name === n);
  if (!has("disclaimer")) _db.exec("ALTER TABLE questions ADD COLUMN disclaimer TEXT");
  if (!has("trivia")) _db.exec("ALTER TABLE questions ADD COLUMN trivia TEXT");
  if (!has("as_of_date")) _db.exec("ALTER TABLE questions ADD COLUMN as_of_date TEXT");
  return _db;
}

export type AnswerOption = { code: string; name: string };
export type QuestionAnswer = { rank: number; code: string; value: string };
export type QuestionSource = { name: string; url: string; asOf: string };
export type Question = {
  id: string;
  theme: string;
  subtheme: string | null;
  title: string;
  prompt: string;
  answerType: string;
  seededDepth: number;
  source: QuestionSource;
  note: string | null;
  disclaimer: string | null;
  trivia: string | null;
  asOfDate: string | null;
  answers: QuestionAnswer[];
};

export function listOptions(answerType: string): AnswerOption[] {
  return getDb()
    .prepare("SELECT code, name FROM answer_options WHERE answer_type = ? ORDER BY name")
    .all(answerType) as AnswerOption[];
}

export function listAllOptions(): Record<string, AnswerOption[]> {
  const rows = getDb()
    .prepare("SELECT answer_type, code, name FROM answer_options ORDER BY answer_type, name")
    .all() as Array<{ answer_type: string; code: string; name: string }>;
  const out: Record<string, AnswerOption[]> = {};
  for (const r of rows) {
    if (!out[r.answer_type]) out[r.answer_type] = [];
    out[r.answer_type].push({ code: r.code, name: r.name });
  }
  return out;
}

export type ThemeInfo = { theme: string; count: number; subthemes: SubthemeInfo[] };
export type SubthemeInfo = { subtheme: string; count: number };

export function listThemes(): ThemeInfo[] {
  const themeRows = getDb()
    .prepare("SELECT theme, COUNT(*) as count FROM questions GROUP BY theme ORDER BY theme")
    .all() as Array<{ theme: string; count: number }>;
  const subRows = getDb()
    .prepare(
      "SELECT theme, COALESCE(subtheme, '') as subtheme, COUNT(*) as count FROM questions GROUP BY theme, subtheme ORDER BY theme, subtheme"
    )
    .all() as Array<{ theme: string; subtheme: string; count: number }>;
  const byTheme = new Map<string, SubthemeInfo[]>();
  for (const r of subRows) {
    if (!r.subtheme) continue;
    if (!byTheme.has(r.theme)) byTheme.set(r.theme, []);
    byTheme.get(r.theme)!.push({ subtheme: r.subtheme, count: r.count });
  }
  return themeRows.map((t) => ({ ...t, subthemes: byTheme.get(t.theme) ?? [] }));
}

export function listQuestionIdsInTheme(theme: string, subtheme?: string | null): string[] {
  let rows;
  if (subtheme && subtheme !== "*") {
    rows = getDb()
      .prepare("SELECT id FROM questions WHERE theme = ? AND subtheme = ?")
      .all(theme, subtheme) as { id: string }[];
  } else {
    rows = getDb().prepare("SELECT id FROM questions WHERE theme = ?").all(theme) as { id: string }[];
  }
  return rows.map((r) => r.id);
}

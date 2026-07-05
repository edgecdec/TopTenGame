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
    CREATE TABLE IF NOT EXISTS countries (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer_type TEXT NOT NULL,
      seeded_depth INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_as_of TEXT NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS answers (
      question_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      code TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (question_id, rank),
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
  `);
  return _db;
}

export type Country = { code: string; name: string };
export type QuestionAnswer = { rank: number; code: string; value: string };
export type QuestionSource = { name: string; url: string; asOf: string };
export type Question = {
  id: string;
  theme: string;
  title: string;
  prompt: string;
  answerType: string;
  seededDepth: number;
  source: QuestionSource;
  note: string | null;
  answers: QuestionAnswer[];
};

export function listCountries(): Country[] {
  return getDb().prepare("SELECT code, name FROM countries ORDER BY name").all() as Country[];
}

export function listQuestions(): Array<Omit<Question, "answers">> {
  const rows = getDb()
    .prepare(
      `SELECT id, theme, title, prompt, answer_type as answerType, seeded_depth as seededDepth,
              source_name, source_url, source_as_of, note
       FROM questions ORDER BY id`
    )
    .all() as Array<{
    id: string;
    theme: string;
    title: string;
    prompt: string;
    answerType: string;
    seededDepth: number;
    source_name: string;
    source_url: string;
    source_as_of: string;
    note: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    theme: r.theme,
    title: r.title,
    prompt: r.prompt,
    answerType: r.answerType,
    seededDepth: r.seededDepth,
    source: { name: r.source_name, url: r.source_url, asOf: r.source_as_of },
    note: r.note,
  }));
}

export function getQuestion(id: string): Question | null {
  const meta = listQuestions().find((q) => q.id === id);
  if (!meta) return null;
  const answers = getDb()
    .prepare("SELECT rank, code, value FROM answers WHERE question_id = ? ORDER BY rank")
    .all(id) as QuestionAnswer[];
  return { ...meta, answers };
}

export type ThemeInfo = { theme: string; count: number };

export function listThemes(): ThemeInfo[] {
  return getDb()
    .prepare("SELECT theme, COUNT(*) as count FROM questions GROUP BY theme ORDER BY theme")
    .all() as ThemeInfo[];
}

export function listQuestionIdsInTheme(theme: string): string[] {
  const rows = getDb().prepare("SELECT id FROM questions WHERE theme = ?").all(theme) as { id: string }[];
  return rows.map((r) => r.id);
}

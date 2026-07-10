import fs from "fs";
import path from "path";
import { getDb, type AnswerOption, type Question } from "../src/lib/db";

const dataDir = path.join(process.cwd(), "data");
const answerSets: Record<string, AnswerOption[]> = JSON.parse(
  fs.readFileSync(path.join(dataDir, "answer_sets.json"), "utf8")
);
const questions: Question[] = JSON.parse(fs.readFileSync(path.join(dataDir, "questions.json"), "utf8"));

const db = getDb();

const insertOption = db.prepare(
  "INSERT OR REPLACE INTO answer_options (answer_type, code, name) VALUES (?, ?, ?)"
);
const insertQuestion = db.prepare(
  `INSERT OR REPLACE INTO questions
   (id, theme, subtheme, title, prompt, answer_type, seeded_depth, source_name, source_url, source_as_of, note, disclaimer, trivia, as_of_date)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertAnswer = db.prepare(
  "INSERT INTO answers (question_id, rank, code, value) VALUES (?, ?, ?, ?)"
);

// Themes considered production-ready (surface without a Beta warning; included
// in the "All categories" solo pool). Everything else is beta until manually
// flipped via `UPDATE themes SET is_prod = 1 WHERE theme = 'X'`.
//
// INSERT OR IGNORE creates any missing row at the intended default. A follow-up
// UPDATE then corrects any pre-existing row that was created before this flag
// existed (or before the intended defaults were correct) — but only bumps
// is_prod UP, never down, so manual admin-promotions of other themes stick.
const INITIAL_PROD_THEMES = new Set([
  "Countries",
  "US States",
  "US Big 4 Sports",
  "Video Games",
  "Chemical Elements",
  "Companies",
]);
const insertTheme = db.prepare(
  "INSERT OR IGNORE INTO themes (theme, is_prod) VALUES (?, ?)"
);
const promoteTheme = db.prepare(
  "UPDATE themes SET is_prod = 1 WHERE theme = ? AND is_prod = 0"
);

const runSeed = db.transaction(() => {
  db.prepare("DELETE FROM answers").run();
  db.prepare("DELETE FROM questions").run();
  db.prepare("DELETE FROM answer_options").run();
  for (const [answerType, opts] of Object.entries(answerSets)) {
    for (const opt of opts) insertOption.run(answerType, opt.code, opt.name);
    // Ensure every answerType has a themes row so admins can flip its flag.
    const wantProd = INITIAL_PROD_THEMES.has(answerType);
    insertTheme.run(answerType, wantProd ? 1 : 0);
    // If the row already existed from an earlier deploy (when everything
    // defaulted to is_prod=0), promote the intended-prod themes now.
    if (wantProd) promoteTheme.run(answerType);
  }
  for (const q of questions) {
    insertQuestion.run(
      q.id,
      q.theme,
      q.subtheme ?? null,
      q.title,
      q.prompt,
      q.answerType,
      q.seededDepth,
      q.source.name,
      q.source.url,
      q.source.asOf,
      q.note ?? null,
      q.disclaimer ?? null,
      q.trivia ?? null,
      q.asOfDate ?? null
    );
    for (const a of q.answers) insertAnswer.run(q.id, a.rank, a.code, a.value);
  }
});

runSeed();

const themeCount = (db.prepare("SELECT COUNT(DISTINCT theme) as n FROM questions").get() as { n: number }).n;
const questionCount = (db.prepare("SELECT COUNT(*) as n FROM questions").get() as { n: number }).n;
const answerCount = (db.prepare("SELECT COUNT(*) as n FROM answers").get() as { n: number }).n;
const optionCount = (db.prepare("SELECT COUNT(*) as n FROM answer_options").get() as { n: number }).n;
const prodThemes = (db.prepare("SELECT theme FROM themes WHERE is_prod = 1 ORDER BY theme").all() as Array<{
  theme: string;
}>).map((r) => r.theme);
const betaThemes = (db.prepare("SELECT theme FROM themes WHERE is_prod = 0 ORDER BY theme").all() as Array<{
  theme: string;
}>).map((r) => r.theme);
console.log(
  `Seed complete: ${themeCount} themes, ${questionCount} questions, ${answerCount} answers, ${optionCount} dropdown options.`
);
console.log(`  Prod themes: ${prodThemes.join(", ") || "(none)"}`);
console.log(`  Beta themes: ${betaThemes.join(", ") || "(none)"}`);

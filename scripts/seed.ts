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
   (id, theme, subtheme, title, prompt, answer_type, seeded_depth, source_name, source_url, source_as_of, note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertAnswer = db.prepare(
  "INSERT INTO answers (question_id, rank, code, value) VALUES (?, ?, ?, ?)"
);

const runSeed = db.transaction(() => {
  db.prepare("DELETE FROM answers").run();
  db.prepare("DELETE FROM questions").run();
  db.prepare("DELETE FROM answer_options").run();
  for (const [answerType, opts] of Object.entries(answerSets)) {
    for (const opt of opts) insertOption.run(answerType, opt.code, opt.name);
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
      q.note ?? null
    );
    for (const a of q.answers) insertAnswer.run(q.id, a.rank, a.code, a.value);
  }
});

runSeed();

const themeCount = (db.prepare("SELECT COUNT(DISTINCT theme) as n FROM questions").get() as { n: number }).n;
const questionCount = (db.prepare("SELECT COUNT(*) as n FROM questions").get() as { n: number }).n;
const answerCount = (db.prepare("SELECT COUNT(*) as n FROM answers").get() as { n: number }).n;
const optionCount = (db.prepare("SELECT COUNT(*) as n FROM answer_options").get() as { n: number }).n;
console.log(
  `Seed complete: ${themeCount} themes, ${questionCount} questions, ${answerCount} answers, ${optionCount} dropdown options.`
);

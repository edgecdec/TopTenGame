import fs from "fs";
import path from "path";
import { getDb, type Country, type Question } from "../src/lib/db";

const dataDir = path.join(process.cwd(), "data");
const countries: Country[] = JSON.parse(fs.readFileSync(path.join(dataDir, "countries.json"), "utf8"));
const questions: Question[] = JSON.parse(fs.readFileSync(path.join(dataDir, "questions.json"), "utf8"));

const db = getDb();

const insertCountry = db.prepare("INSERT OR REPLACE INTO countries (code, name) VALUES (?, ?)");
const insertQuestion = db.prepare(
  `INSERT OR REPLACE INTO questions
   (id, theme, title, prompt, answer_type, seeded_depth, source_name, source_url, source_as_of, note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const deleteAnswers = db.prepare("DELETE FROM answers WHERE question_id = ?");
const insertAnswer = db.prepare("INSERT INTO answers (question_id, rank, code, value) VALUES (?, ?, ?, ?)");

const runSeed = db.transaction(() => {
  for (const c of countries) insertCountry.run(c.code, c.name);
  for (const q of questions) {
    insertQuestion.run(
      q.id,
      q.theme,
      q.title,
      q.prompt,
      q.answerType,
      q.seededDepth,
      q.source.name,
      q.source.url,
      q.source.asOf,
      (q as Question & { note?: string }).note ?? null
    );
    deleteAnswers.run(q.id);
    for (const a of q.answers) insertAnswer.run(q.id, a.rank, a.code, a.value);
  }
});

runSeed();

const countryCount = (db.prepare("SELECT COUNT(*) as n FROM countries").get() as { n: number }).n;
const questionCount = (db.prepare("SELECT COUNT(*) as n FROM questions").get() as { n: number }).n;
const answerCount = (db.prepare("SELECT COUNT(*) as n FROM answers").get() as { n: number }).n;
console.log(`Seed complete: ${countryCount} countries, ${questionCount} questions, ${answerCount} answers.`);

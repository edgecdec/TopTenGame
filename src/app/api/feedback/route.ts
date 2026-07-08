import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/lib/identity";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Solo feedback endpoint. Multiplayer feedback still flows through the socket path.
// Validation: the questionId must belong to a solo_session owned by this user, and
// must have been played (i.e. the current_idx has advanced past its position in the queue).
export async function POST(req: Request) {
  const { userId } = await getOrCreateUserId();
  const body = await req.json().catch(() => ({}));
  const { sessionId, questionId } = body;
  const thumbsRaw = body.thumbs;
  const textRaw = body.text;

  if (typeof sessionId !== "string" || typeof questionId !== "string") {
    return NextResponse.json({ error: "sessionId and questionId required" }, { status: 400 });
  }
  const cleanThumbs = thumbsRaw === 1 || thumbsRaw === -1 ? thumbsRaw : null;
  const cleanText = typeof textRaw === "string" ? textRaw.slice(0, 500).trim() : "";

  const db = getDb();
  const session = db
    .prepare("SELECT user_id, question_ids, current_idx FROM solo_sessions WHERE id = ?")
    .get(sessionId) as { user_id: string; question_ids: string; current_idx: number } | undefined;
  if (!session || session.user_id !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ids: string[] = JSON.parse(session.question_ids);
  const pos = ids.indexOf(questionId);
  if (pos < 0 || pos >= session.current_idx) {
    // Question was never played in this session, or hasn't been submitted yet
    return NextResponse.json({ error: "question not played" }, { status: 400 });
  }

  if (cleanThumbs === null && !cleanText) {
    db.prepare("DELETE FROM feedback WHERE question_id = ? AND user_id = ?").run(questionId, userId);
    return NextResponse.json({ ok: true, cleared: true });
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
  return NextResponse.json({ ok: true });
}

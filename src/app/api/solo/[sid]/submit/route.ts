import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/lib/identity";
import { submitPick } from "@/lib/solo";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const { userId } = await getOrCreateUserId();
  const body = await req.json().catch(() => ({}));
  const pick = typeof body.pick === "string" && body.pick.length > 0 ? body.pick : null;
  const state = submitPick(sid, userId, pick);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}

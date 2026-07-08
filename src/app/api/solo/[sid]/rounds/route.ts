import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/lib/identity";
import { getRoundSummaries } from "@/lib/solo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const { userId } = await getOrCreateUserId();
  const rounds = getRoundSummaries(sid, userId);
  if (!rounds) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ rounds });
}

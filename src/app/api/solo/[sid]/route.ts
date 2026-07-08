import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/lib/identity";
import { getState } from "@/lib/solo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const { userId } = await getOrCreateUserId();
  const state = getState(sid, userId);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}

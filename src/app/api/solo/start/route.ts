import { NextResponse } from "next/server";
import { getOrCreateUserId, sessionCookieName } from "@/lib/identity";
import { createSession, type SoloMode, ALL_THEME } from "@/lib/solo";

export const dynamic = "force-dynamic";

const VALID_MODES: SoloMode[] = ["rank", "inverse", "flat"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 24) : "";
  const mode = VALID_MODES.includes(body.mode) ? (body.mode as SoloMode) : null;
  const theme = typeof body.theme === "string" && body.theme.length > 0 ? body.theme : null;
  if (!name || !mode || !theme) {
    return NextResponse.json({ error: "name, mode, and theme are required" }, { status: 400 });
  }

  const { userId, freshToken } = await getOrCreateUserId();
  const state = createSession(userId, name, mode, theme);
  if (!state) {
    return NextResponse.json({ error: `Not enough questions in theme "${theme}"` }, { status: 400 });
  }
  const res = NextResponse.json(state);
  if (freshToken) {
    res.cookies.set(sessionCookieName(), freshToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

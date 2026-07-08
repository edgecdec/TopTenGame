import { NextResponse } from "next/server";
import { getOrCreateUserId } from "@/lib/identity";
import { getLeaderboard, getUserBest, listSoloThemes, ALL_THEME, type SoloMode } from "@/lib/solo";

export const dynamic = "force-dynamic";

const VALID_MODES: SoloMode[] = ["rank", "inverse", "flat"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const theme = url.searchParams.get("theme") || ALL_THEME;
  const mode = VALID_MODES.includes(modeParam as SoloMode) ? (modeParam as SoloMode) : "rank";

  const { userId } = await getOrCreateUserId();
  const entries = getLeaderboard(mode, theme, userId, 25);
  const best = getUserBest(mode, theme, userId);
  const themes = listSoloThemes();
  return NextResponse.json({ mode, theme, entries, best, themes });
}

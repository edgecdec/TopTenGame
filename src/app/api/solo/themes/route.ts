import { NextResponse } from "next/server";
import { listSoloThemes } from "@/lib/solo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ themes: listSoloThemes() });
}

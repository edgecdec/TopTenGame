import { NextResponse } from "next/server";
import { listAllOptions, listThemes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    optionsByType: listAllOptions(),
    themes: listThemes(),
  });
}

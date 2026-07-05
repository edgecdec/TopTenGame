import { NextResponse } from "next/server";
import { listCountries, listThemes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ countries: listCountries(), themes: listThemes() });
}

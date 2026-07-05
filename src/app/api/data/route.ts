import { NextResponse } from "next/server";
import { listCountries, listQuestions } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ countries: listCountries(), questions: listQuestions() });
}

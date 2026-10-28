import type { NextRequest, NextResponse } from "next/server";
import { captureSuggest } from "@/lib/capture";
import { captureResponse, readJson, asString } from "@/lib/capture-http";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  return captureResponse(await captureSuggest(getDb(), getConfig().anthropicApiKey, asString(body.raw_text)));
}

import type { NextRequest, NextResponse } from "next/server";
import { captureReprocess } from "@/lib/capture";
import { captureResponse, readJson } from "@/lib/capture-http";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { idea_id: ideaId } = await readJson(req);
  const id = typeof ideaId === "number" && Number.isInteger(ideaId) ? ideaId : -1;
  return captureResponse(await captureReprocess(getDb(), getConfig().anthropicApiKey, id));
}

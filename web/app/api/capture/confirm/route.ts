import { NextResponse, type NextRequest } from "next/server";
import { captureConfirm } from "@/lib/capture";
import { readJson, asString } from "@/lib/capture-http";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  const result = captureConfirm(getDb(), {
    rawText: asString(body.raw_text),
    ideaId: typeof body.idea_id === "number" && Number.isInteger(body.idea_id) ? body.idea_id : null,
    title: asString(body.title),
    content: asString(body.content),
    tags: asString(body.tags),
    projectChoice: asString(body.project_id),
    newProject: asString(body.new_project),
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

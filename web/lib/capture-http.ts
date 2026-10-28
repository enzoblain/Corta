import { NextResponse } from "next/server";
import type { CaptureResult } from "@/lib/capture-shared";

/** JSON body of a request as a plain record ({} when absent or malformed). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export const asString = (v: unknown): string => (typeof v === "string" ? v : "");

export function captureResponse(result: CaptureResult): NextResponse {
  return NextResponse.json(result);
}

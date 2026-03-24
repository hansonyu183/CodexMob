import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { openLocalPathInSystem } from "@/lib/local/open";
import { verifyAccessCode } from "@/lib/security/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON body.", 400);
  }

  const pathValue = typeof payload === "object" && payload !== null ? (payload as { path?: unknown }).path : null;
  if (typeof pathValue !== "string" || !pathValue.trim()) {
    return errorResponse("INVALID_REQUEST", "Field `path` is required.", 400);
  }

  try {
    await openLocalPathInSystem(pathValue);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open local path.";
    return errorResponse("UPSTREAM_ERROR", message, 500);
  }
}

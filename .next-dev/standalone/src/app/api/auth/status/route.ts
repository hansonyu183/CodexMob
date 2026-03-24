import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { runtime } from "@/lib/server/runtime-context";

export async function GET(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  try {
    const authStatus = await runtime.getAuthStatus();
    return NextResponse.json(authStatus, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to read Codex auth status.";
    return errorResponse("UPSTREAM_ERROR", message, 502);
  }
}


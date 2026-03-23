import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { listHistoryMessages } from "@/lib/history/service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteParams) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const { id } = await context.params;
  if (!id) {
    return errorResponse("INVALID_REQUEST", "Conversation id is required.", 400);
  }

  try {
    const payload = await listHistoryMessages(id);
    return NextResponse.json({ items: payload }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list messages.";
    return errorResponse("UPSTREAM_ERROR", message, 502);
  }
}

export async function POST(request: Request, context: RouteParams) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const { id } = await context.params;
  if (!id) {
    return errorResponse("INVALID_REQUEST", "Conversation id is required.", 400);
  }

  return errorResponse(
    "INVALID_REQUEST",
    "此接口已废弃。请使用 /api/chat/stream 通过 Codex CLI 持久化会话。",
    405,
  );
}

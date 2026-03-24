import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { listHistoryConversations, upsertNativeConversation } from "@/lib/history/service";

export async function GET(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);

  try {
    const payload = await listHistoryConversations({
      cursor,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list conversations.";
    return errorResponse("UPSTREAM_ERROR", message, 502);
  }
}

export async function POST(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON body.", 400);
  }

  if (typeof raw !== "object" || raw === null) {
    return errorResponse("INVALID_REQUEST", "Invalid payload.", 400);
  }

  const payload = raw as Record<string, unknown>;
  const title = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : "新会话";
  const id = typeof payload.id === "string" ? payload.id : undefined;
  const model = typeof payload.model === "string" ? payload.model : undefined;
  const cwd = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd.trim() : undefined;

  if (!id && !cwd) {
    return errorResponse("INVALID_REQUEST", "请先选择项目后再新建会话。", 400);
  }

  try {
    const created = await upsertNativeConversation({
      id,
      title,
      model,
      cwd,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create conversation.";
    return errorResponse("UPSTREAM_ERROR", message, 502);
  }
}

import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { listUploadsByConversationId } from "@/lib/uploads/storage";
import type { AttachmentRef } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteParams) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return errorResponse("INVALID_REQUEST", "Conversation id is required.", 400);
  }

  try {
    const items = await listUploadsByConversationId(id);
    const refs: AttachmentRef[] = items.map((item) => ({
      ...item,
      conversationId: id,
    }));
    return NextResponse.json({ items: refs }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list conversation attachments.";
    return errorResponse("UPSTREAM_ERROR", message, 500);
  }
}

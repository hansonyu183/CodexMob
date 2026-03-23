import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { resolveModels, serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { runtime } from "@/lib/server/runtime-context";
import type { ModelsResponse } from "@/lib/types";

export async function GET(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const auth = await runtime.getAuthStatus();
  if (!auth.ready) {
    return errorResponse("AUTH_REQUIRED", auth.message ?? "Codex auth is required.", 401);
  }

  const models = resolveModels();
  const payload: ModelsResponse = {
    defaultModel: models.includes(serverEnv.defaultModel)
      ? serverEnv.defaultModel
      : models[0],
    models,
  };

  return NextResponse.json(payload, { status: 200 });
}


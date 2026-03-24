import { NextResponse } from "next/server";

import { getLocalModelConfig } from "@/lib/codex/config";
import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { runtime } from "@/lib/server/runtime-context";
import type { ModelsResponse } from "@/lib/types";

const FALLBACK_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
];

const DEFAULT_CONTEXT_WINDOW = 128_000;

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-5.4": 200_000,
  "gpt-5.4-mini": 128_000,
  "gpt-5.3-codex": 200_000,
  "gpt-5.3-codex-spark": 128_000,
  "gpt-5.2-codex": 128_000,
  "gpt-5.2": 128_000,
  "gpt-5.1-codex-max": 128_000,
  "gpt-5.1-codex-mini": 128_000,
};

export async function GET(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const auth = await runtime.getAuthStatus();
  if (!auth.ready) {
    return errorResponse("AUTH_REQUIRED", auth.message ?? "Codex auth is required.", 401);
  }

  const localConfig = await getLocalModelConfig();
  const models = localConfig.models.length > 0 ? localConfig.models : FALLBACK_MODELS;
  const defaultModel = localConfig.defaultModel || serverEnv.defaultModel;
  const payload: ModelsResponse = {
    defaultModel: models.includes(defaultModel)
      ? defaultModel
      : models[0],
    models,
    modelCaps: Object.fromEntries(
      models.map((model) => [
        model,
        {
          contextWindow: MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW,
        },
      ]),
    ),
  };

  return NextResponse.json(payload, { status: 200 });
}

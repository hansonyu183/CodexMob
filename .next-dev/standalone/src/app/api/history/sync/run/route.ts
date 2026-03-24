import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import type { SyncRunRequest } from "@/lib/types";
import { verifyAccessCode } from "@/lib/security/access";
import { runSync } from "@/lib/history/service";

export async function POST(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  try {
    let raw: unknown = {};
    try {
      raw = await request.json();
    } catch {
      raw = {};
    }
    const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<SyncRunRequest>;
    const cwdFilter =
      typeof input.cwdFilter === "string" && input.cwdFilter.trim()
        ? input.cwdFilter.trim()
        : undefined;
    const payload = await runSync({ cwdFilter });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    return errorResponse("UPSTREAM_ERROR", message, 502);
  }
}

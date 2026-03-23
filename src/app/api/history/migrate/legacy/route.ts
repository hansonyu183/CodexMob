import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";

export async function POST(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  return errorResponse(
    "INVALID_REQUEST",
    "Legacy migration is disabled. History now uses ~/.codex as the single source.",
    410,
  );
}

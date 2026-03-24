import { timingSafeEqual } from "node:crypto";

import type { ApiErrorShape } from "@/lib/types";

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function extractAccessCode(request: Request): string {
  return request.headers.get("x-app-access-code")?.trim() ?? "";
}

export function verifyAccessCode(
  request: Request,
  expectedCode: string,
): ApiErrorShape | null {
  if (!expectedCode) {
    return {
      code: "AUTH_REQUIRED",
      message: "Server access code is not configured.",
    };
  }

  const actualCode = extractAccessCode(request);

  if (!actualCode || !secureEqual(actualCode, expectedCode)) {
    return {
      code: "ACCESS_DENIED",
      message: "Invalid access code.",
    };
  }

  return null;
}

export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}


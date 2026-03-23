import { NextResponse } from "next/server";

import type { ApiErrorCode, ApiErrorShape } from "@/lib/types";

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
) {
  const payload: ApiErrorShape = {
    code,
    message,
  };

  return NextResponse.json(payload, { status });
}

export function parseApiError(error: unknown): ApiErrorShape {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code: string }).code === "string" &&
    typeof (error as { message: string }).message === "string"
  ) {
    return error as ApiErrorShape;
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Unknown error",
  };
}


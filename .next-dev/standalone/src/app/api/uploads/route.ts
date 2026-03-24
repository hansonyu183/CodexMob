import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { persistUploadedFile } from "@/lib/uploads/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid multipart form data.", 400);
  }

  const scopeInput = formData.get("scope");
  const scope = typeof scopeInput === "string" && scopeInput.trim() ? scopeInput.trim() : "temp";

  const fileEntries = formData.getAll("files");
  if (fileEntries.length === 0) {
    return errorResponse("INVALID_REQUEST", "No files uploaded.", 400);
  }

  try {
    const items = [];
    for (const entry of fileEntries) {
      if (!(entry instanceof File)) {
        return errorResponse("INVALID_REQUEST", "Invalid file entry.", 400);
      }
      const bytes = new Uint8Array(await entry.arrayBuffer());
      const item = await persistUploadedFile({
        fileName: entry.name,
        mimeType: entry.type || "",
        bytes,
        scope,
      });
      items.push(item);
    }
    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return errorResponse("INVALID_REQUEST", message, 400);
  }
}


import path from "node:path";
import { promises as fs } from "node:fs";

import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { verifyAccessCode } from "@/lib/security/access";
import { getUploadById } from "@/lib/uploads/storage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function mimeFromUpload(kind: "image" | "text", fileName: string): string {
  if (kind === "image") {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
  }
  return "application/octet-stream";
}

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteParams) {
  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return errorResponse("INVALID_REQUEST", "Attachment id is required.", 400);
  }

  const item = await getUploadById(id);
  if (!item) {
    return errorResponse("UPSTREAM_ERROR", "附件不存在或不可访问。", 404);
  }

  try {
    const bytes = await fs.readFile(item.path);
    const encodedName = encodeURIComponent(item.name);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeFromUpload(item.kind, item.name),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return errorResponse("UPSTREAM_ERROR", "下载附件失败。", 500);
  }
}

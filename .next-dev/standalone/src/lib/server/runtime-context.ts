import { getCodexRuntime } from "@/lib/codex/runtime";
import { serverEnv } from "@/lib/env";
import { InMemoryRateLimiter } from "@/lib/security/rate-limit";
import { FileLogger } from "@/lib/server/logger";

export const runtime = getCodexRuntime({
  bin: serverEnv.codexBin,
  cwd: serverEnv.codexCwd,
  sandbox: serverEnv.codexSandbox,
  execTimeoutMs: serverEnv.codexExecTimeoutMs,
});

export const limiter = new InMemoryRateLimiter(
  serverEnv.rateLimitMax,
  serverEnv.rateLimitWindowMs,
);

export const fileLogger = new FileLogger({
  filePath: serverEnv.codexMobLogFile,
  maxFieldChars: serverEnv.codexMobLogMaxFieldChars,
});

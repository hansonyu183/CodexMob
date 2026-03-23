import path from "node:path";

function resolveHome(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (!home) {
    throw new Error("Cannot resolve user home directory.");
  }
  return home;
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(resolveHome(), ".codex");
}

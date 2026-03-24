import { describe, expect, it } from "vitest";

import {
  normalizeSandboxForTests,
  parseModelsCacheForTests,
  parseTomlModelForTests,
  parseTomlModelListForTests,
  parseTomlSandboxForTests,
} from "@/lib/codex/config";

describe("parseTomlModelForTests", () => {
  it("parses double-quoted model", () => {
    const model = parseTomlModelForTests('model = "gpt-5.4"');
    expect(model).toBe("gpt-5.4");
  });

  it("parses single-quoted model", () => {
    const model = parseTomlModelForTests("model = 'gpt-5.3-codex'");
    expect(model).toBe("gpt-5.3-codex");
  });

  it("returns null when model is missing", () => {
    const model = parseTomlModelForTests("sandbox = \"read-only\"");
    expect(model).toBeNull();
  });

  it("parses all configured models and deduplicates", () => {
    const models = parseTomlModelListForTests(`
model = "gpt-5.4"

[profiles.fast]
model = "gpt-5.3-codex"

[profiles.safe]
model = "gpt-5.4"
`);
    expect(models).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
  });

  it("parses visible models from models_cache and orders by priority", () => {
    const models = parseModelsCacheForTests(`{
      "models": [
        {"slug":"gpt-5.3-codex","visibility":"list","priority":2},
        {"slug":"gpt-5.4","visibility":"list","priority":0},
        {"slug":"gpt-5-codex-mini","visibility":"hide","priority":99}
      ]
    }`);
    expect(models).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
  });

  it("parses sandbox from [windows] section", () => {
    const sandbox = parseTomlSandboxForTests(`
[windows]
sandbox = "elevated"
`);
    expect(sandbox).toBe("danger-full-access");
  });

  it("parses root-level sandbox", () => {
    const sandbox = parseTomlSandboxForTests('sandbox = "workspace-write"');
    expect(sandbox).toBe("workspace-write");
  });

  it("normalizes known sandbox aliases", () => {
    expect(normalizeSandboxForTests("read_only")).toBe("read-only");
    expect(normalizeSandboxForTests("workspace")).toBe("workspace-write");
    expect(normalizeSandboxForTests("elevated")).toBe("danger-full-access");
  });
});

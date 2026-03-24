import { describe, expect, it } from "vitest";

import {
  parseModelsCacheForTests,
  parseTomlModelForTests,
  parseTomlModelListForTests,
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
});

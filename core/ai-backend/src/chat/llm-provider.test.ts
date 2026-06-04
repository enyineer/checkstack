import { describe, expect, test } from "bun:test";
import type { OpenAiCompatibleConnection } from "@checkstack/ai-common";
import { resolveModelId, buildLanguageModel } from "./llm-provider";

const conn = (over: Partial<OpenAiCompatibleConnection> = {}): OpenAiCompatibleConnection => ({
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-secret",
  defaultModel: "gpt-4o-mini",
  ...over,
});

describe("resolveModelId (§14.6 per-integration model UX)", () => {
  test("falls back to defaultModel when nothing requested", () => {
    expect(resolveModelId({ connection: conn(), requested: undefined })).toBe(
      "gpt-4o-mini",
    );
  });

  test("uses the requested model when no allowlist constrains it", () => {
    expect(resolveModelId({ connection: conn(), requested: "gpt-4o" })).toBe(
      "gpt-4o",
    );
  });

  test("honours a requested model that is in the allowlist", () => {
    const c = conn({ availableModels: ["gpt-4o-mini", "gpt-4o"] });
    expect(resolveModelId({ connection: c, requested: "gpt-4o" })).toBe("gpt-4o");
  });

  test("rejects a requested model outside a non-empty allowlist (untrusted input)", () => {
    const c = conn({ availableModels: ["gpt-4o-mini"] });
    // The model id arrives over the wire and is untrusted, so an out-of-list
    // value falls back to the default rather than being passed through.
    expect(resolveModelId({ connection: c, requested: "evil-model" })).toBe(
      "gpt-4o-mini",
    );
  });
});

describe("buildLanguageModel coerces the model in the live path (P4 review item 1)", () => {
  /** Read the resolved model id from the provider model the SDK returns. */
  const modelIdOf = (model: ReturnType<typeof buildLanguageModel>): string =>
    typeof model === "string" ? model : model.modelId;

  test("an out-of-allowlist model id is coerced to defaultModel, not passed through", () => {
    const c = conn({ availableModels: ["gpt-4o-mini"] });
    // This is the LIVE path the chat service uses; it must not honour an
    // arbitrary wire-supplied model id.
    const model = buildLanguageModel({ connection: c, model: "evil-model" });
    expect(modelIdOf(model)).toBe("gpt-4o-mini");
  });

  test("an allowlisted model id is honoured", () => {
    const c = conn({ availableModels: ["gpt-4o-mini", "gpt-4o"] });
    const model = buildLanguageModel({ connection: c, model: "gpt-4o" });
    expect(modelIdOf(model)).toBe("gpt-4o");
  });

  test("no requested model uses defaultModel", () => {
    const model = buildLanguageModel({ connection: conn(), model: undefined });
    expect(modelIdOf(model)).toBe("gpt-4o-mini");
  });
});

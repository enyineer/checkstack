import { describe, expect, test } from "bun:test";
import { coerceConversationModel } from "./router";
import type { ChatIntegrationLister } from "./router";

function lister(
  integrations: Array<{
    connectionId: string;
    name: string;
    defaultModel: string;
    availableModels?: string[];
  }>,
): ChatIntegrationLister {
  return { list: () => Promise.resolve(integrations) };
}

const conn = {
  connectionId: "ai.openai-compatible.c1",
  name: "OpenAI",
  defaultModel: "gpt-4o-mini",
  availableModels: ["gpt-4o-mini", "gpt-4o"],
};

describe("coerceConversationModel (P4 review item 1 — server-side model control)", () => {
  test("honours an allowlisted model", async () => {
    const model = await coerceConversationModel({
      integrations: lister([conn]),
      integrationId: conn.connectionId,
      model: "gpt-4o",
    });
    expect(model).toBe("gpt-4o");
  });

  test("coerces an out-of-allowlist model to defaultModel (untrusted wire input)", async () => {
    const model = await coerceConversationModel({
      integrations: lister([conn]),
      integrationId: conn.connectionId,
      model: "evil-model",
    });
    expect(model).toBe("gpt-4o-mini");
  });

  test("an empty allowlist allows any model (free-text providers)", async () => {
    const free = { ...conn, availableModels: undefined };
    const model = await coerceConversationModel({
      integrations: lister([free]),
      integrationId: free.connectionId,
      model: "llama3",
    });
    expect(model).toBe("llama3");
  });

  test("returns undefined when no model is requested", async () => {
    const model = await coerceConversationModel({
      integrations: lister([conn]),
      integrationId: conn.connectionId,
      model: undefined,
    });
    expect(model).toBeUndefined();
  });

  test("drops the model when the integration cannot be resolved (no validation possible)", async () => {
    const model = await coerceConversationModel({
      integrations: lister([conn]),
      integrationId: "unknown.connection",
      model: "gpt-4o",
    });
    expect(model).toBeUndefined();
  });

  test("drops the model when no integration id is given", async () => {
    const model = await coerceConversationModel({
      integrations: lister([conn]),
      integrationId: undefined,
      model: "gpt-4o",
    });
    expect(model).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import type { LanguageModel } from "ai";
import type { AiConversationStore } from "./conversation-store";
import {
  applyAutoTitle,
  generateConversationTitle,
  type TitleTextGenerator,
} from "./title-service";

/**
 * A stand-in model. The title logic only forwards it to the injected `generate`
 * fake (which ignores it), so a model id string (a valid `LanguageModel`) keeps
 * tests free of a verbose, version-coupled provider mock.
 */
const model: LanguageModel = "test-model";

/** A generate fake that always resolves to `text`. */
function generates(text: string): TitleTextGenerator {
  return async () => text;
}

/** A generate fake that always rejects (simulates a model error). */
const failsToGenerate: TitleTextGenerator = async () => {
  throw new Error("model unavailable");
};

/**
 * A minimal store stub that records updateConversation calls. applyAutoTitle
 * only ever calls updateConversation, so we implement just that method and stub
 * the rest as throwing (the repo's other store tests stub partially too).
 */
function storeStub() {
  const updates: Array<{ id: string; userId: string; title?: string }> = [];
  const notImplemented = () => {
    throw new Error("not implemented in stub");
  };
  const conversations: AiConversationStore = {
    updateConversation: async (args) => {
      updates.push({ id: args.id, userId: args.userId, title: args.title });
      return undefined;
    },
    createConversation: notImplemented,
    listConversations: notImplemented,
    getConversation: notImplemented,
    appendMessage: notImplemented,
    listMessages: notImplemented,
    archiveConversation: notImplemented,
    deleteConversation: notImplemented,
  };
  return { conversations, updates };
}

describe("generateConversationTitle", () => {
  test("sanitizes a quoted/markdown model reply", async () => {
    const title = await generateConversationTitle({
      model,
      firstMessage: "Summarize the open incidents please",
      generate: generates('"**Open incidents summary**"'),
    });
    expect(title).toBe("Open incidents summary");
  });

  test("falls back to the heuristic on a model error", async () => {
    const title = await generateConversationTitle({
      model,
      firstMessage: "  Summarize   the open incidents for me today and more  ",
      generate: failsToGenerate,
    });
    // First six words of the collapsed first message.
    expect(title).toBe("Summarize the open incidents for me");
  });

  test("falls back to the heuristic when the model returns nothing usable", async () => {
    const title = await generateConversationTitle({
      model,
      firstMessage: "Draft an automation",
      generate: generates("***"),
    });
    expect(title).toBe("Draft an automation");
  });
});

describe("applyAutoTitle", () => {
  test("persists the generated title for a titleless conversation", async () => {
    const { conversations, updates } = storeStub();
    await applyAutoTitle({
      conversations,
      model,
      conversationId: "c1",
      userId: "u1",
      firstMessage: "Summarize the open incidents",
      generate: generates("Open incidents summary"),
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      id: "c1",
      userId: "u1",
      title: "Open incidents summary",
    });
  });

  test("persists the heuristic title when the model errors", async () => {
    const { conversations, updates } = storeStub();
    await applyAutoTitle({
      conversations,
      model,
      conversationId: "c1",
      userId: "u1",
      firstMessage: "Draft an automation for on-call paging",
      generate: failsToGenerate,
    });
    expect(updates).toHaveLength(1);
    // "on-call" is a single word, so six words includes "paging".
    expect(updates[0]?.title).toBe("Draft an automation for on-call paging");
  });

  test("skips the persist when the title resolves empty", async () => {
    const { conversations, updates } = storeStub();
    await applyAutoTitle({
      conversations,
      model,
      conversationId: "c1",
      userId: "u1",
      firstMessage: "   ", // empty heuristic too
      generate: generates("***"),
    });
    expect(updates).toHaveLength(0);
  });

  test("never throws when the store update fails", async () => {
    const { conversations } = storeStub();
    conversations.updateConversation = async () => {
      throw new Error("db down");
    };
    await expect(
      applyAutoTitle({
        conversations,
        model,
        conversationId: "c1",
        userId: "u1",
        firstMessage: "hello",
        generate: generates("A title"),
      }),
    ).resolves.toBeUndefined();
  });
});

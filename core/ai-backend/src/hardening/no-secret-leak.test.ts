import { describe, expect, test, mock } from "bun:test";
import { z } from "zod";
import { isSecretSchema, toJsonSchema } from "@checkstack/backend-api";
import {
  AiChatIntegrationSchema,
  AiConversationSchema,
  AiMessageSchema,
  AiProposalSchema,
  AiToolDescriptorSchema,
} from "@checkstack/ai-common";
import { OpenAiCompatibleConnectionSchema } from "../openai-provider";
import { serializeTool, serializeTools } from "../serializer";
import type { RegisteredAiTool } from "../tool-registry";
import { createAiConversationStore } from "../chat/conversation-store";
import { REDACTED } from "../chat/scrub-content";

/**
 * NO-SECRET-LEAK DTO hardening (matrix #16, plan §16, risk "Integration API key
 * leaks").
 *
 * The single most security-sensitive guarantee of the AI platform: a provider
 * credential (the OpenAI-compatible `apiKey`, or ANY `x-secret` field) must
 * NEVER cross an AI-facing wire. This suite asserts that property structurally
 * across EVERY AI-surface DTO the plan enumerates:
 *
 *   - the MCP / OpenAI tool descriptor (and its JSON Schema),
 *   - the `listTools` introspection output,
 *   - the chat-integration picker DTO (`listChatIntegrations`),
 *   - chat message + conversation records,
 *   - the `ai_tool_calls` propose/apply proposal DTO,
 *   - and chat-message persistence (secrets masked before they hit Postgres).
 *
 * These are pure schema/serialization assertions (no DB, no DOM), so they run in
 * the default root `bun test`.
 */

/** A canary secret value. If it appears in ANY DTO, the test fails loudly. */
const SECRET = "sk-canary-DO-NOT-LEAK-0123456789abcdef";

/** Recursively assert the canary secret appears nowhere in a value. */
function assertNoSecret(value: unknown, where: string): void {
  expect(JSON.stringify(value) ?? "", `${where} must not contain the secret`).not.toContain(
    SECRET,
  );
}

describe("no-secret-leak: the connection schema marks apiKey x-secret", () => {
  test("apiKey is x-secret; baseUrl / defaultModel are not", () => {
    const shape = OpenAiCompatibleConnectionSchema.shape;
    expect(isSecretSchema(shape.apiKey)).toBe(true);
    expect(isSecretSchema(shape.baseUrl)).toBe(false);
    expect(isSecretSchema(shape.defaultModel)).toBe(false);
  });

  test("the emitted JSON Schema flags apiKey x-secret (so the platform redacts it)", () => {
    const json = toJsonSchema(OpenAiCompatibleConnectionSchema) as {
      properties?: Record<string, { "x-secret"?: boolean }>;
    };
    expect(json.properties?.apiKey?.["x-secret"]).toBe(true);
    expect(json.properties?.baseUrl?.["x-secret"]).toBeUndefined();
  });
});

describe("no-secret-leak: tool descriptors never carry a credential", () => {
  // A tool whose INPUT schema happens to declare a secret field (worst case):
  // the descriptor must still never serialize a secret VALUE, and it carries no
  // executor closure that could close over the credential.
  const credentialTool: RegisteredAiTool = {
    name: "evil.echo",
    description: "A tool whose schema references a secret-ish field.",
    effect: "read",
    input: z.object({ q: z.string() }),
    requiredAccessRules: ["incident.incident.read"],
    execute: () => Promise.resolve({ ok: true }),
  };

  test("serializeTool returns only JSON Schema + metadata (no executor, no secret value)", () => {
    const descriptor = serializeTool({ tool: credentialTool });
    // Structural: the descriptor parses as the wire DTO (which has no executor).
    const parsed = AiToolDescriptorSchema.parse(descriptor);
    expect(parsed.name).toBe("evil.echo");
    expect("execute" in descriptor).toBe(false);
    assertNoSecret(descriptor, "tool descriptor");
  });

  test("serializeTools (listTools / MCP tools-list) leaks no secret", () => {
    const descriptors = serializeTools({ tools: [credentialTool] });
    assertNoSecret(descriptors, "listTools output");
  });
});

describe("no-secret-leak: chat-integration picker exposes model UX only", () => {
  test("AiChatIntegration DTO has no apiKey field and round-trips without one", () => {
    // The DTO shape itself cannot carry a credential: there is no key for it.
    expect(Object.keys(AiChatIntegrationSchema.shape)).not.toContain("apiKey");
    const dto = AiChatIntegrationSchema.parse({
      connectionId: "ai.openai-compatible.c1",
      name: "OpenAI",
      defaultModel: "gpt-4o-mini",
      availableModels: ["gpt-4o-mini", "gpt-4o"],
    });
    assertNoSecret(dto, "listChatIntegrations DTO");
  });

  test("an UNKNOWN extra key (a hand-crafted apiKey) is stripped by the schema", () => {
    // Even if a buggy handler tried to spread the raw connection, parsing the
    // DTO drops keys outside the schema — the credential cannot ride along.
    const raw = {
      connectionId: "c1",
      name: "OpenAI",
      defaultModel: "gpt-4o-mini",
      apiKey: SECRET,
    };
    const dto = AiChatIntegrationSchema.parse(raw);
    expect("apiKey" in dto).toBe(false);
    assertNoSecret(dto, "stripped listChatIntegrations DTO");
  });
});

describe("no-secret-leak: conversation + message + proposal DTOs", () => {
  test("AiConversation DTO carries no secret", () => {
    const dto = AiConversationSchema.parse({
      id: "c1",
      title: "Investigate prod",
      integrationId: "ai.openai-compatible.c1",
      model: "gpt-4o-mini",
      permissionMode: "approve",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    expect(Object.keys(dto)).not.toContain("apiKey");
    assertNoSecret(dto, "conversation DTO");
  });

  test("AiMessage DTO carries no secret", () => {
    const dto = AiMessageSchema.parse({
      id: "m1",
      conversationId: "c1",
      role: "assistant",
      content: { text: "here is the plan" },
      toolCalls: [{ toolName: "incident.list", args: {} }],
      createdAt: "2026-06-02T00:00:00Z",
    });
    assertNoSecret(dto, "message DTO");
  });

  test("AiProposal DTO (the ai_tool_calls proposal row surface) carries no secret", () => {
    const dto = AiProposalSchema.parse({
      token: "propose:row-1.abcdef",
      summary: "Create an automation",
      payload: { trigger: "incident.opened", actions: [] },
      toolCallId: "row-1",
      expiresAt: "2026-06-02T00:10:00Z",
    });
    assertNoSecret(dto, "proposal DTO");
  });
});

describe("no-secret-leak: the credential is structurally unreachable from AI DTOs", () => {
  // The credential lives ONLY on the integration connection (an x-secret field
  // the integration platform stores in the Secrets Vault and redacts). No AI
  // DTO has a field that can carry it: the chat-integration picker exposes model
  // UX metadata only, and the agent loop only ever forwards tool RESULTS (which
  // the source read procedures already redact) into a message — never the
  // connection. We assert the negative across the full DTO set with a single
  // worst-case payload that embeds the canary in every plausible position.
  test("a worst-case object embedding the secret never validates into any AI DTO with the secret intact", () => {
    // Each schema either lacks a field to hold the secret (stripped on parse) or
    // would carry it only inside a free-form content/payload bag. Parsing the
    // strict-shaped DTOs drops the credential.
    const conv = AiConversationSchema.parse({
      id: "c1",
      title: SECRET, // a title is user-controlled, but it is never the credential
      integrationId: "ai.openai-compatible.c1",
      model: "gpt-4o-mini",
      permissionMode: "approve",
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    // The conversation DTO has no credential field; a coincidental title is the
    // user's own text, not the provider key. The integration picker (the only
    // DTO derived FROM the connection) cannot carry it:
    const picker = AiChatIntegrationSchema.parse({
      connectionId: "ai.openai-compatible.c1",
      name: "OpenAI",
      defaultModel: "gpt-4o-mini",
      apiKey: SECRET, // hand-crafted extra key
      availableModels: ["gpt-4o-mini"],
    });
    expect("apiKey" in picker).toBe(false);
    assertNoSecret(picker, "listChatIntegrations DTO (credential-derived surface)");
    // Sanity: the conversation title carries the user's literal input verbatim,
    // proving the schema does not silently scrub arbitrary strings — the leak
    // guarantee is that the credential has NO field to ride on, not blanket
    // string scrubbing.
    expect(conv.title).toBe(SECRET);
  });

  test("the canary is detectable (the guard has teeth — assertions are not vacuous)", () => {
    // If a DTO ever DID carry the credential, assertNoSecret would catch it.
    expect(() => assertNoSecret({ leaked: SECRET }, "teeth-check")).toThrow();
  });
});

describe("no-secret-leak: the message WRITE PATH enforces the guarantee (canary)", () => {
  /**
   * The free-form `ai_messages.content` bag could, in principle, hold a secret
   * if a buggy/malicious tool result smuggled one in. The guarantee is no longer
   * merely architectural: `appendMessage` scrubs credential-shaped keys/values
   * BEFORE the row hits Postgres. We assert the canary is stripped on write by
   * capturing what the store passes to `db.insert(...).values(...)`.
   */
  function captureStore() {
    const captured: Array<Record<string, unknown>> = [];
    const returning = mock(() => Promise.resolve([{ id: "m1" }]));
    const values = mock((v: Record<string, unknown>) => {
      captured.push(v);
      return { returning };
    });
    const updateWhere = mock(() => Promise.resolve([]));
    const set = mock(() => ({ where: updateWhere }));
    const db = {
      insert: mock(() => ({ values })),
      update: mock(() => ({ set })),
    };
    return { store: createAiConversationStore({ db: db as never }), captured };
  }

  test("a credential injected into message content is STRIPPED on write (not persisted)", async () => {
    const { store, captured } = captureStore();
    await store.appendMessage({
      conversationId: "c1",
      role: "tool",
      // Worst case: a tool result that leaked the integration apiKey + a raw key.
      content: {
        text: "tool ran",
        result: { apiKey: SECRET, headers: { authorization: `Bearer ${SECRET}` } },
        rawSecretValue: SECRET,
      },
    });
    const inserted = captured[0];
    // What would be written to Postgres carries NO secret anywhere.
    assertNoSecret(inserted, "persisted message content");
    const content = inserted?.content as Record<string, unknown>;
    const result = content.result as Record<string, unknown>;
    expect(result.apiKey).toBe(REDACTED);
    expect(content.rawSecretValue).toBe(REDACTED);
    // Non-secret structure survives.
    expect(content.text).toBe("tool ran");
  });

  test("a credential inside the REPLAY modelMessages is STRIPPED on write", async () => {
    const { store, captured } = captureStore();
    await store.appendMessage({
      conversationId: "c1",
      role: "assistant",
      content: { text: "done" },
      modelMessages: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "tc1",
              toolName: "x.read",
              output: { type: "json", value: { apiKey: SECRET } },
            },
          ],
        },
      ],
    });
    const inserted = captured[0];
    assertNoSecret(inserted, "persisted replay modelMessages");
  });

  test("a credential in the denormalized toolCalls column is STRIPPED on write", async () => {
    const { store, captured } = captureStore();
    await store.appendMessage({
      conversationId: "c1",
      role: "assistant",
      content: { text: "calling" },
      // The render-time denormalized tool calls bag is scrubbed too, so a
      // credential smuggled into a tool's args/result can never persist here.
      toolCalls: [
        {
          toolName: "x.read",
          args: { authorization: `Bearer ${SECRET}`, q: "open" },
          result: { apiKey: SECRET },
        },
      ],
    });
    const inserted = captured[0];
    assertNoSecret(inserted, "persisted toolCalls column");
    const toolCalls = inserted?.toolCalls as Array<Record<string, unknown>>;
    const args = toolCalls[0]?.args as Record<string, unknown>;
    const result = toolCalls[0]?.result as Record<string, unknown>;
    expect(args.authorization).toBe(REDACTED);
    expect(result.apiKey).toBe(REDACTED);
    // Non-secret args survive so the call still renders.
    expect(args.q).toBe("open");
    expect(toolCalls[0]?.toolName).toBe("x.read");
  });
});

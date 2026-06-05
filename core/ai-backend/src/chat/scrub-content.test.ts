import { describe, expect, test } from "bun:test";
import {
  REDACTED,
  scrubContent,
  scrubModelMessages,
} from "./scrub-content";

/**
 * NO-SECRET-LEAK content scrubbing (Phase 6) — the canary regression suite.
 *
 * The architectural guarantee "a credential can NEVER be persisted into
 * `ai_messages.content`" is now an ENFORCED invariant: `scrubContent` runs on the
 * message write path. These tests inject credential-shaped keys/values and assert
 * they are stripped, while proving the scrub does NOT blanket-redact innocent
 * user prose (the guarantee is "a credential cannot ride along", not "no string
 * is ever touched").
 */

const SECRET = "sk-canary-DO-NOT-LEAK-0123456789abcdef";

function assertNoSecret(value: unknown, where: string): void {
  expect(
    JSON.stringify(value) ?? "",
    `${where} must not contain the secret`,
  ).not.toContain(SECRET);
}

describe("scrubContent: credential-shaped KEYS are redacted", () => {
  test("apiKey at top level is stripped", () => {
    const out = scrubContent({ text: "hi", apiKey: SECRET });
    expect(out.apiKey).toBe(REDACTED);
    expect(out.text).toBe("hi");
    assertNoSecret(out, "scrubbed content");
  });

  test("nested secret keys (api_key, authorization, password, x-secret) are stripped", () => {
    const out = scrubContent({
      result: {
        headers: { authorization: `Bearer ${SECRET}` },
        config: { api_key: SECRET, password: SECRET, "x-secret": SECRET },
      },
    });
    const result = out.result as Record<string, unknown>;
    const headers = result.headers as Record<string, unknown>;
    const config = result.config as Record<string, unknown>;
    expect(headers.authorization).toBe(REDACTED);
    expect(config.api_key).toBe(REDACTED);
    expect(config.password).toBe(REDACTED);
    expect(config["x-secret"]).toBe(REDACTED);
    assertNoSecret(out, "deeply nested scrubbed content");
  });

  test("secret keys inside arrays are stripped", () => {
    const out = scrubContent({
      items: [{ name: "a", clientSecret: SECRET }, { name: "b" }],
    });
    const items = out.items as Array<Record<string, unknown>>;
    expect(items[0]?.clientSecret).toBe(REDACTED);
    expect(items[0]?.name).toBe("a");
    expect(items[1]?.name).toBe("b");
    assertNoSecret(out, "array scrubbed content");
  });
});

describe("scrubContent: credential-shaped VALUES are redacted regardless of key", () => {
  test("an sk-... value under an innocent key is still stripped", () => {
    // Worst case: a buggy tool result puts the key under a harmless field name.
    const out = scrubContent({ note: SECRET, freeform: { blob: SECRET } });
    expect(out.note).toBe(REDACTED);
    expect((out.freeform as Record<string, unknown>).blob).toBe(REDACTED);
    assertNoSecret(out, "value-pattern scrubbed content");
  });

  test("a Bearer token value is stripped", () => {
    const out = scrubContent({
      msg: "use Bearer abcdef1234567890ABCDEF for auth",
    });
    expect(out.msg).toBe(REDACTED);
    assertNoSecret(out, "bearer-value scrubbed content");
  });
});

describe("scrubContent: innocent prose is preserved (no blanket scrubbing)", () => {
  test("ordinary chat text mentioning 'token' or 'password' is NOT redacted", () => {
    const out = scrubContent({
      text: "I forgot my password, can you reset the auth token flow?",
    });
    expect(out.text).toBe(
      "I forgot my password, can you reset the auth token flow?",
    );
  });

  test("a normal incident title and numbers survive untouched", () => {
    const out = scrubContent({
      text: "deploy at 14:02 caused 500s on /api/checkout",
      count: 42,
      ok: true,
    });
    expect(out.text).toBe("deploy at 14:02 caused 500s on /api/checkout");
    expect(out.count).toBe(42);
    expect(out.ok).toBe(true);
  });

  test("a token-shaped slug embedded in a URL path is PRESERVED (no over-redaction)", () => {
    // The `sk-...` shape appears inside a longer URL path segment, NOT as a
    // standalone credential. It must survive — the value pattern only fires on a
    // standalone/boundary-delimited token.
    const url = "https://host/api/sk-checkout-flow-12345678/status";
    const out = scrubContent({ link: url, text: `see ${url} for details` });
    expect(out.link).toBe(url);
    expect(out.text).toBe(`see ${url} for details`);
  });

  test("a standalone sk-... value is STILL redacted (even after tightening the boundary)", () => {
    // Whole-value, whitespace-delimited, and quote-delimited standalone tokens.
    expect(scrubContent({ v: SECRET }).v).toBe(REDACTED);
    expect(scrubContent({ v: `key is ${SECRET} ok` }).v).toBe(REDACTED);
    expect(scrubContent({ v: `"${SECRET}"` }).v).toBe(REDACTED);
  });
});

describe("scrubModelMessages: replay history is scrubbed too", () => {
  test("a tool-result part carrying a credential is redacted before persist", () => {
    // The canonical AI-SDK ResponseMessage[] shape (a tool message with a
    // tool-result part). A credential smuggled into the output must not persist.
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling tool" },
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "incident.list",
            input: { status: "open" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "incident.list",
            output: {
              type: "json",
              value: { rows: [{ id: 1 }], apiKey: SECRET, leaked: SECRET },
            },
          },
        ],
      },
    ];
    const scrubbed = scrubModelMessages(messages);
    assertNoSecret(scrubbed, "scrubbed replay messages");
    // The non-secret structure survives so replay still works.
    const toolMsg = scrubbed[1];
    const part = (toolMsg.content as Array<Record<string, unknown>>)[0];
    const value = (part.output as Record<string, unknown>).value as Record<
      string,
      unknown
    >;
    expect(value.apiKey).toBe(REDACTED);
    expect(value.leaked).toBe(REDACTED);
    expect(value.rows).toEqual([{ id: 1 }]);
  });
});

describe("scrubContent: the guard has teeth (idempotent + cycle-safe)", () => {
  test("re-scrubbing already-redacted content is a no-op", () => {
    const once = scrubContent({ apiKey: SECRET, text: "hi" });
    const twice = scrubContent(once);
    expect(twice).toEqual(once);
  });

  test("a cyclic object does not hang and is redacted at the cycle", () => {
    const cyclic: Record<string, unknown> = { text: "hi" };
    cyclic.self = cyclic;
    const out = scrubContent(cyclic);
    expect(out.text).toBe("hi");
    expect(out.self).toBe(REDACTED);
  });
});

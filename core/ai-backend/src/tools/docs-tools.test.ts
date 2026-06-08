import { describe, expect, test } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import {
  SearchDocsOutputSchema,
  GetDocOutputSchema,
  ListDocsOutputSchema,
} from "@checkstack/ai-common";
import type { DocsIndexEntry } from "../generated/docs-index";
import { createAiToolRegistry } from "../tool-registry";
import { createAiToolResolver } from "../resolver";
import { createRegistryExtensionPoints } from "../registry-wiring";
import { pluginMetadata as aiPluginMetadata } from "@checkstack/ai-common";
import {
  createDocsTools,
  createGetDocTool,
  createListDocsTool,
  createSearchDocsTool,
} from "./docs-tools";

const FIXTURE_INDEX: DocsIndexEntry[] = [
  {
    slug: "user-guide/concepts/health-checks",
    title: "Health checks",
    description: "How health checks work",
    headings: ["Strategies", "Collectors"],
    content: "A health check probes a target on a schedule.",
    truncated: false,
  },
  {
    slug: "developer-guide/ai/context-tools",
    title: "Assistant context tools",
    headings: ["searchDocs", "getDoc"],
    content: "The assistant can search and read the docs.",
    truncated: true,
  },
];

/** A user with exactly the given access rules. */
function userWith(accessRules: string[]): AuthUser {
  return { type: "user", id: "u1", accessRules };
}

const PRINCIPAL = userWith(["ai.chat.read"]);

// The docs tools read the bundled docs index, never the RPC client, so a
// never-called stub satisfies the user-scoped `rpcClient` arg of `execute`.
const rpcClient = {
  forPlugin: () => {
    throw new Error("docs tools must not call the RPC client");
  },
} as unknown as RpcClient;

describe("ai.searchDocs tool", () => {
  test("returns DocHit[] validating the wire schema", async () => {
    const tool = createSearchDocsTool({ index: FIXTURE_INDEX });
    const out = await tool.execute({
      input: { query: "health check", limit: 5 },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(() => SearchDocsOutputSchema.parse(out)).not.toThrow();
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits[0]?.slug).toBe("user-guide/concepts/health-checks");
    // A strong match steers the model to read, not to keep searching.
    expect(out.note).toMatch(/getDoc/);
  });

  test("weak matches carry a note steering off the re-search loop", async () => {
    const tool = createSearchDocsTool({ index: FIXTURE_INDEX });
    // "probes" appears only once in body text -> a low BM25 score (weak match).
    const out = await tool.execute({
      input: { query: "probes", limit: 5 },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.note).toMatch(/weak matches/i);
    expect(out.note).toMatch(/listDocs/);
  });

  test("no match tells the model to stop searching, not reword", async () => {
    const tool = createSearchDocsTool({ index: FIXTURE_INDEX });
    const out = await tool.execute({
      input: { query: "kubernetes helm chart", limit: 5 },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(out.hits).toEqual([]);
    expect(out.note).toMatch(/do not cover this/i);
    expect(out.note).toMatch(/listDocs/);
  });

  test("honours the limit cap", async () => {
    const tool = createSearchDocsTool({ index: FIXTURE_INDEX });
    const out = await tool.execute({
      input: { query: "docs the assistant health", limit: 1 },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(out.hits.length).toBe(1);
  });

  test("is effect:read and gated by ai.chat.read", () => {
    const tool = createSearchDocsTool();
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["ai.chat.read"]);
    expect(tool.dryRun).toBeUndefined();
  });
});

describe("ai.getDoc tool", () => {
  test("returns a known slug's content + truncated flag (schema-valid)", async () => {
    const tool = createGetDocTool({ index: FIXTURE_INDEX });
    const out = await tool.execute({
      input: { slug: "developer-guide/ai/context-tools" },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(() => GetDocOutputSchema.parse(out)).not.toThrow();
    expect(out.title).toBe("Assistant context tools");
    expect(out.truncated).toBe(true);
    expect(out.content).toContain("search and read the docs");
  });

  test("an unknown slug throws a clear, recoverable error", async () => {
    const tool = createGetDocTool({ index: FIXTURE_INDEX });
    await expect(
      tool.execute({ input: { slug: "does/not/exist" }, principal: PRINCIPAL, rpcClient }),
    ).rejects.toThrow(/searchDocs/);
  });

  test("a guessed slug suggests the closest real page(s)", async () => {
    const tool = createGetDocTool({ index: FIXTURE_INDEX });
    // Mirrors the production case: the model constructed a plausible-but-fake
    // slug from the topic. The error should point at the closest real page so
    // it recovers in one step instead of guessing again.
    await expect(
      tool.execute({
        input: { slug: "user-guide/concepts/health" },
        principal: PRINCIPAL,
        rpcClient,
      }),
    ).rejects.toThrow(/Did you mean.*user-guide\/concepts\/health-checks/);
  });

  test("is effect:read and gated by ai.chat.read", () => {
    const tool = createGetDocTool();
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["ai.chat.read"]);
  });
});

describe("ai.listDocs tool", () => {
  test("returns the full sitemap (slug/title/description) + sections, schema-valid", async () => {
    const tool = createListDocsTool({ index: FIXTURE_INDEX });
    const out = await tool.execute({ input: {}, principal: PRINCIPAL, rpcClient });
    expect(() => ListDocsOutputSchema.parse(out)).not.toThrow();
    expect(out.pages.map((p) => p.slug).sort()).toEqual([
      "developer-guide/ai/context-tools",
      "user-guide/concepts/health-checks",
    ]);
    expect(out.sections.sort()).toEqual(["developer-guide", "user-guide"]);
    // A page without a description omits the field rather than emitting empty.
    const ctx = out.pages.find((p) => p.slug === "developer-guide/ai/context-tools");
    expect(ctx?.description).toBeUndefined();
  });

  test("filters to a single section", async () => {
    const tool = createListDocsTool({ index: FIXTURE_INDEX });
    const out = await tool.execute({
      input: { section: "user-guide" },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(out.pages.map((p) => p.slug)).toEqual([
      "user-guide/concepts/health-checks",
    ]);
  });

  test("an unknown section returns no pages and lists the valid ones", async () => {
    const tool = createListDocsTool({ index: FIXTURE_INDEX });
    const out = await tool.execute({
      input: { section: "nope" },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(out.pages).toEqual([]);
    expect(out.note).toMatch(/user-guide/);
    expect(out.note).toMatch(/developer-guide/);
  });

  test("is effect:read and gated by ai.chat.read", () => {
    const tool = createListDocsTool();
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["ai.chat.read"]);
    expect(tool.dryRun).toBeUndefined();
  });
});

describe("docs tools registration + resolution", () => {
  test("both qualify to ai.* and a chat user sees them", () => {
    const registry = createAiToolRegistry();
    const { toolExtensionPoint } = createRegistryExtensionPoints({ registry });
    for (const tool of createDocsTools({ index: FIXTURE_INDEX })) {
      toolExtensionPoint.registerTool(tool, aiPluginMetadata);
    }
    const resolver = createAiToolResolver({ registry });

    const names = resolver
      .resolveTools(userWith(["ai.chat.read"]))
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(["ai_getDoc", "ai_listDocs", "ai_searchDocs"]);
  });

  test("a principal without ai.chat.read sees neither docs tool", () => {
    const registry = createAiToolRegistry();
    const { toolExtensionPoint } = createRegistryExtensionPoints({ registry });
    for (const tool of createDocsTools({ index: FIXTURE_INDEX })) {
      toolExtensionPoint.registerTool(tool, aiPluginMetadata);
    }
    const resolver = createAiToolResolver({ registry });

    const names = resolver
      .resolveTools(userWith(["incident.incident.read"]))
      .map((t) => t.name);
    expect(names).toEqual([]);
  });

  test("the bundled production index powers searchDocs (smoke test)", async () => {
    // Uses the real DOCS_INDEX default; the AI docs page must be findable.
    const tool = createSearchDocsTool();
    const out = await tool.execute({
      input: { query: "AI assistant documentation tools", limit: 10 },
      principal: PRINCIPAL,
      rpcClient,
    });
    expect(out.hits.length).toBeGreaterThan(0);
  });
});

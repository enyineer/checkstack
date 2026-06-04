import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  DOCS_CONTENT_MAX_BYTES,
  buildDocsIndex,
  buildEntry,
  capBytes,
  deriveSlug,
  extractHeadings,
  hashIndex,
  listDocFiles,
  parseFrontmatter,
  renderDocsIndexModule,
  stripMdx,
  type DocsIndexEntry,
} from "./generate-docs-index";

const ROOT = path.join(import.meta.dirname, "..");

/** Builds a throwaway docs tree and returns its root; caller cleans up. */
function makeDocsTree(files: Record<string, string>): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "docs-index-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("deriveSlug", () => {
  test("drops the extension", () => {
    expect(deriveSlug("user-guide/concepts/health-checks.md")).toBe(
      "user-guide/concepts/health-checks",
    );
    expect(deriveSlug("a/b.mdx")).toBe("a/b");
  });

  test("index.md(x) maps to its directory slug", () => {
    expect(deriveSlug("user-guide/index.md")).toBe("user-guide");
    expect(deriveSlug("developer-guide/ai/index.mdx")).toBe(
      "developer-guide/ai",
    );
  });

  test("root index maps to the empty slug", () => {
    expect(deriveSlug("index.md")).toBe("");
    expect(deriveSlug("index.mdx")).toBe("");
  });
});

describe("parseFrontmatter", () => {
  test("reads quoted + bare title and description, strips the block", () => {
    const raw = '---\ntitle: "Hello world"\ndescription: A short one\n---\nBody.\n';
    const parsed = parseFrontmatter(raw);
    expect(parsed.title).toBe("Hello world");
    expect(parsed.description).toBe("A short one");
    expect(parsed.body).toBe("Body.\n");
  });

  test("single-quoted values are unquoted", () => {
    const raw = "---\ntitle: 'Quoted'\n---\nx\n";
    expect(parseFrontmatter(raw).title).toBe("Quoted");
  });

  test("a doc without frontmatter yields the whole body", () => {
    const parsed = parseFrontmatter("# No frontmatter\n");
    expect(parsed.title).toBeUndefined();
    expect(parsed.body).toBe("# No frontmatter\n");
  });

  test("CRLF is normalized before parsing", () => {
    const raw = "---\r\ntitle: CRLF\r\n---\r\nBody\r\n";
    const parsed = parseFrontmatter(raw);
    expect(parsed.title).toBe("CRLF");
    expect(parsed.body).toBe("Body\n");
  });
});

describe("stripMdx", () => {
  test("drops ESM import/export lines", () => {
    const body =
      'import { CardGrid } from "@astrojs/starlight/components";\n\nReal prose.\n';
    expect(stripMdx(body)).toBe("Real prose.");
  });

  test("drops single-line and multi-line JSX component tags", () => {
    const body = [
      "<CardGrid>",
      "  <LinkCard",
      '    title="Install"',
      '    href="/x/"',
      "  />",
      "</CardGrid>",
      "",
      "Kept prose.",
    ].join("\n");
    const out = stripMdx(body);
    expect(out).toContain("Kept prose.");
    expect(out).not.toContain("LinkCard");
    expect(out).not.toContain("CardGrid");
    expect(out).not.toContain("title=");
  });

  test("code fences are preserved verbatim", () => {
    const body = "Intro.\n\n```ts\nconst x = 1;\n```\n";
    const out = stripMdx(body);
    expect(out).toContain("```ts");
    expect(out).toContain("const x = 1;");
  });
});

describe("extractHeadings", () => {
  test("extracts h2..h6, ignores h1 and fenced content", () => {
    const body = [
      "# Title",
      "## Section one",
      "```",
      "## not a heading (in fence)",
      "```",
      "### Sub section",
    ].join("\n");
    expect(extractHeadings(body)).toEqual(["Section one", "Sub section"]);
  });
});

describe("capBytes", () => {
  test("returns the input unchanged when under budget", () => {
    const { text, truncated } = capBytes("short", 100);
    expect(text).toBe("short");
    expect(truncated).toBe(false);
  });

  test("truncates over-budget content and flags it", () => {
    const long = "a".repeat(200);
    const { text, truncated } = capBytes(long, 50);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(50);
  });

  test("never splits a multi-byte codepoint", () => {
    // "é" is 2 bytes in UTF-8; cap right at a boundary that would split it.
    const text = "é".repeat(40); // 80 bytes
    const { text: capped } = capBytes(text, 51); // odd boundary
    // The capped string must be valid UTF-8 (no replacement char from a split).
    expect(capped).not.toContain("�");
    expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(51);
  });
});

describe("buildEntry", () => {
  test("derives slug, title, headings, content; flags non-truncation", () => {
    const raw =
      "---\ntitle: Health checks\ndescription: How checks work\n---\n" +
      "## Overview\n\nA health check probes a target.\n";
    const entry = buildEntry({ rel: "user-guide/health.md", raw });
    expect(entry.slug).toBe("user-guide/health");
    expect(entry.title).toBe("Health checks");
    expect(entry.description).toBe("How checks work");
    expect(entry.headings).toEqual(["Overview"]);
    expect(entry.content).toContain("A health check probes a target.");
    expect(entry.truncated).toBe(false);
  });

  test("falls back to the first H1, then the slug, for the title", () => {
    const h1 = buildEntry({ rel: "a/b.md", raw: "# From H1\n\nx\n" });
    expect(h1.title).toBe("From H1");
    const noTitle = buildEntry({ rel: "a/b.md", raw: "Just prose.\n" });
    expect(noTitle.title).toBe("a/b");
  });

  test("over-budget content is truncated and flagged", () => {
    const big = "x ".repeat(DOCS_CONTENT_MAX_BYTES); // well over budget
    const entry = buildEntry({
      rel: "big.md",
      raw: `---\ntitle: Big\n---\n${big}`,
    });
    expect(entry.truncated).toBe(true);
    expect(Buffer.byteLength(entry.content, "utf8")).toBeLessThanOrEqual(
      DOCS_CONTENT_MAX_BYTES,
    );
  });
});

describe("buildDocsIndex (fixture tree)", () => {
  test("walks md/mdx, sorts by slug, parses each page", () => {
    const { root, cleanup } = makeDocsTree({
      "index.mdx": "---\ntitle: Home\n---\nWelcome.\n",
      "user-guide/index.md": "---\ntitle: Guide\n---\nGuide intro.\n",
      "user-guide/a.md": "---\ntitle: A\n---\n## H\nbody a\n",
      "ignored.txt": "not markdown",
    });
    try {
      const index = buildDocsIndex(root);
      expect(index.map((e) => e.slug)).toEqual(["", "user-guide", "user-guide/a"]);
      expect(index[0]?.title).toBe("Home");
      expect(index[2]?.headings).toEqual(["H"]);
    } finally {
      cleanup();
    }
  });

  test("is deterministic: two runs are byte-identical", () => {
    const files = {
      "b.md": "---\ntitle: B\n---\n## Two\nbeta\n",
      "a.md": "---\ntitle: A\n---\n## One\nalpha\n",
    };
    const t1 = makeDocsTree(files);
    const t2 = makeDocsTree(files);
    try {
      expect(renderDocsIndexModule(buildDocsIndex(t1.root))).toBe(
        renderDocsIndexModule(buildDocsIndex(t2.root)),
      );
    } finally {
      t1.cleanup();
      t2.cleanup();
    }
  });
});

describe("hashIndex", () => {
  test("changes when any indexed field changes", () => {
    const base: DocsIndexEntry[] = [
      {
        slug: "a",
        title: "A",
        headings: ["H"],
        content: "body",
        truncated: false,
      },
    ];
    const same: DocsIndexEntry[] = [{ ...base[0]! }];
    const changed: DocsIndexEntry[] = [{ ...base[0]!, content: "body!" }];
    expect(hashIndex(base)).toBe(hashIndex(same));
    expect(hashIndex(base)).not.toBe(hashIndex(changed));
  });
});

describe("listDocFiles", () => {
  test("returns [] for a missing directory", () => {
    expect(listDocFiles(path.join(tmpdir(), "nope-zzz-docs"))).toEqual([]);
  });
});

describe("generate-docs-index --check drift guard", () => {
  function runCheck() {
    return spawnSync(
      "bun",
      ["run", path.join("scripts", "generate-docs-index.ts"), "--check"],
      { cwd: ROOT, encoding: "utf8" },
    );
  }

  test("--check passes on a clean tree (committed index matches a fresh run)", () => {
    expect(runCheck().status).toBe(0);
  });

  test("--check exits nonzero when the committed index is mutated", () => {
    const target = path.join(
      ROOT,
      "core",
      "ai-backend",
      "src",
      "generated",
      "docs-index.ts",
    );
    const before = readFileSync(target, "utf8");
    try {
      writeFileSync(target, before + "\n// drift\n", "utf8");
      const result = runCheck();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("out of sync");
    } finally {
      writeFileSync(target, before, "utf8");
    }
    // Tree restored → clean again.
    expect(runCheck().status).toBe(0);
  });
});

import { describe, it, expect } from "bun:test";
import {
  maskLine,
  maskAndTokenize,
  maskAndTokenizeAnnotated,
  WILDCARD,
  MAX_TOKENS,
} from "./masking";

const W = WILDCARD;

describe("maskLine", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    { name: "plain integer", input: "took 42 ms", expected: `took ${W} ms` },
    { name: "decimal", input: "latency 3.14s", expected: `latency ${W}s` },
    {
      name: "dotted version",
      input: "started v1.2.3 ok",
      expected: `started v${W} ok`,
    },
    {
      name: "key=number",
      input: "retries=5 done",
      expected: `retries=${W} done`,
    },
    {
      name: "hex with digit",
      input: "id 0xDEADBEEF and a1b2c3d4",
      expected: `id ${W} and ${W}`,
    },
    {
      name: "all-letter hex kept (no digit)",
      input: "the cafe was nice",
      expected: "the cafe was nice",
    },
    {
      name: "uuid",
      input: "req 550e8400-e29b-41d4-a716-446655440000 start",
      expected: `req ${W} start`,
    },
    {
      name: "ipv4",
      input: "from 192.168.0.1 ok",
      expected: `from ${W} ok`,
    },
    {
      name: "ipv4 with port",
      input: "peer 10.0.0.5:8080 connected",
      expected: `peer ${W} connected`,
    },
    {
      name: "ipv6",
      input: "addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334 up",
      expected: `addr ${W} up`,
    },
    {
      name: "ipv6 compressed",
      input: "addr ::1 loopback",
      expected: `addr ${W} loopback`,
    },
    {
      name: "iso timestamp T",
      input: "2026-07-12T10:00:00.123Z started",
      expected: `${W} started`,
    },
    {
      name: "iso timestamp space",
      input: "2026-07-12 10:00:00 started",
      expected: `${W} started`,
    },
    {
      name: "quoted string",
      input: 'user said "hello world 42"',
      expected: `user said ${W}`,
    },
    {
      name: "single quoted",
      input: "path is 'a b c'",
      expected: `path is ${W}`,
    },
    {
      name: "email",
      input: "notify alice.smith@example.com now",
      expected: `notify ${W} now`,
    },
    {
      name: "url",
      input: "GET https://api.example.com/v2/users?id=5 200",
      expected: `GET ${W} ${W}`,
    },
    {
      name: "multiple mixed on one line",
      input: "2026-07-12T10:00:00Z ERROR 192.168.0.1 code=500 retries=3",
      expected: `${W} ERROR ${W} code=${W} retries=${W}`,
    },
    {
      name: "no maskables",
      input: "connection established successfully",
      expected: "connection established successfully",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(maskLine({ body: c.input })).toBe(c.expected);
    });
  }
});

describe("maskLine secret rule", () => {
  // A leaked secret must collapse to a single wildcard so it never survives
  // into a pattern's sampleBody.
  const secrets: Array<{ name: string; input: string; expected: string }> = [
    {
      name: "JWT",
      input:
        "auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N ok",
      expected: `auth ${W} ok`,
    },
    {
      // Deliberately a short, obviously-fake token body: it still matches the
      // masker's `sk_live_[A-Za-z0-9]{8,}` rule (so redaction is exercised) but
      // is well under the length real secret scanners flag, so this fixture is
      // never mistaken for a live key.
      name: "stripe live key",
      input: "using sk_live_FAKEKEYFORTESTS now",
      expected: `using ${W} now`,
    },
    {
      name: "openai project key",
      input: "key sk-proj-abcDEF123456ghijKLMno789 set",
      expected: `key ${W} set`,
    },
    {
      name: "anthropic key",
      input: "key sk-ant-api03-abcDEF123456ghijKLMno set",
      expected: `key ${W} set`,
    },
    {
      name: "github PAT",
      input: "token ghp_16C7e42F292c6912E7710c838347Ae178B4a here",
      expected: `token ${W} here`,
    },
    {
      name: "slack token",
      input: "slack xoxb-1234567890-abcdefghijkl posted",
      expected: `slack ${W} posted`,
    },
    {
      name: "aws access key id",
      input: "creds AKIAIOSFODNN7EXAMPLE loaded",
      expected: `creds ${W} loaded`,
    },
    {
      name: "checkstack ingest token",
      input: "auth ckls_s1_AbCdEfGhIjKlMnOpQrStUvWxYz here",
      expected: `auth ${W} here`,
    },
  ];

  for (const c of secrets) {
    it(`masks ${c.name}`, () => {
      expect(maskLine({ body: c.input })).toBe(c.expected);
    });
  }

  // Conservatism: ordinary words that merely start with a prefix letter-run,
  // or contain a prefix substring, must NOT be masked (mirrors the hex rule's
  // required-digit guard so real logs stay legible).
  const kept: Array<{ name: string; input: string }> = [
    { name: "hyphenated word starting sk", input: "sk-manager restarted" },
    { name: "word containing sk", input: "asking the operator to retry" },
    { name: "public key prose", input: "the public key was rotated" },
    { name: "plain identifier", input: "task-runner-v ok" },
    { name: "short eyJ-like word", input: "eyJ short not a jwt" },
  ];

  for (const c of kept) {
    it(`keeps ${c.name}`, () => {
      expect(maskLine({ body: c.input })).toBe(c.input);
    });
  }
});

describe("maskAndTokenize", () => {
  it("splits on whitespace and drops empties", () => {
    expect(maskAndTokenize({ body: "  a   42  b " })).toEqual(["a", W, "b"]);
  });

  it("returns empty array for a blank line", () => {
    expect(maskAndTokenize({ body: "   " })).toEqual([]);
  });

  it("caps token count at MAX_TOKENS", () => {
    const body = Array.from({ length: MAX_TOKENS + 50 }, () => "x").join(" ");
    expect(maskAndTokenize({ body })).toHaveLength(MAX_TOKENS);
  });
});

describe("maskAndTokenizeAnnotated", () => {
  // The annotated tokens MUST reproduce the canonical maskAndTokenize output,
  // because their indices line up with a matched template's `<*>` positions and
  // the canonical output is what pins persisted pattern ids. This corpus mixes
  // every mask class, whitespace-collapsing spans (quoted / space-separated
  // timestamps), substring masks (key=42), and adjacency edge cases.
  const corpus: string[] = [
    "",
    "   ",
    "connection established successfully",
    "took 42 ms",
    "latency 3.14s",
    "started v1.2.3 ok",
    "retries=5 done",
    "id 0xDEADBEEF and a1b2c3d4",
    "the cafe was nice",
    "req 550e8400-e29b-41d4-a716-446655440000 start",
    "from 192.168.0.1 ok",
    "peer 10.0.0.5:8080 connected",
    "addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334 up",
    "addr ::1 loopback",
    "2026-07-12T10:00:00.123Z started",
    "2026-07-12 10:00:00 started",
    'user said "hello world 42"',
    "path is 'a b c'",
    "notify alice.smith@example.com now",
    "GET https://api.example.com/v2/users?id=5 200",
    "2026-07-12T10:00:00Z ERROR 192.168.0.1 code=500 retries=3",
    'ts 2026-07-12 10:00:00 msg "a b c" code=5',
    "leading  spaces   between    tokens 9",
    "trailing spaces 7   ",
    "\ttab\tseparated\t42\t",
    "mixed\nnewline 3 and space 4",
    "key=42next", // masked span adjacent to a literal with no whitespace
    'auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N ok',
  ];

  for (const body of corpus) {
    it(`tokens match maskAndTokenize for ${JSON.stringify(body)}`, () => {
      expect(maskAndTokenizeAnnotated({ body }).tokens).toEqual(
        maskAndTokenize({ body }),
      );
    });
  }

  it("aligns raw values 1:1 with the tokens", () => {
    for (const body of corpus) {
      const { tokens, raw } = maskAndTokenizeAnnotated({ body });
      expect(raw).toHaveLength(tokens.length);
    }
  });

  it("recovers the raw number behind a masked numeric token", () => {
    const { tokens, raw } = maskAndTokenizeAnnotated({ body: "took 42 ms" });
    expect(tokens).toEqual(["took", W, "ms"]);
    expect(raw).toEqual(["took", "42", "ms"]);
  });

  it("recovers a decimal raw value", () => {
    const { tokens, raw } = maskAndTokenizeAnnotated({
      body: "latency 3.14 seconds",
    });
    expect(tokens).toEqual(["latency", W, "seconds"]);
    expect(raw[1]).toBe("3.14");
  });

  it("keeps a whitespace-collapsing span (quoted string) as one raw value", () => {
    const { tokens, raw } = maskAndTokenizeAnnotated({
      body: 'user said "hello world 42"',
    });
    expect(tokens).toEqual(["user", "said", W]);
    expect(raw[2]).toBe('"hello world 42"');
  });

  it("keeps a space-separated timestamp as one raw value", () => {
    const { tokens, raw } = maskAndTokenizeAnnotated({
      body: "2026-07-12 10:00:00 started",
    });
    expect(tokens).toEqual([W, "started"]);
    expect(raw[0]).toBe("2026-07-12 10:00:00");
  });

  it("carries the whole substring (affix + raw) for a substring mask", () => {
    const { tokens, raw } = maskAndTokenizeAnnotated({ body: "retries=5 done" });
    expect(tokens).toEqual(["retries=<*>", "done"]);
    expect(raw).toEqual(["retries=5", "done"]);
  });

  it("returns an untouched literal as its own raw value", () => {
    const { tokens, raw } = maskAndTokenizeAnnotated({ body: "boot complete" });
    expect(tokens).toEqual(["boot", "complete"]);
    expect(raw).toEqual(["boot", "complete"]);
  });

  it("caps both tokens and raw at MAX_TOKENS together", () => {
    const body = Array.from({ length: MAX_TOKENS + 50 }, (_, i) => `n${i}`).join(
      " ",
    );
    const { tokens, raw } = maskAndTokenizeAnnotated({ body });
    expect(tokens).toHaveLength(MAX_TOKENS);
    expect(raw).toHaveLength(MAX_TOKENS);
  });
});

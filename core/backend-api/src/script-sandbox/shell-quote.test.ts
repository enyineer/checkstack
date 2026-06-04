import { describe, expect, it } from "bun:test";
import { shellQuote } from "./shell-quote";

describe("shellQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("/tmp/x.nft")).toBe("'/tmp/x.nft'");
  });

  it("escapes embedded single quotes via the '\\'' idiom", () => {
    // O'Brien -> 'O'\''Brien'
    expect(shellQuote("O'Brien")).toBe(`'O'\\''Brien'`);
  });

  it("neutralizes shell metacharacters (spaces, ;, $, backticks)", () => {
    const quoted = shellQuote("a b; rm -rf / $(whoami) `id`");
    // Everything is inside one single-quoted span, so nothing expands.
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    expect(quoted).toContain("rm -rf / $(whoami)");
  });

  it("is idempotently round-trippable through sh", async () => {
    const value = "weird 'value' with $pace; and `ticks`";
    const proc = Bun.spawn({
      cmd: ["sh", "-c", `printf %s ${shellQuote(value)}`],
      stdout: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out).toBe(value);
  });
});

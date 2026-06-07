import { describe, expect, test } from "bun:test";
import {
  buildClassifierPrompt,
  parseClassifierVerdict,
  OFF_TOPIC_REFUSAL,
} from "./classifier.logic";

describe("buildClassifierPrompt", () => {
  test("carries the user text verbatim as the prompt and a non-empty system prompt", () => {
    const { system, prompt } = buildClassifierPrompt({
      userText: "Summarize the open incidents",
    });
    expect(prompt).toBe("Summarize the open incidents");
    expect(system.length).toBeGreaterThan(0);
    expect(system).toContain("Checkstack");
    expect(system).toContain("ON_TOPIC");
    expect(system).toContain("OFF_TOPIC");
  });

  // The classifier is a DENY-LIST: it must NOT enumerate resources/tools/verbs
  // (so new tools never require a prompt edit). Everything is ON_TOPIC by
  // default; only a few obviously-unrelated categories are rejected.
  test("treats everything as ON_TOPIC by default", () => {
    const { system } = buildClassifierPrompt({ userText: "x" });
    expect(system.toLowerCase()).toMatch(
      /everything[^.]*on_topic|on_topic by default/i,
    );
  });

  test("restricts OFF_TOPIC to CLEARLY unrelated requests only", () => {
    const { system } = buildClassifierPrompt({ userText: "write me a poem" });
    expect(system).toMatch(/clearly unrelated/i);
  });

  test("names the obviously off-topic categories (coding, writing, math, trivia)", () => {
    const { system } = buildClassifierPrompt({ userText: "x" });
    const lower = system.toLowerCase();
    expect(lower).toMatch(/coding|programming/);
    expect(lower).toContain("writing");
    expect(lower).toMatch(/math|homework/);
    expect(lower).toMatch(/trivia|world knowledge/);
  });

  test("retains the 'when in doubt' ON_TOPIC default", () => {
    const { system } = buildClassifierPrompt({ userText: "???" });
    expect(system).toMatch(/when in doubt.*on_topic/i);
  });

  test("does NOT enumerate platform resource types (deny-list, not allow-list)", () => {
    // Guards the design: if someone reverts to an allow-list that lists
    // resources, this catches it. The prompt should not need editing when tools
    // are added, so it must not pin specific resource names.
    const { system } = buildClassifierPrompt({ userText: "x" });
    expect(system.toLowerCase()).not.toContain("anomal");
    expect(system.toLowerCase()).not.toContain("slo");
  });
});

describe("parseClassifierVerdict", () => {
  test("recognizes a bare ON_TOPIC reply", () => {
    expect(parseClassifierVerdict("ON_TOPIC")).toBe("ON_TOPIC");
  });

  test("recognizes a bare OFF_TOPIC reply", () => {
    expect(parseClassifierVerdict("OFF_TOPIC")).toBe("OFF_TOPIC");
  });

  test("tolerates surrounding whitespace/punctuation/casing on OFF_TOPIC", () => {
    expect(parseClassifierVerdict("  off_topic.\n")).toBe("OFF_TOPIC");
    expect(parseClassifierVerdict("Verdict: OFF-TOPIC")).toBe("OFF_TOPIC");
  });

  test("defaults ambiguous replies to ON_TOPIC (false refusal is worse)", () => {
    expect(parseClassifierVerdict("maybe?")).toBe("ON_TOPIC");
    expect(parseClassifierVerdict("")).toBe("ON_TOPIC");
    expect(parseClassifierVerdict("I think this is fine")).toBe("ON_TOPIC");
  });

  test("a reply mentioning BOTH tokens defaults to ON_TOPIC (does not refuse)", () => {
    expect(parseClassifierVerdict("not OFF_TOPIC, it is ON_TOPIC")).toBe(
      "ON_TOPIC",
    );
  });

  test("the canned refusal is concise, uses no em-dashes, and nudges toward supported topics", () => {
    expect(OFF_TOPIC_REFUSAL).toContain("Checkstack");
    expect(OFF_TOPIC_REFUSAL).not.toContain("—");
    // The refusal should redirect the user rather than just saying "I can't".
    // It must mention at least one supported domain so the user knows what to ask.
    expect(OFF_TOPIC_REFUSAL).toMatch(
      /incident|health check|anomal|automation/i,
    );
  });
});

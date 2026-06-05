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
    // The system prompt names the platform domains so the model knows what is
    // on-topic.
    expect(system).toContain("Checkstack");
    expect(system).toContain("ON_TOPIC");
    expect(system).toContain("OFF_TOPIC");
  });

  test("system prompt explicitly lists meta/capability questions as ON_TOPIC", () => {
    const { system } = buildClassifierPrompt({ userText: "what can you do?" });
    // Must contain language that classifies assistant capability/meta questions
    // as ON_TOPIC. If this regresses (e.g. someone tightens the prompt and
    // removes the meta allowance), this assertion catches it.
    expect(system).toMatch(/what can you do|meta.*capability|capability.*question/i);
  });

  test("system prompt explicitly lists greetings as ON_TOPIC", () => {
    const { system } = buildClassifierPrompt({ userText: "hi" });
    // Greetings / conversational openers must be named in the ON_TOPIC section.
    expect(system).toMatch(/greeting|conversational opener|\"hi\"/i);
  });

  test("system prompt explicitly lists how-to/conceptual questions as ON_TOPIC", () => {
    const { system } = buildClassifierPrompt({
      userText: "how do health checks work?",
    });
    // How-to and conceptual questions about using Checkstack must be on-topic.
    expect(system).toMatch(/how.to|conceptual/i);
  });

  test("system prompt restricts OFF_TOPIC to CLEARLY unrelated requests only", () => {
    const { system } = buildClassifierPrompt({ userText: "write me a poem" });
    // The word "clearly" (or equivalent) must gate the OFF_TOPIC definition so
    // borderline messages default to ON_TOPIC.
    expect(system).toMatch(/clearly unrelated|CLEARLY unrelated/i);
  });

  test("system prompt retains the 'when in doubt' ON_TOPIC default", () => {
    const { system } = buildClassifierPrompt({ userText: "???" });
    expect(system).toMatch(/when in doubt.*on_topic/i);
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

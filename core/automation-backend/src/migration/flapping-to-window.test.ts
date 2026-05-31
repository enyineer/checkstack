import { describe, expect, it } from "bun:test";

import {
  DEFAULT_FLAPPING_COUNT,
  DEFAULT_FLAPPING_MINUTES,
  FLAPPING_FILTER,
  HEALTH_CHANGED_EVENT,
  LEGACY_FLAPPING_EVENT,
  rewriteFlappingTriggers,
} from "./flapping-to-window";

function def(triggers: unknown[]): Record<string, unknown> {
  return {
    name: "Flapping",
    triggers,
    conditions: [],
    actions: [{ action: "incident.create", config: {} }],
    mode: "single",
    max_runs: 1,
  };
}

describe("rewriteFlappingTriggers", () => {
  it("maps {transitions, windowMinutes} → window {count, minutes, refire: once}", () => {
    const out = rewriteFlappingTriggers(
      def([
        {
          id: "flap",
          event: LEGACY_FLAPPING_EVENT,
          config: { transitions: 5, windowMinutes: 15 },
        },
      ]),
    );
    expect(out.rewritten).toBe(1);
    const triggers = out.definition["triggers"] as Record<string, unknown>[];
    expect(triggers[0]).toEqual({
      id: "flap",
      event: HEALTH_CHANGED_EVENT,
      filter: FLAPPING_FILTER,
      window: { count: 5, minutes: 15, refire: "once" },
    });
    // config is dropped
    expect("config" in triggers[0]!).toBe(false);
  });

  it("applies 3/60 defaults when config is missing", () => {
    const out = rewriteFlappingTriggers(
      def([{ event: LEGACY_FLAPPING_EVENT }]),
    );
    const triggers = out.definition["triggers"] as Record<string, unknown>[];
    expect(triggers[0]!["window"]).toEqual({
      count: DEFAULT_FLAPPING_COUNT,
      minutes: DEFAULT_FLAPPING_MINUTES,
      refire: "once",
    });
  });

  it("applies defaults for a PARTIAL config", () => {
    const out = rewriteFlappingTriggers(
      def([
        { event: LEGACY_FLAPPING_EVENT, config: { transitions: 7 } },
      ]),
    );
    const triggers = out.definition["triggers"] as Record<string, unknown>[];
    expect(triggers[0]!["window"]).toEqual({
      count: 7,
      minutes: DEFAULT_FLAPPING_MINUTES,
      refire: "once",
    });
  });

  it("replaces a pre-existing filter with the canonical one (safe option) and reports it", () => {
    const out = rewriteFlappingTriggers(
      def([
        {
          event: LEGACY_FLAPPING_EVENT,
          filter: 'trigger.payload.systemId == "sys-1"',
          config: { transitions: 3, windowMinutes: 60 },
        },
      ]),
    );
    expect(out.replacedFilter).toBe(true);
    const triggers = out.definition["triggers"] as Record<string, unknown>[];
    expect(triggers[0]!["filter"]).toBe(FLAPPING_FILTER);
  });

  it("preserves non-flapping triggers untouched", () => {
    const out = rewriteFlappingTriggers(
      def([
        { event: "healthcheck.check_failed" },
        { event: LEGACY_FLAPPING_EVENT, config: { transitions: 2 } },
      ]),
    );
    expect(out.rewritten).toBe(1);
    const triggers = out.definition["triggers"] as Record<string, unknown>[];
    expect(triggers[0]).toEqual({ event: "healthcheck.check_failed" });
    expect(triggers[1]!["event"]).toBe(HEALTH_CHANGED_EVENT);
  });

  it("is idempotent: a definition with no flapping trigger is left untouched", () => {
    const input = def([{ event: HEALTH_CHANGED_EVENT, window: { count: 3, minutes: 60, refire: "once" } }]);
    const out = rewriteFlappingTriggers(input);
    expect(out.rewritten).toBe(0);
    expect(out.definition).toBe(input); // same reference, untouched
  });

  it("rewrites multiple flapping triggers in one definition", () => {
    const out = rewriteFlappingTriggers(
      def([
        { id: "a", event: LEGACY_FLAPPING_EVENT, config: { transitions: 2, windowMinutes: 10 } },
        { id: "b", event: LEGACY_FLAPPING_EVENT },
      ]),
    );
    expect(out.rewritten).toBe(2);
    const triggers = out.definition["triggers"] as Record<string, unknown>[];
    expect(triggers[0]!["window"]).toEqual({ count: 2, minutes: 10, refire: "once" });
    expect(triggers[1]!["window"]).toEqual({
      count: DEFAULT_FLAPPING_COUNT,
      minutes: DEFAULT_FLAPPING_MINUTES,
      refire: "once",
    });
  });
});

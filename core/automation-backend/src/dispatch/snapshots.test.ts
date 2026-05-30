import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import { parseActorSnapshot, parseWaitConfig } from "./snapshots";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof parseActorSnapshot>[0]["logger"];

describe("parseActorSnapshot", () => {
  it("returns a valid stored actor unchanged", () => {
    const actor = { type: "user" as const, id: "u-1" };
    const parsed = parseActorSnapshot({
      value: actor,
      logger: silentLogger,
      context: "test",
    });
    expect(parsed).toEqual(actor);
  });

  it("degrades a malformed/drifted snapshot to the system actor", () => {
    // A hand-edited / drifted row: wrong shape. Must NOT flow through as a
    // bogus Actor — degrades safely (and would log a warning).
    const parsed = parseActorSnapshot({
      value: { type: "not-a-real-type", whoops: true },
      logger: silentLogger,
      context: "Dwell d-1",
    });
    expect(parsed).toEqual(SYSTEM_ACTOR);
  });

  it("degrades a non-object snapshot to the system actor", () => {
    expect(
      parseActorSnapshot({ value: "garbage", context: "x" }),
    ).toEqual(SYSTEM_ACTOR);
    expect(parseActorSnapshot({ value: null, context: "x" })).toEqual(
      SYSTEM_ACTOR,
    );
  });
});

describe("parseWaitConfig", () => {
  const valid = {
    condition: "trigger.payload.x == 1",
    pollSeconds: 30,
    continueOnTimeout: false,
  };

  it("returns a valid stored wait config unchanged", () => {
    const parsed = parseWaitConfig({
      value: valid,
      logger: silentLogger,
      context: "test",
    });
    expect(parsed).toEqual(valid);
  });

  it("treats null/undefined as no config", () => {
    expect(parseWaitConfig({ value: null, context: "x" })).toBeNull();
    expect(parseWaitConfig({ value: undefined, context: "x" })).toBeNull();
  });

  it("returns null for a malformed/drifted config (engine treats as gone)", () => {
    // Missing required fields — must not be trusted as an UntilWaitConfig.
    const parsed = parseWaitConfig({
      value: { pollSeconds: "thirty" },
      logger: silentLogger,
      context: "Wait lock w-1",
    });
    expect(parsed).toBeNull();
  });
});

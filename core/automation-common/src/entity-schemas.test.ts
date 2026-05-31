import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import {
  DispatchJobSchema,
  EntityChangedSchema,
} from "./schemas";

const baseChange = {
  kind: "incident",
  id: "inc-1",
  prev: null,
  next: { status: "open" },
  delta: { status: "open" },
  changedFields: ["status"],
  actor: SYSTEM_ACTOR,
  occurredAt: new Date().toISOString(),
};

describe("EntityChangedSchema", () => {
  it("accepts a create (prev null)", () => {
    expect(() => EntityChangedSchema.parse(baseChange)).not.toThrow();
  });

  it("accepts a tombstone (next null)", () => {
    expect(() =>
      EntityChangedSchema.parse({ ...baseChange, next: null, delta: {} }),
    ).not.toThrow();
  });

  it("requires an actor", () => {
    const { actor, ...rest } = baseChange;
    void actor;
    expect(() => EntityChangedSchema.parse(rest)).toThrow();
  });

  it("rejects a non-array changedFields", () => {
    expect(() =>
      EntityChangedSchema.parse({ ...baseChange, changedFields: "status" }),
    ).toThrow();
  });
});

describe("DispatchJobSchema", () => {
  it("accepts a trigger job", () => {
    const job = {
      reason: "trigger" as const,
      automationId: "a-1",
      triggerId: "t-1",
      ref: "incident:inc-1",
      changed: baseChange,
    };
    expect(() => DispatchJobSchema.parse(job)).not.toThrow();
  });

  it("accepts a wake job", () => {
    const job = {
      reason: "wake" as const,
      runId: "r-1",
      waitLockId: "w-1",
      ref: "incident:inc-1",
      changed: baseChange,
    };
    expect(() => DispatchJobSchema.parse(job)).not.toThrow();
  });

  it("rejects an unknown reason", () => {
    expect(() =>
      DispatchJobSchema.parse({ reason: "nope", ref: "x", changed: baseChange }),
    ).toThrow();
  });
});

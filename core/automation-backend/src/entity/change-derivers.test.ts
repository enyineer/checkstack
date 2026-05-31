import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import { createChangeDeriverRegistry } from "./change-derivers";

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: "fake",
    id: "id-1",
    prev: null,
    next: { status: "open" },
    delta: { status: "open" },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ChangeDeriverRegistry", () => {
  it("returns [] for a kind with no registered deriver", () => {
    const reg = createChangeDeriverRegistry();
    expect(reg.derive(change())).toEqual([]);
  });

  it("routes a change through a registered per-kind deriver", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({
      kind: "fake",
      derive: (c) =>
        c.next?.status === "open" ? ["fake.opened"] : ["fake.closed"],
    });
    expect(reg.derive(change({ next: { status: "open" } }))).toEqual([
      "fake.opened",
    ]);
    expect(reg.derive(change({ next: { status: "done" } }))).toEqual([
      "fake.closed",
    ]);
  });

  it("only invokes derivers for the matching kind", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({ kind: "fake", derive: () => ["fake.evt"] });
    expect(reg.derive(change({ kind: "other" }))).toEqual([]);
  });

  it("unions + de-duplicates across multiple derivers for one kind", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({ kind: "fake", derive: () => ["a", "shared"] });
    reg.register({ kind: "fake", derive: () => ["shared", "b"] });
    expect(reg.derive(change())).toEqual(["a", "shared", "b"]);
  });

  it("isolates a throwing deriver from the others", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({
      kind: "fake",
      derive: () => {
        throw new Error("boom");
      },
    });
    reg.register({ kind: "fake", derive: () => ["safe"] });
    expect(reg.derive(change())).toEqual(["safe"]);
  });

  it("ignores duplicate registration of the same deriver function", () => {
    const reg = createChangeDeriverRegistry();
    const derive = () => ["once"];
    reg.register({ kind: "fake", derive });
    reg.register({ kind: "fake", derive });
    expect(reg.derive(change())).toEqual(["once"]);
  });

  it("rejects an empty kind", () => {
    const reg = createChangeDeriverRegistry();
    expect(() => reg.register({ kind: "", derive: () => [] })).toThrow();
  });

  it("lists kinds with derivers", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({ kind: "a", derive: () => [] });
    reg.register({ kind: "b", derive: () => [] });
    expect(reg.kinds().toSorted()).toEqual(["a", "b"]);
  });
});

describe("ChangeDeriverRegistry — payload mapper", () => {
  it("returns undefined when the kind has no registered mapper", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({ kind: "fake", derive: () => ["fake.evt"] });
    expect(reg.payload(change())).toBeUndefined();
  });

  it("maps a change to the domain-named payload via the registered mapper", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({
      kind: "fake",
      derive: () => ["fake.evt"],
      toPayload: (c) => ({ fakeId: c.id, status: c.next?.["status"] }),
    });
    expect(reg.payload(change({ id: "x", next: { status: "open" } }))).toEqual({
      fakeId: "x",
      status: "open",
    });
  });

  it("only applies the mapper for the matching kind", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({
      kind: "fake",
      derive: () => [],
      toPayload: () => ({ mapped: true }),
    });
    expect(reg.payload(change({ kind: "other" }))).toBeUndefined();
  });

  it("allows registering the deriver and mapper in one call", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({
      kind: "fake",
      derive: () => ["fake.evt"],
      toPayload: (c) => ({ id: c.id }),
    });
    expect(reg.derive(change())).toEqual(["fake.evt"]);
    expect(reg.payload(change({ id: "id-1" }))).toEqual({ id: "id-1" });
  });

  it("re-registering the SAME mapper for a kind is harmless", () => {
    const reg = createChangeDeriverRegistry();
    const toPayload = (c: EntityChanged) => ({ id: c.id });
    reg.register({ kind: "fake", derive: () => [], toPayload });
    reg.register({ kind: "fake", derive: () => [], toPayload });
    expect(reg.payload(change({ id: "id-1" }))).toEqual({ id: "id-1" });
  });

  it("throws on a second DISTINCT mapper for the same kind", () => {
    const reg = createChangeDeriverRegistry();
    reg.register({ kind: "fake", derive: () => [], toPayload: () => ({ a: 1 }) });
    expect(() =>
      reg.register({
        kind: "fake",
        derive: () => [],
        toPayload: () => ({ b: 2 }),
      }),
    ).toThrow();
  });
});

import { describe, it, expect } from "bun:test";
import type { EntityHandle, EntityMutationOpts } from "./define-entity";
import { withEntityWrite, withEntityRemove } from "./with-entity-write";

interface TestState extends Record<string, unknown> {
  value: string;
}

describe("withEntityWrite", () => {
  it("routes the write through handle.mutate keyed by id (with opts)", async () => {
    const calls: Array<{
      id: string;
      opts?: EntityMutationOpts;
      next: TestState;
    }> = [];
    const handle = {
      kind: "test",
      async mutate(input: {
        id: string;
        opts?: EntityMutationOpts;
        apply: () => Promise<TestState>;
      }) {
        const next = await input.apply();
        calls.push({ id: input.id, opts: input.opts, next });
        return next;
      },
    } as unknown as EntityHandle<TestState>;

    let applied = false;
    await withEntityWrite({
      handle,
      id: "e-1",
      opts: { runId: "run-1" },
      apply: async () => {
        applied = true;
        return { value: "next" };
      },
    });

    expect(applied).toBe(true);
    expect(calls).toEqual([
      { id: "e-1", opts: { runId: "run-1" }, next: { value: "next" } },
    ]);
  });

  it("runs the plugin write directly when no handle is wired", async () => {
    let applied = false;
    await withEntityWrite<TestState>({
      handle: undefined,
      id: "e-2",
      apply: async () => {
        applied = true;
        return { value: "next" };
      },
    });
    expect(applied).toBe(true);
  });
});

describe("withEntityRemove", () => {
  it("tombstones via handle.remove keyed by id (with opts)", async () => {
    const removed: Array<{ id: string; opts?: EntityMutationOpts }> = [];
    let deleted = false;
    const handle = {
      kind: "test",
      async remove(input: {
        id: string;
        opts?: EntityMutationOpts;
        apply: () => Promise<void>;
      }) {
        await input.apply();
        removed.push({ id: input.id, opts: input.opts });
      },
    } as unknown as EntityHandle<TestState>;

    await withEntityRemove<TestState>({
      handle,
      id: "e-9",
      opts: { runId: "run-9" },
      apply: async () => {
        deleted = true;
      },
    });

    expect(deleted).toBe(true);
    expect(removed).toEqual([{ id: "e-9", opts: { runId: "run-9" } }]);
  });

  it("runs the delete directly when no handle is wired", async () => {
    let deleted = false;
    await withEntityRemove<TestState>({
      handle: undefined,
      id: "e-3",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
  });
});

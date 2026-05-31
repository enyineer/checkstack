import { describe, it, expect } from "bun:test";
import type {
  ActionInput,
  ChooseInput,
  ParallelInput,
  ProviderAction,
} from "@checkstack/automation-common";
import {
  collectActionIds,
  duplicateAction,
} from "./action-helpers";

describe("duplicateAction", () => {
  it("clones a leaf action with a fresh, unique id", () => {
    const original: ProviderAction = {
      action: "automation.log",
      config: { message: "hi" },
      enabled: true,
      continue_on_error: false,
      id: "log",
    };
    const clone = duplicateAction(original, new Set(["log"]));
    expect(clone.id).not.toBe("log");
    expect(clone.id).toBe("log_2");
    // Config is carried over verbatim.
    expect((clone as ProviderAction).config).toEqual({ message: "hi" });
  });

  it("does not mutate the original action", () => {
    const original: ProviderAction = {
      action: "automation.log",
      config: {},
      enabled: true,
      continue_on_error: false,
      id: "log",
    };
    const before = structuredClone(original);
    duplicateAction(original, new Set(["log"]));
    expect(original).toEqual(before);
  });

  it("assigns fresh ids to every nested child of a composite", () => {
    const original: ChooseInput = {
      id: "branch",
      enabled: true,
      continue_on_error: false,
      choose: [
        {
          when: "true",
          sequence: [
            { action: "automation.log", config: {}, enabled: true, continue_on_error: false, id: "a" },
          ],
        },
      ],
      else: [
        { action: "automation.log", config: {}, enabled: true, continue_on_error: false, id: "b" },
      ],
    };
    const taken = collectActionIds([original]);
    const clone = duplicateAction(original, taken);

    const cloneIds = collectActionIds([clone]);
    const originalIds = collectActionIds([original]);
    // No id from the clone collides with any id in the original tree.
    for (const id of cloneIds) {
      expect(originalIds.has(id)).toBe(false);
    }
    // Every nested step still carries an id (none left blank).
    const choose = clone as ChooseInput;
    expect(choose.choose[0]!.sequence[0]!.id).toBeTruthy();
    expect(choose.else![0]!.id).toBeTruthy();
  });

  it("keeps ids unique across repeated duplication against one set", () => {
    const original: ProviderAction = {
      action: "automation.log",
      config: {},
      enabled: true,
      continue_on_error: false,
      id: "log",
    };
    const taken = collectActionIds([original]);
    const first = duplicateAction(original, taken);
    const second = duplicateAction(original, taken);
    expect(first.id).not.toBe(second.id);
    expect(taken.has(first.id!)).toBe(true);
    expect(taken.has(second.id!)).toBe(true);
  });

  it("dedupes nested parallel children against the whole automation", () => {
    const original: ParallelInput = {
      id: "par",
      enabled: true,
      continue_on_error: false,
      parallel: [
        { action: "automation.log", config: {}, enabled: true, continue_on_error: false, id: "x" },
        { action: "automation.log", config: {}, enabled: true, continue_on_error: false, id: "y" },
      ],
    };
    const automation: ActionInput[] = [original];
    const taken = collectActionIds(automation);
    const clone = duplicateAction(original, taken);
    const ids = [...collectActionIds([clone])];
    // All fresh ids are distinct.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

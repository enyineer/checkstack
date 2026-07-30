import { describe, expect, test } from "bun:test";
import type { AccessRuleEntry } from "../api";
import {
  getCategorySelectionState,
  groupAccessRulesByCategory,
  setCategorySelection,
  toCategoryLabel,
} from "./role-rules.logic";

const rule = (id: string, extra: Partial<AccessRuleEntry> = {}) =>
  ({ id, ...extra }) satisfies AccessRuleEntry;

describe("groupAccessRulesByCategory", () => {
  test("sorts categories alphabetically regardless of registration order", () => {
    const categories = groupAccessRulesByCategory({
      rules: [
        rule("satellite.read"),
        rule("auth.roles.manage"),
        rule("dependency.read"),
      ],
    });

    expect(categories.map((c) => c.pluginId)).toEqual([
      "auth",
      "dependency",
      "satellite",
    ]);
  });

  test("sorts rules inside a category by id", () => {
    const categories = groupAccessRulesByCategory({
      rules: [rule("auth.users.manage"), rule("auth.roles.manage")],
    });

    expect(categories[0].rules.map((r) => r.id)).toEqual([
      "auth.roles.manage",
      "auth.users.manage",
    ]);
  });

  test("sorts on the rendered label, not the raw plugin id", () => {
    // `auth-github` renders as "auth github", which sorts BEFORE "authz" -
    // the opposite of raw id order, where "-" (0x2D) precedes "z" anyway but
    // the space form is what the reader scans.
    const categories = groupAccessRulesByCategory({
      rules: [rule("authz.read"), rule("auth-github.read"), rule("auth.read")],
    });

    expect(categories.map((c) => c.label)).toEqual([
      "auth",
      "auth github",
      "authz",
    ]);
  });

  test("keeps every rule and never drops a category", () => {
    const rules = [
      rule("b.one"),
      rule("a.one"),
      rule("b.two"),
      rule("c.one"),
    ];

    const categories = groupAccessRulesByCategory({ rules });

    expect(categories).toHaveLength(3);
    expect(categories.flatMap((c) => c.rules)).toHaveLength(rules.length);
  });

  test("treats an id with no dot as its own category", () => {
    const categories = groupAccessRulesByCategory({ rules: [rule("*")] });

    expect(categories).toEqual([
      { pluginId: "*", label: "*", rules: [rule("*")] },
    ]);
  });

  test("returns an empty list for no rules", () => {
    expect(groupAccessRulesByCategory({ rules: [] })).toEqual([]);
  });
});

describe("toCategoryLabel", () => {
  test("replaces every hyphen, not just the first", () => {
    expect(toCategoryLabel({ pluginId: "healthcheck-http-backend" })).toBe(
      "healthcheck http backend",
    );
  });
});

describe("getCategorySelectionState", () => {
  const selectableIds = ["a.one", "a.two", "a.three"];

  test("reports none when nothing is selected", () => {
    expect(
      getCategorySelectionState({ selected: new Set(), selectableIds }),
    ).toBe("none");
  });

  test("reports some for a partial selection", () => {
    expect(
      getCategorySelectionState({
        selected: new Set(["a.two"]),
        selectableIds,
      }),
    ).toBe("some");
  });

  test("reports all when every selectable id is selected", () => {
    expect(
      getCategorySelectionState({
        selected: new Set(selectableIds),
        selectableIds,
      }),
    ).toBe("all");
  });

  test("ignores selected ids from other categories", () => {
    expect(
      getCategorySelectionState({
        selected: new Set([...selectableIds, "b.one"]),
        selectableIds,
      }),
    ).toBe("all");
  });

  test("reports none when the category has nothing selectable", () => {
    expect(
      getCategorySelectionState({
        selected: new Set(["a.one"]),
        selectableIds: [],
      }),
    ).toBe("none");
  });
});

describe("setCategorySelection", () => {
  test("selecting adds every selectable id", () => {
    const next = setCategorySelection({
      selected: new Set(),
      selectableIds: ["a.one", "a.two"],
      categoryIds: ["a.one", "a.two"],
      select: true,
    });

    expect([...next].toSorted()).toEqual(["a.one", "a.two"]);
  });

  test("selecting never adds a blocked rule", () => {
    // `a.blocked` is in the category but not selectable (anonymous role).
    const next = setCategorySelection({
      selected: new Set(),
      selectableIds: ["a.one"],
      categoryIds: ["a.one", "a.blocked"],
      select: true,
    });

    expect(next.has("a.blocked")).toBe(false);
    expect(next.has("a.one")).toBe(true);
  });

  test("selecting leaves other categories untouched", () => {
    const next = setCategorySelection({
      selected: new Set(["b.one"]),
      selectableIds: ["a.one"],
      categoryIds: ["a.one"],
      select: true,
    });

    expect(next.has("b.one")).toBe(true);
  });

  test("clearing removes every id in the category, including blocked ones", () => {
    // A blocked rule that is ALREADY selected (a pre-existing grant) must still
    // be clearable - otherwise the category can never reach an empty state.
    const next = setCategorySelection({
      selected: new Set(["a.one", "a.blocked", "b.one"]),
      selectableIds: ["a.one"],
      categoryIds: ["a.one", "a.blocked"],
      select: false,
    });

    expect([...next]).toEqual(["b.one"]);
  });

  test("returns a new set and does not mutate the input", () => {
    const selected = new Set(["a.one"]);
    const next = setCategorySelection({
      selected,
      selectableIds: ["a.two"],
      categoryIds: ["a.two"],
      select: true,
    });

    expect(next).not.toBe(selected);
    expect([...selected]).toEqual(["a.one"]);
  });

  test("is idempotent", () => {
    const once = setCategorySelection({
      selected: new Set(),
      selectableIds: ["a.one"],
      categoryIds: ["a.one"],
      select: true,
    });
    const twice = setCategorySelection({
      selected: once,
      selectableIds: ["a.one"],
      categoryIds: ["a.one"],
      select: true,
    });

    expect([...twice]).toEqual([...once]);
  });
});

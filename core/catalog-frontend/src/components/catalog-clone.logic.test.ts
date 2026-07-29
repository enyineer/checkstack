import { describe, expect, test } from "bun:test";
import { isCreateMode, resolveEditorMode } from "./catalog-clone.logic";

describe("resolveEditorMode", () => {
  test("defaults to edit when initialData is present", () => {
    expect(resolveEditorMode({ hasInitialData: true })).toBe("edit");
  });

  test("defaults to create when there is no initialData", () => {
    expect(resolveEditorMode({ hasInitialData: false })).toBe("create");
  });

  test("an explicit mode always wins over the default", () => {
    // The whole point: a clone HAS initialData but is not an edit.
    expect(resolveEditorMode({ mode: "clone", hasInitialData: true })).toBe(
      "clone",
    );
    expect(resolveEditorMode({ mode: "create", hasInitialData: true })).toBe(
      "create",
    );
  });
});

describe("isCreateMode", () => {
  test("a clone saves through the create path", () => {
    expect(isCreateMode({ mode: "clone" })).toBe(true);
  });

  test("a plain create saves through the create path", () => {
    expect(isCreateMode({ mode: "create" })).toBe(true);
  });

  test("only an edit does not", () => {
    expect(isCreateMode({ mode: "edit" })).toBe(false);
  });
});

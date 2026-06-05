import { describe, expect, test } from "bun:test";
import { buildModelOptions } from "./model-options.logic";

describe("buildModelOptions", () => {
  test("returns [defaultModel] when there are no availableModels", () => {
    expect(
      buildModelOptions({ defaultModel: "gpt-4o", availableModels: [] }),
    ).toEqual(["gpt-4o"]);
    expect(
      buildModelOptions({ defaultModel: "gpt-4o", availableModels: undefined }),
    ).toEqual(["gpt-4o"]);
  });

  test("puts the default model first", () => {
    expect(
      buildModelOptions({
        defaultModel: "gpt-4o",
        availableModels: ["gpt-4o-mini", "o3"],
      }),
    ).toEqual(["gpt-4o", "gpt-4o-mini", "o3"]);
  });

  test("de-duplicates the default when it is also in availableModels", () => {
    expect(
      buildModelOptions({
        defaultModel: "gpt-4o",
        availableModels: ["gpt-4o", "gpt-4o-mini"],
      }),
    ).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  test("de-duplicates repeated availableModels entries", () => {
    expect(
      buildModelOptions({
        defaultModel: "a",
        availableModels: ["b", "b", "c", "a"],
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("returns an empty list when there is no default and no models", () => {
    expect(
      buildModelOptions({ defaultModel: undefined, availableModels: [] }),
    ).toEqual([]);
  });

  test("ignores an undefined default but keeps availableModels", () => {
    expect(
      buildModelOptions({
        defaultModel: undefined,
        availableModels: ["x", "y"],
      }),
    ).toEqual(["x", "y"]);
  });
});

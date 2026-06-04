import { describe, it, expect } from "bun:test";
import {
  toPreviewOptions,
  environmentToPreviewFields,
  findSelectedEnvironment,
} from "./environment-preview.logic";
import type { Environment } from "@checkstack/catalog-common";

const env = (over: Partial<Environment> & Pick<Environment, "id" | "name">): Environment => ({
  description: null,
  systemIds: [],
  metadata: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("toPreviewOptions", () => {
  it("maps id + name preserving order", () => {
    const options = toPreviewOptions([
      env({ id: "e1", name: "Staging" }),
      env({ id: "e2", name: "Production" }),
    ]);
    expect(options).toEqual([
      { id: "e1", name: "Staging" },
      { id: "e2", name: "Production" },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(toPreviewOptions([])).toEqual([]);
  });
});

describe("environmentToPreviewFields", () => {
  it("returns the environment metadata verbatim", () => {
    const fields = environmentToPreviewFields(
      env({ id: "e1", name: "Staging", metadata: { baseUrl: "https://staging.example.com" } }),
    );
    expect(fields).toEqual({ baseUrl: "https://staging.example.com" });
  });

  it("returns an empty object when metadata is null", () => {
    expect(environmentToPreviewFields(env({ id: "e1", name: "Staging" }))).toEqual({});
  });

  it("returns an empty object for null/undefined environment", () => {
    expect(environmentToPreviewFields(null)).toEqual({});
    expect(environmentToPreviewFields(undefined)).toEqual({});
  });
});

describe("findSelectedEnvironment", () => {
  const environments = [
    env({ id: "e1", name: "Staging" }),
    env({ id: "e2", name: "Production" }),
  ];

  it("finds the selected environment by id", () => {
    expect(
      findSelectedEnvironment({ environments, selectedId: "e2" })?.name,
    ).toBe("Production");
  });

  it("returns null when no id is selected", () => {
    expect(findSelectedEnvironment({ environments, selectedId: null })).toBeNull();
    expect(findSelectedEnvironment({ environments, selectedId: undefined })).toBeNull();
    expect(findSelectedEnvironment({ environments, selectedId: "" })).toBeNull();
  });

  it("returns null when the id is no longer present", () => {
    expect(
      findSelectedEnvironment({ environments, selectedId: "gone" }),
    ).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { deriveSourceUrl } from "./source-url";

describe("deriveSourceUrl", () => {
  test("public github.com", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: null,
        repository: "acme/checkstack",
        filePath: "catalog/system.yaml",
      }),
    ).toBe("https://github.com/acme/checkstack/blob/HEAD/catalog/system.yaml");
  });

  test("public gitlab.com", () => {
    expect(
      deriveSourceUrl({
        providerType: "gitlab",
        baseUrl: null,
        repository: "acme/checkstack",
        filePath: "catalog/system.yaml",
      }),
    ).toBe(
      "https://gitlab.com/acme/checkstack/-/blob/HEAD/catalog/system.yaml",
    );
  });

  test("api.github.com baseUrl maps to public host", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: "https://api.github.com",
        repository: "acme/checkstack",
        filePath: "catalog/system.yaml",
      }),
    ).toBe("https://github.com/acme/checkstack/blob/HEAD/catalog/system.yaml");
  });

  test("github enterprise baseUrl strips /api/v3", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: "https://github.example.com/api/v3",
        repository: "acme/checkstack",
        filePath: "catalog/system.yaml",
      }),
    ).toBe(
      "https://github.example.com/acme/checkstack/blob/HEAD/catalog/system.yaml",
    );
  });

  test("self-hosted gitlab baseUrl strips /api/v4", () => {
    expect(
      deriveSourceUrl({
        providerType: "gitlab",
        baseUrl: "https://gitlab.example.com/api/v4",
        repository: "team/sub/checkstack",
        filePath: "catalog/system.yaml",
      }),
    ).toBe(
      "https://gitlab.example.com/team/sub/checkstack/-/blob/HEAD/catalog/system.yaml",
    );
  });

  test("nested gitlab namespaces preserved", () => {
    expect(
      deriveSourceUrl({
        providerType: "gitlab",
        baseUrl: null,
        repository: "group/sub/project",
        filePath: "a/b.yaml",
      }),
    ).toBe("https://gitlab.com/group/sub/project/-/blob/HEAD/a/b.yaml");
  });

  test("encodes spaces and special characters in path segments", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: null,
        repository: "acme/checkstack",
        filePath: "catalog/my system.yaml",
      }),
    ).toBe(
      "https://github.com/acme/checkstack/blob/HEAD/catalog/my%20system.yaml",
    );
  });

  test("strips leading slashes from filePath", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: null,
        repository: "acme/checkstack",
        filePath: "/catalog/system.yaml",
      }),
    ).toBe("https://github.com/acme/checkstack/blob/HEAD/catalog/system.yaml");
  });

  test("returns null for unknown self-hosted baseUrl", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: "https://github.example.com/some/weird/path",
        repository: "acme/checkstack",
        filePath: "catalog/system.yaml",
      }),
    ).toBeNull();
  });

  test("returns null for traversal attempts", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: null,
        repository: "acme/checkstack",
        filePath: "../etc/passwd",
      }),
    ).toBeNull();
  });

  test("returns null for empty inputs", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: null,
        repository: "",
        filePath: "x.yaml",
      }),
    ).toBeNull();
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: null,
        repository: "a/b",
        filePath: "",
      }),
    ).toBeNull();
  });

  test("returns null for malformed baseUrl", () => {
    expect(
      deriveSourceUrl({
        providerType: "github",
        baseUrl: "not a url",
        repository: "acme/checkstack",
        filePath: "x.yaml",
      }),
    ).toBeNull();
  });
});

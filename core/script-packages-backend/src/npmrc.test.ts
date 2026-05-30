import { describe, expect, test } from "bun:test";
import { renderNpmrc } from "./npmrc";

describe("renderNpmrc", () => {
  test("renders the default registry without auth when no token", () => {
    const out = renderNpmrc({
      registryUrl: "https://registry.npmjs.org/",
      scopedRegistries: [],
    });
    expect(out).toContain("registry=https://registry.npmjs.org/");
    expect(out).not.toContain("_authToken");
  });

  test("renders scoped registries", () => {
    const out = renderNpmrc({
      registryUrl: "https://artifactory.acme.com/npm/",
      scopedRegistries: [
        { scope: "@acme", registryUrl: "https://artifactory.acme.com/npm-acme/" },
      ],
    });
    expect(out).toContain(
      "@acme:registry=https://artifactory.acme.com/npm-acme/",
    );
  });

  test("emits protocol-relative _authToken lines for the registry and scoped registries", () => {
    const out = renderNpmrc({
      registryUrl: "https://artifactory.acme.com/npm/",
      scopedRegistries: [
        { scope: "@acme", registryUrl: "https://artifactory.acme.com/npm-acme/" },
      ],
      authToken: "TOKEN123",
    });
    expect(out).toContain("//artifactory.acme.com/npm/:_authToken=TOKEN123");
    expect(out).toContain(
      "//artifactory.acme.com/npm-acme/:_authToken=TOKEN123",
    );
  });

  test("omits auth lines for an empty token", () => {
    const out = renderNpmrc({
      registryUrl: "https://registry.npmjs.org/",
      scopedRegistries: [],
      authToken: "",
    });
    expect(out).not.toContain("_authToken");
  });
});

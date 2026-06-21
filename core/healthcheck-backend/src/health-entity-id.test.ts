import { describe, it, expect } from "bun:test";
import {
  HEALTH_ENTITY_ID_SEPARATOR,
  encodeHealthEntityId,
  parseHealthEntityId,
} from "./health-entity-id";

describe("encodeHealthEntityId", () => {
  it("yields the bare system id when environmentId is undefined", () => {
    expect(encodeHealthEntityId({ systemId: "sys-1" })).toBe("sys-1");
  });

  it("yields the bare system id when environmentId is null", () => {
    expect(encodeHealthEntityId({ systemId: "sys-1", environmentId: null })).toBe(
      "sys-1",
    );
  });

  it("joins system and environment with the double-colon separator", () => {
    expect(
      encodeHealthEntityId({ systemId: "sys-1", environmentId: "prod" }),
    ).toBe(`sys-1${HEALTH_ENTITY_ID_SEPARATOR}prod`);
    expect(HEALTH_ENTITY_ID_SEPARATOR).toBe("::");
  });

  it("treats an empty-string environmentId as concrete (not a rollup)", () => {
    // "" is neither null nor undefined, so it encodes as a per-env id.
    expect(encodeHealthEntityId({ systemId: "sys-1", environmentId: "" })).toBe(
      "sys-1::",
    );
  });
});

describe("parseHealthEntityId", () => {
  it("decodes a bare id as the system rollup (environmentId null)", () => {
    expect(parseHealthEntityId("sys-1")).toEqual({
      systemId: "sys-1",
      environmentId: null,
    });
  });

  it("decodes a per-env id into system and environment", () => {
    expect(parseHealthEntityId("sys-1::prod")).toEqual({
      systemId: "sys-1",
      environmentId: "prod",
    });
  });

  it("splits on the FIRST separator so a later '::' stays in the env id", () => {
    expect(parseHealthEntityId("sys-1::a::b")).toEqual({
      systemId: "sys-1",
      environmentId: "a::b",
    });
  });

  it("yields an empty environmentId for a trailing separator", () => {
    expect(parseHealthEntityId("sys-1::")).toEqual({
      systemId: "sys-1",
      environmentId: "",
    });
  });

  it("round-trips an encoded per-env id", () => {
    const encoded = encodeHealthEntityId({
      systemId: "sys-9",
      environmentId: "staging",
    });
    expect(parseHealthEntityId(encoded)).toEqual({
      systemId: "sys-9",
      environmentId: "staging",
    });
  });
});

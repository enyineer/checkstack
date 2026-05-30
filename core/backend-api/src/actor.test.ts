import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import { resolveActor } from "./actor";

describe("resolveActor", () => {
  it("falls back to the system actor when there is no caller", () => {
    expect(resolveActor(undefined)).toEqual(SYSTEM_ACTOR);
  });

  it("maps a real (human) user", () => {
    expect(
      resolveActor({ type: "user", id: "user-1", name: "Nico" }),
    ).toEqual({ type: "user", id: "user-1", name: "Nico" });
  });

  it("maps an application (API client)", () => {
    expect(
      resolveActor({ type: "application", id: "app-deploybot", name: "Deploy Bot" }),
    ).toEqual({ type: "application", id: "app-deploybot", name: "Deploy Bot" });
  });

  it("maps a service to its originating plugin id", () => {
    expect(resolveActor({ type: "service", pluginId: "healthcheck" })).toEqual({
      type: "service",
      id: "healthcheck",
      name: "healthcheck",
    });
  });
});

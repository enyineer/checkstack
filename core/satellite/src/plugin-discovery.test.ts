import { describe, expect, test } from "bun:test";
import { isSatelliteLoadedPluginDir } from "./plugin-discovery";

describe("isSatelliteLoadedPluginDir", () => {
  test("matches health-check strategy and collector backends", () => {
    expect(isSatelliteLoadedPluginDir("healthcheck-http-backend")).toBe(true);
    expect(isSatelliteLoadedPluginDir("healthcheck-ssh-backend")).toBe(true);
    expect(isSatelliteLoadedPluginDir("collector-hardware-backend")).toBe(true);
  });

  test("does not match -common siblings, frontends, or unrelated plugins", () => {
    expect(isSatelliteLoadedPluginDir("healthcheck-http-common")).toBe(false);
    expect(isSatelliteLoadedPluginDir("healthcheck-http-frontend")).toBe(false);
    expect(isSatelliteLoadedPluginDir("collector-hardware-common")).toBe(false);
    expect(isSatelliteLoadedPluginDir("incident-backend")).toBe(false);
    expect(isSatelliteLoadedPluginDir("k8s-events-backend")).toBe(false);
  });

  test("requires both the prefix AND the -backend suffix", () => {
    expect(isSatelliteLoadedPluginDir("healthcheck-http")).toBe(false);
    expect(isSatelliteLoadedPluginDir("some-collector-backend")).toBe(false);
  });
});

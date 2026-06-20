import { describe, expect, it } from "bun:test";
import {
  PLUGIN_TONE_STYLES,
  presentPluginSource,
  presentPluginStatus,
} from "./pluginDisplay.logic";

describe("presentPluginStatus", () => {
  it("classifies runtime-installed plugins as ok with the 'runtime' label", () => {
    expect(presentPluginStatus({ isUninstallable: true })).toEqual({
      tone: "ok",
      label: "runtime",
    });
  });

  it("classifies bundled core plugins as unknown with the 'core' label", () => {
    expect(presentPluginStatus({ isUninstallable: false })).toEqual({
      tone: "unknown",
      label: "core",
    });
  });

  it("maps every tone to a defined class set", () => {
    for (const tone of ["ok", "unknown"] as const) {
      expect(PLUGIN_TONE_STYLES[tone].pill).toContain(`status-${tone}`);
      expect(PLUGIN_TONE_STYLES[tone].dot).toContain(`status-${tone}`);
      expect(PLUGIN_TONE_STYLES[tone].accent).toContain(`status-${tone}`);
    }
  });
});

describe("presentPluginSource", () => {
  it("returns the source type for runtime plugins", () => {
    expect(
      presentPluginSource({
        source: { type: "npm", packageName: "@acme/plugin" },
      }),
    ).toBe("npm");
    expect(
      presentPluginSource({
        source: { type: "github", owner: "acme", repo: "plugin", tag: "v1" },
      }),
    ).toBe("github");
  });

  it("returns 'monorepo' when there is no source", () => {
    expect(presentPluginSource({ source: null })).toBe("monorepo");
  });
});

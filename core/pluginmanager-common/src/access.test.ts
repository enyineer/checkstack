import { describe, expect, it } from "bun:test";

import { pluginManagerAccess, pluginManagerAccessRules } from "./access";
import { pluginMetadata } from "./plugin-metadata";

describe("pluginManagerAccess", () => {
  it("exposes exactly one manage rule covering install and uninstall", () => {
    expect(pluginManagerAccess.manage.id).toBe("plugin.manage");
    expect(pluginManagerAccessRules).toHaveLength(2);
  });

  it("has unique qualified ids (no collapsed grants in the role editor)", () => {
    const qualifiedIds = pluginManagerAccessRules.map(
      (rule) => `${pluginMetadata.pluginId}.${rule.id}`,
    );
    expect(new Set(qualifiedIds).size).toBe(qualifiedIds.length);
  });
});

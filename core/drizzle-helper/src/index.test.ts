import { describe, it, expect } from "bun:test";
import { getPluginSchemaName } from "./index";

describe("getPluginSchemaName", () => {
  it("produces plugin_<id> for valid ids", () => {
    expect(getPluginSchemaName("auth")).toBe("plugin_auth");
    expect(getPluginSchemaName("notification-smtp")).toBe(
      "plugin_notification-smtp",
    );
    expect(getPluginSchemaName("healthcheck-http")).toBe(
      "plugin_healthcheck-http",
    );
  });

  it("rejects an id that tries to break out of a quoted identifier", () => {
    // The classic SQL-identifier escape: a double quote terminates the quoted
    // identifier and appends a destructive statement.
    expect(() =>
      getPluginSchemaName('x"; DROP SCHEMA public CASCADE; --'),
    ).toThrow(/Invalid pluginId/);
  });

  it("rejects ids with whitespace, uppercase, leading digit, or empty", () => {
    expect(() => getPluginSchemaName("Auth")).toThrow();
    expect(() => getPluginSchemaName("with space")).toThrow();
    expect(() => getPluginSchemaName("1foo")).toThrow();
    expect(() => getPluginSchemaName("")).toThrow();
    expect(() => getPluginSchemaName("foo--bar")).toThrow();
    expect(() => getPluginSchemaName("foo_bar")).toThrow();
    expect(() => getPluginSchemaName("-foo")).toThrow();
    expect(() => getPluginSchemaName("foo-")).toThrow();
  });
});

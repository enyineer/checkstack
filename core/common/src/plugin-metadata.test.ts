import { describe, it, expect } from "bun:test";
import {
  pluginIdSchema,
  assertValidPluginId,
  pluginCheckstackBlockSchema,
} from "./plugin-metadata";

describe("pluginIdSchema", () => {
  it("accepts the shipped plugin id shapes", () => {
    for (const id of [
      "auth",
      "auth-credential",
      "notification-smtp",
      "healthcheck-http",
      "script-packages-store-postgres",
    ]) {
      expect(pluginIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("rejects ids that could break out of a SQL identifier", () => {
    expect(
      pluginIdSchema.safeParse('x"; DROP SCHEMA public CASCADE; --').success,
    ).toBe(false);
  });

  it("rejects uppercase, whitespace, leading digit, underscores, and double dashes", () => {
    for (const id of [
      "Auth",
      "with space",
      "1foo",
      "foo_bar",
      "foo--bar",
      "-foo",
      "foo-",
      "",
    ]) {
      expect(pluginIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it("assertValidPluginId throws on a bad id and returns a good one", () => {
    expect(assertValidPluginId("healthcheck-http")).toBe("healthcheck-http");
    expect(() => assertValidPluginId('bad"id')).toThrow();
  });

  it("the install-time checkstack block validates pluginId charset", () => {
    expect(
      pluginCheckstackBlockSchema.safeParse({
        type: "backend",
        pluginId: 'evil"; DROP SCHEMA public; --',
      }).success,
    ).toBe(false);
    expect(
      pluginCheckstackBlockSchema.safeParse({
        type: "backend",
        pluginId: "healthcheck-http",
      }).success,
    ).toBe(true);
  });
});

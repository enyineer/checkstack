import { describe, expect, test } from "bun:test";
import { isApplicationBindable } from "./bind-authority";

describe("isApplicationBindable", () => {
  test("admin caller (*) may bind any application", () => {
    expect(
      isApplicationBindable({
        appAccessRules: ["incident.incident.manage", "notification.send"],
        callerAccessRules: ["*"],
      }),
    ).toBe(true);
    // even an app that itself holds `*`
    expect(
      isApplicationBindable({
        appAccessRules: ["*"],
        callerAccessRules: ["*"],
      }),
    ).toBe(true);
  });

  test("non-admin caller cannot bind an app holding * (escalation)", () => {
    expect(
      isApplicationBindable({
        appAccessRules: ["*"],
        callerAccessRules: ["incident.incident.manage"],
      }),
    ).toBe(false);
  });

  test("bindable when the app's rules are a subset of the caller's", () => {
    expect(
      isApplicationBindable({
        appAccessRules: ["notification.send"],
        callerAccessRules: ["notification.send", "incident.incident.manage"],
      }),
    ).toBe(true);
  });

  test("not bindable when the app holds a rule the caller lacks (escalation)", () => {
    expect(
      isApplicationBindable({
        appAccessRules: ["notification.send", "catalog.system.manage"],
        callerAccessRules: ["notification.send"],
      }),
    ).toBe(false);
  });

  test("an app with no rules is bindable by anyone", () => {
    expect(
      isApplicationBindable({ appAccessRules: [], callerAccessRules: [] }),
    ).toBe(true);
  });
});

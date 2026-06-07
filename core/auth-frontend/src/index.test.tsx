import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { AuthAccessApi } from "./lib/AuthAccessApi";
import type { AccessRule } from "@checkstack/common";
import { useAccessRules } from "./hooks/useAccessRules";
import * as realUseAccessRules from "./hooks/useAccessRules";

// Snapshot the real hook module before mocking; restore it in afterAll so the
// stub does not leak into later auth-frontend suites (mock.module is
// process-global and mock.restore() does not undo it).
const realUseAccessRulesModule = { ...realUseAccessRules };

// Mock the useAccessRules hook
mock.module("./hooks/useAccessRules", () => ({
  useAccessRules: mock(),
}));

afterAll(() => {
  mock.module("./hooks/useAccessRules", () => realUseAccessRulesModule);
});

// Test access rule objects
const testReadAccess: AccessRule = {
  id: "test.read",
  resource: "test",
  level: "read",
  description: "Test read access",
  pluginId: "test",
};

const testManageAccess: AccessRule = {
  id: "test.manage",
  resource: "test",
  level: "manage",
  description: "Test manage access",
  pluginId: "test",
};

const otherAccess: AccessRule = {
  id: "other.read",
  resource: "other",
  level: "read",
  description: "Other read access",
  pluginId: "other",
};

describe("AuthAccessApi", () => {
  let accessApi: AuthAccessApi;

  beforeEach(() => {
    accessApi = new AuthAccessApi();
  });

  it("should return true if user has the access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["test.test.read"],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return false if user is missing the access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["other.other.read"],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return false if no session data (no access rules)", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: [],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return false if no user access rules (empty array)", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: [],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return true if user has the wildcard access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["*"],
      loading: false,
    });

    expect(accessApi.useAccess(otherAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return true if user has manage access for a manage check", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["test.test.manage"],
      loading: false,
    });

    expect(accessApi.useAccess(testManageAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return loading state if access rules are loading", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: [],
      loading: true,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: true,
      allowed: false,
    });
  });

  it("should return true if user has manage access for a read check", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["test.test.manage"],
      loading: false,
    });

    // User has test.manage, which implies test.read
    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });
});

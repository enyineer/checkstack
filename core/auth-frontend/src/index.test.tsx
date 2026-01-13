import { describe, it, expect, mock, beforeEach } from "bun:test";
import { authPlugin } from "./index";
import { accessApiRef } from "@checkstack/frontend-api";
import type { AccessRule } from "@checkstack/common";
import { useAccessRules } from "./hooks/useAccessRules";

// Mock the useAccessRules hook
mock.module("./hooks/useAccessRules", () => ({
  useAccessRules: mock(),
}));

// Test access rule objects
const testReadAccess: AccessRule = {
  id: "test.read",
  resource: "test",
  level: "read",
  description: "Test read access",
};

const testManageAccess: AccessRule = {
  id: "test.manage",
  resource: "test",
  level: "manage",
  description: "Test manage access",
};

const otherAccess: AccessRule = {
  id: "other.read",
  resource: "other",
  level: "read",
  description: "Other read access",
};

describe("AuthAccessApi", () => {
  let accessApi: {
    useAccess: (p: AccessRule) => { loading: boolean; allowed: boolean };
  };

  beforeEach(() => {
    const apiDef = authPlugin.apis?.find((a) => a.ref.id === accessApiRef.id);
    if (!apiDef) throw new Error("Access API not found in plugin");
    accessApi = apiDef.factory({ get: () => ({}) } as any) as any;
  });

  it("should return true if user has the access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["test.read"],
      loading: false,
    });

    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return false if user is missing the access rule", () => {
    (useAccessRules as ReturnType<typeof mock>).mockReturnValue({
      accessRules: ["other.read"],
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
      accessRules: ["test.manage"],
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
      accessRules: ["test.manage"],
      loading: false,
    });

    // User has test.manage, which implies test.read
    expect(accessApi.useAccess(testReadAccess)).toEqual({
      loading: false,
      allowed: true,
    });
  });
});

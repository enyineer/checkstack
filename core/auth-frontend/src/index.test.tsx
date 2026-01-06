import { describe, it, expect, mock, beforeEach } from "bun:test";
import { authPlugin } from "./index";
import { permissionApiRef } from "@checkmate-monitor/frontend-api";
import { usePermissions } from "./hooks/usePermissions";

// Mock the usePermissions hook
mock.module("./hooks/usePermissions", () => ({
  usePermissions: mock(),
}));

describe("AuthPermissionApi", () => {
  let permissionApi: {
    usePermission: (p: string) => { loading: boolean; allowed: boolean };
  };

  beforeEach(() => {
    const apiDef = authPlugin.apis?.find(
      (a) => a.ref.id === permissionApiRef.id
    );
    if (!apiDef) throw new Error("Permission API not found in plugin");
    permissionApi = apiDef.factory({ get: () => ({}) } as any) as any;
  });

  it("should return true if user has the permission", () => {
    (usePermissions as ReturnType<typeof mock>).mockReturnValue({
      permissions: ["test.permission"],
      loading: false,
    });

    expect(permissionApi.usePermission("test.permission")).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return false if user is missing the permission", () => {
    (usePermissions as ReturnType<typeof mock>).mockReturnValue({
      permissions: ["other.permission"],
      loading: false,
    });

    expect(permissionApi.usePermission("test.permission")).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return false if no session data (no permissions)", () => {
    (usePermissions as ReturnType<typeof mock>).mockReturnValue({
      permissions: [],
      loading: false,
    });

    expect(permissionApi.usePermission("test.permission")).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return false if no user permissions (empty array)", () => {
    (usePermissions as ReturnType<typeof mock>).mockReturnValue({
      permissions: [],
      loading: false,
    });

    expect(permissionApi.usePermission("test.permission")).toEqual({
      loading: false,
      allowed: false,
    });
  });

  it("should return true if user has the wildcard permission", () => {
    (usePermissions as ReturnType<typeof mock>).mockReturnValue({
      permissions: ["*"],
      loading: false,
    });

    expect(permissionApi.usePermission("any.permission")).toEqual({
      loading: false,
      allowed: true,
    });
  });

  it("should return loading state if permissions are loading", () => {
    (usePermissions as ReturnType<typeof mock>).mockReturnValue({
      permissions: [],
      loading: true,
    });

    expect(permissionApi.usePermission("test.permission")).toEqual({
      loading: true,
      allowed: false,
    });
  });
});

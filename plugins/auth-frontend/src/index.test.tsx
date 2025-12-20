import { describe, it, expect, mock, beforeEach } from "bun:test";
import { authPlugin } from "./index";
import { permissionApiRef } from "@checkmate/frontend-api";
import { authClient } from "./lib/auth-client";

// Mock the auth client
mock.module("./lib/auth-client", () => ({
  authClient: {
    useSession: mock(),
  },
}));

describe("AuthPermissionApi", () => {
  let permissionApi: { usePermission: (p: string) => boolean };

  beforeEach(() => {
    const apiDef = authPlugin.apis?.find(
      (a) => a.ref.id === permissionApiRef.id
    );
    if (!apiDef) throw new Error("Permission API not found in plugin");
    permissionApi = apiDef.factory({ get: () => ({}) } as any) as any;
  });

  it("should return true if user has the permission", () => {
    (authClient.useSession as ReturnType<typeof mock>).mockReturnValue({
      data: {
        user: {
          permissions: ["test.permission"],
        },
      },
    });

    expect(permissionApi.usePermission("test.permission")).toBe(true);
  });

  it("should return false if user is missing the permission", () => {
    (authClient.useSession as ReturnType<typeof mock>).mockReturnValue({
      data: {
        user: {
          permissions: ["other.permission"],
        },
      },
    });

    expect(permissionApi.usePermission("test.permission")).toBe(false);
  });

  it("should return false if no session data", () => {
    (authClient.useSession as ReturnType<typeof mock>).mockReturnValue({
      data: undefined,
    });

    expect(permissionApi.usePermission("test.permission")).toBe(false);
  });

  it("should return false if no user permissions", () => {
    (authClient.useSession as ReturnType<typeof mock>).mockReturnValue({
      data: {
        user: {},
      },
    });

    expect(permissionApi.usePermission("test.permission")).toBe(false);
  });

  it("should return true if user has the wildcard permission", () => {
    (authClient.useSession as ReturnType<typeof mock>).mockReturnValue({
      data: {
        user: {
          permissions: ["*"],
        },
      },
    });

    expect(permissionApi.usePermission("any.permission")).toBe(true);
  });
});

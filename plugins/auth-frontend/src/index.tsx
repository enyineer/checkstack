import {
  ApiRef,
  permissionApiRef,
  PermissionApi,
  createFrontendPlugin,
} from "@checkmate/frontend-api";
import {
  LoginPage,
  LoginNavbarAction,
  LogoutMenuItem,
} from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import { AuthErrorPage } from "./components/AuthErrorPage";
import { authApiRef, AuthApi, AuthSession, AuthClient } from "./api";
import { authClient } from "./lib/auth-client";

import { usePermissions } from "./hooks/usePermissions";
import {
  SLOT_NAVBAR,
  SLOT_USER_MENU_ITEMS,
  SLOT_USER_MENU_ITEMS_BOTTOM,
} from "@checkmate/common";

import { PermissionAction } from "@checkmate/common";
import { useNavigate } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { DropdownMenuItem } from "@checkmate/ui";
import { rpcApiRef, RpcApi, useApi } from "@checkmate/frontend-api";
import { AuthSettingsPage } from "./components/AuthSettingsPage";
import { permissions as authPermissions } from "@checkmate/auth-common";

class AuthPermissionApi implements PermissionApi {
  usePermission(permission: string): { loading: boolean; allowed: boolean } {
    const { permissions, loading } = usePermissions();

    if (loading) {
      return { loading: true, allowed: false };
    }

    // If no user, or user has no permissions, return false
    if (!permissions || permissions.length === 0) {
      return { loading: false, allowed: false };
    }
    const allowed =
      permissions.includes("*") || permissions.includes(permission);
    return { loading: false, allowed };
  }

  useResourcePermission(
    resource: string,
    action: PermissionAction
  ): { loading: boolean; allowed: boolean } {
    const { permissions, loading } = usePermissions();

    if (loading) {
      return { loading: true, allowed: false };
    }

    if (!permissions || permissions.length === 0) {
      return { loading: false, allowed: false };
    }

    const isWildcard = permissions.includes("*");
    const hasResourceManage = permissions.includes(`${resource}.manage`);
    const hasSpecificPermission = permissions.includes(`${resource}.${action}`);

    // manage implies read
    const isAllowed =
      isWildcard ||
      hasResourceManage ||
      (action === "read" && hasResourceManage) ||
      hasSpecificPermission;

    return { loading: false, allowed: isAllowed };
  }

  useManagePermission(resource: string): {
    loading: boolean;
    allowed: boolean;
  } {
    return this.useResourcePermission(resource, "manage");
  }
}

class BetterAuthApi implements AuthApi {
  // Management APIs
  private get rpc(): AuthClient {
    return this.rpcApi.forPlugin<AuthClient>("auth-backend");
  }

  constructor(private readonly rpcApi: RpcApi) {}

  async getEnabledStrategies() {
    return this.rpc.getEnabledStrategies();
  }

  async signIn(email: string, password: string) {
    const res = await authClient.signIn.email({ email, password });
    if (res.error) {
      const error = new Error(res.error.message || res.error.statusText);
      error.name = res.error.code || "AuthError";
      return { data: undefined, error };
    }

    const data = res.data as typeof res.data & {
      session?: AuthSession["session"];
    };
    return {
      data: {
        session: data.session || {
          token: data.token,
          id: "session-id",
          userId: data.user.id,
          expiresAt: new Date(),
        },
        user: data.user,
      } as AuthSession,
      error: undefined,
    };
  }

  async signInWithSocial(provider: string) {
    const frontendUrl =
      import.meta.env.VITE_FRONTEND_URL || "http://localhost:5173";
    await authClient.signIn.social({
      provider,
      callbackURL: frontendUrl,
      errorCallbackURL: `${frontendUrl}/auth/error`,
    });
  }

  async signOut() {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          // Redirect to frontend root after successful logout
          globalThis.location.href = "/";
        },
      },
    });
  }

  async getSession() {
    const res = await authClient.getSession();
    if (res.error) {
      const error = new Error(res.error.message || res.error.statusText);
      error.name = res.error.code || "AuthError";
      return { data: undefined, error };
    }
    if (!res.data) return { data: undefined, error: undefined };

    return {
      data: res.data as AuthSession,
      error: undefined,
    };
  }

  useSession() {
    const { data, isPending, error } = authClient.useSession();
    return {
      data: data as AuthSession | undefined,
      isPending,
      error: error as Error | undefined,
    };
  }

  async getUsers() {
    return this.rpc.getUsers();
  }

  async deleteUser(userId: string) {
    return this.rpc.deleteUser(userId);
  }

  async getRoles() {
    return this.rpc.getRoles();
  }

  async getPermissions() {
    return this.rpc.getPermissions();
  }

  async createRole(params: {
    id: string;
    name: string;
    description?: string;
    permissions: string[];
  }) {
    return this.rpc.createRole(params);
  }

  async updateRole(params: {
    id: string;
    name?: string;
    description?: string;
    permissions: string[];
  }) {
    return this.rpc.updateRole(params);
  }

  async deleteRole(roleId: string) {
    return this.rpc.deleteRole(roleId);
  }

  async updateUserRoles(userId: string, roles: string[]) {
    return this.rpc.updateUserRoles({ userId, roles });
  }

  async getStrategies() {
    return this.rpc.getStrategies();
  }

  async toggleStrategy(id: string, enabled: boolean): Promise<void> {
    await this.rpc.updateStrategy({ id, enabled });
  }

  async updateStrategy(
    id: string,
    updates: { enabled?: boolean; config?: Record<string, unknown> }
  ): Promise<void> {
    // Build request with only provided fields
    const request: {
      id: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    } = { id };
    if (updates.enabled !== undefined) request.enabled = updates.enabled;
    if (updates.config !== undefined) request.config = updates.config;
    await this.rpc.updateStrategy(
      request as Parameters<typeof this.rpc.updateStrategy>[0]
    );
  }

  async reloadAuth(): Promise<void> {
    await this.rpc.reloadAuth();
  }

  async getRegistrationStatus() {
    return this.rpc.getRegistrationStatus();
  }

  async setRegistrationStatus(allowRegistration: boolean) {
    await this.rpc.setRegistrationStatus({ allowRegistration });
  }
}

export const authPlugin = createFrontendPlugin({
  name: "auth-frontend",
  apis: [
    {
      ref: authApiRef as ApiRef<unknown>,
      factory: (deps) => new BetterAuthApi(deps.get(rpcApiRef)),
    },
    {
      ref: permissionApiRef as ApiRef<unknown>,
      factory: () => new AuthPermissionApi(),
    },
  ],
  routes: [
    {
      path: "/auth/login",
      element: <LoginPage />,
    },
    {
      path: "/auth/register",
      element: <RegisterPage />,
    },
    {
      path: "/auth/error",
      element: <AuthErrorPage />,
    },
    {
      path: "/settings/auth",
      element: <AuthSettingsPage />,
    },
  ],
  extensions: [
    {
      id: "auth.navbar.action",
      slotId: SLOT_NAVBAR,
      component: LoginNavbarAction,
    },
    {
      id: "auth.user-menu.settings",
      slotId: SLOT_USER_MENU_ITEMS,
      component: () => {
        // Use a wrapper component to use hooks
        const navigate = useNavigate();
        const permissionApi = useApi(permissionApiRef);
        const canManage = permissionApi.usePermission(
          authPermissions.strategiesManage.id
        );

        if (!canManage.allowed) return;

        return (
          <DropdownMenuItem
            onClick={() => navigate("/settings/auth")}
            icon={<Settings2 className="h-4 w-4" />}
          >
            Auth Settings
          </DropdownMenuItem>
        );
      },
    },
    {
      id: "auth.user-menu.logout",
      slotId: SLOT_USER_MENU_ITEMS_BOTTOM,
      component: LogoutMenuItem,
    },
  ],
});

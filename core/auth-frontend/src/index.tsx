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
import { authApiRef, AuthApi, AuthSession } from "./api";
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
import { useApi } from "@checkmate/frontend-api";
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

/**
 * BetterAuthApi wraps only better-auth client methods.
 * For RPC calls, use rpcApiRef.forPlugin<AuthClient>("auth-backend") directly.
 */
class BetterAuthApi implements AuthApi {
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
}

export const authPlugin = createFrontendPlugin({
  name: "auth-frontend",
  apis: [
    {
      ref: authApiRef as ApiRef<unknown>,
      factory: () => new BetterAuthApi(),
    },
    {
      ref: permissionApiRef as ApiRef<unknown>,
      factory: () => new AuthPermissionApi(),
    },
  ],
  routes: [
    {
      path: "/login",
      element: <LoginPage />,
    },
    {
      path: "/register",
      element: <RegisterPage />,
    },
    {
      path: "/error",
      element: <AuthErrorPage />,
    },
    {
      path: "/settings",
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
            onClick={() => navigate("/auth/settings")}
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

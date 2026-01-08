import {
  ApiRef,
  permissionApiRef,
  PermissionApi,
  createFrontendPlugin,
  NavbarSlot,
  UserMenuItemsSlot,
  UserMenuItemsBottomSlot,
} from "@checkmate-monitor/frontend-api";
import {
  LoginPage,
  LoginNavbarAction,
  LogoutMenuItem,
} from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import { AuthErrorPage } from "./components/AuthErrorPage";
import { ForgotPasswordPage } from "./components/ForgotPasswordPage";
import { ResetPasswordPage } from "./components/ResetPasswordPage";
import { ChangePasswordPage } from "./components/ChangePasswordPage";
import { authApiRef, AuthApi, AuthSession } from "./api";
import { getAuthClientLazy } from "./lib/auth-client";

import { usePermissions } from "./hooks/usePermissions";

import { PermissionAction } from "@checkmate-monitor/common";
import { useNavigate } from "react-router-dom";
import { Settings2, Key } from "lucide-react";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { useApi } from "@checkmate-monitor/frontend-api";
import { AuthSettingsPage } from "./components/AuthSettingsPage";
import {
  permissions as authPermissions,
  authRoutes,
  pluginMetadata,
} from "@checkmate-monitor/auth-common";
import { resolveRoute } from "@checkmate-monitor/common";

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
 * For RPC calls, use rpcApiRef.forPlugin<AuthClient>("auth") directly.
 */
class BetterAuthApi implements AuthApi {
  async signIn(email: string, password: string) {
    const res = await getAuthClientLazy().signIn.email({ email, password });
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
    // Use current origin as callback URL (works in dev and production)
    const frontendUrl = globalThis.location?.origin || "http://localhost:5173";
    await getAuthClientLazy().signIn.social({
      provider,
      callbackURL: frontendUrl,
      errorCallbackURL: `${frontendUrl}${resolveRoute(
        authRoutes.routes.error
      )}`,
    });
  }

  async signOut() {
    await getAuthClientLazy().signOut({
      fetchOptions: {
        onSuccess: () => {
          // Redirect to frontend root after successful logout
          globalThis.location.href = "/";
        },
      },
    });
  }

  async getSession() {
    const res = await getAuthClientLazy().getSession();
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
    const { data, isPending, error } = getAuthClientLazy().useSession();
    return {
      data: data as AuthSession | undefined,
      isPending,
      error: error as Error | undefined,
    };
  }
}

export const authPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
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
      route: authRoutes.routes.login,
      element: <LoginPage />,
    },
    {
      route: authRoutes.routes.register,
      element: <RegisterPage />,
    },
    {
      route: authRoutes.routes.error,
      element: <AuthErrorPage />,
    },
    {
      route: authRoutes.routes.settings,
      element: <AuthSettingsPage />,
    },
    {
      route: authRoutes.routes.forgotPassword,
      element: <ForgotPasswordPage />,
    },
    {
      route: authRoutes.routes.resetPassword,
      element: <ResetPasswordPage />,
    },
    {
      route: authRoutes.routes.changePassword,
      element: <ChangePasswordPage />,
    },
  ],
  extensions: [
    {
      id: "auth.navbar.action",
      slot: NavbarSlot,
      component: LoginNavbarAction,
    },
    {
      id: "auth.user-menu.settings",
      slot: UserMenuItemsSlot,
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
            onClick={() => navigate(resolveRoute(authRoutes.routes.settings))}
            icon={<Settings2 className="h-4 w-4" />}
          >
            Auth Settings
          </DropdownMenuItem>
        );
      },
    },
    {
      id: "auth.user-menu.change-password",
      slot: UserMenuItemsSlot,
      component: () => {
        const navigate = useNavigate();
        // Only show for credential-authenticated users
        // The changePassword API requires current password, so only credential users can use it
        return (
          <DropdownMenuItem
            onClick={() =>
              navigate(resolveRoute(authRoutes.routes.changePassword))
            }
            icon={<Key className="h-4 w-4" />}
          >
            Change Password
          </DropdownMenuItem>
        );
      },
    },
    {
      id: "auth.user-menu.logout",
      slot: UserMenuItemsBottomSlot,
      component: LogoutMenuItem,
    },
  ],
});

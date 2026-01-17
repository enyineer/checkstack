import React from "react";
import {
  ApiRef,
  accessApiRef,
  AccessApi,
  createFrontendPlugin,
  createSlotExtension,
  NavbarRightSlot,
  UserMenuItemsSlot,
  UserMenuItemsBottomSlot,
  NavbarLeftSlot,
} from "@checkstack/frontend-api";
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
import { OnboardingPage } from "./components/OnboardingPage";
import { ProfilePage } from "./components/ProfilePage";
import { authApiRef, AuthApi, AuthSession } from "./api";
import { getAuthClientLazy } from "./lib/auth-client";

import { useAccessRules } from "./hooks/useAccessRules";

import type { AccessRule } from "@checkstack/common";
import { useNavigate } from "react-router-dom";
import { Settings2, User } from "lucide-react";
import { DropdownMenuItem } from "@checkstack/ui";
import { UserMenuItemsContext } from "@checkstack/frontend-api";
import { AuthSettingsPage } from "./components/AuthSettingsPage";
import {
  authAccess,
  authRoutes,
  pluginMetadata,
} from "@checkstack/auth-common";
import { resolveRoute } from "@checkstack/common";
import { OnboardingCheck } from "./components/OnboardingCheck";

/**
 * Unified access API implementation.
 * Uses AccessRule objects for access checks.
 */
class AuthAccessApi implements AccessApi {
  useAccess(accessRule: AccessRule): { loading: boolean; allowed: boolean } {
    const { accessRules, loading } = useAccessRules();

    if (loading) {
      return { loading: true, allowed: false };
    }

    // If no user, or user has no access rules, return false
    if (!accessRules || accessRules.length === 0) {
      return { loading: false, allowed: false };
    }

    const accessRuleId = accessRule.id;

    // Check wildcard, exact match, or manage implies read
    const isWildcard = accessRules.includes("*");
    const hasExact = accessRules.includes(accessRuleId);

    // For read actions, also check if user has manage access for the same resource
    const hasManage =
      accessRule.level === "read"
        ? accessRules.includes(`${accessRule.resource}.manage`)
        : false;

    const allowed = isWildcard || hasExact || hasManage;
    return { loading: false, allowed };
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
    const frontendUrl = globalThis.location?.origin;
    await getAuthClientLazy().signIn.social({
      provider,
      callbackURL: frontendUrl,
      errorCallbackURL: `${frontendUrl}${resolveRoute(
        authRoutes.routes.error,
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

// Re-export TeamAccessEditor for use in other plugins
export { TeamAccessEditor } from "./components/TeamAccessEditor";
export type { TeamAccessEditorProps } from "./components/TeamAccessEditor";

export const authPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  apis: [
    {
      ref: authApiRef as ApiRef<unknown>,
      factory: () => new BetterAuthApi(),
    },
    {
      ref: accessApiRef as ApiRef<unknown>,
      factory: () => new AuthAccessApi(),
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
    {
      route: authRoutes.routes.profile,
      element: <ProfilePage />,
    },
    {
      route: authRoutes.routes.onboarding,
      element: <OnboardingPage />,
    },
  ],
  extensions: [
    {
      id: "auth.navbar.action",
      slot: NavbarRightSlot,
      component: LoginNavbarAction,
    },
    createSlotExtension(UserMenuItemsSlot, {
      id: "auth.user-menu.settings",
      component: ({ accessRules: userPerms }: UserMenuItemsContext) => {
        const navigate = useNavigate();
        const qualifiedId = `${pluginMetadata.pluginId}.${authAccess.strategies.id}`;
        const canManage =
          userPerms.includes("*") || userPerms.includes(qualifiedId);

        if (!canManage) return <React.Fragment />;

        return (
          <DropdownMenuItem
            onClick={() => navigate(resolveRoute(authRoutes.routes.settings))}
            icon={<Settings2 className="h-4 w-4" />}
          >
            Auth Settings
          </DropdownMenuItem>
        );
      },
    }),
    createSlotExtension(UserMenuItemsSlot, {
      id: "auth.user-menu.profile",
      component: () => {
        const navigate = useNavigate();

        return (
          <DropdownMenuItem
            onClick={() => navigate(resolveRoute(authRoutes.routes.profile))}
            icon={<User className="h-4 w-4" />}
          >
            Profile
          </DropdownMenuItem>
        );
      },
    }),
    createSlotExtension(UserMenuItemsBottomSlot, {
      id: "auth.user-menu.logout",
      component: LogoutMenuItem,
    }),
    createSlotExtension(NavbarLeftSlot, {
      id: "auth.onboarding-guard",
      component: OnboardingCheck,
    }),
  ],
});

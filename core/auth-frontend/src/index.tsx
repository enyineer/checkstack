import {
  ApiRef,
  accessApiRef,
  createFrontendPlugin,
  createSlotExtension,
  NavbarRightSlot,
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
import { OAuthConsentPage } from "./components/OAuthConsentPage";
import { authApiRef, AuthApi, AuthSession } from "./api";
import { getAuthClientLazy } from "./lib/auth-client";
import { AuthAccessApi } from "./lib/AuthAccessApi";
import { useSessionContext } from "./lib/SessionProvider";

import { Settings2 } from "lucide-react";
import { AuthSettingsPage } from "./components/AuthSettingsPage";
import {
  authAccess,
  authRoutes,
  pluginMetadata,
} from "@checkstack/auth-common";
import { resolveRoute } from "@checkstack/common";
import { OnboardingCheck } from "./components/OnboardingCheck";

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
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    return useSessionContext();
  }
}

// Re-export TeamAccessEditor for use in other plugins
export { TeamAccessEditor } from "./components/TeamAccessEditor";
export type { TeamAccessEditorProps } from "./components/TeamAccessEditor";

// Re-export SessionProvider for App.tsx to wrap the component tree
export { SessionProvider } from "./lib/SessionProvider";

// Re-export the access-rules hook so the app shell (sidebar) can resolve
// nav visibility from the granted rules in one place.
export { useAccessRules } from "./hooks/useAccessRules";

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
      nav: {
        group: "Configuration",
        icon: Settings2,
        label: "Auth Settings",
        accessRule: authAccess.strategies,
      },
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
    {
      route: authRoutes.routes.oauthConsent,
      element: <OAuthConsentPage />,
    },
  ],
  extensions: [
    {
      id: "auth.navbar.action",
      slot: NavbarRightSlot,
      component: LoginNavbarAction,
    },
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

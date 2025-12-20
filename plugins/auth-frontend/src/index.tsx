import {
  FrontendPlugin,
  ApiRef,
  permissionApiRef,
  PermissionApi,
} from "@checkmate/frontend-api";
import { LoginPage, LoginNavbarAction } from "./components/LoginPage";
import { authApiRef, AuthApi, AuthSession } from "./api";
import { authClient } from "./lib/auth-client";

class AuthPermissionApi implements PermissionApi {
  usePermission(permission: string): boolean {
    const session = authClient.useSession().data as AuthSession | undefined;
    // If no user, or user has no permissions, return false
    if (!session?.user?.permissions) {
      return false;
    }
    return session.user.permissions.includes(permission);
  }
}

class BetterAuthApi implements AuthApi {
  async signIn(email: string, password: string) {
    const res = await authClient.signIn.email({ email, password });
    if (res.error) {
      const error = new Error(res.error.message || res.error.statusText);
      error.name = res.error.code || "AuthError";
      return { data: undefined, error };
    }

    // better-auth returns { user, session, token } on some flows, or just { user, session }
    // We map it to our common AuthSession interface
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

  async signOut() {
    await authClient.signOut();
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

export const authPlugin: FrontendPlugin = {
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
      path: "/auth/login",
      element: <LoginPage />,
    },
  ],
  extensions: [
    {
      id: "auth.navbar.action",
      slotId: "core.layout.navbar",
      component: LoginNavbarAction,
    },
  ],
};

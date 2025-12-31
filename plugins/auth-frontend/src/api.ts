import { createApiRef } from "@checkmate/frontend-api";

// Re-export AuthClient type from common package for RPC usage
export type { AuthClient } from "@checkmate/auth-common";

// Types for better-auth entities
export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
}

export interface AuthSession {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
  };
  user: AuthUser;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem?: boolean;
  permissions?: string[];
}

export interface Permission {
  id: string;
  description?: string;
}

export interface AuthStrategy {
  id: string;
  displayName: string;
  description?: string;
  enabled: boolean;
  configVersion: number;
  configSchema: Record<string, unknown>; // JSON Schema
  config?: Record<string, unknown>;
}

export interface EnabledAuthStrategy {
  id: string;
  displayName: string;
  description?: string;
  type: "credential" | "social";
  icon?: string; // Lucide icon name
  requiresManualRegistration: boolean;
}

/**
 * AuthApi provides better-auth client methods for authentication.
 * For RPC calls (including getEnabledStrategies, user/role/strategy management), use:
 *   const authClient = rpcApiRef.forPlugin<AuthClient>("auth-backend");
 */
export interface AuthApi {
  // Better-auth methods (not RPC)
  signIn(
    email: string,
    password: string
  ): Promise<{ data?: AuthSession; error?: Error }>;
  signInWithSocial(provider: string): Promise<void>;
  signOut(): Promise<void>;
  getSession(): Promise<{ data?: AuthSession; error?: Error }>;
  useSession(): {
    data?: AuthSession;
    isPending: boolean;
    error?: Error;
  };
}

export const authApiRef = createApiRef<AuthApi>("auth.api");

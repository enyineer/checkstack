import { createApiRef } from "@checkstack/frontend-api";
import type { LucideIconName } from "@checkstack/common";

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
  description?: string | null;
  isSystem?: boolean;
  isAssignable?: boolean; // False for anonymous role - not assignable to users
  accessRules?: string[];
}

export interface AccessRuleEntry {
  id: string;
  description?: string;
  /**
   * Whether an anonymous caller can actually use this rule (a public endpoint
   * requires it). When false, granting it to the anonymous role is inert, so the
   * role editor disables it for that role.
   */
  anonymousUsable?: boolean;
}

export interface AuthStrategy {
  id: string;
  displayName: string;
  description?: string;
  icon?: LucideIconName;
  enabled: boolean;
  configVersion: number;
  configSchema: Record<string, unknown>; // JSON Schema
  config?: Record<string, unknown>;
  adminInstructions?: string; // Markdown instructions for admins
}

export interface EnabledAuthStrategy {
  id: string;
  displayName: string;
  description?: string;
  type: "credential" | "social" | "ldap" | "saml";
  icon?: LucideIconName;
  requiresManualRegistration: boolean;
  clientFlow?: AuthClientFlow;
}

export type AuthClientFlow =
  | { type: "oauth" }
  | { type: "redirect"; target: string }
  | {
      type: "form";
      target: string;
      fields: Array<{
        name: string;
        label: string;
        type: "text" | "password";
        placeholder?: string;
      }>;
    }
  | { type: "credential" };

/**
 * AuthApi provides better-auth client methods for authentication.
 * For RPC calls (including getEnabledStrategies, user/role/strategy management), use:
 *   const authClient = rpcApiRef.forPlugin<AuthClient>("auth");
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

import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the auth plugin.
 */
export const authRoutes = createRoutes("auth", {
  login: "/login",
  register: "/register",
  error: "/error",
  settings: "/settings",
  teams: "/teams",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  changePassword: "/change-password",
  profile: "/profile",
  onboarding: "/onboarding",
  /**
   * OAuth 2.1 consent screen for the AI platform's Authorization Server.
   * better-auth's `oidcProvider` redirects the interactive authorization-code
   * flow here (`consentPage: "/auth/oauth-consent"`) with `consent_code`,
   * `client_id`, and `scope` query params; the page POSTs the decision to
   * `/api/auth/oauth2/consent` and follows the returned `redirectURI`.
   */
  oauthConsent: "/oauth-consent",
});

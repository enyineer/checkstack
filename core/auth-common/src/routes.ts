import { createRoutes } from "@checkmate/common";

/**
 * Route definitions for the auth plugin.
 */
export const authRoutes = createRoutes("auth", {
  login: "/login",
  register: "/register",
  error: "/error",
  settings: "/settings",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
});

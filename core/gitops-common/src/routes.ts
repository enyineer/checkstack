import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the GitOps plugin.
 */
export const gitopsRoutes = createRoutes("gitops", {
  home: "/",
  providers: "/providers",
  secrets: "/secrets",
  status: "/status",
  kinds: "/kinds",
});

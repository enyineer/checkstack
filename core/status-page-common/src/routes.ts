import { createRoutes } from "@checkstack/common";

/** Admin builder routes (authenticated). */
export const statusPageRoutes = createRoutes("status-pages", {
  list: "",
  builder: "/:id",
});

/**
 * Public page route (anonymous). Lives under a distinct `/status` prefix and
 * carries NO access rule, so it renders for unauthenticated visitors and only
 * ever calls the single public `getPublishedStatusPage` endpoint. (A fully
 * separate public bundle / custom-domain host routing is the next phase; the
 * data-isolation guarantee is enforced server-side regardless of bundle.)
 */
export const statusPublicRoutes = createRoutes("status", {
  page: "/:slug",
});

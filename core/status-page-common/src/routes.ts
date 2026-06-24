import { createRoutes } from "@checkstack/common";

/**
 * Admin builder routes (authenticated). The id MUST equal the plugin's
 * `pluginId` ("statuspage") - the frontend route registry validates that every
 * registered route belongs to its plugin. URLs: `/statuspage`, `/statuspage/:id`.
 */
export const statusPageRoutes = createRoutes("statuspage", {
  list: "",
  builder: "/:id",
});

/**
 * Public page route (anonymous). Lives under the `/statuspage/view` prefix and
 * carries NO access rule, so it renders for unauthenticated visitors and only
 * ever calls the single public `getPublishedStatusPage` endpoint. The id stays
 * "statuspage" (route ownership), while the `/view/:slug` path keeps it distinct
 * from the builder's `/:id`. The platform serves this prefix via the LEAN public
 * bundle (see `publicPathExtensionPoint`), so loading it never boots the admin
 * app; the data-isolation guarantee is also enforced server-side regardless.
 */
export const statusPublicRoutes = createRoutes("statuspage", {
  page: "/view/:slug",
});

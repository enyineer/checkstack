import { resolveRoute } from "@checkstack/common";
import { statusPublicRoutes } from "@checkstack/status-page-common";
import type { BuildDetailHref } from "./renderers";

/**
 * Detail-page hrefs for a public page served on the ADMIN origin, i.e. under
 * `/statuspage/view/<slug>/...`.
 *
 * The custom-domain bundle builds its own (the page lives at the host root
 * there, so the path has no `/statuspage/view/<slug>` prefix) and passes it in.
 * This is the same computation `backHref` already does on the detail pages,
 * named once so the in-app status page and the in-app detail pages agree.
 *
 * Plain paths, consumed as `<a href>` full navigations rather than router
 * links, because the same components render inside the routerless public
 * bundle.
 */
export function buildInAppDetailHref({ slug }: { slug: string }): BuildDetailHref {
  return ({ kind, id }) =>
    resolveRoute(
      kind === "incident"
        ? statusPublicRoutes.routes.incident
        : statusPublicRoutes.routes.maintenance,
      { slug, id },
    );
}

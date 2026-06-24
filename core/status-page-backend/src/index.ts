import {
  createBackendPlugin,
  coreServices,
  publicHostResolverExtensionPoint,
  publicPathExtensionPoint,
} from "@checkstack/backend-api";
import type { SafeDatabase } from "@checkstack/backend-api";
import { inArray, ilike } from "drizzle-orm";
import {
  pluginMetadata,
  statusPageContract,
  statusPageAccessRules,
  statusPageAccess,
  statusPageRoutes,
} from "@checkstack/status-page-common";
import { resolveRoute } from "@checkstack/common";
import { registerSearchProvider } from "@checkstack/command-backend";
import * as schema from "./schema";
import { statusPages } from "./schema";
import { createStatusPageRouter } from "./router";
import { StatusPageService } from "./service";
import { systemTxtResolver } from "./custom-domain";
import {
  createWidgetTypeRegistry,
  statusWidgetTypeExtensionPoint,
} from "./widget-registry";
import { registerContentWidgets } from "./content-widgets";

const STATUS_PAGE_RESOURCE_TYPE = "statuspage.page";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerAccessRules(statusPageAccessRules);

    // The widget-type registry is created here (register phase) and seeded with
    // the built-ins, then exposed so ANY plugin can contribute widget types via
    // the extension point during its own register/init.
    const registry = createWidgetTypeRegistry();
    registerContentWidgets(registry);
    env.registerExtensionPoint(statusWidgetTypeExtensionPoint, {
      registerWidgetType: (definition, meta) =>
        registry.register(definition, meta),
    });

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        rpcClient: coreServices.rpcClient,
        resourceResolverRegistry: coreServices.resourceResolverRegistry,
      },
      init: async ({
        database,
        rpc,
        logger,
        rpcClient,
        resourceResolverRegistry,
      }) => {
        const db = database as SafeDatabase<typeof schema>;

        const primaryHost = process.env.BASE_URL
          ? new URL(process.env.BASE_URL).hostname.toLowerCase()
          : null;
        const service = new StatusPageService({
          db,
          registry,
          rpcClient,
          logger,
          txtResolver: systemTxtResolver,
          primaryHost,
        });
        const internalUrl =
          process.env.INTERNAL_URL || "http://localhost:3000";
        const router = createStatusPageRouter({ service, internalUrl });
        rpc.registerRouter(router, statusPageContract);

        // Contribute the public-host resolver so a published page with a
        // verified custom domain is served on that host. The platform locks the
        // host down to exactly the public read endpoint below (+ /api/config).
        const publicApiPath = `/api/${pluginMetadata.pluginId}/getPublishedStatusPage`;
        env
          .getExtensionPoint(publicHostResolverExtensionPoint)
          .registerResolver(
            {
              resolve: async (host) => {
                const found = await service.resolveByHost(host);
                if (!found) return null;
                return {
                  pluginId: pluginMetadata.pluginId,
                  bootstrap: { kind: "status-page", slug: found.slug },
                  allowedApiPaths: [publicApiPath],
                };
              },
            },
            pluginMetadata,
          );

        // Declare the same-origin public path prefix so the SPA serves
        // `/statuspage/view/:slug` via the lean public bundle (never booting the
        // admin app). Mirrors `statusPublicRoutes` ("/view/:slug" under the
        // "statuspage" pluginId). The data-isolation guarantee is enforced
        // server-side by `getPublishedStatusPage` regardless.
        env
          .getExtensionPoint(publicPathExtensionPoint)
          .registerPublicPath(
            { pathPrefix: `/${pluginMetadata.pluginId}/view` },
            pluginMetadata,
          );

        // Let the Teams admin resolve `statuspage.page` grants by name + search.
        resourceResolverRegistry.register(STATUS_PAGE_RESOURCE_TYPE, {
          resolveNames: async (ids) => {
            if (ids.length === 0) return new Map();
            const rows = await db
              .select({ id: statusPages.id, title: statusPages.title })
              .from(statusPages)
              .where(inArray(statusPages.id, ids));
            return new Map(rows.map((r) => [r.id, r.title]));
          },
          search: async (query, limit) => {
            const rows = await db
              .select({ id: statusPages.id, name: statusPages.title })
              .from(statusPages)
              .where(ilike(statusPages.title, `%${query}%`))
              .limit(limit);
            return rows;
          },
        });

        // Register the "Status pages" navigation command in the command
        // palette so the sidebar destination is reachable from Cmd+K.
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "list",
              title: "Status pages",
              subtitle: "View and manage public status pages",
              iconName: "MonitorCheck",
              route: resolveRoute(statusPageRoutes.routes.list),
              requiredAccessRules: [statusPageAccess.page.read],
            },
          ],
        });

        logger.debug("✅ Status Pages backend initialized.");
      },
    });
  },
});

export {
  statusWidgetTypeExtensionPoint,
  type StatusWidgetTypeExtensionPoint,
  type WidgetTypeDefinition,
  type WidgetResolveContext,
  type BoundResource,
} from "./widget-registry";
export { statusPageHooks } from "./hooks";

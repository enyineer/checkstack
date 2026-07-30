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
import { notificationAudienceExtensionPoint } from "@checkstack/notification-backend";
import * as schema from "./schema";
import { statusPages } from "./schema";
import { createStatusPageRouter } from "./router";
import { StatusPageService } from "./service";
import { SubscriberService } from "./subscriber-service";
import { createNotificationSubscriberMailer } from "./subscriber-mailer";
import { systemTxtResolver } from "./custom-domain";
import {
  createWidgetTypeRegistry,
  statusWidgetTypeExtensionPoint,
} from "./widget-registry";
import { registerContentWidgets } from "./content-widgets";
import { buildPublicHostApiPaths } from "./public-api-paths";

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
        const baseUrl = process.env.BASE_URL || "http://localhost:3000";
        // Anonymous email subscribers (opt-in per page). Emails go out via the
        // notification-backend `sendRawEmail` primitive using the trusted
        // service client.
        const subscriberService = new SubscriberService({
          db,
          logger,
          mailer: createNotificationSubscriberMailer({ rpcClient, logger }),
          baseUrl,
          registry,
          rpcClient,
        });
        const router = createStatusPageRouter({
          service,
          subscriberService,
          internalUrl,
        });
        rpc.registerRouter(router, statusPageContract);

        // Contribute an EXTERNAL-audience sink so every notification funnelled
        // through notification-backend's `notifyForSubscription` (incident /
        // maintenance / health) also reaches this page's email subscribers -
        // scoped AT SEND TIME to the systems each page currently surfaces
        // (the privacy boundary). The domain plugins stay unchanged; the
        // dependency flows status-page -> notification-backend (both platform).
        env
          .getExtensionPoint(notificationAudienceExtensionPoint)
          .registerAudienceSink(
            {
              deliver: async (audienceEvent) => {
                await subscriberService.notifyForSystems({
                  title: audienceEvent.title,
                  body: audienceEvent.body,
                  systemIds: audienceEvent.systemIds,
                  sourcePluginId: audienceEvent.sourcePluginId,
                  ...(audienceEvent.originEnvironmentId
                    ? { originEnvironmentId: audienceEvent.originEnvironmentId }
                    : {}),
                  ...(audienceEvent.link ? { link: audienceEvent.link } : {}),
                });
              },
            },
            pluginMetadata,
          );

        // Contribute the public-host resolver so a published page with a
        // verified custom domain is served on that host. The platform locks the
        // host down to exactly the public read endpoint below (+ /api/config).
        // The public read endpoints allow-listed on a custom-domain host.
        // Defined and TESTED in `public-api-paths.ts` - an omission there is
        // invisible in the app and only breaks the real customer domain.
        const allowedApiPaths = buildPublicHostApiPaths({
          pluginId: pluginMetadata.pluginId,
        });
        env
          .getExtensionPoint(publicHostResolverExtensionPoint)
          .registerResolver(
            {
              resolve: async (host) => {
                const found = await service.resolveByHost(host);
                if (found) {
                  return {
                    pluginId: pluginMetadata.pluginId,
                    bootstrap: { kind: "status-page", slug: found.slug },
                    allowedApiPaths,
                  };
                }
                // The host is a CONFIGURED custom domain that is not currently
                // servable (unverified, unpublished, or non-public). Still claim
                // it so the platform serves the lean public "not available"
                // bundle instead of falling through to the admin SPA (whose
                // cross-origin /api/config probe CORS-blocks). We leak nothing:
                // no slug, only that this domain has no live status page.
                const configured = await service.isConfiguredDomain(host);
                if (!configured) return null;
                return {
                  pluginId: pluginMetadata.pluginId,
                  bootstrap: { kind: "status-page", unavailable: true },
                  allowedApiPaths,
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

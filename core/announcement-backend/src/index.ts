import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import {
  pluginMetadata,
  announcementContract,
  announcementAccessRules,
  announcementAccess,
  announcementRoutes,
} from "@checkstack/announcement-common";
import { resolveRoute } from "@checkstack/common";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { createAnnouncementRouter } from "./router";
import { createAnnouncementCache, type AnnouncementCache } from "./cache";
import { authHooks } from "@checkstack/auth-backend";
import { registerSearchProvider } from "@checkstack/command-backend";
import { statusWidgetTypeExtensionPoint } from "@checkstack/status-page-backend";
import { registerAnnouncementStatusWidgets } from "./status-page-widget";
import type { SafeDatabase } from "@checkstack/backend-api";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Register access rules
    env.registerAccessRules(announcementAccessRules);

    // Status-page "Announcements" widget, owned by announcement-backend (it
    // owns announcements + their public-safe projection). Buffered behind the
    // status-page extension point - status-page never depends on announcement.
    registerAnnouncementStatusWidgets(
      env.getExtensionPoint(statusWidgetTypeExtensionPoint),
    );

    let announcementCache: AnnouncementCache | undefined;

    env.registerInit({
      schema,
      deps: {
        rpc: coreServices.rpc,
        logger: coreServices.logger,
        signalService: coreServices.signalService,
        cacheManager: coreServices.cacheManager,
      },
      init: async ({ database, rpc, signalService, logger, cacheManager }) => {
        const db = database as SafeDatabase<typeof schema>;

        const cache = createAnnouncementCache({ cacheManager, logger });
        announcementCache = cache;

        // Create and register the announcement router
        const router = createAnnouncementRouter(db, signalService, cache);
        rpc.registerRouter(router, announcementContract);

        // Register commands in the command palette
        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "create",
              title: "Create Announcement",
              subtitle: "Create a new portal announcement",
              iconName: "Megaphone",
              route:
                resolveRoute(announcementRoutes.routes.manage) +
                "?action=create",
              requiredAccessRules: [announcementAccess.manage],
            },
            {
              id: "manage",
              title: "Manage Announcements",
              subtitle: "View and manage portal announcements",
              iconName: "Megaphone",
              shortcuts: ["meta+shift+a", "ctrl+shift+a"],
              route: resolveRoute(announcementRoutes.routes.manage),
              requiredAccessRules: [announcementAccess.manage],
            },
          ],
        });
      },
      afterPluginsReady: async ({ database, logger, onHook }) => {
        const db = database as SafeDatabase<typeof schema>;

        // Clean up dismissals when a user is deleted
        onHook(
          authHooks.userDeleted,
          async ({ userId }) => {
            logger.debug(
              `Cleaning up announcement dismissals for deleted user: ${userId}`,
            );
            await db
              .delete(schema.announcementDismissals)
              .where(eq(schema.announcementDismissals.userId, userId));
            await announcementCache?.invalidateUserActive(userId);
            logger.debug(
              `Cleaned up announcement dismissals for user: ${userId}`,
            );
          },
          { mode: "work-queue", workerGroup: "user-cleanup" },
        );

        logger.debug("✅ Announcement Backend afterPluginsReady complete.");
      },
    });
  },
});

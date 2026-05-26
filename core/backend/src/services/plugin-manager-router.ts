import { implement, ORPCError } from "@orpc/server";
import { desc } from "drizzle-orm";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  coreServices,
  type RpcContext,
  type SafeDatabase,
} from "@checkstack/backend-api";
import {
  pluginManagerContract,
  type InstalledPlugin,
} from "@checkstack/pluginmanager-common";
import {
  pluginPackageTypeSchema,
  pluginSourceSchema,
} from "@checkstack/common";
import type { PluginManager } from "../plugin-manager";
import type { ServiceRegistry } from "./service-registry";
import type { PluginEventRecorder } from "./plugin-event-recorder";
import { plugins } from "../schema";
import {
  installOriginator,
  previewInstallOriginator,
  previewUninstallOriginator,
  uninstallOriginator,
} from "./plugin-manager-orchestrator";
import {
  PluginInstallError,
  type PluginInstallErrorCode,
} from "./plugin-installers/plugin-install-error";

/**
 * Map our installer/orchestrator error codes onto the closest oRPC error
 * codes so the UI sees a meaningful HTTP status + message instead of a
 * generic `INTERNAL_SERVER_ERROR`.
 *
 * oRPC's built-in `ORPCError` codes match common HTTP semantics; we route
 * `COMPATIBILITY_FAILED` and `VALIDATION_FAILED` to `BAD_REQUEST` because
 * neither is a server fault — both indicate user-correctable input.
 */
const ORPC_CODE_MAP: Record<
  PluginInstallErrorCode,
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "BAD_GATEWAY"
  | "NOT_IMPLEMENTED"
> = {
  NOT_FOUND: "NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  BAD_GATEWAY: "BAD_GATEWAY",
  VALIDATION_FAILED: "BAD_REQUEST",
  COMPATIBILITY_FAILED: "BAD_REQUEST",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
};

/**
 * Run an originator function and translate any `PluginInstallError` into
 * an `ORPCError` with the right code + the user-facing message intact.
 * Other errors propagate untouched and surface as 500s — those represent
 * genuine bugs and stay loud.
 */
async function withTranslatedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PluginInstallError) {
      const data: Record<string, unknown> = { kind: error.code };
      if (error.details) Object.assign(data, error.details);
      throw new ORPCError(ORPC_CODE_MAP[error.code], {
        message: error.message,
        data,
      });
    }
    throw error;
  }
}

/**
 * oRPC router that backs `pluginManagerContract`.
 *
 * Lives in `core/backend` because it directly references the in-process
 * `PluginManager` instance. Wired into the request pipeline via
 * `pluginManager.registerCoreRouter("pluginmanager", ...)`.
 */
export function createPluginManagerRouter({
  db,
  pluginManager,
  registry,
  eventRecorder,
  workspaceRoot,
  runtimeDir,
}: {
  db: SafeDatabase<Record<string, unknown>>;
  pluginManager: PluginManager;
  registry: ServiceRegistry;
  eventRecorder: PluginEventRecorder;
  workspaceRoot: string;
  runtimeDir: string;
}) {
  // touch coreServices to keep the import alive in case future router
  // procedures need to resolve services on demand.
  void coreServices;

  const impl = implement(pluginManagerContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return impl.router({
    list: impl.list.handler(async () => {
      const rows = await db
        .select()
        .from(plugins)
        .orderBy(desc(plugins.id));
      const list: InstalledPlugin[] = rows.map((row) => {
        // type may legitimately not match the enum for legacy/tooling rows
        // — fall back to a safe value rather than 500-ing on parse.
        const typeParsed = pluginPackageTypeSchema.safeParse(row.type);
        // metadata is JSONB; drizzle returns `unknown | null`. The contract
        // declares it as `optional()` (accepts undefined, NOT null), so
        // coerce. Also accept only objects — string/number/array would fail
        // schema validation.
        const metadata =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? (row.metadata as InstalledPlugin["metadata"])
            : undefined;
        // source: null for monorepo-local; validated PluginSource for
        // runtime-installed. Wrap parse in safeParse so a malformed
        // legacy row doesn't break the whole list response.
        const sourceParsed = row.source
          ? pluginSourceSchema.safeParse(row.source)
          : undefined;
        return {
          name: row.name,
          version: row.version ?? "",
          type: typeParsed.success ? typeParsed.data : "backend",
          enabled: row.enabled,
          isUninstallable: row.isUninstallable,
          isPrimary: row.isPrimary,
          bundleId: row.bundleId,
          source: sourceParsed?.success ? sourceParsed.data : null,
          metadata,
        };
      });
      return { plugins: list };
    }),

    previewInstall: impl.previewInstall.handler(({ input }) =>
      withTranslatedErrors(() =>
        previewInstallOriginator({
          source: input.source,
          registry,
          workspaceRoot,
          runtimeDir,
        }),
      ),
    ),

    install: impl.install.handler(async ({ input, context }) => {
      const userId = (context.user as { id?: string } | undefined)?.id;
      const result = await withTranslatedErrors(() =>
        installOriginator({
          source: input.source,
          pluginManager,
          db,
          registry,
          workspaceRoot,
          runtimeDir,
          eventRecorder,
          userId,
        }),
      );
      return {
        success: true,
        bundleId: result.bundleId,
        installedPackages: result.installedPackages,
      };
    }),

    previewUninstall: impl.previewUninstall.handler(({ input }) =>
      withTranslatedErrors(() =>
        previewUninstallOriginator({
          pluginName: input.pluginName,
          db,
        }),
      ),
    ),

    uninstall: impl.uninstall.handler(async ({ input, context }) => {
      const userId = (context.user as { id?: string } | undefined)?.id;
      const result = await withTranslatedErrors(() =>
        uninstallOriginator({
          pluginName: input.pluginName,
          deleteSchema: input.deleteSchema,
          deleteConfigs: input.deleteConfigs,
          cascade: input.cascade,
          pluginManager,
          db,
          eventRecorder,
          userId,
        }),
      );
      return { success: true, uninstalledPackages: result.uninstalledPackages };
    }),

    events: impl.events.handler(async ({ input }) => {
      const events = await eventRecorder.list({
        pluginName: input.pluginName,
        limit: input.limit,
      });
      return { events };
    }),
  });
}

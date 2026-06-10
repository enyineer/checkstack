import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { statusPageContract } from "@checkstack/status-page-common";
import { statusPageHooks } from "./hooks";
import {
  createUserScopedRpcClient,
  forwardableAuthHeadersFrom,
} from "./user-client";
import type { StatusPageService } from "./service";

const os = implement(statusPageContract)
  .$context<RpcContext>()
  .use(correlationMiddleware)
  .use(autoAuthMiddleware);

export interface StatusPageRouterDeps {
  service: StatusPageService;
  /** Loopback base URL for the user-scoped publish gate. */
  internalUrl: string;
}

export function createStatusPageRouter({
  service,
  internalUrl,
}: StatusPageRouterDeps) {
  const listStatusPages = os.listStatusPages.handler(async () => ({
    pages: await service.list(),
  }));

  const getStatusPage = os.getStatusPage.handler(async ({ input }) =>
    service.get(input.id),
  );

  const createStatusPage = os.createStatusPage.handler(async ({ input }) => {
    // `teamId` is consumed by the create-mode middleware (it resolves + writes
    // the owning-team grant); the table has no team column, so strip it here.
    const { teamId: _teamId, ...rest } = input;
    return service.create(rest);
  });

  const updateStatusPage = os.updateStatusPage.handler(async ({ input }) =>
    service.update(input),
  );

  const publishStatusPage = os.publishStatusPage.handler(
    async ({ input, context }) => {
      const userClient = createUserScopedRpcClient({
        internalUrl,
        forwardHeaders: forwardableAuthHeadersFrom(context.requestHeaders),
      });
      const { page, exposed } = await service.publish({
        id: input.id,
        userClient,
      });
      const publishedBy = context.user
        ? context.user.type === "service"
          ? `service:${context.user.pluginId}`
          : context.user.id
        : "system";
      await context.emitHook(statusPageHooks.published, {
        pageId: page.id,
        slug: page.slug,
        exposedResources: exposed.map((b) => `${b.resourceType}:${b.resourceId}`),
        publishedBy,
        publishedAt: page.publishedAt ?? new Date().toISOString(),
      });
      return page;
    },
  );

  const unpublishStatusPage = os.unpublishStatusPage.handler(
    async ({ input }) => service.unpublish(input.id),
  );

  const deleteStatusPage = os.deleteStatusPage.handler(async ({ input }) => ({
    deleted: await service.remove(input.id),
  }));

  const listWidgetTypes = os.listWidgetTypes.handler(async () => ({
    widgetTypes: service.listWidgetTypes(),
  }));

  const getPublishedStatusPage = os.getPublishedStatusPage.handler(
    async ({ input, context }) => {
      const isAuthenticated =
        context.user?.type === "user" || context.user?.type === "application";
      return service.resolvePublished({ slug: input.slug, isAuthenticated });
    },
  );

  return {
    listStatusPages,
    getStatusPage,
    createStatusPage,
    updateStatusPage,
    publishStatusPage,
    unpublishStatusPage,
    deleteStatusPage,
    listWidgetTypes,
    getPublishedStatusPage,
  };
}

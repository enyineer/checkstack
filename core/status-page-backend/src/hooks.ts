import { createHook } from "@checkstack/backend-api";

/**
 * Status-page hooks for cross-plugin audit. Publishing a page is a deliberate
 * PUBLIC-EXPOSURE action; an audit-log plugin can subscribe to record exactly
 * which resources a page exposed, when, and by whom.
 */
export const statusPageHooks = {
  published: createHook<{
    pageId: string;
    slug: string;
    /** Qualified `type:id` of every resource the published widgets expose. */
    exposedResources: string[];
    publishedBy: string;
    publishedAt: string;
  }>("statuspage.page.published"),
} as const;

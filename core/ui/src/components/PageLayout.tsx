import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Page,
  PageHeader,
  PageContent,
  LoadingSpinner,
  AccessDenied,
} from "..";
import type { BreadcrumbItem } from "./Breadcrumb";
import { cn } from "../utils";

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  actions?: React.ReactNode;
  loading?: boolean;
  allowed?: boolean;
  children: React.ReactNode;
  /**
   * Optional breadcrumb trail rendered above the page title. Opt-in: pages
   * without this prop are unchanged.
   */
  breadcrumbs?: BreadcrumbItem[];
  /** SPA navigation handler for breadcrumb link clicks. */
  onBreadcrumbNavigate?: (to: string) => void;
  /**
   * Make the content area fill the viewport height instead of growing with its
   * content. The page's own children then own their scrolling (e.g. a chat
   * message list), so the page itself never scrolls. Use for full-height app
   * surfaces (chat, canvases); leave off for normal document-flow pages, which
   * scroll the main area as usual. Relies on the bounded height chain in
   * core/frontend's App shell.
   */
  fillHeight?: boolean;
  maxWidth?:
    | "sm"
    | "md"
    | "lg"
    | "xl"
    | "2xl"
    | "3xl"
    | "4xl"
    | "5xl"
    | "6xl"
    | "7xl"
    | "full";
}

export const PageLayout: React.FC<PageLayoutProps> = ({
  title,
  subtitle,
  icon,
  actions,
  loading,
  allowed,
  children,
  breadcrumbs,
  onBreadcrumbNavigate,
  fillHeight = false,
  maxWidth = "7xl",
}) => {
  // If loading is explicitly true, show loading state
  // If loading is undefined and allowed is false, also show loading state
  // (this prevents "Access Denied" flash when access rules are still being fetched)
  const isLoading =
    loading === true || (loading === undefined && allowed === false);

  if (isLoading) {
    return (
      <Page>
        <PageHeader
          title={title}
          subtitle={subtitle}
          icon={icon}
          actions={actions}
          breadcrumbs={breadcrumbs}
          onBreadcrumbNavigate={onBreadcrumbNavigate}
        />
        <PageContent>
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        </PageContent>
      </Page>
    );
  }

  // Only show access denied when loading is explicitly false and allowed is false
  if (allowed === false) {
    return (
      <Page>
        <PageHeader
          title={title}
          subtitle={subtitle}
          icon={icon}
          actions={actions}
          breadcrumbs={breadcrumbs}
          onBreadcrumbNavigate={onBreadcrumbNavigate}
        />
        <PageContent>
          <AccessDenied />
        </PageContent>
      </Page>
    );
  }

  return (
    <Page className={fillHeight ? "min-h-0" : undefined}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={actions}
        breadcrumbs={breadcrumbs}
        onBreadcrumbNavigate={onBreadcrumbNavigate}
      />
      <PageContent
        className={fillHeight ? "flex min-h-0 flex-col" : undefined}
      >
        <div
          className={cn(
            maxWidth === "full" ? undefined : `max-w-${maxWidth}`,
            // fillHeight: fill the bounded content area and let children scroll.
            // Otherwise: normal document flow with vertical rhythm.
            fillHeight ? "flex min-h-0 flex-1 flex-col" : "space-y-6",
          )}
        >
          {children}
        </div>
      </PageContent>
    </Page>
  );
};

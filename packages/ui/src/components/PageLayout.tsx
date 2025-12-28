import React from "react";
import {
  Page,
  PageHeader,
  PageContent,
  LoadingSpinner,
  PermissionDenied,
} from "..";

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  loading?: boolean;
  allowed?: boolean;
  children: React.ReactNode;
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
  actions,
  loading,
  allowed = true,
  children,
  maxWidth = "3xl",
}) => {
  if (loading) {
    return (
      <Page>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        <PageContent>
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        </PageContent>
      </Page>
    );
  }

  if (!allowed) {
    return (
      <Page>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        <PageContent>
          <PermissionDenied />
        </PageContent>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <PageContent>
        <div
          className={maxWidth === "full" ? "" : `max-w-${maxWidth} space-y-6`}
        >
          {children}
        </div>
      </PageContent>
    </Page>
  );
};

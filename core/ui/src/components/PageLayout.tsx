import React from "react";
import {
  Page,
  PageHeader,
  PageContent,
  LoadingSpinner,
  AccessDenied,
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
  allowed,
  children,
  maxWidth = "3xl",
}) => {
  // If loading is explicitly true, show loading state
  // If loading is undefined and allowed is false, also show loading state
  // (this prevents "Access Denied" flash when access rules are still being fetched)
  const isLoading =
    loading === true || (loading === undefined && allowed === false);

  if (isLoading) {
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

  // Only show access denied when loading is explicitly false and allowed is false
  if (allowed === false) {
    return (
      <Page>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        <PageContent>
          <AccessDenied />
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

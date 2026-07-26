import { useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  wrapInSuspense,
  accessApiRef,
  useApi,
  useSlotExtensions,
  ExtensionComponent,
} from "@checkstack/frontend-api";
import { InfrastructureTabsSlot } from "@checkstack/infrastructure-common";
import { PageLayout } from "@checkstack/ui";
import { Server } from "lucide-react";
import { InfrastructureTabRail } from "../components/InfrastructureTabRail";
import { AccessDeniedCard } from "../components/AccessDeniedCard";

/**
 * Infrastructure Settings page — IDE Editor pattern.
 *
 * Renders a vertical tab bar on the left with content area on the right.
 * Each tab is contributed by a plugin (queue, cache, …) via an extension
 * registered into `InfrastructureTabsSlot`. The shell page is plugin-agnostic
 * and only depends on the slot contract in `@checkstack/infrastructure-common`.
 */
const InfrastructureConfigPageContent = () => {
  const accessApi = useApi(accessApiRef);
  const tabs = useSlotExtensions(InfrastructureTabsSlot);

  const sortedTabs = useMemo(
    () =>
      tabs.toSorted(
        (a, b) => (a.metadata.order ?? 100) - (b.metadata.order ?? 100),
      ),
    [tabs],
  );

  // Per-tab access lookup (read + manage). Hooks must be called in stable
  // order, so we map over `sortedTabs` — the registry is append-only during
  // a session aside from explicit lifecycle changes, which trigger a full
  // re-render via `useSlotExtensions`.
  const tabAccess = sortedTabs.map((ext) => ({
    extension: ext,
    readResult: accessApi.useAccess(ext.metadata.readAccess),
    manageResult: accessApi.useAccess(ext.metadata.manageAccess),
  }));

  const visibleTabs = useMemo(
    () => tabAccess.filter(({ readResult }) => readResult.allowed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabAccess.map(({ readResult }) => readResult.allowed).join(",")],
  );

  const isLoading = tabAccess.some(({ readResult }) => readResult.loading);
  const hasAnyAccess = visibleTabs.length > 0;

  // The active tab is driven by the `?tab=<extension-id>` search param so it is
  // linkable, bookmarkable, and restored on reload. Falls back to the first
  // visible tab when the param is absent or points at an unknown/hidden tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTabId = searchParams.get("tab");
  const effectiveActiveTabId =
    visibleTabs.find((t) => t.extension.id === requestedTabId)?.extension.id ??
    visibleTabs[0]?.extension.id;
  const activeTabEntry = visibleTabs.find(
    (t) => t.extension.id === effectiveActiveTabId,
  );

  const selectTab = (tabId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tabId);
    setSearchParams(next, { replace: true });
  };

  if (!isLoading && !hasAnyAccess) {
    return (
      <PageLayout
        title="Infrastructure Settings"
        subtitle="Configure core infrastructure services"
        icon={Server}
        loading={false}
        allowed={false}
      >
        <AccessDeniedCard />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Infrastructure Settings"
      subtitle="Configure core infrastructure services"
      icon={Server}
      loading={isLoading}
      allowed={hasAnyAccess}
    >
      <div className="flex gap-6 min-h-[600px]">
        <InfrastructureTabRail
          tabs={visibleTabs.map(({ extension }) => ({
            id: extension.id,
            label: extension.metadata.label,
            icon: extension.metadata.icon,
          }))}
          activeTabId={effectiveActiveTabId}
          onSelect={selectTab}
        />

        <div className="flex-1 min-w-0">
          {activeTabEntry && (
            <ExtensionComponent
              extension={activeTabEntry.extension}
              context={{ canUpdate: activeTabEntry.manageResult.allowed }}
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
};

export const InfrastructureConfigPage = wrapInSuspense(
  InfrastructureConfigPageContent,
);

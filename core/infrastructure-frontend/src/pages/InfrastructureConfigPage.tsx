import { useState, useMemo } from "react";
import {
  wrapInSuspense,
  accessApiRef,
  useApi,
  useSlotExtensions,
} from "@checkstack/frontend-api";
import { InfrastructureTabsSlot } from "@checkstack/infrastructure-common";
import { PageLayout, cn } from "@checkstack/ui";
import { Server, ShieldOff } from "lucide-react";

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

  const [activeTabId, setActiveTabId] = useState<string>();
  const effectiveActiveTabId =
    activeTabId ?? visibleTabs[0]?.extension.id;
  const activeTabEntry = visibleTabs.find(
    (t) => t.extension.id === effectiveActiveTabId,
  );

  if (!isLoading && !hasAnyAccess) {
    return (
      <PageLayout
        title="Infrastructure Settings"
        subtitle="Configure core infrastructure services"
        icon={Server}
        loading={false}
        allowed={false}
      >
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
          <ShieldOff className="h-12 w-12" />
          <p className="text-lg font-medium">Access Denied</p>
          <p className="text-sm">
            You don&apos;t have permission to view any infrastructure settings.
          </p>
        </div>
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
        <nav className="flex flex-col gap-1 w-52 shrink-0 border-r border-border pr-4">
          {visibleTabs.map(({ extension }) => {
            const Icon = extension.metadata.icon;
            const isActive = extension.id === effectiveActiveTabId;
            return (
              <button
                key={extension.id}
                onClick={() => setActiveTabId(extension.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {extension.metadata.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {activeTabEntry && (
            <activeTabEntry.extension.component
              canUpdate={activeTabEntry.manageResult.allowed}
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

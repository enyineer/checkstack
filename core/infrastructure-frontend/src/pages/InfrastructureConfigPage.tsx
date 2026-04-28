import { useState, useMemo } from "react";
import {
  wrapInSuspense,
  accessApiRef,
  useApi,
} from "@checkstack/frontend-api";
import { getInfrastructureTabs } from "@checkstack/infrastructure-common";
import {
  PageLayout,
  cn,
} from "@checkstack/ui";
import { Server, ShieldOff } from "lucide-react";

/**
 * Infrastructure Configuration page — IDE Editor pattern.
 *
 * Renders a vertical tab bar on the left with content area on the right.
 * Each tab is registered by plugins (queue, cache, etc.) with its own access rules.
 * The page only shows tabs the user has read access to.
 */
const InfrastructureConfigPageContent = () => {
  const accessApi = useApi(accessApiRef);
  const allTabs = getInfrastructureTabs();

  // Check access for each tab
  const tabAccess = allTabs.map((tab) => ({
    tab,
    readResult: accessApi.useAccess(tab.readAccess),
    manageResult: accessApi.useAccess(tab.manageAccess),
  }));

  // Filter to visible tabs
  const visibleTabs = useMemo(
    () =>
      tabAccess.filter(({ readResult }) => readResult.allowed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabAccess.map(({ readResult }) => readResult.allowed).join(",")],
  );

  const isLoading = tabAccess.some(({ readResult }) => readResult.loading);
  const hasAnyAccess = visibleTabs.length > 0;

  const [activeTabId, setActiveTabId] = useState<string>();

  // Default to first visible tab
  const effectiveActiveTabId = activeTabId ?? visibleTabs[0]?.tab.id;
  const activeTabEntry = visibleTabs.find(
    (t) => t.tab.id === effectiveActiveTabId,
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
        {/* Tab Bar */}
        <nav className="flex flex-col gap-1 w-52 shrink-0 border-r border-border pr-4">
          {visibleTabs.map(({ tab }) => {
            const Icon = tab.icon;
            const isActive = tab.id === effectiveActiveTabId;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Tab Content */}
        <div className="flex-1 min-w-0">
          {activeTabEntry && (
            <activeTabEntry.tab.component
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

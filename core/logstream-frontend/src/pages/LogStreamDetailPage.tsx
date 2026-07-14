import { usePluginClient } from "@checkstack/frontend-api";
import {
  PageLayout,
  Tabs,
  TabPanel,
  BackLink,
  QueryErrorState,
  Skeleton,
} from "@checkstack/ui";
import {
  ScrollText,
  LayoutDashboard,
  Search,
  Boxes,
  Settings,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LogstreamApi, type ImportantEvent } from "@checkstack/logstream-common";
import { EXPLORE_PARAMS, EXPLORE_TAB_VALUE } from "../lib/explore-link";
import { OverviewTab } from "../components/tabs/OverviewTab";
import { ExploreTab } from "../components/tabs/ExploreTab";
import { PatternsTab } from "../components/tabs/PatternsTab";
import { SettingsTab } from "../components/tabs/SettingsTab";

const TAB_IDS = ["overview", "explore", "patterns", "settings"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_ITEMS = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" /> },
  { id: "explore", label: "Explore", icon: <Search className="size-4" /> },
  { id: "patterns", label: "Patterns", icon: <Boxes className="size-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="size-4" /> },
];

/**
 * Stream detail with Overview / Explore / Patterns / Settings tabs. The active
 * tab and the explorer's deep-link filters live in the URL, so a link to a
 * pattern (or an important event) opens the explorer already filtered.
 */
export function LogStreamDetailPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const client = usePluginClient(LogstreamApi);

  // gcTime:0 so the Settings form's one-shot seeding never races a warm cache
  // (see the query-invalidation rule for init-once editor loaders).
  const {
    data: stream,
    isLoading,
    isError,
    error,
    refetch,
  } = client.getStream.useQuery(
    { id: streamId ?? "" },
    { enabled: !!streamId, gcTime: 0 },
  );

  const requestedTab = searchParams.get(EXPLORE_PARAMS.tab);
  const activeTab: TabId = (TAB_IDS as readonly string[]).includes(
    requestedTab ?? "",
  )
    ? (requestedTab as TabId)
    : "overview";

  const selectTab = (tabId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(EXPLORE_PARAMS.tab, tabId);
    // Drop stale explore deep-link params when leaving the explorer.
    if (tabId !== EXPLORE_TAB_VALUE) {
      next.delete(EXPLORE_PARAMS.pattern);
      next.delete(EXPLORE_PARAMS.traceId);
      next.delete(EXPLORE_PARAMS.from);
      next.delete(EXPLORE_PARAMS.to);
    }
    setSearchParams(next, { replace: true });
  };

  const goToExplore = (params: {
    patternId?: string;
    traceId?: string;
    from?: Date;
    to?: Date;
  }) => {
    const next = new URLSearchParams(searchParams);
    next.set(EXPLORE_PARAMS.tab, EXPLORE_TAB_VALUE);
    if (params.patternId) next.set(EXPLORE_PARAMS.pattern, params.patternId);
    else next.delete(EXPLORE_PARAMS.pattern);
    // Always clear a stale trace filter (e.g. from a bookmarked correlations
    // link) unless this jump explicitly carries one, so a "explore this pattern"
    // jump never silently ANDs in a leftover trace id.
    if (params.traceId) next.set(EXPLORE_PARAMS.traceId, params.traceId);
    else next.delete(EXPLORE_PARAMS.traceId);
    if (params.from) next.set(EXPLORE_PARAMS.from, params.from.toISOString());
    else next.delete(EXPLORE_PARAMS.from);
    if (params.to) next.set(EXPLORE_PARAMS.to, params.to.toISOString());
    else next.delete(EXPLORE_PARAMS.to);
    setSearchParams(next, { replace: false });
  };

  const onExploreEvent = (event: ImportantEvent) => {
    const ts = new Date(event.ts);
    goToExplore({
      patternId: event.patternId ?? undefined,
      from: new Date(ts.getTime() - 5 * 60 * 1000),
      to: new Date(ts.getTime() + 60 * 1000),
    });
  };

  const initialPattern = searchParams.get(EXPLORE_PARAMS.pattern);
  const initialTraceId = searchParams.get(EXPLORE_PARAMS.traceId);
  const initialFrom = searchParams.get(EXPLORE_PARAMS.from);
  const initialTo = searchParams.get(EXPLORE_PARAMS.to);

  return (
    <PageLayout
      title={stream?.name ?? "Log stream"}
      subtitle={stream?.description ?? undefined}
      icon={ScrollText}
      loading={isLoading}
    >
      <div className="space-y-4">
        {/* onClick + navigate = SPA routing; BackLink's `to` prop renders a
            raw anchor and would full-page-reload (repo convention: see the
            healthcheck history pages). */}
        <BackLink onClick={() => navigate("/logstream")}>
          Back to streams
        </BackLink>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton variant="card" />
            <Skeleton variant="chart" />
          </div>
        ) : isError || !stream ? (
          <QueryErrorState
            error={error}
            resource="stream"
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            <Tabs
              items={TAB_ITEMS}
              activeTab={activeTab}
              onTabChange={selectTab}
            />

            <TabPanel id="overview" activeTab={activeTab}>
              <OverviewTab
                streamId={stream.id}
                onExploreEvent={onExploreEvent}
                onExplorePattern={(patternId) => goToExplore({ patternId })}
              />
            </TabPanel>

            <TabPanel id="explore" activeTab={activeTab}>
              <ExploreTab
                streamId={stream.id}
                initialPatternId={initialPattern}
                initialTraceId={initialTraceId}
                initialFrom={initialFrom ? new Date(initialFrom) : null}
                initialTo={initialTo ? new Date(initialTo) : null}
              />
            </TabPanel>

            <TabPanel id="patterns" activeTab={activeTab}>
              <PatternsTab
                streamId={stream.id}
                onExplorePattern={(patternId) => goToExplore({ patternId })}
              />
            </TabPanel>

            <TabPanel id="settings" activeTab={activeTab}>
              <SettingsTab stream={stream} />
            </TabPanel>
          </>
        )}
      </div>
    </PageLayout>
  );
}

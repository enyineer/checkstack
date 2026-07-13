import { usePluginClient } from "@checkstack/frontend-api";
import {
  PageLayout,
  Tabs,
  TabPanel,
  BackLink,
  QueryErrorState,
  Skeleton,
} from "@checkstack/ui";
import { Gauge, LayoutDashboard, Boxes, Radio, Settings } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MetricstreamApi } from "@checkstack/metricstream-common";
import { OverviewTab } from "../components/tabs/OverviewTab";
import { MetricsTab } from "../components/tabs/MetricsTab";
import { SourcesTab } from "../components/tabs/SourcesTab";
import { SettingsTab } from "../components/tabs/SettingsTab";

const TAB_IDS = ["overview", "metrics", "sources", "settings"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_ITEMS = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" /> },
  { id: "metrics", label: "Metrics", icon: <Boxes className="size-4" /> },
  { id: "sources", label: "Sources", icon: <Radio className="size-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="size-4" /> },
];

/**
 * Metric-stream detail with Overview / Metrics / Sources / Settings tabs. The
 * active tab lives in the URL, so a link opens the right tab directly.
 */
export function MetricStreamDetailPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const client = usePluginClient(MetricstreamApi);

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

  const requestedTab = searchParams.get("tab");
  const activeTab: TabId = (TAB_IDS as readonly string[]).includes(
    requestedTab ?? "",
  )
    ? (requestedTab as TabId)
    : "overview";

  const selectTab = (tabId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tabId);
    setSearchParams(next, { replace: true });
  };

  return (
    <PageLayout
      title={stream?.name ?? "Metric stream"}
      subtitle={stream?.description ?? undefined}
      icon={Gauge}
      loading={isLoading}
    >
      <div className="space-y-4">
        {/* onClick + navigate = SPA routing; BackLink's `to` prop renders a
            raw anchor and would full-page-reload (repo convention). */}
        <BackLink onClick={() => navigate("/metricstream")}>
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
            <Tabs items={TAB_ITEMS} activeTab={activeTab} onTabChange={selectTab} />

            <TabPanel id="overview" activeTab={activeTab}>
              <OverviewTab streamId={stream.id} />
            </TabPanel>

            <TabPanel id="metrics" activeTab={activeTab}>
              <MetricsTab streamId={stream.id} />
            </TabPanel>

            <TabPanel id="sources" activeTab={activeTab}>
              <SourcesTab stream={stream} />
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

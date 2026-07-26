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
  Waypoints,
  LayoutDashboard,
  ListTree,
  Network,
  Radio,
  Settings,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { TracestreamApi } from "@checkstack/tracestream-common";
import { OverviewTab } from "../components/tabs/OverviewTab";
import { TracesTab } from "../components/tabs/TracesTab";
import { ServicesTab } from "../components/tabs/ServicesTab";
import { SourcesTab } from "../components/tabs/SourcesTab";
import { SettingsTab } from "../components/tabs/SettingsTab";

const TAB_IDS = ["overview", "traces", "services", "sources", "settings"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_ITEMS = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" /> },
  { id: "traces", label: "Traces", icon: <ListTree className="size-4" /> },
  { id: "services", label: "Services", icon: <Network className="size-4" /> },
  { id: "sources", label: "Sources", icon: <Radio className="size-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="size-4" /> },
];

/**
 * Trace-stream detail with Overview / Traces / Services / Sources / Settings
 * tabs. The active tab, the opened trace id and a service deep-link all live in
 * the URL, so a link opens the right tab (and trace) directly.
 */
export function TraceStreamDetailPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const client = usePluginClient(TracestreamApi);

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
    // Leaving the Traces tab drops the opened-trace deep link.
    if (tabId !== "traces") next.delete("trace");
    setSearchParams(next, { replace: true });
  };

  const openTrace = (traceId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "traces");
    next.set("trace", traceId);
    setSearchParams(next, { replace: true });
  };

  const setOpenTraceParam = (traceId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (traceId) next.set("trace", traceId);
    else next.delete("trace");
    setSearchParams(next, { replace: true });
  };

  const initialTraceId = searchParams.get("trace");
  const initialService = searchParams.get("service");

  return (
    <PageLayout
      title={stream?.name ?? "Trace stream"}
      subtitle={stream?.description ?? undefined}
      icon={Waypoints}
      loading={isLoading}
    >
      <div className="space-y-4">
        <BackLink onClick={() => navigate("/tracestream")}>
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
              <OverviewTab streamId={stream.id} onOpenTrace={openTrace} />
            </TabPanel>

            <TabPanel id="traces" activeTab={activeTab}>
              <TracesTab
                key={stream.id}
                streamId={stream.id}
                initialTraceId={initialTraceId}
                initialServiceName={initialService}
                onOpenTraceChange={setOpenTraceParam}
              />
            </TabPanel>

            <TabPanel id="services" activeTab={activeTab}>
              <ServicesTab streamId={stream.id} />
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

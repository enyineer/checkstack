import React from "react";
import {
  History,
  CheckCircle,
  XCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  PageLayout,
  Card,
  CardContent,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  ResponsiveTable,
  MobileCardList,
  cn,
} from "@checkstack/ui";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  PluginManagerApi,
  pluginManagerAccess,
  type InstallEventStatus,
} from "@checkstack/pluginmanager-common";
import {
  EVENT_TONE_STYLES,
  eventTone,
} from "../components/eventDisplay.logic";

/**
 * Per-status icon for the lifecycle status pill. The pill's hue + dot come from
 * the colorblind-safe triad (via {@link eventTone}); the icon adds a third
 * encoding so status is never color alone.
 */
const EVENT_STATUS_ICONS: Record<InstallEventStatus, LucideIcon> = {
  started: Loader2,
  succeeded: CheckCircle,
  failed: XCircle,
};

const PluginEventStatus: React.FC<{ status: InstallEventStatus }> = ({
  status,
}) => {
  const tone = eventTone({ status });
  const styles = EVENT_TONE_STYLES[tone];
  const Icon = EVENT_STATUS_ICONS[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill,
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {status}
    </span>
  );
};

const PluginEventsPageContent: React.FC = () => {
  const client = usePluginClient(PluginManagerApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    pluginManagerAccess.view,
  );
  const { data, isLoading } = client.events.useQuery({ limit: 200 });

  if (accessLoading || isLoading) {
    return (
      <PageLayout title="Plugin events" icon={History} loading allowed={allowed}>
        <div />
      </PageLayout>
    );
  }

  const events = data?.events ?? [];

  return (
    <PageLayout title="Plugin events" icon={History} allowed={allowed}>
      {events.length === 0 ? (
        <EmptyState
          icon={<History className="w-12 h-12" />}
          title="No plugin events yet"
          description="Whenever a plugin is installed, uninstalled, enabled, or fails to load, the lifecycle event lands here with phase, status and any error message. Useful for diagnosing why a freshly installed plugin didn't show up where you expected."
        />
      ) : (
        <>
          <ResponsiveTable>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1 p-0" />
                      <TableHead>When</TableHead>
                      <TableHead>Plugin</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Phase</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Instance</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e) => {
                      const tone = eventTone({ status: e.status });
                      return (
                        <TableRow
                          key={e.id}
                          className="transition-colors hover:bg-surface-inset"
                        >
                          <TableCell className="w-1 p-0">
                            <span
                              className={cn(
                                "block h-full w-1",
                                EVENT_TONE_STYLES[tone].accent,
                              )}
                              aria-hidden
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                            {new Date(e.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-medium text-foreground">
                            {e.pluginName ?? "—"}
                          </TableCell>
                          <TableCell>{e.action}</TableCell>
                          <TableCell>
                            <code className="text-xs">{e.phase}</code>
                          </TableCell>
                          <TableCell>
                            <PluginEventStatus status={e.status} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {e.instanceId}
                          </TableCell>
                          <TableCell className="max-w-xs">
                            {e.error ? (
                              <span className="block truncate rounded bg-status-down/5 px-1.5 py-0.5 text-xs text-status-down">
                                {e.error}
                              </span>
                            ) : (
                              ""
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </ResponsiveTable>

          <MobileCardList>
            {events.map((e) => {
              const tone = eventTone({ status: e.status });
              return (
                <div key={e.id} className="group">
                  <div className="relative flex flex-col overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-1",
                        EVENT_TONE_STYLES[tone].accent,
                      )}
                      aria-hidden
                    />
                    <div className="flex items-start justify-between gap-2 pl-2">
                      <span className="font-medium text-foreground truncate">
                        {e.pluginName ?? "—"}
                      </span>
                      <PluginEventStatus status={e.status} />
                    </div>
                    <div className="mt-1 pl-2 text-xs text-muted-foreground">
                      {e.action} - <code className="text-xs">{e.phase}</code>
                    </div>
                    <div className="mt-1 pl-2 font-mono text-xs text-muted-foreground tabular-nums">
                      {new Date(e.createdAt).toLocaleString()}
                    </div>
                    <div className="mt-1 pl-2 text-xs text-muted-foreground">
                      Instance: {e.instanceId}
                    </div>
                    {e.error && (
                      <div className="mt-2 ml-2 rounded bg-status-down/5 px-2 py-1 text-xs text-status-down break-words">
                        {e.error}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </MobileCardList>
        </>
      )}
    </PageLayout>
  );
};

export const PluginEventsPage = wrapInSuspense(PluginEventsPageContent);

import React from "react";
import { History } from "lucide-react";
import {
  PageLayout,
  Card,
  CardContent,
  Badge,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
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

const statusVariant: Record<
  InstallEventStatus,
  "default" | "secondary" | "destructive" | "info"
> = {
  started: "info",
  succeeded: "default",
  failed: "destructive",
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
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(e.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{e.pluginName ?? "—"}</TableCell>
                    <TableCell>{e.action}</TableCell>
                    <TableCell>
                      <code className="text-xs">{e.phase}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[e.status]}>{e.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{e.instanceId}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-xs truncate">
                      {e.error ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
};

export const PluginEventsPage = wrapInSuspense(PluginEventsPageContent);

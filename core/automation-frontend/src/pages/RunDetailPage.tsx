import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  XCircle,
  Clock,
  History,
  Hourglass,
  StopCircle,
} from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  automationAccess,
  automationRoutes,
} from "@checkstack/automation-common";
import type { StepStatus, RunStatus } from "@checkstack/automation-common";
import {
  PageLayout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  CodeEditor,
  LoadingSpinner,
  QueryErrorState,
  EmptyState,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { formatDistanceToNow } from "date-fns";

const noop = (): void => {
  return;
};

const STEP_STATUS_ICON: Record<StepStatus, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  running: CircleDot,
  success: CheckCircle2,
  failed: XCircle,
  skipped: StopCircle,
  waiting: Hourglass,
};

const STEP_STATUS_COLOR: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  success: "text-emerald-500",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
  waiting: "text-amber-500",
};

const RUN_STATUS_VARIANT: Record<
  RunStatus,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  pending: "outline",
  running: "secondary",
  waiting: "warning",
  success: "success",
  failed: "destructive",
  cancelled: "outline",
  skipped: "outline",
};

/**
 * Drill into a single automation run. Layout:
 *
 *   - Header (status, trigger event, started/finished).
 *   - If the run failed, surface the `errorMessage` as an Alert at the top.
 *   - Step timeline — one row per `AutomationRunStep` with status icon,
 *     action kind, attempts, and the action's `errorMessage` inline when
 *     it failed. The result payload (typically the artifact data) is shown
 *     as collapsible JSON beneath the row when present.
 *   - Trigger payload as a read-only JSON `CodeEditor`.
 *   - Artifacts panel listing every `AutomationArtifact` the run produced,
 *     keyed by `artifactType`.
 */
const RunDetailContent: React.FC = () => {
  const { automationId, runId } = useParams<{
    automationId: string;
    runId: string;
  }>();
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    automationAccess.read,
  );
  const { allowed: canManage } = accessApi.useAccess(automationAccess.manage);

  const query = client.getRun.useQuery(
    { id: runId ?? "" },
    { enabled: Boolean(runId) },
  );

  const cancelMutation = client.cancelRun.useMutation();

  if (!automationId || !runId) {
    return (
      <PageLayout title="Run not found" icon={History} allowed={false}>
        <EmptyState
          icon={<History className="h-8 w-8 text-muted-foreground" />}
          title="Missing run id"
          description="The URL is malformed."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={query.data ? `Run ${query.data.run.id.slice(0, 8)}` : "Run"}
      subtitle={
        query.data
          ? `Triggered by ${query.data.run.triggerEventId || "manual run"}`
          : undefined
      }
      icon={History}
      loading={accessLoading}
      allowed={allowed}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to={resolveRoute(automationRoutes.routes.runs, { automationId })}
          >
            <Button variant="outline" size="sm">
              <ChevronLeft className="mr-1 h-4 w-4" />
              All runs
            </Button>
          </Link>
          {canManage &&
            query.data &&
            (query.data.run.status === "running" ||
              query.data.run.status === "waiting") && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancelMutation.mutate({ id: runId })}
                disabled={cancelMutation.isPending}
              >
                Cancel run
              </Button>
            )}
        </div>
      }
    >
      {query.isLoading ? (
        <LoadingSpinner />
      ) : query.isError ? (
        <QueryErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data ? (
        <div className="flex flex-col gap-4">
          <RunHeader run={query.data.run} />

          {query.data.run.errorMessage && (
            <Alert variant="error">
              <AlertTitle>Run failed</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap font-mono text-xs">
                {query.data.run.errorMessage}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Steps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {query.data.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No steps recorded.
                </p>
              ) : (
                query.data.steps.map((step) => <StepRow key={step.id} step={step} />)
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-base">Trigger payload</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <CodeEditor
                  value={JSON.stringify(query.data.run.triggerPayload, null, 2)}
                  onChange={noop}
                  language="json"
                  readOnly
                  minHeight="240px"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-base">
                  Artifacts ({query.data.artifacts.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-3">
                {query.data.artifacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    This run produced no artifacts.
                  </p>
                ) : (
                  query.data.artifacts.map((artifact) => (
                    <details
                      key={artifact.id}
                      className="rounded border border-border bg-card"
                    >
                      <summary className="flex cursor-pointer items-center justify-between px-2 py-1 text-xs">
                        <Badge variant="outline" className="font-mono">
                          {artifact.artifactType}
                        </Badge>
                        {artifact.actionId && (
                          <code className="font-mono text-muted-foreground">
                            {artifact.actionId}
                          </code>
                        )}
                      </summary>
                      <pre className="overflow-x-auto p-2 text-xs">
                        {JSON.stringify(artifact.data, null, 2)}
                      </pre>
                    </details>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
};

const RunHeader: React.FC<{
  run: { status: RunStatus; startedAt: Date; finishedAt?: Date };
}> = ({ run }) => (
  <Card>
    <CardContent className="flex flex-wrap items-center gap-4 p-4">
      <Badge variant={RUN_STATUS_VARIANT[run.status]} className="capitalize">
        {run.status}
      </Badge>
      <div className="flex flex-col text-xs text-muted-foreground">
        <span>
          Started{" "}
          {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
        </span>
        {run.finishedAt && (
          <span>
            Finished{" "}
            {formatDistanceToNow(new Date(run.finishedAt), { addSuffix: true })}
          </span>
        )}
      </div>
    </CardContent>
  </Card>
);

const StepRow: React.FC<{
  step: {
    id: string;
    actionPath: string;
    actionKind: string;
    providerActionId: string | null;
    actionId: string | null;
    status: StepStatus;
    attempts: number;
    errorMessage?: string;
    resultPayload?: Record<string, unknown>;
  };
}> = ({ step }) => {
  const Icon = STEP_STATUS_ICON[step.status];
  const colorClass = STEP_STATUS_COLOR[step.status];

  return (
    <div className="rounded border border-border bg-card">
      <div className="flex items-start gap-2 p-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colorClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="truncate font-mono text-xs">
              {step.actionPath}
            </code>
            <Badge variant="outline" className="text-[10px]">
              {step.providerActionId ?? step.actionKind}
            </Badge>
            {step.actionId && (
              <Badge variant="secondary" className="text-[10px]">
                id: {step.actionId}
              </Badge>
            )}
            {step.attempts > 1 && (
              <span className="text-[10px] text-muted-foreground">
                {step.attempts} attempts
              </span>
            )}
          </div>
          {step.errorMessage && (
            <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-destructive">
              {step.errorMessage}
            </p>
          )}
        </div>
      </div>
      {step.resultPayload && Object.keys(step.resultPayload).length > 0 && (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted-foreground">
            Result payload
          </summary>
          <pre className="overflow-x-auto p-2 text-xs">
            {JSON.stringify(step.resultPayload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export const RunDetailPage = wrapInSuspense(RunDetailContent);

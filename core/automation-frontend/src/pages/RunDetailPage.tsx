import React from "react";
import { Link, useParams } from "react-router";
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
  cn,
} from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { formatDistanceToNow } from "date-fns";
import {
  RunStatusPill,
  RUN_STATUS_TONE,
  RUN_TONE_STYLES,
} from "./run-status-pill";
import { formatDuration } from "./run-duration";

const noop = (): void => {
  return;
};

/**
 * Poll interval for a live (`running`/`waiting`) run. Polling stops the moment
 * the run reaches a terminal status, so a finished run makes no further calls.
 */
const RUN_POLL_INTERVAL_MS = 2000;

const STEP_STATUS_ICON: Record<StepStatus, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  running: CircleDot,
  success: CheckCircle2,
  failed: XCircle,
  skipped: StopCircle,
  waiting: Hourglass,
};

// Step status icons carry the signal via shape + the status triad hue (never
// hue alone): terminal outcomes map to the colorblind-safe status colors, while
// in-flight/neutral lifecycle states stay muted/primary.
const STEP_STATUS_COLOR: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  success: "text-status-ok",
  failed: "text-status-down",
  skipped: "text-muted-foreground",
  waiting: "text-status-warn",
};

// Left status-accent for each step, mirroring STEP_STATUS_COLOR's tone intent
// so a failed/waiting step reads down the timeline's left edge by position +
// hue, not the icon alone. Neutral lifecycle states stay muted. Spelled out as
// full literal strings so Tailwind's JIT keeps them.
const STEP_STATUS_ACCENT: Record<StepStatus, string> = {
  pending: "bg-muted-foreground/40",
  running: "bg-primary",
  success: "bg-status-ok",
  failed: "bg-status-down",
  skipped: "bg-muted-foreground/40",
  waiting: "bg-status-warn",
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

  const query = client.getRun.useQuery(
    { id: runId ?? "", automationId: automationId ?? "" },
    {
      enabled: Boolean(runId) && Boolean(automationId),
      // Live runs only: poll every 2s while the run is `running`/`waiting` so a
      // user watching an execution sees steps progress without a manual reload.
      // Returning `false` on a terminal status stops the polling entirely.
      refetchInterval: (query) => {
        const status = query.state.data?.run.status;
        return status === "running" || status === "waiting"
          ? RUN_POLL_INTERVAL_MS
          : false;
      },
    },
  );

  const isLive =
    query.data?.run.status === "running" ||
    query.data?.run.status === "waiting";

  // Fuse the cancel gate onto the mutation: `cancelRun` is `parentScope`d on the
  // owning automation (MANAGE), so the verdict derives from THIS page's
  // `automationId` - a team-scoped manager (grant on this automation, no global
  // rule) can cancel their own run, which a bare `useAccess(manage)` on the
  // global rule would wrongly hide.
  const cancelMutation = client.cancelRun.useGatedMutation({
    gateInput: automationId ? { automationId } : undefined,
  });

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
          {isLive && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <CircleDot className="h-3.5 w-3.5" />
              Live
            </span>
          )}
          <Link
            to={resolveRoute(automationRoutes.routes.runs, { automationId })}
          >
            <Button variant="outline" size="sm">
              <ChevronLeft className="mr-1 h-4 w-4" />
              All runs
            </Button>
          </Link>
          {cancelMutation.allowed &&
            query.data &&
            (query.data.run.status === "running" ||
              query.data.run.status === "waiting") && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  cancelMutation.mutate({ id: runId, automationId })
                }
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
                      className="rounded border border-border bg-surface-inset"
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
}> = ({ run }) => {
  const accent = RUN_TONE_STYLES[RUN_STATUS_TONE[run.status]].accent;
  const duration = formatDuration(run.startedAt, run.finishedAt);

  return (
    <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
      {/* Status accent stripe, matching the run-status pill's tone. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accent)}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-4 pl-2">
        <div>
          <p className="text-3xl font-bold leading-none tabular-nums text-foreground">
            {duration}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">duration</p>
        </div>
        <RunStatusPill status={run.status} />
      </div>
      <div className="mt-4 flex flex-col gap-0.5 pl-2 text-xs text-muted-foreground">
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
    </div>
  );
};

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
  const accentClass = STEP_STATUS_ACCENT[step.status];

  return (
    <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface">
      {/* Step status accent: failed/waiting read down the left edge by hue. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accentClass)}
        aria-hidden
      />
      <div className="flex items-start gap-2 p-2 pl-4">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", colorClass)} />
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
        <details className="border-t border-border/70">
          <summary className="cursor-pointer px-2 py-1 pl-4 text-[10px] text-muted-foreground">
            Result payload
          </summary>
          <pre className="overflow-x-auto p-2 pl-4 text-xs">
            {JSON.stringify(step.resultPayload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export const RunDetailPage = wrapInSuspense(RunDetailContent);

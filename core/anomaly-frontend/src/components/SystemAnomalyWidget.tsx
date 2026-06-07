import React from "react";
import {
  usePluginClient,
  useApi,
  accessApiRef,
  type SlotContext,
} from "@checkstack/frontend-api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import {
  AnomalyApi,
  anomalyAccess,
  type AnomalyDto,
} from "@checkstack/anomaly-common";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  useToast,
} from "@checkstack/ui";
import {
  Activity,
  AlertTriangle,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  LineChart,
  Bell,
  BellOff,
  EyeOff,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";

type Props = SlotContext<typeof SystemDetailsSlot>;

// ─────────────────────────────────────────────────────────────────────────────
// Field Path Humanization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a raw anomaly field path like
 *   `collectors.healthcheck-http.request.responseTimeMs`
 * into structured display info:
 *   { label: "Response Time", source: "HTTP Request", strategy: "healthcheck-http" }
 */
function parseFieldPath(fieldPath: string): {
  label: string;
  source: string;
  strategy: string;
} {
  // Field paths follow the pattern: collectors.<strategyId>.<collectorId>.<fieldName>
  const parts = fieldPath.split(".");

  if (parts[0] !== "collectors" || parts.length < 3) {
    return { label: fieldPath, source: "", strategy: "" };
  }

  const strategyId = parts[1]; // e.g. "healthcheck-http"
  const fieldName = parts.at(-1) ?? fieldPath; // e.g. "responseTimeMs"

  // Extract collector id (everything between strategy and field)
  const collectorParts = parts.slice(2, -1); // e.g. ["request"]
  const collectorId = collectorParts.join(" "); // e.g. "request"

  return {
    label: humanizeFieldName(fieldName),
    source: humanizeCollectorSource(strategyId, collectorId),
    strategy: strategyId,
  };
}

/** Convert camelCase/snake_case field names to human-readable labels */
function humanizeFieldName(name: string): string {
  // Strip common suffixes for cleaner display
  const cleaned = name
    .replace(/Ms$/, "")
    .replace(/Seconds$/, "")
    .replace(/Bytes$/, "")
    .replace(/Count$/, "");

  // camelCase → spaces
  const spaced = cleaned.replaceAll(/([a-z])([A-Z])/g, "$1 $2");

  // snake_case → spaces
  const words = spaced.replaceAll("_", " ");

  // Capitalize
  return words
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function humanizeCollectorSource(strategyId: string, collectorId: string): string {
  const cleanStrategy = strategyId.replace(/^healthcheck-/, "").toUpperCase();

  if (collectorId) {
    const cleanCollector = collectorId
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return `${cleanStrategy} · ${cleanCollector}`;
  }

  return cleanStrategy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly Row Component
// ─────────────────────────────────────────────────────────────────────────────

function AnomalyRow({
  anomaly,
  systemId,
  isMuted,
  onToggleMute,
  isToggling,
  onSuppress,
  isSuppressing,
  canMute,
  canManage,
}: {
  anomaly: AnomalyDto;
  systemId: string;
  isMuted: boolean;
  onToggleMute: (fieldPath: string, isMuted: boolean) => void;
  isToggling: boolean;
  onSuppress: (anomalyId: string) => void;
  isSuppressing: boolean;
  /** Whether the user may mute notifications (any logged-in user). */
  canMute: boolean;
  /** Whether the user may suppress the anomaly (anomalyAccess.feed.manage). */
  canManage: boolean;
}) {
  const isSuspicious = anomaly.state === "suspicious";
  const isDrift = anomaly.kind === "drift";
  const parsed = parseFieldPath(anomaly.fieldPath);
  const deviationValue = anomaly.deviation?.toFixed(1) ?? "—";
  const isAbove = anomaly.direction === "above";

  const detailLink = resolveRoute(healthcheckRoutes.routes.historyDetail, {
    systemId,
    configurationId: anomaly.configurationId,
  });

  const StateIcon = isDrift
    ? LineChart
    : isSuspicious
      ? HelpCircle
      : AlertTriangle;

  return (
    <Link
      to={detailLink}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
    >
      {/* State icon */}
      <div className={`shrink-0 rounded-full p-1.5 ${
        isSuspicious
          ? "bg-warning/10 text-warning/70"
          : "bg-warning/15 text-warning"
      }`}>
        <StateIcon className="h-3.5 w-3.5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {parsed.label}
          </span>
          {parsed.source ? (
            <span className="text-[10px] text-muted-foreground bg-muted/80 px-1.5 py-0.5 rounded font-medium shrink-0">
              {parsed.source}
            </span>
          ) : undefined}
          {isDrift && (
            <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded font-medium shrink-0">
              drift
            </span>
          )}
          {isMuted && (
            <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded font-medium shrink-0 inline-flex items-center gap-0.5">
              <BellOff className="h-2.5 w-2.5" />
              muted
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          {isDrift ? (
            <span>
              Trending {isAbove ? "up" : "down"} from baseline {anomaly.baselineValue?.toFixed(1) ?? "—"}
            </span>
          ) : (
            <>
              <span className="font-mono tabular-nums">{anomaly.observedValue}</span>
              <span className="opacity-50">
                {isAbove ? "↑" : "↓"} baseline {anomaly.baselineValue?.toFixed(1)}
              </span>
            </>
          )}
          <span className="opacity-40">·</span>
          <span>
            {isSuspicious ? "Detected" : "Confirmed"}{" "}
            {formatDistanceToNow(
              new Date(isSuspicious ? anomaly.startedAt : (anomaly.confirmedAt ?? anomaly.startedAt)),
              { addSuffix: true },
            )}
          </span>
        </div>
      </div>

      {/* Deviation badge + mute toggle + arrow */}
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant={isSuspicious ? "outline" : "warning"}
          className={`text-[10px] h-5 px-1.5 font-mono tabular-nums gap-1 ${
            isSuspicious ? "border-warning/40 text-warning" : ""
          }`}
        >
          {isAbove ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : (
            <TrendingDown className="h-2.5 w-2.5" />
          )}
          {deviationValue}σ
        </Badge>
        {canMute && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            disabled={isToggling}
            title={
              isMuted
                ? "Unmute notifications for this field"
                : "Mute notifications for this field"
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleMute(anomaly.fieldPath, isMuted);
            }}
          >
            {isMuted ? (
              <BellOff className="h-3.5 w-3.5" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {canManage && !isSuspicious && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            disabled={isSuppressing}
            title="Suppress this anomaly until it changes again"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSuppress(anomaly.id);
            }}
          >
            <EyeOff className="h-3.5 w-3.5" />
          </Button>
        )}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Widget
// ─────────────────────────────────────────────────────────────────────────────

export const SystemAnomalyWidget: React.FC<Props> = ({ system }) => {
  const anomalyClient = usePluginClient(AnomalyApi);
  const toast = useToast();
  const accessApi = useApi(accessApiRef);
  // Muting notifications is a per-user preference any LOGGED-IN user may set
  // (contract: userType "user", access []), so it is gated on authentication,
  // not on manage. Suppressing an anomaly is an operator action gated on
  // anomalyAccess.feed.manage. Anonymous visitors get neither. The server
  // enforces both regardless.
  const { isAuthenticated: canMute } = accessApi.useIsAuthenticated();
  const { allowed: canManage } = accessApi.useAccess(anomalyAccess.feed.manage);

  // Fetch only active anomalies — exclude recovered ones.
  // Two queries with React Query deduplication: confirmed anomalies + suspicious.
  const { data: confirmedAnomalies = [], isLoading: loadingConfirmed } =
    anomalyClient.getAnomalies.useQuery(
      { systemId: system.id, state: "anomaly", limit: 10 },
      { staleTime: 30_000 },
    );

  const { data: suspiciousAnomalies = [], isLoading: loadingSuspicious } =
    anomalyClient.getAnomalies.useQuery(
      { systemId: system.id, state: "suspicious", limit: 10 },
      { staleTime: 30_000 },
    );

  const { data: mutes = [], refetch: refetchMutes } =
    anomalyClient.listAnomalyNotificationMutes.useQuery(
      { systemId: system.id },
      { staleTime: 30_000 },
    );

  const mutedFields = React.useMemo(
    () => new Set(mutes.map((m) => m.fieldPath)),
    [mutes],
  );
  const isSystemMuted = mutedFields.has("");

  const muteMutation = anomalyClient.muteAnomalyNotification.useMutation({
    onSuccess: () => {
      void refetchMutes();
    },
    onError: () => {
      toast.error("Failed to mute notifications");
    },
  });

  const unmuteMutation = anomalyClient.unmuteAnomalyNotification.useMutation({
    onSuccess: () => {
      void refetchMutes();
    },
    onError: () => {
      toast.error("Failed to unmute notifications");
    },
  });

  const handleToggleMute = (fieldPath: string, currentlyMuted: boolean) => {
    if (currentlyMuted) {
      unmuteMutation.mutate({ systemId: system.id, fieldPath });
    } else {
      muteMutation.mutate({ systemId: system.id, fieldPath });
    }
  };

  // Suppressing removes the row from the active feed. The mutation invalidates
  // the anomaly plugin's own queries on success, so the active list (which
  // defaults to the "active" suppression filter) refetches without the row.
  const suppressMutation = anomalyClient.suppressAnomaly.useMutation({
    onError: () => {
      toast.error("Failed to suppress anomaly");
    },
  });

  const handleSuppress = (anomalyId: string) => {
    suppressMutation.mutate({ systemId: system.id, anomalyId });
  };

  const isLoading = loadingConfirmed || loadingSuspicious;

  // Confirmed anomalies first, then suspicious
  const activeAnomalies = [...confirmedAnomalies, ...suspiciousAnomalies];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            System Anomalies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
            Loading anomalies...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activeAnomalies.length === 0) {
    return <></>;
  }

  const confirmedCount = confirmedAnomalies.length;
  const suspiciousCount = suspiciousAnomalies.length;

  const isToggling = muteMutation.isPending || unmuteMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-warning" />
            System Anomalies
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {confirmedCount > 0 && (
              <Badge variant="warning" className="text-[10px] h-5 px-1.5 gap-1">
                <AlertTriangle className="h-2.5 w-2.5" />
                {confirmedCount}
              </Badge>
            )}
            {suspiciousCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] h-5 px-1.5 gap-1 border-warning/40 text-warning"
              >
                <HelpCircle className="h-2.5 w-2.5" />
                {suspiciousCount}
              </Badge>
            )}
            {canMute && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] gap-1"
                disabled={isToggling}
                title={
                  isSystemMuted
                    ? "Resume anomaly notifications for this system"
                    : "Stop receiving any anomaly notifications for this system"
                }
                onClick={() => handleToggleMute("", isSystemMuted)}
              >
                {isSystemMuted ? (
                  <>
                    <BellOff className="h-3 w-3" />
                    Muted
                  </>
                ) : (
                  <>
                    <Bell className="h-3 w-3" />
                    Mute all
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-col divide-y">
          {activeAnomalies.map((anomaly) => (
            <AnomalyRow
              key={anomaly.id}
              anomaly={anomaly}
              systemId={system.id}
              isMuted={isSystemMuted || mutedFields.has(anomaly.fieldPath)}
              onToggleMute={handleToggleMute}
              isToggling={isToggling}
              onSuppress={handleSuppress}
              isSuppressing={suppressMutation.isPending}
              canMute={canMute}
              canManage={canManage}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

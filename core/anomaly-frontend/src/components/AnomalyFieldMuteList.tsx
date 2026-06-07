import React from "react";
import { Bell, BellOff } from "lucide-react";
import { Button, useToast } from "@checkstack/ui";
import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import { AnomalyApi } from "@checkstack/anomaly-common";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Sub-controls panel rendered inside the generic SubscriptionRow when a
 * user is reachable for `anomaly.system`. Lists the system's currently
 * tracked anomaly fields with per-field mute toggles. Mutes survive
 * unsubscribe (they're a separate per-(systemId, fieldPath) record).
 *
 * The list is built from existing baselines + active anomalies — fields
 * the user has never seen activity on aren't shown to avoid an
 * unbounded picker. A user who needs to mute proactively can do it from
 * the inline bell button on each anomaly row in the system widget.
 */
export const AnomalyFieldMuteList: React.FC<{
  resource: { systemId: string };
}> = ({ resource }) => {
  const { systemId } = resource;
  const anomalyClient = usePluginClient(AnomalyApi);
  const toast = useToast();
  // Muting is a per-user preference for logged-in users only; anonymous
  // visitors (e.g. reaching this via a direct link) get no mute controls.
  const accessApi = useApi(accessApiRef);
  const { isAuthenticated: canMute } = accessApi.useIsAuthenticated();

  // Notification mute is a per-user concern orthogonal to global suppression,
  // so the mute-management list must include suppressed rows — otherwise a
  // field that is both suppressed and muted would lose its unmute affordance.
  const { data: anomalies = [] } = anomalyClient.getAnomalies.useQuery(
    { systemId, limit: 50, suppression: "all" },
    { staleTime: 30_000 },
  );

  const { data: mutes = [], refetch: refetchMutes } =
    anomalyClient.listAnomalyNotificationMutes.useQuery(
      { systemId },
      { staleTime: 30_000 },
    );

  const mutedFields = React.useMemo(
    () => new Set(mutes.map((m) => m.fieldPath)),
    [mutes],
  );
  const isSystemMuted = mutedFields.has("");

  const muteMutation = anomalyClient.muteAnomalyNotification.useMutation({
    onSuccess: () => void refetchMutes(),
    onError: (error) =>
      toast.error(extractErrorMessage(error, "Failed to mute notifications")),
  });
  const unmuteMutation = anomalyClient.unmuteAnomalyNotification.useMutation({
    onSuccess: () => void refetchMutes(),
    onError: (error) =>
      toast.error(extractErrorMessage(error, "Failed to unmute notifications")),
  });

  const isPending = muteMutation.isPending || unmuteMutation.isPending;

  // Distinct fieldPaths from anomalies so the list reflects what the user
  // would actually be paged about. Plus any explicitly muted fields,
  // because the user should still see and be able to unmute them.
  const fieldPaths = React.useMemo(() => {
    const set = new Set<string>();
    for (const a of anomalies) set.add(a.fieldPath);
    for (const fp of mutedFields) if (fp !== "") set.add(fp);
    return [...set].toSorted();
  }, [anomalies, mutedFields]);

  const handleToggle = (fieldPath: string, currentlyMuted: boolean) => {
    if (currentlyMuted) {
      unmuteMutation.mutate({ systemId, fieldPath });
    } else {
      muteMutation.mutate({ systemId, fieldPath });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Mute the entire system or just specific fields. Mutes persist
          across re-subscribes.
        </span>
        {canMute && (
          <Button
            type="button"
            variant={isSystemMuted ? "outline" : "primary"}
            size="sm"
            className="h-6 px-2 text-[11px] gap-1"
            disabled={isPending}
            onClick={() => handleToggle("", isSystemMuted)}
          >
            {isSystemMuted ? (
              <>
                <BellOff className="h-3 w-3" /> System muted
              </>
            ) : (
              <>
                <Bell className="h-3 w-3" /> Mute system
              </>
            )}
          </Button>
        )}
      </div>

      {fieldPaths.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          No tracked fields yet — mute will become available once anomalies
          are observed.
        </div>
      ) : (
        <div className="flex flex-col divide-y rounded-md border">
          {fieldPaths.map((fp) => {
            const muted = mutedFields.has(fp) || isSystemMuted;
            return (
              <div
                key={fp}
                className="flex items-center justify-between px-3 py-1.5 text-xs"
              >
                <span className="font-mono truncate">{fp}</span>
                {canMute && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={isPending || isSystemMuted}
                    title={muted ? "Unmute this field" : "Mute this field"}
                    onClick={() => handleToggle(fp, mutedFields.has(fp))}
                  >
                    {muted ? (
                      <BellOff className="h-3 w-3" />
                    ) : (
                      <Bell className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

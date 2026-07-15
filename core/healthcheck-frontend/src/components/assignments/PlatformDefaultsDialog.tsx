import React, { useState } from "react";
import {
  DEFAULT_NOTIFICATION_POLICY,
  HealthCheckApi,
  type NotificationPolicy,
} from "@checkstack/healthcheck-common";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  LoadingSpinner,
  useToast,
  toastError,
  toastSuccess,
} from "@checkstack/ui";
import { NotificationsPanel } from "./NotificationsPanel";

interface PlatformDefaultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal editor for platform-wide notification defaults. Reuses the
 * per-assignment NotificationsPanel because the shape is identical —
 * the only difference is where it reads from and writes to.
 *
 * Once saved, every assignment with `notificationPolicy = null`
 * (the "Use platform defaults" state) picks up the new values on the
 * next read. In-flight auto-incidents are unaffected — their cooldown
 * was snapshotted at open time.
 */
export const PlatformDefaultsDialog: React.FC<PlatformDefaultsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const client = usePluginClient(HealthCheckApi);
  const toast = useToast();

  const { data, isLoading, refetch } =
    client.getPlatformNotificationDefaults.useQuery(undefined, {
      enabled: open,
    });

  const setMutation = client.setPlatformNotificationDefaults.useMutation({
    onSuccess: () => {
      toastSuccess(toast, "Platform notification defaults saved");
      void refetch();
      onOpenChange(false);
    },
    onError: (error) => toastError(toast, "Failed to save defaults", error),
  });

  const [draft, setDraft] = useState<NotificationPolicy>(
    DEFAULT_NOTIFICATION_POLICY,
  );

  // Seed the editable draft from the loaded defaults ONCE per open session -
  // the first render on which the query has resolved. A naive
  // `useEffect(() => { if (data) setDraft(data) }, [data])` re-seeds on every
  // background refetch (realtime healthcheck signals invalidate this query),
  // wiping the operator's in-progress edits. Seeding during render with a guard
  // is StrictMode-safe: a setState scheduled from an effect can be dropped on
  // StrictMode's double-mount.
  const [seededForOpen, setSeededForOpen] = useState(false);
  if (open && data && !seededForOpen) {
    setSeededForOpen(true);
    setDraft(data);
  } else if (!open && seededForOpen) {
    setSeededForOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Platform notification defaults</DialogTitle>
          <DialogDescription>
            Edits here apply to every health-check assignment that is set
            to &quot;Use platform defaults&quot;. Assignments with a custom
            override are unaffected.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <NotificationsPanel
            policy={draft}
            onChange={setDraft}
            onSave={() => setMutation.mutate(draft)}
            saving={setMutation.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

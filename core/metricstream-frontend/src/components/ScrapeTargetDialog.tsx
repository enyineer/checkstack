import { useEffect, useState } from "react";
import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import { satelliteAccess } from "@checkstack/satellite-common";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Label,
  Toggle,
  FormError,
  useToast,
  toastError,
} from "@checkstack/ui";
import {
  MetricstreamApi,
  type MetricScrapeTarget,
} from "@checkstack/metricstream-common";
import {
  buildScrapeTargetCreate,
  buildScrapeTargetUpdate,
  emptyScrapeForm,
  scrapeFormFromTarget,
  validateScrapeForm,
  type ScrapeFormState,
} from "../lib/scrape-form";
import { SecretField } from "./SecretField";
import { ScrapeFromSelect } from "./ScrapeFromSelect";

export interface ScrapeTargetDialogProps {
  streamId: string;
  /** An existing target to edit, or null to create a new one. */
  target: MetricScrapeTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create/edit a Prometheus scrape target. The bearer token is optional and
 * managed through `SecretField` (stored secrets read back masked, "leave empty
 * to keep"); the payload builders map it to the frozen contract sentinel. Both
 * mutations are contract-gated on the owning stream's manage verdict.
 */
export function ScrapeTargetDialog({
  streamId,
  target,
  open,
  onOpenChange,
}: ScrapeTargetDialogProps) {
  const client = usePluginClient(MetricstreamApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const isEdit = target !== null;

  // The "Scrape from" satellite picker calls `listSatellites`, which requires
  // satellite read access. Hide it for a stream manager who lacks that access;
  // the form still seeds `satelliteId` from the target, so an existing binding
  // is preserved on save even when the picker is not shown.
  const { allowed: canReadSatellites } = accessApi.useAccess(
    satelliteAccess.satellite.read,
  );

  const [form, setForm] = useState<ScrapeFormState>(() =>
    target ? scrapeFormFromTarget(target) : emptyScrapeForm(),
  );
  const [error, setError] = useState<string | null>(null);

  // Reseed whenever the dialog opens for a different target (or switches
  // between create and edit).
  useEffect(() => {
    if (open) {
      setForm(target ? scrapeFormFromTarget(target) : emptyScrapeForm());
      setError(null);
    }
  }, [open, target]);

  const createMutation = client.createScrapeTarget.useGatedMutation({
    gateInput: { streamId },
    onSuccess: () => {
      toast.success("Scrape target created");
      onOpenChange(false);
    },
    onError: (e) => toastError(toast, "Failed to create scrape target", e),
  });

  const updateMutation = client.updateScrapeTarget.useGatedMutation({
    gateInput: { streamId },
    onSuccess: () => {
      toast.success("Scrape target updated");
      onOpenChange(false);
    },
    onError: (e) => toastError(toast, "Failed to update scrape target", e),
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateScrapeForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    if (isEdit && target) {
      updateMutation.mutate(
        buildScrapeTargetUpdate({ form, streamId, targetId: target.id }),
      );
    } else {
      createMutation.mutate(buildScrapeTargetCreate({ form, streamId }));
    }
  };

  const setField = <K extends keyof ScrapeFormState>(
    key: K,
    value: ScrapeFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit scrape target" : "Add scrape target"}
          </DialogTitle>
          <DialogDescription>
            Checkstack scrapes this Prometheus-format endpoint on a schedule and
            folds the exposed metrics into this stream.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="scrape-name">Name</Label>
            <Input
              id="scrape-name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="checkout-service"
              autoFocus
              maxLength={255}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="scrape-url">Metrics URL</Label>
            <Input
              id="scrape-url"
              value={form.url}
              onChange={(e) => setField("url", e.target.value)}
              placeholder="https://checkout.internal:9090/metrics"
              maxLength={2048}
            />
          </div>

          {canReadSatellites && (
            <ScrapeFromSelect
              value={form.satelliteId}
              onChange={(satelliteId) => setField("satelliteId", satelliteId)}
              disabled={saving}
            />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="scrape-interval">Interval (seconds)</Label>
              <Input
                id="scrape-interval"
                type="number"
                min={5}
                max={86_400}
                value={form.intervalSeconds}
                onChange={(e) =>
                  setField("intervalSeconds", Number(e.target.value))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scrape-timeout">Timeout (ms)</Label>
              <Input
                id="scrape-timeout"
                type="number"
                min={1000}
                max={120_000}
                value={form.timeoutMs}
                onChange={(e) => setField("timeoutMs", Number(e.target.value))}
              />
            </div>
          </div>

          <SecretField
            id="scrape-bearer"
            label="Bearer token"
            description="Sent as an Authorization: Bearer header on each scrape. Optional."
            value={form.secret}
            onChange={(secret) => setField("secret", secret)}
            disabled={saving}
          />

          <div className="flex items-center justify-between rounded-lg border bg-card p-3">
            <div>
              <Label htmlFor="scrape-enabled">Enabled</Label>
              <p className="text-xs text-muted-foreground">
                Disabled targets are not scraped.
              </p>
            </div>
            <Toggle
              checked={form.enabled}
              onCheckedChange={(checked) => setField("enabled", checked)}
            />
          </div>

          {error && <FormError>{error}</FormError>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : isEdit
                  ? "Save target"
                  : "Add target"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

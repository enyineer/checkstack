import React, { useState } from "react";
import {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  CreateHealthCheckConfiguration,
} from "@checkmate-monitor/healthcheck-common";
import {
  Button,
  Input,
  Label,
  PluginConfigForm,
  useToast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@checkmate-monitor/ui";

interface HealthCheckEditorProps {
  strategies: HealthCheckStrategyDto[];
  initialData?: HealthCheckConfiguration;
  onSave: (data: CreateHealthCheckConfiguration) => Promise<void>;
  onCancel: () => void;
  open: boolean;
}

export const HealthCheckEditor: React.FC<HealthCheckEditorProps> = ({
  strategies,
  initialData,
  onSave,
  onCancel,
  open,
}) => {
  const [name, setName] = useState(initialData?.name || "");
  const [strategyId, setStrategyId] = useState(initialData?.strategyId || "");
  const [interval, setInterval] = useState(
    initialData?.intervalSeconds?.toString() || "60"
  );
  const [config, setConfig] = useState<Record<string, unknown>>(
    (initialData?.config as Record<string, unknown>) || {}
  );

  const toast = useToast();
  const [loading, setLoading] = useState(false);

  // Reset form when dialog opens with new data
  React.useEffect(() => {
    if (open) {
      setName(initialData?.name || "");
      setStrategyId(initialData?.strategyId || "");
      setInterval(initialData?.intervalSeconds?.toString() || "60");
      setConfig((initialData?.config as Record<string, unknown>) || {});
    }
  }, [open, initialData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSave({
        name,
        strategyId,
        intervalSeconds: Number.parseInt(interval, 10),
        config,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save health check";
      toast.error(message);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent size="lg">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>
              {initialData ? "Edit Health Check" : "Create Health Check"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="interval">Interval (seconds)</Label>
              <Input
                id="interval"
                type="number"
                min="1"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                required
              />
            </div>

            <PluginConfigForm
              label="Strategy"
              plugins={strategies}
              selectedPluginId={strategyId}
              onPluginChange={(id) => {
                setStrategyId(id);
                setConfig({});
              }}
              config={config}
              onConfigChange={setConfig}
              disabled={!!initialData}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

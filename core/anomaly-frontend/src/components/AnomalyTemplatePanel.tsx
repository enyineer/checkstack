import { useState, useEffect } from "react";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent, 
  CardFooter,
  Button,
  Label,
  Input,
  Toggle,
  useToast
} from "@checkstack/ui";
import { Activity, Save } from "lucide-react";
import type { HealthCheckConfigIDEContext } from "@checkstack/healthcheck-frontend";
import { usePluginClient } from "@checkstack/frontend-api";
import { AnomalyApi, type AnomalyFieldConfig, type AnomalyDirection } from "@checkstack/anomaly-common";
import { useAnomalyFields } from "./useAnomalyFields";
import { AnomalyFieldOverridesEditor } from "./AnomalyFieldOverridesEditor";

export function AnomalyTemplatePanel({ context }: { context: HealthCheckConfigIDEContext }) {
  const toast = useToast();
  const anomalyClient = usePluginClient(AnomalyApi);
  
  const [enabled, setEnabled] = useState(true);
  const [sensitivity, setSensitivity] = useState(1);
  const [confirmationWindow, setConfirmationWindow] = useState(3);
  const [baselineWindow, setBaselineWindow] = useState("7d");
  const [notify, setNotify] = useState(true);
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, AnomalyFieldConfig>>({});
  
  const { data: configRecord, isLoading } = anomalyClient.getAnomalyConfig.useQuery(
    { configurationId: context.configurationId },
    { enabled: !!context.configurationId }
  );

  const availableFields = useAnomalyFields(context.configurationId);

  const updateMutation = anomalyClient.updateAnomalyConfig.useMutation({
    onSuccess: () => {
      toast.success("Anomaly detection settings saved");
    },
    onError: () => {
      toast.error("Failed to save settings");
    }
  });

  useEffect(() => {
    if (configRecord?.data) {
      setEnabled(configRecord.data.enabled ?? true);
      setSensitivity(configRecord.data.sensitivity ?? 1);
      setConfirmationWindow(configRecord.data.confirmationWindow ?? 3);
      setBaselineWindow(configRecord.data.baselineWindow ?? "7d");
      setNotify(configRecord.data.notify ?? true);
      setFieldOverrides(configRecord.data.fieldOverrides ?? {});
    }
  }, [configRecord]);

  const handleSave = () => {
    updateMutation.mutate({
      configurationId: context.configurationId,
      config: {
        enabled,
        sensitivity,
        confirmationWindow,
        baselineWindow,
        notify,
        fieldOverrides
      }
    });
  };

  const handleFieldOverrideChange = (
    field: string, 
    key: keyof AnomalyFieldConfig, 
    value: number | boolean | AnomalyDirection | undefined
  ) => {
    setFieldOverrides(prev => {
      const fieldConfig = prev[field] ?? {};
      return {
        ...prev,
        [field]: { ...fieldConfig, [key]: value }
      };
    });
  };

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading anomaly settings...</div>;
  }

  return (
    <Card className="flex flex-col h-full border-0 rounded-none shadow-none">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">Template Anomaly Defaults</CardTitle>
            <CardDescription>
              Configure the default machine learning sensitivity and baseline windows for this health check template. These settings cascade to all assignments unless specifically overridden.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-6 overflow-y-auto">
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-md">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Enable Anomaly Detection by Default</Label>
              <div className="text-sm text-muted-foreground">
                Run background analysis to detect deviations from expected behavior across all systems using this template.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{enabled ? "Enabled" : "Disabled"}</span>
              <Toggle 
                checked={enabled} 
                onCheckedChange={setEnabled}
                disabled={context.isLocked}
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 p-4 border rounded-md">
            <div className="space-y-2">
              <Label htmlFor="sensitivity">Global Sensitivity Multiplier</Label>
              <div className="flex items-center gap-4">
                <Input 
                  id="sensitivity"
                  type="number" 
                  min={0.5} 
                  max={3} 
                  step={0.1}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number.parseFloat(e.target.value))}
                  disabled={!enabled || context.isLocked}
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  (Default: 1.0)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Higher multiplier = wider expected range (fewer alerts).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmationWindow">Confirmation Window</Label>
              <div className="flex items-center gap-4">
                <Input 
                  id="confirmationWindow"
                  type="number" 
                  min={1} 
                  max={10} 
                  step={1}
                  value={confirmationWindow}
                  onChange={(e) => setConfirmationWindow(Number.parseInt(e.target.value, 10))}
                  disabled={!enabled || context.isLocked}
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  runs
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Number of consecutive anomalous runs required before an alert is triggered.
              </p>
            </div>
          </div>

          <AnomalyFieldOverridesEditor
            title="Global Field-Level Defaults"
            description="Set default anomaly behavior for specific metrics collected by this health check."
            availableFields={availableFields}
            fieldOverrides={fieldOverrides}
            onChange={handleFieldOverrideChange}
            parentEnabled={enabled}
            isLocked={context.isLocked}
            defaultSensitivity={sensitivity}
            defaultConfirmationWindow={confirmationWindow}
          />
        </div>
      </CardContent>

      <CardFooter className="pt-4 border-t flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={updateMutation.isPending || context.isLocked}
        >
          {updateMutation.isPending ? "Saving..." : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Defaults
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

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
import type { AssignmentIDEContext } from "@checkstack/healthcheck-frontend";
import { usePluginClient } from "@checkstack/frontend-api";
import { AnomalyApi, type AnomalyFieldConfig, type AnomalyDirection } from "@checkstack/anomaly-common";
import { useAnomalyFields } from "./useAnomalyFields";
import { AnomalyFieldOverridesEditor } from "./AnomalyFieldOverridesEditor";

export function AnomalyConfigPanel({ context }: { context: AssignmentIDEContext }) {
  const toast = useToast();
  const anomalyClient = usePluginClient(AnomalyApi);
  
  const [enabled, setEnabled] = useState(true);
  const [sensitivity, setSensitivity] = useState(1);
  const [confirmationWindow, setConfirmationWindow] = useState(3);
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, AnomalyFieldConfig>>({});

  // Fetch Assignment Config
  const { data: configRecord, isLoading: isLoadingConfig } = anomalyClient.getAnomalyAssignmentConfig.useQuery(
    { systemId: context.systemId, configurationId: context.configurationId },
    { enabled: !!context.systemId && !!context.configurationId }
  );

  // Fetch Template Config (Global Defaults)
  const { data: templateRecord, isLoading: isLoadingTemplate } = anomalyClient.getAnomalyConfig.useQuery(
    { configurationId: context.configurationId },
    { enabled: !!context.configurationId }
  );

  const baseAvailableFields = useAnomalyFields(context.configurationId);

  // Merge the template config defaults into the available fields
  const availableFields = baseAvailableFields.map(field => {
    const templateOverride = templateRecord?.data?.fieldOverrides?.[field.path];
    return {
      ...field,
      defaultEnabled: templateOverride?.enabled ?? field.defaultEnabled,
      defaultSensitivity: templateOverride?.sensitivity ?? field.defaultSensitivity,
      defaultConfirmationWindow: templateOverride?.confirmationWindow ?? field.defaultConfirmationWindow,
      defaultDirection: templateOverride?.direction ?? field.defaultDirection,
    };
  });

  useEffect(() => {
    if (configRecord?.data) {
      setEnabled(configRecord.data.enabled ?? true);
      setSensitivity(configRecord.data.sensitivity ?? templateRecord?.data?.sensitivity ?? 1);
      setConfirmationWindow(configRecord.data.confirmationWindow ?? templateRecord?.data?.confirmationWindow ?? 3);
      setFieldOverrides(configRecord.data.fieldOverrides ?? {});
    }
  }, [configRecord, templateRecord]);

  const updateMutation = anomalyClient.updateAnomalyAssignmentConfig.useMutation({
    onSuccess: () => {
      toast.success("Assignment exceptions saved");
    },
    onError: () => {
      toast.error("Failed to save assignment exceptions");
    }
  });

  const handleSave = () => {
    updateMutation.mutate({
      systemId: context.systemId,
      configurationId: context.configurationId,
      config: {
        enabled,
        sensitivity,
        confirmationWindow,
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

  if (isLoadingConfig || isLoadingTemplate) {
    return <div className="p-6 text-muted-foreground">Loading anomaly exceptions...</div>;
  }

  return (
    <Card className="flex flex-col h-full border-0 rounded-none shadow-none">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">Assignment Exceptions</CardTitle>
            <CardDescription>
              Override the anomaly detection defaults for this specific system assignment.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-6 overflow-y-auto">
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-md">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Enable Assignment Exceptions</Label>
              <div className="text-sm text-muted-foreground">
                Run background analysis for this specific system
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
              <Label htmlFor="sensitivity">Sensitivity Multiplier Override</Label>
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
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmationWindow">Confirmation Window Override</Label>
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
              </div>
            </div>
          </div>

          <AnomalyFieldOverridesEditor
            title="Field-Level Overrides"
            description="Override anomaly settings for specific metrics collected by this health check."
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

      <CardFooter className="justify-end border-t pt-4">
        <Button 
          onClick={handleSave} 
          disabled={updateMutation.isPending || context.isLocked}
        >
          {updateMutation.isPending ? "Saving..." : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Exceptions
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

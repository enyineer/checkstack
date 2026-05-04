import { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  useToast,
} from "@checkstack/ui";
import { Activity, Save } from "lucide-react";
import type { HealthCheckConfigIDEContext } from "@checkstack/healthcheck-frontend";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  AnomalyApi,
  type AnomalyFieldConfig,
} from "@checkstack/anomaly-common";
import { useAnomalyFields } from "./useAnomalyFields";
import {
  AnomalySettingsForm,
  type AnomalySettingsFormValues,
} from "./AnomalySettingsForm";

const DEFAULT_VALUES: AnomalySettingsFormValues = {
  enabled: true,
  baselineWindow: "7d",
  notify: true,
  fieldOverrides: {},
};

export function AnomalyTemplatePanel({ context }: { context: HealthCheckConfigIDEContext }) {
  const toast = useToast();
  const anomalyClient = usePluginClient(AnomalyApi);

  const [values, setValues] = useState<AnomalySettingsFormValues>(DEFAULT_VALUES);

  const { data: configRecord, isLoading } = anomalyClient.getAnomalyConfig.useQuery(
    { configurationId: context.configurationId },
    { enabled: !!context.configurationId },
  );

  const availableFields = useAnomalyFields(context.configurationId);

  const updateMutation = anomalyClient.updateAnomalyConfig.useMutation({
    onSuccess: () => toast.success("Anomaly detection settings saved"),
    onError: () => toast.error("Failed to save settings"),
  });

  useEffect(() => {
    if (configRecord?.data) {
      setValues({
        enabled: configRecord.data.enabled ?? true,
        baselineWindow: configRecord.data.baselineWindow ?? "7d",
        notify: configRecord.data.notify ?? true,
        fieldOverrides:
          (configRecord.data.fieldOverrides as Record<string, AnomalyFieldConfig>) ??
          {},
      });
    }
  }, [configRecord]);

  const handleChange = <K extends keyof AnomalySettingsFormValues>(
    key: K,
    value: AnomalySettingsFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    updateMutation.mutate({
      configurationId: context.configurationId,
      config: values,
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
        <AnomalySettingsForm
          values={values}
          onChange={handleChange}
          availableFields={availableFields}
          isLocked={context.isLocked}
          variant="template"
        />
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

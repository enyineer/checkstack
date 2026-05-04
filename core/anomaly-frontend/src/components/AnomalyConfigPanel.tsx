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
import type { AssignmentIDEContext } from "@checkstack/healthcheck-frontend";
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

export function AnomalyConfigPanel({ context }: { context: AssignmentIDEContext }) {
  const toast = useToast();
  const anomalyClient = usePluginClient(AnomalyApi);

  const [values, setValues] = useState<AnomalySettingsFormValues>(DEFAULT_VALUES);

  const { data: configRecord, isLoading: isLoadingConfig } =
    anomalyClient.getAnomalyAssignmentConfig.useQuery(
      { systemId: context.systemId, configurationId: context.configurationId },
      { enabled: !!context.systemId && !!context.configurationId },
    );

  const { data: templateRecord, isLoading: isLoadingTemplate } =
    anomalyClient.getAnomalyConfig.useQuery(
      { configurationId: context.configurationId },
      { enabled: !!context.configurationId },
    );

  const baseAvailableFields = useAnomalyFields(context.configurationId);

  // Cascade template-level field overrides into the available-fields metadata so
  // each row's "default" reflects the template, not the engine fallback.
  const availableFields = baseAvailableFields.map((field) => {
    const templateOverride = templateRecord?.data?.fieldOverrides?.[field.path];
    return {
      ...field,
      defaultEnabled: templateOverride?.enabled ?? field.defaultEnabled,
      defaultSensitivity: templateOverride?.sensitivity ?? field.defaultSensitivity,
      defaultConfirmationWindow:
        templateOverride?.confirmationWindow ?? field.defaultConfirmationWindow,
      defaultDirection: templateOverride?.direction ?? field.defaultDirection,
      defaultDriftEnabled:
        templateOverride?.driftEnabled ?? field.defaultDriftEnabled,
      defaultDriftThreshold:
        templateOverride?.driftThreshold ?? field.defaultDriftThreshold,
    };
  });

  useEffect(() => {
    if (configRecord?.data) {
      const tpl = templateRecord?.data;
      setValues({
        enabled: configRecord.data.enabled ?? true,
        baselineWindow:
          configRecord.data.baselineWindow ?? tpl?.baselineWindow ?? "7d",
        notify: configRecord.data.notify ?? tpl?.notify ?? true,
        fieldOverrides:
          (configRecord.data.fieldOverrides as Record<string, AnomalyFieldConfig>) ??
          {},
      });
    }
  }, [configRecord, templateRecord]);

  const updateMutation = anomalyClient.updateAnomalyAssignmentConfig.useMutation({
    onSuccess: () => toast.success("Assignment exceptions saved"),
    onError: () => toast.error("Failed to save assignment exceptions"),
  });

  const handleChange = <K extends keyof AnomalySettingsFormValues>(
    key: K,
    value: AnomalySettingsFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    updateMutation.mutate({
      systemId: context.systemId,
      configurationId: context.configurationId,
      config: values,
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
        <AnomalySettingsForm
          values={values}
          onChange={handleChange}
          availableFields={availableFields}
          isLocked={context.isLocked}
          variant="assignment"
        />
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

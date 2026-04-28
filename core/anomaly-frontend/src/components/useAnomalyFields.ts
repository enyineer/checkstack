import { useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { useStrategySchemas } from "@checkstack/healthcheck-frontend";

import type { AnomalyDirection } from "@checkstack/anomaly-common";

export type AnomalyFieldMeta = {
  path: string;
  defaultEnabled: boolean;
  defaultDirection?: AnomalyDirection;
  defaultSensitivity?: number;
  defaultConfirmationWindow?: number;
};

export function useAnomalyFields(configurationId: string | undefined) {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  
  const { data: hcConfig } = healthCheckClient.getConfiguration.useQuery(
    { id: configurationId ?? "" },
    { enabled: !!configurationId }
  );
  
  const { schemas } = useStrategySchemas(hcConfig?.strategyId ?? "");

  const availableFields = useMemo(() => {
    if (!schemas?.resultSchema) return [];
    
    type JsonSchemaNode = {
      type?: string;
      properties?: Record<string, JsonSchemaNode>;
      [key: string]: unknown;
    };
    
    const schema = schemas.resultSchema as JsonSchemaNode;
    
    const extractFields = (obj: JsonSchemaNode | undefined, prefix = ""): AnomalyFieldMeta[] => {
      const keys: AnomalyFieldMeta[] = [];
      if (obj?.properties) {
        for (const [key, value] of Object.entries(obj.properties)) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (value.type === "object" || value.properties) {
            keys.push(...extractFields(value, path));
          } else {
            // Default to true unless explicitly disabled in schema
            const defaultEnabled = value["x-anomaly-enabled"] !== false;
            keys.push({ 
              path, 
              defaultEnabled,
              defaultDirection: value["x-anomaly-direction"] as AnomalyDirection | undefined,
              defaultSensitivity: typeof value["x-anomaly-sensitivity"] === "number" ? value["x-anomaly-sensitivity"] : undefined,
              defaultConfirmationWindow: typeof value["x-anomaly-confirmation-window"] === "number" ? value["x-anomaly-confirmation-window"] : undefined,
            });
          }
        }
      }
      return keys;
    };
    
    return extractFields(schema).filter(k => k.path !== "error");
  }, [schemas]);

  return availableFields;
}

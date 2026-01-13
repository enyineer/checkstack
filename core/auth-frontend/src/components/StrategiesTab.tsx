import React, { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  LoadingSpinner,
  Alert,
  AlertIcon,
  AlertContent,
  AlertTitle,
  AlertDescription,
  DynamicForm,
  useToast,
} from "@checkstack/ui";
import { Shield, RefreshCw } from "lucide-react";
import { useApi } from "@checkstack/frontend-api";
import { rpcApiRef } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { AuthStrategy } from "../api";
import { AuthStrategyCard } from "./AuthStrategyCard";

export interface StrategiesTabProps {
  strategies: AuthStrategy[];
  canManageStrategies: boolean;
  canManageRegistration: boolean;
  onDataChange: () => Promise<void>;
}

export const StrategiesTab: React.FC<StrategiesTabProps> = ({
  strategies,
  canManageStrategies,
  canManageRegistration,
  onDataChange,
}) => {
  const rpcApi = useApi(rpcApiRef);
  const authClient = rpcApi.forPlugin(AuthApi);
  const toast = useToast();

  const [reloading, setReloading] = useState(false);
  const [expandedStrategy, setExpandedStrategy] = useState<string>();
  const [strategyConfigs, setStrategyConfigs] = useState<
    Record<string, Record<string, unknown>>
  >({});

  // Registration state
  const [registrationSchema, setRegistrationSchema] = useState<
    Record<string, unknown> | undefined
  >();
  const [registrationSettings, setRegistrationSettings] = useState<{
    allowRegistration: boolean;
  }>({ allowRegistration: true });
  const [loadingRegistration, setLoadingRegistration] = useState(true);
  const [savingRegistration, setSavingRegistration] = useState(false);
  const [registrationValid, setRegistrationValid] = useState(true);

  // Initialize strategy configs when strategies change
  useEffect(() => {
    const configs: Record<string, Record<string, unknown>> = {};
    for (const strategy of strategies) {
      configs[strategy.id] = strategy.config || {};
    }
    setStrategyConfigs(configs);
  }, [strategies]);

  // Fetch registration data when we have access
  useEffect(() => {
    if (!canManageRegistration) {
      setLoadingRegistration(false);
      return;
    }

    const fetchRegistrationData = async () => {
      setLoadingRegistration(true);
      try {
        const [schema, status] = await Promise.all([
          authClient.getRegistrationSchema(),
          authClient.getRegistrationStatus(),
        ]);
        setRegistrationSchema(schema);
        setRegistrationSettings(status);
      } catch (error) {
        console.error("Failed to fetch registration data:", error);
      } finally {
        setLoadingRegistration(false);
      }
    };
    fetchRegistrationData();
  }, [canManageRegistration, authClient]);

  const handleToggleStrategy = async (strategyId: string, enabled: boolean) => {
    try {
      await authClient.updateStrategy({ id: strategyId, enabled });
      await onDataChange();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to toggle strategy";
      toast.error(message);
    }
  };

  const handleSaveStrategyConfig = async (
    strategyId: string,
    config: Record<string, unknown>
  ) => {
    try {
      const strategy = strategies.find((s) => s.id === strategyId);
      if (!strategy) {
        toast.error("Strategy not found");
        return;
      }
      setStrategyConfigs({
        ...strategyConfigs,
        [strategyId]: config,
      });
      await authClient.updateStrategy({
        id: strategyId,
        enabled: strategy.enabled,
        config,
      });
      toast.success(
        "Configuration saved successfully! Click 'Reload Authentication' to apply changes."
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save strategy configuration";
      toast.error(message);
    }
  };

  const handleSaveRegistration = async () => {
    setSavingRegistration(true);
    try {
      await authClient.setRegistrationStatus(registrationSettings);
      toast.success("Registration settings saved successfully");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save registration settings"
      );
    } finally {
      setSavingRegistration(false);
    }
  };

  const handleReloadAuth = async () => {
    setReloading(true);
    try {
      await authClient.reloadAuth();
      toast.success("Authentication system reloaded successfully");
      await onDataChange();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to reload authentication"
      );
    } finally {
      setReloading(false);
    }
  };

  const enabledStrategies = strategies.filter((s) => s.enabled);
  const hasNoEnabled = enabledStrategies.length === 0;

  return (
    <div className="space-y-4">
      {/* Platform Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {canManageRegistration ? (
            loadingRegistration ? (
              <div className="flex justify-center py-4">
                <LoadingSpinner />
              </div>
            ) : registrationSchema ? (
              <div className="space-y-4">
                <DynamicForm
                  schema={registrationSchema}
                  value={registrationSettings}
                  onChange={(value) =>
                    setRegistrationSettings(
                      value as { allowRegistration: boolean }
                    )
                  }
                  onValidChange={setRegistrationValid}
                />
                <Button
                  onClick={() => void handleSaveRegistration()}
                  disabled={savingRegistration || !registrationValid}
                >
                  {savingRegistration ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Failed to load registration settings
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              You don't have access to manage registration settings.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleReloadAuth}
          disabled={!canManageStrategies || reloading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${reloading ? "animate-spin" : ""}`} />
          {reloading ? "Reloading..." : "Reload Authentication"}
        </Button>
      </div>

      {hasNoEnabled && (
        <Alert variant="warning">
          <AlertIcon>
            <Shield className="h-4 w-4" />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>No authentication strategies enabled</AlertTitle>
            <AlertDescription>
              You won't be able to log in! Please enable at least one
              authentication strategy and reload authentication.
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}

      <Alert className="mt-6">
        <AlertIcon>
          <Shield className="h-4 w-4" />
        </AlertIcon>
        <AlertContent>
          <AlertDescription>
            Changes to authentication strategies require clicking the "Reload
            Authentication" button to take effect. This reloads the auth system
            without requiring a full restart.
          </AlertDescription>
        </AlertContent>
      </Alert>

      {strategies.map((strategy) => (
        <AuthStrategyCard
          key={strategy.id}
          strategy={strategy}
          onToggle={handleToggleStrategy}
          onSaveConfig={handleSaveStrategyConfig}
          disabled={!canManageStrategies}
          expanded={expandedStrategy === strategy.id}
          onExpandedChange={(isExpanded) => {
            setExpandedStrategy(isExpanded ? strategy.id : undefined);
          }}
          config={strategyConfigs[strategy.id]}
        />
      ))}

      {!canManageStrategies && (
        <p className="text-xs text-muted-foreground mt-4">
          You don't have access to manage strategies.
        </p>
      )}
    </div>
  );
};

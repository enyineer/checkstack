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
import { usePluginClient } from "@checkstack/frontend-api";
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
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();

  const [reloading, setReloading] = useState(false);
  const [expandedStrategy, setExpandedStrategy] = useState<string>();
  const [strategyConfigs, setStrategyConfigs] = useState<
    Record<string, Record<string, unknown>>
  >({});

  // Registration state
  const [registrationSettings, setRegistrationSettings] = useState<{
    allowRegistration: boolean;
  }>({ allowRegistration: true });
  const [registrationValid, setRegistrationValid] = useState(true);

  // Initialize strategy configs when strategies change
  useEffect(() => {
    const configs: Record<string, Record<string, unknown>> = {};
    for (const strategy of strategies) {
      configs[strategy.id] = strategy.config || {};
    }
    setStrategyConfigs(configs);
  }, [strategies]);

  // Query: Registration schema (admin only)
  const { data: registrationSchema, isLoading: schemaLoading } =
    authClient.getRegistrationSchema.useQuery(
      {},
      { enabled: canManageRegistration }
    );

  // Query: Registration status (admin only)
  const { data: registrationStatus, isLoading: statusLoading } =
    authClient.getRegistrationStatus.useQuery(
      {},
      { enabled: canManageRegistration }
    );

  // Sync fetched settings to local state
  useEffect(() => {
    if (registrationStatus) {
      setRegistrationSettings(registrationStatus);
    }
  }, [registrationStatus]);

  const loadingRegistration = schemaLoading || statusLoading;

  // Mutations
  const updateStrategyMutation = authClient.updateStrategy.useMutation({
    onSuccess: () => {
      toast.success("Strategy updated");
      void onDataChange();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update strategy"
      );
    },
  });

  const setRegistrationMutation = authClient.setRegistrationStatus.useMutation({
    onSuccess: () => {
      toast.success("Registration settings saved");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save settings"
      );
    },
  });

  const reloadAuthMutation = authClient.reloadAuth.useMutation({
    onSuccess: () => {
      toast.success("Authentication system reloaded");
      void onDataChange();
      setReloading(false);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to reload auth"
      );
      setReloading(false);
    },
  });

  const handleToggleStrategy = async (strategyId: string, enabled: boolean) => {
    await updateStrategyMutation.mutateAsync({ id: strategyId, enabled });
  };

  const handleSaveStrategyConfig = async (
    strategyId: string,
    config: Record<string, unknown>
  ) => {
    const strategy = strategies.find((s) => s.id === strategyId);
    if (!strategy) {
      toast.error("Strategy not found");
      return;
    }
    setStrategyConfigs({
      ...strategyConfigs,
      [strategyId]: config,
    });
    await updateStrategyMutation.mutateAsync({
      id: strategyId,
      enabled: strategy.enabled,
      config,
    });
    toast.success(
      "Configuration saved successfully! Click 'Reload Authentication' to apply changes."
    );
  };

  const handleSaveRegistration = () => {
    setRegistrationMutation.mutate(registrationSettings);
  };

  const handleReloadAuth = () => {
    setReloading(true);
    reloadAuthMutation.mutate({});
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
                  schema={registrationSchema as Record<string, unknown>}
                  value={registrationSettings}
                  onChange={(value) =>
                    setRegistrationSettings(
                      value as { allowRegistration: boolean }
                    )
                  }
                  onValidChange={setRegistrationValid}
                />
                <Button
                  onClick={handleSaveRegistration}
                  disabled={
                    setRegistrationMutation.isPending || !registrationValid
                  }
                >
                  {setRegistrationMutation.isPending
                    ? "Saving..."
                    : "Save Settings"}
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

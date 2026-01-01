import React, { useEffect, useState } from "react";
import { useApi, type SlotContext } from "@checkmate/frontend-api";
import { healthCheckApiRef, HealthCheckConfiguration } from "../api";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  Checkbox,
  Label,
  LoadingSpinner,
  useToast,
} from "@checkmate/ui";
import { Activity } from "lucide-react";
import { CatalogSystemActionsSlot } from "@checkmate/catalog-common";

type Props = SlotContext<typeof CatalogSystemActionsSlot>;

export const SystemHealthCheckAssignment: React.FC<Props> = ({
  systemId,
  systemName: _systemName,
}) => {
  const api = useApi(healthCheckApiRef);
  const [configs, setConfigs] = useState<HealthCheckConfiguration[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | undefined>();
  const [isOpen, setIsOpen] = useState(false);
  const toast = useToast();

  const loadData = async () => {
    setLoading(true);
    try {
      const [allConfigs, systemConfigs] = await Promise.all([
        api.getConfigurations(),
        api.getSystemConfigurations(systemId),
      ]);
      setConfigs(allConfigs);
      setAssignedIds(systemConfigs.map((c) => c.id));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load assignments";
      toast.error(message);
      console.error("Failed to load assignments:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [systemId, isOpen]);

  const handleToggle = async (
    configId: string,
    isCurrentlyAssigned: boolean
  ) => {
    // Optimistic Update
    const previousAssignedIds = [...assignedIds];
    if (isCurrentlyAssigned) {
      setAssignedIds((prev) => prev.filter((id) => id !== configId));
    } else {
      setAssignedIds((prev) => [...prev, configId]);
    }

    setUpdating(configId);
    try {
      await (isCurrentlyAssigned
        ? api.disassociateSystem({ systemId: systemId, configId })
        : api.associateSystem({
            systemId: systemId,
            body: {
              configurationId: configId,
              enabled: true,
            },
          }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to toggle assignment";
      toast.error(message);
      console.error("Failed to toggle assignment:", error);
      // Rollback on error
      setAssignedIds(previousAssignedIds);
    } finally {
      setUpdating(undefined);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex justify-center py-4">
          <LoadingSpinner />
        </div>
      );
    }

    if (configs.length === 0) {
      return (
        <p className="text-[11px] text-muted-foreground text-center py-2 italic">
          No health checks configured.
        </p>
      );
    }

    return (
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {configs.map((config) => {
          const isAssigned = (assignedIds || []).includes(config.id);
          const isUpdating = updating === config.id;

          return (
            <div
              key={config.id}
              className="flex items-center space-x-2 rounded-md p-1.5 transition-colors hover:bg-accent cursor-pointer"
              onClick={() => !updating && handleToggle(config.id, isAssigned)}
            >
              <Checkbox
                id={`check-${config.id}`}
                checked={isAssigned}
                onCheckedChange={() => {}} // Handled by div click
                disabled={!!updating}
              />
              <Label
                htmlFor={`check-${config.id}`}
                className="flex-1 cursor-pointer text-[12px] font-medium text-foreground truncate"
                onClick={(e) => e.preventDefault()} // Let parent div handle it
              >
                {config.name}
              </Label>
              {isUpdating && <LoadingSpinner className="h-3 w-3" />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger onClick={() => setIsOpen(!isOpen)}>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-dashed border-input hover:border-primary/30 hover:bg-primary/5"
        >
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">Checks</span>
          {assignedIds.length > 0 && (
            <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {assignedIds.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className="w-64 p-3"
      >
        <div className="space-y-3">
          <DropdownMenuLabel>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h4 className="text-xs font-semibold text-foreground">
                Health Checks
              </h4>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                Assign
              </span>
            </div>
          </DropdownMenuLabel>
          {renderContent()}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

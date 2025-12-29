import React, { useEffect, useState } from "react";
import { useApi } from "@checkmate/frontend-api";
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
} from "@checkmate/ui";
import { Activity } from "lucide-react";

interface Props {
  system: {
    id: string;
    name: string;
  };
}

export const SystemHealthCheckAssignment: React.FC<unknown> = (props) => {
  const { system } = props as Props;
  const api = useApi(healthCheckApiRef);
  const [configs, setConfigs] = useState<HealthCheckConfiguration[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | undefined>();
  const [isOpen, setIsOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [allConfigs, systemConfigs] = await Promise.all([
        api.getConfigurations(),
        api.getSystemConfigurations(system.id),
      ]);
      setConfigs(allConfigs);
      setAssignedIds(systemConfigs.map((c) => c.id));
    } catch (error) {
      console.error("Failed to load assignments:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [system.id, isOpen]);

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
        ? api.disassociateSystem({ systemId: system.id, configId })
        : api.associateSystem({
            systemId: system.id,
            body: {
              configurationId: configId,
              enabled: true,
            },
          }));
    } catch (error) {
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
        <p className="text-[11px] text-gray-500 text-center py-2 italic">
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
              className="flex items-center space-x-2 rounded-md p-1.5 transition-colors hover:bg-gray-50 cursor-pointer"
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
                className="flex-1 cursor-pointer text-[12px] font-medium text-gray-700 truncate"
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
          className="h-8 gap-1.5 border-dashed border-gray-300 hover:border-indigo-300 hover:bg-indigo-50/50"
        >
          <Activity className="h-3.5 w-3.5 text-indigo-500" />
          <span className="text-xs font-medium">Checks</span>
          {assignedIds.length > 0 && (
            <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
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
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h4 className="text-xs font-semibold text-gray-900">
                Health Checks
              </h4>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
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

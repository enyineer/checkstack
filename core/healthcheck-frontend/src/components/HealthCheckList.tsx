import React from "react";
import {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
} from "@checkstack/healthcheck-common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Badge,
} from "@checkstack/ui";
import { Trash2, Edit, Pause, Play } from "lucide-react";
import { useProvenanceLock } from "@checkstack/gitops-frontend";

interface HealthCheckListProps {
  configurations: HealthCheckConfiguration[];
  strategies: HealthCheckStrategyDto[];
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  canManage?: boolean;
}

export const HealthCheckList: React.FC<HealthCheckListProps> = ({
  configurations,
  strategies,
  onEdit,
  onDelete,
  onPause,
  onResume,
  canManage = true,
}) => {
  const getStrategyName = (id: string) => {
    return strategies.find((s) => s.id === id)?.displayName || id;
  };

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead>Interval (s)</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configurations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center">
                No health checks configured.
              </TableCell>
            </TableRow>
          ) : (
            configurations.map((config) => (
              <HealthCheckRow
                key={config.id}
                config={config}
                strategyName={getStrategyName(config.strategyId)}
                onEdit={onEdit}
                onDelete={onDelete}
                onPause={onPause}
                onResume={onResume}
                canManage={canManage}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

interface HealthCheckRowProps {
  config: HealthCheckConfiguration;
  strategyName: string;
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  canManage: boolean;
}

const HealthCheckRow: React.FC<HealthCheckRowProps> = ({
  config,
  strategyName,
  onEdit,
  onDelete,
  onPause,
  onResume,
  canManage,
}) => {
  const { isLocked } = useProvenanceLock({
    kind: "Healthcheck",
    entityId: config.id,
  });

  return (
    <TableRow className={config.paused ? "opacity-60" : ""}>
      <TableCell className="font-medium">{config.name}</TableCell>
      <TableCell>{strategyName}</TableCell>
      <TableCell>{config.intervalSeconds}</TableCell>
      <TableCell>
        {config.paused ? (
          <Badge variant="secondary">Paused</Badge>
        ) : (
          <Badge variant="default">Active</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          {canManage &&
            onPause &&
            onResume &&
            (config.paused ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onResume(config.id)}
                title={isLocked ? "Managed by GitOps" : "Resume health check"}
                disabled={isLocked}
              >
                <Play className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onPause(config.id)}
                title={isLocked ? "Managed by GitOps" : "Pause health check"}
                disabled={isLocked}
              >
                <Pause className="h-4 w-4" />
              </Button>
            ))}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(config)}
            title={
              isLocked
                ? "View configuration (Managed by GitOps)"
                : "Edit configuration"
            }
          >
            <Edit className="h-4 w-4" />
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(config.id)}
              disabled={isLocked}
              title={isLocked ? "Managed by GitOps" : "Delete configuration"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

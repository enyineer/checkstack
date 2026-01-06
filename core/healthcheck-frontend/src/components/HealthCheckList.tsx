import React from "react";
import {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
} from "@checkmate-monitor/healthcheck-common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
} from "@checkmate-monitor/ui";
import { Trash2, Edit } from "lucide-react";

interface HealthCheckListProps {
  configurations: HealthCheckConfiguration[];
  strategies: HealthCheckStrategyDto[];
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
}

export const HealthCheckList: React.FC<HealthCheckListProps> = ({
  configurations,
  strategies,
  onEdit,
  onDelete,
}) => {
  const getStrategyName = (id: string) => {
    return strategies.find((s) => s.id === id)?.displayName || id;
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead>Interval (s)</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configurations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">
                No health checks configured.
              </TableCell>
            </TableRow>
          ) : (
            configurations.map((config) => (
              <TableRow key={config.id}>
                <TableCell className="font-medium">{config.name}</TableCell>
                <TableCell>{getStrategyName(config.strategyId)}</TableCell>
                <TableCell>{config.intervalSeconds}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(config)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDelete(config.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

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
  Skeleton,
  ResponsiveTable,
  MobileCardList,
  Card,
  cn,
} from "@checkstack/ui";
import { Trash2, Edit, Pause, Play } from "lucide-react";
import { useProvenanceLock } from "@checkstack/gitops-frontend";
import { HealthStatusPill } from "./HealthStatusPill";
import { pausedToTone, toneStyles } from "./healthcheckDisplay.logic";

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
    <>
      <ResponsiveTable className="rounded-md border bg-card">
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
            {configurations.map((config) => (
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
            ))}
          </TableBody>
        </Table>
      </ResponsiveTable>

      <MobileCardList>
        {configurations.map((config) => (
          <HealthCheckMobileCard
            key={config.id}
            config={config}
            strategyName={getStrategyName(config.strategyId)}
            onEdit={onEdit}
            onDelete={onDelete}
            onPause={onPause}
            onResume={onResume}
            canManage={canManage}
          />
        ))}
      </MobileCardList>
    </>
  );
};

interface HealthCheckListSkeletonProps {
  /**
   * Number of placeholder rows to render. Defaults to 4 so the skeleton
   * roughly matches a typical first-page configuration list.
   */
  rows?: number;
}

/**
 * HealthCheckListSkeleton mirrors the shape of {@link HealthCheckList} so
 * the page doesn't jump on load. Renders the same table chrome with
 * `Skeleton` placeholders in each cell on desktop, and a stacked card
 * skeleton on mobile to mirror the {@link MobileCardList} layout.
 */
export const HealthCheckListSkeleton: React.FC<
  HealthCheckListSkeletonProps
> = ({ rows = 4 }) => {
  return (
    <>
      <ResponsiveTable className="rounded-md border bg-card">
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
            {Array.from({ length: rows }, (_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ResponsiveTable>

      <MobileCardList>
        {Array.from({ length: rows }, (_, index) => (
          <Card key={index} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
            </div>
          </Card>
        ))}
      </MobileCardList>
    </>
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
    <TableRow
      className={cn(
        "transition-colors hover:bg-surface-inset",
        config.paused && "opacity-60",
      )}
    >
      <TableCell className="font-medium">{config.name}</TableCell>
      <TableCell>{strategyName}</TableCell>
      <TableCell>{config.intervalSeconds}</TableCell>
      <TableCell>
        <HealthStatusPill
          tone={pausedToTone({ paused: config.paused })}
          label={config.paused ? "Paused" : "Active"}
        />
      </TableCell>
      <TableCell className="text-right">
        <HealthCheckActionButtons
          config={config}
          isLocked={isLocked}
          onEdit={onEdit}
          onDelete={onDelete}
          onPause={onPause}
          onResume={onResume}
          canManage={canManage}
        />
      </TableCell>
    </TableRow>
  );
};

interface HealthCheckMobileCardProps {
  config: HealthCheckConfiguration;
  strategyName: string;
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  canManage: boolean;
}

const HealthCheckMobileCard: React.FC<HealthCheckMobileCardProps> = ({
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

  const tone = pausedToTone({ paused: config.paused });
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
        config.paused && "opacity-60",
      )}
    >
      {/* Status accent stripe keyed to active/paused. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", toneStyles[tone].accent)}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2 pl-2">
        <span className="truncate font-medium text-foreground">
          {config.name}
        </span>
        <HealthStatusPill
          tone={tone}
          label={config.paused ? "Paused" : "Active"}
        />
      </div>
      <div className="mt-1 pl-2 text-xs text-muted-foreground">
        {strategyName} &middot; every {config.intervalSeconds}s
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <HealthCheckActionButtons
          config={config}
          isLocked={isLocked}
          onEdit={onEdit}
          onDelete={onDelete}
          onPause={onPause}
          onResume={onResume}
          canManage={canManage}
        />
      </div>
    </div>
  );
};

interface HealthCheckActionButtonsProps {
  config: HealthCheckConfiguration;
  isLocked: boolean;
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  canManage: boolean;
}

const HealthCheckActionButtons: React.FC<HealthCheckActionButtonsProps> = ({
  config,
  isLocked,
  onEdit,
  onDelete,
  onPause,
  onResume,
  canManage,
}) => (
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
);

import React, { useMemo } from "react";
import type {
  CollectorConfigEntry,
  CollectorDto,
} from "@checkstack/healthcheck-common";
import { Badge } from "@checkstack/ui";
import { Search } from "lucide-react";
import { isBuiltInCollector } from "../../hooks/useCollectors";

interface CollectorPickerProps {
  availableCollectors: CollectorDto[];
  configuredCollectors: CollectorConfigEntry[];
  loading: boolean;
  onAdd: (collectorId: string) => void;
  strategyId: string;
}

export const CollectorPicker: React.FC<CollectorPickerProps> = ({
  availableCollectors,
  configuredCollectors,
  loading,
  onAdd,
  strategyId,
}) => {
  const configuredIds = useMemo(
    () => new Set(configuredCollectors.map((c) => c.collectorId)),
    [configuredCollectors],
  );

  const builtInCollectors = availableCollectors.filter((c) =>
    isBuiltInCollector(c.id, strategyId),
  );
  const externalCollectors = availableCollectors.filter(
    (c) => !isBuiltInCollector(c.id, strategyId),
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Add Check Item</h2>
        <p className="text-sm text-muted-foreground">Loading collectors...</p>
      </div>
    );
  }

  const renderCollectorCard = (collector: CollectorDto) => {
    const alreadyAdded = configuredIds.has(collector.id);
    const canAdd = !alreadyAdded || collector.allowMultiple;

    return (
      <button
        key={collector.id}
        type="button"
        disabled={!canAdd}
        onClick={() => onAdd(collector.id)}
        className={`flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition-all ${
          canAdd
            ? "hover:border-primary/50 hover:shadow-md hover:shadow-primary/5 cursor-pointer"
            : "opacity-50 cursor-not-allowed"
        }`}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">{collector.displayName}</h3>
          <div className="flex gap-1.5 shrink-0">
            {collector.allowMultiple && (
              <Badge variant="outline" className="text-[10px]">
                Multiple
              </Badge>
            )}
            {alreadyAdded && (
              <Badge variant="secondary" className="text-[10px]">
                Added
              </Badge>
            )}
          </div>
        </div>
        {collector.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {collector.description}
          </p>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Add Check Item</h2>
        <p className="text-sm text-muted-foreground">
          Select a collector to add to this health check.
        </p>
      </div>

      {availableCollectors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Search className="h-8 w-8 mb-3 opacity-40" />
          <p className="text-sm">No collectors available for this strategy.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {builtInCollectors.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Built-in
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {builtInCollectors.map((col) => renderCollectorCard(col))}
              </div>
            </section>
          )}

          {externalCollectors.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                External
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {externalCollectors.map((extCol) =>
                  renderCollectorCard(extCol),
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

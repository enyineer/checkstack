import React, { useState, useEffect, useCallback } from "react";
import {
  CollectorDto,
  CollectorConfigEntry,
} from "@checkstack/healthcheck-common";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  DynamicForm,
  Badge,
} from "@checkstack/ui";
import { Plus, Trash2 } from "lucide-react";
import { isBuiltInCollector } from "../hooks/useCollectors";
import { AssertionBuilder, type Assertion } from "./AssertionBuilder";

interface CollectorListProps {
  strategyId: string;
  availableCollectors: CollectorDto[];
  configuredCollectors: CollectorConfigEntry[];
  onChange: (collectors: CollectorConfigEntry[]) => void;
  loading?: boolean;
  /** Called when collector form validity changes */
  onValidChange?: (isValid: boolean) => void;
}

/**
 * Component for managing collector configurations within a health check.
 * Shows currently configured collectors and allows adding new ones.
 */
export const CollectorList: React.FC<CollectorListProps> = ({
  strategyId,
  availableCollectors,
  configuredCollectors,
  onChange,
  loading,
  onValidChange,
}) => {
  // Track validity state per collector index
  const [validityMap, setValidityMap] = useState<Record<number, boolean>>({});

  // Compute overall validity and report changes
  useEffect(() => {
    if (!onValidChange) return;

    // All collectors must be valid (or have no config schema)
    const isValid = configuredCollectors.every((_, index) => {
      // If no validity recorded for this collector, assume valid (no schema)
      return validityMap[index] !== false;
    });

    onValidChange(isValid);
  }, [validityMap, configuredCollectors, onValidChange]);

  const handleCollectorValidChange = useCallback(
    (index: number, isValid: boolean) => {
      setValidityMap((prev) => ({ ...prev, [index]: isValid }));
    },
    []
  );
  // Separate built-in and external collectors
  const builtInCollectors = availableCollectors.filter((c) =>
    isBuiltInCollector(c.id, strategyId)
  );
  const externalCollectors = availableCollectors.filter(
    (c) => !isBuiltInCollector(c.id, strategyId)
  );

  // Get collectors that can still be added
  const getAddableCollectors = () => {
    const configuredIds = new Set(
      configuredCollectors.map((c) => c.collectorId)
    );

    return availableCollectors.filter((c) => {
      // Already configured?
      if (configuredIds.has(c.id)) {
        // Can add multiple?
        return c.allowMultiple;
      }
      return true;
    });
  };

  const addableCollectors = getAddableCollectors();

  const handleAdd = (collectorId: string) => {
    const collector = availableCollectors.find((c) => c.id === collectorId);
    if (!collector) return;

    const newEntry: CollectorConfigEntry = {
      collectorId,
      config: {},
      assertions: [],
    };

    onChange([...configuredCollectors, newEntry]);
  };

  const handleRemove = (index: number) => {
    const updated = [...configuredCollectors];
    updated.splice(index, 1);
    onChange(updated);
  };

  const handleConfigChange = (
    index: number,
    config: Record<string, unknown>
  ) => {
    const updated = [...configuredCollectors];
    updated[index] = { ...updated[index], config };
    onChange(updated);
  };

  const handleAssertionsChange = (index: number, assertions: Assertion[]) => {
    const updated = [...configuredCollectors];
    updated[index] = { ...updated[index], assertions };
    onChange(updated);
  };

  const getCollectorDetails = (collectorId: string) => {
    return availableCollectors.find((c) => c.id === collectorId);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm">
            Loading collectors...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Check Items</CardTitle>
        {addableCollectors.length > 0 && (
          <Select value="" onValueChange={handleAdd}>
            <SelectTrigger className="w-[200px]">
              <Plus className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Add collector..." />
            </SelectTrigger>
            <SelectContent>
              {/* Built-in collectors first */}
              {builtInCollectors.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Built-in
                  </div>
                  {builtInCollectors
                    .filter((c) => addableCollectors.some((a) => a.id === c.id))
                    .map((collector) => (
                      <SelectItem key={collector.id} value={collector.id}>
                        <div className="flex items-center gap-2">
                          <span>{collector.displayName}</span>
                          {collector.allowMultiple && (
                            <Badge variant="outline" className="text-xs">
                              Multiple
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                </>
              )}
              {/* External collectors */}
              {externalCollectors.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    External
                  </div>
                  {externalCollectors
                    .filter((c) => addableCollectors.some((a) => a.id === c.id))
                    .map((collector) => (
                      <SelectItem key={collector.id} value={collector.id}>
                        <div className="flex items-center gap-2">
                          <span>{collector.displayName}</span>
                          {collector.allowMultiple && (
                            <Badge variant="outline" className="text-xs">
                              Multiple
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                </>
              )}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        {configuredCollectors.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center py-4">
            No check items configured. Add a collector to define what to check.
          </div>
        ) : (
          <Accordion type="multiple" className="w-full">
            {configuredCollectors.map((entry, index) => {
              const collector = getCollectorDetails(entry.collectorId);
              const isBuiltIn = isBuiltInCollector(
                entry.collectorId,
                strategyId
              );

              return (
                <AccordionItem key={index} value={`item-${index}`}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-medium">
                        {collector?.displayName || entry.collectorId}
                      </span>
                      {isBuiltIn && (
                        <Badge variant="secondary" className="text-xs">
                          Built-in
                        </Badge>
                      )}
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      className="inline-flex items-center justify-center rounded-md h-8 w-8 text-destructive hover:text-destructive hover:bg-accent cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(index);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          handleRemove(index);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-6 pt-4">
                      {/* Configuration Section */}
                      {collector?.configSchema && (
                        <div className="space-y-4">
                          <Label className="text-sm font-medium">
                            Configuration
                          </Label>
                          <DynamicForm
                            schema={collector.configSchema}
                            value={entry.config}
                            onChange={(config) =>
                              handleConfigChange(index, config)
                            }
                            onValidChange={(isValid) =>
                              handleCollectorValidChange(index, isValid)
                            }
                          />
                        </div>
                      )}

                      {/* Assertion Builder Section */}
                      {collector?.resultSchema && (
                        <div className="space-y-4">
                          <Label className="text-sm font-medium">
                            Assertions
                          </Label>
                          <AssertionBuilder
                            resultSchema={collector.resultSchema}
                            assertions={
                              (entry.assertions as unknown as Assertion[]) ?? []
                            }
                            onChange={(assertions) =>
                              handleAssertionsChange(index, assertions)
                            }
                          />
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
};

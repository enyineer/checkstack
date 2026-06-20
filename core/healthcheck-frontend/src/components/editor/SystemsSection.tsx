import React, { useMemo, useState } from "react";
import { Checkbox, Input, Alert, AlertContent } from "@checkstack/ui";
import { Info, Search } from "lucide-react";

interface SystemOption {
  id: string;
  name: string;
  description?: string | null;
}

interface SystemsSectionProps {
  systems: SystemOption[];
  selectedSystemIds: string[];
  loading: boolean;
  onChange: (systemIds: string[]) => void;
}

export const SystemsSection: React.FC<SystemsSectionProps> = ({
  systems,
  selectedSystemIds,
  loading,
  onChange,
}) => {
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(
    () => new Set(selectedSystemIds),
    [selectedSystemIds],
  );

  const filteredSystems = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return systems;
    return systems.filter((s) => s.name.toLowerCase().includes(trimmed));
  }, [systems, query]);

  const toggle = ({ systemId }: { systemId: string }) => {
    if (selectedSet.has(systemId)) {
      onChange(selectedSystemIds.filter((id) => id !== systemId));
    } else {
      onChange([...selectedSystemIds, systemId]);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Assign to systems</h2>
        <p className="text-sm text-muted-foreground">
          Optionally pick systems this check should monitor. You can also
          assign it later from a system&apos;s catalog page.
        </p>
      </div>

      <Alert variant="info">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <AlertContent>
          Health checks are reusable templates - they can be assigned to
          additional systems at any time.
        </AlertContent>
      </Alert>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search systems..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            disabled={loading}
          />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground italic px-1">
            Loading systems...
          </p>
        ) : filteredSystems.length === 0 ? (
          <p className="text-sm text-muted-foreground italic px-1">
            {systems.length === 0
              ? "No systems exist yet. Create one from the catalog first."
              : "No systems match your search."}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border/50 divide-y divide-border/50">
            {filteredSystems.map((system) => {
              const isChecked = selectedSet.has(system.id);
              return (
                <button
                  key={system.id}
                  type="button"
                  onClick={() => toggle({ systemId: system.id })}
                  className="flex items-start gap-3 w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle({ systemId: system.id })}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {system.name}
                    </div>
                    {system.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {system.description}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedSystemIds.length > 0 && (
          <p className="text-xs text-muted-foreground px-1">
            {selectedSystemIds.length} system
            {selectedSystemIds.length === 1 ? "" : "s"} selected
          </p>
        )}
      </div>
    </div>
  );
};

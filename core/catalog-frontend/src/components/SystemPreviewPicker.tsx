import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import { Server } from "lucide-react";

/** The minimum a system needs to expose to be offered as a preview subject. */
export interface PreviewSystem {
  id: string;
  name: string;
}

interface SystemPreviewPickerProps {
  /** Systems to choose from. Only ones the caller may read should be passed. */
  systems: ReadonlyArray<PreviewSystem>;
  /** Currently selected system id, or null for "none". */
  selectedId: string | null;
  /** Called with the picked id, or null when the author clears the selection. */
  onSelect: (systemId: string | null) => void;
}

/**
 * Unobtrusive "System:" picker, the sibling of {@link EnvironmentPreviewPicker}.
 *
 * Lets a config author pick a catalog system so `{{ system.metadata.<key> }}`
 * previews its resolved value and offers completions. Without it, system
 * templating could only be previewed when the editor happened to be opened FROM
 * a system - so authoring a shared check, or editing any existing check, gave no
 * preview and no autocomplete at all.
 *
 * Purely presentational: the host supplies the system list and selection state.
 * Renders nothing when there are no systems to preview against.
 */
export const SystemPreviewPicker: React.FC<SystemPreviewPickerProps> = ({
  systems,
  selectedId,
  onSelect,
}) => {
  if (systems.length === 0) return null;

  // Sentinel value for the "no system" option - the underlying Select
  // primitive cannot use an empty-string item value.
  const NONE = "__none__";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Server className="h-3.5 w-3.5 shrink-0" />
      <span>System:</span>
      <Select
        value={selectedId ?? NONE}
        onValueChange={(value) => onSelect(value === NONE ? null : value)}
      >
        <SelectTrigger className="h-7 w-[180px] text-xs">
          <SelectValue placeholder="No system" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No system</SelectItem>
          {systems.map((system) => (
            <SelectItem key={system.id} value={system.id}>
              {system.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

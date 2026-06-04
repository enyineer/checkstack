import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import { Eye } from "lucide-react";
import type { Environment } from "@checkstack/catalog-common";
import { toPreviewOptions } from "./environment-preview.logic";

interface EnvironmentPreviewPickerProps {
  /** Environments to choose from (the system's, or all when no system applies). */
  environments: ReadonlyArray<Environment>;
  /** Currently selected environment id, or null for "none". */
  selectedId: string | null;
  /** Called with the picked id, or null when the author clears the selection. */
  onSelect: (environmentId: string | null) => void;
}

/**
 * Unobtrusive "Preview as: &lt;environment&gt;" picker. Lets a config author
 * pick a catalog environment so `x-templatable` fields (e.g. an HTTP URL using
 * `{{ environment.baseUrl }}`) preview their resolved value live. Purely
 * presentational: the host supplies the environment list + selection state.
 * Renders nothing when there are no environments to preview against.
 */
export const EnvironmentPreviewPicker: React.FC<
  EnvironmentPreviewPickerProps
> = ({ environments, selectedId, onSelect }) => {
  if (environments.length === 0) return null;

  const options = toPreviewOptions(environments);
  // Sentinel value for the "no environment" option — the underlying Select
  // primitive cannot use an empty-string item value.
  const NONE = "__none__";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span>Preview as:</span>
      <Select
        value={selectedId ?? NONE}
        onValueChange={(value) => onSelect(value === NONE ? null : value)}
      >
        <SelectTrigger className="h-7 w-[180px] text-xs">
          <SelectValue placeholder="No environment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No environment</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

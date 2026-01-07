import React from "react";
import { Loader2, ChevronDown } from "lucide-react";

import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../index";

import type { DynamicOptionsFieldProps, ResolverOption } from "./types";
import { getCleanDescription } from "./utils";

/**
 * Field component for dynamically resolved options.
 * Fetches options using the specified resolver and renders a Select.
 * When searchable is true, shows a searchable dropdown with filter inside.
 */
export const DynamicOptionsField: React.FC<DynamicOptionsFieldProps> = ({
  id,
  label,
  description,
  value,
  isRequired,
  resolverName,
  dependsOn,
  searchable,
  formValues,
  optionsResolvers,
  onChange,
}) => {
  const [options, setOptions] = React.useState<ResolverOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  // Use ref to store formValues to avoid re-renders when unrelated fields change
  const formValuesRef = React.useRef(formValues);
  formValuesRef.current = formValues;

  // Build dependency values string for useEffect dependency tracking
  // Only includes the specific fields this resolver depends on
  const dependencyValues = React.useMemo(() => {
    if (!dependsOn || dependsOn.length === 0) return "";
    return dependsOn.map((key) => JSON.stringify(formValues[key])).join("|");
  }, [dependsOn, formValues]);

  React.useEffect(() => {
    const resolver = optionsResolvers[resolverName];
    if (!resolver) {
      setError(`Resolver "${resolverName}" not found`);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    // Use ref to get current form values without adding to dependencies
    resolver(formValuesRef.current)
      .then((result) => {
        if (!cancelled) {
          setOptions(result);
          setLoading(false);
        }
      })
      .catch((error_) => {
        if (!cancelled) {
          setError(
            error_ instanceof Error ? error_.message : "Failed to load options"
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Only re-fetch when resolver changes or explicit dependencies change
  }, [resolverName, optionsResolvers, dependencyValues]);

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchable || !searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(query));
  }, [options, searchQuery, searchable]);

  // Get the selected option label
  const selectedLabel = React.useMemo(() => {
    const selected = options.find((opt) => opt.value === value);
    return selected?.label;
  }, [options, value]);

  const cleanDesc = getCleanDescription(description);

  // Render searchable dropdown with search inside
  if (searchable && !loading && !error && options.length > 0) {
    return (
      <div className="space-y-2">
        <div>
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
          {cleanDesc && (
            <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={selectedLabel ? "" : "text-muted-foreground"}>
              {selectedLabel || `Select ${label}`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
          {open && (
            <div className="absolute z-[100] mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
              <div className="p-2 border-b border-border">
                <Input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8"
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-y-auto p-1">
                {filteredOptions.length === 0 ? (
                  <div className="py-2 px-3 text-sm text-muted-foreground text-center">
                    No matching options
                  </div>
                ) : (
                  filteredOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                        setSearchQuery("");
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground ${
                        opt.value === value
                          ? "bg-accent text-accent-foreground"
                          : ""
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Regular dropdown
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={id}>
          {label} {isRequired && "*"}
        </Label>
        {cleanDesc && (
          <p className="text-sm text-muted-foreground mt-0.5">{cleanDesc}</p>
        )}
      </div>
      <div className="relative">
        {loading ? (
          <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Loading options...
            </span>
          </div>
        ) : error ? (
          <div className="flex items-center h-10 px-3 border border-destructive rounded-md bg-destructive/10">
            <span className="text-sm text-destructive">{error}</span>
          </div>
        ) : (
          <Select
            value={(value as string) || ""}
            onValueChange={(val) => onChange(val)}
            disabled={options.length === 0}
          >
            <SelectTrigger id={id}>
              <SelectValue
                placeholder={
                  options.length === 0
                    ? "No options available"
                    : `Select ${label}`
                }
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
};

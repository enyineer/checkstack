import React from "react";
import { ChevronDown } from "lucide-react";

import {
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "../../index";

import type { DynamicOptionsFieldProps, ResolverOption } from "./types";
import { getCleanDescription, NONE_SENTINEL, coerceNumberInput } from "./utils";
import { extractErrorMessage } from "@checkstack/common";

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
  optionsStyle,
  valueType,
  formValues,
  optionsResolvers,
  resolversDependencyKey,
  onChange,
}) => {
  // Resolver options always carry STRING values, but a number/integer field
  // stores a NUMBER. Bridge both directions here: `valueString` is what option
  // matching and the Select compare against (so a stored 0 shows as selected),
  // and `emitValue` parses a picked option back to a number before emitting
  // (so the saved config passes the backend's z.number() schema). String
  // fields keep the raw pass-through.
  const isNumericValue = valueType === "number" || valueType === "integer";
  const valueString =
    value === undefined || value === null ? "" : String(value);
  const emitValue = (raw?: string): void => {
    if (raw === undefined) {
      onChange();
      return;
    }
    if (!isNumericValue) {
      onChange(raw);
      return;
    }
    onChange(coerceNumberInput({ raw, isInteger: valueType === "integer" }));
  };

  const [options, setOptions] = React.useState<ResolverOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [catalogOpen, setCatalogOpen] = React.useState(false);

  // Use ref to store formValues to avoid re-renders when unrelated fields change
  const formValuesRef = React.useRef(formValues);
  formValuesRef.current = formValues;

  // Ref the resolvers too. A parent re-render (e.g. typing in ANOTHER field of
  // the same form) can hand down a new `optionsResolvers` object identity even
  // though the resolver for THIS field is unchanged. Reading it from a ref keeps
  // it out of the fetch effect's dependencies, so the field only re-fetches when
  // its resolver NAME or its declared `x-depends-on` values change - not on
  // every unrelated keystroke (which made the picker flash + re-fetch).
  const optionsResolversRef = React.useRef(optionsResolvers);
  optionsResolversRef.current = optionsResolvers;

  // Build dependency values string for useEffect dependency tracking
  // Only includes the specific fields this resolver depends on
  const dependencyValues = React.useMemo(() => {
    if (!dependsOn || dependsOn.length === 0) return "";
    return dependsOn.map((key) => JSON.stringify(formValues[key])).join("|");
  }, [dependsOn, formValues]);

  React.useEffect(() => {
    const resolver = optionsResolversRef.current[resolverName];
    if (!resolver) {
      setError(`Resolver "${resolverName}" not found`);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    // Use refs to get the current resolvers + form values without adding them
    // to the dependencies (see the refs above).
    resolver(formValuesRef.current)
      .then((result) => {
        if (!cancelled) {
          setOptions(result);
          setLoading(false);
        }
      })
      .catch((error_) => {
        if (!cancelled) {
          setError(extractErrorMessage(error_, "Failed to load options"));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Re-fetch when the resolver NAME, this field's declared `x-depends-on`
    // values, or the EXTERNAL `resolversDependencyKey` change - the last covers
    // state a resolver closes over that is NOT in `formValues` (e.g. the health
    // check editor's sibling strategy config, which `x-depends-on` cannot name).
    // An unrelated field re-rendering the form still does NOT refetch (the
    // resolvers object identity is read via ref above, and the key is a stable
    // fingerprint the host memoizes).
  }, [resolverName, dependencyValues, resolversDependencyKey]);

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchable || !searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(query));
  }, [options, searchQuery, searchable]);

  // Get the selected option label
  const selectedLabel = React.useMemo(() => {
    const selected = options.find((opt) => opt.value === valueString);
    return selected?.label;
  }, [options, valueString]);

  const cleanDesc = getCleanDescription(description);

  // Catalog style: a trigger button + a browsable modal of cards showing each
  // option's label AND description, so the operator can tell options apart by
  // more than a one-word label (e.g. picking an AI skill). Falls back to the
  // loading/error chrome the Select style uses.
  if (optionsStyle === "catalog") {
    const selected = options.find((opt) => opt.value === valueString);
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
        {loading ? (
          <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
            <Spinner size="sm" className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Loading options...
            </span>
          </div>
        ) : error ? (
          <div className="flex items-center h-10 px-3 border border-destructive rounded-md bg-destructive/10">
            <span className="text-sm text-destructive">{error}</span>
          </div>
        ) : (
          <button
            id={id}
            type="button"
            onClick={() => setCatalogOpen(true)}
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <span className={selected ? "" : "text-muted-foreground"}>
              {selected?.label ?? `Choose ${label}`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        )}
        <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Choose {label}</DialogTitle>
              {cleanDesc && <DialogDescription>{cleanDesc}</DialogDescription>}
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {!isRequired && (
                <button
                  type="button"
                  onClick={() => {
                    emitValue();
                    setCatalogOpen(false);
                  }}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary ${
                    valueString ? "" : "border-primary bg-primary/5"
                  }`}
                >
                  None
                </button>
              )}
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    emitValue(opt.value);
                    setCatalogOpen(false);
                  }}
                  className={`flex w-full flex-col gap-1 rounded-md border p-3 text-left transition-colors hover:border-primary ${
                    opt.value === valueString ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{opt.label}</span>
                    {opt.value === valueString && (
                      <Badge variant="secondary" className="ml-auto">
                        Selected
                      </Badge>
                    )}
                  </div>
                  {opt.description && (
                    <p className="text-sm text-muted-foreground">
                      {opt.description}
                    </p>
                  )}
                </button>
              ))}
              {options.length === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  No options available.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

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
                  <>
                    {!isRequired && (
                      <button
                        type="button"
                        onClick={() => {
                          emitValue();
                          setOpen(false);
                          setSearchQuery("");
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground text-muted-foreground ${
                          valueString ? "" : "bg-accent text-accent-foreground"
                        }`}
                      >
                        None
                      </button>
                    )}
                    {filteredOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          emitValue(opt.value);
                          setOpen(false);
                          setSearchQuery("");
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground ${
                          opt.value === valueString
                            ? "bg-accent text-accent-foreground"
                            : ""
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </>
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
            <Spinner size="sm" className="text-muted-foreground" />
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
            value={valueString}
            onValueChange={(val) =>
              emitValue(val === NONE_SENTINEL ? undefined : val)
            }
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
              {!isRequired && (
                <SelectItem
                  value={NONE_SENTINEL}
                  className="text-muted-foreground"
                >
                  None
                </SelectItem>
              )}
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

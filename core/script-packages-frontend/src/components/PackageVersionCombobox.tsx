import React from "react";
import { Check, Tag } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { ScriptPackagesApi } from "@checkstack/script-packages-common";
import {
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  cn,
  comboboxAnchorProps,
  isAnchorInteraction,
} from "@checkstack/ui";

export interface PackageVersionComboboxProps {
  /** The chosen package name; versions are fetched for it (when non-empty). */
  packageName: string;
  /** Current version value (controlled, free-typeable). */
  value: string;
  onValueChange: (next: string) => void;
  /**
   * Called once with `dist-tags.latest` (if any) the first time versions
   * load for a package, so the parent can default-select it. The parent
   * decides whether to honor it (e.g. only when the field is still empty).
   */
  onVersionsLoaded?: (input: { latest?: string }) => void;
  id?: string;
  placeholder?: string;
}

/**
 * Hybrid version field: fetched, newest-first version suggestions from the
 * configured registry PLUS a free-typeable input so an exact pin can be
 * entered by hand. Backend-proxied via the script-packages plugin's
 * `getPackageVersions` (same-plugin query, no manual invalidation).
 *
 * Validation of the typed value against the strict pinned-version rules is
 * the parent's job (surfaced inline next to the Add button); this component
 * only sources suggestions and lets the value be edited freely.
 */
export const PackageVersionCombobox: React.FC<PackageVersionComboboxProps> = ({
  packageName,
  value,
  onValueChange,
  onVersionsLoaded,
  id,
  placeholder,
}) => {
  const client = usePluginClient(ScriptPackagesApi);
  const [open, setOpen] = React.useState(false);

  const versionsQuery = client.getPackageVersions.useQuery(
    { name: packageName },
    { enabled: packageName.trim().length > 0 },
  );

  const versions = React.useMemo(
    () => versionsQuery.data?.versions ?? [],
    [versionsQuery.data],
  );
  const distTags = versionsQuery.data?.distTags;
  const latest = distTags?.latest;

  // Fire `onVersionsLoaded` once per package once its versions resolve, so the
  // parent can default-select `latest`. Keyed on the package name + a load
  // flag so re-renders don't re-fire it.
  const notifiedForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!versionsQuery.data) return;
    if (notifiedForRef.current === packageName) return;
    notifiedForRef.current = packageName;
    onVersionsLoaded?.({ latest });
  }, [versionsQuery.data, packageName, latest, onVersionsLoaded]);

  /** Build the tag label(s) for a version (e.g. "latest", "next"). */
  const tagsFor = (version: string): string[] =>
    distTags
      ? Object.entries(distTags)
          .filter(([, v]) => v === version)
          .map(([tag]) => tag)
      : [];

  const inputRef = React.useRef<HTMLInputElement>(null);

  const handlePick = (version: string) => {
    onValueChange(version);
    setOpen(false);
    inputRef.current?.focus();
  };

  const hasSuggestions = versions.length > 0;

  return (
    <Popover open={open && hasSuggestions} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          id={id}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onFocus={() => {
            if (hasSuggestions) setOpen(true);
          }}
          onClick={() => {
            if (hasSuggestions) setOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          {...comboboxAnchorProps}
        />
      </PopoverAnchor>
      {hasSuggestions && (
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => {
            if (isAnchorInteraction(e.target)) e.preventDefault();
          }}
          onFocusOutside={(e) => {
            if (isAnchorInteraction(e.target)) e.preventDefault();
          }}
        >
          <div className="max-h-80 overflow-y-auto py-1">
            {versions.map((version) => {
              const tags = tagsFor(version);
              const selected = version === value;
              return (
                <button
                  key={version}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handlePick(version)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                    selected && "bg-accent/50",
                  )}
                >
                  <Check
                    className={cn(
                      "h-3 w-3 shrink-0",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <code className="flex-1 truncate font-mono text-xs">
                    {version}
                  </code>
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground"
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {tag}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
};

import React from "react";
import { Plus, Trash2, KeyRound, Search, AlertTriangle } from "lucide-react";
import { Button } from "../Button";
import { Input } from "../Input";
import { Popover, PopoverAnchor, PopoverContent } from "../Popover";
import { usePerformance } from "../PerformanceProvider";
import {
  comboboxAnchorProps,
  isAnchorInteraction,
} from "../comboboxInteraction";
import {
  objectToRows,
  rowsToObject,
  unknownSecretNames,
  type SecretEnvRow,
} from "./secretEnv.logic";

/**
 * Editor for a secret -> env mapping (`{ ENV_NAME: "${{ secrets.NAME }}" }`).
 *
 * Each row is an env-var name (free text) plus the referenced secret name.
 * The secret field is a searchable combobox (modeled on `VariablePicker` /
 * `PackageNameCombobox`): type to filter the `secretNames` supplied by the
 * secrets plugin's `listSecretNames`, pick one, or free-type a name that
 * isn't there yet (it still round-trips). The stored value is always the
 * canonical `${{ secrets.NAME }}` template.
 *
 * When a row references a name that the loaded `secretNames` doesn't contain,
 * the row shows a non-blocking warning (red border + message) — the secret
 * may have been deleted/renamed or will be created later, so save is not
 * prevented. No warning is shown while `secretNames` is still loading
 * (undefined/empty).
 *
 * No infinite animations or blurs, so it degrades fine on low-power devices.
 */
export interface SecretEnvEditorProps {
  /** Unique id prefix for inputs. */
  id: string;
  /** Current mapping `{ ENV_NAME: "${{ secrets.NAME }}" }`. */
  value: Record<string, string>;
  /** Callback when the mapping changes. */
  onChange: (next: Record<string, string>) => void;
  /** Available secret names for the value picker (names only, never values). */
  secretNames?: string[];
}

export const SecretEnvEditor: React.FC<SecretEnvEditorProps> = ({
  id,
  value,
  onChange,
  secretNames,
}) => {
  // Internal row state allows incomplete rows while editing; serialization
  // to the parent drops them (mirrors KeyValueEditor).
  const [rows, setRows] = React.useState<SecretEnvRow[]>(() => objectToRows(value));
  const isInternalChangeRef = React.useRef(false);

  React.useEffect(() => {
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      return;
    }
    if (Object.keys(value).length > 0) {
      setRows(objectToRows(value));
    }
  }, [value]);

  const notify = (next: SecretEnvRow[]) => {
    isInternalChangeRef.current = true;
    setRows(next);
    onChange(rowsToObject(next));
  };

  // Referenced names not in the loaded list — drives the per-row warning.
  // Empty while loading (undefined/empty list), so we don't warn early.
  const unknown = React.useMemo(
    () => unknownSecretNames({ rows, secretNames }),
    [rows, secretNames],
  );

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No secrets mapped. Add an environment variable backed by a secret.
        </p>
      )}

      {rows.map((row, index) => {
        const isUnknown =
          row.secretName.trim() !== "" && unknown.has(row.secretName.trim());
        return (
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                id={`${id}-env-${index}`}
                value={row.envName}
                onChange={(e) => {
                  const next = [...rows];
                  next[index] = { ...next[index], envName: e.target.value };
                  notify(next);
                }}
                placeholder="ENV_NAME"
                className="flex-1 font-mono text-sm"
              />
              <span className="text-muted-foreground">=</span>
              <SecretNameCombobox
                id={`${id}-secret-${index}`}
                value={row.secretName}
                secretNames={secretNames}
                invalid={isUnknown}
                onChange={(secretName) => {
                  const next = [...rows];
                  next[index] = { ...next[index], secretName };
                  notify(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  const next = [...rows];
                  next.splice(index, 1);
                  notify(next);
                }}
                className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive/90"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {isUnknown && (
              <p className="flex items-center gap-1 pl-1 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  No secret named{" "}
                  <code className="font-mono">{row.secretName.trim()}</code> — it
                  may have been deleted or renamed.
                </span>
              </p>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => notify([...rows, { envName: "", secretName: "" }])}
        className="h-8 gap-1"
      >
        <Plus className="h-4 w-4" />
        Add secret
      </Button>
    </div>
  );
};

interface SecretNameComboboxProps {
  id: string;
  value: string;
  secretNames?: string[];
  invalid?: boolean;
  onChange: (next: string) => void;
}

/**
 * Searchable secret-name field. Composes `Popover` + `Input` (no Combobox
 * primitive exists) and mirrors `PackageNameCombobox`: a scrollable,
 * type-to-filter list with keyboard navigation. Picking sets the value;
 * a free-typed name not in the list still round-trips (a secret may be
 * created later). `isLowPower`-aware: no entry transition on the list.
 */
const SecretNameCombobox: React.FC<SecretNameComboboxProps> = ({
  id,
  value,
  secretNames,
  invalid,
  onChange,
}) => {
  const { isLowPower } = usePerformance();
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const hasNames = (secretNames?.length ?? 0) > 0;

  const filtered = React.useMemo(() => {
    const names = secretNames ?? [];
    const q = value.trim().toLowerCase();
    if (q === "") return names;
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [secretNames, value]);

  // Keep the highlighted row in range as the filter changes.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [value]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || filtered.length === 0) return;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setActiveIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        break;
      }
      case "Enter": {
        const candidate = filtered[activeIndex];
        if (candidate) {
          e.preventDefault();
          pick(candidate);
        }
        break;
      }
    }
  };

  return (
    <div className="relative flex-1">
      <Popover open={open && hasNames} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              id={id}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                if (hasNames) setOpen(true);
              }}
              onFocus={() => {
                if (hasNames) setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder="secret name"
              autoComplete="off"
              aria-invalid={invalid || undefined}
              className={`pl-8 font-mono text-sm ${
                invalid
                  ? "border-destructive focus-visible:ring-destructive"
                  : ""
              }`}
              {...comboboxAnchorProps}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0"
          // Keep focus in the input so typing continues uninterrupted, and
          // don't yank focus on close (would re-trigger the anchor's onFocus).
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // The anchor input lives OUTSIDE the floating content, so the very
          // focus/click that opens the list is otherwise seen by Radix's
          // dismissable layer as an outside interaction and closes it on the
          // same frame. Guard both handlers against anchor-origin events.
          onPointerDownOutside={(e) => {
            if (isAnchorInteraction(e.target)) e.preventDefault();
          }}
          onFocusOutside={(e) => {
            if (isAnchorInteraction(e.target)) e.preventDefault();
          }}
        >
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs italic text-muted-foreground">
                No matching secrets.
              </p>
            ) : (
              filtered.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  // mousedown so the pick lands before the input's blur shuffle.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(name)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : ""
                  } ${isLowPower ? "" : "transition-colors"} hover:bg-accent hover:text-accent-foreground`}
                >
                  <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <code className="flex-1 truncate font-mono text-xs">
                    {name}
                  </code>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

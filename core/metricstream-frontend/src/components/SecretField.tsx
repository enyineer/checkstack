import { useState } from "react";
import { Input, Label, cn } from "@checkstack/ui";
import { Eye, EyeOff } from "lucide-react";
import type { ScrapeSecretState } from "../lib/scrape-form";

export interface SecretFieldProps {
  id: string;
  label: string;
  description?: string;
  value: ScrapeSecretState;
  onChange: (next: ScrapeSecretState) => void;
  disabled?: boolean;
}

/**
 * A single optional-secret input that mirrors the DynamicForm `SecretField`
 * affordance (that component is file-private to `@checkstack/ui`, so the markup
 * is replicated here for the bespoke scrape-target resource). A stored secret
 * reads back masked - "leave empty to keep"; typing replaces it; "Clear" marks
 * it for removal with an "Undo". The parent maps the resulting state to the
 * frozen contract sentinel (omit = keep, `null` = clear, string = set) via
 * `updateBearerToken`.
 */
export function SecretField({
  id,
  label,
  description,
  value,
  onChange,
  disabled,
}: SecretFieldProps) {
  const [visible, setVisible] = useState(false);
  const hasInput = value.value.trim().length > 0;

  const placeholder = value.cleared
    ? "Secret will be cleared on save"
    : value.stored
      ? "Stored - leave empty to keep"
      : "Enter a bearer token (optional)";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value.cleared ? "" : value.value}
          disabled={disabled}
          placeholder={placeholder}
          className="pr-10"
          onChange={(e) =>
            onChange({ ...value, value: e.target.value, cleared: false })
          }
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label={visible ? "Hide secret" : "Show secret"}
        >
          {visible ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </button>
      </div>

      {value.cleared ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive">
            Stored secret will be removed on save.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, cleared: false })}
            className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
          >
            Undo
          </button>
        </div>
      ) : value.stored && !hasInput ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            A secret is stored. Leave empty to keep it.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, value: "", cleared: true })}
            className="text-xs font-medium text-destructive underline hover:text-destructive/80"
          >
            Clear
          </button>
        </div>
      ) : (
        description && (
          <p className={cn("text-xs text-muted-foreground")}>{description}</p>
        )
      )}
    </div>
  );
}

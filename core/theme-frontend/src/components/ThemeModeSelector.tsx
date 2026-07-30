import React from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn, type Theme } from "@checkstack/ui";
import { THEME_MODES } from "./theme-mode.logic";

/**
 * Icon per mode. Imported directly rather than via `DynamicIcon`: that resolves
 * names through a lazily-loaded registry of the whole lucide set, which is the
 * wrong trade for three fixed icons in a control that must paint immediately.
 */
export const THEME_MODE_ICONS: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

interface ThemeModeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
  disabled?: boolean;
}

/**
 * Segmented Light / Dark / Auto control.
 *
 * A segmented control rather than the previous two-state switch, because the
 * choice genuinely has three values. A switch can only ever write `light` or
 * `dark`, which is what made "Auto" unreachable once a user had touched it -
 * the preference was persisted as `system` but no control could express it.
 *
 * Rendered as a radiogroup so the whole control is one tab stop, which is how a
 * native segmented control behaves.
 */
export const ThemeModeSelector: React.FC<ThemeModeSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => (
  <div
    role="radiogroup"
    aria-label="Theme"
    className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-inset p-0.5"
  >
    {THEME_MODES.map((mode) => {
      const selected = mode.value === value;
      const Icon = THEME_MODE_ICONS[mode.value];
      return (
        <button
          key={mode.value}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={mode.label}
          disabled={disabled}
          onClick={() => onChange(mode.value)}
          className={cn(
            "inline-flex items-center gap-1 rounded-[0.25rem] px-2 py-1 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            selected
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {mode.label}
        </button>
      );
    })}
  </div>
);

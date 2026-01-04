import * as React from "react";
import { cn } from "../utils";

interface ColorPickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  id,
  value,
  onChange,
  placeholder = "#000000",
  className,
}) => {
  const colorInputRef = React.useRef<HTMLInputElement>(null);

  // Normalize hex color (add # if missing, ensure valid format for color input)
  const normalizedValue = React.useMemo(() => {
    if (!value) return "#000000";
    const hex = value.startsWith("#") ? value : `#${value}`;
    // Validate hex format for the color input (must be #RRGGBB)
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      return hex;
    }
    // Handle 3-character hex
    if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
      const r = hex[1];
      const g = hex[2];
      const b = hex[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return "#000000";
  }, [value]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        className="h-10 w-10 shrink-0 rounded-md border border-input overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-shadow"
        style={{ backgroundColor: normalizedValue }}
        onClick={() => colorInputRef.current?.click()}
        aria-label="Pick color"
      >
        <input
          ref={colorInputRef}
          type="color"
          value={normalizedValue}
          onChange={(e) => onChange(e.target.value)}
          className="sr-only"
          tabIndex={-1}
        />
      </button>
      <input
        id={id}
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
};

ColorPicker.displayName = "ColorPicker";

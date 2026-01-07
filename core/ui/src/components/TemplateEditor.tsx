import * as React from "react";
import { cn } from "../utils";

/**
 * A single payload property available for templating
 */
export interface TemplateProperty {
  /** Full path to the property, e.g., "payload.incident.title" */
  path: string;
  /** Type of the property, e.g., "string", "number", "boolean" */
  type: string;
  /** Optional description of the property */
  description?: string;
}

export interface TemplateEditorProps {
  /** Current template value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Available properties for hints */
  availableProperties?: TemplateProperty[];
  /** Placeholder text */
  placeholder?: string;
  /** Number of rows */
  rows?: number;
  /** Additional class name */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Template syntax hint, e.g., "{{" */
  templateSyntax?: "mustache" | "dollar";
}

/**
 * Get display type color based on property type
 */
const getTypeColor = (type: string) => {
  switch (type.toLowerCase()) {
    case "string": {
      return "text-green-600 dark:text-green-400";
    }
    case "number":
    case "integer": {
      return "text-blue-600 dark:text-blue-400";
    }
    case "boolean": {
      return "text-purple-600 dark:text-purple-400";
    }
    case "array": {
      return "text-orange-600 dark:text-orange-400";
    }
    case "object": {
      return "text-yellow-600 dark:text-yellow-400";
    }
    default: {
      return "text-muted-foreground";
    }
  }
};

/**
 * TemplateEditor - A textarea with clickable payload property hints.
 *
 * Displays a list of available template properties below the textarea.
 * Clicking a property inserts it at the cursor position using the
 * configured template syntax (default: {{property}}).
 */
export const TemplateEditor = React.forwardRef<
  HTMLTextAreaElement,
  TemplateEditorProps
>(
  (
    {
      value,
      onChange,
      availableProperties = [],
      placeholder = "Enter template...",
      rows = 4,
      className,
      disabled = false,
      templateSyntax = "mustache",
    },
    ref
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

    // Merge refs
    React.useImperativeHandle(ref, () => textareaRef.current!);

    /**
     * Insert a property at the current cursor position
     */
    const insertProperty = (path: string) => {
      const textarea = textareaRef.current;
      if (!textarea || disabled) return;

      // Format based on syntax
      const template =
        templateSyntax === "mustache" ? `{{${path}}}` : `\${${path}}`;

      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;

      const newValue = value.slice(0, start) + template + value.slice(end);
      onChange(newValue);

      // Restore focus and move cursor after inserted text
      setTimeout(() => {
        textarea.focus();
        const newPosition = start + template.length;
        textarea.setSelectionRange(newPosition, newPosition);
      }, 0);
    };

    return (
      <div className={cn("space-y-2", className)}>
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={cn(
            "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono",
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "resize-y min-h-[80px]"
          )}
        />

        {/* Available properties */}
        {availableProperties.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Available properties{" "}
              <span className="font-normal">(click to insert)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableProperties.map((prop) => (
                <button
                  key={prop.path}
                  type="button"
                  onClick={() => insertProperty(prop.path)}
                  disabled={disabled}
                  title={prop.description ?? prop.path}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                    "bg-muted/50 hover:bg-muted transition-colors",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  <code className="font-mono">{prop.path}</code>
                  <span className={cn("font-normal", getTypeColor(prop.type))}>
                    {prop.type}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
);
TemplateEditor.displayName = "TemplateEditor";

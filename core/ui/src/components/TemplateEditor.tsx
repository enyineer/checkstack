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
 * Detects if the cursor is inside an unclosed template context (after {{ without matching }})
 * Returns the query text being typed and the position where {{ starts
 */
export const detectTemplateContext = (
  value: string,
  cursorPos: number,
  syntax: "mustache" | "dollar" = "mustache"
): { isInTemplate: boolean; query: string; startPos: number } => {
  const openToken = syntax === "mustache" ? "{{" : "${";
  const closeToken = syntax === "mustache" ? "}}" : "}";

  const textBeforeCursor = value.slice(0, cursorPos);
  const lastOpenBrace = textBeforeCursor.lastIndexOf(openToken);
  const lastCloseBrace = textBeforeCursor.lastIndexOf(closeToken);

  // If we're after {{ and no }} follows before cursor, we're in a template context
  if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
    const query = textBeforeCursor.slice(lastOpenBrace + openToken.length);
    // Only show popup if query doesn't contain newlines (single line context)
    if (!query.includes("\n")) {
      return { isInTemplate: true, query, startPos: lastOpenBrace };
    }
  }

  return { isInTemplate: false, query: "", startPos: -1 };
};

/**
 * Filter properties based on search query (fuzzy match on path)
 */
const filterProperties = (
  properties: TemplateProperty[],
  query: string
): TemplateProperty[] => {
  if (!query.trim()) return properties;
  const lowerQuery = query.toLowerCase();
  return properties.filter((prop) =>
    prop.path.toLowerCase().includes(lowerQuery)
  );
};

/**
 * TemplateEditor - A textarea with autocomplete for template properties.
 *
 * Shows an autocomplete popup when the user types "{{" with available
 * template properties. Supports keyboard navigation and filtering.
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
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const popupRef = React.useRef<HTMLDivElement | null>(null);

    // Autocomplete state
    const [showPopup, setShowPopup] = React.useState(false);
    const [popupPosition, setPopupPosition] = React.useState({
      top: 0,
      left: 0,
    });
    const [selectedIndex, setSelectedIndex] = React.useState(0);
    const [templateContext, setTemplateContext] = React.useState<{
      query: string;
      startPos: number;
    }>({ query: "", startPos: -1 });

    // Filtered properties based on query
    const filteredProperties = React.useMemo(
      () => filterProperties(availableProperties, templateContext.query),
      [availableProperties, templateContext.query]
    );

    // Merge refs
    React.useImperativeHandle(ref, () => textareaRef.current!);

    /**
     * Calculate popup position based on cursor location in textarea
     */
    const calculatePopupPosition = React.useCallback(() => {
      const textarea = textareaRef.current;
      const container = containerRef.current;
      if (!textarea || !container) return;

      // Get textarea position relative to container
      const textareaRect = textarea.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Simple positioning: below the textarea with fixed offset
      // For more accurate cursor-based positioning, we'd need to measure text
      const lineHeight =
        Number.parseInt(getComputedStyle(textarea).lineHeight) || 20;
      const paddingTop =
        Number.parseInt(getComputedStyle(textarea).paddingTop) || 8;

      // Count newlines before cursor to estimate vertical position
      const cursorPos = textarea.selectionStart ?? 0;
      const textBeforeCursor = value.slice(0, cursorPos);
      const lines = textBeforeCursor.split("\n");
      const currentLineIndex = lines.length - 1;

      // Position popup below current line
      const top =
        textareaRect.top -
        containerRect.top +
        paddingTop +
        (currentLineIndex + 1) * lineHeight;

      // Estimate horizontal position based on current line length
      const currentLine = lines[currentLineIndex] ?? "";
      const charWidth = 8; // Approximate monospace char width
      const paddingLeft =
        Number.parseInt(getComputedStyle(textarea).paddingLeft) || 12;
      const left = Math.min(
        paddingLeft + currentLine.length * charWidth,
        textareaRect.width - 200 // Keep popup within textarea bounds
      );

      setPopupPosition({
        top: Math.max(top, lineHeight),
        left: Math.max(left, 0),
      });
    }, [value]);

    /**
     * Handle text input and detect template context
     */
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      // Check template context after state update
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const cursorPos = textarea.selectionStart ?? 0;
        const context = detectTemplateContext(
          newValue,
          cursorPos,
          templateSyntax
        );

        if (context.isInTemplate && availableProperties.length > 0) {
          setTemplateContext({
            query: context.query,
            startPos: context.startPos,
          });
          setShowPopup(true);
          setSelectedIndex(0);
          calculatePopupPosition();
        } else {
          setShowPopup(false);
        }
      }, 0);
    };

    /**
     * Handle cursor position changes (click, arrow keys in text)
     */
    const handleSelect = () => {
      const textarea = textareaRef.current;
      if (!textarea || disabled) return;

      const cursorPos = textarea.selectionStart ?? 0;
      const context = detectTemplateContext(value, cursorPos, templateSyntax);

      if (context.isInTemplate && availableProperties.length > 0) {
        setTemplateContext({
          query: context.query,
          startPos: context.startPos,
        });
        setShowPopup(true);
        calculatePopupPosition();
      } else {
        setShowPopup(false);
      }
    };

    /**
     * Insert selected property at the template context position
     */
    const insertProperty = React.useCallback(
      (prop: TemplateProperty) => {
        const textarea = textareaRef.current;
        if (!textarea || disabled || templateContext.startPos === -1) return;

        const openToken = templateSyntax === "mustache" ? "{{" : "${";
        const closeToken = templateSyntax === "mustache" ? "}}" : "}";
        const template = `${openToken}${prop.path}${closeToken}`;

        // Replace from {{ to cursor with the complete template
        const cursorPos = textarea.selectionStart ?? 0;
        const newValue =
          value.slice(0, templateContext.startPos) +
          template +
          value.slice(cursorPos);

        onChange(newValue);
        setShowPopup(false);

        // Restore focus and move cursor after inserted text
        const newPosition = templateContext.startPos + template.length;
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(newPosition, newPosition);
        }, 0);
      },
      [value, onChange, templateContext.startPos, templateSyntax, disabled]
    );

    /**
     * Handle keyboard navigation in popup
     */
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showPopup || filteredProperties.length === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredProperties.length - 1 ? prev + 1 : 0
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredProperties.length - 1
          );
          break;
        }
        case "Enter":
        case "Tab": {
          e.preventDefault();
          const selected = filteredProperties[selectedIndex];
          if (selected) {
            insertProperty(selected);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          setShowPopup(false);
          break;
        }
      }
    };

    /**
     * Close popup when clicking outside
     */
    React.useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          popupRef.current &&
          !popupRef.current.contains(event.target as Node) &&
          textareaRef.current &&
          !textareaRef.current.contains(event.target as Node)
        ) {
          setShowPopup(false);
        }
      };

      if (showPopup) {
        document.addEventListener("mousedown", handleClickOutside);
        return () =>
          document.removeEventListener("mousedown", handleClickOutside);
      }
    }, [showPopup]);

    // Reset selected index when filtered properties change
    React.useEffect(() => {
      setSelectedIndex(0);
    }, [filteredProperties.length]);

    // Scroll selected item into view
    React.useEffect(() => {
      if (!showPopup || !popupRef.current) return;
      const selectedElement = popupRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      selectedElement?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex, showPopup]);

    return (
      <div ref={containerRef} className={cn("relative", className)}>
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
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

        {/* Autocomplete popup */}
        {showPopup && filteredProperties.length > 0 && (
          <div
            ref={popupRef}
            className={cn(
              "absolute z-50 w-72 max-h-48 overflow-y-auto",
              "rounded-md border border-border bg-popover shadow-lg"
            )}
            style={{ top: popupPosition.top, left: popupPosition.left }}
          >
            <div className="p-1">
              {filteredProperties.map((prop, index) => (
                <button
                  key={prop.path}
                  type="button"
                  data-index={index}
                  onClick={() => insertProperty(prop)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded-sm text-left",
                    "hover:bg-accent hover:text-accent-foreground transition-colors",
                    index === selectedIndex &&
                      "bg-accent text-accent-foreground"
                  )}
                >
                  <code className="font-mono truncate">{prop.path}</code>
                  <span
                    className={cn(
                      "font-normal shrink-0",
                      getTypeColor(prop.type)
                    )}
                  >
                    {prop.type}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hint text when no popup shown */}
        {availableProperties.length > 0 && !showPopup && (
          <p className="text-xs text-muted-foreground mt-1.5">
            Type{" "}
            <code className="px-1 py-0.5 bg-muted rounded text-[10px]">
              {templateSyntax === "mustache" ? "{{" : "${"}
            </code>{" "}
            for template suggestions
          </p>
        )}
      </div>
    );
  }
);
TemplateEditor.displayName = "TemplateEditor";

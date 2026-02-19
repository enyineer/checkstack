import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../Button";
import { Input } from "../Input";
import type { TemplateProperty } from "../CodeEditor";

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  /** Unique identifier for the editor */
  id: string;
  /** Current key-value pairs */
  value: KeyValuePair[];
  /** Callback when pairs change */
  onChange: (pairs: KeyValuePair[]) => void;
  /** Placeholder for key input */
  keyPlaceholder?: string;
  /** Placeholder for value input */
  valuePlaceholder?: string;
  /**
   * Optional template properties for autocomplete in value fields.
   * Note: Template autocomplete in value fields uses simple detection
   * rather than CodeMirror, since these are single-line inputs.
   */
  templateProperties?: TemplateProperty[];
}

/**
 * Detect if cursor is inside an unclosed {{ template context.
 */
function detectTemplateContext(text: string, cursorPos: number) {
  const textBefore = text.slice(0, cursorPos);
  const lastOpenBrace = textBefore.lastIndexOf("{{");
  const lastCloseBrace = textBefore.lastIndexOf("}}");

  if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
    return {
      isInTemplate: true,
      query: textBefore.slice(lastOpenBrace + 2),
      startPos: lastOpenBrace,
    };
  }
  return { isInTemplate: false, query: "", startPos: -1 };
}

/**
 * A key/value pair editor for form data and similar use cases.
 * Supports adding/removing pairs and optional template autocomplete in values.
 *
 * Uses internal state to manage pairs with empty keys (which are filtered
 * when serializing), allowing users to add new items before filling them in.
 */
export const KeyValueEditor: React.FC<KeyValueEditorProps> = ({
  id,
  value: externalValue,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  templateProperties,
}) => {
  // Use internal state that allows empty keys (for new items)
  const [internalPairs, setInternalPairs] = React.useState<KeyValuePair[]>(
    () => (externalValue.length > 0 ? externalValue : []),
  );

  // Track if the last change was from internal editing
  const isInternalChangeRef = React.useRef(false);

  // Sync internal state only when external value meaningfully changes
  // (e.g., from format conversion), not from our own serialization
  React.useEffect(() => {
    // Skip sync if we just made an internal change
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      return;
    }

    // Only sync if external value has content we don't have
    // This handles cases like switching from JSON -> formdata
    if (externalValue.length > 0) {
      setInternalPairs(externalValue);
    }
  }, [externalValue]);

  const notifyChange = (pairs: KeyValuePair[]) => {
    isInternalChangeRef.current = true;
    setInternalPairs(pairs);
    // Notify parent - they will filter empty keys when serializing
    onChange(pairs);
  };

  const handleAdd = () => {
    notifyChange([...internalPairs, { key: "", value: "" }]);
  };

  const handleRemove = (index: number) => {
    const next = [...internalPairs];
    next.splice(index, 1);
    notifyChange(next);
  };

  const handleKeyChange = (index: number, newKey: string) => {
    const next = [...internalPairs];
    next[index] = { ...next[index], key: newKey };
    notifyChange(next);
  };

  const handleValueChange = (index: number, newValue: string) => {
    const next = [...internalPairs];
    next[index] = { ...next[index], value: newValue };
    notifyChange(next);
  };

  return (
    <div className="space-y-2">
      {internalPairs.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No items added yet.
        </p>
      )}
      {internalPairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            id={`${id}-key-${index}`}
            value={pair.key}
            onChange={(e) => handleKeyChange(index, e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1 font-mono text-sm"
            aria-label={keyPlaceholder}
          />
          <span className="text-muted-foreground">=</span>
          <TemplateInput
            id={`${id}-value-${index}`}
            value={pair.value}
            onChange={(newValue) => handleValueChange(index, newValue)}
            placeholder={valuePlaceholder}
            templateProperties={templateProperties}
            aria-label={valuePlaceholder}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => handleRemove(index)}
            className="h-8 w-8 text-destructive hover:text-destructive/90 hover:bg-destructive/10 shrink-0"
            aria-label="Remove item"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
        className="h-8 gap-1"
      >
        <Plus className="h-4 w-4" />
        Add Item
      </Button>
    </div>
  );
};

/**
 * An input with simple template autocomplete support.
 * Shows a dropdown when user types "{{".
 */
const TemplateInput: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  templateProperties?: TemplateProperty[];
  "aria-label"?: string;
}> = ({
  id,
  value,
  onChange,
  placeholder,
  templateProperties,
  "aria-label": ariaLabel,
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [showPopup, setShowPopup] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [templateContext, setTemplateContext] = React.useState<{
    query: string;
    startPos: number;
  }>({ query: "", startPos: -1 });

  // Filter properties based on query
  const filteredProperties = React.useMemo(() => {
    if (!templateProperties) return [];
    if (!templateContext.query.trim()) return templateProperties;
    const lowerQuery = templateContext.query.toLowerCase();
    return templateProperties.filter((prop) =>
      prop.path.toLowerCase().includes(lowerQuery),
    );
  }, [templateProperties, templateContext.query]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    if (!templateProperties || templateProperties.length === 0) return;

    const cursorPos = e.target.selectionStart ?? newValue.length;
    const context = detectTemplateContext(newValue, cursorPos);

    if (context.isInTemplate) {
      setTemplateContext({ query: context.query, startPos: context.startPos });
      setShowPopup(true);
      setSelectedIndex(0);
    } else {
      setShowPopup(false);
    }
  };

  const insertProperty = (prop: TemplateProperty) => {
    if (templateContext.startPos === -1) return;

    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const template = `{{${prop.path}}}`;
    const newValue =
      value.slice(0, templateContext.startPos) +
      template +
      value.slice(cursorPos);

    onChange(newValue);
    setShowPopup(false);

    // Restore focus
    setTimeout(() => {
      inputRef.current?.focus();
      const newPos = templateContext.startPos + template.length;
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showPopup || filteredProperties.length === 0) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredProperties.length - 1 ? prev + 1 : 0,
        );
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredProperties.length - 1,
        );
        break;
      }
      case "Enter":
      case "Tab": {
        e.preventDefault();
        if (filteredProperties[selectedIndex]) {
          insertProperty(filteredProperties[selectedIndex]);
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

  // Close popup on blur
  const handleBlur = () => {
    // Delay to allow click on popup item
    setTimeout(() => setShowPopup(false), 150);
  };

  return (
    <div className="relative flex-1">
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="font-mono text-sm"
        aria-label={ariaLabel}
      />
      {showPopup && filteredProperties.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          <div className="p-1">
            {filteredProperties.map((prop, index) => (
              <button
                key={prop.path}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertProperty(prop);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded-sm text-left hover:bg-accent hover:text-accent-foreground ${
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : ""
                }`}
              >
                <code className="font-mono truncate">{prop.path}</code>
                <span className="text-muted-foreground shrink-0">
                  {prop.type}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

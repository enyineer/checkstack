import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../Button";
import { Input } from "../Input";
import type { TemplateProperty } from "../CodeEditor";
import { TemplateValueInput } from "../TemplateValueInput";

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
          />
          <span className="text-muted-foreground">=</span>
          <TemplateValueInput
            id={`${id}-value-${index}`}
            value={pair.value}
            onChange={(newValue) => handleValueChange(index, newValue)}
            placeholder={valuePlaceholder}
            templateProperties={templateProperties}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => handleRemove(index)}
            className="h-8 w-8 text-destructive hover:text-destructive/90 hover:bg-destructive/10 shrink-0"
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

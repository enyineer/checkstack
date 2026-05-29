import React from "react";
import { Label } from "../Label";
import { Textarea } from "../Textarea";
import { CodeEditor, type TemplateProperty } from "../CodeEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../Select";
import { KeyValueEditor } from "./KeyValueEditor";
import {
  type EditorType,
  detectEditorType,
  serializeFormData,
  parseFormData,
  EDITOR_TYPE_LABELS,
} from "./utils";
import type { EditorStarterTemplates, ShellEnvVar } from "./types";
import { pickStarterForEmptyField } from "./starterTemplateSelector";

export interface MultiTypeEditorFieldProps {
  /** Unique identifier for the field */
  id: string;
  /** Label for the field */
  label: string;
  /** Optional description */
  description?: string;
  /** Current string value */
  value: string | undefined;
  /** Whether the field is required */
  isRequired?: boolean;
  /** Available editor types */
  editorTypes: EditorType[];
  /** Optional template properties for autocomplete */
  templateProperties?: TemplateProperty[];
  /**
   * Optional TypeScript declarations injected into Monaco for TS/JS modes —
   * powers IntelliSense + return-shape error reporting against the runtime
   * context the user will see (`context.config`, `context.event`, ...).
   */
  typeDefinitions?: string;
  /**
   * Optional shell env-var hints surfaced as completion items after `$`
   * (and `${`) in shell mode. Typically populated by the platform with
   * names like `EVENT_ID` / `PAYLOAD_*` so users don't have to memorise.
   */
  shellEnvVars?: ShellEnvVar[];
  /**
   * Optional starter templates per editor language. When the field is
   * empty (and the user hasn't typed yet), switching to an editor with a
   * starter for that language pre-populates the editor so users see a
   * working example instead of a blank canvas.
   */
  starterTemplates?: EditorStarterTemplates;
  /** Callback when value changes */
  onChange: (value: string | undefined) => void;
}

/**
 * A multi-type editor field that lets users select from different input modes.
 * Supports raw text, JSON, form data, and "none" (disabled).
 * When templateProperties are provided, all applicable modes get template autocomplete.
 */
export const MultiTypeEditorField: React.FC<MultiTypeEditorFieldProps> = ({
  id,
  label,
  description,
  value,
  isRequired,
  editorTypes,
  templateProperties,
  typeDefinitions,
  shellEnvVars,
  starterTemplates,
  onChange,
}) => {
  // Detect initial editor type from value
  const [selectedType, setSelectedType] = React.useState<EditorType>(() =>
    detectEditorType(value, editorTypes),
  );

  // Latched once the field has had non-empty content at least once for
  // this mount. Used by the seed effects below to decide whether to
  // (re-)install the starter template.
  const hasSeededRef = React.useRef(false);

  // React reuses this `MultiTypeEditorField` instance across collector
  // switches when its parent `FormField` keeps the same key (e.g. both
  // collectors have a property called `script`). The `useState`
  // initializer above only runs on the first mount, so without this
  // effect a switch from a shell-only collector to a typescript-only
  // collector leaves `selectedType` stuck on "shell" — Monaco then
  // tokenises the new collector's TS content as shell (no
  // highlighting), and the reverse direction tokenises shell content as
  // TS (nonsense "Cannot find name" errors).
  //
  // Whenever `editorTypes` changes and the current selection is no
  // longer offered, re-detect from the new value. We deliberately do
  // NOT reset on every `value` change — that would clobber the user's
  // manual dropdown choice mid-edit.
  React.useEffect(() => {
    if (!editorTypes.includes(selectedType)) {
      const next = detectEditorType(value, editorTypes);
      setSelectedType(next);
      // Reset the seed latch too — this is effectively a fresh field
      // for a different collector, and the new language's starter
      // template should be eligible again.
      hasSeededRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-derive when the offered types change
  }, [editorTypes]);

  // Seed an empty field with the starter template for its detected
  // language so users see a working example instead of a blank canvas.
  //
  // Why this isn't just `useEffect(..., [])`:
  // React fires CHILD effects before PARENT effects. `DynamicForm`'s
  // own init effect (which applies schema defaults) runs AFTER this one
  // and, on initial mount, calls `onChange(defaults)` — which clobbers
  // a freshly-seeded `script: starter` back to `script: ""` because the
  // defaults effect's closure-captured `value` was the original `{}`.
  // A naive `[]`-dep seed would therefore appear to do nothing.
  //
  // Two-effect design fixes this without depending on cross-component
  // effect ordering:
  //   1. The "observed" effect (declared FIRST) flips `hasSeededRef` to
  //      true the moment we see non-empty content in `value` — whether
  //      that came from our seed surviving, a parent default landing
  //      with content, or the user typing.
  //   2. The "seed" effect re-runs on every value/starter change and
  //      installs the starter while `hasSeededRef` is still false. If
  //      the parent clobbers us back to "", we just re-seed on the
  //      next pass — until the value sticks and effect (1) latches.
  //
  // The latch also means we DON'T re-seed if the user deliberately
  // deletes their content later, or on any subsequent refetch / parent
  // re-render: once non-empty has been observed at least once, the
  // field is the user's territory.
  React.useEffect(() => {
    if (!hasSeededRef.current && (value ?? "").trim().length > 0) {
      hasSeededRef.current = true;
    }
  }, [value]);

  React.useEffect(() => {
    if (hasSeededRef.current) return;
    const starter = pickStarterForEmptyField({
      value,
      selectedType,
      starterTemplates,
    });
    if (starter !== undefined) {
      onChange(starter);
    }
  }, [value, selectedType, starterTemplates, onChange]);

  const handleTypeChange = (newType: EditorType) => {
    setSelectedType(newType);

    // Clear value when switching to "none"
    if (newType === "none") {
      onChange("");
      return;
    }

    // If the field is empty after the switch and we have a starter template
    // for the new language, seed it. (Switching languages on a non-empty
    // field preserves the existing content, just like before.)
    const starter = pickStarterForEmptyField({
      value,
      selectedType: newType,
      starterTemplates,
    });
    if (starter !== undefined) {
      onChange(starter);
      return;
    }

    // When switching to formdata
    if (newType === "formdata") {
      if (!value || value.trim() === "") {
        // Empty value, start fresh
        onChange("");
        return;
      }

      // Try to convert from JSON
      try {
        const parsed = JSON.parse(value);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          const pairs = Object.entries(parsed).map(([key, val]) => ({
            key,
            value: String(val),
          }));
          onChange(serializeFormData(pairs));
          return;
        }
      } catch {
        // Not JSON
      }

      // Check if already formdata-like (has = sign)
      if (value.includes("=") && !value.includes("\n")) {
        // Looks like formdata, keep it
        return;
      }

      // Can't convert - clear value to start fresh
      onChange("");
      return;
    }

    // When switching to JSON from formdata, try to convert
    if (newType === "json" && value && value.includes("=")) {
      const pairs = parseFormData(value);
      if (pairs.length > 0 && pairs.every((p) => p.key.trim() !== "")) {
        const obj: Record<string, string> = {};
        for (const pair of pairs) {
          obj[pair.key] = pair.value;
        }
        try {
           
          onChange(JSON.stringify(obj, null, 2));
          return;
        } catch {
          // Keep current value
        }
      }
    }
  };

  // Only show dropdown if there's more than one type
  const showDropdown = editorTypes.length > 1;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <Label htmlFor={id}>
            {label} {isRequired && "*"}
          </Label>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
        {showDropdown && (
          <Select value={selectedType} onValueChange={handleTypeChange}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {editorTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {EDITOR_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Render appropriate editor based on selected type */}
      {selectedType === "none" && (
        <p className="text-sm text-muted-foreground italic py-2">
          No content (disabled)
        </p>
      )}

      {selectedType === "raw" && (
        <RawEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          templateProperties={templateProperties}
        />
      )}

      {selectedType === "json" && (
        <CodeEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          language="json"
          minHeight="150px"
          templateProperties={templateProperties}
        />
      )}

      {selectedType === "yaml" && (
        <CodeEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          language="yaml"
          minHeight="150px"
          templateProperties={templateProperties}
        />
      )}

      {selectedType === "xml" && (
        <CodeEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          language="xml"
          minHeight="150px"
          templateProperties={templateProperties}
        />
      )}

      {selectedType === "markdown" && (
        <CodeEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          language="markdown"
          minHeight="150px"
          templateProperties={templateProperties}
        />
      )}

      {selectedType === "formdata" && (
        <KeyValueEditor
          id={id}
          value={parseFormData(value ?? "")}
          onChange={(pairs) => onChange(serializeFormData(pairs))}
          templateProperties={templateProperties}
        />
      )}

      {/*
        Native-code editors (javascript / typescript / shell) intentionally
        do NOT receive `templateProperties`: `{{ }}` template syntax is for
        text/markup fields only. Code fields access run context through
        their language's native mechanism instead — a typed `context`
        object (driven by `typeDefinitions`) for TS/JS, and `$`-prefixed
        env vars (driven by `shellEnvVars`) for shell.
      */}
      {selectedType === "javascript" && (
        <CodeEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          language="javascript"
          minHeight="150px"
          typeDefinitions={typeDefinitions}
        />
      )}

      {selectedType === "typescript" && (
        <CodeEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          language="typescript"
          minHeight="150px"
          typeDefinitions={typeDefinitions}
        />
      )}

      {selectedType === "shell" && (
        <CodeEditor
          id={id}
          value={value ?? ""}
          onChange={onChange}
          language="shell"
          minHeight="150px"
          shellEnvVars={shellEnvVars}
        />
      )}
    </div>
  );
};

/**
 * Detect if cursor is inside an unclosed {{ template context.
 */
function detectRawTemplateContext(text: string, cursorPos: number) {
  const textBefore = text.slice(0, cursorPos);
  const lastOpenBrace = textBefore.lastIndexOf("{{");
  const lastCloseBrace = textBefore.lastIndexOf("}}");

  if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
    const query = textBefore.slice(lastOpenBrace + 2);
    if (!query.includes("\n")) {
      return { isInTemplate: true, query, startPos: lastOpenBrace };
    }
  }
  return { isInTemplate: false, query: "", startPos: -1 };
}

/**
 * Raw text editor with optional template autocomplete.
 * Uses a simple textarea with popup autocomplete (similar to original TemplateEditor).
 */
const RawEditor: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  templateProperties?: TemplateProperty[];
}> = ({ id, value, onChange, templateProperties }) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [showPopup, setShowPopup] = React.useState(false);
  const [popupPosition, setPopupPosition] = React.useState({ top: 0, left: 0 });
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
    return templateProperties.filter(
      (prop) =>
        prop.path.toLowerCase().includes(lowerQuery) ||
        (prop.templateRef?.toLowerCase().includes(lowerQuery) ?? false),
    );
  }, [templateProperties, templateContext.query]);

  const calculatePopupPosition = React.useCallback(() => {
    const textarea = textareaRef.current;
    const container = containerRef.current;
    if (!textarea || !container) return;

    const lineHeight =
      Number.parseInt(getComputedStyle(textarea).lineHeight) || 20;
    const paddingTop =
      Number.parseInt(getComputedStyle(textarea).paddingTop) || 8;
    const cursorPos = textarea.selectionStart ?? 0;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lines = textBeforeCursor.split("\n");
    const currentLineIndex = lines.length - 1;

    const top = paddingTop + (currentLineIndex + 1) * lineHeight;
    const currentLine = lines[currentLineIndex] ?? "";
    const charWidth = 8;
    const paddingLeft =
      Number.parseInt(getComputedStyle(textarea).paddingLeft) || 12;
    const left = Math.min(paddingLeft + currentLine.length * charWidth, 200);

    setPopupPosition({
      top: Math.max(top, lineHeight),
      left: Math.max(left, 0),
    });
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    if (!templateProperties || templateProperties.length === 0) return;

    setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart ?? 0;
      const context = detectRawTemplateContext(newValue, cursorPos);

      if (context.isInTemplate) {
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

  const insertProperty = React.useCallback(
    (prop: TemplateProperty) => {
      const textarea = textareaRef.current;
      if (!textarea || templateContext.startPos === -1) return;

      const template = `{{${prop.templateRef ?? prop.path}}}`;
      const cursorPos = textarea.selectionStart ?? 0;
      const newValue =
        value.slice(0, templateContext.startPos) +
        template +
        value.slice(cursorPos);

      onChange(newValue);
      setShowPopup(false);

      const newPosition = templateContext.startPos + template.length;
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newPosition, newPosition);
      }, 0);
    },
    [value, onChange, templateContext.startPos],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  // Close popup on outside click
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
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

  return (
    <div ref={containerRef} className="relative">
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={5}
        className="font-mono text-sm"
      />
      {showPopup && filteredProperties.length > 0 && (
        <div
          className="absolute z-50 w-72 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
          style={{ top: popupPosition.top, left: popupPosition.left }}
        >
          <div className="p-1">
            {filteredProperties.map((prop, index) => (
              <button
                key={prop.path}
                type="button"
                onClick={() => insertProperty(prop)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded-sm text-left hover:bg-accent hover:text-accent-foreground ${
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : ""
                }`}
              >
                <code className="font-mono truncate">
                  {prop.templateRef ?? prop.path}
                </code>
                <span className="text-muted-foreground shrink-0">
                  {prop.type}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {templateProperties && templateProperties.length > 0 && !showPopup && (
        <p className="text-xs text-muted-foreground mt-1.5">
          Type{" "}
          <code className="px-1 py-0.5 bg-muted rounded text-[10px]">
            {"{{"}
          </code>{" "}
          for template suggestions
        </p>
      )}
    </div>
  );
};

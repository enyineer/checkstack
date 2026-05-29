import React from "react";
import { Code2, X } from "lucide-react";
import { TemplateValueInput } from "./TemplateValueInput";
import type { TemplateProperty } from "./CodeEditor";

export interface TemplateInputToggleProps {
  /**
   * The typed editor to render when the user has NOT switched to
   * template mode — typically a `<Input type="number">`, `<Select>`,
   * `<DateTimePicker>`, etc.
   *
   * Render-prop instead of a `ReactNode` so the toggle can wire focus /
   * disabled state through without imposing a shape on the caller.
   */
  renderTyped: (props: { disabled: boolean }) => React.ReactNode;
  /** Current value (always a string — typed editors serialise to one). */
  value: string;
  /** Called whenever the value changes, regardless of mode. */
  onChange: (value: string) => void;
  /**
   * Whether the toggle starts in template mode. The toggle is
   * uncontrolled by default; pass `templateMode` + `onTemplateModeChange`
   * to control it externally.
   */
  defaultTemplateMode?: boolean;
  templateMode?: boolean;
  onTemplateModeChange?: (templateMode: boolean) => void;
  /** Template properties for the picker (template mode only). */
  templateProperties?: TemplateProperty[];
  /** Placeholder shown in template mode. */
  templatePlaceholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Wraps a typed input with a small "fx" button that flips the field
 * into template-input mode. Used in the automation editor wherever an
 * action config field accepts either a typed literal _or_ a template
 * — number-of-seconds, dropdown choices, dates — so the operator can
 * say "this is dynamic at runtime" without changing the schema.
 *
 * Behaviour:
 *
 *   - Default mode renders `renderTyped()`.
 *   - Clicking the "fx" pill switches to a `TemplateValueInput` and
 *     focuses it. The pill turns into an "X" button.
 *   - Clicking the "X" switches back. The value is preserved across
 *     toggles — the operator only loses it if they explicitly clear
 *     the field.
 *
 * If the current value starts with `{{`, the toggle infers template
 * mode automatically when uncontrolled. This handles round-tripping
 * a previously-saved automation that interpolated this field.
 */
export const TemplateInputToggle: React.FC<TemplateInputToggleProps> = ({
  renderTyped,
  value,
  onChange,
  defaultTemplateMode,
  templateMode,
  onTemplateModeChange,
  templateProperties,
  templatePlaceholder,
  disabled,
  className,
}) => {
  const inferredTemplate = value.trim().startsWith("{{");
  const [internalTemplateMode, setInternalTemplateMode] = React.useState(
    defaultTemplateMode ?? inferredTemplate,
  );
  const isTemplate = templateMode ?? internalTemplateMode;
  const setIsTemplate = (next: boolean) => {
    if (templateMode === undefined) setInternalTemplateMode(next);
    onTemplateModeChange?.(next);
  };

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`.trim()}>
      <div className="flex-1">
        {isTemplate ? (
          <TemplateValueInput
            value={value}
            onChange={onChange}
            placeholder={templatePlaceholder ?? "{{ trigger.payload.value }}"}
            templateProperties={templateProperties}
            disabled={disabled}
            autoFocus
          />
        ) : (
          renderTyped({ disabled: Boolean(disabled) })
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsTemplate(!isTemplate)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-card text-xs font-mono text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        aria-label={isTemplate ? "Switch back to typed input" : "Switch to template"}
        title={isTemplate ? "Switch back to typed input" : "Switch to template"}
      >
        {isTemplate ? <X className="h-3 w-3" /> : (
          <span className="flex items-center gap-0.5">
            <Code2 className="h-3 w-3" />
            <span>fx</span>
          </span>
        )}
      </button>
    </div>
  );
};

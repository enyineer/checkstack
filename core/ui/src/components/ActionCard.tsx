import React from "react";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "./Card";
import { Button } from "./Button";
import { Toggle } from "./Toggle";
import { DynamicIcon, type LucideIconName } from "./DynamicIcon";
import { Badge, type BadgeProps } from "./Badge";
import { cn } from "../utils";

export interface ActionCardProps {
  /** Stable identifier used for drag-reorder + React key. */
  id: string;
  /** Bold header label, e.g. "Notify User". */
  title: string;
  /** Operator-supplied description (the action's `id`/`description` field). */
  description?: string;
  /** Plugin/category label rendered as a subdued badge. */
  category?: string;
  /** Lucide icon (PascalCase) shown to the left of the title. */
  icon?: LucideIconName;
  /** Toggle for the action's `enabled` flag. Omit to hide the toggle. */
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  /** Removes the card from its container. Omit to hide the delete button. */
  onDelete?: () => void;
  /** Drag handle shown on the left; integrators wire it up via `dnd-kit`. */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  /** Initial expanded state when uncontrolled. */
  defaultExpanded?: boolean;
  /** Controlled expanded state. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Extra badges (e.g. produces / consumes hints). */
  badges?: Array<{
    label: string;
    variant?: BadgeProps["variant"];
    className?: string;
  }>;
  /** Card body — the action's config form. */
  children?: React.ReactNode;
  /** Optional class override on the outer Card. */
  className?: string;
  /**
   * Validation messages attached to this card. When non-empty the card
   * is marked with a destructive border + warning icon and the messages
   * are listed in the header, so the operator sees *which* card (and
   * field) is wrong without a separate panel.
   */
  errors?: string[];
}

/**
 * Collapsible card that wraps a single automation action in the visual
 * editor.
 *
 * Mirrors the visual layout of `StrategyConfigCard` but stays decoupled
 * from `DynamicForm` so containers (`ChooseBlock`, `ParallelBlock`,
 * `RepeatBlock`) can supply their own children — typically nested lists
 * of `ActionCard`s rather than a flat config schema.
 *
 * Composition pattern (consumed by automation-frontend's editor):
 *
 *   ```tsx
 *   <ActionCard
 *     id={action.id}
 *     title={action.action}
 *     enabled={action.enabled ?? true}
 *     onEnabledChange={(next) => onActionChange({ ...action, enabled: next })}
 *     onDelete={() => onDelete(action.id)}
 *   >
 *     <DynamicForm
 *       schema={registeredAction.configJsonSchema}
 *       value={action.config}
 *       onChange={(config) => onActionChange({ ...action, config })}
 *     />
 *   </ActionCard>
 *   ```
 *
 * The toggle, delete, and drag handle each gate on their respective
 * callback being supplied — pass `onDelete` to render the trash button,
 * `onEnabledChange` to render the enable toggle, `dragHandleProps` to
 * render the grip. Containers that don't want any of those (e.g. a
 * disabled preview) just omit them.
 */
export const ActionCard: React.FC<ActionCardProps> = ({
  id,
  title,
  description,
  category,
  icon,
  enabled,
  onEnabledChange,
  onDelete,
  dragHandleProps,
  defaultExpanded = true,
  expanded,
  onExpandedChange,
  badges,
  children,
  className,
  errors,
}) => {
  const [internalExpanded, setInternalExpanded] =
    React.useState(defaultExpanded);
  const isExpanded = expanded ?? internalExpanded;
  const toggleExpanded = () => {
    const next = !isExpanded;
    if (expanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  };
  const hasErrors = errors !== undefined && errors.length > 0;

  return (
    <Card
      data-action-id={id}
      className={cn(
        "transition-opacity",
        enabled === false && "opacity-60",
        hasErrors && "border-destructive/60 ring-1 ring-destructive/30",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center gap-2 p-3 space-y-0">
        {dragHandleProps && (
          <button
            type="button"
            className="cursor-grab text-muted-foreground hover:text-foreground"
            aria-label="Drag to reorder"
            {...dragHandleProps}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex items-center flex-1 gap-2 text-left"
          aria-expanded={isExpanded}
          aria-controls={`${id}-body`}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
          {hasErrors ? (
            <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" />
          ) : (
            icon && <DynamicIcon name={icon} className="w-4 h-4 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate">{title}</span>
              {category && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {category}
                </Badge>
              )}
              {badges?.map((badge) => (
                <Badge
                  key={badge.label}
                  variant={badge.variant ?? "outline"}
                  className={cn("shrink-0 text-[10px]", badge.className)}
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
            {description && (
              <p className="text-xs truncate text-muted-foreground">
                {description}
              </p>
            )}
            {hasErrors && (
              <ul className="mt-0.5 space-y-0.5">
                {errors!.map((error, index) => (
                  <li
                    key={index}
                    className="text-[11px] font-mono text-destructive"
                  >
                    {error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </button>
        {onEnabledChange && (
          <Toggle
            checked={enabled ?? true}
            onCheckedChange={onEnabledChange}
            aria-label={enabled ? "Disable action" : "Enable action"}
          />
        )}
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            className="w-8 h-8 text-destructive hover:text-destructive/90 hover:bg-destructive/10 shrink-0"
            aria-label="Delete action"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </CardHeader>
      {isExpanded && children && (
        <CardContent id={`${id}-body`} className="p-3 border-t border-border">
          {children}
        </CardContent>
      )}
    </Card>
  );
};

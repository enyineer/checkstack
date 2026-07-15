import { Badge, DynamicIcon, cn, type LucideIconName } from "@checkstack/ui";
import { ChevronRight } from "lucide-react";
import type { SourceTypeDescriptor } from "@checkstack/telemetry-common";

export interface SourceTypeCatalogProps {
  sourceTypes: SourceTypeDescriptor[];
  onSelect: (descriptor: SourceTypeDescriptor) => void;
}

/**
 * Step 1 of adding a source: a grid of the contributed source types (already
 * filtered to the section's signal). Each card shows the type's icon, name,
 * description and the modes / signals it supports. Picking one advances to the
 * config step.
 */
export function SourceTypeCatalog({
  sourceTypes,
  onSelect,
}: SourceTypeCatalogProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {sourceTypes.map((type) => (
        <button
          key={type.id}
          type="button"
          onClick={() => onSelect(type)}
          className={cn(
            "group flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left",
            "hover:border-primary/60 hover:bg-accent/50",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-inset text-foreground">
            <DynamicIcon
              // `icon` is a free-form string from the descriptor; bridge it to
              // the lucide name type the same way other catalogs do.
              name={(type.icon as LucideIconName | undefined) ?? undefined}
              className="size-5"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">
                {type.displayName}
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                aria-hidden
              />
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
              {type.description}
            </span>
            <span className="mt-2 flex flex-wrap gap-1">
              {type.modes.map((mode) => (
                <Badge key={mode} variant="secondary" className="capitalize">
                  {mode}
                </Badge>
              ))}
              {type.signals.map((signal) => (
                <Badge key={signal} variant="outline" className="capitalize">
                  {signal}
                </Badge>
              ))}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

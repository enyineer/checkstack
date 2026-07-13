import { Fragment } from "react";
import { cn } from "@checkstack/ui";

/**
 * Render a Drain template with its `<*>` wildcard tokens visually highlighted,
 * so operators can tell the fixed skeleton of a pattern from its variable slots
 * at a glance. Pure presentational split on the literal `<*>` marker.
 */
export function PatternTemplate({
  template,
  className,
}: {
  template: string;
  className?: string;
}) {
  const parts = template.split("<*>");
  return (
    <code
      className={cn(
        "font-mono text-xs leading-relaxed break-words",
        className,
      )}
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <span className="mx-0.5 rounded bg-primary/15 px-1 text-primary">
              {"<*>"}
            </span>
          )}
        </Fragment>
      ))}
    </code>
  );
}

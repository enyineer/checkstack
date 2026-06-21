import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../utils";

/** A single breadcrumb entry. Omit `to` for the current (non-link) page. */
export interface BreadcrumbItem {
  /** Visible label for the crumb. */
  label: string;
  /**
   * Destination for the crumb. When omitted the crumb renders as plain text and
   * (if it is the last item) is marked `aria-current="page"`. Provide a path
   * string and the crumb renders as an anchor; pass `onNavigate` to intercept
   * clicks for client-side routing.
   */
  to?: string;
}

export interface BreadcrumbProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onClick"> {
  /** Ordered list of crumbs, root first, current page last. */
  items: BreadcrumbItem[];
  /**
   * Optional client-side navigation handler. When provided, anchor clicks call
   * `event.preventDefault()` and invoke this with the crumb's `to` so callers
   * can route via react-router without a full page load.
   */
  onNavigate?: (to: string) => void;
}

/**
 * Accessible breadcrumb trail. Renders a labelled `<nav>` wrapping an ordered
 * list; the final crumb is marked `aria-current="page"`. Crumbs with a `to`
 * render as links (optionally intercepted via `onNavigate` for SPA routing);
 * crumbs without one render as plain text.
 */
export const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(
  ({ items, onNavigate, className, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        aria-label="Breadcrumb"
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            const isLink = item.to !== undefined && !isLast;
            return (
              <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
                {isLink ? (
                  <a
                    href={item.to}
                    onClick={(event) => {
                      if (onNavigate && item.to !== undefined) {
                        event.preventDefault();
                        onNavigate(item.to);
                      }
                    }}
                    className="transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={cn(isLast && "font-medium text-foreground")}
                  >
                    {item.label}
                  </span>
                )}
                {!isLast && (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  },
);
Breadcrumb.displayName = "Breadcrumb";

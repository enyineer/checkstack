import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

/** Shared id for the aurora icon-stroke gradient (see `.aurora-icon-stroke`). */
const AURORA_ICON_GRADIENT_ID = "checkstack-aurora-icon";

/**
 * Off-screen <defs> carrying the teal->violet->magenta gradient that the
 * page-header icon's strokes reference. Rendered once alongside the header so
 * the `stroke: url(#id)` in `.aurora-icon-stroke` resolves.
 *
 * `gradientUnits="userSpaceOnUse"` (spanning the lucide 24x24 viewBox) is
 * required: the default `objectBoundingBox` units degenerate for a stroke whose
 * own bounding box is zero in one axis (a perfectly horizontal/vertical line,
 * e.g. a monitor stand), making that stroke vanish. User-space coords apply the
 * same gradient uniformly to every stroke regardless of its individual bounds.
 */
const AuroraIconGradientDefs: React.FC = () => (
  <svg
    width="0"
    height="0"
    className="absolute"
    aria-hidden
    focusable="false"
  >
    <defs>
      <linearGradient
        id={AURORA_ICON_GRADIENT_ID}
        gradientUnits="userSpaceOnUse"
        x1="0"
        y1="0"
        x2="24"
        y2="24"
      >
        <stop offset="0%" stopColor="hsl(var(--aurora-1))" />
        <stop offset="50%" stopColor="hsl(var(--aurora-2))" />
        <stop offset="100%" stopColor="hsl(var(--aurora-3))" />
      </linearGradient>
    </defs>
  </svg>
);

interface PageProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Page = React.forwardRef<HTMLDivElement, PageProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col w-full h-full", className)}
      {...props}
    >
      {children}
    </div>
  ),
);
Page.displayName = "Page";

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  actions?: React.ReactNode;
  /**
   * Optional breadcrumb trail rendered above the title. Opt-in: pages without
   * this prop are unchanged. Provide a `onBreadcrumbNavigate` handler to route
   * crumb clicks through the SPA router.
   */
  breadcrumbs?: BreadcrumbItem[];
  /** SPA navigation handler for breadcrumb link clicks. */
  onBreadcrumbNavigate?: (to: string) => void;
}

export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  (
    {
      className,
      title,
      subtitle,
      icon: Icon,
      actions,
      breadcrumbs,
      onBreadcrumbNavigate,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col gap-1 py-3 pb-2 md:py-6 md:pb-2",
        className,
      )}
      {...props}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb items={breadcrumbs} onNavigate={onBreadcrumbNavigate} />
      )}
      <AuroraIconGradientDefs />
      <div className="flex flex-col items-center justify-between gap-3 md:flex-row">
        {/* `md:min-w-0 md:flex-1` lets a long subtitle WRAP inside the available
            width instead of running under the actions; the actions get
            `shrink-0` so they keep their size beside it. */}
        <div className="space-y-1 md:min-w-0 md:flex-1">
          <div className="flex items-center gap-3">
            {/* Signature aurora moment: the page icon's strokes ride the
                teal->violet->magenta gradient (see AuroraIconGradientDefs),
                with no chip behind it. */}
            <Icon className="aurora-icon-stroke size-7 shrink-0" />
            <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          </div>
          {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center space-x-2">{actions}</div>
        )}
      </div>
      {/* Aurora hairline anchors the header band and adds quiet depth. */}
      <div
        className="mt-3 h-px bg-gradient-to-r from-aurora-2/40 via-aurora-3/20 to-transparent"
        aria-hidden
      />
    </div>
  ),
);
PageHeader.displayName = "PageHeader";

interface PageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const PageContent = React.forwardRef<HTMLDivElement, PageContentProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex-1 py-3 pt-2 md:py-6 md:pt-2", className)}
      {...props}
    >
      {children}
    </div>
  ),
);
PageContent.displayName = "PageContent";

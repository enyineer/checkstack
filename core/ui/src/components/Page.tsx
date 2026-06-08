import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils";

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
}

export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, title, subtitle, icon: Icon, actions, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col md:flex-row items-center justify-between gap-3 py-3 pb-2 md:py-6 md:pb-2",
        className,
      )}
      {...props}
    >
      {/* `md:min-w-0 md:flex-1` lets a long subtitle WRAP inside the available
          width instead of running under the actions; the actions get
          `shrink-0` so they keep their size beside it. */}
      <div className="space-y-1 md:min-w-0 md:flex-1">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        </div>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center space-x-2">{actions}</div>
      )}
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

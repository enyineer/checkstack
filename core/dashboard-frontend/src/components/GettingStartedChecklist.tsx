import React from "react";
import { Link } from "react-router";
import { Card, CardContent, cn } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { useTipState } from "@checkstack/tips-frontend";
import { catalogRoutes } from "@checkstack/catalog-common";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";
import { notificationRoutes } from "@checkstack/notification-common";
import { ArrowRight, Check, Rocket, X } from "lucide-react";
import { pluginMetadata } from "../pluginMetadata";

interface ChecklistStep {
  title: string;
  description: string;
  href: string;
  done: boolean;
}

interface GettingStartedChecklistProps {
  /**
   * Number of catalog systems. Drives the "fresh install" detection and the
   * completion state of the first step. Derived from the dashboard's existing
   * entities query - no new query is introduced.
   */
  systemsCount: number;
  /** Whether the current user can reach the catalog config page. */
  canManageCatalog: boolean;
}

/**
 * A dismissable "Getting started" checklist for fresh installs. It completes
 * the journey the admin-account onboarding form starts by naming the next
 * three steps (add a system -> attach a health check -> connect a notification
 * channel) and linking each one.
 *
 * Fresh-install detection: shown only while there are zero catalog systems,
 * reusing the dashboard's existing entities query rather than adding fragile
 * new queries or an overlay tour. Dismissal persists per-user via the tips
 * dismissal mechanism (server + localStorage) and is restorable from the help
 * menu's "Show tips again" action.
 */
export const GettingStartedChecklist: React.FC<
  GettingStartedChecklistProps
> = ({ systemsCount, canManageCatalog }) => {
  const { isDismissed, isLoading, dismiss } = useTipState({
    plugin: pluginMetadata,
    id: "getting-started",
  });

  // Only a fresh install (no systems yet) needs the checklist; once a system
  // exists the dashboard surfaces real data and the steps no longer apply.
  // Users who cannot manage the catalog cannot complete step one, so don't
  // coach them toward a page they cannot reach.
  if (systemsCount > 0 || !canManageCatalog || isLoading || isDismissed) {
    return null;
  }

  const steps: ChecklistStep[] = [
    {
      title: "Add a system",
      description: "Register the first service you want to monitor.",
      href: resolveRoute(catalogRoutes.routes.config),
      done: systemsCount > 0,
    },
    {
      title: "Attach a health check",
      description: "Watch the system and surface issues automatically.",
      href: resolveRoute(healthcheckRoutes.routes.config),
      done: false,
    },
    {
      title: "Connect a notification channel",
      description: "Get told when something needs your attention.",
      href: resolveRoute(notificationRoutes.routes.settings),
      done: false,
    },
  ];

  return (
    <Card className="border border-primary/30 bg-primary/5">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className="text-primary mt-0.5">
            <Rocket className="size-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Getting started
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Three steps to bring your dashboard to life.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss getting started checklist"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <ol className="mt-4 flex flex-col gap-2">
          {steps.map((step, index) => (
            <li key={step.title}>
              <Link
                to={step.href}
                className={cn(
                  "group flex items-center gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2.5",
                  "transition-colors hover:border-primary/40 hover:bg-primary/5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    step.done
                      ? "bg-success/15 text-success"
                      : "bg-primary/10 text-primary",
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground truncate">
                    {step.title}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {step.description}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
};

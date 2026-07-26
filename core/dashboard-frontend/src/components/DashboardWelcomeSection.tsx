import React from "react";
import { useNavigate } from "react-router";
import { useApi, accessApiRef, usePluginClient } from "@checkstack/frontend-api";
import { CatalogApi, catalogRoutes, catalogAccess } from "@checkstack/catalog-common";
import { resolveRoute } from "@checkstack/common";
import { TipBanner } from "@checkstack/tips-frontend";
import { pluginMetadata as dashboardTipMetadata } from "../pluginMetadata";
import { QueueLagAlert } from "@checkstack/queue-frontend";
import { GettingStartedChecklist } from "./GettingStartedChecklist";
import { Lightbulb } from "lucide-react";

/**
 * Dashboard section: welcome banner, queue-lag alert, and fresh-install
 * getting-started checklist.
 *
 * Registered as a DashboardSlot extension with priority 0 so it renders first.
 * Self-contained: fetches its own entities query (react-query dedupes with
 * other dashboard sections) and access checks.
 */
export const DashboardWelcomeSection: React.FC = () => {
  const navigate = useNavigate();
  const accessApi = useApi(accessApiRef);
  const catalogClient = usePluginClient(CatalogApi);

  const { allowed: canManageCatalog } = accessApi.useAccess(
    catalogAccess.system.manage,
  );

  const { data: entitiesData, isLoading: entitiesLoading, isError: entitiesError } =
    catalogClient.getEntities.useQuery(
      {},
      { staleTime: 30_000 },
    );
  const systemsCount = entitiesData?.systems.length ?? 0;

  return (
    <>
      <QueueLagAlert />

      <TipBanner
        plugin={dashboardTipMetadata}
        id="welcome"
        title="Welcome to Checkstack"
        description={
          <>
            This is your dashboard. It surfaces only the systems that need
            attention right now - everything healthy stays out of your way. To
            bring it to life, add a system in the <strong>Catalog</strong>,
            then attach a health check to it.
          </>
        }
        action={
          canManageCatalog
            ? {
                label: "Open Catalog",
                onClick: () =>
                  navigate(resolveRoute(catalogRoutes.routes.config)),
              }
            : undefined
        }
        actionHint={
          <span className="inline-flex items-center gap-1.5">
            <Lightbulb
              className="size-3.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            See a small lightbulb next to a button or control? Click it for a
            short explanation of what that feature does.
          </span>
        }
      />

      {/*
        Fresh-install next steps. Gated on the entities query having resolved
        to zero systems so it never flashes before we know the install state;
        dismissal persists via the tips mechanism and is restorable from the
        help menu's "Show tips again".
      */}
      {!entitiesLoading && !entitiesError && (
        <GettingStartedChecklist
          systemsCount={systemsCount}
          canManageCatalog={canManageCatalog}
        />
      )}
    </>
  );
};

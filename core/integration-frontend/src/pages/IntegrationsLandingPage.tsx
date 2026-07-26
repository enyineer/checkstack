import { Link } from "react-router";
import {
  PageLayout,
  EmptyState,
  LoadingSpinner,
} from "@checkstack/ui";
import { Webhook } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { IntegrationApi, integrationRoutes } from "@checkstack/integration-common";
import { ProviderCard } from "../components/ProviderCard";

/**
 * Integrations landing page — lists every registered integration provider
 * and links each to its connection-management page. This is the entry
 * point reached from the "Integrations" user-menu item; the per-provider
 * `ProviderConnectionsPage` lives at `/connections/:providerId`.
 *
 * Only providers that declare a `connectionSchema` (i.e. need site-wide
 * credentials) are actionable here; others are shown disabled so operators
 * understand why there's nothing to configure.
 */
export const IntegrationsLandingPage = () => {
  const client = usePluginClient(IntegrationApi);
  const { data: providers = [], isLoading } = client.listProviders.useQuery({});

  if (isLoading) {
    return (
      <PageLayout title="Integrations" icon={Webhook}>
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      </PageLayout>
    );
  }

  if (providers.length === 0) {
    return (
      <PageLayout title="Integrations" icon={Webhook}>
        <EmptyState
          icon={<Webhook className="h-12 w-12" />}
          title="No integration providers"
          description="Install an integration plugin (e.g. Jira, Teams, Webex) to manage its connections here."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Integrations"
      subtitle="Manage site-wide connections for your integration providers"
      icon={Webhook}
    >
      <div className="grid gap-[var(--d-gap)] sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const card = (
            <ProviderCard
              icon={provider.icon}
              displayName={provider.displayName}
              description={provider.description}
              actionable={provider.hasConnectionSchema}
            />
          );

          if (!provider.hasConnectionSchema) {
            return (
              <div key={provider.qualifiedId} className="h-full">
                {card}
              </div>
            );
          }

          return (
            <Link
              key={provider.qualifiedId}
              className="group block h-full no-underline"
              to={resolveRoute(integrationRoutes.routes.connections, {
                providerId: provider.qualifiedId,
              })}
            >
              {card}
            </Link>
          );
        })}
      </div>
    </PageLayout>
  );
};

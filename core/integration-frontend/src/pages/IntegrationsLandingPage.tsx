import { Link } from "react-router-dom";
import {
  PageLayout,
  Card,
  CardContent,
  EmptyState,
  LoadingSpinner,
  DynamicIcon,
  Badge,
  type LucideIconName,
} from "@checkstack/ui";
import { Webhook, ArrowRight } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { IntegrationApi, integrationRoutes } from "@checkstack/integration-common";

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const card = (
            <Card
              className={
                provider.hasConnectionSchema
                  ? "transition-colors hover:border-primary/50"
                  : "opacity-60"
              }
            >
              <CardContent className="flex items-start gap-3 p-4">
                <DynamicIcon
                  name={(provider.icon as LucideIconName) ?? "Webhook"}
                  className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {provider.displayName}
                    </span>
                    {!provider.hasConnectionSchema && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        No connections
                      </Badge>
                    )}
                  </div>
                  {provider.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {provider.description}
                    </p>
                  )}
                </div>
                {provider.hasConnectionSchema && (
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </CardContent>
            </Card>
          );

          if (!provider.hasConnectionSchema) {
            return <div key={provider.qualifiedId}>{card}</div>;
          }

          return (
            <Link
              key={provider.qualifiedId}
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

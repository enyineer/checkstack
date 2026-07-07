import React from "react";
import { useNavigate } from "react-router-dom";
import { Workflow, FilePlus2, ArrowRight } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  automationRoutes,
  type AutomationTemplate,
} from "@checkstack/automation-common";
import {
  PageLayout,
  Button,
  Badge,
  DynamicIcon,
  LoadingSpinner,
  QueryErrorState,
} from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";

/**
 * Landing page for "create a new automation". Presents a "Blank automation"
 * option plus a gallery of curated example templates (grouped by category)
 * contributed by core + plugins. Picking a template opens the blank editor
 * pre-seeded from it (`/automation/new/blank?template=<id>`); the operator
 * still chooses a service account and saves.
 */
const AutomationTemplatePickerContent: React.FC = () => {
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const navigate = useNavigate();

  // The "New automation" picker is a create surface. Gate on the create
  // capability DERIVED from the create procedure's contract (its `create`
  // instanceAccess): global manage rule OR a team-derived create/manage grant,
  // so a team-scoped automation creator - whom the route's `manageCapability`
  // already reveals this page to - is not blocked by a bare global-rule check.
  const { allowed: canCreate, loading: accessLoading } =
    accessApi.useProcedureAccess(AutomationApi.contract.createAutomation);

  const query = client.listAutomationTemplates.useQuery();

  const startBlank = () =>
    navigate(resolveRoute(automationRoutes.routes.createBlank));

  const openTemplate = (template: AutomationTemplate) =>
    navigate(
      `${resolveRoute(automationRoutes.routes.createBlank)}?template=${encodeURIComponent(
        template.id,
      )}`,
    );

  // Group templates by category, preserving first-seen category order.
  const grouped = React.useMemo(() => {
    const byCategory = new Map<string, AutomationTemplate[]>();
    for (const template of query.data?.items ?? []) {
      const list = byCategory.get(template.category) ?? [];
      list.push(template);
      byCategory.set(template.category, list);
    }
    return [...byCategory.entries()];
  }, [query.data]);

  return (
    <PageLayout
      title="New automation"
      subtitle="Start from a curated example or build your own from scratch"
      icon={Workflow}
      loading={accessLoading}
      allowed={canCreate}
    >
      <div className="space-y-6">
        <div className="relative flex flex-col gap-3 overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-inset">
              <FilePlus2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <div className="font-semibold text-foreground">
                Blank automation
              </div>
              <div className="text-sm text-muted-foreground">
                Start with an empty editor and add triggers and actions yourself.
              </div>
            </div>
          </div>
          <Button onClick={startBlank}>
            Start blank
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>

        {query.isLoading ? (
          <div className="p-6">
            <LoadingSpinner />
          </div>
        ) : query.isError ? (
          <QueryErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : (
          grouped.map(([category, items]) => (
            <section key={category} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {category}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((template) => (
                  <div
                    key={template.id}
                    className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl"
                    onClick={() => openTemplate(template)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <DynamicIcon name={template.icon} className="h-5 w-5" />
                      </div>
                      <h3 className="text-base font-semibold leading-snug text-foreground">
                        {template.name}
                      </h3>
                    </div>
                    <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        {template.description}
                      </p>
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="font-normal">
                          {template.ownerPluginId}
                        </Badge>
                        <span className="flex items-center text-sm font-medium text-primary transition-colors group-hover:text-primary">
                          Use template
                          <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </PageLayout>
  );
};

export const AutomationTemplatePickerPage = wrapInSuspense(
  AutomationTemplatePickerContent,
);

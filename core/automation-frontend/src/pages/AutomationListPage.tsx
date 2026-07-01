import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Workflow, Plus, FlaskConical, Trash2 } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  useQueryClient,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  automationAccess,
  automationRoutes,
  automationResourceTypes,
  type Automation,
} from "@checkstack/automation-common";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Toggle,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  ResponsiveTable,
  MobileCardList,
  LoadingSpinner,
  QueryErrorState,
  EmptyState,
  ConfirmationModal,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  useToast,
  toastError,
  cn,
} from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { formatDistanceToNow } from "date-fns";
import { groupAutomations } from "./automation-grouping";

/**
 * Left status-accent class for an automation's enabled/disabled state. Reuses
 * the colorblind-safe triad so the stripe encodes status by position + hue,
 * not by the toggle switch alone: an enabled automation reads `ok`, a disabled
 * one reads muted/`unknown`. Spelled out so Tailwind's JIT keeps the classes.
 */
const automationAccent = (status: Automation["status"]): string =>
  status === "enabled" ? "bg-status-ok" : "bg-status-unknown/60";

/**
 * Lists every automation the operator can see, with quick enable / disable
 * toggle and delete. The "Create" button navigates to `/automation/new`
 * which Phase 12.x will route to a blank edit page.
 *
 * Status filter, name + last-run columns, and a tiny mode badge per row.
 * Pagination defers to a "Load more" button rather than numbered pagers —
 * the most common operation here is "find the one I broke", which a
 * single sorted list of recent activity covers without a pager UX.
 */
/**
 * Cache shape of the `listAutomations` loader: the paginated wrapper around the
 * automation rows. Used to type the optimistic snapshot/patch on the toggle.
 */
type AutomationsQueryData = {
  items: Automation[];
};

const AutomationListContent: React.FC = () => {
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const { allowed: canRead, loading: accessLoading } = accessApi.useAccess(
    automationAccess.read,
  );
  // Create/page gate: whether the user may create a new automation at all
  // (global manage rule OR team-derived create capability).
  const { allowed: canCreate } = accessApi.useCanCreate({
    accessRule: automationAccess.manage,
    objectType: automationResourceTypes.automation,
  });

  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [deleteId, setDeleteId] = React.useState<string | undefined>();

  // The loader input depends on the status filter, so the cache key changes
  // when the filter changes. Build the input once and derive the exact oRPC
  // query key from it so the optimistic patch addresses the same cache entry.
  // See `docs/.../frontend/optimistic-updates.md` for the query-key contract.
  const listInput = React.useMemo(
    () => ({
      limit: 100,
      offset: 0,
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
    }),
    [statusFilter],
  );

  const automationsQueryKey = React.useMemo(
    () =>
      [
        ["automation", "listAutomations"],
        { input: listInput, type: "query" },
      ] as const,
    [listInput],
  );

  const query = client.listAutomations.useQuery(listInput);

  // Toggle is a cheap, low-risk per-row flip — apply the optimistic pattern so
  // the switch flips on click instead of after the round-trip:
  // 1. onMutate cancels in-flight refetches, snapshots, flips the row status.
  // 2. onError rolls back from the snapshot, then surfaces a toast.
  // 3. onSettled invalidates so server truth settles in either branch.
  // 4. No success toast — the visible switch flip IS the feedback.
  const toggleMutation = client.toggleAutomation.useMutation<{
    previous: AutomationsQueryData | undefined;
  }>({
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: automationsQueryKey });
      const previous =
        queryClient.getQueryData<AutomationsQueryData>(automationsQueryKey);
      if (previous) {
        queryClient.setQueryData<AutomationsQueryData>(automationsQueryKey, {
          ...previous,
          items: previous.items.map((automation) =>
            automation.id === id
              ? { ...automation, status: enabled ? "enabled" : "disabled" }
              : automation,
          ),
        });
      }
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(automationsQueryKey, ctx.previous);
      }
      toastError(toast, "Failed to toggle automation", error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    },
  });

  const deleteMutation = client.deleteAutomation.useMutation({
    onSuccess: () => {
      toast.success("Automation deleted");
      setDeleteId(undefined);
    },
    onError: (error) => toastError(toast, "Failed to delete automation", error),
  });

  const items = query.data?.items;
  const automations = React.useMemo(() => items ?? [], [items]);
  const isEmpty = !query.isLoading && automations.length === 0;

  // Per-resource manage gate: grants ALL rows to global-manage holders, and
  // per-object grants to team-scoped users. Gate each row's toggle/delete on
  // `canAccess(automation.id)` instead of a single global bool.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: automationAccess.manage,
    objectType: automationResourceTypes.automation,
    resourceIds: automations.map((a) => a.id),
  });

  // Collapsible sections, sorted alphabetically with "Ungrouped" last.
  const groups = React.useMemo(
    () => groupAutomations({ automations }),
    [automations],
  );
  // All sections expanded by default so nothing is hidden on first load.
  const allGroupKeys = React.useMemo(() => groups.map((g) => g.key), [groups]);

  const renderRow = (automation: Automation) => (
    <TableRow
      key={automation.id}
      className="relative cursor-pointer transition-colors hover:bg-surface-inset"
      onClick={() =>
        navigate(
          resolveRoute(automationRoutes.routes.edit, {
            automationId: automation.id,
          }),
        )
      }
    >
      <TableCell
        onClick={(e) => e.stopPropagation()}
        className="relative pl-4"
      >
        {/* Status accent: enabled/disabled by position + hue, not toggle alone. */}
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            automationAccent(automation.status),
          )}
          aria-hidden
        />
        {canAccess(automation.id) ? (
          <Toggle
            checked={automation.status === "enabled"}
            onCheckedChange={(enabled) =>
              toggleMutation.mutate({
                id: automation.id,
                enabled,
              })
            }
            aria-label={
              automation.status === "enabled"
                ? "Disable automation"
                : "Enable automation"
            }
          />
        ) : (
          <Badge
            variant={
              automation.status === "enabled" ? "success" : "outline"
            }
          >
            {automation.status}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">
            {automation.name}
          </span>
          {automation.description && (
            <span className="text-xs text-muted-foreground">
              {automation.description}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {automation.definition.triggers.slice(0, 3).map((trigger, index) => (
            <Badge
              key={`${trigger.event}-${index}`}
              variant="outline"
              className="font-mono text-[10px] font-normal text-muted-foreground"
            >
              {trigger.event}
            </Badge>
          ))}
          {automation.definition.triggers.length > 3 && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal text-muted-foreground"
            >
              +{automation.definition.triggers.length - 3}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-[10px]">
          {automation.definition.mode}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(automation.updatedAt), {
            addSuffix: true,
          })}
        </span>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
        <div className="flex justify-end gap-1">
          <Link
            to={resolveRoute(automationRoutes.routes.runs, {
              automationId: automation.id,
            })}
          >
            <Button variant="ghost" size="sm">
              Runs
            </Button>
          </Link>
          {canAccess(automation.id) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteId(automation.id)}
              aria-label="Delete automation"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  const renderMobileCard = (automation: Automation) => (
    <div
      key={automation.id}
      className="group relative cursor-pointer overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl"
      onClick={() =>
        navigate(
          resolveRoute(automationRoutes.routes.edit, {
            automationId: automation.id,
          }),
        )
      }
    >
      {/* Status accent: enabled/disabled by position + hue, not toggle alone. */}
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          automationAccent(automation.status),
        )}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-foreground">
            {automation.name}
          </span>
          {automation.description && (
            <span className="truncate text-xs text-muted-foreground">
              {automation.description}
            </span>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          {canAccess(automation.id) ? (
            <Toggle
              checked={automation.status === "enabled"}
              onCheckedChange={(enabled) =>
                toggleMutation.mutate({
                  id: automation.id,
                  enabled,
                })
              }
              aria-label={
                automation.status === "enabled"
                  ? "Disable automation"
                  : "Enable automation"
              }
            />
          ) : (
            <Badge
              variant={automation.status === "enabled" ? "success" : "outline"}
            >
              {automation.status}
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 pl-2">
        {automation.definition.triggers.slice(0, 3).map((trigger, index) => (
          <Badge
            key={`${trigger.event}-${index}`}
            variant="outline"
            className="font-mono text-[10px] font-normal text-muted-foreground"
          >
            {trigger.event}
          </Badge>
        ))}
        {automation.definition.triggers.length > 3 && (
          <Badge
            variant="outline"
            className="text-[10px] font-normal text-muted-foreground"
          >
            +{automation.definition.triggers.length - 3}
          </Badge>
        )}
        <Badge variant="secondary" className="text-[10px]">
          {automation.definition.mode}
        </Badge>
      </div>
      <div className="mt-1 pl-2 text-xs text-muted-foreground">
        Updated{" "}
        {formatDistanceToNow(new Date(automation.updatedAt), {
          addSuffix: true,
        })}
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-3 flex justify-end gap-1 pl-2"
      >
        <Link
          to={resolveRoute(automationRoutes.routes.runs, {
            automationId: automation.id,
          })}
        >
          <Button variant="ghost" size="sm">
            Runs
          </Button>
        </Link>
        {canAccess(automation.id) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteId(automation.id)}
            aria-label="Delete automation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <PageLayout
      title="Automations"
      subtitle="Trigger-driven workflows that react to platform events"
      icon={Workflow}
      loading={accessLoading}
      allowed={canRead}
      actions={
        <div className="flex items-center gap-2">
          <Link to={resolveRoute(automationRoutes.routes.playground)}>
            <Button variant="outline" size="sm">
              <FlaskConical className="mr-1 h-4 w-4" />
              Playground
            </Button>
          </Link>
          {canCreate && (
            <Link to={resolveRoute(automationRoutes.routes.create)}>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New automation
              </Button>
            </Link>
          )}
        </div>
      }
    >
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">All automations</CardTitle>
            <div className="flex items-center gap-1">
              {(["all", "enabled", "disabled"] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={statusFilter === option ? "primary" : "outline"}
                  onClick={() => setStatusFilter(option)}
                  className="capitalize"
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="p-6">
              <LoadingSpinner />
            </div>
          ) : query.isError ? (
            <QueryErrorState
              error={query.error}
              onRetry={() => query.refetch()}
            />
          ) : isEmpty ? (
            <EmptyState
              icon={<Workflow className="h-8 w-8 text-muted-foreground" />}
              title="No automations yet"
              description={
                canCreate
                  ? 'Click "New automation" to wire your first trigger.'
                  : "Once an admin creates an automation it will appear here."
              }
            />
          ) : (
            <Accordion
              // Re-key on the group set so newly-appearing sections (after a
              // status-filter change) start expanded rather than collapsed.
              key={allGroupKeys.join("|")}
              type="multiple"
              defaultValue={allGroupKeys}
              className="w-full"
            >
              {groups.map((group) => (
                <AccordionItem
                  key={group.key}
                  value={group.key}
                  className="last:border-b-0"
                >
                  <AccordionTrigger className="px-4">
                    <span className="flex items-center gap-2">
                      <span
                        className={
                          group.ungrouped
                            ? "text-muted-foreground"
                            : undefined
                        }
                      >
                        {group.label}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {group.items.length}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-0 pb-0">
                    <ResponsiveTable>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Name</TableHead>
                            <TableHead>Triggers</TableHead>
                            <TableHead>Mode</TableHead>
                            <TableHead>Updated</TableHead>
                            <TableHead className="w-24 text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.items.map((automation) =>
                            renderRow(automation),
                          )}
                        </TableBody>
                      </Table>
                    </ResponsiveTable>
                    <MobileCardList className="p-2">
                      {group.items.map((automation) =>
                        renderMobileCard(automation),
                      )}
                    </MobileCardList>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <ConfirmationModal
        isOpen={deleteId !== undefined}
        onClose={() => setDeleteId(undefined)}
        title="Delete automation?"
        message="This will stop the automation from triggering. Existing run history is preserved."
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId !== undefined) {
            deleteMutation.mutate({ id: deleteId });
          }
        }}
      />
    </PageLayout>
  );
};

export const AutomationListPage = wrapInSuspense(AutomationListContent);

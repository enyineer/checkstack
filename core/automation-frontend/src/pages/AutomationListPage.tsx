import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Workflow, Plus, FlaskConical, Trash2 } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  automationAccess,
  automationRoutes,
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
  LoadingSpinner,
  QueryErrorState,
  EmptyState,
  ConfirmationModal,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  useToast,
} from "@checkstack/ui";
import { extractErrorMessage, resolveRoute } from "@checkstack/common";
import { formatDistanceToNow } from "date-fns";
import { groupAutomations } from "./automation-grouping";

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
const AutomationListContent: React.FC = () => {
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const navigate = useNavigate();

  const { allowed: canRead, loading: accessLoading } = accessApi.useAccess(
    automationAccess.read,
  );
  const { allowed: canManage } = accessApi.useAccess(automationAccess.manage);

  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "enabled" | "disabled"
  >("all");
  const [deleteId, setDeleteId] = React.useState<string | undefined>();

  const query = client.listAutomations.useQuery({
    limit: 100,
    offset: 0,
    ...(statusFilter === "all" ? {} : { status: statusFilter }),
  });

  const toggleMutation = client.toggleAutomation.useMutation({
    onSuccess: (data) => {
      toast.success(
        `${data.name} ${data.status === "enabled" ? "enabled" : "disabled"}`,
      );
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  });

  const deleteMutation = client.deleteAutomation.useMutation({
    onSuccess: () => {
      toast.success("Automation deleted");
      setDeleteId(undefined);
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  });

  const items = query.data?.items;
  const automations = React.useMemo(() => items ?? [], [items]);
  const isEmpty = !query.isLoading && automations.length === 0;

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
      className="cursor-pointer hover:bg-accent/40"
      onClick={() =>
        navigate(
          resolveRoute(automationRoutes.routes.edit, {
            automationId: automation.id,
          }),
        )
      }
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        {canManage ? (
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
        <div className="flex flex-col">
          <span className="font-medium">{automation.name}</span>
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
              className="text-[10px] font-mono"
            >
              {trigger.event}
            </Badge>
          ))}
          {automation.definition.triggers.length > 3 && (
            <Badge variant="outline" className="text-[10px]">
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
          {canManage && (
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
          {canManage && (
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
                canManage
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

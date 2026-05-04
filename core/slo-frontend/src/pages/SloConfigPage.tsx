import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { SloApi } from "../api";
import {
  sloAccess,
  pluginMetadata as sloPluginMetadata,
  type SloObjective,
} from "@checkstack/slo-common";
import { Tip } from "@checkstack/tips-frontend";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  LoadingSpinner,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  useToast,
  ConfirmationModal,
  PageLayout,
} from "@checkstack/ui";
import { Plus, Target, Trash2, Edit2 } from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";
import { SloEditor } from "../components/SloEditor";

const SloConfigPageContent: React.FC = () => {
  const sloClient = usePluginClient(SloApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    sloAccess.slo.manage,
  );

  const {
    data: objectivesData,
    isLoading: objectivesLoading,
    refetch: refetchObjectives,
  } = sloClient.listObjectives.useQuery({});

  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  const objectives = objectivesData?.objectives ?? [];
  const systems = systemsData?.systems ?? [];
  const loading = objectivesLoading || systemsLoading;

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingObjective, setEditingObjective] = useState<
    SloObjective | undefined
  >();

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | undefined>();

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setEditingObjective(undefined);
      setEditorOpen(true);
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  const handleCreate = () => {
    setEditingObjective(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (obj: SloObjective) => {
    setEditingObjective(obj);
    setEditorOpen(true);
  };

  const handleSave = () => {
    setEditorOpen(false);
    void refetchObjectives();
  };

  const deleteMutation = sloClient.deleteObjective.useMutation({
    onSuccess: () => {
      toast.success("SLO objective deleted");
      void refetchObjectives();
      setDeleteId(undefined);
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete"));
    },
  });

  const handleDelete = () => {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId });
  };

  const getSystemName = (systemId: string) => {
    return systems.find((s) => s.id === systemId)?.name ?? systemId;
  };

  const getExclusionBadge = (mode: SloObjective["dependencyExclusion"]) => {
    switch (mode) {
      case "strict": {
        return <Badge variant="secondary">Strict</Badge>;
      }
      case "self-only": {
        return <Badge variant="info">Self-Only</Badge>;
      }
      default: {
        return <Badge>{mode}</Badge>;
      }
    }
  };

  return (
    <PageLayout
      title="SLO Management"
      subtitle="Define and manage Service Level Objectives"
      icon={Target}
      loading={accessLoading}
      allowed={canManage}
      actions={
        <Tip
          plugin={sloPluginMetadata}
          id="objectives.create"
          title="Set the bar for reliability"
          description="An SLO is a contract you set with yourself — “this service is healthy 99.9% of the time over 30 days”. Checkstack measures it from your existing health-check history, tracks the error budget, and shows you when you're burning it too fast."
          side="bottom"
          align="end"
        >
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create SLO
          </Button>
        </Tip>
      }
    >
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Objectives</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : objectives.length === 0 ? (
            <EmptyState
              icon={<Target className="size-10" />}
              title="No SLO objectives yet"
              description="An SLO turns raw uptime into a target you can hold yourself to: “API X is healthy 99.9% of the time over the last 30 days.” Checkstack tracks the error budget against your health-check history and lets you exclude planned maintenance."
              steps={[
                "Click “Create SLO” and pick the system to measure.",
                "Choose a target (e.g. 99.9%) and a rolling window (e.g. 30 days).",
                "Decide whether scheduled maintenances eat into the error budget — usually you want them excluded.",
              ]}
              actions={
                canManage ? (
                  <Button onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create your first SLO
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>System</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Exclusion Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {objectives.map((item) => (
                  <TableRow key={item.objective.id}>
                    <TableCell className="font-medium">
                      {getSystemName(item.objective.systemId)}
                    </TableCell>
                    <TableCell>{item.objective.target}%</TableCell>
                    <TableCell>{item.objective.windowDays}d</TableCell>
                    <TableCell>
                      {getExclusionBadge(
                        item.objective.dependencyExclusion,
                      )}
                    </TableCell>
                    <TableCell>
                      {item.status.isBreaching ? (
                        <Badge variant="destructive">Breaching</Badge>
                      ) : item.status.hasOpenDowntime ? (
                        <Badge variant="warning">Degraded</Badge>
                      ) : item.status.errorBudgetRemainingPercent <= 20 ? (
                        <Badge variant="warning">At Risk</Badge>
                      ) : (
                        <Badge variant="success">Healthy</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(item.objective)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(item.objective.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SloEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        objective={editingObjective}
        systems={systems}
        onSave={handleSave}
      />

      <ConfirmationModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(undefined)}
        title="Delete SLO Objective"
        message="Are you sure you want to delete this SLO objective? All associated downtime events and snapshots will also be deleted."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        isLoading={deleteMutation.isPending}
      />
    </PageLayout>
  );
};

export const SloConfigPage = wrapInSuspense(SloConfigPageContent);

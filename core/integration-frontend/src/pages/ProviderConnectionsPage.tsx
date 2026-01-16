/**
 * Provider Connections Page
 *
 * Manages site-wide connections for a specific integration provider.
 * Uses the provider's connectionSchema with DynamicForm for the configuration UI.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Plus,
  Settings2,
  Trash2,
  TestTube2,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  PageLayout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DynamicIcon,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  DynamicForm,
  Input,
  Label,
  useToast,
  ConfirmationModal,
  BackLink,
  type LucideIconName,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  IntegrationApi,
  integrationRoutes,
  type IntegrationProviderInfo,
  type ProviderConnectionRedacted,
} from "@checkstack/integration-common";

export const ProviderConnectionsPage = () => {
  const { providerId } = useParams<{ providerId: string }>();

  const client = usePluginClient(IntegrationApi);
  const toast = useToast();

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<
    ProviderConnectionRedacted | undefined
  >();

  // Form state
  const [formName, setFormName] = useState("");
  const [formConfig, setFormConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Test state
  const [testingId, setTestingId] = useState<string | undefined>();
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message?: string }>
  >({});

  // Form validation state
  const [configValid, setConfigValid] = useState(false);

  // Queries using hooks
  const { data: providers = [], isLoading: providersLoading } =
    client.listProviders.useQuery({});

  const {
    data: connections = [],
    isLoading: connectionsLoading,
    refetch: refetchConnections,
  } = client.listConnections.useQuery(
    { providerId: providerId ?? "" },
    { enabled: !!providerId }
  );

  const loading = providersLoading || connectionsLoading;
  const provider = (providers as IntegrationProviderInfo[]).find(
    (p) => p.qualifiedId === providerId
  );

  // Mutations
  const createMutation = client.createConnection.useMutation({
    onSuccess: () => {
      void refetchConnections();
      setCreateDialogOpen(false);
      setFormName("");
      setFormConfig({});
      toast.success("Connection created successfully");
      setSaving(false);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create connection"
      );
      setSaving(false);
    },
  });

  const updateMutation = client.updateConnection.useMutation({
    onSuccess: () => {
      void refetchConnections();
      setEditDialogOpen(false);
      setSelectedConnection(undefined);
      toast.success("Connection updated successfully");
      setSaving(false);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update connection"
      );
      setSaving(false);
    },
  });

  const deleteMutation = client.deleteConnection.useMutation({
    onSuccess: () => {
      void refetchConnections();
      setDeleteConfirmOpen(false);
      setSelectedConnection(undefined);
      toast.success("Connection deleted");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete connection"
      );
    },
  });

  const testMutation = client.testConnection.useMutation({
    onSuccess: (result, variables) => {
      setTestResults((prev) => ({
        ...prev,
        [variables.connectionId]: result,
      }));
      if (result.success) {
        toast.success(result.message ?? "Connection test successful");
      } else {
        toast.error(result.message ?? "Connection test failed");
      }
      setTestingId(undefined);
    },
    onError: (error, variables) => {
      setTestResults((prev) => ({
        ...prev,
        [variables.connectionId]: { success: false, message: "Test failed" },
      }));
      toast.error(
        error instanceof Error ? error.message : "Connection test failed"
      );
      setTestingId(undefined);
    },
  });

  const handleCreate = () => {
    if (!providerId || !formName.trim()) return;
    setSaving(true);
    createMutation.mutate({
      providerId,
      name: formName.trim(),
      config: formConfig,
    });
  };

  // Reset form when creating
  const openCreateDialog = () => {
    setFormName("");
    setFormConfig({});
    setConfigValid(false);
    setCreateDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedConnection) return;
    setSaving(true);
    updateMutation.mutate({
      connectionId: selectedConnection.id,
      updates: {
        name: formName.trim() || selectedConnection.name,
        config: formConfig,
      },
    });
  };

  const handleDelete = () => {
    if (!selectedConnection) return;
    deleteMutation.mutate({ connectionId: selectedConnection.id });
  };

  const handleTest = (connectionId: string) => {
    setTestingId(connectionId);
    testMutation.mutate({ connectionId });
  };

  const openEditDialog = (connection: ProviderConnectionRedacted) => {
    setSelectedConnection(connection);
    setFormName(connection.name);
    setFormConfig(connection.configPreview);
    setConfigValid(true); // Existing connections should have valid config
    setEditDialogOpen(true);
  };

  const openDeleteConfirm = (connection: ProviderConnectionRedacted) => {
    setSelectedConnection(connection);
    setDeleteConfirmOpen(true);
  };

  if (!providerId) {
    return <PageLayout title="Error">Missing provider ID</PageLayout>;
  }

  if (!loading && !provider) {
    return (
      <PageLayout title="Provider Not Found">
        <EmptyState
          icon={<Settings2 className="h-12 w-12" />}
          title="Provider not found"
          description={`No provider found with ID: ${providerId}`}
        />
      </PageLayout>
    );
  }

  if (!loading && !provider?.hasConnectionSchema) {
    return (
      <PageLayout title={provider?.displayName ?? "Provider"}>
        <EmptyState
          icon={<Settings2 className="h-12 w-12" />}
          title="No connection management"
          description="This provider does not support site-wide connections"
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={`${provider?.displayName ?? "Provider"} Connections`}
      subtitle="Manage site-wide connections for this integration provider"
      loading={loading}
      actions={
        <div className="flex items-center gap-2">
          <BackLink to={resolveRoute(integrationRoutes.routes.list)}>
            Back to Integrations
          </BackLink>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            New Connection
          </Button>
        </div>
      }
    >
      {(connections as ProviderConnectionRedacted[]).length === 0 ? (
        <EmptyState
          icon={
            <DynamicIcon
              name={(provider?.icon ?? "Settings2") as LucideIconName}
              className="h-12 w-12"
            />
          }
          title="No connections configured"
          description="Create a connection to start using this provider"
        >
          <Button onClick={openCreateDialog} className="mt-4">
            <Plus className="h-4 w-4 mr-2" />
            Create Connection
          </Button>
        </EmptyState>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DynamicIcon
                name={(provider?.icon ?? "Settings2") as LucideIconName}
                className="h-5 w-5"
              />
              Connections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(connections as ProviderConnectionRedacted[]).map((conn) => {
                  const testResult = testResults[conn.id];
                  const isTesting = testingId === conn.id;

                  return (
                    <TableRow key={conn.id}>
                      <TableCell className="font-medium">{conn.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(conn.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {testResult && (
                          <div className="flex items-center gap-1">
                            {testResult.success ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                            <span className="text-sm">
                              {testResult.success ? "Connected" : "Failed"}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleTest(conn.id)}
                            disabled={isTesting}
                          >
                            {isTesting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <TestTube2 className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(conn)}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteConfirm(conn)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Connection</DialogTitle>
            <DialogDescription>
              Create a new {provider?.displayName} connection
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="connection-name">Connection Name</Label>
              <Input
                id="connection-name"
                placeholder="e.g., Production Server"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            {provider?.connectionSchema && (
              <DynamicForm
                schema={provider.connectionSchema}
                value={formConfig}
                onChange={setFormConfig}
                onValidChange={setConfigValid}
              />
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!formName.trim() || !configValid || saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Connection</DialogTitle>
            <DialogDescription>Update connection settings</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-connection-name">Connection Name</Label>
              <Input
                id="edit-connection-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            {provider?.connectionSchema && (
              <DynamicForm
                schema={provider.connectionSchema}
                value={formConfig}
                onChange={setFormConfig}
                onValidChange={setConfigValid}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={!configValid || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmationModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete Connection"
        message={`Are you sure you want to delete "${selectedConnection?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
      />
    </PageLayout>
  );
};

/**
 * Provider Connections Page
 *
 * Manages site-wide connections for a specific integration provider.
 * Uses the provider's connectionSchema with DynamicForm for the configuration UI.
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
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
} from "@checkmate-monitor/ui";
import { useApi, rpcApiRef } from "@checkmate-monitor/frontend-api";
import { resolveRoute } from "@checkmate-monitor/common";
import {
  IntegrationApi,
  integrationRoutes,
  type IntegrationProviderInfo,
  type ProviderConnectionRedacted,
} from "@checkmate-monitor/integration-common";

export const ProviderConnectionsPage = () => {
  const { providerId } = useParams<{ providerId: string }>();
  const rpcApi = useApi(rpcApiRef);
  const client = rpcApi.forPlugin(IntegrationApi);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<IntegrationProviderInfo | undefined>(
    
  );
  const [connections, setConnections] = useState<ProviderConnectionRedacted[]>(
    []
  );

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

  const fetchData = useCallback(async () => {
    if (!providerId) return;

    try {
      const [providersResult, connectionsResult] = await Promise.all([
        client.listProviders(),
        client.listConnections({ providerId }),
      ]);

      const foundProvider = providersResult.find(
        (p) => p.qualifiedId === providerId
      );
      setProvider(foundProvider);
      setConnections(connectionsResult);
    } catch (error) {
      console.error("Failed to load connections:", error);
      toast.error("Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, [providerId, client, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    if (!providerId || !formName.trim()) return;

    setSaving(true);
    try {
      const newConnection = await client.createConnection({
        providerId,
        name: formName.trim(),
        config: formConfig,
      });
      setConnections((prev) => [...prev, newConnection]);
      setCreateDialogOpen(false);
      setFormName("");
      setFormConfig({});
      toast.success("Connection created successfully");
    } catch (error) {
      console.error("Failed to create connection:", error);
      toast.error("Failed to create connection");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedConnection) return;

    setSaving(true);
    try {
      const updated = await client.updateConnection({
        connectionId: selectedConnection.id,
        updates: {
          name: formName.trim() || selectedConnection.name,
          config: formConfig,
        },
      });
      setConnections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      setEditDialogOpen(false);
      setSelectedConnection(undefined);
      toast.success("Connection updated successfully");
    } catch (error) {
      console.error("Failed to update connection:", error);
      toast.error("Failed to update connection");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedConnection) return;

    try {
      await client.deleteConnection({ connectionId: selectedConnection.id });
      setConnections((prev) =>
        prev.filter((c) => c.id !== selectedConnection.id)
      );
      setDeleteConfirmOpen(false);
      setSelectedConnection(undefined);
      toast.success("Connection deleted");
    } catch (error) {
      console.error("Failed to delete connection:", error);
      toast.error("Failed to delete connection");
    }
  };

  const handleTest = async (connectionId: string) => {
    setTestingId(connectionId);
    try {
      const result = await client.testConnection({ connectionId });
      setTestResults((prev) => ({
        ...prev,
        [connectionId]: result,
      }));
      if (result.success) {
        toast.success(result.message ?? "Connection test successful");
      } else {
        toast.error(result.message ?? "Connection test failed");
      }
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [connectionId]: { success: false, message: "Test failed" },
      }));
      toast.error("Connection test failed");
    } finally {
      setTestingId(undefined);
    }
  };

  const openEditDialog = (connection: ProviderConnectionRedacted) => {
    setSelectedConnection(connection);
    setFormName(connection.name);
    setFormConfig(connection.configPreview);
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
          <Button variant="outline" asChild>
            <Link to={resolveRoute(integrationRoutes.routes.list)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Integrations
            </Link>
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Connection
          </Button>
        </div>
      }
    >
      {connections.length === 0 ? (
        <EmptyState
          icon={
            <DynamicIcon
              name={provider?.icon ?? "Settings2"}
              className="h-12 w-12"
            />
          }
          title="No connections configured"
          description="Create a connection to start using this provider"
        >
          <Button onClick={() => setCreateDialogOpen(true)} className="mt-4">
            <Plus className="h-4 w-4 mr-2" />
            Create Connection
          </Button>
        </EmptyState>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DynamicIcon
                name={provider?.icon ?? "Settings2"}
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
                {connections.map((conn) => {
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
              disabled={!formName.trim() || saving}
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
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={saving}>
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

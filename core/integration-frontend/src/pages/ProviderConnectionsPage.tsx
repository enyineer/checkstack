/**
 * Provider Connections Page
 *
 * Manages site-wide connections for a specific integration provider.
 * Uses the provider's connectionSchema with DynamicForm for the configuration UI.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Plus,
  Settings2,
  Trash2,
  TestTube2,
  CheckCircle2,
  XCircle,
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
  toastError,
  Spinner,
  deriveServerFieldErrors,
  parseServerValidationData,
  omitKeepExistingSecrets,
  listSecretFieldKeys,
  type FieldErrorMap,
  type LucideIconName,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  IntegrationApi,
  integrationRoutes,
  type ProviderConnectionRedacted,
} from "@checkstack/integration-common";

export const ProviderConnectionsPage = () => {
  const { providerId } = useParams<{ providerId: string }>();
  const navigate = useNavigate();

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
  // Server validation errors mapped to form fields (cleared on each submit).
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrorMap>({});

  // Queries using hooks
  const { data: providers = [], isLoading: providersLoading } =
    client.listProviders.useQuery({});

  const {
    data: connections = [],
    isLoading: connectionsLoading,
    refetch: refetchConnections,
  } = client.listConnections.useQuery(
    { providerId: providerId ?? "" },
    { enabled: !!providerId },
  );

  const loading = providersLoading || connectionsLoading;
  const provider = providers.find((p) => p.qualifiedId === providerId);

  // Try to surface a mutation error INLINE on the offending form fields. The
  // backend attaches structured zod issues (field path + message) to the
  // error `data` for connection-config validation failures; parse that
  // payload (typed, via the shared schema) and map each issue to its field.
  // Anything not field-mappable (generic / unknown errors, or issues whose
  // root is not a rendered field) falls back to the existing toast so nothing
  // is swallowed.
  const handleMutationError = (action: string, error: unknown): void => {
    const schema = provider?.connectionSchema;
    const data =
      error && typeof error === "object" && "data" in error
        ? error.data
        : undefined;
    const parsed = schema ? parseServerValidationData(data) : undefined;

    if (schema && parsed) {
      const { mapped, unmapped } = deriveServerFieldErrors({
        issues: parsed.issues,
        schema,
      });
      if (Object.keys(mapped).length > 0) {
        setServerFieldErrors(mapped);
      }
      // Surface any non-mappable issues (and a fully-unmappable payload) via
      // the toast so they are never silently dropped.
      if (unmapped.length > 0 || Object.keys(mapped).length === 0) {
        toastError(toast, action, error);
      }
      return;
    }

    toastError(toast, action, error);
  };

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
      handleMutationError("Failed to create connection", error);
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
      handleMutationError("Failed to update connection", error);
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
      toastError(toast, "Failed to delete connection", error);
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
      toastError(toast, "Connection test failed", error);
      setTestingId(undefined);
    },
  });

  // In EDIT mode every `x-secret` field defined by the provider schema may
  // already hold a stored value (secrets are redacted out of the loaded
  // preview), so a blank input means "keep existing" and is valid. In CREATE
  // mode no secret is stored yet, so this is empty and blank secrets stay
  // required.
  const keepExistingSecretFields = provider?.connectionSchema
    ? listSecretFieldKeys(provider.connectionSchema)
    : [];

  const handleCreate = () => {
    if (!providerId || !formName.trim()) return;
    setServerFieldErrors({});
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
    setServerFieldErrors({});
    setCreateDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedConnection || !provider?.connectionSchema) return;
    setServerFieldErrors({});
    setSaving(true);
    // Drop blank keep-existing secrets so an empty input does not clear the
    // stored secret on update.
    const config = omitKeepExistingSecrets({
      schema: provider.connectionSchema,
      value: formConfig,
      keepExistingSecretFields,
    });
    updateMutation.mutate({
      connectionId: selectedConnection.id,
      updates: {
        name: formName.trim() || selectedConnection.name,
        config,
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
    setServerFieldErrors({});
    setEditDialogOpen(true);
  };

  const openDeleteConfirm = (connection: ProviderConnectionRedacted) => {
    setSelectedConnection(connection);
    setDeleteConfirmOpen(true);
  };

  if (!providerId) {
    return (
      <PageLayout title="Error" icon={Settings2}>
        Missing provider ID
      </PageLayout>
    );
  }

  if (!loading && !provider) {
    return (
      <PageLayout title="Provider Not Found" icon={Settings2}>
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
      <PageLayout title={provider?.displayName ?? "Provider"} icon={Settings2}>
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
      icon={Settings2}
      loading={loading}
      actions={
        <div className="flex items-center gap-2">
          <BackLink onClick={() => navigate(resolveRoute(integrationRoutes.routes.list))}>
            Back to Integrations
          </BackLink>
          <Button onClick={openCreateDialog}>
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
              name={
                (provider?.icon as LucideIconName | undefined) ?? "Settings2"
              }
              className="h-12 w-12"
            />
          }
          title="No connections configured"
          description={`A connection holds the credentials and base configuration that ${provider?.displayName ?? "this provider"} needs in order to deliver events from Checkstack. Once a connection exists you can subscribe to events from the Integrations page.`}
          steps={[
            "Click “Create Connection” and fill in the credentials this provider needs.",
            "Give the connection a name that says where it points (e.g. “Prod Jira” vs. “Sandbox Jira”).",
            "Head back to Integrations and create a webhook subscription that uses this connection.",
          ]}
          actions={
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Create connection
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DynamicIcon
                name={
                  (provider?.icon as LucideIconName | undefined) ?? "Settings2"
                }
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
                              <Spinner size="sm" />
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
                showInlineErrors
                fieldErrors={serverFieldErrors}
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
              {saving && <Spinner size="sm" className="mr-2" />}
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
                showInlineErrors
                fieldErrors={serverFieldErrors}
                keepExistingSecretFields={keepExistingSecretFields}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={!configValid || saving}>
              {saving && <Spinner size="sm" className="mr-2" />}
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

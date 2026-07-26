/**
 * Provider Connections Page
 *
 * Manages site-wide connections for a specific integration provider.
 * Uses the provider's connectionSchema with DynamicForm for the configuration UI.
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router";
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
  cn,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DynamicIcon,
  EmptyState,
  ListEmptyState,
  DataTable,
  type DataTableColumn,
  RowActions,
  RowAction,
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
import {
  connectionToneStyles,
  presentConnectionStatus,
} from "../components/connectionStatus.logic";

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
  // Provider glyph used as the leading identity chip on each connection row.
  const providerIcon: LucideIconName =
    (provider?.icon as LucideIconName | undefined) ?? "Settings2";

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

  const columns: DataTableColumn<ProviderConnectionRedacted>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (conn) => conn.name,
      searchValue: (conn) => conn.name,
      cell: (conn) => (
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[calc(var(--d-card-r)-4px)] border border-border/60 bg-surface-inset text-primary">
            <DynamicIcon name={providerIcon} className="h-4 w-4" />
          </span>
          <span className="font-medium text-foreground">{conn.name}</span>
        </div>
      ),
    },
    {
      id: "created",
      header: "Created",
      sortValue: (conn) => new Date(conn.createdAt).getTime(),
      cellClassName: "text-xs text-muted-foreground",
      cell: (conn) => new Date(conn.createdAt).toLocaleDateString(),
    },
    {
      id: "status",
      header: "Status",
      cell: (conn) => <ConnectionStatus testResult={testResults[conn.id]} />,
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "text-right",
      cellClassName: "text-right",
      cell: (conn) => (
        <ConnectionActions
          connection={conn}
          isTesting={testingId === conn.id}
          onTest={handleTest}
          onEdit={openEditDialog}
          onDelete={openDeleteConfirm}
        />
      ),
    },
  ];

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
        <DataTable
          data={connections}
          columns={columns}
          getRowId={(conn) => conn.id}
          searchPlaceholder="Search connections..."
          noResultsState={
            <ListEmptyState
              resource="connections"
              description="No connections match your search."
            />
          }
          renderMobileCard={(conn) => {
            const testResult = testResults[conn.id];
            const isTesting = testingId === conn.id;
            const { tone } = presentConnectionStatus({ testResult });
            const { accent } = connectionToneStyles({ tone });

            return (
              <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
                <span
                  className={cn("absolute inset-y-0 left-0 w-1", accent)}
                  aria-hidden
                />
                <div className="flex items-start justify-between gap-2 pl-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[calc(var(--d-card-r)-4px)] border border-border/60 bg-surface-inset text-primary">
                      <DynamicIcon name={providerIcon} className="h-4 w-4" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-foreground">
                        {conn.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(conn.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <ConnectionStatus testResult={testResult} />
                </div>
                <div className="mt-3 flex justify-end pl-2">
                  <ConnectionActions
                    connection={conn}
                    isTesting={isTesting}
                    onTest={handleTest}
                    onEdit={openEditDialog}
                    onDelete={openDeleteConfirm}
                  />
                </div>
              </div>
            );
          }}
        />
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

interface ConnectionStatusProps {
  testResult: { success: boolean; message?: string } | undefined;
}

/**
 * Shared connection status indicator, rendered in both the desktop table cell
 * and the mobile card. Always meaningful via the colorblind-safe triad: a
 * resting "Untested" pill before any test runs, "Connected" on success, and
 * "Failed" on failure - each multi-encoded with a status dot plus (for the
 * tested states) the existing CheckCircle2 / XCircle glyph.
 */
const ConnectionStatus = ({ testResult }: ConnectionStatusProps) => {
  const { label, tone } = presentConnectionStatus({ testResult });
  const { pill, dot } = connectionToneStyles({ tone });

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        pill,
      )}
    >
      {testResult ? (
        testResult.success ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <XCircle className="h-3.5 w-3.5" />
        )
      ) : (
        <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      )}
      {label}
    </span>
  );
};

interface ConnectionActionsProps {
  connection: ProviderConnectionRedacted;
  isTesting: boolean;
  onTest: (connectionId: string) => void;
  onEdit: (connection: ProviderConnectionRedacted) => void;
  onDelete: (connection: ProviderConnectionRedacted) => void;
}

/**
 * Shared per-connection action buttons, rendered in both the desktop table
 * cell and the mobile card so action availability stays consistent.
 */
const ConnectionActions = ({
  connection,
  isTesting,
  onTest,
  onEdit,
  onDelete,
}: ConnectionActionsProps) => (
  <RowActions>
    <RowAction
      icon={isTesting ? Spinner : TestTube2}
      label={`Test ${connection.name}`}
      disabled={isTesting}
      onClick={() => onTest(connection.id)}
    />
    <RowAction
      icon={Settings2}
      label={`Edit ${connection.name}`}
      onClick={() => onEdit(connection)}
    />
    <RowAction
      icon={Trash2}
      label={`Delete ${connection.name}`}
      tone="destructive"
      onClick={() => onDelete(connection)}
    />
  </RowActions>
);

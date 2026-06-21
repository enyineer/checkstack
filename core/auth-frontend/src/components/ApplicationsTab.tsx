import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ResponsiveTable,
  MobileCardList,
  Button,
  Checkbox,
  Input,
  Label,
  LoadingSpinner,
  Alert,
  AlertDescription,
  ConfirmationModal,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  useToast,
  toastError,
} from "@checkstack/ui";
import { Plus, Trash2, RotateCcw, Copy } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { Role } from "../api";

export interface Application {
  id: string;
  name: string;
  description?: string | null;
  roles: string[];
  createdById: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
}

export interface ApplicationsTabProps {
  roles: Role[];
  canManageApplications: boolean;
}

export const ApplicationsTab: React.FC<ApplicationsTabProps> = ({
  roles,
  canManageApplications,
}) => {
  const authClient = usePluginClient(AuthApi);
  const toast = useToast();

  const [applicationToDelete, setApplicationToDelete] = useState<string>();
  const [applicationToRegenerateSecret, setApplicationToRegenerateSecret] =
    useState<{ id: string; name: string }>();
  const [newSecretDialog, setNewSecretDialog] = useState<{
    open: boolean;
    secret: string;
    applicationName: string;
  }>({ open: false, secret: "", applicationName: "" });
  const [createAppDialogOpen, setCreateAppDialogOpen] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [newAppDescription, setNewAppDescription] = useState("");

  // Query: Applications list
  const {
    data: applications = [],
    isLoading: loading,
    refetch: refetchApplications,
  } = authClient.getApplications.useQuery(
    {},
    { enabled: canManageApplications },
  );

  // Mutations
  const createApplicationMutation = authClient.createApplication.useMutation({
    onSuccess: (result) => {
      setCreateAppDialogOpen(false);
      setNewAppName("");
      setNewAppDescription("");
      setNewSecretDialog({
        open: true,
        secret: result.secret,
        applicationName: result.application.name,
      });
      void refetchApplications();
    },
    onError: (error) => {
      toastError(toast, "Failed to create application", error);
    },
  });

  const updateApplicationMutation = authClient.updateApplication.useMutation({
    onSuccess: () => {
      void refetchApplications();
    },
    onError: (error) => {
      toastError(toast, "Failed to update application", error);
    },
  });

  const deleteApplicationMutation = authClient.deleteApplication.useMutation({
    onSuccess: () => {
      toast.success("Application deleted successfully");
      setApplicationToDelete(undefined);
      void refetchApplications();
    },
    onError: (error) => {
      toastError(toast, "Failed to delete application", error);
    },
  });

  const regenerateSecretMutation =
    authClient.regenerateApplicationSecret.useMutation({
      onSuccess: (result) => {
        setNewSecretDialog({
          open: true,
          secret: result.secret,
          applicationName: applicationToRegenerateSecret?.name ?? "",
        });
        setApplicationToRegenerateSecret(undefined);
      },
      onError: (error) => {
        toastError(toast, "Failed to regenerate secret", error);
      },
    });

  const handleCreateApplication = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) {
      toast.error("Application name is required");
      return;
    }
    createApplicationMutation.mutate({
      name: newAppName.trim(),
      description: newAppDescription.trim() || undefined,
    });
  };

  const handleToggleApplicationRole = (
    appId: string,
    roleId: string,
    currentRoles: string[],
  ) => {
    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter((r) => r !== roleId)
      : [...currentRoles, roleId];

    updateApplicationMutation.mutate({
      id: appId,
      roles: newRoles,
    });
  };

  const handleDeleteApplication = () => {
    if (!applicationToDelete) return;
    deleteApplicationMutation.mutate(applicationToDelete);
  };

  const handleRegenerateSecret = () => {
    if (!applicationToRegenerateSecret) return;
    regenerateSecretMutation.mutate(applicationToRegenerateSecret.id);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardHeaderRow>
            <CardTitle>External Applications</CardTitle>
            {canManageApplications && (
              <Button onClick={() => setCreateAppDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create Application
              </Button>
            )}
          </CardHeaderRow>
        </CardHeader>
        <CardContent>
          <Alert variant="info" className="mb-4">
            <AlertDescription>
              External applications use API keys to authenticate with the
              Checkstack API. The secret is only shown once when created—store
              it securely.
            </AlertDescription>
          </Alert>

          {loading ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner />
            </div>
          ) : (applications as Application[]).length === 0 ? (
            <p className="text-muted-foreground">
              No external applications configured yet.
            </p>
          ) : (
            <>
              <ResponsiveTable className="rounded-md border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Application</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(applications as Application[]).map((app) => (
                      <TableRow key={app.id}>
                        <TableCell>
                          <ApplicationIdentity app={app} />
                        </TableCell>
                        <TableCell>
                          <ApplicationRoles
                            app={app}
                            roles={roles}
                            canManageApplications={canManageApplications}
                            onToggleRole={handleToggleApplicationRole}
                          />
                        </TableCell>
                        <TableCell>
                          <ApplicationLastUsed lastUsedAt={app.lastUsedAt} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <ApplicationActions
                              app={app}
                              onRegenerate={setApplicationToRegenerateSecret}
                              onDelete={setApplicationToDelete}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ResponsiveTable>

              <MobileCardList>
                {(applications as Application[]).map((app) => (
                  <Card key={app.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <ApplicationIdentity app={app} />
                      <ApplicationLastUsed lastUsedAt={app.lastUsedAt} />
                    </div>
                    <div className="mt-3">
                      <ApplicationRoles
                        app={app}
                        roles={roles}
                        canManageApplications={canManageApplications}
                        onToggleRole={handleToggleApplicationRole}
                      />
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <ApplicationActions
                        app={app}
                        onRegenerate={setApplicationToRegenerateSecret}
                        onDelete={setApplicationToDelete}
                      />
                    </div>
                  </Card>
                ))}
              </MobileCardList>
            </>
          )}

          {!canManageApplications && (
            <p className="text-xs text-muted-foreground mt-4">
              You don't have access to manage applications.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Delete Application Confirmation */}
      <ConfirmationModal
        isOpen={!!applicationToDelete}
        onClose={() => setApplicationToDelete(undefined)}
        onConfirm={handleDeleteApplication}
        title="Delete Application"
        message="Are you sure you want to delete this application? Its API key will stop working immediately."
      />

      {/* Regenerate Secret Confirmation */}
      <ConfirmationModal
        isOpen={!!applicationToRegenerateSecret}
        onClose={() => setApplicationToRegenerateSecret(undefined)}
        onConfirm={handleRegenerateSecret}
        title="Regenerate Application Secret"
        message={`Are you sure you want to regenerate the secret for "${
          applicationToRegenerateSecret?.name ?? ""
        }"? The current secret will stop working immediately and all calling applications will break until updated.`}
      />

      {/* New Secret Display Dialog */}
      <Dialog
        open={newSecretDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setNewSecretDialog({
              open: false,
              secret: "",
              applicationName: "",
            });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Application Secret: {newSecretDialog.applicationName}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Copy your application secret - it will only be shown once
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Alert variant="warning">
              <AlertDescription>
                Copy this secret now—it will never be shown again!
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-surface-inset p-2 rounded font-mono text-sm break-all">
                {newSecretDialog.secret}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(newSecretDialog.secret);
                  toast.success("Secret copied to clipboard");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                setNewSecretDialog({
                  open: false,
                  secret: "",
                  applicationName: "",
                })
              }
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Application Dialog */}
      <Dialog
        open={createAppDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateAppDialogOpen(false);
            setNewAppName("");
            setNewAppDescription("");
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleCreateApplication}>
            <DialogHeader>
              <DialogTitle>Create Application</DialogTitle>
              <DialogDescription className="sr-only">
                Create a new external application with API key access
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="create-application-name" required>
                  Name
                </Label>
                <Input
                  id="create-application-name"
                  type="text"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="My Application"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-application-description">
                  Description (optional)
                </Label>
                <Input
                  id="create-application-description"
                  type="text"
                  value={newAppDescription}
                  onChange={(e) => setNewAppDescription(e.target.value)}
                  placeholder="What does this application do?"
                />
              </div>
              <Alert variant="info">
                <AlertDescription>
                  New applications are assigned the "Applications" role by
                  default. You can manage roles after creation.
                </AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreateAppDialogOpen(false);
                  setNewAppName("");
                  setNewAppDescription("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !newAppName.trim() || createApplicationMutation.isPending
                }
              >
                {createApplicationMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const ApplicationIdentity: React.FC<{ app: Application }> = ({ app }) => (
  <div className="flex flex-col min-w-0">
    <span className="font-medium truncate">{app.name}</span>
    {app.description && (
      <span className="text-xs text-muted-foreground truncate">
        {app.description}
      </span>
    )}
    <span className="text-xs text-muted-foreground font-mono truncate">
      ID: {app.id}
    </span>
  </div>
);

const ApplicationLastUsed: React.FC<{
  lastUsedAt?: Date | null;
}> = ({ lastUsedAt }) =>
  lastUsedAt ? (
    <span className="text-sm whitespace-nowrap">
      {new Date(lastUsedAt).toLocaleDateString()}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">Never</span>
  );

const ApplicationRoles: React.FC<{
  app: Application;
  roles: Role[];
  canManageApplications: boolean;
  onToggleRole: (appId: string, roleId: string, currentRoles: string[]) => void;
}> = ({ app, roles, canManageApplications, onToggleRole }) => (
  <div className="flex flex-wrap flex-col gap-2">
    {roles
      .filter((role) => role.isAssignable !== false)
      .map((role) => (
        <div key={role.id} className="flex items-center space-x-2">
          <Checkbox
            id={`app-role-${app.id}-${role.id}`}
            checked={app.roles.includes(role.id)}
            disabled={!canManageApplications}
            onCheckedChange={() => onToggleRole(app.id, role.id, app.roles)}
          />
          <label
            htmlFor={`app-role-${app.id}-${role.id}`}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {role.name}
          </label>
        </div>
      ))}
  </div>
);

const ApplicationActions: React.FC<{
  app: Application;
  onRegenerate: (target: { id: string; name: string }) => void;
  onDelete: (id: string) => void;
}> = ({ app, onRegenerate, onDelete }) => (
  <>
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onRegenerate({ id: app.id, name: app.name })}
      title="Regenerate Secret"
    >
      <RotateCcw className="h-4 w-4" />
    </Button>
    <Button variant="ghost" size="sm" onClick={() => onDelete(app.id)}>
      <Trash2 className="h-4 w-4" />
    </Button>
  </>
);

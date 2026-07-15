import React from "react";
import { KeyRound, Plus } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { SecretsApi, secretsAccess } from "@checkstack/secrets-common";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Alert,
  AlertTitle,
  AlertDescription,
  AccessDenied,
  LoadingSpinner,
  ConfirmationModal,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";
import { BackendConfigCard } from "../components/BackendConfigCard";
import { SecretsInventorySummary } from "../components/SecretsInventorySummary";
import { SecretRow } from "../components/SecretRow";

const SettingsContent: React.FC = () => {
  const client = usePluginClient(SecretsApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    secretsAccess.secret.manage,
  );

  const secretsQuery = client.listSecrets.useQuery();
  // gcTime:0: this config seeds BackendConfigCard's editable form once via
  // useInitOnceForKey, so drop the cache on unmount to avoid a stale warm
  // cache racing the one-shot seed on reopen (see query-invalidation docs).
  const backendQuery = client.getBackendConfig.useQuery(undefined, {
    gcTime: 0,
  });

  // setSecret creates a new secret OR rotates an existing one (write-only:
  // the value is never read back by any endpoint).
  const setMutation = client.setSecret.useMutation();
  const deleteMutation = client.deleteSecret.useMutation();

  const [name, setName] = React.useState("");
  const [value, setValue] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [rotateName, setRotateName] = React.useState<string | null>(null);
  const [rotateValue, setRotateValue] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  if (accessLoading) return <LoadingSpinner />;
  if (!allowed) {
    return (
      <PageLayout title="Secrets" icon={KeyRound}>
        <AccessDenied />
      </PageLayout>
    );
  }

  const secrets = secretsQuery.data ?? [];
  const backend = backendQuery.data;
  // Read-through backends (e.g. Vault) reject writes — hide the create /
  // rotate / delete controls so the user isn't invited to fail. Default to
  // writable while the config loads so the local backend never flickers
  // read-only.
  const writable = backend?.writable ?? true;

  const handleCreate = async () => {
    setError(null);
    try {
      await setMutation.mutateAsync({
        name: name.trim(),
        value,
        description: description.trim() || undefined,
      });
      setName("");
      setValue("");
      setDescription("");
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleRotate = async () => {
    if (!rotateName) return;
    setError(null);
    try {
      await setMutation.mutateAsync({ name: rotateName, value: rotateValue });
      setRotateName(null);
      setRotateValue("");
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    setError(null);
    try {
      await deleteMutation.mutateAsync({ name: target });
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  const canSubmitCreate =
    name.trim().length > 0 && value.length > 0 && !setMutation.isPending;

  return (
    <PageLayout title="Secrets" icon={KeyRound}>
      <div className="space-y-6">
        {error && (
          <Alert variant="error">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Backend selection + Vault config */}
        <BackendConfigCard config={backend} onError={setError} />

        {/* Read-through backends manage values in the external store; this
            UI only reflects indexed secret names, so explain why the write
            controls are gone. */}
        {!writable && (
          <Alert>
            <AlertTitle>This backend is read-through</AlertTitle>
            <AlertDescription>
              Manage secret values in the external store (e.g. Vault). This
              list reflects the indexed secret names only; creating, rotating,
              and deleting values is disabled here.
            </AlertDescription>
          </Alert>
        )}

        {/* Create / rotate */}
        {writable && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a secret</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="secret-name">Name</Label>
                  <Input
                    id="secret-name"
                    placeholder="jira_token"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="secret-value">Value</Label>
                  <Input
                    id="secret-value"
                    type="password"
                    placeholder="••••••••"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="secret-description">
                  Description (optional)
                </Label>
                <Input
                  id="secret-description"
                  placeholder="What this secret is used for"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleCreate}
                disabled={!canSubmitCreate}
              >
                <Plus className="h-4 w-4" />
                {setMutation.isPending ? "Saving…" : "Add secret"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Inventory summary - the page's single number-led hero moment. */}
        {secrets.length > 0 && <SecretsInventorySummary secrets={secrets} />}

        {/* List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Secrets {secrets.length > 0 && `(${secrets.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {secretsQuery.isLoading ? (
              <LoadingSpinner />
            ) : secrets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {writable
                  ? "No secrets yet. Add one above."
                  : "No indexed secrets yet."}
              </p>
            ) : (
              <ul className="space-y-2">
                {secrets.map((secret) => (
                  <SecretRow
                    key={secret.id}
                    secret={secret}
                    writable={writable}
                    onRotate={(secretName) => {
                      setRotateName(secretName);
                      setRotateValue("");
                    }}
                    onDelete={(secretName) => setConfirmDelete(secretName)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rotate dialog */}
      <Dialog
        open={rotateName !== null}
        onOpenChange={(open) => {
          if (!open) setRotateName(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate &quot;{rotateName ?? ""}&quot;</DialogTitle>
            <DialogDescription>
              Enter a new value. The previous value is overwritten and cannot be
              recovered.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="rotate-value">New value</Label>
            <Input
              id="rotate-value"
              type="password"
              placeholder="••••••••"
              value={rotateValue}
              onChange={(e) => setRotateValue(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRotateName(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleRotate}
              disabled={rotateValue.length === 0 || setMutation.isPending}
            >
              {setMutation.isPending ? "Rotating…" : "Rotate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmationModal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete secret"
        message={`Delete "${confirmDelete ?? ""}"? Anything referencing it via \${{ secrets.NAME }} will fail to resolve until it is recreated.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </PageLayout>
  );
};

/**
 * Admin Settings -> Secrets page. Create / rotate / delete secrets and view
 * the active backend. Values are write-only (never displayed). Gated by
 * `secrets.manage`.
 */
export const SecretsSettingsPage = wrapInSuspense(SettingsContent);

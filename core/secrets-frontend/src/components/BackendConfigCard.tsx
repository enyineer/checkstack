import React from "react";
import { Plug, CheckCircle2, XCircle } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  SecretsApi,
  type BackendConfigDto,
  type VaultAuthMethod,
} from "@checkstack/secrets-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Badge,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";

const AUTH_METHODS: { value: VaultAuthMethod; label: string }[] = [
  { value: "token", label: "Token" },
  { value: "approle", label: "AppRole" },
  { value: "oidc", label: "OIDC / JWT" },
];

interface VaultForm {
  address: string;
  mount: string;
  authMethod: VaultAuthMethod;
  role: string;
  authMount: string;
  namespace: string;
  credential: string;
}

function seedVaultForm(config: BackendConfigDto | undefined): VaultForm {
  const v = config?.vault;
  return {
    address: v?.address ?? "",
    mount: v?.mount ?? "secret",
    authMethod: v?.authMethod ?? "token",
    role: v?.role ?? "",
    authMount: v?.authMount ?? "",
    namespace: v?.namespace ?? "",
    credential: "",
  };
}

/**
 * Backend selection + Vault connection config. Lets an admin pick the
 * active secret backend and (for Vault) configure address / auth /
 * credential, then test connectivity. The Vault credential is write-only:
 * it is only sent on save and never returned (`hasCredential` shows whether
 * one is stored). No secret value ever appears here.
 */
export const BackendConfigCard: React.FC<{
  config: BackendConfigDto | undefined;
  onError: (message: string | null) => void;
}> = ({ config, onError }) => {
  const client = usePluginClient(SecretsApi);
  const setConfig = client.setBackendConfig.useMutation();
  const test = client.testBackend.useMutation();

  const [active, setActive] = React.useState(config?.activeBackend ?? "local");
  const [vault, setVault] = React.useState<VaultForm>(() =>
    seedVaultForm(config),
  );
  const [testResult, setTestResult] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Re-seed when the loaded config changes (first load / after save).
  React.useEffect(() => {
    if (config) {
      setActive(config.activeBackend);
      setVault(seedVaultForm(config));
    }
  }, [config]);

  const available = config?.availableBackends ?? [];
  const vaultAvailable = available.includes("vault");
  const isVault = active === "vault";

  const update = <K extends keyof VaultForm>(key: K, val: VaultForm[K]) =>
    setVault((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    onError(null);
    setTestResult(null);
    try {
      await setConfig.mutateAsync({
        activeBackend: active,
        ...(isVault
          ? {
              vault: {
                address: vault.address.trim(),
                mount: vault.mount.trim() || "secret",
                authMethod: vault.authMethod,
                role: vault.role.trim() || undefined,
                authMount: vault.authMount.trim() || undefined,
                namespace: vault.namespace.trim() || undefined,
                // Omit the credential when left blank to keep the stored one.
                ...(vault.credential.length > 0
                  ? { credential: vault.credential }
                  : {}),
              },
            }
          : {}),
      });
      // Don't keep the entered credential in component state.
      setVault((prev) => ({ ...prev, credential: "" }));
    } catch (error) {
      onError(extractErrorMessage(error));
    }
  };

  const handleTest = async () => {
    onError(null);
    try {
      const result = await test.mutateAsync({ backend: active });
      setTestResult(result);
    } catch (error) {
      setTestResult({ ok: false, message: extractErrorMessage(error) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Backend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center gap-3">
          <Label htmlFor="active-backend">Active backend</Label>
          <Select value={active} onValueChange={setActive}>
            <SelectTrigger id="active-backend" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {config?.vault?.hasCredential && (
            <Badge variant="secondary">credential set</Badge>
          )}
        </div>

        {isVault && !vaultAvailable && (
          <p className="text-xs text-destructive">
            The Vault backend plugin is not installed.
          </p>
        )}

        {isVault && vaultAvailable && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="vault-address">Vault address</Label>
                <Input
                  id="vault-address"
                  placeholder="https://vault.example.com:8200"
                  value={vault.address}
                  onChange={(e) => update("address", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vault-mount">KV v2 mount</Label>
                <Input
                  id="vault-mount"
                  placeholder="secret"
                  value={vault.mount}
                  onChange={(e) => update("mount", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vault-auth">Auth method</Label>
                <Select
                  value={vault.authMethod}
                  onValueChange={(v) =>
                    update("authMethod", v as VaultAuthMethod)
                  }
                >
                  <SelectTrigger id="vault-auth">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTH_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {vault.authMethod !== "token" && (
                <div className="space-y-1">
                  <Label htmlFor="vault-role">
                    {vault.authMethod === "approle" ? "Role ID" : "Role"}
                  </Label>
                  <Input
                    id="vault-role"
                    value={vault.role}
                    onChange={(e) => update("role", e.target.value)}
                  />
                </div>
              )}
              {vault.authMethod !== "token" && (
                <div className="space-y-1">
                  <Label htmlFor="vault-auth-mount">Auth mount (optional)</Label>
                  <Input
                    id="vault-auth-mount"
                    placeholder={
                      vault.authMethod === "approle" ? "approle" : "jwt"
                    }
                    value={vault.authMount}
                    onChange={(e) => update("authMount", e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="vault-namespace">Namespace (optional)</Label>
                <Input
                  id="vault-namespace"
                  value={vault.namespace}
                  onChange={(e) => update("namespace", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vault-credential">
                  {vault.authMethod === "token"
                    ? "Token"
                    : vault.authMethod === "approle"
                      ? "Secret ID"
                      : "JWT"}
                </Label>
                <Input
                  id="vault-credential"
                  type="password"
                  placeholder={
                    config?.vault?.hasCredential ? "•••••• (unchanged)" : ""
                  }
                  value={vault.credential}
                  onChange={(e) => update("credential", e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The auth credential is write-only: it is stored encrypted and
              never displayed or returned. Leave it blank to keep the current
              one.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={setConfig.isPending}
          >
            <Plug className="h-4 w-4" />
            {setConfig.isPending ? "Saving…" : "Save backend"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={test.isPending}
          >
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          {testResult && (
            <span
              className={`flex items-center gap-1 text-xs ${
                testResult.ok ? "text-emerald-600" : "text-destructive"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {testResult.message}
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {config?.writable === false ? (
            <>
              This backend is read-through: secret values are managed in the
              external store and only their names are indexed here. The list
              below shows names and metadata only. Reference a secret with{" "}
              <code>{"${{ secrets.NAME }}"}</code>.
            </>
          ) : (
            <>
              Secret values are write-only. They are stored encrypted and never
              displayed or returned by the API; the list below shows only names
              and metadata. Reference a secret with{" "}
              <code>{"${{ secrets.NAME }}"}</code>.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
};

import React from "react";
import { ShieldCheck } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  ScriptPackagesApi,
  scriptSandboxAccess,
} from "@checkstack/script-packages-common";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Label,
  Textarea,
  Toggle,
  Alert,
  AlertTitle,
  AlertDescription,
  AccessDenied,
  LoadingSpinner,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useInitOnceForKey,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";
import {
  policyToForm,
  formToPolicyInput,
  validateForm,
  DEFAULT_SANDBOX_FORM,
  type SandboxFormState,
} from "./sandbox-settings.logic";

// Fail-closed seed default for a fresh global policy: the editor opens on the
// secure default (`onUnavailable: "fail"`) until the loader query resolves the
// durable policy and re-seeds the form. The backend resolves the SAME secure
// default for an empty settings table, so on a fresh install there is no flash.
const SEED_FORM = DEFAULT_SANDBOX_FORM;

const SettingsContent: React.FC = () => {
  const client = usePluginClient(ScriptPackagesApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    scriptSandboxAccess.manage,
  );

  // gcTime: 0 so stale-while-revalidate never races the one-shot init below.
  const policyQuery = client.getSandboxPolicy.useQuery(undefined, {
    gcTime: 0,
  });
  const setMutation = client.setSandboxPolicy.useMutation();

  const [form, setForm] = React.useState<SandboxFormState>(SEED_FORM);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // Seed the editable form once per persisted version. The mutation invalidates
  // the query on success → a fresh object identity re-seeds the form.
  useInitOnceForKey(
    policyQuery.data,
    policyQuery.dataUpdatedAt,
    (policy) => {
      setForm(policyToForm(policy));
    },
  );

  if (accessLoading) return <LoadingSpinner />;
  if (!allowed) {
    return (
      <PageLayout title="Script sandbox" icon={ShieldCheck}>
        <AccessDenied />
      </PageLayout>
    );
  }

  // Wait for the durable policy before showing the editor so a stored custom
  // policy never flashes the fail-closed SEED_FORM. `form` itself is never null
  // (it opens on the secure SEED_FORM and is re-seeded once the query resolves).
  if (policyQuery.isLoading) return <LoadingSpinner />;

  const patch = (next: Partial<SandboxFormState>) => {
    setSaved(false);
    setForm((cur) => ({ ...cur, ...next }));
  };

  const validationError = validateForm(form);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    const problem = validateForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await setMutation.mutateAsync(formToPolicyInput(form));
      setSaved(true);
    } catch (error_) {
      setError(extractErrorMessage(error_));
    }
  };

  return (
    <PageLayout title="Script sandbox" icon={ShieldCheck}>
      <div className="space-y-6">
        {error && (
          <Alert variant="error">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert variant="success">
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>
              The global script-sandbox policy was updated. It applies to every
              script run cluster-wide, and connected satellites receive it
              immediately.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Global policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">
              This single policy hardens every user-authored script and shell
              run (health checks and automation actions) across all pods and
              satellites. It is secure by default: egress is denied until you
              add allow-list entries.
            </p>
            <div className="flex items-center gap-2">
              <Toggle
                checked={form.enabled}
                onCheckedChange={(enabled) => patch({ enabled })}
                aria-label="Sandbox enabled"
              />
              <span className="text-muted-foreground">
                Sandbox enabled (turn off to run scripts unsandboxed - not
                recommended)
              </span>
            </div>
            <div className="w-64">
              <Label htmlFor="on-unavailable">
                When a layer can&apos;t be enforced
              </Label>
              <Select
                value={form.onUnavailable}
                onValueChange={(v) =>
                  patch({ onUnavailable: v as SandboxFormState["onUnavailable"] })
                }
              >
                <SelectTrigger id="on-unavailable">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="degrade">
                    Degrade (drop to portable subset, surface it)
                  </SelectItem>
                  <SelectItem value="fail">
                    Fail (refuse to run the script)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Fail is the secure default: a script never runs with a layer
                missing. Choose Degrade only for hosts that cannot enforce a
                layer (then runs proceed under the portable subset, with the gap
                surfaced per run).
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Network egress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="w-64">
              <Label htmlFor="network-mode">Mode</Label>
              <Select
                value={form.networkMode}
                onValueChange={(v) =>
                  patch({ networkMode: v as SandboxFormState["networkMode"] })
                }
              >
                <SelectTrigger id="network-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deny">Deny (no egress)</SelectItem>
                  <SelectItem value="allowlist">
                    Allowlist (only listed destinations)
                  </SelectItem>
                  <SelectItem value="unrestricted">Unrestricted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.networkMode === "allowlist" && (
              <div>
                <Label htmlFor="allow-list">
                  Allowed destinations (one IP / CIDR per line)
                </Label>
                <Textarea
                  id="allow-list"
                  value={form.allowText}
                  onChange={(e) => patch({ allowText: e.target.value })}
                  placeholder={"203.0.113.0/24\n10.0.0.5"}
                  className="font-mono min-h-24"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Toggle
                checked={form.denyLinkLocalAndMetadata}
                onCheckedChange={(denyLinkLocalAndMetadata) =>
                  patch({ denyLinkLocalAndMetadata })
                }
                aria-label="Block link-local and metadata IPs"
              />
              <span className="text-muted-foreground">
                Always block link-local (169.254/16, fc00::/7) and cloud
                metadata IPs
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filesystem &amp; privilege</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="w-72">
              <Label htmlFor="fs-mode">Filesystem confinement</Label>
              <Select
                value={form.filesystemMode}
                onValueChange={(v) =>
                  patch({
                    filesystemMode: v as SandboxFormState["filesystemMode"],
                  })
                }
              >
                <SelectTrigger id="fs-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off (full host filesystem)</SelectItem>
                  <SelectItem value="scratch-only">
                    Scratch only (per-run dir + minimal read-only base)
                  </SelectItem>
                  <SelectItem value="scratch-plus-ro">
                    Scratch + read-only managed packages
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-72">
              <Label htmlFor="priv-mode">Privilege</Label>
              <Select
                value={form.privilegeMode}
                onValueChange={(v) =>
                  patch({
                    privilegeMode: v as SandboxFormState["privilegeMode"],
                  })
                }
              >
                <SelectTrigger id="priv-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">
                    Inherit (run as host process UID)
                  </SelectItem>
                  <SelectItem value="drop-to-uid">
                    Drop to dedicated low-privilege UID/GID
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resource caps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Leave a field blank to not cap that dimension. Memory / output /
              file-size are in MB.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="cpu">CPU seconds</Label>
                <Input
                  id="cpu"
                  type="number"
                  min={1}
                  value={form.cpuSeconds}
                  onChange={(e) => patch({ cpuSeconds: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mem">Memory (MB)</Label>
                <Input
                  id="mem"
                  type="number"
                  min={1}
                  value={form.memoryMb}
                  onChange={(e) => patch({ memoryMb: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="nofile">Max open files</Label>
                <Input
                  id="nofile"
                  type="number"
                  min={1}
                  value={form.maxOpenFiles}
                  onChange={(e) => patch({ maxOpenFiles: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="nproc">Max processes</Label>
                <Input
                  id="nproc"
                  type="number"
                  min={1}
                  value={form.maxProcesses}
                  onChange={(e) => patch({ maxProcesses: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="out">Max output (MB)</Label>
                <Input
                  id="out"
                  type="number"
                  min={1}
                  value={form.maxOutputMb}
                  onChange={(e) => patch({ maxOutputMb: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="fsize">Max file size (MB)</Label>
                <Input
                  id="fsize"
                  type="number"
                  min={1}
                  value={form.maxFileSizeMb}
                  onChange={(e) => patch({ maxFileSizeMb: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {validationError && (
          <p className="text-xs text-destructive">{validationError}</p>
        )}
        <Button
          type="button"
          onClick={handleSave}
          disabled={setMutation.isPending || validationError !== null}
        >
          {setMutation.isPending ? "Saving…" : "Save policy"}
        </Button>
      </div>
    </PageLayout>
  );
};

/**
 * Admin Settings -> Script Sandbox page. Edits the single, cluster-wide global
 * script-sandbox policy. Gated by the dedicated `script-sandbox.manage`
 * permission (distinct from `script-packages.manage`).
 */
export const SandboxSettingsPage = wrapInSuspense(SettingsContent);

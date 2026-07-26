import React, { useState } from "react";
import { useNavigate } from "react-router";
import {
  PageLayout,
  Alert,
  AlertIcon,
  AlertContent,
  Badge,
  Button,
  ConfirmationModal,
  useToast,
  toastError,
  toastSuccess,
  formatBytes,
} from "@checkstack/ui";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { extractErrorMessage, resolveRoute } from "@checkstack/common";
import {
  PluginManagerApi,
  pluginManagerAccess,
  pluginManagerRoutes,
  type PluginSource,
  type InstallPreview,
} from "@checkstack/pluginmanager-common";
import { ShieldAlert, Plus } from "lucide-react";
import { SourceForm } from "../components/SourceForm";

const InstallPluginPageContent: React.FC = () => {
  const client = usePluginClient(PluginManagerApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const navigate = useNavigate();
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    pluginManagerAccess.install,
  );

  const [pendingSource, setPendingSource] = useState<PluginSource | undefined>();
  const [preview, setPreview] = useState<InstallPreview | undefined>();
  const [previewError, setPreviewError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewMutation = client.previewInstall.useMutation({
    onSuccess: (result) => {
      setPreview(result);
      setPreviewError(undefined);
      setConfirmOpen(true);
    },
    onError: (error) => {
      setPreview(undefined);
      setPreviewError(extractErrorMessage(error, "Preview failed"));
    },
  });

  const installMutation = client.install.useMutation({
    onSuccess: ({ installedPackages }) => {
      toastSuccess(
        toast,
        `Installed ${installedPackages.length} package${
          installedPackages.length === 1 ? "" : "s"
        }`,
      );
      setConfirmOpen(false);
      setPreview(undefined);
      setPendingSource(undefined);
      navigate(resolveRoute(pluginManagerRoutes.routes.installed));
    },
    onError: (error) => toastError(toast, "Failed to install plugin", error),
  });

  const handleSourceSubmit = (source: PluginSource) => {
    setPendingSource(source);
    previewMutation.mutate({ source });
  };

  const compatibilityIssues = preview?.compatibilityIssues ?? [];
  const blockable = compatibilityIssues.length > 0;

  return (
    <PageLayout
      title="Install plugin"
      icon={Plus}
      loading={accessLoading}
      allowed={allowed}
    >
      <Alert variant="warning">
        <AlertIcon>
          <ShieldAlert className="h-5 w-5" aria-hidden />
        </AlertIcon>
        <AlertContent className="text-sm text-foreground">
          <strong>Plugins run with full platform access.</strong> They can read
          and write any data, including secrets. Only install plugins from
          sources you trust. Malicious plugins can exfiltrate sensitive data and
          damage your platform.
        </AlertContent>
      </Alert>

      <div className="mt-6 rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
        <h2 className="text-sm font-semibold text-foreground">Source</h2>
        <div className="mt-4">
          <SourceForm
            onSubmit={handleSourceSubmit}
            isLoading={previewMutation.isPending}
          />
          {previewError ? (
            <p className="text-destructive text-sm mt-3">{previewError}</p>
          ) : undefined}
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmOpen && !!preview}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (!pendingSource || !preview) return;
          installMutation.mutate({
            source: pendingSource,
            confirm: preview.primary.name,
          });
        }}
        title={
          preview
            ? `Install ${preview.primary.name}@${preview.primary.version}`
            : "Install"
        }
        confirmPhrase={preview?.primary.name ?? "INSTALL"}
        confirmText={
          blockable ? "Compatibility issues - fix first" : "Install"
        }
        variant="warning"
        isLoading={installMutation.isPending}
        message={
          preview ? <InstallDescription preview={preview} /> : "Loading…"
        }
      />
    </PageLayout>
  );
};

const InstallDescription: React.FC<{ preview: InstallPreview }> = ({
  preview,
}) => {
  const compatibilityIssues = preview.compatibilityIssues;
  const author =
    typeof preview.primary.author === "string"
      ? preview.primary.author
      : preview.primary.author.name;

  return (
    <div className="space-y-3">
      <p>{preview.primary.description}</p>
      <div className="text-xs text-muted-foreground space-y-1">
        <div>
          <strong>Author:</strong> {author}
        </div>
        <div>
          <strong>License:</strong> {preview.primary.license}
        </div>
        {preview.primary.homepage ? (
          <div>
            <strong>Homepage:</strong>{" "}
            <a
              href={preview.primary.homepage}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {preview.primary.homepage}
            </a>
          </div>
        ) : undefined}
      </div>
      {preview.packages.length > 1 ? (
        <div className="space-y-1">
          <strong className="text-sm">Bundle:</strong>
          <div className="flex flex-wrap gap-1">
            {preview.packages.map((p) => (
              <Badge key={p.name} variant="secondary">
                {p.name}@{p.version}
              </Badge>
            ))}
          </div>
        </div>
      ) : undefined}
      <div className="text-xs text-muted-foreground">
        Total size: {formatBytes(preview.totalSizeBytes)}
      </div>
      {preview.hasInstallScripts ? (
        <Alert variant="warning">
          <p className="text-sm">
            This plugin opted in to running install scripts (
            <code>postinstall</code> etc.). These run with platform privileges.
            Confirm only if you trust this source.
          </p>
        </Alert>
      ) : undefined}
      {preview.primary.checkstack.usageInstructions ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Usage instructions
          </summary>
          <pre className="whitespace-pre-wrap mt-2 p-3 bg-surface-inset rounded text-xs">
            {preview.primary.checkstack.usageInstructions}
          </pre>
        </details>
      ) : undefined}
      {compatibilityIssues.length > 0 ? (
        <Alert variant="error">
          <div className="text-sm">
            <strong>Compatibility issues - install will fail:</strong>
            <ul className="list-disc pl-5 mt-1">
              {compatibilityIssues.map((iss, i) => (
                <li key={i}>{iss.message}</li>
              ))}
            </ul>
          </div>
        </Alert>
      ) : undefined}
      <p className="text-sm">
        Type <code>{preview.primary.name}</code> to confirm install.
      </p>
    </div>
  );
};

void Button; // imported for future per-issue action buttons

export const InstallPluginPage = wrapInSuspense(InstallPluginPageContent);

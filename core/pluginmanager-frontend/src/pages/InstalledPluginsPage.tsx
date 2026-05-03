import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Puzzle, Trash2, Plus, History } from "lucide-react";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Checkbox,
  Label,
  useToast,
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
  type InstalledPlugin,
} from "@checkstack/pluginmanager-common";
import { TypedConfirmModal } from "../components/TypedConfirmModal";

const InstalledPluginsPageContent: React.FC = () => {
  const client = usePluginClient(PluginManagerApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const view = accessApi.useAccess(pluginManagerAccess.view);
  const uninstallAccess = accessApi.useAccess(pluginManagerAccess.uninstall);

  const { data, isLoading, refetch } = client.list.useQuery();

  const [target, setTarget] = useState<InstalledPlugin | undefined>();
  const [deleteSchema, setDeleteSchema] = useState(true);
  const [deleteConfigs, setDeleteConfigs] = useState(true);
  const [cascade, setCascade] = useState(false);

  const previewQuery = client.previewUninstall.useQuery(
    { pluginName: target?.name ?? "" },
    { enabled: !!target },
  );

  const uninstallMutation = client.uninstall.useMutation({
    onSuccess: ({ uninstalledPackages }) => {
      toast.success(
        `Uninstalled ${uninstalledPackages.length} package${
          uninstalledPackages.length === 1 ? "" : "s"
        }`,
      );
      setTarget(undefined);
      refetch();
    },
    onError: (error) =>
      toast.error(extractErrorMessage(error, "Uninstall failed")),
  });

  const installPath = resolveRoute(pluginManagerRoutes.routes.install);
  const eventsPath = resolveRoute(pluginManagerRoutes.routes.events);

  const headerActions = (
    <div className="flex gap-2">
      <Button asChild variant="ghost">
        <Link to={eventsPath}>
          <History className="w-4 h-4 mr-2" />
          Events
        </Link>
      </Button>
      <Button asChild>
        <Link to={installPath}>
          <Plus className="w-4 h-4 mr-2" />
          Install plugin
        </Link>
      </Button>
    </div>
  );

  if (view.loading || isLoading) {
    return (
      <PageLayout
        title="Plugins"
        icon={Puzzle}
        actions={headerActions}
        loading
        allowed={view.allowed}
      >
        <div />
      </PageLayout>
    );
  }

  const plugins = data?.plugins ?? [];

  return (
    <PageLayout
      title="Plugins"
      icon={Puzzle}
      actions={headerActions}
      allowed={view.allowed}
    >
      <Card>
        <CardHeader>
          <CardTitle>Installed Plugins</CardTitle>
          <CardDescription>
            Plugins running on this Checkstack instance. Runtime-installed
            plugins (npm, GitHub release, tarball upload) can be uninstalled
            from this page; bundled platform plugins are read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plugins.length === 0 ? (
            <EmptyState
              title="No plugins"
              description="No plugins discovered yet."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plugins.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-mono">{p.name}</TableCell>
                    <TableCell>{p.version || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={typeBadgeVariant(p.type)}>{p.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {p.source ? (
                        <Badge variant="info">{p.source.type}</Badge>
                      ) : (
                        <Badge variant="secondary">monorepo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.isUninstallable ? (
                        <Badge variant="info">runtime</Badge>
                      ) : (
                        <Badge variant="secondary">core</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.isUninstallable && uninstallAccess.allowed ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setTarget(p)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Uninstall
                        </Button>
                      ) : undefined}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TypedConfirmModal
        isOpen={!!target}
        onClose={() => setTarget(undefined)}
        onConfirm={() => {
          if (!target) return;
          uninstallMutation.mutate({
            pluginName: target.name,
            deleteSchema,
            deleteConfigs,
            cascade,
            confirm: target.name,
          });
        }}
        title={`Uninstall ${target?.name}`}
        confirmPhrase={target?.name ?? ""}
        confirmLabel="Uninstall"
        variant="danger"
        isLoading={uninstallMutation.isPending}
        description={
          target ? (
            <UninstallDescription
              target={target}
              preview={previewQuery.data}
              deleteSchema={deleteSchema}
              setDeleteSchema={setDeleteSchema}
              deleteConfigs={deleteConfigs}
              setDeleteConfigs={setDeleteConfigs}
              cascade={cascade}
              setCascade={setCascade}
            />
          ) : (
            ""
          )
        }
      />
    </PageLayout>
  );
};

function typeBadgeVariant(type: string): "default" | "secondary" | "info" {
  switch (type) {
    case "backend": {
      return "default";
    }
    case "frontend": {
      return "info";
    }
    default: {
      return "secondary";
    }
  }
}

const UninstallDescription: React.FC<{
  target: InstalledPlugin;
  preview:
    | {
        siblings: string[];
        dependents: string[];
        schemasToDrop: string[];
        pluginConfigCount: number;
      }
    | undefined;
  deleteSchema: boolean;
  setDeleteSchema: (v: boolean) => void;
  deleteConfigs: boolean;
  setDeleteConfigs: (v: boolean) => void;
  cascade: boolean;
  setCascade: (v: boolean) => void;
}> = ({
  target,
  preview,
  deleteSchema,
  setDeleteSchema,
  deleteConfigs,
  setDeleteConfigs,
  cascade,
  setCascade,
}) => (
  <>
    <p>
      Uninstalling <code>{target.name}</code> stops the plugin on every
      instance and deletes its data on this instance.
    </p>
    {preview ? (
      <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
        {preview.siblings.length > 1 ? (
          <li>
            Bundle siblings will also be uninstalled:{" "}
            <code>{preview.siblings.join(", ")}</code>
          </li>
        ) : undefined}
        {preview.dependents.length > 0 ? (
          <li className="text-warning">
            Dependent plugins:{" "}
            <code>{preview.dependents.join(", ")}</code> — enable cascade
            below to remove them too.
          </li>
        ) : undefined}
        <li>Will drop {preview.schemasToDrop.length} Postgres schema(s).</li>
        <li>Will delete {preview.pluginConfigCount} plugin_configs row(s).</li>
      </ul>
    ) : undefined}

    <div className="space-y-2 pt-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="del-schema"
          checked={deleteSchema}
          onCheckedChange={setDeleteSchema}
        />
        <Label htmlFor="del-schema">
          Drop Postgres schema(s) (destructive)
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="del-configs"
          checked={deleteConfigs}
          onCheckedChange={setDeleteConfigs}
        />
        <Label htmlFor="del-configs">
          Delete plugin configurations (destructive)
        </Label>
      </div>
      {preview && preview.dependents.length > 0 ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id="cascade"
            checked={cascade}
            onCheckedChange={setCascade}
          />
          <Label htmlFor="cascade">Cascade — also uninstall dependents</Label>
        </div>
      ) : undefined}
    </div>
  </>
);

export const InstalledPluginsPage = wrapInSuspense(
  InstalledPluginsPageContent,
);

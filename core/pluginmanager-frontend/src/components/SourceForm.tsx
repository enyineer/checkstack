import React, { useState } from "react";
import { Tabs, Input, Label, Button, Badge } from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";
import type { PluginSource } from "@checkstack/pluginmanager-common";

interface Props {
  onSubmit: (source: PluginSource) => void;
  isLoading?: boolean;
}

/**
 * Source picker — NPM / Tarball Upload / GitHub / Catalog (coming soon).
 *
 * Catalog tab is intentionally disabled until the catalog backend ships.
 * Tarball upload posts to the multipart endpoint at
 * `/api/pluginmanager/upload-tarball` which stores the bytes in
 * `plugin_artifacts` and returns an `artifactId` we wrap in a
 * `tarball` PluginSource.
 */
export const SourceForm: React.FC<Props> = ({ onSubmit, isLoading }) => {
  const [tab, setTab] = useState<"npm" | "tarball" | "github" | "catalog">(
    "npm",
  );

  const [npmName, setNpmName] = useState("");
  const [npmVersion, setNpmVersion] = useState("");
  const [npmRegistry, setNpmRegistry] = useState("");

  const [file, setFile] = useState<File | undefined>();
  const [tarballUploading, setTarballUploading] = useState(false);
  const [tarballError, setTarballError] = useState<string | undefined>();

  const [ghOwner, setGhOwner] = useState("");
  const [ghRepo, setGhRepo] = useState("");
  const [ghTag, setGhTag] = useState("");
  const [ghAsset, setGhAsset] = useState("");
  const [ghApiBaseUrl, setGhApiBaseUrl] = useState("");
  const [ghTokenEnvVar, setGhTokenEnvVar] = useState("");

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { id: "npm", label: "NPM" },
          { id: "tarball", label: "Tarball Upload" },
          { id: "github", label: "GitHub Release" },
          { id: "catalog", label: "Catalog (Coming Soon)" },
        ]}
        activeTab={tab}
        onTabChange={(id) => {
          if (id !== "catalog") setTab(id as typeof tab);
        }}
      />

      {tab === "npm" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="npm-name">Package name</Label>
            <Input
              id="npm-name"
              placeholder="@scope/my-plugin-backend"
              value={npmName}
              onChange={(e) => setNpmName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="npm-version">Version (optional)</Label>
            <Input
              id="npm-version"
              placeholder="latest"
              value={npmVersion}
              onChange={(e) => setNpmVersion(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="npm-registry">Registry URL (optional)</Label>
            <Input
              id="npm-registry"
              placeholder="https://registry.npmjs.org"
              value={npmRegistry}
              onChange={(e) => setNpmRegistry(e.target.value)}
            />
          </div>
          <Button
            disabled={!npmName || isLoading}
            onClick={() =>
              onSubmit({
                type: "npm",
                packageName: npmName,
                version: npmVersion || undefined,
                registry: npmRegistry || undefined,
              })
            }
          >
            Preview install
          </Button>
        </div>
      ) : undefined}

      {tab === "tarball" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="tarball-file">Tarball (.tgz)</Label>
            <Input
              id="tarball-file"
              type="file"
              accept=".tgz,.tar.gz"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">
              Pack with <code>bunx @checkstack/scripts plugin-pack</code>.
            </p>
          </div>
          {tarballError ? (
            <p className="text-sm text-destructive">{tarballError}</p>
          ) : undefined}
          <Button
            disabled={!file || tarballUploading || isLoading}
            onClick={async () => {
              if (!file) return;
              setTarballUploading(true);
              setTarballError(undefined);
              try {
                const fd = new FormData();
                fd.append("file", file);
                const resp = await fetch(
                  "/api/pluginmanager/upload-tarball",
                  { method: "POST", body: fd },
                );
                if (!resp.ok) throw new Error(await resp.text());
                const { artifactId } = (await resp.json()) as {
                  artifactId: string;
                };
                onSubmit({
                  type: "tarball",
                  artifactId,
                  filename: file.name,
                });
              } catch (error) {
                setTarballError(extractErrorMessage(error));
              } finally {
                setTarballUploading(false);
              }
            }}
          >
            {tarballUploading ? "Uploading..." : "Upload & preview"}
          </Button>
        </div>
      ) : undefined}

      {tab === "github" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="gh-owner">Owner</Label>
              <Input
                id="gh-owner"
                placeholder="my-org"
                value={ghOwner}
                onChange={(e) => setGhOwner(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gh-repo">Repo</Label>
              <Input
                id="gh-repo"
                placeholder="my-plugin"
                value={ghRepo}
                onChange={(e) => setGhRepo(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gh-tag">Release tag</Label>
            <Input
              id="gh-tag"
              placeholder="v1.2.3"
              value={ghTag}
              onChange={(e) => setGhTag(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gh-asset">Asset name (optional)</Label>
            <Input
              id="gh-asset"
              placeholder="my-plugin-1.2.3.tgz"
              value={ghAsset}
              onChange={(e) => setGhAsset(e.target.value)}
            />
          </div>
          <details className="rounded border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              GitHub Enterprise (advanced)
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="gh-api-base">API base URL</Label>
                <Input
                  id="gh-api-base"
                  placeholder="https://github.example.com/api/v3"
                  value={ghApiBaseUrl}
                  onChange={(e) => setGhApiBaseUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for public github.com. For GitHub Enterprise,
                  use your instance's API root.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gh-token-env">Token env var name</Label>
                <Input
                  id="gh-token-env"
                  placeholder="GITHUB_TOKEN"
                  value={ghTokenEnvVar}
                  onChange={(e) => setGhTokenEnvVar(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The platform reads the PAT from this environment variable.
                  Defaults to <code>GITHUB_TOKEN</code>.
                </p>
              </div>
            </div>
          </details>
          <Button
            disabled={!ghOwner || !ghRepo || !ghTag || isLoading}
            onClick={() =>
              onSubmit({
                type: "github",
                owner: ghOwner,
                repo: ghRepo,
                tag: ghTag,
                assetName: ghAsset || undefined,
                apiBaseUrl: ghApiBaseUrl || undefined,
                tokenEnvVar: ghTokenEnvVar || undefined,
              })
            }
          >
            Preview install
          </Button>
        </div>
      ) : undefined}

      {tab === "catalog" ? (
        <div>
          <p className="text-sm text-muted-foreground">
            <Badge variant="secondary" className="mr-2">
              Coming Soon
            </Badge>
            The Checkstack plugin catalog is coming soon.
          </p>
        </div>
      ) : undefined}
    </div>
  );
};

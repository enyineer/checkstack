import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  PageLayout,
  Button,
  Card,
  Input,
  Label,
  Textarea,
  Toggle,
  Checkbox,
  Badge,
  LoadingSpinner,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useToast,
  QueryErrorState,
} from "@checkstack/ui";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Trash2,
  Plus,
  Save,
  Send,
  EyeOff,
  MonitorCheck,
} from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { useInitOnceForKey } from "@checkstack/ui";
import { resolveRoute, extractErrorMessage } from "@checkstack/common";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  StatusPageApi,
  statusPageRoutes,
  statusPublicRoutes,
  BUILTIN_WIDGET_IDS,
  type StatusPageBlock,
  type StatusPageVisibility,
} from "@checkstack/status-page-common";
import { BlockRenderer } from "../renderers";

/** Minimal default config per widget type (matches the config schemas). */
function defaultConfig(type: string): unknown {
  switch (type) {
    case BUILTIN_WIDGET_IDS.banner: {
      return { systemIds: [] };
    }
    case BUILTIN_WIDGET_IDS.systemHealth: {
      return { items: [], showUptime: false };
    }
    case BUILTIN_WIDGET_IDS.groupStatus: {
      return { groupId: "" };
    }
    case BUILTIN_WIDGET_IDS.uptime: {
      return { systemId: "", days: 90 };
    }
    case BUILTIN_WIDGET_IDS.incidents:
    case BUILTIN_WIDGET_IDS.maintenance: {
      return { systemIds: [], limit: 5 };
    }
    case BUILTIN_WIDGET_IDS.text: {
      return { markdown: "" };
    }
    case BUILTIN_WIDGET_IDS.heading: {
      return { text: "", level: 2 };
    }
    case BUILTIN_WIDGET_IDS.links: {
      return { links: [] };
    }
    case BUILTIN_WIDGET_IDS.image: {
      return { url: "" };
    }
    default: {
      return {};
    }
  }
}

type SystemOption = { id: string; name: string };
type GroupOption = { id: string; name: string };

/** Searchable, counted multi-select of systems. */
const SystemMultiSelect: React.FC<{
  systems: SystemOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}> = ({ systems, selected, onChange }) => {
  const [query, setQuery] = useState("");
  const set = new Set(selected);
  const filtered = query
    ? systems.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    : systems;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange([...next]);
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search systems…"
          className="h-8"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {selected.length} selected
        </span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {systems.length === 0 ? (
          <p className="text-xs text-muted-foreground">No systems available.</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">No matches.</p>
        ) : (
          filtered.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                checked={set.has(s.id)}
                onCheckedChange={(c) => toggle(s.id, Boolean(c))}
              />
              {s.name}
            </label>
          ))
        )}
      </div>
    </div>
  );
};

/** Inline editor for a list of labelled links (the links widget config). */
const LinksConfigEditor: React.FC<{
  links: Array<{ label: string; url: string }>;
  onChange: (links: Array<{ label: string; url: string }>) => void;
}> = ({ links, onChange }) => {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-2">
      {links.length > 0 && (
        <ul className="space-y-1">
          {links.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {l.label} <span className="text-muted-foreground">{l.url}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(links.filter((_, j) => j !== i))}
                aria-label="Remove link"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <Button
          variant="outline"
          size="sm"
          disabled={!label.trim() || !url.trim()}
          onClick={() => {
            onChange([...links, { label: label.trim(), url: url.trim() }]);
            setLabel("");
            setUrl("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
};

const BlockConfigEditor: React.FC<{
  block: StatusPageBlock;
  systems: SystemOption[];
  groups: GroupOption[];
  onChange: (config: unknown) => void;
}> = ({ block, systems, groups, onChange }) => {
  const config = (block.config ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  switch (block.type) {
    case BUILTIN_WIDGET_IDS.banner:
    case BUILTIN_WIDGET_IDS.incidents:
    case BUILTIN_WIDGET_IDS.maintenance: {
      return (
        <SystemMultiSelect
          systems={systems}
          selected={(config.systemIds as string[]) ?? []}
          onChange={(ids) => set({ systemIds: ids })}
        />
      );
    }
    case BUILTIN_WIDGET_IDS.systemHealth: {
      const items = (config.items as Array<{ systemId: string }>) ?? [];
      return (
        <div className="space-y-2">
          <SystemMultiSelect
            systems={systems}
            selected={items.map((i) => i.systemId)}
            onChange={(ids) => set({ items: ids.map((systemId) => ({ systemId })) })}
          />
          <label className="flex items-center gap-2 text-sm">
            <Toggle
              checked={Boolean(config.showUptime)}
              onCheckedChange={(v) => set({ showUptime: v })}
            />
            Show uptime %
          </label>
        </div>
      );
    }
    case BUILTIN_WIDGET_IDS.uptime: {
      return (
        <div className="space-y-2">
          <Select
            value={(config.systemId as string) || ""}
            onValueChange={(v) => set({ systemId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a system" />
            </SelectTrigger>
            <SelectContent>
              {systems.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Days</Label>
            <Input
              type="number"
              className="w-24"
              value={Number(config.days ?? 90)}
              onChange={(e) =>
                set({ days: Math.min(90, Math.max(1, Number(e.target.value) || 90)) })
              }
            />
          </div>
        </div>
      );
    }
    case BUILTIN_WIDGET_IDS.text: {
      return (
        <Textarea
          value={(config.markdown as string) ?? ""}
          onChange={(e) => set({ markdown: e.target.value })}
          placeholder="Markdown text…"
          rows={4}
        />
      );
    }
    case BUILTIN_WIDGET_IDS.heading: {
      return (
        <div className="flex gap-2">
          <Input
            value={(config.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Heading text"
          />
          <Select
            value={String(config.level ?? 2)}
            onValueChange={(v) => set({ level: Number(v) })}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">H1</SelectItem>
              <SelectItem value="2">H2</SelectItem>
              <SelectItem value="3">H3</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    }
    case BUILTIN_WIDGET_IDS.image: {
      return (
        <div className="space-y-2">
          <Input
            value={(config.url as string) ?? ""}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://…/logo.png"
          />
          <Input
            value={(config.alt as string) ?? ""}
            onChange={(e) => set({ alt: e.target.value })}
            placeholder="Alt text"
          />
        </div>
      );
    }
    case BUILTIN_WIDGET_IDS.groupStatus: {
      return (
        <Select
          value={(config.groupId as string) || ""}
          onValueChange={(v) => set({ groupId: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a group" />
          </SelectTrigger>
          <SelectContent>
            {groups.length === 0 ? (
              <SelectItem value="_none" disabled>
                No groups available
              </SelectItem>
            ) : (
              groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      );
    }
    case BUILTIN_WIDGET_IDS.links: {
      const links =
        (config.links as Array<{ label: string; url: string }>) ?? [];
      return (
        <LinksConfigEditor links={links} onChange={(l) => set({ links: l })} />
      );
    }
    case BUILTIN_WIDGET_IDS.divider: {
      return <p className="text-xs text-muted-foreground">A horizontal divider.</p>;
    }
    default: {
      return (
        <p className="text-xs text-muted-foreground">
          No inline editor for this widget yet.
        </p>
      );
    }
  }
};

export const StatusPageBuilderPage: React.FC = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const client = usePluginClient(StatusPageApi);
  const catalog = usePluginClient(CatalogApi);

  const {
    data: page,
    isLoading,
    isError,
    error,
    refetch,
  } = client.getStatusPage.useQuery({ id }, { gcTime: 0 });
  const { data: widgetTypesData } = client.listWidgetTypes.useQuery({});
  const { data: systemsData } = catalog.getSystems.useQuery({});
  const { data: groupsData } = catalog.getGroups.useQuery({});
  const systems: SystemOption[] = systemsData?.systems ?? [];
  const groups: GroupOption[] = groupsData ?? [];
  const widgetTypes = widgetTypesData?.widgetTypes ?? [];

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<StatusPageVisibility>("public");
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [blocks, setBlocks] = useState<StatusPageBlock[]>([]);
  const [addType, setAddType] = useState("");

  useInitOnceForKey(page ?? undefined, page?.id, (p) => {
    setTitle(p.title);
    setSlug(p.slug);
    setVisibility(p.visibility);
    setBrandColor(p.theme.brandColorHsl ?? "");
    setLogoUrl(p.theme.logoUrl ?? "");
    setBlocks(p.draftLayout);
  });

  const updateMutation = client.updateStatusPage.useMutation();
  const publishMutation = client.publishStatusPage.useMutation();
  const unpublishMutation = client.unpublishStatusPage.useMutation();
  const busy =
    updateMutation.isPending ||
    publishMutation.isPending ||
    unpublishMutation.isPending;

  // Dirty = local edits diverge from the loaded snapshot. Drives the unsaved
  // guard + Save/Publish enablement (there is no autosave).
  const dirty = page
    ? JSON.stringify([title, slug, visibility, brandColor, logoUrl, blocks]) !==
      JSON.stringify([
        page.title,
        page.slug,
        page.visibility,
        page.theme.brandColorHsl ?? "",
        page.theme.logoUrl ?? "",
        page.draftLayout,
      ])
    : false;

  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const buildPatch = () => ({
    id,
    title,
    slug,
    visibility,
    theme: {
      mode: "auto" as const,
      ...(brandColor ? { brandColorHsl: brandColor } : {}),
      ...(logoUrl ? { logoUrl } : {}),
    },
    draftLayout: blocks,
  });

  const save = async () => {
    try {
      await updateMutation.mutateAsync(buildPatch());
      toast.success("Saved");
    } catch (error) {
      toast.error(extractErrorMessage(error, "Couldn't save"));
    }
  };

  const publish = async () => {
    // Publish always snapshots the current draft first, so save then publish —
    // and if only the publish leg fails, say the save DID land.
    try {
      await updateMutation.mutateAsync(buildPatch());
    } catch (error) {
      toast.error(extractErrorMessage(error, "Couldn't save"));
      return;
    }
    try {
      await publishMutation.mutateAsync({ id });
      toast.success("Published");
    } catch (error) {
      toast.error(extractErrorMessage(error, "Saved, but couldn't publish"));
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...blocks];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  };

  const addBlock = () => {
    if (!addType) return;
    setBlocks([
      ...blocks,
      { id: crypto.randomUUID(), type: addType, config: defaultConfig(addType) },
    ]);
    setAddType("");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }
  if (isError) {
    return (
      <PageLayout title="Status page" icon={MonitorCheck}>
        <QueryErrorState error={error} onRetry={() => void refetch()} />
      </PageLayout>
    );
  }
  if (!page) {
    return (
      <PageLayout title="Status page" icon={MonitorCheck}>
        <p className="text-sm text-muted-foreground">
          This status page no longer exists.
        </p>
      </PageLayout>
    );
  }

  const goBack = () => {
    if (
      !dirty ||
      globalThis.confirm("You have unsaved changes. Discard them and leave?")
    ) {
      navigate(resolveRoute(statusPageRoutes.routes.list));
    }
  };

  return (
    <PageLayout
      title={title || "Status page"}
      icon={MonitorCheck}
      subtitle={
        page.published
          ? `Published${page.publishedAt ? ` · ${new Date(page.publishedAt).toLocaleString()}` : ""}${dirty ? " · unsaved changes" : ""}`
          : dirty
            ? "Draft · unsaved changes"
            : "Draft · not yet public"
      }
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
          {page.published && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unpublishMutation.mutate({ id })}
              disabled={busy}
            >
              <EyeOff className="mr-1.5 h-4 w-4" /> Unpublish
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={save}
            disabled={busy || !dirty}
          >
            <Save className="mr-1.5 h-4 w-4" /> Save draft
          </Button>
          <Button size="sm" onClick={publish} disabled={busy}>
            <Send className="mr-1.5 h-4 w-4" />{" "}
            {page.published ? "Publish changes" : "Publish"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        {/* Builder */}
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            <strong>Save draft</strong> stores your changes privately.{" "}
            <strong>Publish</strong> makes the current draft public at{" "}
            <code>/status/{slug || "your-slug"}</code>.
          </p>
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Visibility</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as StatusPageVisibility)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public (anyone)</SelectItem>
                    <SelectItem value="authenticated">
                      Internal (signed-in users)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Brand color (HSL)</Label>
                <Input
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="262 83% 58%"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Logo URL</Label>
                <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              </div>
            </div>
          </Card>

          {blocks.map((block, i) => {
            const descriptor = widgetTypes.find((w) => w.id === block.type);
            return (
              <Card key={block.id} className="space-y-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {descriptor?.displayName ?? block.type}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => move(i, 1)} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setBlocks(blocks.filter((b) => b.id !== block.id))}
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <Input
                  value={block.label ?? ""}
                  onChange={(e) =>
                    setBlocks(
                      blocks.map((b) =>
                        b.id === block.id
                          ? { ...b, label: e.target.value || undefined }
                          : b,
                      ),
                    )
                  }
                  placeholder="Block heading (optional)"
                />
                <BlockConfigEditor
                  block={block}
                  systems={systems}
                  groups={groups}
                  onChange={(config) =>
                    setBlocks(
                      blocks.map((b) => (b.id === block.id ? { ...b, config } : b)),
                    )
                  }
                />
              </Card>
            );
          })}

          <Card className="flex items-center gap-2 border-dashed p-3">
            <Select value={addType} onValueChange={setAddType}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Add a block…" />
              </SelectTrigger>
              <SelectContent>
                {widgetTypes.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={addBlock} disabled={!addType}>
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </Card>
        </div>

        {/* Preview (structural; status widgets show live data on the public page) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Preview</span>
            <Badge variant="outline">structural</Badge>
          </div>
          <div className="space-y-3 rounded-lg border bg-card p-4">
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add blocks to build your page.
              </p>
            ) : (
              blocks.map((b) => (
                <PreviewBlock key={b.id} block={b} />
              ))
            )}
          </div>
          {page.published && (
            <a
              href={resolveRoute(statusPublicRoutes.routes.page, { slug: page.slug })}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Open published page →
            </a>
          )}
        </div>
      </div>
    </PageLayout>
  );
};

/**
 * Structural preview: content widgets render from config (their config IS their
 * DTO); status widgets show a labelled placeholder (live data appears on the
 * published page, which resolves through the secure public endpoint).
 */
const PreviewBlock: React.FC<{ block: StatusPageBlock }> = ({ block }) => {
  const content = new Set<string>([
    BUILTIN_WIDGET_IDS.text,
    BUILTIN_WIDGET_IDS.heading,
    BUILTIN_WIDGET_IDS.links,
    BUILTIN_WIDGET_IDS.image,
    BUILTIN_WIDGET_IDS.divider,
  ]);
  if (content.has(block.type)) {
    return (
      <BlockRenderer block={{ id: block.id, type: block.type, label: block.label, data: block.config }} />
    );
  }
  return (
    <Card className="p-3 text-sm text-muted-foreground">
      {block.label ?? block.type.replace("statuspage.", "")} (live on published page)
    </Card>
  );
};

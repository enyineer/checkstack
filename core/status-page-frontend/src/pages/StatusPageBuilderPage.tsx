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
  Badge,
  LoadingSpinner,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useToast,
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

/** Checklist multi-select of systems (functional v1; a combobox is a follow-up). */
const SystemMultiSelect: React.FC<{
  systems: SystemOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}> = ({ systems, selected, onChange }) => {
  const set = new Set(selected);
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {systems.length === 0 && (
        <p className="text-xs text-muted-foreground">No systems available.</p>
      )}
      {systems.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={set.has(s.id)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(s.id);
              else next.delete(s.id);
              onChange([...next]);
            }}
          />
          {s.name}
        </label>
      ))}
    </div>
  );
};

const BlockConfigEditor: React.FC<{
  block: StatusPageBlock;
  systems: SystemOption[];
  onChange: (config: unknown) => void;
}> = ({ block, systems, onChange }) => {
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

  const { data: page, isLoading } = client.getStatusPage.useQuery(
    { id },
    { gcTime: 0 },
  );
  const { data: widgetTypesData } = client.listWidgetTypes.useQuery({});
  const { data: systemsData } = catalog.getSystems.useQuery({});
  const systems: SystemOption[] = systemsData?.systems ?? [];
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
    try {
      await updateMutation.mutateAsync(buildPatch());
      await publishMutation.mutateAsync({ id });
      toast.success("Published");
    } catch (error) {
      toast.error(extractErrorMessage(error, "Couldn't publish"));
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
  if (!page) {
    return (
      <PageLayout title="Status page" icon={MonitorCheck}>
        Not found.
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={title || "Status page"}
      icon={MonitorCheck}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(resolveRoute(statusPageRoutes.routes.list))}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
          {page.published && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => unpublishMutation.mutate({ id })}
            >
              <EyeOff className="mr-1.5 h-4 w-4" /> Unpublish
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={save} disabled={updateMutation.isPending}>
            <Save className="mr-1.5 h-4 w-4" /> Save
          </Button>
          <Button size="sm" onClick={publish} disabled={publishMutation.isPending}>
            <Send className="mr-1.5 h-4 w-4" /> Publish
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        {/* Builder */}
        <div className="space-y-4">
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

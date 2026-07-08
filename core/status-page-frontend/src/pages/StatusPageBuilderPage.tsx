import React, { useState, useEffect } from "react";
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
  toastSuccess,
  toastError,
  QueryErrorState,
  ConfirmationModal,
  SystemMultiSelect,
  Checkbox,
  cn,
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
  Globe,
  Copy,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { useInitOnceForKey } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  StatusPageApi,
  statusPageRoutes,
  statusPublicRoutes,
  BUILTIN_WIDGET_IDS,
  DEFAULT_EMAIL_SUBSCRIBERS_HOURLY_QUOTA,
  EMAIL_SUBSCRIBERS_HOURLY_QUOTA_MAX,
  type StatusPageBlock,
  type StatusPageVisibility,
  type CustomDomainInfo,
} from "@checkstack/status-page-common";
import { BlockRenderer, useStatusWidgetRenderers } from "../renderers";

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
      return { groupId: "", collapseWhenHealthy: false };
    }
    case BUILTIN_WIDGET_IDS.uptime: {
      return { systemId: "", days: 90 };
    }
    case BUILTIN_WIDGET_IDS.incidents:
    case BUILTIN_WIDGET_IDS.maintenance: {
      return {
        systemIds: [],
        groupIds: [],
        excludedSystemIds: [],
        limit: 5,
        showUpdates: true,
        maxUpdates: 3,
        includePast: false,
        pastMaxAgeDays: 7,
      };
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
type GroupOption = { id: string; name: string; systemIds: string[] };

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

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** Shared config controls for the event-feed widgets (incidents, maintenance). */
const EventFeedControls: React.FC<{
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}> = ({ config, set }) => {
  const showUpdates = config.showUpdates !== false;
  const includePast = Boolean(config.includePast);
  return (
    <div className="space-y-2.5 border-t pt-3">
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>Show updates</span>
        <Toggle
          checked={showUpdates}
          onCheckedChange={(v) => set({ showUpdates: v })}
        />
      </label>
      {showUpdates && (
        <div className="flex items-center justify-between gap-2">
          <Label
            htmlFor="event-feed-max-updates"
            className="text-xs text-muted-foreground"
          >
            Max updates per item
          </Label>
          <Input
            id="event-feed-max-updates"
            type="number"
            className="h-8 w-20"
            value={Number(config.maxUpdates ?? 3)}
            onChange={(e) =>
              set({ maxUpdates: clamp(Number(e.target.value) || 3, 1, 10) })
            }
          />
        </div>
      )}
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>Show recently resolved / completed</span>
        <Toggle
          checked={includePast}
          onCheckedChange={(v) => set({ includePast: v })}
        />
      </label>
      {includePast && (
        <div className="flex items-center justify-between gap-2">
          <Label
            htmlFor="event-feed-past-max-age"
            className="text-xs text-muted-foreground"
          >
            Max age (days)
          </Label>
          <Input
            id="event-feed-past-max-age"
            type="number"
            className="h-8 w-20"
            value={Number(config.pastMaxAgeDays ?? 7)}
            onChange={(e) =>
              set({ pastMaxAgeDays: clamp(Number(e.target.value) || 7, 1, 90) })
            }
          />
        </div>
      )}
    </div>
  );
};

/**
 * Nested tri-state scope picker for the event-feed widgets. The stored config is
 * `{ systemIds, groupIds, excludedSystemIds }`; the resolved scope is
 * `(systemIds ∪ members(groupIds)) − excludedSystemIds`, computed on the backend
 * at read time. A group toggles all its members; a member added to the group
 * later is included automatically (nothing to re-save). Individual members can
 * be excluded from a selected group, or added standalone without their group.
 */
const EventFeedScopePicker: React.FC<{
  systems: SystemOption[];
  groups: GroupOption[];
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}> = ({ systems, groups, config, set }) => {
  const systemIds = (config.systemIds as string[]) ?? [];
  const groupIds = (config.groupIds as string[]) ?? [];
  const excludedSystemIds = (config.excludedSystemIds as string[]) ?? [];
  const systemLabels = (config.systemLabels as Record<string, string>) ?? {};
  const systemIdSet = new Set(systemIds);
  const groupIdSet = new Set(groupIds);
  const excludedSet = new Set(excludedSystemIds);
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const setLabel = (id: string, value: string) => {
    const next = { ...systemLabels };
    const v = value.trim();
    if (v) next[id] = v;
    else delete next[id];
    set({ systemLabels: next });
  };

  const memberOfSelectedGroup = (id: string) =>
    groups.some((g) => groupIdSet.has(g.id) && g.systemIds.includes(id));
  const isIncluded = (id: string) =>
    systemIdSet.has(id) ||
    (memberOfSelectedGroup(id) && !excludedSet.has(id));

  const toggleGroup = (group: GroupOption, on: boolean) => {
    const nextGroups = on
      ? [...new Set([...groupIds, group.id])]
      : groupIds.filter((g) => g !== group.id);
    // Turning a group on re-includes its members (clear any stale exclusions);
    // turning it off clears exclusions too so a later re-add starts clean.
    const nextExcluded = excludedSystemIds.filter(
      (id) => !group.systemIds.includes(id),
    );
    set({ groupIds: nextGroups, excludedSystemIds: nextExcluded });
  };

  const toggleSystem = (id: string, on: boolean) => {
    const memberSelected = memberOfSelectedGroup(id);
    if (on) {
      set({
        // Re-include: drop any exclusion; only add to explicit picks when not
        // already covered by a selected group.
        excludedSystemIds: excludedSystemIds.filter((x) => x !== id),
        systemIds: memberSelected
          ? systemIds
          : [...new Set([...systemIds, id])],
      });
      return;
    }
    set({
      systemIds: systemIds.filter((s) => s !== id),
      // Exclude a group-provided member; a standalone pick just drops out above.
      excludedSystemIds:
        memberSelected && !excludedSet.has(id)
          ? [...excludedSystemIds, id]
          : excludedSystemIds,
    });
  };

  const groupedSystemIds = new Set(groups.flatMap((g) => g.systemIds));
  const ungrouped = systems.filter((s) => !groupedSystemIds.has(s.id));
  // Systems currently in scope: the only ones for which a public label matters.
  const includedSystems = systems.filter((s) => isIncluded(s.id));

  const Row: React.FC<{ id: string; name: string; indent?: boolean }> = ({
    id,
    name,
    indent,
  }) => (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 py-1 text-sm",
        indent && "pl-6",
      )}
    >
      <Checkbox
        checked={isIncluded(id)}
        onCheckedChange={(v) => toggleSystem(id, v)}
      />
      <span className="min-w-0 truncate">{name}</span>
    </label>
  );

  return (
    <div className="space-y-2">
    <div className="space-y-2 rounded-md border border-border p-2">
      {groups.length === 0 && systems.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No systems or groups available.
        </p>
      )}
      {groups.map((group) => {
        const open = openGroups.has(group.id);
        const on = groupIdSet.has(group.id);
        const excludedCount = group.systemIds.filter((id) =>
          excludedSet.has(id),
        ).length;
        return (
          <div key={group.id}>
            <div className="flex items-center gap-2 py-1 text-sm">
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })
                }
                aria-label={open ? "Collapse group" : "Expand group"}
                className="text-muted-foreground hover:text-foreground"
              >
                {open ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) => toggleGroup(group, v)}
                />
                <span className="min-w-0 truncate font-medium">
                  {group.name}
                </span>
              </label>
              {on && excludedCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {excludedCount} excluded
                </Badge>
              )}
            </div>
            {open && (
              <div className="border-l border-border/60 pl-2">
                {group.systemIds.length === 0 ? (
                  <p className="pl-6 py-1 text-xs text-muted-foreground">
                    No systems in this group.
                  </p>
                ) : (
                  group.systemIds.map((id) => (
                    <Row
                      key={id}
                      id={id}
                      name={systemName.get(id) ?? id}
                      indent
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
      {ungrouped.length > 0 && (
        <div className="border-t border-border/60 pt-1">
          {ungrouped.map((s) => (
            <Row key={s.id} id={s.id} name={s.name} />
          ))}
        </div>
      )}
    </div>
    {includedSystems.length > 0 && (
      <div className="space-y-1 rounded-md border border-border p-2">
        <p className="text-xs font-medium text-muted-foreground">
          Public labels (optional)
        </p>
        <p className="text-[11px] text-muted-foreground">
          Shown publicly instead of the system name (incl. on the detail page).
          Leave empty to use the catalog name.
        </p>
        {includedSystems.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <span className="w-1/3 min-w-0 truncate text-xs text-muted-foreground">
              {s.name}
            </span>
            <Input
              value={systemLabels[s.id] ?? ""}
              onChange={(e) => setLabel(s.id, e.target.value)}
              placeholder={s.name}
              className="h-7 flex-1 text-xs"
            />
          </div>
        ))}
      </div>
    )}
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
    case BUILTIN_WIDGET_IDS.banner: {
      return (
        <SystemMultiSelect
          systems={systems}
          selectedIds={(config.systemIds as string[]) ?? []}
          onChange={(ids) => set({ systemIds: ids })}
        />
      );
    }
    case BUILTIN_WIDGET_IDS.incidents:
    case BUILTIN_WIDGET_IDS.maintenance: {
      return (
        <div className="space-y-3">
          <EventFeedScopePicker
            systems={systems}
            groups={groups}
            config={config}
            set={set}
          />
          <EventFeedControls config={config} set={set} />
        </div>
      );
    }
    case BUILTIN_WIDGET_IDS.systemHealth: {
      const items = (config.items as Array<{ systemId: string }>) ?? [];
      return (
        <div className="space-y-2">
          <SystemMultiSelect
            systems={systems}
            selectedIds={items.map((i) => i.systemId)}
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
            <SelectTrigger aria-label="Select a system">
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
            <Label htmlFor="uptime-days" className="text-xs">
              Days
            </Label>
            <Input
              id="uptime-days"
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
            <SelectTrigger className="w-24" aria-label="Heading level">
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
        <div className="space-y-2">
          <Select
            value={(config.groupId as string) || ""}
            onValueChange={(v) => set({ groupId: v })}
          >
            <SelectTrigger aria-label="Select a group">
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
          <label className="flex items-center gap-2 text-sm">
            <Toggle
              checked={Boolean(config.collapseWhenHealthy)}
              onCheckedChange={(v) => set({ collapseWhenHealthy: v })}
            />
            Collapse systems when all operational
          </label>
        </div>
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

/**
 * Custom-domain panel. Independent of the draft save/publish flow — setting,
 * verifying, and removing a domain are immediate mutations on the saved page.
 * A domain only routes once it is BOTH verified (DNS TXT) AND the page is
 * published; the backend enforces that, this UI just guides the operator.
 */
/** Docs how-to for the full custom-domain + TLS walkthrough. */
const CUSTOM_DOMAIN_DOCS =
  "/checkstack/user-guide/guides/serve-a-status-page-on-a-custom-domain/";

/** A monospace value with a copy-to-clipboard button. */
const CopyableValue: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toastSuccess(toast, `${label} copied`);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded bg-surface-inset px-2 py-1 text-foreground">
        {value}
      </code>
      <Button
        size="sm"
        variant="ghost"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="shrink-0"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

const CustomDomainSection: React.FC<{
  pageId: string;
  published: boolean;
  customDomain: CustomDomainInfo | null;
}> = ({ pageId, published, customDomain }) => {
  const client = usePluginClient(StatusPageApi);
  const toast = useToast();
  const [input, setInput] = useState(customDomain?.domain ?? "");
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const setMutation = client.setCustomDomain.useMutation();
  const verifyMutation = client.verifyCustomDomain.useMutation();
  const removeMutation = client.removeCustomDomain.useMutation();
  const busy =
    setMutation.isPending ||
    verifyMutation.isPending ||
    removeMutation.isPending;

  const trimmed = input.trim();
  const unchanged = trimmed === (customDomain?.domain ?? "");

  const onSet = async () => {
    try {
      await setMutation.mutateAsync({ id: pageId, domain: trimmed });
      toastSuccess(toast, "Domain saved. Add the DNS TXT record, then verify.");
    } catch (error) {
      toastError(toast, "Couldn't save the domain", error);
    }
  };
  const onVerify = async () => {
    try {
      await verifyMutation.mutateAsync({ id: pageId });
      toastSuccess(toast, "Domain verified.");
    } catch (error) {
      toastError(toast, "Verification failed", error);
    }
  };
  const performRemove = async () => {
    try {
      await removeMutation.mutateAsync({ id: pageId });
      setInput("");
      setConfirmRemoveOpen(false);
      toastSuccess(toast, "Custom domain removed.");
    } catch (error) {
      toastError(toast, "Couldn't remove the domain", error);
    }
  };
  const onRemove = () => {
    // A verified domain may be serving real visitors; confirm before pulling
    // it. An unverified domain serves nothing, so remove it without a prompt.
    if (customDomain?.verified) {
      setConfirmRemoveOpen(true);
      return;
    }
    void performRemove();
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">Custom domain</h3>
            <p className="text-xs text-muted-foreground">
              Serve this page on your own domain, fully isolated from the admin
              UI.{" "}
              <a
                href={CUSTOM_DOMAIN_DOCS}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Setup guide
              </a>
              .
            </p>
          </div>
        </div>
        {customDomain && (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              customDomain.verified
                ? "bg-status-ok/10 text-status-ok"
                : "bg-status-warn/10 text-status-warn"
            }`}
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                customDomain.verified ? "bg-status-ok" : "bg-status-warn"
              }`}
            />
            {customDomain.verified ? "Verified" : "Pending verification"}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="status.example.com"
          disabled={busy}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={onSet}
          disabled={busy || trimmed.length === 0 || unchanged}
        >
          Save
        </Button>
      </div>

      {customDomain && (
        <div className="space-y-3">
          {!customDomain.verified && (
            <div className="space-y-2 rounded-md border border-border bg-surface-inset p-3 text-xs">
              <p className="text-muted-foreground">
                Add this DNS <strong>TXT</strong> record, then click Verify (DNS
                can take a few minutes to propagate):
              </p>
              <div className="space-y-1.5">
                <div className="text-muted-foreground">Name</div>
                <CopyableValue
                  label="Record name"
                  value={customDomain.verification.recordName}
                />
                <div className="text-muted-foreground">Value</div>
                <CopyableValue
                  label="Record value"
                  value={customDomain.verification.recordValue}
                />
              </div>
              <p className="text-muted-foreground">
                Then point <code>{customDomain.domain}</code> at this Checkstack
                instance (CNAME or A record) and terminate TLS for it at your
                edge.{" "}
                <a
                  href={CUSTOM_DOMAIN_DOCS}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  How
                </a>
                .
              </p>
            </div>
          )}
          {customDomain.verified &&
            (published ? (
              <p className="text-xs text-muted-foreground">
                Live at{" "}
                <a
                  href={`https://${customDomain.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  https://{customDomain.domain}
                </a>
                .
              </p>
            ) : (
              <p className="text-xs text-warning">
                Verified. Publish the page to make https://{customDomain.domain}{" "}
                go live.
              </p>
            ))}
          <div className="flex gap-2">
            {!customDomain.verified && (
              <Button size="sm" onClick={onVerify} disabled={busy}>
                Verify
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onRemove}
              disabled={busy}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
      <ConfirmationModal
        isOpen={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        onConfirm={() => void performRemove()}
        title="Remove custom domain?"
        message={
          customDomain
            ? `Remove ${customDomain.domain}? The page will stop serving on it.`
            : "The page will stop serving on this domain."
        }
        confirmText="Remove"
        variant="danger"
        isLoading={removeMutation.isPending}
      />
    </Card>
  );
};

/**
 * Admin panel listing a page's anonymous EMAIL subscribers (double-opt-in), with
 * per-row removal. Rendered inside the manage-gated builder, so it inherits the
 * page's `manage` capability; the backend list/delete procs are additionally
 * team-scoped by MANAGE on this page.
 */
const SubscribersSection: React.FC<{
  pageId: string;
  enabled: boolean;
  quota: number | null;
  verificationRequired: boolean;
}> = ({ pageId, enabled, quota, verificationRequired }) => {
  const client = usePluginClient(StatusPageApi);
  const toast = useToast();
  const { data } = client.listStatusPageSubscribers.useQuery({
    statusPageId: pageId,
  });
  const removeMutation = client.deleteStatusPageSubscriber.useMutation();
  const updateMutation = client.updateStatusPage.useMutation();
  const subscribers = data?.subscribers ?? [];

  // Local draft of the quota field (string so it can be cleared -> "use default").
  const [quotaDraft, setQuotaDraft] = useState(quota === null ? "" : String(quota));
  useEffect(() => {
    setQuotaDraft(quota === null ? "" : String(quota));
  }, [quota]);

  const onRemove = async (id: string) => {
    try {
      await removeMutation.mutateAsync({ statusPageId: pageId, id });
      toastSuccess(toast, "Subscriber removed.");
    } catch (error) {
      toastError(toast, "Couldn't remove the subscriber", error);
    }
  };

  const onToggle = async (value: boolean) => {
    try {
      await updateMutation.mutateAsync({
        id: pageId,
        emailSubscriptionsEnabled: value,
      });
      toastSuccess(
        toast,
        value ? "Email subscriptions enabled." : "Email subscriptions disabled.",
      );
    } catch (error) {
      toastError(toast, "Couldn't update the setting", error);
    }
  };

  const onCommitQuota = async () => {
    const trimmed = quotaDraft.trim();
    // Empty -> reset to the platform default (null); otherwise a positive int
    // within the ceiling. Anything invalid snaps back to the stored value.
    let next: number | null;
    if (trimmed === "") {
      next = null;
    } else {
      const parsed = Number(trimmed);
      if (
        !Number.isInteger(parsed) ||
        parsed <= 0 ||
        parsed > EMAIL_SUBSCRIBERS_HOURLY_QUOTA_MAX
      ) {
        setQuotaDraft(quota === null ? "" : String(quota));
        toastError(
          toast,
          "Invalid limit",
          `Enter a whole number between 1 and ${EMAIL_SUBSCRIBERS_HOURLY_QUOTA_MAX}, or leave empty for the default.`,
        );
        return;
      }
      next = parsed;
    }
    if (next === quota) return; // no change
    try {
      await updateMutation.mutateAsync({
        id: pageId,
        emailSubscribersHourlyQuota: next,
      });
      toastSuccess(toast, "Subscriber rate limit updated.");
    } catch (error) {
      toastError(toast, "Couldn't update the rate limit", error);
    }
  };

  const onToggleVerification = async (value: boolean) => {
    try {
      await updateMutation.mutateAsync({
        id: pageId,
        emailVerificationRequired: value,
      });
      toastSuccess(
        toast,
        value
          ? "Email verification required."
          : "Email verification turned off.",
      );
    } catch (error) {
      toastError(toast, "Couldn't update the setting", error);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">Email subscribers</h3>
            <p className="text-xs text-muted-foreground">
              Let visitors subscribe to incident updates by email. The public
              subscribe form appears only while this is on.
            </p>
          </div>
        </div>
        <Toggle
          checked={enabled}
          onCheckedChange={(v) => void onToggle(v)}
          disabled={updateMutation.isPending}
          aria-label="Enable email subscriptions"
        />
      </div>
      {enabled && (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <label
              htmlFor="subscriber-hourly-quota"
              className="text-sm font-medium"
            >
              Max new subscribers per hour
            </label>
            <p className="text-xs text-muted-foreground">
              Caps verification emails from this page. Leave empty for the
              default ({DEFAULT_EMAIL_SUBSCRIBERS_HOURLY_QUOTA}).
            </p>
          </div>
          <Input
            id="subscriber-hourly-quota"
            type="number"
            min={1}
            max={EMAIL_SUBSCRIBERS_HOURLY_QUOTA_MAX}
            inputMode="numeric"
            value={quotaDraft}
            placeholder={String(DEFAULT_EMAIL_SUBSCRIBERS_HOURLY_QUOTA)}
            onChange={(e) => setQuotaDraft(e.target.value)}
            onBlur={() => void onCommitQuota()}
            disabled={updateMutation.isPending}
            className="w-full sm:w-28"
            aria-label="Maximum new subscribers per hour"
          />
        </div>
      )}
      {enabled && (
        <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Require email verification</p>
            <p className="text-xs text-muted-foreground">
              Subscribers confirm their address before receiving updates. Turn
              off to add subscribers immediately without confirmation - use only
              for a trusted, e.g. internal, page.
            </p>
          </div>
          <Toggle
            checked={verificationRequired}
            onCheckedChange={(v) => void onToggleVerification(v)}
            disabled={updateMutation.isPending}
            aria-label="Require email verification"
          />
        </div>
      )}
      {enabled && subscribers.length === 0 && (
        <p className="text-xs text-muted-foreground">No subscribers yet.</p>
      )}
      {enabled && subscribers.length > 0 && (
        <ul className="divide-y divide-border/60">
          {subscribers.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{s.email}</span>
                <Badge
                  variant={s.verified ? "secondary" : "outline"}
                  className="text-[10px]"
                >
                  {s.verified ? "Verified" : "Pending"}
                </Badge>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onRemove(s.id)}
                disabled={removeMutation.isPending}
                aria-label={`Remove ${s.email}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!enabled && (
        <p className="text-xs text-muted-foreground">
          Email subscriptions are off for this page.
        </p>
      )}
    </Card>
  );
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
  const groups: GroupOption[] = (groupsData ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    systemIds: g.systemIds,
  }));
  const widgetTypes = widgetTypesData?.widgetTypes ?? [];

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<StatusPageVisibility>("public");
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [blocks, setBlocks] = useState<StatusPageBlock[]>([]);
  const [addType, setAddType] = useState("");
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

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
      toastSuccess(toast, "Saved");
    } catch (error) {
      toastError(toast, "Couldn't save", error);
    }
  };

  const publish = async () => {
    // Publish always snapshots the current draft first, so save then publish —
    // and if only the publish leg fails, say the save DID land.
    try {
      await updateMutation.mutateAsync(buildPatch());
    } catch (error) {
      toastError(toast, "Couldn't save", error);
      return;
    }
    try {
      await publishMutation.mutateAsync({ id });
      toastSuccess(toast, "Published");
    } catch (error) {
      toastError(toast, "Saved, but couldn't publish", error);
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

  const leave = () => navigate(resolveRoute(statusPageRoutes.routes.list));
  const goBack = () => {
    // Guard against losing unsaved edits; clean state leaves immediately.
    if (dirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    leave();
  };

  return (
    <>
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
            <code>/statuspage/view/{slug || "your-slug"}</code>.
          </p>
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="status-page-title">Title</Label>
                <Input
                  id="status-page-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status-page-slug">Slug</Label>
                <Input
                  id="status-page-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Visibility</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as StatusPageVisibility)}
                >
                  <SelectTrigger aria-label="Visibility">
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
                <Label htmlFor="status-page-brand-color">Brand color (HSL)</Label>
                <Input
                  id="status-page-brand-color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="262 83% 58%"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="status-page-logo-url">Logo URL</Label>
                <Input
                  id="status-page-logo-url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>
            </div>
          </Card>

          <CustomDomainSection
            pageId={id}
            published={page.published}
            customDomain={page.customDomain}
          />

          <SubscribersSection
            pageId={id}
            enabled={page.emailSubscriptionsEnabled}
            quota={page.emailSubscribersHourlyQuota}
            verificationRequired={page.emailVerificationRequired}
          />

          {blocks.map((block, i) => {
            const descriptor = widgetTypes.find((w) => w.id === block.type);
            return (
              <Card key={block.id} className="space-y-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {descriptor?.displayName ?? block.type}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => move(i, 1)} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
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
              {/* A combobox derives its accessible name from aria-label, NOT
                  its placeholder child text, so label it explicitly. */}
              <SelectTrigger className="flex-1" aria-label="Add a block">
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
    <ConfirmationModal
      isOpen={confirmDiscardOpen}
      onClose={() => setConfirmDiscardOpen(false)}
      onConfirm={() => {
        setConfirmDiscardOpen(false);
        leave();
      }}
      title="Discard unsaved changes?"
      message="You have unsaved changes. Discard them and leave?"
      confirmText="Discard"
      cancelText="Keep editing"
      variant="warning"
    />
    </>
  );
};

/**
 * Structural preview: content widgets render from config (their config IS their
 * DTO); status widgets show a labelled placeholder (live data appears on the
 * published page, which resolves through the secure public endpoint).
 */
const PreviewBlock: React.FC<{ block: StatusPageBlock }> = ({ block }) => {
  const renderers = useStatusWidgetRenderers();
  const content = new Set<string>([
    BUILTIN_WIDGET_IDS.text,
    BUILTIN_WIDGET_IDS.heading,
    BUILTIN_WIDGET_IDS.links,
    BUILTIN_WIDGET_IDS.image,
    BUILTIN_WIDGET_IDS.divider,
  ]);
  if (content.has(block.type)) {
    return (
      <BlockRenderer
        block={{ id: block.id, type: block.type, label: block.label, data: block.config }}
        renderers={renderers}
      />
    );
  }
  return (
    <Card className="p-3 text-sm text-muted-foreground">
      {block.label ?? block.type.replace("statuspage.", "")} (live on published page)
    </Card>
  );
};

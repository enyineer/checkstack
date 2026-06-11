import React from "react";
import { Badge, Card, MarkdownBlock } from "@checkstack/ui";
import {
  BUILTIN_WIDGET_IDS,
  PublicStatusSchema,
  BannerDtoSchema,
  SystemHealthDtoSchema,
  GroupStatusDtoSchema,
  UptimeDtoSchema,
  IncidentsDtoSchema,
  MaintenanceDtoSchema,
  TextDtoSchema,
  HeadingDtoSchema,
  LinksDtoSchema,
  ImageDtoSchema,
  type PublicStatus,
  type ResolvedBlock,
} from "@checkstack/status-page-common";

/**
 * PURE public widget renderers. The single security rule for this layer: a
 * renderer receives the resolver's already-allow-listed `data` as props and has
 * NO data-fetching ability (no RPC client, no fetch). So even a third-party
 * renderer can only draw the DTO it is handed — it can never leak. Both the
 * admin preview and the public page render through this registry.
 */

const STATUS_LABEL: Record<PublicStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
  maintenance: "Maintenance",
  unknown: "Unknown",
};

const STATUS_CLASS: Record<PublicStatus, string> = {
  operational: "bg-success/15 text-success",
  degraded: "bg-warning/15 text-warning",
  partial_outage: "bg-warning/20 text-warning",
  major_outage: "bg-destructive/15 text-destructive",
  maintenance: "bg-info/15 text-info",
  unknown: "bg-muted text-muted-foreground",
};

const StatusPill: React.FC<{ status: PublicStatus }> = ({ status }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
  >
    <span className="size-1.5 rounded-full bg-current" />
    {STATUS_LABEL[status]}
  </span>
);

const StatusRow: React.FC<{
  label: string;
  status: PublicStatus;
  uptimePct?: number;
}> = ({ label, status, uptimePct }) => (
  <div className="flex items-center justify-between gap-3 py-2">
    <span className="min-w-0 truncate text-sm text-foreground">{label}</span>
    <div className="flex items-center gap-2">
      {uptimePct !== undefined && (
        <span className="text-xs text-muted-foreground">
          {uptimePct.toFixed(2)}%
        </span>
      )}
      <StatusPill status={status} />
    </div>
  </div>
);

type RendererProps = { data: unknown; label?: string };

const BannerRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = BannerDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <div
      className={`rounded-lg px-4 py-3 text-base font-semibold ${STATUS_CLASS[parsed.data.status]}`}
    >
      {parsed.data.title}
    </div>
  );
};

const Section: React.FC<{ label?: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <Card className="p-4">
    {label && (
      <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
    )}
    {children}
  </Card>
);

const SystemHealthRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = SystemHealthDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <Section label={label}>
      <div className="divide-y divide-border">
        {parsed.data.systems.map((s, i) => (
          <StatusRow key={i} label={s.label} status={s.status} uptimePct={s.uptimePct} />
        ))}
      </div>
    </Section>
  );
};

const GroupStatusRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = GroupStatusDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <Section label={label ?? parsed.data.label}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{parsed.data.label}</span>
        <StatusPill status={parsed.data.status} />
      </div>
      <div className="divide-y divide-border">
        {parsed.data.systems.map((s, i) => (
          <StatusRow key={i} label={s.label} status={s.status} />
        ))}
      </div>
    </Section>
  );
};

const UptimeRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = UptimeDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <Section label={label}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium">{parsed.data.label}</span>
        <span className="text-xs text-muted-foreground">
          {parsed.data.uptimePct.toFixed(2)}% uptime
        </span>
      </div>
      <div className="flex gap-0.5">
        {parsed.data.bars.map((bar, i) => (
          <div
            key={i}
            role="img"
            aria-label={`${bar.date}: ${bar.uptimePct.toFixed(1)}% uptime`}
            title={`${bar.date}: ${bar.uptimePct.toFixed(1)}%`}
            className={`h-8 flex-1 rounded-sm ${STATUS_CLASS[bar.status]}`}
          />
        ))}
      </div>
    </Section>
  );
};

const statusOf = (raw: string): PublicStatus =>
  PublicStatusSchema.safeParse(raw).success ? (raw as PublicStatus) : "unknown";

const IncidentsRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = IncidentsDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  if (parsed.data.incidents.length === 0) {
    return (
      <Section label={label ?? "Incidents"}>
        <p className="text-sm text-muted-foreground">No active incidents.</p>
      </Section>
    );
  }
  return (
    <Section label={label ?? "Incidents"}>
      <div className="space-y-4">
        {parsed.data.incidents.map((inc) => (
          <div key={inc.id} className="border-l-2 border-border pl-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{inc.title}</span>
              <Badge variant="secondary">{inc.severity}</Badge>
              <Badge variant="outline">{inc.status}</Badge>
            </div>
            {inc.systems.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Affected: {inc.systems.join(", ")}
              </p>
            )}
            <ul className="mt-2 space-y-1">
              {inc.updates.map((u, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {new Date(u.at).toLocaleString()}
                  </span>{" "}
                  {u.message}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
};

const MaintenanceRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = MaintenanceDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  if (parsed.data.maintenances.length === 0) {
    return (
      <Section label={label ?? "Scheduled maintenance"}>
        <p className="text-sm text-muted-foreground">No scheduled maintenance.</p>
      </Section>
    );
  }
  return (
    <Section label={label ?? "Scheduled maintenance"}>
      <div className="space-y-3">
        {parsed.data.maintenances.map((m) => (
          <div key={m.id} className="border-l-2 border-info/40 pl-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{m.title}</span>
              <Badge variant="outline">{m.status}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(m.startAt).toLocaleString()} –{" "}
              {new Date(m.endAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
};

const TextRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = TextDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return <MarkdownBlock>{parsed.data.markdown}</MarkdownBlock>;
};

const HeadingRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = HeadingDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  const size =
    parsed.data.level === 1
      ? "text-2xl"
      : parsed.data.level === 2
        ? "text-xl"
        : "text-lg";
  return <h2 className={`font-semibold ${size}`}>{parsed.data.text}</h2>;
};

const LinksRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = LinksDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {parsed.data.links.map((l, i) => (
        <a
          key={i}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
};

const ImageRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = ImageDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <img
      src={parsed.data.url}
      alt={parsed.data.alt ?? ""}
      style={parsed.data.maxHeight ? { maxHeight: parsed.data.maxHeight } : undefined}
      className="object-contain"
    />
  );
};

const DividerRenderer: React.FC<RendererProps> = () => (
  <hr className="border-border" />
);

/** Map widget type id -> pure renderer. Third-party renderers register here. */
export const WIDGET_RENDERERS: Record<string, React.FC<RendererProps>> = {
  [BUILTIN_WIDGET_IDS.banner]: BannerRenderer,
  [BUILTIN_WIDGET_IDS.systemHealth]: SystemHealthRenderer,
  [BUILTIN_WIDGET_IDS.groupStatus]: GroupStatusRenderer,
  [BUILTIN_WIDGET_IDS.uptime]: UptimeRenderer,
  [BUILTIN_WIDGET_IDS.incidents]: IncidentsRenderer,
  [BUILTIN_WIDGET_IDS.maintenance]: MaintenanceRenderer,
  [BUILTIN_WIDGET_IDS.text]: TextRenderer,
  [BUILTIN_WIDGET_IDS.heading]: HeadingRenderer,
  [BUILTIN_WIDGET_IDS.links]: LinksRenderer,
  [BUILTIN_WIDGET_IDS.image]: ImageRenderer,
  [BUILTIN_WIDGET_IDS.divider]: DividerRenderer,
};

/** Render one resolved block via the registry (skips unknown / null data). */
export const BlockRenderer: React.FC<{ block: ResolvedBlock }> = ({ block }) => {
  const Renderer = WIDGET_RENDERERS[block.type];
  if (!Renderer || block.data === null || block.data === undefined) return null;
  return <Renderer data={block.data} label={block.label} />;
};

export { statusOf };

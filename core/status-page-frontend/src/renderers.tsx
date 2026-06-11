import React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Wrench,
  HelpCircle,
} from "lucide-react";
import { MarkdownBlock } from "@checkstack/ui";
import {
  BUILTIN_WIDGET_IDS,
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
 * NO data-fetching ability (no RPC client, no fetch). Both the admin preview and
 * the public page render through this registry.
 */

interface StatusMeta {
  label: string;
  /** Solid color for dots / uptime bars. */
  solid: string;
  /** Soft pill background + text. */
  soft: string;
  /** Hero banner background + border. */
  hero: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const STATUS: Record<PublicStatus, StatusMeta> = {
  operational: {
    label: "Operational",
    solid: "bg-success",
    soft: "bg-success/10 text-success",
    hero: "bg-success/10 text-success ring-success/20",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    solid: "bg-warning",
    soft: "bg-warning/10 text-warning",
    hero: "bg-warning/10 text-warning ring-warning/20",
    Icon: AlertTriangle,
  },
  partial_outage: {
    label: "Partial outage",
    solid: "bg-warning",
    soft: "bg-warning/10 text-warning",
    hero: "bg-warning/10 text-warning ring-warning/20",
    Icon: AlertTriangle,
  },
  major_outage: {
    label: "Major outage",
    solid: "bg-destructive",
    soft: "bg-destructive/10 text-destructive",
    hero: "bg-destructive/10 text-destructive ring-destructive/20",
    Icon: AlertOctagon,
  },
  maintenance: {
    label: "Maintenance",
    solid: "bg-info",
    soft: "bg-info/10 text-info",
    hero: "bg-info/10 text-info ring-info/20",
    Icon: Wrench,
  },
  unknown: {
    label: "Unknown",
    solid: "bg-muted-foreground/40",
    soft: "bg-muted text-muted-foreground",
    hero: "bg-muted text-muted-foreground ring-border",
    Icon: HelpCircle,
  },
};

const StatusPill: React.FC<{ status: PublicStatus }> = ({ status }) => {
  const meta = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.soft}`}
    >
      <span className={`size-1.5 rounded-full ${meta.solid}`} />
      {meta.label}
    </span>
  );
};

type RendererProps = { data: unknown; label?: string };

/** A titled card section — the building block for most widgets. */
const Section: React.FC<{ label?: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
    {label && (
      <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
        {label}
      </h3>
    )}
    {children}
  </section>
);

const BannerRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = BannerDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  const meta = STATUS[parsed.data.status];
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-5 py-4 text-base font-semibold ring-1 ${meta.hero}`}
    >
      <meta.Icon className="size-5 shrink-0" />
      <span>{parsed.data.title}</span>
    </div>
  );
};

const StatusRow: React.FC<{
  label: string;
  status: PublicStatus;
  uptimePct?: number;
}> = ({ label, status, uptimePct }) => (
  <div className="flex items-center justify-between gap-3 py-2.5">
    <span className="min-w-0 truncate text-sm font-medium text-foreground">
      {label}
    </span>
    <div className="flex shrink-0 items-center gap-3">
      {uptimePct !== undefined && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {uptimePct.toFixed(2)}%
        </span>
      )}
      <StatusPill status={status} />
    </div>
  </div>
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
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{parsed.data.label}</span>
        <StatusPill status={parsed.data.status} />
      </div>
      <div className="divide-y divide-border border-t border-border">
        {parsed.data.systems.map((s, i) => (
          <StatusRow key={i} label={s.label} status={s.status} />
        ))}
      </div>
    </Section>
  );
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const UptimeRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = UptimeDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  const { bars } = parsed.data;
  // No buckets => no run history in the window. Show "no data" rather than a
  // misleading "0.00%" (a healthy system with no history is not 0% uptime).
  const hasData = bars.length > 0;
  return (
    <Section label={label}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{parsed.data.label}</span>
        {hasData && (
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {parsed.data.uptimePct.toFixed(2)}% uptime
          </span>
        )}
      </div>
      {hasData ? (
        <>
          <div className="flex h-9 items-stretch gap-[3px]">
            {bars.map((bar, i) => (
              <div
                key={i}
                role="img"
                aria-label={`${shortDate(bar.date)}: ${bar.uptimePct.toFixed(1)}% uptime`}
                title={`${shortDate(bar.date)}: ${bar.uptimePct.toFixed(1)}%`}
                className={`flex-1 rounded-[2px] transition-opacity hover:opacity-70 ${STATUS[bar.status].solid}`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{shortDate(bars[0].date)}</span>
            <span>{shortDate(bars.at(-1)?.date ?? bars[0].date)}</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No uptime data for this period yet.
        </p>
      )}
    </Section>
  );
};

const formatAt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive",
  major: "bg-warning/10 text-warning",
  minor: "bg-muted text-muted-foreground",
};

const IncidentsRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = IncidentsDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  const { incidents } = parsed.data;
  return (
    <Section label={label ?? "Incidents"}>
      {incidents.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" />
          No active incidents.
        </p>
      ) : (
        <div className="space-y-5">
          {incidents.map((inc) => (
            <article key={inc.id}>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold">{inc.title}</h4>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${SEVERITY_CLASS[inc.severity] ?? "bg-muted text-muted-foreground"}`}
                >
                  {inc.severity}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                  {inc.status}
                </span>
              </div>
              {inc.systems.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Affected: {inc.systems.join(", ")}
                </p>
              )}
              <ol className="mt-3 space-y-3 border-l border-border pl-4">
                {inc.updates.map((u, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-border" />
                    <p className="text-sm text-foreground">{u.message}</p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {formatAt(u.at)}
                    </p>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
};

const MaintenanceRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = MaintenanceDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  const { maintenances } = parsed.data;
  return (
    <Section label={label ?? "Scheduled maintenance"}>
      {maintenances.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scheduled maintenance.</p>
      ) : (
        <div className="space-y-4">
          {maintenances.map((m) => (
            <article key={m.id} className="rounded-lg bg-info/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Wrench className="size-4 text-info" />
                <h4 className="font-semibold">{m.title}</h4>
                <span className="rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-medium capitalize text-info">
                  {m.status.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                {formatAt(m.startAt)} – {formatAt(m.endAt)}
              </p>
              {m.systems.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Affecting: {m.systems.join(", ")}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </Section>
  );
};

const TextRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = TextDtoSchema.safeParse(data);
  if (!parsed.success || !parsed.data.markdown.trim()) return null;
  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      <MarkdownBlock>{parsed.data.markdown}</MarkdownBlock>
    </div>
  );
};

const HeadingRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = HeadingDtoSchema.safeParse(data);
  if (!parsed.success || !parsed.data.text) return null;
  const size =
    parsed.data.level === 1
      ? "text-2xl"
      : parsed.data.level === 2
        ? "text-xl"
        : "text-lg";
  return (
    <h2 className={`pt-2 font-semibold tracking-tight ${size}`}>
      {parsed.data.text}
    </h2>
  );
};

const LinksRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = LinksDtoSchema.safeParse(data);
  if (!parsed.success || parsed.data.links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {parsed.data.links.map((l, i) => (
        <a
          key={i}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-primary hover:underline"
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

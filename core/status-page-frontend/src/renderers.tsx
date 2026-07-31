import React, { useMemo } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Wrench,
  HelpCircle,
  CalendarCheck,
} from "lucide-react";
import {
  MarkdownBlock,
  formatPercent,
  StatusPill,
  pillToneStyles,
  type MentionResolver,
  type StatusPillTone,
} from "@checkstack/ui";
import { useSlotExtensions } from "@checkstack/frontend-api";
import {
  BUILTIN_WIDGET_IDS,
  StatusWidgetRendererSlot,
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
  type StatusWidgetRendererProps,
  type PublicStatus,
  type ResolvedBlock,
} from "@checkstack/status-page-common";
import {
  mergeWidgetRenderers,
  type WidgetRenderer,
  type WidgetRendererMap,
} from "./renderer-map";
import { severityStripeClass, severityTone } from "./utils/severityTone";
import {
  maintenanceStatusLabel,
  maintenanceStatusTone,
} from "./utils/maintenanceStatusTone";
import { formatAt } from "./utils/formatAt";
import {
  UpdatesTimeline,
  INCIDENT_STATUS_PRESENTER,
  MAINTENANCE_STATUS_PRESENTER,
  type PublicUpdate,
  type StatusChangePresenter,
} from "./components/UpdatesTimeline";

export {
  mergeWidgetRenderers,
  type WidgetRenderer,
  type WidgetRendererMap,
} from "./renderer-map";

/**
 * PURE public widget renderers. The single security rule for this layer: a
 * renderer receives the resolver's already-allow-listed `data` as props and has
 * NO data-fetching ability (no RPC client, no fetch). Both the admin preview and
 * the public page render through this registry.
 */

export interface StatusMeta {
  label: string;
  /** Solid color for dots / uptime bars. */
  solid: string;
  /** Soft pill background + text. */
  soft: string;
  /** Hero banner background + border. */
  hero: string;
  Icon: React.ComponentType<{ className?: string }>;
}

/**
 * Shared status visual tokens (color + icon) keyed by the public status enum.
 * Exported so the page-wide overall-status banner in {@link PublicStatusPage}
 * reuses the exact same semantic tokens as the per-widget renderers.
 */
export const STATUS: Record<PublicStatus, StatusMeta> = {
  operational: {
    label: "Operational",
    solid: "bg-status-ok",
    soft: "bg-status-ok/10 text-status-ok",
    hero: "bg-status-ok/10 text-status-ok ring-status-ok/20",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    solid: "bg-status-warn",
    soft: "bg-status-warn/10 text-status-warn",
    hero: "bg-status-warn/10 text-status-warn ring-status-warn/20",
    Icon: AlertTriangle,
  },
  partial_outage: {
    label: "Partial outage",
    solid: "bg-status-warn",
    soft: "bg-status-warn/10 text-status-warn",
    hero: "bg-status-warn/10 text-status-warn ring-status-warn/20",
    Icon: AlertTriangle,
  },
  major_outage: {
    label: "Major outage",
    solid: "bg-status-down",
    soft: "bg-status-down/10 text-status-down",
    hero: "bg-status-down/10 text-status-down ring-status-down/20",
    Icon: AlertOctagon,
  },
  maintenance: {
    label: "Maintenance",
    // Blue `info`, not grey: a system under planned maintenance is neither
    // broken nor in an unknown state - it is a deliberate, announced window.
    // Grey read as "we have no idea", which is the opposite of the message.
    solid: "bg-status-info",
    soft: "bg-status-info/10 text-status-info",
    hero: "bg-status-info/10 text-status-info ring-status-info/20",
    Icon: Wrench,
  },
  unknown: {
    label: "Unknown",
    solid: "bg-status-unknown",
    soft: "bg-status-unknown/10 text-status-unknown",
    hero: "bg-status-unknown/10 text-status-unknown ring-status-unknown/20",
    Icon: HelpCircle,
  },
};

/**
 * The PUBLIC overall-status pill (operational / degraded / outage). Distinct
 * from the shared `StatusPill`: it is keyed by the public status enum and draws
 * from that enum's own visual tokens, not from the internal tone table.
 */
const PublicStatusPill: React.FC<{ status: PublicStatus }> = ({ status }) => {
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

type RendererProps = StatusWidgetRendererProps;

/**
 * Builds a public detail-page href for an incident / maintenance item, or null
 * when detail linking is not available (e.g. the builder preview). Provided by
 * {@link PublicStatusPageView}; consumed by the event-feed renderers. Uses plain
 * `<a href>` full navigation (NOT a react-router `Link`) so the routerless
 * custom-domain public bundle never crashes.
 */
export type BuildDetailHref = (args: {
  kind: "incident" | "maintenance";
  id: string;
}) => string;

export const StatusDetailLinkContext =
  React.createContext<BuildDetailHref | null>(null);

/**
 * Resolves `#` mentions inside authored markdown on a public page. Provided by
 * {@link PublicStatusPageView}; consumed wherever a widget renders an update
 * message. Null (the default) means "resolve nothing", so mentions render as
 * plain text - the safe default for any surface that has not opted in, such as
 * the builder preview.
 */
export const StatusMentionContext =
  React.createContext<MentionResolver | null>(null);

/** Wrap children in a plain link when an href is available, else render as-is. */
const MaybeLink: React.FC<{
  href?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ href, className, children }) =>
  href ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <>{children}</>
  );

/**
 * The optional per-block heading ("Block heading" in the builder) for content
 * widgets that are not wrapped in a {@link Section} (which renders the label
 * itself). Matches the Section title styling so headings look consistent down
 * the page.
 */
const BlockLabel: React.FC<{ label?: string }> = ({ label }) =>
  label ? (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </h3>
  ) : null;

/** A titled card section — the building block for most widgets. */
const Section: React.FC<{
  label?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, action, children }) => (
  <section className="overflow-hidden rounded-[var(--d-card-r)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
    {(label || action) && (
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-5 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        {action}
      </div>
    )}
    <div className="p-5">{children}</div>
  </section>
);

/** The hero status banner — the most prominent block on the page. */
const BannerRenderer: React.FC<RendererProps> = ({ data }) => {
  const parsed = BannerDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  const meta = STATUS[parsed.data.status];
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl px-6 py-5 ring-1 ${meta.hero}`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-full ${meta.soft}`}
      >
        <meta.Icon className="size-6" />
      </span>
      <span className="text-lg font-semibold sm:text-xl">
        {parsed.data.title}
      </span>
    </div>
  );
};

const StatusRow: React.FC<{
  label: string;
  status: PublicStatus;
  uptimePct?: number;
}> = ({ label, status, uptimePct }) => {
  const meta = STATUS[status];
  return (
    <div className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-inset">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Status by position + hue before the pill reads its label. */}
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${meta.solid}`}
        />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {label}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {uptimePct !== undefined && (
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {formatPercent(uptimePct, {
                alreadyPercent: true,
                fractionDigits: 2,
              })}
            </div>
            <div className="text-[11px] text-muted-foreground">uptime</div>
          </div>
        )}
        <PublicStatusPill status={status} />
      </div>
    </div>
  );
};

const SystemHealthRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = SystemHealthDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <Section label={label}>
      <div className="divide-y divide-border/60">
        {parsed.data.systems.map((s, i) => (
          <StatusRow key={i} label={s.label} status={s.status} uptimePct={s.uptimePct} />
        ))}
      </div>
    </Section>
  );
};

const GroupStatusRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = GroupStatusDtoSchema.safeParse(data);
  // A member is "an issue" (and forces the group open) when it is not
  // operational - a degraded/outage status OR an active maintenance.
  const anyDegraded = useMemo(
    () =>
      parsed.success
        ? parsed.data.systems.some((s) => s.status !== "operational")
        : false,
    [parsed],
  );
  // Collapse only while every member is operational; otherwise stay open. The
  // user can always expand manually via the toggle (accessibility).
  const startCollapsed = parsed.success
    ? parsed.data.collapseWhenHealthy && !anyDegraded
    : false;
  const [expanded, setExpanded] = React.useState(!startCollapsed);
  if (!parsed.success) return null;
  const collapsible = parsed.data.collapseWhenHealthy && !anyDegraded;
  const showMembers = expanded || !collapsible;
  return (
    <Section
      label={label ?? parsed.data.label}
      action={
        <div className="flex items-center gap-2">
          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Hide" : "Show"} systems
            </button>
          )}
          <PublicStatusPill status={parsed.data.status} />
        </div>
      }
    >
      {showMembers ? (
        <div className="divide-y divide-border/60">
          {parsed.data.systems.map((s, i) => (
            <StatusRow key={i} label={s.label} status={s.status} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          All {parsed.data.systems.length} systems operational.
        </p>
      )}
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
  const windowLabel =
    hasData && bars.length > 0
      ? `${shortDate(bars[0].date)} - ${shortDate(bars.at(-1)?.date ?? bars[0].date)}`
      : "";
  return (
    <Section label={label ?? parsed.data.label}>
      {hasData ? (
        <>
          {/* Hero readout: the single most important figure leads the card. */}
          <div className="mb-4">
            <div className="text-3xl font-bold tabular-nums text-foreground">
              {formatPercent(parsed.data.uptimePct, {
                alreadyPercent: true,
                fractionDigits: 2,
              })}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              uptime over {windowLabel}
            </div>
          </div>
          {/* Bars sit on a faint inset track so they read as inset segments. */}
          <div className="rounded-md bg-surface-inset p-1">
            <div className="flex h-10 items-stretch gap-[3px]">
              {bars.map((bar, i) => (
                <div
                  key={i}
                  role="img"
                  aria-label={`${shortDate(bar.date)}: ${formatPercent(bar.uptimePct, { alreadyPercent: true, fractionDigits: 1 })} uptime`}
                  title={`${shortDate(bar.date)}: ${formatPercent(bar.uptimePct, { alreadyPercent: true, fractionDigits: 1 })}`}
                  className={`flex-1 rounded-[3px] transition-opacity hover:opacity-70 ${STATUS[bar.status].solid}`}
                />
              ))}
            </div>
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

/**
 * Depth card for an ACTIVE incident / maintenance item: layered surface,
 * soft shadow, and a severity-driven left accent stripe so a live event
 * visually announces itself. Mirrors {@link SloObjectiveCard}.
 */
const ActiveEventCard: React.FC<{
  stripe: string;
  children: React.ReactNode;
}> = ({ stripe, children }) => (
  <article className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
    <span
      aria-hidden
      className={`absolute inset-y-0 left-0 w-1 ${stripe}`}
    />
    <div className="pl-2">{children}</div>
  </article>
);

/**
 * The event history, shared with the public detail pages. The widget takes the
 * resolver from {@link StatusMentionContext}; the detail pages pass their own.
 */
const WidgetUpdatesTimeline: React.FC<{
  updates: PublicUpdate[];
  status: StatusChangePresenter;
  fallbackTone: StatusPillTone;
}> = ({ updates, status, fallbackTone }) => {
  const resolveMention = React.useContext(StatusMentionContext);
  return (
    <UpdatesTimeline
      updates={updates}
      status={status}
      fallbackTone={fallbackTone}
      className="mt-3"
      {...(resolveMention ? { resolveMention } : {})}
    />
  );
};

/** Section divider label for the "recently resolved / past" subsection. */
const PastHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="border-t border-border pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
);

/** A compact past (resolved/completed) row: check + title + when. */
const PastRow: React.FC<{ title: string; at?: string; href?: string }> = ({
  title,
  at,
  href,
}) => (
  <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
    <span className="flex min-w-0 items-center gap-2">
      <CheckCircle2 className="size-4 shrink-0 text-status-ok" />
      <MaybeLink
        href={href}
        className="truncate text-muted-foreground hover:text-primary hover:underline"
      >
        <span className="truncate text-muted-foreground">{title}</span>
      </MaybeLink>
    </span>
    {at && (
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {shortDate(at)}
      </span>
    )}
  </div>
);

const IncidentsRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = IncidentsDtoSchema.safeParse(data);
  const buildHref = React.useContext(StatusDetailLinkContext);
  if (!parsed.success) return null;
  const active = parsed.data.incidents.filter((i) => i.status !== "resolved");
  const past = parsed.data.incidents.filter((i) => i.status === "resolved");
  const hrefFor = (id: string) =>
    buildHref ? buildHref({ kind: "incident", id }) : undefined;
  return (
    <Section label={label ?? "Incidents"}>
      <div className="space-y-5">
        {active.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-status-ok" />
            No active incidents.
          </p>
        ) : (
          active.map((inc) => (
            <ActiveEventCard
              key={inc.id}
              stripe={severityStripeClass(inc.severity)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <MaybeLink
                  href={hrefFor(inc.id)}
                  className="font-semibold hover:text-primary hover:underline"
                >
                  <h4 className="font-semibold">{inc.title}</h4>
                </MaybeLink>
                {/* Severity carries the hue; the lifecycle is neutral - one
                    coloured dimension per row (see `status-tone.ts`). */}
                <StatusPill
                  tone={severityTone(inc.severity)}
                  size="sm"
                  className="capitalize"
                >
                  {inc.severity}
                </StatusPill>
                <StatusPill tone="neutral" size="sm" className="capitalize">
                  {inc.status}
                </StatusPill>
              </div>
              {inc.systems.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Affected: {inc.systems.join(", ")}
                </p>
              )}
              <WidgetUpdatesTimeline
                updates={inc.updates}
                status={INCIDENT_STATUS_PRESENTER}
                fallbackTone={severityTone(inc.severity)}
              />
            </ActiveEventCard>
          ))
        )}
        {past.length > 0 && (
          <div className="space-y-1">
            <PastHeader>Recently resolved</PastHeader>
            {past.map((inc) => (
              <PastRow
                key={inc.id}
                title={inc.title}
                at={inc.resolvedAt}
                href={hrefFor(inc.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Section>
  );
};

/**
 * An active maintenance card, striped in its own lifecycle hue. Wraps
 * {@link ActiveEventCard} purely so the stripe cannot drift from the pill
 * beside it - both read from `maintenanceStatusTone`.
 */
const MaintenanceEventCard: React.FC<{
  status: string;
  children: React.ReactNode;
}> = ({ status, children }) => (
  <ActiveEventCard stripe={pillToneStyles[maintenanceStatusTone(status)].accent}>
    {children}
  </ActiveEventCard>
);

const MaintenanceRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = MaintenanceDtoSchema.safeParse(data);
  const buildHref = React.useContext(StatusDetailLinkContext);
  if (!parsed.success) return null;
  const active = parsed.data.maintenances.filter((m) => m.status !== "completed");
  const past = parsed.data.maintenances.filter((m) => m.status === "completed");
  const hrefFor = (id: string) =>
    buildHref ? buildHref({ kind: "maintenance", id }) : undefined;
  return (
    <Section label={label ?? "Scheduled maintenance"}>
      <div className="space-y-4">
        {active.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarCheck className="size-4 text-muted-foreground" />
            No scheduled maintenance.
          </p>
        ) : (
          active.map((m) => (
            <MaintenanceEventCard key={m.id} status={m.status}>
              <div className="flex flex-wrap items-center gap-2">
                <Wrench
                  className={`size-4 ${pillToneStyles[maintenanceStatusTone(m.status)].text}`}
                />
                <MaybeLink
                  href={hrefFor(m.id)}
                  className="font-semibold hover:text-primary hover:underline"
                >
                  <h4 className="font-semibold">{m.title}</h4>
                </MaybeLink>
                {/* Maintenance carries no severity, so its LIFECYCLE gets the
                    hue - one coloured dimension per row (`status-tone.ts`). */}
                <StatusPill tone={maintenanceStatusTone(m.status)} size="sm">
                  {maintenanceStatusLabel(m.status)}
                </StatusPill>
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                {formatAt(m.startAt)} – {formatAt(m.endAt)}
              </p>
              {m.systems.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Affecting: {m.systems.join(", ")}
                </p>
              )}
              <WidgetUpdatesTimeline
                updates={m.updates}
                status={MAINTENANCE_STATUS_PRESENTER}
                fallbackTone={maintenanceStatusTone(m.status)}
              />
            </MaintenanceEventCard>
          ))
        )}
        {past.length > 0 && (
          <div className="space-y-1">
            <PastHeader>Past maintenance</PastHeader>
            {past.map((m) => (
              <PastRow
                key={m.id}
                title={m.title}
                at={m.endAt}
                href={hrefFor(m.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Section>
  );
};

const TextRenderer: React.FC<RendererProps> = ({ data, label }) => {
  // A Text block is operator-authored markdown, so it can carry `#` mentions
  // just like an update can - and they resolve under the same page-scoped rule.
  const resolveMention = React.useContext(StatusMentionContext);
  const parsed = TextDtoSchema.safeParse(data);
  if (!parsed.success || !parsed.data.markdown.trim()) return null;
  return (
    <div>
      <BlockLabel label={label} />
      <div className="text-sm leading-relaxed text-muted-foreground">
        <MarkdownBlock {...(resolveMention ? { resolveMention } : {})}>
          {parsed.data.markdown}
        </MarkdownBlock>
      </div>
    </div>
  );
};

const HeadingRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = HeadingDtoSchema.safeParse(data);
  if (!parsed.success || !parsed.data.text) return null;
  const size =
    parsed.data.level === 1
      ? "text-2xl"
      : parsed.data.level === 2
        ? "text-xl"
        : "text-lg";
  return (
    <div>
      <BlockLabel label={label} />
      <h2 className={`pt-2 font-semibold tracking-tight ${size}`}>
        {parsed.data.text}
      </h2>
    </div>
  );
};

const LinksRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = LinksDtoSchema.safeParse(data);
  if (!parsed.success || parsed.data.links.length === 0) return null;
  return (
    <div>
      <BlockLabel label={label} />
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
    </div>
  );
};

const ImageRenderer: React.FC<RendererProps> = ({ data, label }) => {
  const parsed = ImageDtoSchema.safeParse(data);
  if (!parsed.success) return null;
  return (
    <div>
      <BlockLabel label={label} />
      <img
        src={parsed.data.url}
        alt={parsed.data.alt ?? ""}
        style={
          parsed.data.maxHeight ? { maxHeight: parsed.data.maxHeight } : undefined
        }
        className="object-contain"
      />
    </div>
  );
};

const DividerRenderer: React.FC<RendererProps> = () => (
  <hr className="border-border" />
);

/** The renderers status-page ships itself, keyed by widget-type id. */
export const BUILTIN_WIDGET_RENDERERS: Record<string, WidgetRenderer> = {
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

/**
 * Resolve the full renderer map: built-ins plus any renderers contributed by
 * plugins via `StatusWidgetRendererSlot`. Reactive — re-resolves when plugins
 * register/unregister. In the minimal custom-domain public bundle no plugins are
 * loaded, so this is just the built-ins.
 */
export function useStatusWidgetRenderers(): WidgetRendererMap {
  const extensions = useSlotExtensions(StatusWidgetRendererSlot);
  return useMemo(
    () =>
      mergeWidgetRenderers(
        BUILTIN_WIDGET_RENDERERS,
        extensions.flatMap((ext) =>
          ext.component
            ? [{ widgetTypeId: ext.metadata.widgetTypeId, component: ext.component }]
            : [],
        ),
      ),
    [extensions],
  );
}

/** Render one resolved block via a resolved renderer map (skips unknown / null data). */
export const BlockRenderer: React.FC<{
  block: ResolvedBlock;
  renderers: WidgetRendererMap;
}> = ({ block, renderers }) => {
  const Renderer = renderers.get(block.type);
  if (!Renderer || block.data === null || block.data === undefined) return null;
  return <Renderer data={block.data} label={block.label} />;
};

import React, { useEffect } from "react";
import { useParams } from "react-router";
import {
  EmptyState,
  LoadingSpinner,
  Markdown,
  StatusPill,
  pillToneStyles,
  type MentionResolver,
  type StatusPillTone,
} from "@checkstack/ui";
import { ArrowLeft, FileQuestion, Wrench } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  StatusPageApi,
  statusPublicRoutes,
} from "@checkstack/status-page-common";
import { resolveRoute } from "@checkstack/common";
import type { BuildDetailHref } from "../renderers";
import { usePublicMentions } from "../use-public-mentions";
import { buildInAppDetailHref } from "../public-detail-href";
import { severityTone } from "../utils/severityTone";
import {
  maintenanceStatusLabel,
  maintenanceStatusTone,
} from "../utils/maintenanceStatusTone";
import {
  incidentStatusLabel,
  incidentStatusTone,
} from "../utils/incidentStatusTone";

/**
 * Public incident / maintenance DETAIL pages. Each renders ENTIRELY from a
 * single public-safe endpoint (`getPublishedIncident` / `getPublishedMaintenance`)
 * which returns the same field-allow-listed DTO the status-page widgets emit and
 * is GATED to the item being surfaced by the page's published widgets (no
 * enumeration, no `createdBy` leak). Driven by `slug` (the page) + `id` (the
 * item), plus a `backHref` for the "back to status page" link.
 */

const formatAt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const BackLink: React.FC<{ href: string }> = ({ href }) => (
  <a
    href={href}
    className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
  >
    <ArrowLeft className="size-4" />
    Back to status page
  </a>
);

const DetailShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-background text-foreground">
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-14 sm:px-6">
      {children}
    </div>
  </div>
);

type PublicUpdate = { message: string; statusChange?: string; at: string };

interface StatusChangePresenter {
  tone: (status: string) => StatusPillTone;
  label: (status: string) => string;
}

const UpdatesTimeline: React.FC<{
  updates: PublicUpdate[];
  status: StatusChangePresenter;
  resolveMention: MentionResolver;
}> = ({ updates, status, resolveMention }) => {
  if (updates.length === 0) return null;
  return (
    <ol className="mt-5 space-y-4 border-l border-border pl-4">
      {updates.map((u, i) => (
        <li key={i} className="relative">
          {/* The dot takes the SAME tone as the status label below it, so the
              rail reads as a coloured history at a glance. An update that
              changes nothing keeps the neutral rail colour - the hue always
              means "the status moved here". */}
          <span
            className={`absolute -left-[21px] top-1 size-2 rounded-full ${
              u.statusChange
                ? pillToneStyles[status.tone(u.statusChange)].dot
                : "bg-border"
            }`}
          />
          {u.statusChange && (
            // The status change on its own line, COLOURED by its status (was the
            // muted grey `text-muted-foreground`), with the message underneath.
            <span
              className={`mb-0.5 inline-block text-[11px] font-semibold uppercase tracking-wide ${pillToneStyles[status.tone(u.statusChange)].text}`}
            >
              {status.label(u.statusChange)}
            </span>
          )}
          {/* Sanitized markdown - render the authored formatting rather than the
              raw source (the reported bug showed the raw string). */}
          <Markdown
            className="text-sm text-foreground"
            resolveMention={resolveMention}
          >
            {u.message}
          </Markdown>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatAt(u.at)}
          </p>
        </li>
      ))}
    </ol>
  );
};

const INCIDENT_STATUS_PRESENTER: StatusChangePresenter = {
  tone: incidentStatusTone,
  label: incidentStatusLabel,
};
const MAINTENANCE_STATUS_PRESENTER: StatusChangePresenter = {
  tone: maintenanceStatusTone,
  label: maintenanceStatusLabel,
};

/** The event's long-form description, rendered as markdown when present. */
const Description: React.FC<{
  description?: string;
  resolveMention: MentionResolver;
}> = ({ description, resolveMention }) =>
  description && description.trim().length > 0 ? (
    <Markdown
      className="mt-4 text-sm text-foreground"
      resolveMention={resolveMention}
    >
      {description}
    </Markdown>
  ) : null;

const LoadingShell: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <LoadingSpinner />
  </div>
);

const NotFoundShell: React.FC<{ backHref: string; kind: string }> = ({
  backHref,
  kind,
}) => (
  <DetailShell>
    <BackLink href={backHref} />
    <EmptyState
      icon={<FileQuestion className="h-12 w-12" />}
      title={`${kind} not found`}
      description="This item does not exist or is not shown on this status page."
    />
  </DetailShell>
);

export const PublicIncidentDetailView: React.FC<{
  slug: string;
  id: string;
  backHref: string;
  /**
   * Builds hrefs for mentions pointing at OTHER items on this page. The
   * custom-domain bundle passes its own (the page lives at the host root
   * there); the in-app wrapper below uses the shared admin-origin builder.
   */
  buildDetailHref?: BuildDetailHref;
}> = ({ slug, id, backHref, buildDetailHref }) => {
  const client = usePluginClient(StatusPageApi);
  const { data, isLoading } = client.getPublishedIncident.useQuery({ slug, id });
  // Same page scope as the status page itself: a `#` reference in this
  // incident's description or updates links only to another item the SAME page
  // publishes.
  const resolveMention = usePublicMentions({
    slug,
    content: data,
    buildDetailHref: buildDetailHref ?? buildInAppDetailHref({ slug }),
  });

  useEffect(() => {
    if (!data?.title) return;
    const previous = document.title;
    document.title = data.title;
    return () => {
      document.title = previous;
    };
  }, [data?.title]);

  if (isLoading) return <LoadingShell />;
  if (!data) return <NotFoundShell backHref={backHref} kind="Incident" />;

  return (
    <DetailShell>
      <BackLink href={backHref} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
        <StatusPill
          tone={severityTone(data.severity)}
          size="sm"
          className="capitalize"
        >
          {data.severity}
        </StatusPill>
        {/* The lifecycle status, COLOURED by its status (was a neutral grey
            pill) so a reader can see the incident's current stage at a glance. */}
        <StatusPill tone={incidentStatusTone(data.status)} size="sm">
          {incidentStatusLabel(data.status)}
        </StatusPill>
      </div>
      <p className="mt-2 text-sm tabular-nums text-muted-foreground">
        Started {formatAt(data.startedAt)}
        {data.resolvedAt ? ` - resolved ${formatAt(data.resolvedAt)}` : ""}
      </p>
      {data.systems.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          Affected: {data.systems.join(", ")}
        </p>
      )}
      <Description
        description={data.description}
        resolveMention={resolveMention}
      />
      <UpdatesTimeline
        updates={data.updates}
        status={INCIDENT_STATUS_PRESENTER}
        resolveMention={resolveMention}
      />
    </DetailShell>
  );
};

export const PublicMaintenanceDetailView: React.FC<{
  slug: string;
  id: string;
  backHref: string;
  /** See PublicIncidentDetailView. */
  buildDetailHref?: BuildDetailHref;
}> = ({ slug, id, backHref, buildDetailHref }) => {
  const client = usePluginClient(StatusPageApi);
  const { data, isLoading } = client.getPublishedMaintenance.useQuery({
    slug,
    id,
  });
  // See PublicIncidentDetailView.
  const resolveMention = usePublicMentions({
    slug,
    content: data,
    buildDetailHref: buildDetailHref ?? buildInAppDetailHref({ slug }),
  });

  useEffect(() => {
    if (!data?.title) return;
    const previous = document.title;
    document.title = data.title;
    return () => {
      document.title = previous;
    };
  }, [data?.title]);

  if (isLoading) return <LoadingShell />;
  if (!data) return <NotFoundShell backHref={backHref} kind="Maintenance" />;

  return (
    <DetailShell>
      <BackLink href={backHref} />
      <div className="flex flex-wrap items-center gap-2">
        <Wrench
          className={`size-5 ${pillToneStyles[maintenanceStatusTone(data.status)].text}`}
        />
        <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
        {/* Maintenance carries no severity, so its LIFECYCLE gets the hue -
            one coloured dimension per row (see `status-tone.ts`). */}
        <StatusPill tone={maintenanceStatusTone(data.status)} size="sm">
          {maintenanceStatusLabel(data.status)}
        </StatusPill>
      </div>
      <p className="mt-2 text-sm tabular-nums text-muted-foreground">
        {formatAt(data.startAt)} - {formatAt(data.endAt)}
      </p>
      {data.systems.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          Affecting: {data.systems.join(", ")}
        </p>
      )}
      {/* What the maintenance involves - previously the page showed only the
          title, window, and affected systems. */}
      <Description
        description={data.description}
        resolveMention={resolveMention}
      />
      <UpdatesTimeline
        updates={data.updates}
        status={MAINTENANCE_STATUS_PRESENTER}
        resolveMention={resolveMention}
      />
    </DetailShell>
  );
};

/** In-app standalone route wrapper: reads slug+id from the URL. */
export const PublicIncidentDetailPage: React.FC = () => {
  const { slug = "", id = "" } = useParams();
  const backHref = resolveRoute(statusPublicRoutes.routes.page, { slug });
  return <PublicIncidentDetailView slug={slug} id={id} backHref={backHref} />;
};

export const PublicMaintenanceDetailPage: React.FC = () => {
  const { slug = "", id = "" } = useParams();
  const backHref = resolveRoute(statusPublicRoutes.routes.page, { slug });
  return <PublicMaintenanceDetailView slug={slug} id={id} backHref={backHref} />;
};

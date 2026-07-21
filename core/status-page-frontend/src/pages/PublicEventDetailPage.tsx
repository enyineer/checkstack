import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import { EmptyState, LoadingSpinner,
  StatusPill,
} from "@checkstack/ui";
import { ArrowLeft, FileQuestion, Wrench } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  StatusPageApi,
  statusPublicRoutes,
} from "@checkstack/status-page-common";
import { resolveRoute } from "@checkstack/common";
import { severityTone } from "../utils/severityTone";

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

const UpdatesTimeline: React.FC<{ updates: PublicUpdate[] }> = ({ updates }) => {
  if (updates.length === 0) return null;
  return (
    <ol className="mt-5 space-y-4 border-l border-border pl-4">
      {updates.map((u, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-border" />
          {u.statusChange && (
            <span className="mb-0.5 inline-block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {u.statusChange}
            </span>
          )}
          <p className="text-sm text-foreground">{u.message}</p>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatAt(u.at)}
          </p>
        </li>
      ))}
    </ol>
  );
};

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
}> = ({ slug, id, backHref }) => {
  const client = usePluginClient(StatusPageApi);
  const { data, isLoading } = client.getPublishedIncident.useQuery({ slug, id });

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
        <StatusPill tone="neutral" size="sm" className="capitalize">
          {data.status}
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
      <UpdatesTimeline updates={data.updates} />
    </DetailShell>
  );
};

export const PublicMaintenanceDetailView: React.FC<{
  slug: string;
  id: string;
  backHref: string;
}> = ({ slug, id, backHref }) => {
  const client = usePluginClient(StatusPageApi);
  const { data, isLoading } = client.getPublishedMaintenance.useQuery({
    slug,
    id,
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
        <Wrench className="size-5 text-status-unknown" />
        <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
        <span className="rounded-full bg-status-unknown/10 px-2 py-0.5 text-[11px] font-medium capitalize text-status-unknown">
          {data.status.replace("_", " ")}
        </span>
      </div>
      <p className="mt-2 text-sm tabular-nums text-muted-foreground">
        {formatAt(data.startAt)} - {formatAt(data.endAt)}
      </p>
      {data.systems.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          Affecting: {data.systems.join(", ")}
        </p>
      )}
      <UpdatesTimeline updates={data.updates} />
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

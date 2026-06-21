import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  EmptyState,
  LoadingSpinner,
  cn,
  formatRelativeTime,
  usePerformance,
} from "@checkstack/ui";
import { FileQuestion, Inbox } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  StatusPageApi,
  type OverallStatusSummary,
} from "@checkstack/status-page-common";
import { BlockRenderer, useStatusWidgetRenderers, STATUS } from "../renderers";
import { useLoadRendererRemotes } from "../remote-renderers";

/**
 * How often the public page re-fetches its published snapshot so the
 * "Updated" timestamp stays honest while a visitor watches during an incident.
 * Bounded (not aggressive) because the page is publicly cacheable.
 */
const PUBLIC_REFRESH_INTERVAL_MS = 60_000;

/**
 * The page-wide overall-status banner shown at the very top of the public page.
 * Reads the resolver-derived {@link OverallStatusSummary} (worst-status-wins
 * over the page's blocks) and renders it with the shared semantic status tokens,
 * so the summary always matches the widgets below it.
 */
const OverallStatusBanner: React.FC<{ summary: OverallStatusSummary }> = ({
  summary,
}) => {
  const meta = STATUS[summary.status];
  return (
    <div
      role="status"
      className="relative mb-8 overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]"
    >
      {/* Status hue as a left accent stripe + a faint full-bleed wash so the
          hue still dominates the page's one hero moment. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1.5 ${meta.solid}`}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${meta.solid} opacity-[0.06]`}
      />
      <div className="relative flex items-center gap-4 px-5 py-4 pl-6 sm:px-6 sm:py-5 sm:pl-7">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-full ${meta.soft}`}
        >
          <meta.Icon className="size-6" />
        </span>
        <span className="min-w-0 text-xl font-semibold leading-tight sm:text-2xl">
          {summary.label}
        </span>
      </div>
    </div>
  );
};

/**
 * How often the freshness line re-renders so its relative "x ago" wording stays
 * honest between snapshot refetches (the snapshot itself refreshes once a
 * minute). A 10s tick keeps "updated 12s ago" believable without churn.
 */
const FRESHNESS_TICK_MS = 10_000;

/**
 * The "Updated x ago" freshness line. Renders the snapshot's `generatedAt` as
 * RELATIVE time so a visitor reads "updated 12s ago" rather than a static
 * absolute timestamp, and ticks periodically so the wording keeps drifting
 * forward. On each successful refetch (`dataUpdatedAt` changes) a brief pulse
 * on the refresh dot signals the data is live.
 */
const FreshnessLine: React.FC<{
  generatedAt: string | Date;
  dataUpdatedAt: number;
}> = ({ generatedAt, dataUpdatedAt }) => {
  const { isLowPower } = usePerformance();

  // Re-render on a slow tick so the relative string stays current between
  // refetches; the value itself derives from `generatedAt` each render.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), FRESHNESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        // Keyed on the fetch timestamp so the pulse animation restarts on every
        // successful refetch, giving a subtle "just refreshed" affordance.
        // Static dot on low-power devices (no infinite ping).
        key={dataUpdatedAt}
        aria-hidden
        className={cn(
          "inline-block size-1.5 rounded-full bg-primary/60",
          !isLowPower && "animate-ping",
        )}
      />
      <span>
        Updated {formatRelativeTime(generatedAt)} - auto-updates every minute
      </span>
    </p>
  );
};

/**
 * The PUBLIC status page view. Renders ENTIRELY from the single
 * `getPublishedStatusPage` response — it makes no other data call, so it can
 * only ever show what the publisher placed on the page. Takes `slug` as a prop
 * so it can be driven by the in-app standalone route (slug from the URL) OR by
 * the separate custom-domain public bundle (slug from `/api/config`).
 */
export const PublicStatusPageView: React.FC<{ slug: string }> = ({ slug }) => {
  const client = usePluginClient(StatusPageApi);
  const renderers = useStatusWidgetRenderers();
  const loadRendererRemotes = useLoadRendererRemotes();
  const { data, isLoading, dataUpdatedAt } =
    client.getPublishedStatusPage.useQuery(
      { slug },
      { refetchInterval: PUBLIC_REFRESH_INTERVAL_MS },
    );

  // Load any third-party renderer remotes this page needs. No-op in the admin
  // app (renderers already present); the custom-domain bundle loads them, after
  // which the renderer map updates reactively. Built-in widgets need nothing.
  const remotes = data?.rendererRemotes;
  useEffect(() => {
    if (remotes && remotes.length > 0) loadRendererRemotes(remotes);
  }, [remotes, loadRendererRemotes]);

  // Reflect the page name in the browser tab (restored on unmount).
  useEffect(() => {
    if (!data?.title) return;
    const previous = document.title;
    document.title = data.title;
    return () => {
      document.title = previous;
    };
  }, [data?.title]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <EmptyState
          icon={<FileQuestion className="h-12 w-12" />}
          title="Status page not found"
          description="This status page does not exist or is not published."
        />
      </div>
    );
  }

  // Per-page brand color overrides the design token at the page root.
  const style: React.CSSProperties & Record<string, string> = {};
  if (data.theme.brandColorHsl) style["--primary"] = data.theme.brandColorHsl;

  return (
    <div style={style} className="min-h-screen bg-background text-foreground">
      {/* Brand accent + a soft wash behind the header for depth. */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/[0.07] to-transparent"
        />
        <div className="relative mx-auto w-full max-w-3xl px-4 pb-16 pt-14 sm:px-6">
          <header className="mb-10 flex flex-col items-center gap-4 text-center">
            {data.theme.logoUrl && (
              <img
                src={data.theme.logoUrl}
                alt=""
                className="h-12 max-w-[200px] object-contain"
              />
            )}
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {data.title}
            </h1>
            <FreshnessLine
              generatedAt={data.generatedAt}
              dataUpdatedAt={dataUpdatedAt}
            />
          </header>

          <OverallStatusBanner summary={data.overallStatus} />

          {data.blocks.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-12 w-12" />}
              title="Nothing here yet"
              description="This status page has no content yet."
            />
          ) : (
            <div className="space-y-5">
              {data.blocks.map((block) => (
                <BlockRenderer
                  key={block.id}
                  block={block}
                  renderers={renderers}
                />
              ))}
            </div>
          )}

          <footer className="mt-16 flex flex-col items-center gap-1 border-t border-border pt-6 text-center text-xs text-muted-foreground">
            <span>
              Powered by{" "}
              <a
                href="https://checkstack.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground hover:text-primary hover:underline"
              >
                Checkstack
              </a>
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
};

/**
 * Route wrapper: the in-app standalone route at `/status/:slug`. Reads the slug
 * from the URL and renders the shared view.
 */
export const PublicStatusPage: React.FC = () => {
  const { slug = "" } = useParams();
  return <PublicStatusPageView slug={slug} />;
};

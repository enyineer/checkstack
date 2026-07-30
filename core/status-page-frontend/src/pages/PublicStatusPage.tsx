import React, { useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  EmptyState,
  LoadingSpinner,
  Input,
  Button,
  Checkbox,
  Label,
  cn,
  formatRelativeTime,
  usePerformance,
} from "@checkstack/ui";
import { FileQuestion, Inbox, Mail, CheckCircle2 } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  StatusPageApi,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_CATEGORY_LABELS,
  DEFAULT_SUBSCRIPTION_CATEGORIES,
  type SubscriptionCategory,
  type SubscribableSystem,
  type OverallStatusSummary,
} from "@checkstack/status-page-common";
import {
  BlockRenderer,
  useStatusWidgetRenderers,
  STATUS,
  StatusDetailLinkContext,
  StatusMentionContext,
  type BuildDetailHref,
} from "../renderers";
import { usePublicMentions } from "../use-public-mentions";
import { buildInAppDetailHref } from "../public-detail-href";
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
 * Anonymous email-subscription form + double-opt-in / unsubscribe handling. On
 * mount it acts on a `?verify=` / `?unsubscribe=` token in the REAL browser URL
 * (the public bundle's router is in-memory, so query state lives on
 * `location.search`). The subscribe call ALWAYS resolves ok server-side, so the
 * UI never reveals whether an address was already subscribed.
 */
const SubscribeSection: React.FC<{
  slug: string;
  /** Systems this page surfaces, so a visitor can scope to a subset. */
  systems: SubscribableSystem[];
}> = ({ slug, systems }) => {
  const client = usePluginClient(StatusPageApi);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Which update kinds to receive. Defaults: incidents + maintenance on, health
  // off - the same defaults the backend applies when none are sent.
  const [categories, setCategories] = useState<SubscriptionCategory[]>([
    ...DEFAULT_SUBSCRIPTION_CATEGORIES,
  ]);
  // "all" (every system the page shows) vs "selected" (a chosen subset).
  const [systemsMode, setSystemsMode] = useState<"all" | "selected">("all");
  const [selectedSystems, setSelectedSystems] = useState<string[]>([]);
  const subscribeMutation = client.subscribeToStatusPage.useMutation();
  const verifyMutation = client.verifyStatusPageSubscription.useMutation();
  const unsubscribeMutation = client.unsubscribeFromStatusPage.useMutation();

  // Act on a verify / unsubscribe token present in the page URL, once.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    const verify = params.get("verify");
    const unsubscribe = params.get("unsubscribe");
    if (verify) {
      void verifyMutation
        .mutateAsync({ token: verify })
        .then(() => setNotice("Your subscription is confirmed."))
        .catch(() => setNotice("Your subscription is confirmed."));
    } else if (unsubscribe) {
      void unsubscribeMutation
        .mutateAsync({ token: unsubscribe })
        .then(() => setNotice("You have been unsubscribed."))
        .catch(() => setNotice("You have been unsubscribed."));
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCategory = (category: SubscriptionCategory, on: boolean) => {
    setCategories((prev) =>
      on ? [...new Set([...prev, category])] : prev.filter((c) => c !== category),
    );
  };

  const toggleSystem = (id: string, on: boolean) => {
    setSelectedSystems((prev) =>
      on ? [...new Set([...prev, id])] : prev.filter((s) => s !== id),
    );
  };

  const noCategories = categories.length === 0;

  const onSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // At least one category is required: an empty set would be silently clamped
    // to the defaults server-side, which would surprise a visitor who thinks
    // they opted out. Guard here so intent and outcome always agree.
    if (noCategories) return;
    // Only send systemIds when the visitor chose a specific subset; the backend
    // treats an omitted list (and any unknown ids) as "all systems".
    const systemIds =
      systemsMode === "selected" && selectedSystems.length > 0
        ? selectedSystems
        : undefined;
    try {
      await subscribeMutation.mutateAsync({
        slug,
        email: email.trim(),
        categories,
        ...(systemIds ? { systemIds } : {}),
      });
    } catch {
      // Fall through to the same neutral confirmation (no enumeration).
    }
    setEmail("");
    setNotice(
      "Check your inbox for a confirmation link to finish subscribing.",
    );
  };

  return (
    <section className="mt-10 rounded-[var(--d-card-r)] border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Subscribe to updates</h3>
      </div>
      {notice ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-status-ok" />
          {notice}
        </p>
      ) : (
        <form onSubmit={onSubscribe} className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
            />
            <Button
              type="submit"
              disabled={subscribeMutation.isPending || noCategories}
              className="sm:shrink-0"
            >
              Subscribe
            </Button>
          </div>

          {/* Which kinds of update to receive. */}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">
              Notify me about
            </legend>
            {SUBSCRIPTION_CATEGORIES.map((category) => {
              const id = `subscribe-category-${category}`;
              return (
                <div key={category} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={categories.includes(category)}
                    onCheckedChange={(on) => toggleCategory(category, on)}
                  />
                  <Label htmlFor={id} className="cursor-pointer font-normal">
                    {SUBSCRIPTION_CATEGORY_LABELS[category]}
                  </Label>
                </div>
              );
            })}
            {noCategories && (
              <p role="alert" className="text-xs text-destructive">
                Select at least one kind of update.
              </p>
            )}
          </fieldset>

          {/* Which systems to receive updates for (only when the page has any). */}
          {systems.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">
                Systems
              </legend>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="subscribe-systems-all"
                  name="subscribe-systems-mode"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={systemsMode === "all"}
                  onChange={() => setSystemsMode("all")}
                />
                <Label
                  htmlFor="subscribe-systems-all"
                  className="cursor-pointer font-normal"
                >
                  All systems on this page
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="subscribe-systems-selected"
                  name="subscribe-systems-mode"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={systemsMode === "selected"}
                  onChange={() => setSystemsMode("selected")}
                />
                <Label
                  htmlFor="subscribe-systems-selected"
                  className="cursor-pointer font-normal"
                >
                  Only selected systems
                </Label>
              </div>
              {systemsMode === "selected" && (
                <div className="ml-6 mt-1 space-y-2 border-l border-border pl-4">
                  {systems.map((system) => {
                    const id = `subscribe-system-${system.id}`;
                    return (
                      <div key={system.id} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={selectedSystems.includes(system.id)}
                          onCheckedChange={(on) => toggleSystem(system.id, on)}
                        />
                        <Label
                          htmlFor={id}
                          className="cursor-pointer truncate font-normal"
                        >
                          {system.name}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}
        </form>
      )}
    </section>
  );
};

/**
 * The PUBLIC status page view. Renders ENTIRELY from the single
 * `getPublishedStatusPage` response — it makes no other data call, so it can
 * only ever show what the publisher placed on the page. Takes `slug` as a prop
 * so it can be driven by the in-app standalone route (slug from the URL) OR by
 * the separate custom-domain public bundle (slug from `/api/config`).
 */
export const PublicStatusPageView: React.FC<{
  slug: string;
  /** Builds detail-page hrefs for incident/maintenance items; omit to disable. */
  buildDetailHref?: BuildDetailHref;
}> = ({ slug, buildDetailHref }) => {
  const client = usePluginClient(StatusPageApi);
  const renderers = useStatusWidgetRenderers();
  const loadRendererRemotes = useLoadRendererRemotes();
  const { data, isLoading, dataUpdatedAt } =
    client.getPublishedStatusPage.useQuery(
      { slug },
      { refetchInterval: PUBLIC_REFRESH_INTERVAL_MS },
    );

  // Resolve `#` mentions across everything this page renders, in one batched
  // request. Scoped to THIS page: a reference resolves only when the page also
  // publishes the referenced item, so an internal-only incident mentioned in a
  // public update stays plain text.
  const resolveMention = usePublicMentions({
    slug,
    content: data?.blocks,
    buildDetailHref: buildDetailHref ?? null,
  });

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
            <StatusDetailLinkContext.Provider value={buildDetailHref ?? null}>
              <StatusMentionContext.Provider value={resolveMention}>
                <div className="space-y-5">
                  {data.blocks.map((block) => (
                    <BlockRenderer
                      key={block.id}
                      block={block}
                      renderers={renderers}
                    />
                  ))}
                </div>
              </StatusMentionContext.Provider>
            </StatusDetailLinkContext.Provider>
          )}

          {data.emailSubscriptionsEnabled && (
            <SubscribeSection
              slug={slug}
              systems={data.subscribableSystems ?? []}
            />
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
  // Detail linking on the ADMIN origin. The custom-domain bundle passes its own
  // builder (its pages live at the host root); without one here, this page
  // would render item titles and `#` mentions as plain text while the same
  // page on a custom domain linked them.
  return (
    <PublicStatusPageView
      slug={slug}
      buildDetailHref={buildInAppDetailHref({ slug })}
    />
  );
};

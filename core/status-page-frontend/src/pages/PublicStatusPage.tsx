import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import { LoadingSpinner } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { StatusPageApi } from "@checkstack/status-page-common";
import { BlockRenderer, useStatusWidgetRenderers } from "../renderers";
import { useLoadRendererRemotes } from "../remote-renderers";

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
  const { data, isLoading } = client.getPublishedStatusPage.useQuery({ slug });

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
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-4 text-center">
        <h1 className="text-xl font-semibold">Status page not found</h1>
        <p className="text-sm text-muted-foreground">
          This status page does not exist or is not published.
        </p>
      </div>
    );
  }

  // Per-page brand color overrides the design token at the page root.
  const style: React.CSSProperties & Record<string, string> = {};
  if (data.theme.brandColorHsl) style["--primary"] = data.theme.brandColorHsl;

  const updated = new Date(data.generatedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

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
            <p className="text-xs text-muted-foreground">Updated {updated}</p>
          </header>

          {data.blocks.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              This status page has no content yet.
            </p>
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

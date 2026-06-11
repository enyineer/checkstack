import React from "react";
import { useParams } from "react-router-dom";
import { LoadingSpinner } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { StatusPageApi } from "@checkstack/status-page-common";
import { BlockRenderer } from "../renderers";

/**
 * The PUBLIC status page. Renders ENTIRELY from the single
 * `getPublishedStatusPage` response — it makes no other data call, so it can
 * only ever show what the publisher placed on the page. Registered as a
 * `standalone` route, so it renders with NO admin chrome.
 */
export const PublicStatusPage: React.FC = () => {
  const { slug = "" } = useParams();
  const client = usePluginClient(StatusPageApi);
  const { data, isLoading } = client.getPublishedStatusPage.useQuery({ slug });

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

  return (
    <div style={style} className="min-h-screen bg-background text-foreground">
      {/* Thin brand accent line at the very top. */}
      <div className="h-1 w-full bg-primary" />
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
        <header className="mb-8 flex flex-col items-center gap-3 text-center">
          {data.theme.logoUrl && (
            <img
              src={data.theme.logoUrl}
              alt=""
              className="h-10 object-contain"
            />
          )}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {data.title}
          </h1>
        </header>

        <div className="space-y-5">
          {data.blocks.map((block) => (
            <BlockRenderer key={block.id} block={block} />
          ))}
        </div>

        <footer className="mt-12 border-t border-border pt-5 text-center text-xs text-muted-foreground">
          Updated{" "}
          {new Date(data.generatedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </footer>
      </div>
    </div>
  );
};

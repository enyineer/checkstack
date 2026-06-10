import React from "react";
import { useParams } from "react-router-dom";
import { LoadingSpinner } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { StatusPageApi } from "@checkstack/status-page-common";
import { BlockRenderer } from "../renderers";

/**
 * The PUBLIC status page. Renders ENTIRELY from the single
 * `getPublishedStatusPage` response — it makes no other data call, so it can
 * only ever show what the publisher placed on the page. Carries no access rule,
 * so it renders for anonymous visitors.
 *
 * NOTE: this currently renders inside the main app's route tree. A fully
 * separate public bundle + custom-domain host routing is the next phase; the
 * data-isolation guarantee is server-enforced regardless.
 */
export const PublicStatusPage: React.FC = () => {
  const { slug = "" } = useParams();
  const client = usePluginClient(StatusPageApi);
  const { data, isLoading } = client.getPublishedStatusPage.useQuery({ slug });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
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
    <div style={style} className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <header className="mb-8 flex items-center gap-3">
        {data.theme.logoUrl && (
          <img src={data.theme.logoUrl} alt="" className="h-8 object-contain" />
        )}
        <h1 className="text-2xl font-bold">{data.title}</h1>
      </header>
      <div className="space-y-4">
        {data.blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} />
        ))}
      </div>
      <footer className="mt-10 text-center text-xs text-muted-foreground">
        Updated {new Date(data.generatedAt).toLocaleString()}
      </footer>
    </div>
  );
};

import { useMemo } from "react";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiProvider,
  ApiRegistryBuilder,
  loggerApiRef,
  accessApiRef,
  fetchApiRef,
  rpcApiRef,
  RuntimeConfigProvider,
  useRuntimeConfigLoading,
  useRuntimeConfig,
  useRuntimeConfigContext,
  OrpcQueryProvider,
} from "@checkstack/frontend-api";
import { publicSlugFromPath } from "./public-path";
import {
  LoadingSpinner,
  PerformanceProvider,
  ThemeProvider,
  DensityProvider,
  ToastProvider,
} from "@checkstack/ui";
import {
  PublicStatusPageView,
  PublicIncidentDetailView,
  PublicMaintenanceDetailView,
  RendererRemotesProvider,
  type BuildDetailHref,
} from "@checkstack/status-page-frontend";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";
import { CoreRpcApi } from "./apis/rpc-api";
import { loadRendererRemotes } from "./public-renderer-remotes";

/**
 * The minimal PUBLIC bundle, mounted only on a custom-domain status host (see
 * `main.tsx`). It deliberately ships NONE of the admin app: no sidebar, auth,
 * signals, command palette, plugin loader, or router. It boots the smallest
 * provider stack that `usePluginClient` needs and renders exactly one published
 * status page, whose slug comes from the host-aware `/api/config`.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      {children}
    </div>
  );
}

/**
 * The trailing `/incident/:id` or `/maintenance/:id` of the current path,
 * regardless of any leading public prefix (`/statuspage/view/:slug` on the admin
 * origin, or bare `/` on a custom domain). Drives the MemoryRouter's initial
 * entry so a deep-linked / full-navigation detail URL renders the right page.
 */
function eventDetailFromPath(
  pathname: string,
): { kind: "incident" | "maintenance"; id: string } | null {
  const match = pathname.match(/\/(incident|maintenance)\/([^/]+)\/?$/);
  if (!match) return null;
  const kind = match[1] === "maintenance" ? "maintenance" : "incident";
  return { kind, id: decodeURIComponent(match[2] ?? "") };
}

/** Route element for the incident detail page (reads `:id` from the router). */
const IncidentRoute: React.FC<{ slug: string; backHref: string }> = ({
  slug,
  backHref,
}) => {
  const { id = "" } = useParams();
  return (
    <PublicIncidentDetailView slug={slug} id={id} backHref={backHref} />
  );
};

/** Route element for the maintenance detail page. */
const MaintenanceRoute: React.FC<{ slug: string; backHref: string }> = ({
  slug,
  backHref,
}) => {
  const { id = "" } = useParams();
  return (
    <PublicMaintenanceDetailView slug={slug} id={id} backHref={backHref} />
  );
};

function PublicRoot() {
  const isLoading = useRuntimeConfigLoading();
  const { config } = useRuntimeConfigContext();
  const { baseUrl } = useRuntimeConfig();

  // Core APIs only — no plugin API factories (the public bundle loads no
  // plugins). `usePluginClient(StatusPageApi)` resolves purely from rpcApiRef.
  const registry = useMemo(
    () =>
      new ApiRegistryBuilder()
        .register(loggerApiRef, new ConsoleLoggerApi())
        .register(accessApiRef, {
          useAccess: () => ({ loading: false, allowed: true }),
          useCanAccessType: () => ({ loading: false, allowed: true }),
          useSurfaceAccess: () => ({ loading: false, allowed: true }),
          useRouteAccess: () => ({ loading: false, allowed: true }),
          useResourceAccess: () => ({
            loading: false,
            hasGlobal: true,
            canAccess: () => true,
          }),
          useIsAuthenticated: () => ({
            loading: false,
            isAuthenticated: false,
          }),
          useProcedureAccess: () => ({ loading: false, allowed: true }),
        })
        .registerFactory(fetchApiRef, () => new CoreFetchApi(baseUrl))
        .registerFactory(rpcApiRef, () => new CoreRpcApi(baseUrl))
        .build(),
    [baseUrl],
  );

  if (isLoading) {
    return (
      <FullScreen>
        <LoadingSpinner />
      </FullScreen>
    );
  }

  // The slug comes from the custom-domain bootstrap hint, or - for a same-origin
  // public path like `/statuspage/view/:slug` - from the URL itself.
  const slug =
    config?.publicHost?.slug ??
    publicSlugFromPath(
      globalThis.location?.pathname ?? "",
      config?.publicPathPrefixes,
    );
  if (!slug) {
    // Reached this bundle on a host with no published page bound (or the
    // bootstrap hint was lost). Show a neutral message, never the admin app.
    return (
      <FullScreen>
        <div className="px-4 text-center">
          <h1 className="text-xl font-semibold">No status page here</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This domain is not connected to a published status page.
          </p>
        </div>
      </FullScreen>
    );
  }

  // On a custom-domain host the page lives at the host root (`/incident/:id`);
  // on the admin origin it lives under the public prefix
  // (`/statuspage/view/:slug/incident/:id`). Detail links are plain `<a href>`
  // full navigations to that REAL path, so they are shareable and pass the host
  // allow-list; the MemoryRouter below only decides WHICH page to show.
  const isCustomDomain = Boolean(config?.publicHost);
  const realBase = isCustomDomain ? "" : `/statuspage/view/${slug}`;
  const buildDetailHref: BuildDetailHref = ({ kind, id }) =>
    `${realBase}/${kind}/${id}`;
  const backHref = realBase || "/";

  const detail = eventDetailFromPath(globalThis.location?.pathname ?? "");
  const initialEntry = detail ? `/${detail.kind}/${detail.id}` : "/";

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider registry={registry}>
        <OrpcQueryProvider>
          {/* PerformanceProvider depends on useToast, so ToastProvider must
              wrap it (mirrors the admin app's provider order). */}
          <ToastProvider>
            <PerformanceProvider>
              {/* Lets the page load third-party widget renderer remotes on
                  demand (built-in widgets need none). */}
              <RendererRemotesProvider value={loadRendererRemotes}>
                {/* Minimal in-memory router: the status view + the two detail
                    pages. Seeded from the current path so a deep link renders
                    correctly; navigation between them is full-page. */}
                <MemoryRouter initialEntries={[initialEntry]}>
                  <Routes>
                    <Route
                      path="/incident/:id"
                      element={
                        <IncidentRoute slug={slug} backHref={backHref} />
                      }
                    />
                    <Route
                      path="/maintenance/:id"
                      element={
                        <MaintenanceRoute slug={slug} backHref={backHref} />
                      }
                    />
                    <Route
                      path="*"
                      element={
                        <PublicStatusPageView
                          slug={slug}
                          buildDetailHref={buildDetailHref}
                        />
                      }
                    />
                  </Routes>
                </MemoryRouter>
              </RendererRemotesProvider>
            </PerformanceProvider>
          </ToastProvider>
        </OrpcQueryProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

export function PublicApp() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="checkstack-ui-theme">
      <DensityProvider className="contents">
        <RuntimeConfigProvider>
          <PublicRoot />
        </RuntimeConfigProvider>
      </DensityProvider>
    </ThemeProvider>
  );
}

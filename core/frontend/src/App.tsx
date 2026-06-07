import { useMemo, useState, useSyncExternalStore } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
} from "react-router-dom";
import { Menu } from "lucide-react";
import {
  ApiProvider,
  ApiRegistryBuilder,
  loggerApiRef,
  accessApiRef,
  fetchApiRef,
  rpcApiRef,
  useApi,
  ExtensionSlot,
  getLazyContribution,
  pluginRegistry,
  DashboardSlot,
  NavbarRightSlot,
  NavbarLeftSlot,
  NavbarCenterSlot,
  RuntimeConfigProvider,
  useRuntimeConfigLoading,
  useRuntimeConfig,
  useRuntimeConfigContext,
  OrpcQueryProvider,
} from "@checkstack/frontend-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";
import { CoreRpcApi } from "./apis/rpc-api";
import {
  AccessDenied,
  NotFound,
  LoadingSpinner,
  ToastProvider,
  AmbientBackground,
  PerformanceProvider,
  usePerformance,
  cn,
} from "@checkstack/ui";
import { SignalProvider } from "@checkstack/signal-frontend";
import { SignalAutoInvalidator } from "./components/SignalAutoInvalidator";
import { SessionProvider } from "@checkstack/auth-frontend";
import { Sidebar } from "./components/Sidebar";
import { usePluginLifecycle } from "./hooks/usePluginLifecycle";
import { useCommands, useGlobalShortcuts } from "@checkstack/command-frontend";
import { AnnouncementBanner } from "@checkstack/announcement-frontend";

// Create a stable query client instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default stale time of 30 seconds for all queries
      staleTime: 30_000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Don't refetch on window focus by default (can be overridden per query)
      refetchOnWindowFocus: false,
      // Custom retry logic: don't retry on 401/403 auth errors
      // These are definitive responses that won't succeed on retry
      retry: (failureCount, error) => {
        // Check if it's an HTTP error with status code
        const status = (error as { status?: number })?.status;
        // Also check for oRPC error codes
        const code = (error as { code?: string })?.code;

        // Don't retry on authentication/authorization errors
        if (status === 401 || status === 403) return false;
        if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return false;

        // Default: retry up to 3 times for other errors
        return failureCount < 3;
      },
    },
    mutations: {
      // Mutations should not retry by default (user can re-submit)
      retry: false,
    },
  },
});

// Stable references for `useSyncExternalStore` subscription to the plugin
// registry (module scope so they don't change identity across renders).
const subscribePluginRegistry = (onChange: () => void) =>
  pluginRegistry.subscribe(onChange);
const getRegisteredPlugins = () => pluginRegistry.getPlugins();

// Shared fallbacks for lazily-loaded plugin route pages. The loading state
// mirrors RouteGuard's access-loading look (usePerformance-aware spinner); the
// error state contains a failed page load instead of white-screening the shell.
const ROUTE_SUSPENSE_FALLBACK = (
  <div className="h-full flex items-center justify-center p-8">
    <LoadingSpinner />
  </div>
);
const ROUTE_ERROR_FALLBACK = (
  <div className="h-full flex items-center justify-center p-8 text-sm text-muted-foreground">
    This page failed to load. Try reloading.
  </div>
);

/**
 * Component that registers global keyboard shortcuts for all commands.
 * Uses react-router's navigate for SPA navigation.
 */
function GlobalShortcuts() {
  const { commands } = useCommands();
  const navigate = useNavigate();

  // Pass "*" as access since backend already filters by access
  useGlobalShortcuts(commands, navigate, ["*"]);

  // This component renders nothing - it only registers event listeners
  return <></>;
}

const RouteGuard: React.FC<{
  children: React.ReactNode;
  accessRule?: string;
}> = ({ children, accessRule }) => {
  const accessApi = useApi(accessApiRef);
  // If there's an access rule requirement, use useAccess with a minimal AccessRule-like object
  // the route.accessRule is already the qualified access rule ID string
  const { allowed, loading } = accessRule
    ? accessApi.useAccess({ id: accessRule } as Parameters<
        typeof accessApi.useAccess
      >[0])
    : { allowed: true, loading: false };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (!allowed) {
    return <AccessDenied />;
  }

  return <>{children}</>;
};

/**
 * Inner component that handles plugin lifecycle and reactive routing.
 * Must be inside SignalProvider to receive plugin signals.
 */
function AppContent() {
  // Enable dynamic plugin loading/unloading via signals
  const { isLowPower } = usePerformance();
  usePluginLifecycle();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <BrowserRouter>
      {/* Global keyboard shortcuts for commands */}
      <GlobalShortcuts />
      <AmbientBackground className="text-foreground font-sans">
        {/* App shell: a full-height column - the header spans the FULL width on
            top, and below it a row holds the left nav (persistent on desktop,
            drawer on mobile) beside the scrollable content. */}
        <div className="flex flex-col h-screen overflow-hidden">
          <AnnouncementBanner />
          <header
            className={cn(
              "shrink-0 p-4 shadow-sm border-b border-border z-40 relative",
              isLowPower ? "bg-card" : "bg-card/80 backdrop-blur-sm",
            )}
          >
              <div className="flex items-center justify-between gap-4">
                {/* Left: hamburger (mobile), logo, optional navbar-left slot */}
                <div className="flex items-center gap-4 md:gap-8 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(true)}
                    aria-label="Open navigation"
                    className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                  <Link to="/" className="flex items-center gap-2">
                    <img src="/favicon.svg" alt="" className="w-7 h-7" />
                    <h1 className="text-xl font-bold text-primary">Checkstack</h1>
                  </Link>
                  <nav className="hidden md:flex gap-1">
                    <ExtensionSlot slot={NavbarLeftSlot} />
                  </nav>
                </div>
                {/* Center: Search (flexible width, centered) */}
                <div className="flex-1 flex justify-center max-w-md">
                  <ExtensionSlot slot={NavbarCenterSlot} />
                </div>
                {/* Right: Other navbar items */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ExtensionSlot slot={NavbarRightSlot} />
                </div>
              </div>
          </header>
          <div className="flex flex-1 min-h-0">
            <Sidebar
              mobileOpen={mobileNavOpen}
              onMobileOpenChange={setMobileNavOpen}
            />
            <main className="flex flex-1 min-w-0 flex-col overflow-y-auto">
              {/* `flex-1 min-h-0 flex flex-col` establishes a bounded height
                  chain so a page can fill the viewport (PageLayout `fillHeight`)
                  and scroll an inner pane instead of the whole page. Tall normal
                  pages still overflow into `main`'s scroll (verified). */}
              <div className="flex flex-1 min-h-0 flex-col px-3 py-4 md:p-8 w-full max-w-7xl mx-auto">
                <Routes>
            <Route
              path="/"
              element={
                <div className="space-y-6">
                  <ExtensionSlot slot={DashboardSlot} />
                </div>
              }
            />
            {/* Plugin Routes. Each plugin declares its page via a `load` thunk;
                the framework (`getLazyContribution`) code-splits it and wraps it
                in Suspense + a per-plugin error boundary, so the page chunk is
                fetched on navigation (not in the initial load) and a failing
                page degrades gracefully instead of crashing the shell. */}
            {pluginRegistry.getAllRoutes().map((route) => {
              // A route is either lazy (`load`, the default — framework wraps it
              // in Suspense + error boundary) or eager (`element`, rare — e.g.
              // the login page on the critical path).
              let element: React.ReactNode;
              if (route.load) {
                const PageElement = getLazyContribution({
                  id: route.path,
                  load: route.load,
                  suspenseFallback: ROUTE_SUSPENSE_FALLBACK,
                  errorFallback: ROUTE_ERROR_FALLBACK,
                });
                element = <PageElement />;
              } else {
                element = route.element;
              }
              return (
                <Route
                  key={route.path}
                  path={route.path}
                  element={
                    <RouteGuard accessRule={route.accessRule}>
                      {element}
                    </RouteGuard>
                  }
                />
              );
            })}
                  {/* Catch-all: show Not Found for unmatched routes */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </div>
            </main>
          </div>
        </div>
      </AmbientBackground>
    </BrowserRouter>
  );
}

/**
 * App wrapper that provides APIs and waits for runtime config to load.
 */
function AppWithApis() {
  const isConfigLoading = useRuntimeConfigLoading();
  const { error: configError, config: runtimeConfig } =
    useRuntimeConfigContext();
  const { baseUrl } = useRuntimeConfig();

  // Subscribe to the plugin registry so the API registry below rebuilds when
  // plugins register/unregister at runtime (e.g. a remotely-installed plugin),
  // picking up their `apis` factories. `getPlugins()` returns an immutable
  // snapshot whose reference changes on every registry change.
  const plugins = useSyncExternalStore(
    subscribePluginRegistry,
    getRegisteredPlugins,
  );

  const apiRegistry = useMemo(() => {
    // Initialize API Registry with core apiRefs
    const registryBuilder = new ApiRegistryBuilder()
      .register(loggerApiRef, new ConsoleLoggerApi())
      .register(accessApiRef, {
        // Default to allow all if no auth plugin present (mirrors useAccess).
        useAccess: () => ({ loading: false, allowed: true }),
        useIsAuthenticated: () => ({ loading: false, isAuthenticated: true }),
      })
      .registerFactory(fetchApiRef, (_registry) => {
        return new CoreFetchApi(baseUrl);
      })
      .registerFactory(rpcApiRef, (_registry) => {
        return new CoreRpcApi(baseUrl);
      });

    // Register API factories from plugins
    for (const plugin of plugins) {
      if (plugin.apis) {
        for (const api of plugin.apis) {
          registryBuilder.registerFactory(api.ref, (registry) => {
            // Adapt registry map to dependency getter
            const deps = {
              get: <T,>(ref: { id: string }) => registry.get(ref.id) as T,
            };
            return api.factory(deps);
          });
        }
      }
    }

    return registryBuilder.build();
  }, [baseUrl, plugins]);

  // Show spinner while fetching runtime config and probing baseUrl.
  if (isConfigLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    );
  }

  // Config probe failed — baseUrl is not reachable (misconfigured BASE_URL).
  // Surface a clear diagnostic rather than a broken empty dashboard.
  if (!runtimeConfig || configError) {
    // Derive the suggested BASE_URL from the URL the user actually has open
    // in their browser — that's almost certainly the value they want.
    const suggestedBaseUrl =
      globalThis.window !== undefined && globalThis.location?.origin
        ? globalThis.location.origin
        : "http://localhost:3000";

    return (
      <div className="h-screen flex items-center justify-center bg-background p-8">
        <div className="max-w-lg w-full rounded-xl border border-destructive/50 bg-destructive/10 p-8 space-y-4 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-bold text-destructive">
            Cannot connect to Checkstack backend
          </h1>
          <p className="text-sm text-muted-foreground">
            The app loaded but its configured{" "}
            <code className="bg-muted rounded px-1">BASE_URL</code> is not
            reachable. Make sure it matches the URL + port your container or
            reverse proxy exposes.
          </p>
          <div className="text-left bg-muted rounded-lg p-4 space-y-1 text-sm font-mono">
            <p className="text-muted-foreground">
              # Based on the URL you opened, try:
            </p>
            <p className="text-foreground">BASE_URL={suggestedBaseUrl}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            After updating your{" "}
            <code className="bg-muted rounded px-1">.env</code>, recreate the
            container:
          </p>
          <div className="text-left bg-muted rounded-lg p-4 text-sm font-mono">
            <p className="text-foreground">
              docker compose up -d --force-recreate
            </p>
          </div>
          {configError && (
            <p className="text-xs text-destructive/70 break-all">
              {configError.message}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider registry={apiRegistry}>
        <OrpcQueryProvider>
          <SessionProvider>
            <SignalProvider backendUrl={baseUrl}>
              <SignalAutoInvalidator />
              <ToastProvider>
                <PerformanceProvider>
                  <AppContent />
                </PerformanceProvider>
              </ToastProvider>
            </SignalProvider>
          </SessionProvider>
        </OrpcQueryProvider>
      </ApiProvider>
      {/* DevTools only in development - toggle with keyboard or floating button */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}

function App() {
  return (
    <RuntimeConfigProvider>
      <AppWithApis />
    </RuntimeConfigProvider>
  );
}

export default App;

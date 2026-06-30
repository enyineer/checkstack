import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Outlet,
  useNavigate,
} from "react-router-dom";
import { Menu, AlertTriangle } from "lucide-react";
import type { AccessRule } from "@checkstack/common";
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
  readBootstrap,
} from "@checkstack/frontend-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";
import { CoreRpcApi } from "./apis/rpc-api";
import {
  AccessDenied,
  NotFound,
  ToastProvider,
  AmbientBackground,
  PerformanceProvider,
  usePerformance,
  ThemeProvider,
  DensityProvider,
  cn,
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
} from "@checkstack/ui";
import { SignalProvider } from "@checkstack/signal-frontend";
import { SignalAutoInvalidator } from "./components/SignalAutoInvalidator";
import {
  SessionProvider,
  authApiRef,
  defaultAuthApi,
} from "@checkstack/auth-frontend";
import { Sidebar } from "./components/Sidebar";
import { HelpMenu } from "./components/HelpMenu";
import { PageSkeleton, ShellSkeleton } from "./components/AppSkeletons";
import { usePluginLifecycle } from "./hooks/usePluginLifecycle";
import { loadLocalPlugins, loadRemotePlugins } from "./plugin-loader";
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

// Shared fallbacks for lazily-loaded plugin route pages. The loading state is a
// content-area skeleton (the shell chrome stays rendered around it, so only the
// page content streams in); the error state contains a failed page load instead
// of white-screening the shell.
const ROUTE_SUSPENSE_FALLBACK = <PageSkeleton />;

/**
 * Friendly, actionable fallback for a hard failure (a route page that throws /
 * fails to load, or a render error in the shell itself). Mirrors the look of
 * `@checkstack/ui`'s `QueryErrorState` — an `error`-variant Alert with a clear
 * message — but the recovery action reloads the whole page rather than retrying
 * a single query, since at this level the failed module/render can't be retried
 * in place.
 */
const ErrorFallback: React.FC<{ title: string; description: string }> = ({
  title,
  description,
}) => (
  <div className="h-full flex items-center justify-center p-8">
    <div className="w-full max-w-md">
      <Alert variant="error">
        <AlertIcon>
          <AlertTriangle className="h-4 w-4" />
        </AlertIcon>
        <AlertContent>
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </AlertContent>
        <Button
          variant="outline"
          size="sm"
          onClick={() => globalThis.location.reload()}
          className="shrink-0"
        >
          Reload page
        </Button>
      </Alert>
    </div>
  </div>
);

const ROUTE_ERROR_FALLBACK = (
  <ErrorFallback
    title="This page failed to load"
    description="Something went wrong while loading this page. Reloading usually fixes it."
  />
);

// Standalone (public, no-chrome) routes - e.g. a status page reached via
// in-admin navigation - must NOT flash the admin content skeleton. Direct loads
// of these paths are served by the lean public bundle (see main.tsx); this
// neutral themed screen only covers the brief lazy-chunk load during SPA nav.
const STANDALONE_SUSPENSE_FALLBACK = <div className="min-h-screen bg-background" />;

/**
 * Top-level error boundary for the app shell. A render error OUTSIDE a plugin
 * contribution (e.g. in the chrome, a slot, or a provider) would otherwise
 * white-screen the whole app; this contains it to a friendly, reloadable
 * fallback. Per-contribution failures are still caught closer to the source by
 * `LazyContribution`'s `PluginErrorBoundary`.
 */
class ShellErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state: { hasError: boolean } = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("❌ Checkstack shell failed to render:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-surface">
          <ErrorFallback
            title="Something went wrong"
            description="The app hit an unexpected error. Reloading usually fixes it."
          />
        </div>
      );
    }
    return this.props.children;
  }
}

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
  accessRule?: AccessRule;
}> = ({ children, accessRule }) => {
  const accessApi = useApi(accessApiRef);
  // Pass the FULL rule so the check qualifies it (`{pluginId}.{id}`) against the
  // user's granted ids and applies manage->read escalation.
  const { allowed, loading } = accessRule
    ? accessApi.useAccess(accessRule)
    : { allowed: true, loading: false };

  if (loading) {
    return <PageSkeleton />;
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
/** Build the element for a plugin route (lazy `load` thunk or eager `element`). */
function routeElement(
  route: {
    path: string;
    load?: () => Promise<{ default: React.ComponentType }>;
    element?: React.ReactNode;
  },
  options?: { standalone?: boolean },
): React.ReactNode {
  if (route.load) {
    const PageElement = getLazyContribution({
      id: route.path,
      load: route.load,
      suspenseFallback: options?.standalone
        ? STANDALONE_SUSPENSE_FALLBACK
        : ROUTE_SUSPENSE_FALLBACK,
      errorFallback: ROUTE_ERROR_FALLBACK,
    });
    return <PageElement />;
  }
  return route.element;
}

/**
 * The authenticated app chrome: header, sidebar, ambient background, command
 * palette. A LAYOUT route (`<Outlet/>`); only non-`standalone` routes render
 * inside it. Standalone routes (e.g. a public status page) render as siblings,
 * so they show none of this.
 */
function AppShellLayout() {
  const { isLowPower } = usePerformance();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <>
      <GlobalShortcuts />
      <AmbientBackground className="text-foreground font-sans">
        <div className="flex flex-col h-screen overflow-hidden">
          <AnnouncementBanner />
          <header
            className={cn(
              "shrink-0 p-4 shadow-sm border-b border-border z-40 relative",
              isLowPower ? "bg-surface-2" : "bg-surface-2/80 backdrop-blur-sm",
            )}
          >
            <div className="flex items-center justify-between gap-4">
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
                  <img src="/favicon.svg" alt="Checkstack" className="w-7 h-7" />
                  {/* The wordmark is dropped on small screens to de-clutter the
                      navbar; the logo still anchors the home link. */}
                  <h1 className="hidden text-xl font-bold text-primary sm:block">
                    Checkstack
                  </h1>
                </Link>
                <nav className="hidden md:flex gap-1">
                  <ExtensionSlot slot={NavbarLeftSlot} />
                </nav>
              </div>
              <div className="flex-1 flex justify-center max-w-md">
                <ExtensionSlot slot={NavbarCenterSlot} />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <HelpMenu />
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
                  and scroll an inner pane instead of the whole page. */}
              <div className="flex flex-1 min-h-0 flex-col px-3 py-4 md:p-8 w-full max-w-7xl mx-auto">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </AmbientBackground>
    </>
  );
}

function AppContent() {
  // Enable dynamic plugin loading/unloading via signals
  usePluginLifecycle();

  // Load plugins AFTER first paint. The shell chrome above renders immediately
  // (the auth API has a safe default in the core registry), and plugins register
  // reactively, so nav entries and routes stream in. `pluginsInitializing` keeps
  // an unmatched path on a skeleton instead of flashing "Not found" until the
  // registry has filled.
  const [pluginsInitializing, setPluginsInitializing] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const boot = readBootstrap();
      try {
        await loadLocalPlugins();
        await loadRemotePlugins({ enabledPlugins: boot?.enabledPlugins });
      } finally {
        if (!cancelled) setPluginsInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allRoutes = pluginRegistry.getAllRoutes();
  const standaloneRoutes = allRoutes.filter((r) => r.standalone);
  const shellRoutes = allRoutes.filter((r) => !r.standalone);

  return (
    <BrowserRouter>
      <Routes>
        {/* Standalone routes: no chrome (public surfaces, e.g. status pages). */}
        {standaloneRoutes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              <RouteGuard accessRule={route.accessRule}>
                {routeElement(route, { standalone: true })}
              </RouteGuard>
            }
          />
        ))}
        {/* Everything else renders inside the authenticated app shell. */}
        <Route element={<AppShellLayout />}>
          <Route
            path="/"
            element={
              <div className="space-y-8 animate-in fade-in duration-500">
                <ExtensionSlot slot={DashboardSlot} />
              </div>
            }
          />
          {/* Plugin Routes — code-split via `load` (Suspense + error boundary). */}
          {shellRoutes.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={
                <RouteGuard accessRule={route.accessRule}>
                  {routeElement(route)}
                </RouteGuard>
              }
            />
          ))}
          {/* Catch-all: while plugins are still registering, an unmatched path
              may simply belong to a not-yet-loaded plugin - show a skeleton
              rather than flashing "Not found". */}
          <Route
            path="*"
            element={pluginsInitializing ? <PageSkeleton /> : <NotFound />}
          />
        </Route>
      </Routes>
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
      // Safe default so the shell (sidebar's useAccessRules) can render BEFORE
      // the auth plugin loads; the plugin's factory overrides it on register.
      .register(authApiRef, defaultAuthApi)
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

  // Show a shell skeleton while fetching runtime config and probing baseUrl.
  // With the inlined bootstrap this is rarely hit on the admin origin (config
  // is seeded synchronously); it covers the dev server / a cross-origin baseUrl.
  if (isConfigLoading) {
    return <ShellSkeleton />;
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
      <div className="h-screen flex items-center justify-center bg-surface p-8">
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
    <ThemeProvider defaultTheme="system" storageKey="checkstack-ui-theme">
      <DensityProvider className="contents">
        <ShellErrorBoundary>
          <RuntimeConfigProvider>
            <AppWithApis />
          </RuntimeConfigProvider>
        </ShellErrorBoundary>
      </DensityProvider>
    </ThemeProvider>
  );
}

export default App;

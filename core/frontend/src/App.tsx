import { useMemo } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
} from "react-router-dom";
import {
  ApiProvider,
  ApiRegistryBuilder,
  loggerApiRef,
  accessApiRef,
  fetchApiRef,
  rpcApiRef,
  useApi,
  ExtensionSlot,
  pluginRegistry,
  DashboardSlot,
  NavbarRightSlot,
  NavbarLeftSlot,
  NavbarCenterSlot,
  RuntimeConfigProvider,
  useRuntimeConfigLoading,
  useRuntimeConfig,
} from "@checkstack/frontend-api";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";
import { CoreRpcApi } from "./apis/rpc-api";
import {
  AccessDenied,
  LoadingSpinner,
  ToastProvider,
  AmbientBackground,
} from "@checkstack/ui";
import { SignalProvider } from "@checkstack/signal-frontend";
import { usePluginLifecycle } from "./hooks/usePluginLifecycle";
import { useCommands, useGlobalShortcuts } from "@checkstack/command-frontend";

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
  // This causes re-renders when plugins change
  usePluginLifecycle();

  return (
    <BrowserRouter>
      {/* Global keyboard shortcuts for commands */}
      <GlobalShortcuts />
      <AmbientBackground className="text-foreground font-sans">
        <header className="p-4 bg-card/80 backdrop-blur-sm shadow-sm border-b border-border z-50 relative">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Logo and main navigation */}
            <div className="flex items-center gap-8 flex-shrink-0">
              <Link to="/">
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
            <div className="flex gap-2 flex-shrink-0">
              <ExtensionSlot slot={NavbarRightSlot} />
            </div>
          </div>
        </header>
        <main className="p-8 max-w-7xl mx-auto">
          <Routes>
            <Route
              path="/"
              element={
                <div className="space-y-6">
                  <ExtensionSlot slot={DashboardSlot} />
                </div>
              }
            />
            {/* Plugin Routes */}
            {pluginRegistry.getAllRoutes().map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={
                  <RouteGuard accessRule={route.accessRule}>
                    {route.element}
                  </RouteGuard>
                }
              />
            ))}
          </Routes>
        </main>
      </AmbientBackground>
    </BrowserRouter>
  );
}

/**
 * App wrapper that provides APIs and waits for runtime config to load.
 */
function AppWithApis() {
  const isConfigLoading = useRuntimeConfigLoading();
  const { baseUrl } = useRuntimeConfig();

  const apiRegistry = useMemo(() => {
    // Initialize API Registry with core apiRefs
    const registryBuilder = new ApiRegistryBuilder()
      .register(loggerApiRef, new ConsoleLoggerApi())
      .register(accessApiRef, {
        useAccess: () => ({ loading: false, allowed: true }), // Default to allow all if no auth plugin present
      })
      .registerFactory(fetchApiRef, (_registry) => {
        return new CoreFetchApi(baseUrl);
      })
      .registerFactory(rpcApiRef, (_registry) => {
        return new CoreRpcApi(baseUrl);
      });

    // Register API factories from plugins
    const plugins = pluginRegistry.getPlugins();
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
  }, [baseUrl]);

  // Show loading while fetching runtime config
  if (isConfigLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <ApiProvider registry={apiRegistry}>
      <SignalProvider backendUrl={baseUrl}>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </SignalProvider>
    </ApiProvider>
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

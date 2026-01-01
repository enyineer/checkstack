import { useMemo } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import {
  ApiProvider,
  ApiRegistryBuilder,
  loggerApiRef,
  permissionApiRef,
  fetchApiRef,
  rpcApiRef,
  useApi,
  ExtensionSlot,
  pluginRegistry,
  DashboardSlot,
  NavbarSlot,
  NavbarMainSlot,
} from "@checkmate/frontend-api";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";
import { CoreRpcApi } from "./apis/rpc-api";
import { PermissionDenied, LoadingSpinner, ToastProvider } from "@checkmate/ui";
import { SignalProvider } from "@checkmate/signal-frontend";
import { usePluginLifecycle } from "./hooks/usePluginLifecycle";

const RouteGuard: React.FC<{
  children: React.ReactNode;
  permission?: string;
}> = ({ children, permission }) => {
  const permissionApi = useApi(permissionApiRef);
  const { allowed, loading } = permissionApi.usePermission(permission || "");

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  const isAllowed = permission ? allowed : true;

  if (!isAllowed) {
    return <PermissionDenied />;
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
      <div className="min-h-screen bg-background text-foreground font-sans">
        <header className="p-4 bg-card shadow-sm border-b border-border flex justify-between items-center z-50 relative">
          <div className="flex items-center gap-8">
            <Link to="/">
              <h1 className="text-xl font-bold text-primary">Checkmate</h1>
            </Link>
            <nav className="hidden md:flex gap-1">
              <ExtensionSlot slot={NavbarMainSlot} />
            </nav>
          </div>
          <div className="flex gap-2">
            <ExtensionSlot slot={NavbarSlot} />
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
                  <RouteGuard permission={route.permission}>
                    {route.element}
                  </RouteGuard>
                }
              />
            ))}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function App() {
  const apiRegistry = useMemo(() => {
    // Initialize API Registry with core apiRefs
    const registryBuilder = new ApiRegistryBuilder()
      .register(loggerApiRef, new ConsoleLoggerApi())
      .register(permissionApiRef, {
        usePermission: () => ({ loading: false, allowed: true }), // Default to allow all if no auth plugin present
        useResourcePermission: () => ({ loading: false, allowed: true }),
        useManagePermission: () => ({ loading: false, allowed: true }),
      })
      .registerFactory(fetchApiRef, (_registry) => {
        return new CoreFetchApi();
      })
      .registerFactory(rpcApiRef, (_registry) => {
        return new CoreRpcApi();
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
  }, []);

  return (
    <ApiProvider registry={apiRegistry}>
      <SignalProvider backendUrl={import.meta.env.VITE_BACKEND_URL}>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </SignalProvider>
    </ApiProvider>
  );
}

export default App;

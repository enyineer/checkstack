import { useMemo } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
} from "@checkmate/frontend-api";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";
import { CoreRpcApi } from "./apis/rpc-api";
import { PermissionDenied, LoadingSpinner } from "@checkmate/ui";
import {
  SLOT_DASHBOARD,
  SLOT_NAVBAR,
  SLOT_NAVBAR_MAIN,
} from "@checkmate/common";

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
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
          <header className="p-4 bg-white shadow-sm border-b border-gray-200 flex justify-between items-center z-50 relative">
            <div className="flex items-center gap-8">
              <h1 className="text-xl font-bold text-indigo-600">Checkmate</h1>
              <nav className="hidden md:flex gap-1">
                <ExtensionSlot id={SLOT_NAVBAR_MAIN} />
              </nav>
            </div>
            <div className="flex gap-2">
              <ExtensionSlot id={SLOT_NAVBAR} />
            </div>
          </header>
          <main className="p-8 max-w-7xl mx-auto">
            <Routes>
              <Route
                path="/"
                element={
                  <div className="space-y-6">
                    <ExtensionSlot id={SLOT_DASHBOARD} />
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
    </ApiProvider>
  );
}

export default App;

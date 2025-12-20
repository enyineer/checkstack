import { useMemo } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ExtensionSlot } from "./components/ExtensionSlot";
import { pluginRegistry } from "./plugin-registry";
import {
  ApiProvider,
  ApiRegistryBuilder,
  loggerApiRef,
  permissionApiRef,
  fetchApiRef,
} from "@checkmate/frontend-api";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";

function App() {
  const apiRegistry = useMemo(() => {
    // Initialize API Registry with core apiRefs
    const registryBuilder = new ApiRegistryBuilder()
      .register(loggerApiRef, new ConsoleLoggerApi())
      .register(permissionApiRef, {
        hasPermission: () => true, // Default to allow all if no auth plugin present
      })
      .registerFactory(fetchApiRef, (registry) => {
        return new CoreFetchApi({
          get: <T,>(ref: { id: string }) => registry.get(ref.id) as T,
        });
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
                <ExtensionSlot id="core.layout.navbar.main" />
              </nav>
            </div>
            <div className="flex gap-2">
              <ExtensionSlot id="core.layout.navbar" />
            </div>
          </header>
          <main className="p-8 max-w-7xl mx-auto">
            <Routes>
              <Route
                path="/"
                element={
                  <div className="p-4 rounded-lg bg-white shadow">
                    <h2 className="text-2xl font-semibold mb-4">Dashboard</h2>
                    <p className="text-gray-600">Welcome to Checkmate Core.</p>
                  </div>
                }
              />
              {/* Plugin Routes */}
              {pluginRegistry.getAllRoutes().map((route) => (
                <Route
                  key={route.path}
                  path={route.path}
                  element={route.element}
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

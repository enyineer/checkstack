import { BrowserRouter, Routes, Route } from "react-router-dom";
import { pluginRegistry } from "./plugin-registry";
import {
  ApiProvider,
  ApiRegistryBuilder,
  loggerApiRef,
  fetchApiRef,
} from "@checkmate/frontend-api";
import { ConsoleLoggerApi } from "./apis/logger-api";
import { CoreFetchApi } from "./apis/fetch-api";

import { catalogPlugin } from "@checkmate/catalog-frontend";

// Register Plugins
pluginRegistry.register(catalogPlugin);

// Initialize API Registry with core apiRefs
const registryBuilder = new ApiRegistryBuilder()
  .register(loggerApiRef, new ConsoleLoggerApi())
  .register(fetchApiRef, new CoreFetchApi());

// Register API factories from plugins
const plugins = pluginRegistry.getPlugins();
plugins.forEach((plugin) => {
  if (plugin.apis) {
    plugin.apis.forEach((api) => {
      registryBuilder.registerFactory(api.ref, (registry) => {
        // Adapt registry map to dependency getter
        const deps = {
          get: <T,>(ref: any) => registry.get(ref.id) as T,
        };
        return api.factory(deps);
      });
    });
  }
});

const apiRegistry = registryBuilder.build();

function App() {
  const plugins = pluginRegistry.getPlugins();

  return (
    <ApiProvider registry={apiRegistry}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
          <header className="p-4 bg-white shadow-sm border-b border-gray-200">
            <h1 className="text-xl font-bold text-indigo-600">Checkmate</h1>
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
              {/* Dynamically register plugin routes */}
              {plugins.map((plugin) =>
                plugin.routes?.map((route) => (
                  <Route
                    key={`${plugin.name}-${route.path}`}
                    path={route.path}
                    element={route.element}
                  />
                ))
              )}
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </ApiProvider>
  );
}

export default App;

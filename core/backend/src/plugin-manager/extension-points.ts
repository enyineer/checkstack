import type { ExtensionPoint } from "@checkmate-monitor/backend-api";
import { rootLogger } from "../logger";

/**
 * Creates an extension point manager that handles proxy creation and buffering.
 */
export function createExtensionPointManager() {
  const extensionPointProxies = new Map<string, unknown>();

  /**
   * Get or create a proxy for an extension point.
   * Buffers calls until implementation is set.
   */
  function getExtensionPointProxy<T>(ref: ExtensionPoint<T>): T {
    let proxy = extensionPointProxies.get(ref.id) as T | undefined;
    if (!proxy) {
      const buffer: { method: string | symbol; args: unknown[] }[] = [];
      let implementation: T | undefined;

      proxy = new Proxy(
        {},
        {
          get: (target, prop) => {
            if (prop === "$$setImplementation") {
              return (impl: T) => {
                implementation = impl;
                for (const call of buffer) {
                  (
                    implementation as Record<
                      string | symbol,
                      (...args: unknown[]) => unknown
                    >
                  )[call.method](...call.args);
                }
                buffer.length = 0;
              };
            }
            return (...args: unknown[]) => {
              if (implementation) {
                return (
                  implementation as Record<
                    string | symbol,
                    (...args: unknown[]) => unknown
                  >
                )[prop](...args);
              } else {
                buffer.push({ method: prop, args });
              }
            };
          },
        }
      ) as T;
      extensionPointProxies.set(ref.id, proxy);
    }
    return proxy;
  }

  /**
   * Register an extension point implementation.
   */
  function registerExtensionPoint<T>(ref: ExtensionPoint<T>, impl: T) {
    const proxy = getExtensionPointProxy(ref);
    (proxy as Record<string, (...args: unknown[]) => unknown>)[
      "$$setImplementation"
    ](impl);
    rootLogger.debug(`   -> Registered extension point '${ref.id}'`);
  }

  /**
   * Get an extension point (returns the proxy).
   */
  function getExtensionPoint<T>(ref: ExtensionPoint<T>): T {
    return getExtensionPointProxy(ref);
  }

  return {
    getExtensionPointProxy,
    registerExtensionPoint,
    getExtensionPoint,
  };
}

export type ExtensionPointManager = ReturnType<
  typeof createExtensionPointManager
>;

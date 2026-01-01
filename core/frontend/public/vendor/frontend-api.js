var x = Object.defineProperty;
var m = (n, e, t) => e in n ? x(n, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : n[e] = t;
var u = (n, e, t) => m(n, typeof e != "symbol" ? e + "" : e, t);
import { r as c, b as y } from "./vendor-shared-Czuro2GD.js";
function p(n) {
  return {
    id: n,
    T: void 0,
    toString() {
      return `ApiRef(${n})`;
    }
  };
}
const f = c.createContext(void 0);
class j {
  constructor() {
    u(this, "registry", /* @__PURE__ */ new Map());
  }
  register(e, t) {
    return this.registry.set(e.id, t), this;
  }
  registerFactory(e, t) {
    const s = t(this.registry);
    return this.registry.set(e.id, s), this;
  }
  build() {
    return this.registry;
  }
}
const b = ({
  registry: n,
  children: e
}) => y.createElement(
  f.Provider,
  { value: n },
  e
);
function O(n) {
  const e = c.useContext(f);
  if (!e)
    throw new Error("useApi must be used within an ApiProvider");
  const t = e.get(n.id);
  if (!t)
    throw new Error(`No implementation found for API '${n.id}'`);
  return t;
}
const N = p("core.logger"), F = p("core.fetch"), k = p("core.permission"), C = p("core.rpc");
function V(n, e) {
  return {
    ...e,
    slotId: n.id
  };
}
function B(n) {
  return n;
}
class R {
  constructor() {
    u(this, "plugins", []);
    u(this, "extensions", /* @__PURE__ */ new Map());
    /**
     * Version counter that increments on every registry change.
     * Used by React components to trigger re-renders when plugins are added/removed.
     */
    u(this, "version", 0);
    u(this, "listeners", /* @__PURE__ */ new Set());
  }
  register(e) {
    if (this.plugins.some((t) => t.name === e.name)) {
      console.warn(`⚠️ Plugin ${e.name} already registered`);
      return;
    }
    if (console.log(`🔌 Registering frontend plugin: ${e.name}`), this.plugins.push(e), e.extensions)
      for (const t of e.extensions)
        this.extensions.has(t.slotId) || this.extensions.set(t.slotId, []), this.extensions.get(t.slotId).push(t);
    this.incrementVersion();
  }
  /**
   * Unregister a plugin by name.
   * Removes the plugin and all its extensions from the registry.
   */
  unregister(e) {
    const t = this.plugins.findIndex((r) => r.name === e);
    if (t === -1)
      return console.warn(`⚠️ Plugin ${e} not found for unregistration`), !1;
    const s = this.plugins[t];
    if (console.log(`🔌 Unregistering frontend plugin: ${e}`), this.plugins.splice(t, 1), s.extensions)
      for (const r of s.extensions) {
        const o = this.extensions.get(r.slotId);
        if (o) {
          const l = o.findIndex(
            (h) => h.id === r.id
          );
          l !== -1 && o.splice(l, 1);
        }
      }
    return this.incrementVersion(), !0;
  }
  /**
   * Check if a plugin is registered.
   */
  hasPlugin(e) {
    return this.plugins.some((t) => t.name === e);
  }
  getPlugins() {
    return this.plugins;
  }
  getExtensions(e) {
    return this.extensions.get(e) || [];
  }
  /**
   * Get the URL-friendly base name for a plugin.
   * Strips common suffixes like "-frontend" for cleaner URLs.
   */
  getPluginBaseName(e) {
    return e.replace(/-frontend$/, "");
  }
  getAllRoutes() {
    return this.plugins.flatMap((e) => {
      const t = this.getPluginBaseName(e.name);
      return (e.routes || []).map((s) => ({
        ...s,
        // Auto-prefix with plugin base name for consistent namespacing
        path: `/${t}${s.path.startsWith("/") ? s.path : `/${s.path}`}`
      }));
    });
  }
  /**
   * Get the current version number.
   * Increments on every register/unregister.
   */
  getVersion() {
    return this.version;
  }
  /**
   * Subscribe to registry changes.
   * Returns an unsubscribe function.
   */
  subscribe(e) {
    return this.listeners.add(e), () => this.listeners.delete(e);
  }
  incrementVersion() {
    this.version++;
    for (const e of this.listeners)
      e();
  }
  reset() {
    this.plugins = [], this.extensions.clear(), this.incrementVersion();
  }
}
const v = new R();
var g = { exports: {} }, a = {};
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var _ = c, w = Symbol.for("react.element"), E = Symbol.for("react.fragment"), P = Object.prototype.hasOwnProperty, A = _.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, I = { key: !0, ref: !0, __self: !0, __source: !0 };
function d(n, e, t) {
  var s, r = {}, o = null, l = null;
  t !== void 0 && (o = "" + t), e.key !== void 0 && (o = "" + e.key), e.ref !== void 0 && (l = e.ref);
  for (s in e) P.call(e, s) && !I.hasOwnProperty(s) && (r[s] = e[s]);
  if (n && n.defaultProps) for (s in e = n.defaultProps, e) r[s] === void 0 && (r[s] = e[s]);
  return { $$typeof: w, type: n, key: o, ref: l, props: r, _owner: A.current };
}
a.Fragment = E;
a.jsx = d;
a.jsxs = d;
g.exports = a;
var i = g.exports;
const L = ({
  id: n,
  context: e
}) => {
  const t = v.getExtensions(n);
  return t.length === 0 ? /* @__PURE__ */ i.jsx(i.Fragment, {}) : /* @__PURE__ */ i.jsx(i.Fragment, { children: t.map((s) => /* @__PURE__ */ i.jsx(s.component, { ...e }, s.id)) });
};
function T(n, e = /* @__PURE__ */ i.jsx("div", { children: "Loading..." })) {
  const t = (s) => /* @__PURE__ */ i.jsx(c.Suspense, { fallback: e, children: /* @__PURE__ */ i.jsx(n, { ...s }) });
  return t.displayName = `Suspense(${n.displayName || n.name || "Component"})`, t;
}
function M(n) {
  return { id: n };
}
export {
  b as ApiProvider,
  j as ApiRegistryBuilder,
  L as ExtensionSlot,
  p as createApiRef,
  B as createFrontendPlugin,
  M as createSlot,
  V as createSlotExtension,
  F as fetchApiRef,
  N as loggerApiRef,
  k as permissionApiRef,
  v as pluginRegistry,
  C as rpcApiRef,
  O as useApi,
  T as wrapInSuspense
};

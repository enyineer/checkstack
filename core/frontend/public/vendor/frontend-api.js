var rn = Object.defineProperty;
var on = (e, n, t) => n in e ? rn(e, n, { enumerable: !0, configurable: !0, writable: !0, value: t }) : e[n] = t;
var N = (e, n, t) => on(e, typeof n != "symbol" ? n + "" : n, t);
import { r as V, b as sn } from "./vendor-shared-Czuro2GD.js";
function B(e) {
  return {
    id: e,
    T: void 0,
    toString() {
      return `ApiRef(${e})`;
    }
  };
}
const Ze = V.createContext(void 0);
class Mr {
  constructor() {
    N(this, "registry", /* @__PURE__ */ new Map());
  }
  register(n, t) {
    return this.registry.set(n.id, t), this;
  }
  registerFactory(n, t) {
    const r = t(this.registry);
    return this.registry.set(n.id, r), this;
  }
  build() {
    return this.registry;
  }
}
const Cr = ({
  registry: e,
  children: n
}) => sn.createElement(
  Ze.Provider,
  { value: e },
  n
);
function xr(e) {
  const n = V.useContext(Ze);
  if (!n)
    throw new Error("useApi must be used within an ApiProvider");
  const t = n.get(e.id);
  if (!t)
    throw new Error(`No implementation found for API '${e.id}'`);
  return t;
}
const Jr = B("core.logger"), Fr = B("core.fetch"), Vr = B("core.permission"), Dr = B("core.rpc");
function Ur(e, n) {
  return {
    ...n,
    slotId: e.id
  };
}
function Lr(e) {
  return e;
}
class un {
  constructor() {
    N(this, "plugins", []);
    N(this, "extensions", /* @__PURE__ */ new Map());
    N(this, "routeMap", /* @__PURE__ */ new Map());
    /**
     * Version counter that increments on every registry change.
     * Used by React components to trigger re-renders when plugins are added/removed.
     */
    N(this, "version", 0);
    N(this, "listeners", /* @__PURE__ */ new Set());
  }
  /**
   * Get the URL-friendly base name for a plugin.
   * Strips common suffixes like "-frontend" for cleaner URLs.
   */
  getPluginBaseName(n) {
    return n.replace(/-frontend$/, "");
  }
  /**
   * Validate and register routes from a plugin.
   */
  registerRoutes(n) {
    if (!n.routes) return;
    const t = this.getPluginBaseName(n.name);
    for (const r of n.routes) {
      if (r.route.pluginId !== t)
        throw console.error(
          `❌ Route pluginId mismatch: route "${r.route.id}" has pluginId "${r.route.pluginId}" but plugin is "${n.name}" (base: "${t}")`
        ), new Error(
          `Route pluginId "${r.route.pluginId}" doesn't match plugin "${t}"`
        );
      const o = `/${r.route.pluginId}${r.route.path.startsWith("/") ? r.route.path : `/${r.route.path}`}`, s = {
        id: r.route.id,
        path: o,
        pluginId: r.route.pluginId,
        element: r.element,
        title: r.title,
        permission: r.permission
      };
      this.routeMap.set(r.route.id, s);
    }
  }
  /**
   * Unregister routes from a plugin.
   */
  unregisterRoutes(n) {
    if (n.routes)
      for (const t of n.routes)
        this.routeMap.delete(t.route.id);
  }
  register(n) {
    if (this.plugins.some((t) => t.name === n.name)) {
      console.warn(`⚠️ Plugin ${n.name} already registered`);
      return;
    }
    if (console.log(`🔌 Registering frontend plugin: ${n.name}`), this.plugins.push(n), n.extensions)
      for (const t of n.extensions)
        this.extensions.has(t.slotId) || this.extensions.set(t.slotId, []), this.extensions.get(t.slotId).push(t);
    this.registerRoutes(n), this.incrementVersion();
  }
  /**
   * Unregister a plugin by name.
   * Removes the plugin and all its extensions from the registry.
   */
  unregister(n) {
    const t = this.plugins.findIndex((o) => o.name === n);
    if (t === -1)
      return console.warn(`⚠️ Plugin ${n} not found for unregistration`), !1;
    const r = this.plugins[t];
    if (console.log(`🔌 Unregistering frontend plugin: ${n}`), this.plugins.splice(t, 1), r.extensions)
      for (const o of r.extensions) {
        const s = this.extensions.get(o.slotId);
        if (s) {
          const i = s.findIndex(
            (c) => c.id === o.id
          );
          i !== -1 && s.splice(i, 1);
        }
      }
    return this.unregisterRoutes(r), this.incrementVersion(), !0;
  }
  /**
   * Check if a plugin is registered.
   */
  hasPlugin(n) {
    return this.plugins.some((t) => t.name === n);
  }
  getPlugins() {
    return this.plugins;
  }
  getExtensions(n) {
    return this.extensions.get(n) || [];
  }
  /**
   * Get all routes for rendering in the router.
   */
  getAllRoutes() {
    return this.plugins.flatMap((n) => (n.routes || []).map((t) => ({
      path: `/${t.route.pluginId}${t.route.path.startsWith("/") ? t.route.path : `/${t.route.path}`}`,
      element: t.element,
      title: t.title,
      permission: t.permission
    })));
  }
  /**
   * Resolve a route by its ID to get the full path.
   *
   * @param routeId - Route ID in format "{pluginId}.{routeName}"
   * @param params - Optional path parameters to substitute
   * @returns The resolved full path, or undefined if not found
   */
  resolveRoute(n, t) {
    const r = this.routeMap.get(n);
    if (!r) {
      console.warn(`⚠️ Route "${n}" not found in registry`);
      return;
    }
    if (!t)
      return r.path;
    let o = r.path;
    for (const [s, i] of Object.entries(t))
      o = o.replace(`:${s}`, i);
    return o;
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
  subscribe(n) {
    return this.listeners.add(n), () => this.listeners.delete(n);
  }
  incrementVersion() {
    this.version++;
    for (const n of this.listeners)
      n();
  }
  reset() {
    this.plugins = [], this.extensions.clear(), this.routeMap.clear(), this.incrementVersion();
  }
}
const je = new un();
var Ie = { exports: {} }, W = {};
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var cn = V, an = Symbol.for("react.element"), ln = Symbol.for("react.fragment"), fn = Object.prototype.hasOwnProperty, dn = cn.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, hn = { key: !0, ref: !0, __self: !0, __source: !0 };
function Re(e, n, t) {
  var r, o = {}, s = null, i = null;
  t !== void 0 && (s = "" + t), n.key !== void 0 && (s = "" + n.key), n.ref !== void 0 && (i = n.ref);
  for (r in n) fn.call(n, r) && !hn.hasOwnProperty(r) && (o[r] = n[r]);
  if (e && e.defaultProps) for (r in n = e.defaultProps, n) o[r] === void 0 && (o[r] = n[r]);
  return { $$typeof: an, type: e, key: s, ref: i, props: o, _owner: dn.current };
}
W.Fragment = ln;
W.jsx = Re;
W.jsxs = Re;
Ie.exports = W;
var S = Ie.exports;
const Gr = ({
  id: e,
  context: n
}) => {
  const t = je.getExtensions(e);
  return t.length === 0 ? /* @__PURE__ */ S.jsx(S.Fragment, {}) : /* @__PURE__ */ S.jsx(S.Fragment, { children: t.map((r) => /* @__PURE__ */ S.jsx(r.component, { ...n }, r.id)) });
};
function Kr(e, n = /* @__PURE__ */ S.jsx("div", { children: "Loading..." })) {
  const t = (r) => /* @__PURE__ */ S.jsx(V.Suspense, { fallback: n, children: /* @__PURE__ */ S.jsx(e, { ...r }) });
  return t.displayName = `Suspense(${e.displayName || e.name || "Component"})`, t;
}
function Br(e) {
  return { id: e };
}
function f(e, n, t) {
  function r(c, u) {
    if (c._zod || Object.defineProperty(c, "_zod", {
      value: {
        def: u,
        constr: i,
        traits: /* @__PURE__ */ new Set()
      },
      enumerable: !1
    }), c._zod.traits.has(e))
      return;
    c._zod.traits.add(e), n(c, u);
    const a = i.prototype, l = Object.keys(a);
    for (let d = 0; d < l.length; d++) {
      const h = l[d];
      h in c || (c[h] = a[h].bind(c));
    }
  }
  const o = (t == null ? void 0 : t.Parent) ?? Object;
  class s extends o {
  }
  Object.defineProperty(s, "name", { value: e });
  function i(c) {
    var u;
    const a = t != null && t.Parent ? new s() : this;
    r(a, c), (u = a._zod).deferred ?? (u.deferred = []);
    for (const l of a._zod.deferred)
      l();
    return a;
  }
  return Object.defineProperty(i, "init", { value: r }), Object.defineProperty(i, Symbol.hasInstance, {
    value: (c) => {
      var u, a;
      return t != null && t.Parent && c instanceof t.Parent ? !0 : (a = (u = c == null ? void 0 : c._zod) == null ? void 0 : u.traits) == null ? void 0 : a.has(e);
    }
  }), Object.defineProperty(i, "name", { value: e }), i;
}
class M extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
}
class Ae extends Error {
  constructor(n) {
    super(`Encountered unidirectional transform during encode: ${n}`), this.name = "ZodEncodeError";
  }
}
const Me = {};
function T(e) {
  return Me;
}
function Ce(e) {
  const n = Object.values(e).filter((r) => typeof r == "number");
  return Object.entries(e).filter(([r, o]) => n.indexOf(+r) === -1).map(([r, o]) => o);
}
function ee(e, n) {
  return typeof n == "bigint" ? n.toString() : n;
}
function re(e) {
  return {
    get value() {
      {
        const n = e();
        return Object.defineProperty(this, "value", { value: n }), n;
      }
    }
  };
}
function oe(e) {
  return e == null;
}
function se(e) {
  const n = e.startsWith("^") ? 1 : 0, t = e.endsWith("$") ? e.length - 1 : e.length;
  return e.slice(n, t);
}
function pn(e, n) {
  const t = (e.toString().split(".")[1] || "").length, r = n.toString();
  let o = (r.split(".")[1] || "").length;
  if (o === 0 && /\d?e-\d?/.test(r)) {
    const u = r.match(/\d?e-(\d?)/);
    u != null && u[1] && (o = Number.parseInt(u[1]));
  }
  const s = t > o ? t : o, i = Number.parseInt(e.toFixed(s).replace(".", "")), c = Number.parseInt(n.toFixed(s).replace(".", ""));
  return i % c / 10 ** s;
}
const ae = Symbol("evaluating");
function m(e, n, t) {
  let r;
  Object.defineProperty(e, n, {
    get() {
      if (r !== ae)
        return r === void 0 && (r = ae, r = t()), r;
    },
    set(o) {
      Object.defineProperty(e, n, {
        value: o
        // configurable: true,
      });
    },
    configurable: !0
  });
}
function j(e, n, t) {
  Object.defineProperty(e, n, {
    value: t,
    writable: !0,
    enumerable: !0,
    configurable: !0
  });
}
function I(...e) {
  const n = {};
  for (const t of e) {
    const r = Object.getOwnPropertyDescriptors(t);
    Object.assign(n, r);
  }
  return Object.defineProperties({}, n);
}
function le(e) {
  return JSON.stringify(e);
}
const xe = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {
};
function L(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
const mn = re(() => {
  var e;
  if (typeof navigator < "u" && ((e = navigator == null ? void 0 : navigator.userAgent) != null && e.includes("Cloudflare")))
    return !1;
  try {
    const n = Function;
    return new n(""), !0;
  } catch {
    return !1;
  }
});
function J(e) {
  if (L(e) === !1)
    return !1;
  const n = e.constructor;
  if (n === void 0 || typeof n != "function")
    return !0;
  const t = n.prototype;
  return !(L(t) === !1 || Object.prototype.hasOwnProperty.call(t, "isPrototypeOf") === !1);
}
function Je(e) {
  return J(e) ? { ...e } : Array.isArray(e) ? [...e] : e;
}
const _n = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function gn(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function E(e, n, t) {
  const r = new e._zod.constr(n ?? e._zod.def);
  return (!n || t != null && t.parent) && (r._zod.parent = e), r;
}
function g(e) {
  const n = e;
  if (!n)
    return {};
  if (typeof n == "string")
    return { error: () => n };
  if ((n == null ? void 0 : n.message) !== void 0) {
    if ((n == null ? void 0 : n.error) !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    n.error = n.message;
  }
  return delete n.message, typeof n.error == "string" ? { ...n, error: () => n.error } : n;
}
function vn(e) {
  return Object.keys(e).filter((n) => e[n]._zod.optin === "optional" && e[n]._zod.optout === "optional");
}
const yn = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function zn(e, n) {
  const t = e._zod.def, r = I(e._zod.def, {
    get shape() {
      const o = {};
      for (const s in n) {
        if (!(s in t.shape))
          throw new Error(`Unrecognized key: "${s}"`);
        n[s] && (o[s] = t.shape[s]);
      }
      return j(this, "shape", o), o;
    },
    checks: []
  });
  return E(e, r);
}
function bn(e, n) {
  const t = e._zod.def, r = I(e._zod.def, {
    get shape() {
      const o = { ...e._zod.def.shape };
      for (const s in n) {
        if (!(s in t.shape))
          throw new Error(`Unrecognized key: "${s}"`);
        n[s] && delete o[s];
      }
      return j(this, "shape", o), o;
    },
    checks: []
  });
  return E(e, r);
}
function wn(e, n) {
  if (!J(n))
    throw new Error("Invalid input to extend: expected a plain object");
  const t = e._zod.def.checks;
  if (t && t.length > 0)
    throw new Error("Object schemas containing refinements cannot be extended. Use `.safeExtend()` instead.");
  const o = I(e._zod.def, {
    get shape() {
      const s = { ...e._zod.def.shape, ...n };
      return j(this, "shape", s), s;
    },
    checks: []
  });
  return E(e, o);
}
function kn(e, n) {
  if (!J(n))
    throw new Error("Invalid input to safeExtend: expected a plain object");
  const t = {
    ...e._zod.def,
    get shape() {
      const r = { ...e._zod.def.shape, ...n };
      return j(this, "shape", r), r;
    },
    checks: e._zod.def.checks
  };
  return E(e, t);
}
function On(e, n) {
  const t = I(e._zod.def, {
    get shape() {
      const r = { ...e._zod.def.shape, ...n._zod.def.shape };
      return j(this, "shape", r), r;
    },
    get catchall() {
      return n._zod.def.catchall;
    },
    checks: []
    // delete existing checks
  });
  return E(e, t);
}
function $n(e, n, t) {
  const r = I(n._zod.def, {
    get shape() {
      const o = n._zod.def.shape, s = { ...o };
      if (t)
        for (const i in t) {
          if (!(i in o))
            throw new Error(`Unrecognized key: "${i}"`);
          t[i] && (s[i] = e ? new e({
            type: "optional",
            innerType: o[i]
          }) : o[i]);
        }
      else
        for (const i in o)
          s[i] = e ? new e({
            type: "optional",
            innerType: o[i]
          }) : o[i];
      return j(this, "shape", s), s;
    },
    checks: []
  });
  return E(n, r);
}
function Pn(e, n, t) {
  const r = I(n._zod.def, {
    get shape() {
      const o = n._zod.def.shape, s = { ...o };
      if (t)
        for (const i in t) {
          if (!(i in s))
            throw new Error(`Unrecognized key: "${i}"`);
          t[i] && (s[i] = new e({
            type: "nonoptional",
            innerType: o[i]
          }));
        }
      else
        for (const i in o)
          s[i] = new e({
            type: "nonoptional",
            innerType: o[i]
          });
      return j(this, "shape", s), s;
    },
    checks: []
  });
  return E(n, r);
}
function A(e, n = 0) {
  var t;
  if (e.aborted === !0)
    return !0;
  for (let r = n; r < e.issues.length; r++)
    if (((t = e.issues[r]) == null ? void 0 : t.continue) !== !0)
      return !0;
  return !1;
}
function Fe(e, n) {
  return n.map((t) => {
    var r;
    return (r = t).path ?? (r.path = []), t.path.unshift(e), t;
  });
}
function D(e) {
  return typeof e == "string" ? e : e == null ? void 0 : e.message;
}
function Z(e, n, t) {
  var o, s, i, c, u, a;
  const r = { ...e, path: e.path ?? [] };
  if (!e.message) {
    const l = D((i = (s = (o = e.inst) == null ? void 0 : o._zod.def) == null ? void 0 : s.error) == null ? void 0 : i.call(s, e)) ?? D((c = n == null ? void 0 : n.error) == null ? void 0 : c.call(n, e)) ?? D((u = t.customError) == null ? void 0 : u.call(t, e)) ?? D((a = t.localeError) == null ? void 0 : a.call(t, e)) ?? "Invalid input";
    r.message = l;
  }
  return delete r.inst, delete r.continue, n != null && n.reportInput || delete r.input, r;
}
function ie(e) {
  return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function F(...e) {
  const [n, t, r] = e;
  return typeof n == "string" ? {
    message: n,
    code: "custom",
    input: t,
    inst: r
  } : { ...n };
}
const Ve = (e, n) => {
  e.name = "$ZodError", Object.defineProperty(e, "_zod", {
    value: e._zod,
    enumerable: !1
  }), Object.defineProperty(e, "issues", {
    value: n,
    enumerable: !1
  }), e.message = JSON.stringify(n, ee, 2), Object.defineProperty(e, "toString", {
    value: () => e.message,
    enumerable: !1
  });
}, De = f("$ZodError", Ve), Ue = f("$ZodError", Ve, { Parent: Error });
function Sn(e, n = (t) => t.message) {
  const t = {}, r = [];
  for (const o of e.issues)
    o.path.length > 0 ? (t[o.path[0]] = t[o.path[0]] || [], t[o.path[0]].push(n(o))) : r.push(n(o));
  return { formErrors: r, fieldErrors: t };
}
function En(e, n = (t) => t.message) {
  const t = { _errors: [] }, r = (o) => {
    for (const s of o.issues)
      if (s.code === "invalid_union" && s.errors.length)
        s.errors.map((i) => r({ issues: i }));
      else if (s.code === "invalid_key")
        r({ issues: s.issues });
      else if (s.code === "invalid_element")
        r({ issues: s.issues });
      else if (s.path.length === 0)
        t._errors.push(n(s));
      else {
        let i = t, c = 0;
        for (; c < s.path.length; ) {
          const u = s.path[c];
          c === s.path.length - 1 ? (i[u] = i[u] || { _errors: [] }, i[u]._errors.push(n(s))) : i[u] = i[u] || { _errors: [] }, i = i[u], c++;
        }
      }
  };
  return r(e), t;
}
const ue = (e) => (n, t, r, o) => {
  const s = r ? Object.assign(r, { async: !1 }) : { async: !1 }, i = n._zod.run({ value: t, issues: [] }, s);
  if (i instanceof Promise)
    throw new M();
  if (i.issues.length) {
    const c = new ((o == null ? void 0 : o.Err) ?? e)(i.issues.map((u) => Z(u, s, T())));
    throw xe(c, o == null ? void 0 : o.callee), c;
  }
  return i.value;
}, ce = (e) => async (n, t, r, o) => {
  const s = r ? Object.assign(r, { async: !0 }) : { async: !0 };
  let i = n._zod.run({ value: t, issues: [] }, s);
  if (i instanceof Promise && (i = await i), i.issues.length) {
    const c = new ((o == null ? void 0 : o.Err) ?? e)(i.issues.map((u) => Z(u, s, T())));
    throw xe(c, o == null ? void 0 : o.callee), c;
  }
  return i.value;
}, Y = (e) => (n, t, r) => {
  const o = r ? { ...r, async: !1 } : { async: !1 }, s = n._zod.run({ value: t, issues: [] }, o);
  if (s instanceof Promise)
    throw new M();
  return s.issues.length ? {
    success: !1,
    error: new (e ?? De)(s.issues.map((i) => Z(i, o, T())))
  } : { success: !0, data: s.value };
}, Nn = /* @__PURE__ */ Y(Ue), q = (e) => async (n, t, r) => {
  const o = r ? Object.assign(r, { async: !0 }) : { async: !0 };
  let s = n._zod.run({ value: t, issues: [] }, o);
  return s instanceof Promise && (s = await s), s.issues.length ? {
    success: !1,
    error: new e(s.issues.map((i) => Z(i, o, T())))
  } : { success: !0, data: s.value };
}, Tn = /* @__PURE__ */ q(Ue), Zn = (e) => (n, t, r) => {
  const o = r ? Object.assign(r, { direction: "backward" }) : { direction: "backward" };
  return ue(e)(n, t, o);
}, jn = (e) => (n, t, r) => ue(e)(n, t, r), In = (e) => async (n, t, r) => {
  const o = r ? Object.assign(r, { direction: "backward" }) : { direction: "backward" };
  return ce(e)(n, t, o);
}, Rn = (e) => async (n, t, r) => ce(e)(n, t, r), An = (e) => (n, t, r) => {
  const o = r ? Object.assign(r, { direction: "backward" }) : { direction: "backward" };
  return Y(e)(n, t, o);
}, Mn = (e) => (n, t, r) => Y(e)(n, t, r), Cn = (e) => async (n, t, r) => {
  const o = r ? Object.assign(r, { direction: "backward" }) : { direction: "backward" };
  return q(e)(n, t, o);
}, xn = (e) => async (n, t, r) => q(e)(n, t, r), Jn = /^-?\d+$/, Fn = /^-?\d+(?:\.\d+)?/, $ = /* @__PURE__ */ f("$ZodCheck", (e, n) => {
  var t;
  e._zod ?? (e._zod = {}), e._zod.def = n, (t = e._zod).onattach ?? (t.onattach = []);
}), Le = {
  number: "number",
  bigint: "bigint",
  object: "date"
}, Ge = /* @__PURE__ */ f("$ZodCheckLessThan", (e, n) => {
  $.init(e, n);
  const t = Le[typeof n.value];
  e._zod.onattach.push((r) => {
    const o = r._zod.bag, s = (n.inclusive ? o.maximum : o.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    n.value < s && (n.inclusive ? o.maximum = n.value : o.exclusiveMaximum = n.value);
  }), e._zod.check = (r) => {
    (n.inclusive ? r.value <= n.value : r.value < n.value) || r.issues.push({
      origin: t,
      code: "too_big",
      maximum: n.value,
      input: r.value,
      inclusive: n.inclusive,
      inst: e,
      continue: !n.abort
    });
  };
}), Ke = /* @__PURE__ */ f("$ZodCheckGreaterThan", (e, n) => {
  $.init(e, n);
  const t = Le[typeof n.value];
  e._zod.onattach.push((r) => {
    const o = r._zod.bag, s = (n.inclusive ? o.minimum : o.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    n.value > s && (n.inclusive ? o.minimum = n.value : o.exclusiveMinimum = n.value);
  }), e._zod.check = (r) => {
    (n.inclusive ? r.value >= n.value : r.value > n.value) || r.issues.push({
      origin: t,
      code: "too_small",
      minimum: n.value,
      input: r.value,
      inclusive: n.inclusive,
      inst: e,
      continue: !n.abort
    });
  };
}), Vn = /* @__PURE__ */ f("$ZodCheckMultipleOf", (e, n) => {
  $.init(e, n), e._zod.onattach.push((t) => {
    var r;
    (r = t._zod.bag).multipleOf ?? (r.multipleOf = n.value);
  }), e._zod.check = (t) => {
    if (typeof t.value != typeof n.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    (typeof t.value == "bigint" ? t.value % n.value === BigInt(0) : pn(t.value, n.value) === 0) || t.issues.push({
      origin: typeof t.value,
      code: "not_multiple_of",
      divisor: n.value,
      input: t.value,
      inst: e,
      continue: !n.abort
    });
  };
}), Dn = /* @__PURE__ */ f("$ZodCheckNumberFormat", (e, n) => {
  var i;
  $.init(e, n), n.format = n.format || "float64";
  const t = (i = n.format) == null ? void 0 : i.includes("int"), r = t ? "int" : "number", [o, s] = yn[n.format];
  e._zod.onattach.push((c) => {
    const u = c._zod.bag;
    u.format = n.format, u.minimum = o, u.maximum = s, t && (u.pattern = Jn);
  }), e._zod.check = (c) => {
    const u = c.value;
    if (t) {
      if (!Number.isInteger(u)) {
        c.issues.push({
          expected: r,
          format: n.format,
          code: "invalid_type",
          continue: !1,
          input: u,
          inst: e
        });
        return;
      }
      if (!Number.isSafeInteger(u)) {
        u > 0 ? c.issues.push({
          input: u,
          code: "too_big",
          maximum: Number.MAX_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          continue: !n.abort
        }) : c.issues.push({
          input: u,
          code: "too_small",
          minimum: Number.MIN_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          continue: !n.abort
        });
        return;
      }
    }
    u < o && c.issues.push({
      origin: "number",
      input: u,
      code: "too_small",
      minimum: o,
      inclusive: !0,
      inst: e,
      continue: !n.abort
    }), u > s && c.issues.push({
      origin: "number",
      input: u,
      code: "too_big",
      maximum: s,
      inst: e
    });
  };
}), Un = /* @__PURE__ */ f("$ZodCheckMaxLength", (e, n) => {
  var t;
  $.init(e, n), (t = e._zod.def).when ?? (t.when = (r) => {
    const o = r.value;
    return !oe(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    n.maximum < o && (r._zod.bag.maximum = n.maximum);
  }), e._zod.check = (r) => {
    const o = r.value;
    if (o.length <= n.maximum)
      return;
    const i = ie(o);
    r.issues.push({
      origin: i,
      code: "too_big",
      maximum: n.maximum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !n.abort
    });
  };
}), Ln = /* @__PURE__ */ f("$ZodCheckMinLength", (e, n) => {
  var t;
  $.init(e, n), (t = e._zod.def).when ?? (t.when = (r) => {
    const o = r.value;
    return !oe(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    n.minimum > o && (r._zod.bag.minimum = n.minimum);
  }), e._zod.check = (r) => {
    const o = r.value;
    if (o.length >= n.minimum)
      return;
    const i = ie(o);
    r.issues.push({
      origin: i,
      code: "too_small",
      minimum: n.minimum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !n.abort
    });
  };
}), Gn = /* @__PURE__ */ f("$ZodCheckLengthEquals", (e, n) => {
  var t;
  $.init(e, n), (t = e._zod.def).when ?? (t.when = (r) => {
    const o = r.value;
    return !oe(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag;
    o.minimum = n.length, o.maximum = n.length, o.length = n.length;
  }), e._zod.check = (r) => {
    const o = r.value, s = o.length;
    if (s === n.length)
      return;
    const i = ie(o), c = s > n.length;
    r.issues.push({
      origin: i,
      ...c ? { code: "too_big", maximum: n.length } : { code: "too_small", minimum: n.length },
      inclusive: !0,
      exact: !0,
      input: r.value,
      inst: e,
      continue: !n.abort
    });
  };
}), Kn = /* @__PURE__ */ f("$ZodCheckOverwrite", (e, n) => {
  $.init(e, n), e._zod.check = (t) => {
    t.value = n.tx(t.value);
  };
});
class Bn {
  constructor(n = []) {
    this.content = [], this.indent = 0, this && (this.args = n);
  }
  indented(n) {
    this.indent += 1, n(this), this.indent -= 1;
  }
  write(n) {
    if (typeof n == "function") {
      n(this, { execution: "sync" }), n(this, { execution: "async" });
      return;
    }
    const r = n.split(`
`).filter((i) => i), o = Math.min(...r.map((i) => i.length - i.trimStart().length)), s = r.map((i) => i.slice(o)).map((i) => " ".repeat(this.indent * 2) + i);
    for (const i of s)
      this.content.push(i);
  }
  compile() {
    const n = Function, t = this == null ? void 0 : this.args, o = [...((this == null ? void 0 : this.content) ?? [""]).map((s) => `  ${s}`)];
    return new n(...t, o.join(`
`));
  }
}
const Wn = {
  major: 4,
  minor: 2,
  patch: 1
}, v = /* @__PURE__ */ f("$ZodType", (e, n) => {
  var o;
  var t;
  e ?? (e = {}), e._zod.def = n, e._zod.bag = e._zod.bag || {}, e._zod.version = Wn;
  const r = [...e._zod.def.checks ?? []];
  e._zod.traits.has("$ZodCheck") && r.unshift(e);
  for (const s of r)
    for (const i of s._zod.onattach)
      i(e);
  if (r.length === 0)
    (t = e._zod).deferred ?? (t.deferred = []), (o = e._zod.deferred) == null || o.push(() => {
      e._zod.run = e._zod.parse;
    });
  else {
    const s = (c, u, a) => {
      let l = A(c), d;
      for (const h of u) {
        if (h._zod.def.when) {
          if (!h._zod.def.when(c))
            continue;
        } else if (l)
          continue;
        const p = c.issues.length, _ = h._zod.check(c);
        if (_ instanceof Promise && (a == null ? void 0 : a.async) === !1)
          throw new M();
        if (d || _ instanceof Promise)
          d = (d ?? Promise.resolve()).then(async () => {
            await _, c.issues.length !== p && (l || (l = A(c, p)));
          });
        else {
          if (c.issues.length === p)
            continue;
          l || (l = A(c, p));
        }
      }
      return d ? d.then(() => c) : c;
    }, i = (c, u, a) => {
      if (A(c))
        return c.aborted = !0, c;
      const l = s(u, r, a);
      if (l instanceof Promise) {
        if (a.async === !1)
          throw new M();
        return l.then((d) => e._zod.parse(d, a));
      }
      return e._zod.parse(l, a);
    };
    e._zod.run = (c, u) => {
      if (u.skipChecks)
        return e._zod.parse(c, u);
      if (u.direction === "backward") {
        const l = e._zod.parse({ value: c.value, issues: [] }, { ...u, skipChecks: !0 });
        return l instanceof Promise ? l.then((d) => i(d, c, u)) : i(l, c, u);
      }
      const a = e._zod.parse(c, u);
      if (a instanceof Promise) {
        if (u.async === !1)
          throw new M();
        return a.then((l) => s(l, r, u));
      }
      return s(a, r, u);
    };
  }
  e["~standard"] = {
    validate: (s) => {
      var i;
      try {
        const c = Nn(e, s);
        return c.success ? { value: c.data } : { issues: (i = c.error) == null ? void 0 : i.issues };
      } catch {
        return Tn(e, s).then((u) => {
          var a;
          return u.success ? { value: u.data } : { issues: (a = u.error) == null ? void 0 : a.issues };
        });
      }
    },
    vendor: "zod",
    version: 1
  };
}), Be = /* @__PURE__ */ f("$ZodNumber", (e, n) => {
  v.init(e, n), e._zod.pattern = e._zod.bag.pattern ?? Fn, e._zod.parse = (t, r) => {
    if (n.coerce)
      try {
        t.value = Number(t.value);
      } catch {
      }
    const o = t.value;
    if (typeof o == "number" && !Number.isNaN(o) && Number.isFinite(o))
      return t;
    const s = typeof o == "number" ? Number.isNaN(o) ? "NaN" : Number.isFinite(o) ? void 0 : "Infinity" : void 0;
    return t.issues.push({
      expected: "number",
      code: "invalid_type",
      input: o,
      inst: e,
      ...s ? { received: s } : {}
    }), t;
  };
}), Yn = /* @__PURE__ */ f("$ZodNumberFormat", (e, n) => {
  Dn.init(e, n), Be.init(e, n);
}), qn = /* @__PURE__ */ f("$ZodUnknown", (e, n) => {
  v.init(e, n), e._zod.parse = (t) => t;
}), Xn = /* @__PURE__ */ f("$ZodNever", (e, n) => {
  v.init(e, n), e._zod.parse = (t, r) => (t.issues.push({
    expected: "never",
    code: "invalid_type",
    input: t.value,
    inst: e
  }), t);
});
function fe(e, n, t) {
  e.issues.length && n.issues.push(...Fe(t, e.issues)), n.value[t] = e.value;
}
const Hn = /* @__PURE__ */ f("$ZodArray", (e, n) => {
  v.init(e, n), e._zod.parse = (t, r) => {
    const o = t.value;
    if (!Array.isArray(o))
      return t.issues.push({
        expected: "array",
        code: "invalid_type",
        input: o,
        inst: e
      }), t;
    t.value = Array(o.length);
    const s = [];
    for (let i = 0; i < o.length; i++) {
      const c = o[i], u = n.element._zod.run({
        value: c,
        issues: []
      }, r);
      u instanceof Promise ? s.push(u.then((a) => fe(a, t, i))) : fe(u, t, i);
    }
    return s.length ? Promise.all(s).then(() => t) : t;
  };
});
function G(e, n, t, r) {
  e.issues.length && n.issues.push(...Fe(t, e.issues)), e.value === void 0 ? t in r && (n.value[t] = void 0) : n.value[t] = e.value;
}
function We(e) {
  var r, o, s, i;
  const n = Object.keys(e.shape);
  for (const c of n)
    if (!((i = (s = (o = (r = e.shape) == null ? void 0 : r[c]) == null ? void 0 : o._zod) == null ? void 0 : s.traits) != null && i.has("$ZodType")))
      throw new Error(`Invalid element at key "${c}": expected a Zod schema`);
  const t = vn(e.shape);
  return {
    ...e,
    keys: n,
    keySet: new Set(n),
    numKeys: n.length,
    optionalKeys: new Set(t)
  };
}
function Ye(e, n, t, r, o, s) {
  const i = [], c = o.keySet, u = o.catchall._zod, a = u.def.type;
  for (const l in n) {
    if (c.has(l))
      continue;
    if (a === "never") {
      i.push(l);
      continue;
    }
    const d = u.run({ value: n[l], issues: [] }, r);
    d instanceof Promise ? e.push(d.then((h) => G(h, t, l, n))) : G(d, t, l, n);
  }
  return i.length && t.issues.push({
    code: "unrecognized_keys",
    keys: i,
    input: n,
    inst: s
  }), e.length ? Promise.all(e).then(() => t) : t;
}
const Qn = /* @__PURE__ */ f("$ZodObject", (e, n) => {
  v.init(e, n);
  const t = Object.getOwnPropertyDescriptor(n, "shape");
  if (!(t != null && t.get)) {
    const c = n.shape;
    Object.defineProperty(n, "shape", {
      get: () => {
        const u = { ...c };
        return Object.defineProperty(n, "shape", {
          value: u
        }), u;
      }
    });
  }
  const r = re(() => We(n));
  m(e._zod, "propValues", () => {
    const c = n.shape, u = {};
    for (const a in c) {
      const l = c[a]._zod;
      if (l.values) {
        u[a] ?? (u[a] = /* @__PURE__ */ new Set());
        for (const d of l.values)
          u[a].add(d);
      }
    }
    return u;
  });
  const o = L, s = n.catchall;
  let i;
  e._zod.parse = (c, u) => {
    i ?? (i = r.value);
    const a = c.value;
    if (!o(a))
      return c.issues.push({
        expected: "object",
        code: "invalid_type",
        input: a,
        inst: e
      }), c;
    c.value = {};
    const l = [], d = i.shape;
    for (const h of i.keys) {
      const _ = d[h]._zod.run({ value: a[h], issues: [] }, u);
      _ instanceof Promise ? l.push(_.then((w) => G(w, c, h, a))) : G(_, c, h, a);
    }
    return s ? Ye(l, a, c, u, r.value, e) : l.length ? Promise.all(l).then(() => c) : c;
  };
}), et = /* @__PURE__ */ f("$ZodObjectJIT", (e, n) => {
  Qn.init(e, n);
  const t = e._zod.parse, r = re(() => We(n)), o = (h) => {
    const p = new Bn(["shape", "payload", "ctx"]), _ = r.value, w = (P) => {
      const O = le(P);
      return `shape[${O}]._zod.run({ value: input[${O}], issues: [] }, ctx)`;
    };
    p.write("const input = payload.value;");
    const R = /* @__PURE__ */ Object.create(null);
    let X = 0;
    for (const P of _.keys)
      R[P] = `key_${X++}`;
    p.write("const newResult = {};");
    for (const P of _.keys) {
      const O = R[P], C = le(P);
      p.write(`const ${O} = ${w(P)};`), p.write(`
        if (${O}.issues.length) {
          payload.issues = payload.issues.concat(${O}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${C}, ...iss.path] : [${C}]
          })));
        }
        
        
        if (${O}.value === undefined) {
          if (${C} in input) {
            newResult[${C}] = undefined;
          }
        } else {
          newResult[${C}] = ${O}.value;
        }
        
      `);
    }
    p.write("payload.value = newResult;"), p.write("return payload;");
    const tn = p.compile();
    return (P, O) => tn(h, P, O);
  };
  let s;
  const i = L, c = !Me.jitless, a = c && mn.value, l = n.catchall;
  let d;
  e._zod.parse = (h, p) => {
    d ?? (d = r.value);
    const _ = h.value;
    return i(_) ? c && a && (p == null ? void 0 : p.async) === !1 && p.jitless !== !0 ? (s || (s = o(n.shape)), h = s(h, p), l ? Ye([], _, h, p, d, e) : h) : t(h, p) : (h.issues.push({
      expected: "object",
      code: "invalid_type",
      input: _,
      inst: e
    }), h);
  };
});
function de(e, n, t, r) {
  for (const s of e)
    if (s.issues.length === 0)
      return n.value = s.value, n;
  const o = e.filter((s) => !A(s));
  return o.length === 1 ? (n.value = o[0].value, o[0]) : (n.issues.push({
    code: "invalid_union",
    input: n.value,
    inst: t,
    errors: e.map((s) => s.issues.map((i) => Z(i, r, T())))
  }), n);
}
const nt = /* @__PURE__ */ f("$ZodUnion", (e, n) => {
  v.init(e, n), m(e._zod, "optin", () => n.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0), m(e._zod, "optout", () => n.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0), m(e._zod, "values", () => {
    if (n.options.every((o) => o._zod.values))
      return new Set(n.options.flatMap((o) => Array.from(o._zod.values)));
  }), m(e._zod, "pattern", () => {
    if (n.options.every((o) => o._zod.pattern)) {
      const o = n.options.map((s) => s._zod.pattern);
      return new RegExp(`^(${o.map((s) => se(s.source)).join("|")})$`);
    }
  });
  const t = n.options.length === 1, r = n.options[0]._zod.run;
  e._zod.parse = (o, s) => {
    if (t)
      return r(o, s);
    let i = !1;
    const c = [];
    for (const u of n.options) {
      const a = u._zod.run({
        value: o.value,
        issues: []
      }, s);
      if (a instanceof Promise)
        c.push(a), i = !0;
      else {
        if (a.issues.length === 0)
          return a;
        c.push(a);
      }
    }
    return i ? Promise.all(c).then((u) => de(u, o, e, s)) : de(c, o, e, s);
  };
}), tt = /* @__PURE__ */ f("$ZodIntersection", (e, n) => {
  v.init(e, n), e._zod.parse = (t, r) => {
    const o = t.value, s = n.left._zod.run({ value: o, issues: [] }, r), i = n.right._zod.run({ value: o, issues: [] }, r);
    return s instanceof Promise || i instanceof Promise ? Promise.all([s, i]).then(([u, a]) => he(t, u, a)) : he(t, s, i);
  };
});
function ne(e, n) {
  if (e === n)
    return { valid: !0, data: e };
  if (e instanceof Date && n instanceof Date && +e == +n)
    return { valid: !0, data: e };
  if (J(e) && J(n)) {
    const t = Object.keys(n), r = Object.keys(e).filter((s) => t.indexOf(s) !== -1), o = { ...e, ...n };
    for (const s of r) {
      const i = ne(e[s], n[s]);
      if (!i.valid)
        return {
          valid: !1,
          mergeErrorPath: [s, ...i.mergeErrorPath]
        };
      o[s] = i.data;
    }
    return { valid: !0, data: o };
  }
  if (Array.isArray(e) && Array.isArray(n)) {
    if (e.length !== n.length)
      return { valid: !1, mergeErrorPath: [] };
    const t = [];
    for (let r = 0; r < e.length; r++) {
      const o = e[r], s = n[r], i = ne(o, s);
      if (!i.valid)
        return {
          valid: !1,
          mergeErrorPath: [r, ...i.mergeErrorPath]
        };
      t.push(i.data);
    }
    return { valid: !0, data: t };
  }
  return { valid: !1, mergeErrorPath: [] };
}
function he(e, n, t) {
  if (n.issues.length && e.issues.push(...n.issues), t.issues.length && e.issues.push(...t.issues), A(e))
    return e;
  const r = ne(n.value, t.value);
  if (!r.valid)
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(r.mergeErrorPath)}`);
  return e.value = r.data, e;
}
const rt = /* @__PURE__ */ f("$ZodEnum", (e, n) => {
  v.init(e, n);
  const t = Ce(n.entries), r = new Set(t);
  e._zod.values = r, e._zod.pattern = new RegExp(`^(${t.filter((o) => _n.has(typeof o)).map((o) => typeof o == "string" ? gn(o) : o.toString()).join("|")})$`), e._zod.parse = (o, s) => {
    const i = o.value;
    return r.has(i) || o.issues.push({
      code: "invalid_value",
      values: t,
      input: i,
      inst: e
    }), o;
  };
}), ot = /* @__PURE__ */ f("$ZodTransform", (e, n) => {
  v.init(e, n), e._zod.parse = (t, r) => {
    if (r.direction === "backward")
      throw new Ae(e.constructor.name);
    const o = n.transform(t.value, t);
    if (r.async)
      return (o instanceof Promise ? o : Promise.resolve(o)).then((i) => (t.value = i, t));
    if (o instanceof Promise)
      throw new M();
    return t.value = o, t;
  };
});
function pe(e, n) {
  return e.issues.length && n === void 0 ? { issues: [], value: void 0 } : e;
}
const st = /* @__PURE__ */ f("$ZodOptional", (e, n) => {
  v.init(e, n), e._zod.optin = "optional", e._zod.optout = "optional", m(e._zod, "values", () => n.innerType._zod.values ? /* @__PURE__ */ new Set([...n.innerType._zod.values, void 0]) : void 0), m(e._zod, "pattern", () => {
    const t = n.innerType._zod.pattern;
    return t ? new RegExp(`^(${se(t.source)})?$`) : void 0;
  }), e._zod.parse = (t, r) => {
    if (n.innerType._zod.optin === "optional") {
      const o = n.innerType._zod.run(t, r);
      return o instanceof Promise ? o.then((s) => pe(s, t.value)) : pe(o, t.value);
    }
    return t.value === void 0 ? t : n.innerType._zod.run(t, r);
  };
}), it = /* @__PURE__ */ f("$ZodNullable", (e, n) => {
  v.init(e, n), m(e._zod, "optin", () => n.innerType._zod.optin), m(e._zod, "optout", () => n.innerType._zod.optout), m(e._zod, "pattern", () => {
    const t = n.innerType._zod.pattern;
    return t ? new RegExp(`^(${se(t.source)}|null)$`) : void 0;
  }), m(e._zod, "values", () => n.innerType._zod.values ? /* @__PURE__ */ new Set([...n.innerType._zod.values, null]) : void 0), e._zod.parse = (t, r) => t.value === null ? t : n.innerType._zod.run(t, r);
}), ut = /* @__PURE__ */ f("$ZodDefault", (e, n) => {
  v.init(e, n), e._zod.optin = "optional", m(e._zod, "values", () => n.innerType._zod.values), e._zod.parse = (t, r) => {
    if (r.direction === "backward")
      return n.innerType._zod.run(t, r);
    if (t.value === void 0)
      return t.value = n.defaultValue, t;
    const o = n.innerType._zod.run(t, r);
    return o instanceof Promise ? o.then((s) => me(s, n)) : me(o, n);
  };
});
function me(e, n) {
  return e.value === void 0 && (e.value = n.defaultValue), e;
}
const ct = /* @__PURE__ */ f("$ZodPrefault", (e, n) => {
  v.init(e, n), e._zod.optin = "optional", m(e._zod, "values", () => n.innerType._zod.values), e._zod.parse = (t, r) => (r.direction === "backward" || t.value === void 0 && (t.value = n.defaultValue), n.innerType._zod.run(t, r));
}), at = /* @__PURE__ */ f("$ZodNonOptional", (e, n) => {
  v.init(e, n), m(e._zod, "values", () => {
    const t = n.innerType._zod.values;
    return t ? new Set([...t].filter((r) => r !== void 0)) : void 0;
  }), e._zod.parse = (t, r) => {
    const o = n.innerType._zod.run(t, r);
    return o instanceof Promise ? o.then((s) => _e(s, e)) : _e(o, e);
  };
});
function _e(e, n) {
  return !e.issues.length && e.value === void 0 && e.issues.push({
    code: "invalid_type",
    expected: "nonoptional",
    input: e.value,
    inst: n
  }), e;
}
const lt = /* @__PURE__ */ f("$ZodCatch", (e, n) => {
  v.init(e, n), m(e._zod, "optin", () => n.innerType._zod.optin), m(e._zod, "optout", () => n.innerType._zod.optout), m(e._zod, "values", () => n.innerType._zod.values), e._zod.parse = (t, r) => {
    if (r.direction === "backward")
      return n.innerType._zod.run(t, r);
    const o = n.innerType._zod.run(t, r);
    return o instanceof Promise ? o.then((s) => (t.value = s.value, s.issues.length && (t.value = n.catchValue({
      ...t,
      error: {
        issues: s.issues.map((i) => Z(i, r, T()))
      },
      input: t.value
    }), t.issues = []), t)) : (t.value = o.value, o.issues.length && (t.value = n.catchValue({
      ...t,
      error: {
        issues: o.issues.map((s) => Z(s, r, T()))
      },
      input: t.value
    }), t.issues = []), t);
  };
}), ft = /* @__PURE__ */ f("$ZodPipe", (e, n) => {
  v.init(e, n), m(e._zod, "values", () => n.in._zod.values), m(e._zod, "optin", () => n.in._zod.optin), m(e._zod, "optout", () => n.out._zod.optout), m(e._zod, "propValues", () => n.in._zod.propValues), e._zod.parse = (t, r) => {
    if (r.direction === "backward") {
      const s = n.out._zod.run(t, r);
      return s instanceof Promise ? s.then((i) => U(i, n.in, r)) : U(s, n.in, r);
    }
    const o = n.in._zod.run(t, r);
    return o instanceof Promise ? o.then((s) => U(s, n.out, r)) : U(o, n.out, r);
  };
});
function U(e, n, t) {
  return e.issues.length ? (e.aborted = !0, e) : n._zod.run({ value: e.value, issues: e.issues }, t);
}
const dt = /* @__PURE__ */ f("$ZodReadonly", (e, n) => {
  v.init(e, n), m(e._zod, "propValues", () => n.innerType._zod.propValues), m(e._zod, "values", () => n.innerType._zod.values), m(e._zod, "optin", () => {
    var t, r;
    return (r = (t = n.innerType) == null ? void 0 : t._zod) == null ? void 0 : r.optin;
  }), m(e._zod, "optout", () => {
    var t, r;
    return (r = (t = n.innerType) == null ? void 0 : t._zod) == null ? void 0 : r.optout;
  }), e._zod.parse = (t, r) => {
    if (r.direction === "backward")
      return n.innerType._zod.run(t, r);
    const o = n.innerType._zod.run(t, r);
    return o instanceof Promise ? o.then(ge) : ge(o);
  };
});
function ge(e) {
  return e.value = Object.freeze(e.value), e;
}
const ht = /* @__PURE__ */ f("$ZodCustom", (e, n) => {
  $.init(e, n), v.init(e, n), e._zod.parse = (t, r) => t, e._zod.check = (t) => {
    const r = t.value, o = n.fn(r);
    if (o instanceof Promise)
      return o.then((s) => ve(s, t, r, e));
    ve(o, t, r, e);
  };
});
function ve(e, n, t, r) {
  if (!e) {
    const o = {
      code: "custom",
      input: t,
      inst: r,
      // incorporates params.error into issue reporting
      path: [...r._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !r._zod.def.abort
      // params: inst._zod.def.params,
    };
    r._zod.def.params && (o.params = r._zod.def.params), n.issues.push(F(o));
  }
}
var ye;
class pt {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
  }
  add(n, ...t) {
    const r = t[0];
    if (this._map.set(n, r), r && typeof r == "object" && "id" in r) {
      if (this._idmap.has(r.id))
        throw new Error(`ID ${r.id} already exists in the registry`);
      this._idmap.set(r.id, n);
    }
    return this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
  }
  remove(n) {
    const t = this._map.get(n);
    return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(n), this;
  }
  get(n) {
    const t = n._zod.parent;
    if (t) {
      const r = { ...this.get(t) ?? {} };
      delete r.id;
      const o = { ...r, ...this._map.get(n) };
      return Object.keys(o).length ? o : void 0;
    }
    return this._map.get(n);
  }
  has(n) {
    return this._map.has(n);
  }
}
function mt() {
  return new pt();
}
(ye = globalThis).__zod_globalRegistry ?? (ye.__zod_globalRegistry = mt());
const x = globalThis.__zod_globalRegistry;
function _t(e, n) {
  return new e({
    type: "number",
    checks: [],
    ...g(n)
  });
}
function gt(e, n) {
  return new e({
    type: "number",
    check: "number_format",
    abort: !1,
    format: "safeint",
    ...g(n)
  });
}
function vt(e) {
  return new e({
    type: "unknown"
  });
}
function yt(e, n) {
  return new e({
    type: "never",
    ...g(n)
  });
}
function ze(e, n) {
  return new Ge({
    check: "less_than",
    ...g(n),
    value: e,
    inclusive: !1
  });
}
function H(e, n) {
  return new Ge({
    check: "less_than",
    ...g(n),
    value: e,
    inclusive: !0
  });
}
function be(e, n) {
  return new Ke({
    check: "greater_than",
    ...g(n),
    value: e,
    inclusive: !1
  });
}
function Q(e, n) {
  return new Ke({
    check: "greater_than",
    ...g(n),
    value: e,
    inclusive: !0
  });
}
function we(e, n) {
  return new Vn({
    check: "multiple_of",
    ...g(n),
    value: e
  });
}
function zt(e, n) {
  return new Un({
    check: "max_length",
    ...g(n),
    maximum: e
  });
}
function ke(e, n) {
  return new Ln({
    check: "min_length",
    ...g(n),
    minimum: e
  });
}
function bt(e, n) {
  return new Gn({
    check: "length_equals",
    ...g(n),
    length: e
  });
}
function wt(e) {
  return new Kn({
    check: "overwrite",
    tx: e
  });
}
function kt(e, n, t) {
  return new e({
    type: "array",
    element: n,
    // get element() {
    //   return element;
    // },
    ...g(t)
  });
}
function Ot(e, n, t) {
  return new e({
    type: "custom",
    check: "custom",
    fn: n,
    ...g(t)
  });
}
function $t(e) {
  const n = Pt((t) => (t.addIssue = (r) => {
    if (typeof r == "string")
      t.issues.push(F(r, t.value, n._zod.def));
    else {
      const o = r;
      o.fatal && (o.continue = !1), o.code ?? (o.code = "custom"), o.input ?? (o.input = t.value), o.inst ?? (o.inst = n), o.continue ?? (o.continue = !n._zod.def.abort), t.issues.push(F(o));
    }
  }, e(t.value, t)));
  return n;
}
function Pt(e, n) {
  const t = new $({
    check: "custom",
    ...g(n)
  });
  return t._zod.check = e, t;
}
function qe(e) {
  let n = (e == null ? void 0 : e.target) ?? "draft-2020-12";
  return n === "draft-4" && (n = "draft-04"), n === "draft-7" && (n = "draft-07"), {
    processors: e.processors ?? {},
    metadataRegistry: (e == null ? void 0 : e.metadata) ?? x,
    target: n,
    unrepresentable: (e == null ? void 0 : e.unrepresentable) ?? "throw",
    override: (e == null ? void 0 : e.override) ?? (() => {
    }),
    io: (e == null ? void 0 : e.io) ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: (e == null ? void 0 : e.cycles) ?? "ref",
    reused: (e == null ? void 0 : e.reused) ?? "inline",
    external: (e == null ? void 0 : e.external) ?? void 0
  };
}
function z(e, n, t = { path: [], schemaPath: [] }) {
  var l, d;
  var r;
  const o = e._zod.def, s = n.seen.get(e);
  if (s)
    return s.count++, t.schemaPath.includes(e) && (s.cycle = t.path), s.schema;
  const i = { schema: {}, count: 1, cycle: void 0, path: t.path };
  n.seen.set(e, i);
  const c = (d = (l = e._zod).toJSONSchema) == null ? void 0 : d.call(l);
  if (c)
    i.schema = c;
  else {
    const h = {
      ...t,
      schemaPath: [...t.schemaPath, e],
      path: t.path
    }, p = e._zod.parent;
    if (p)
      i.ref = p, z(p, n, h), n.seen.get(p).isParent = !0;
    else if (e._zod.processJSONSchema)
      e._zod.processJSONSchema(n, i.schema, h);
    else {
      const _ = i.schema, w = n.processors[o.type];
      if (!w)
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${o.type}`);
      w(e, n, _, h);
    }
  }
  const u = n.metadataRegistry.get(e);
  return u && Object.assign(i.schema, u), n.io === "input" && b(e) && (delete i.schema.examples, delete i.schema.default), n.io === "input" && i.schema._prefault && ((r = i.schema).default ?? (r.default = i.schema._prefault)), delete i.schema._prefault, n.seen.get(e).schema;
}
function Xe(e, n) {
  var s, i, c;
  const t = e.seen.get(n);
  if (!t)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = (u) => {
    var p;
    const a = e.target === "draft-2020-12" ? "$defs" : "definitions";
    if (e.external) {
      const _ = (p = e.external.registry.get(u[0])) == null ? void 0 : p.id, w = e.external.uri ?? ((X) => X);
      if (_)
        return { ref: w(_) };
      const R = u[1].defId ?? u[1].schema.id ?? `schema${e.counter++}`;
      return u[1].defId = R, { defId: R, ref: `${w("__shared")}#/${a}/${R}` };
    }
    if (u[1] === t)
      return { ref: "#" };
    const d = `#/${a}/`, h = u[1].schema.id ?? `__schema${e.counter++}`;
    return { defId: h, ref: d + h };
  }, o = (u) => {
    if (u[1].schema.$ref)
      return;
    const a = u[1], { ref: l, defId: d } = r(u);
    a.def = { ...a.schema }, d && (a.defId = d);
    const h = a.schema;
    for (const p in h)
      delete h[p];
    h.$ref = l;
  };
  if (e.cycles === "throw")
    for (const u of e.seen.entries()) {
      const a = u[1];
      if (a.cycle)
        throw new Error(`Cycle detected: #/${(s = a.cycle) == null ? void 0 : s.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (const u of e.seen.entries()) {
    const a = u[1];
    if (n === u[0]) {
      o(u);
      continue;
    }
    if (e.external) {
      const d = (i = e.external.registry.get(u[0])) == null ? void 0 : i.id;
      if (n !== u[0] && d) {
        o(u);
        continue;
      }
    }
    if ((c = e.metadataRegistry.get(u[0])) == null ? void 0 : c.id) {
      o(u);
      continue;
    }
    if (a.cycle) {
      o(u);
      continue;
    }
    if (a.count > 1 && e.reused === "ref") {
      o(u);
      continue;
    }
  }
}
function He(e, n) {
  var i, c, u;
  const t = e.seen.get(n);
  if (!t)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = (a) => {
    const l = e.seen.get(a), d = l.def ?? l.schema, h = { ...d };
    if (l.ref === null)
      return;
    const p = l.ref;
    if (l.ref = null, p) {
      r(p);
      const _ = e.seen.get(p).schema;
      _.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (d.allOf = d.allOf ?? [], d.allOf.push(_)) : (Object.assign(d, _), Object.assign(d, h));
    }
    l.isParent || e.override({
      zodSchema: a,
      jsonSchema: d,
      path: l.path ?? []
    });
  };
  for (const a of [...e.seen.entries()].reverse())
    r(a[0]);
  const o = {};
  if (e.target === "draft-2020-12" ? o.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? o.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? o.$schema = "http://json-schema.org/draft-04/schema#" : e.target, (i = e.external) != null && i.uri) {
    const a = (c = e.external.registry.get(n)) == null ? void 0 : c.id;
    if (!a)
      throw new Error("Schema is missing an `id` property");
    o.$id = e.external.uri(a);
  }
  Object.assign(o, t.def ?? t.schema);
  const s = ((u = e.external) == null ? void 0 : u.defs) ?? {};
  for (const a of e.seen.entries()) {
    const l = a[1];
    l.def && l.defId && (s[l.defId] = l.def);
  }
  e.external || Object.keys(s).length > 0 && (e.target === "draft-2020-12" ? o.$defs = s : o.definitions = s);
  try {
    const a = JSON.parse(JSON.stringify(o));
    return Object.defineProperty(a, "~standard", {
      value: {
        ...n["~standard"],
        jsonSchema: {
          input: K(n, "input"),
          output: K(n, "output")
        }
      },
      enumerable: !1,
      writable: !1
    }), a;
  } catch {
    throw new Error("Error converting schema to JSON.");
  }
}
function b(e, n) {
  const t = n ?? { seen: /* @__PURE__ */ new Set() };
  if (t.seen.has(e))
    return !1;
  t.seen.add(e);
  const r = e._zod.def;
  if (r.type === "transform")
    return !0;
  if (r.type === "array")
    return b(r.element, t);
  if (r.type === "set")
    return b(r.valueType, t);
  if (r.type === "lazy")
    return b(r.getter(), t);
  if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault")
    return b(r.innerType, t);
  if (r.type === "intersection")
    return b(r.left, t) || b(r.right, t);
  if (r.type === "record" || r.type === "map")
    return b(r.keyType, t) || b(r.valueType, t);
  if (r.type === "pipe")
    return b(r.in, t) || b(r.out, t);
  if (r.type === "object") {
    for (const o in r.shape)
      if (b(r.shape[o], t))
        return !0;
    return !1;
  }
  if (r.type === "union") {
    for (const o of r.options)
      if (b(o, t))
        return !0;
    return !1;
  }
  if (r.type === "tuple") {
    for (const o of r.items)
      if (b(o, t))
        return !0;
    return !!(r.rest && b(r.rest, t));
  }
  return !1;
}
const St = (e, n = {}) => (t) => {
  const r = qe({ ...t, processors: n });
  return z(e, r), Xe(r, e), He(r, e);
}, K = (e, n) => (t) => {
  const { libraryOptions: r, target: o } = t ?? {}, s = qe({ ...r ?? {}, target: o, io: n, processors: {} });
  return z(e, s), Xe(s, e), He(s, e);
}, Et = (e, n, t, r) => {
  const o = t, { minimum: s, maximum: i, format: c, multipleOf: u, exclusiveMaximum: a, exclusiveMinimum: l } = e._zod.bag;
  typeof c == "string" && c.includes("int") ? o.type = "integer" : o.type = "number", typeof l == "number" && (n.target === "draft-04" || n.target === "openapi-3.0" ? (o.minimum = l, o.exclusiveMinimum = !0) : o.exclusiveMinimum = l), typeof s == "number" && (o.minimum = s, typeof l == "number" && n.target !== "draft-04" && (l >= s ? delete o.minimum : delete o.exclusiveMinimum)), typeof a == "number" && (n.target === "draft-04" || n.target === "openapi-3.0" ? (o.maximum = a, o.exclusiveMaximum = !0) : o.exclusiveMaximum = a), typeof i == "number" && (o.maximum = i, typeof a == "number" && n.target !== "draft-04" && (a <= i ? delete o.maximum : delete o.exclusiveMaximum)), typeof u == "number" && (o.multipleOf = u);
}, Nt = (e, n, t, r) => {
  t.not = {};
}, Tt = (e, n, t, r) => {
}, Zt = (e, n, t, r) => {
  const o = e._zod.def, s = Ce(o.entries);
  s.every((i) => typeof i == "number") && (t.type = "number"), s.every((i) => typeof i == "string") && (t.type = "string"), t.enum = s;
}, jt = (e, n, t, r) => {
  if (n.unrepresentable === "throw")
    throw new Error("Custom types cannot be represented in JSON Schema");
}, It = (e, n, t, r) => {
  if (n.unrepresentable === "throw")
    throw new Error("Transforms cannot be represented in JSON Schema");
}, Rt = (e, n, t, r) => {
  const o = t, s = e._zod.def, { minimum: i, maximum: c } = e._zod.bag;
  typeof i == "number" && (o.minItems = i), typeof c == "number" && (o.maxItems = c), o.type = "array", o.items = z(s.element, n, { ...r, path: [...r.path, "items"] });
}, At = (e, n, t, r) => {
  var a;
  const o = t, s = e._zod.def;
  o.type = "object", o.properties = {};
  const i = s.shape;
  for (const l in i)
    o.properties[l] = z(i[l], n, {
      ...r,
      path: [...r.path, "properties", l]
    });
  const c = new Set(Object.keys(i)), u = new Set([...c].filter((l) => {
    const d = s.shape[l]._zod;
    return n.io === "input" ? d.optin === void 0 : d.optout === void 0;
  }));
  u.size > 0 && (o.required = Array.from(u)), ((a = s.catchall) == null ? void 0 : a._zod.def.type) === "never" ? o.additionalProperties = !1 : s.catchall ? s.catchall && (o.additionalProperties = z(s.catchall, n, {
    ...r,
    path: [...r.path, "additionalProperties"]
  })) : n.io === "output" && (o.additionalProperties = !1);
}, Mt = (e, n, t, r) => {
  const o = e._zod.def, s = o.inclusive === !1, i = o.options.map((c, u) => z(c, n, {
    ...r,
    path: [...r.path, s ? "oneOf" : "anyOf", u]
  }));
  s ? t.oneOf = i : t.anyOf = i;
}, Ct = (e, n, t, r) => {
  const o = e._zod.def, s = z(o.left, n, {
    ...r,
    path: [...r.path, "allOf", 0]
  }), i = z(o.right, n, {
    ...r,
    path: [...r.path, "allOf", 1]
  }), c = (a) => "allOf" in a && Object.keys(a).length === 1, u = [
    ...c(s) ? s.allOf : [s],
    ...c(i) ? i.allOf : [i]
  ];
  t.allOf = u;
}, xt = (e, n, t, r) => {
  const o = e._zod.def, s = z(o.innerType, n, r), i = n.seen.get(e);
  n.target === "openapi-3.0" ? (i.ref = o.innerType, t.nullable = !0) : t.anyOf = [s, { type: "null" }];
}, Jt = (e, n, t, r) => {
  const o = e._zod.def;
  z(o.innerType, n, r);
  const s = n.seen.get(e);
  s.ref = o.innerType;
}, Ft = (e, n, t, r) => {
  const o = e._zod.def;
  z(o.innerType, n, r);
  const s = n.seen.get(e);
  s.ref = o.innerType, t.default = JSON.parse(JSON.stringify(o.defaultValue));
}, Vt = (e, n, t, r) => {
  const o = e._zod.def;
  z(o.innerType, n, r);
  const s = n.seen.get(e);
  s.ref = o.innerType, n.io === "input" && (t._prefault = JSON.parse(JSON.stringify(o.defaultValue)));
}, Dt = (e, n, t, r) => {
  const o = e._zod.def;
  z(o.innerType, n, r);
  const s = n.seen.get(e);
  s.ref = o.innerType;
  let i;
  try {
    i = o.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  t.default = i;
}, Ut = (e, n, t, r) => {
  const o = e._zod.def, s = n.io === "input" ? o.in._zod.def.type === "transform" ? o.out : o.in : o.out;
  z(s, n, r);
  const i = n.seen.get(e);
  i.ref = s;
}, Lt = (e, n, t, r) => {
  const o = e._zod.def;
  z(o.innerType, n, r);
  const s = n.seen.get(e);
  s.ref = o.innerType, t.readOnly = !0;
}, Gt = (e, n, t, r) => {
  const o = e._zod.def;
  z(o.innerType, n, r);
  const s = n.seen.get(e);
  s.ref = o.innerType;
}, Kt = (e, n) => {
  De.init(e, n), e.name = "ZodError", Object.defineProperties(e, {
    format: {
      value: (t) => En(e, t)
      // enumerable: false,
    },
    flatten: {
      value: (t) => Sn(e, t)
      // enumerable: false,
    },
    addIssue: {
      value: (t) => {
        e.issues.push(t), e.message = JSON.stringify(e.issues, ee, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (t) => {
        e.issues.push(...t), e.message = JSON.stringify(e.issues, ee, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return e.issues.length === 0;
      }
      // enumerable: false,
    }
  });
}, k = f("ZodError", Kt, {
  Parent: Error
}), Bt = /* @__PURE__ */ ue(k), Wt = /* @__PURE__ */ ce(k), Yt = /* @__PURE__ */ Y(k), qt = /* @__PURE__ */ q(k), Xt = /* @__PURE__ */ Zn(k), Ht = /* @__PURE__ */ jn(k), Qt = /* @__PURE__ */ In(k), er = /* @__PURE__ */ Rn(k), nr = /* @__PURE__ */ An(k), tr = /* @__PURE__ */ Mn(k), rr = /* @__PURE__ */ Cn(k), or = /* @__PURE__ */ xn(k), y = /* @__PURE__ */ f("ZodType", (e, n) => (v.init(e, n), Object.assign(e["~standard"], {
  jsonSchema: {
    input: K(e, "input"),
    output: K(e, "output")
  }
}), e.toJSONSchema = St(e, {}), e.def = n, e.type = n.type, Object.defineProperty(e, "_def", { value: n }), e.check = (...t) => e.clone(I(n, {
  checks: [
    ...n.checks ?? [],
    ...t.map((r) => typeof r == "function" ? { _zod: { check: r, def: { check: "custom" }, onattach: [] } } : r)
  ]
})), e.clone = (t, r) => E(e, t, r), e.brand = () => e, e.register = (t, r) => (t.add(e, r), e), e.parse = (t, r) => Bt(e, t, r, { callee: e.parse }), e.safeParse = (t, r) => Yt(e, t, r), e.parseAsync = async (t, r) => Wt(e, t, r, { callee: e.parseAsync }), e.safeParseAsync = async (t, r) => qt(e, t, r), e.spa = e.safeParseAsync, e.encode = (t, r) => Xt(e, t, r), e.decode = (t, r) => Ht(e, t, r), e.encodeAsync = async (t, r) => Qt(e, t, r), e.decodeAsync = async (t, r) => er(e, t, r), e.safeEncode = (t, r) => nr(e, t, r), e.safeDecode = (t, r) => tr(e, t, r), e.safeEncodeAsync = async (t, r) => rr(e, t, r), e.safeDecodeAsync = async (t, r) => or(e, t, r), e.refine = (t, r) => e.check(jr(t, r)), e.superRefine = (t) => e.check(Ir(t)), e.overwrite = (t) => e.check(wt(t)), e.optional = () => Se(e), e.nullable = () => Ee(e), e.nullish = () => Se(Ee(e)), e.nonoptional = (t) => $r(e, t), e.array = () => lr(e), e.or = (t) => pr([e, t]), e.and = (t) => _r(e, t), e.transform = (t) => Ne(e, yr(t)), e.default = (t) => wr(e, t), e.prefault = (t) => Or(e, t), e.catch = (t) => Sr(e, t), e.pipe = (t) => Ne(e, t), e.readonly = () => Tr(e), e.describe = (t) => {
  const r = e.clone();
  return x.add(r, { description: t }), r;
}, Object.defineProperty(e, "description", {
  get() {
    var t;
    return (t = x.get(e)) == null ? void 0 : t.description;
  },
  configurable: !0
}), e.meta = (...t) => {
  if (t.length === 0)
    return x.get(e);
  const r = e.clone();
  return x.add(r, t[0]), r;
}, e.isOptional = () => e.safeParse(void 0).success, e.isNullable = () => e.safeParse(null).success, e)), Qe = /* @__PURE__ */ f("ZodNumber", (e, n) => {
  Be.init(e, n), y.init(e, n), e._zod.processJSONSchema = (r, o, s) => Et(e, r, o), e.gt = (r, o) => e.check(be(r, o)), e.gte = (r, o) => e.check(Q(r, o)), e.min = (r, o) => e.check(Q(r, o)), e.lt = (r, o) => e.check(ze(r, o)), e.lte = (r, o) => e.check(H(r, o)), e.max = (r, o) => e.check(H(r, o)), e.int = (r) => e.check($e(r)), e.safe = (r) => e.check($e(r)), e.positive = (r) => e.check(be(0, r)), e.nonnegative = (r) => e.check(Q(0, r)), e.negative = (r) => e.check(ze(0, r)), e.nonpositive = (r) => e.check(H(0, r)), e.multipleOf = (r, o) => e.check(we(r, o)), e.step = (r, o) => e.check(we(r, o)), e.finite = () => e;
  const t = e._zod.bag;
  e.minValue = Math.max(t.minimum ?? Number.NEGATIVE_INFINITY, t.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null, e.maxValue = Math.min(t.maximum ?? Number.POSITIVE_INFINITY, t.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null, e.isInt = (t.format ?? "").includes("int") || Number.isSafeInteger(t.multipleOf ?? 0.5), e.isFinite = !0, e.format = t.format ?? null;
});
function Oe(e) {
  return _t(Qe, e);
}
const sr = /* @__PURE__ */ f("ZodNumberFormat", (e, n) => {
  Yn.init(e, n), Qe.init(e, n);
});
function $e(e) {
  return gt(sr, e);
}
const ir = /* @__PURE__ */ f("ZodUnknown", (e, n) => {
  qn.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Tt();
});
function Pe() {
  return vt(ir);
}
const ur = /* @__PURE__ */ f("ZodNever", (e, n) => {
  Xn.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Nt(e, t, r);
});
function cr(e) {
  return yt(ur, e);
}
const ar = /* @__PURE__ */ f("ZodArray", (e, n) => {
  Hn.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Rt(e, t, r, o), e.element = n.element, e.min = (t, r) => e.check(ke(t, r)), e.nonempty = (t) => e.check(ke(1, t)), e.max = (t, r) => e.check(zt(t, r)), e.length = (t, r) => e.check(bt(t, r)), e.unwrap = () => e.element;
});
function lr(e, n) {
  return kt(ar, e, n);
}
const fr = /* @__PURE__ */ f("ZodObject", (e, n) => {
  et.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => At(e, t, r, o), m(e, "shape", () => n.shape), e.keyof = () => gr(Object.keys(e._zod.def.shape)), e.catchall = (t) => e.clone({ ...e._zod.def, catchall: t }), e.passthrough = () => e.clone({ ...e._zod.def, catchall: Pe() }), e.loose = () => e.clone({ ...e._zod.def, catchall: Pe() }), e.strict = () => e.clone({ ...e._zod.def, catchall: cr() }), e.strip = () => e.clone({ ...e._zod.def, catchall: void 0 }), e.extend = (t) => wn(e, t), e.safeExtend = (t) => kn(e, t), e.merge = (t) => On(e, t), e.pick = (t) => zn(e, t), e.omit = (t) => bn(e, t), e.partial = (...t) => $n(en, e, t[0]), e.required = (...t) => Pn(nn, e, t[0]);
});
function dr(e, n) {
  const t = {
    type: "object",
    shape: e ?? {},
    ...g(n)
  };
  return new fr(t);
}
const hr = /* @__PURE__ */ f("ZodUnion", (e, n) => {
  nt.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Mt(e, t, r, o), e.options = n.options;
});
function pr(e, n) {
  return new hr({
    type: "union",
    options: e,
    ...g(n)
  });
}
const mr = /* @__PURE__ */ f("ZodIntersection", (e, n) => {
  tt.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Ct(e, t, r, o);
});
function _r(e, n) {
  return new mr({
    type: "intersection",
    left: e,
    right: n
  });
}
const te = /* @__PURE__ */ f("ZodEnum", (e, n) => {
  rt.init(e, n), y.init(e, n), e._zod.processJSONSchema = (r, o, s) => Zt(e, r, o), e.enum = n.entries, e.options = Object.values(n.entries);
  const t = new Set(Object.keys(n.entries));
  e.extract = (r, o) => {
    const s = {};
    for (const i of r)
      if (t.has(i))
        s[i] = n.entries[i];
      else
        throw new Error(`Key ${i} not found in enum`);
    return new te({
      ...n,
      checks: [],
      ...g(o),
      entries: s
    });
  }, e.exclude = (r, o) => {
    const s = { ...n.entries };
    for (const i of r)
      if (t.has(i))
        delete s[i];
      else
        throw new Error(`Key ${i} not found in enum`);
    return new te({
      ...n,
      checks: [],
      ...g(o),
      entries: s
    });
  };
});
function gr(e, n) {
  const t = Array.isArray(e) ? Object.fromEntries(e.map((r) => [r, r])) : e;
  return new te({
    type: "enum",
    entries: t,
    ...g(n)
  });
}
const vr = /* @__PURE__ */ f("ZodTransform", (e, n) => {
  ot.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => It(e, t), e._zod.parse = (t, r) => {
    if (r.direction === "backward")
      throw new Ae(e.constructor.name);
    t.addIssue = (s) => {
      if (typeof s == "string")
        t.issues.push(F(s, t.value, n));
      else {
        const i = s;
        i.fatal && (i.continue = !1), i.code ?? (i.code = "custom"), i.input ?? (i.input = t.value), i.inst ?? (i.inst = e), t.issues.push(F(i));
      }
    };
    const o = n.transform(t.value, t);
    return o instanceof Promise ? o.then((s) => (t.value = s, t)) : (t.value = o, t);
  };
});
function yr(e) {
  return new vr({
    type: "transform",
    transform: e
  });
}
const en = /* @__PURE__ */ f("ZodOptional", (e, n) => {
  st.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Gt(e, t, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Se(e) {
  return new en({
    type: "optional",
    innerType: e
  });
}
const zr = /* @__PURE__ */ f("ZodNullable", (e, n) => {
  it.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => xt(e, t, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Ee(e) {
  return new zr({
    type: "nullable",
    innerType: e
  });
}
const br = /* @__PURE__ */ f("ZodDefault", (e, n) => {
  ut.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Ft(e, t, r, o), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function wr(e, n) {
  return new br({
    type: "default",
    innerType: e,
    get defaultValue() {
      return typeof n == "function" ? n() : Je(n);
    }
  });
}
const kr = /* @__PURE__ */ f("ZodPrefault", (e, n) => {
  ct.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Vt(e, t, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Or(e, n) {
  return new kr({
    type: "prefault",
    innerType: e,
    get defaultValue() {
      return typeof n == "function" ? n() : Je(n);
    }
  });
}
const nn = /* @__PURE__ */ f("ZodNonOptional", (e, n) => {
  at.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Jt(e, t, r, o), e.unwrap = () => e._zod.def.innerType;
});
function $r(e, n) {
  return new nn({
    type: "nonoptional",
    innerType: e,
    ...g(n)
  });
}
const Pr = /* @__PURE__ */ f("ZodCatch", (e, n) => {
  lt.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Dt(e, t, r, o), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function Sr(e, n) {
  return new Pr({
    type: "catch",
    innerType: e,
    catchValue: typeof n == "function" ? n : () => n
  });
}
const Er = /* @__PURE__ */ f("ZodPipe", (e, n) => {
  ft.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Ut(e, t, r, o), e.in = n.in, e.out = n.out;
});
function Ne(e, n) {
  return new Er({
    type: "pipe",
    in: e,
    out: n
    // ...util.normalizeParams(params),
  });
}
const Nr = /* @__PURE__ */ f("ZodReadonly", (e, n) => {
  dt.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => Lt(e, t, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Tr(e) {
  return new Nr({
    type: "readonly",
    innerType: e
  });
}
const Zr = /* @__PURE__ */ f("ZodCustom", (e, n) => {
  ht.init(e, n), y.init(e, n), e._zod.processJSONSchema = (t, r, o) => jt(e, t);
});
function jr(e, n = {}) {
  return Ot(Zr, e, n);
}
function Ir(e) {
  return $t(e);
}
dr({
  /** Number of items per page (1-100) */
  limit: Oe().min(1).max(100).default(10),
  /** Number of items to skip */
  offset: Oe().min(0).default(0)
});
function Te(e, n) {
  const t = `/${e.pluginId}${e.path.startsWith("/") ? e.path : `/${e.path}`}`;
  if (!n || e.params.length === 0)
    return t;
  let r = t;
  for (const [o, s] of Object.entries(n))
    r = r.replace(`:${o}`, s);
  return r;
}
function Wr() {
  return V.useCallback(
    (e, n) => typeof e == "string" ? je.resolveRoute(e, n) : n ? Te(e, n) : Te(e),
    []
  );
}
export {
  Cr as ApiProvider,
  Mr as ApiRegistryBuilder,
  Gr as ExtensionSlot,
  B as createApiRef,
  Lr as createFrontendPlugin,
  Br as createSlot,
  Ur as createSlotExtension,
  Fr as fetchApiRef,
  Jr as loggerApiRef,
  Vr as permissionApiRef,
  je as pluginRegistry,
  Dr as rpcApiRef,
  xr as useApi,
  Wr as usePluginRoute,
  Kr as wrapInSuspense
};

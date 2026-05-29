import type { Filter, FilterRegistry } from "./types";

/**
 * Create an empty filter registry.
 */
export function createFilterRegistry(): FilterRegistry {
  const filters = new Map<string, Filter>();
  return {
    register(name, filter) {
      filters.set(name, filter);
    },
    get(name) {
      return filters.get(name);
    },
    has(name) {
      return filters.has(name);
    },
    list() {
      return [...filters.keys()].toSorted();
    },
  };
}

/**
 * Create a registry pre-loaded with the default filter set.
 *
 * Filters intentionally do NOT throw on null/undefined — they pass it
 * through. Operators can chain `| default("...")` to substitute a value.
 */
export function createDefaultFilterRegistry(): FilterRegistry {
  const registry = createFilterRegistry();
  registry.register("default", filterDefault);
  registry.register("upper", filterUpper);
  registry.register("lower", filterLower);
  registry.register("capitalize", filterCapitalize);
  registry.register("trim", filterTrim);
  registry.register("truncate", filterTruncate);
  registry.register("length", filterLength);
  registry.register("json", filterJson);
  registry.register("iso", filterIso);
  registry.register("date", filterDate);
  registry.register("join", filterJoin);
  registry.register("replace", filterReplace);
  registry.register("not", filterNot);
  return registry;
}

// ─── Built-ins ─────────────────────────────────────────────────────────────

function filterDefault(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

function filterUpper(value: unknown): unknown {
  return typeof value === "string" ? value.toUpperCase() : value;
}

function filterLower(value: unknown): unknown {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function filterCapitalize(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  return value[0]!.toUpperCase() + value.slice(1);
}

function filterTrim(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function filterTruncate(value: unknown, length: unknown): unknown {
  if (typeof value !== "string") return value;
  const n = typeof length === "number" ? length : Number(length);
  if (!Number.isFinite(n) || n <= 0) return value;
  if (value.length <= n) return value;
  return value.slice(0, n) + "…";
}

function filterLength(value: unknown): unknown {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function filterJson(value: unknown): unknown {
  return JSON.stringify(value);
}

function filterIso(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return value;
}

function filterDate(value: unknown, format: unknown): unknown {
  const fmt = typeof format === "string" ? format : "ISO";
  let date: Date | undefined;
  if (value instanceof Date) date = value;
  else if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) date = d;
  }
  if (!date) return value;
  if (fmt === "ISO") return date.toISOString();
  if (fmt === "date") return date.toISOString().slice(0, 10);
  if (fmt === "time") return date.toISOString().slice(11, 19);
  if (fmt === "unix") return Math.floor(date.getTime() / 1000);
  if (fmt === "rfc2822") return date.toUTCString();
  return date.toISOString();
}

function filterJoin(value: unknown, separator: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const sep = typeof separator === "string" ? separator : ", ";
  return value.map(String).join(sep);
}

function filterReplace(value: unknown, search: unknown, replacement: unknown): unknown {
  if (typeof value !== "string") return value;
  if (typeof search !== "string") return value;
  const repl = typeof replacement === "string" ? replacement : "";
  return value.split(search).join(repl);
}

function filterNot(value: unknown): unknown {
  return !isTruthy(value);
}

/**
 * Centralised truthiness rule. Mirrors JavaScript's notion plus: empty
 * string is falsy, empty arrays are falsy, empty plain objects are falsy.
 * Exported so the renderer can share the same rule with filters.
 */
export function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value === false || value === 0) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

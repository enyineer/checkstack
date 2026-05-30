/**
 * Simple TTL cache for resolved Vault secret values. Vault values rotate,
 * so cached entries expire after `ttlMs` (capped) and are re-read. Keyed by
 * the platform secret name. Holds plaintext values in MEMORY ONLY — never
 * persisted, never logged.
 *
 * Injectable `now` for deterministic tests.
 */
export interface ValueCache {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): void;
  clear(): void;
}

export function createValueCache({
  ttlMs,
  now = () => Date.now(),
}: {
  ttlMs: number;
  now?: () => number;
}): ValueCache {
  const entries = new Map<string, { value: string; expiresAtMs: number }>();
  return {
    get(name) {
      const entry = entries.get(name);
      if (!entry) return;
      if (now() >= entry.expiresAtMs) {
        entries.delete(name);
        return;
      }
      return entry.value;
    },
    set(name, value) {
      entries.set(name, { value, expiresAtMs: now() + ttlMs });
    },
    delete(name) {
      entries.delete(name);
    },
    clear() {
      entries.clear();
    },
  };
}

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "checkstack.tips.dismissed";

const readStorage = (): Set<string> => {
  if (globalThis.window === undefined) return new Set();
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
};

const writeStorage = (ids: Set<string>) => {
  if (globalThis.window === undefined) return;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage may be unavailable (private mode, quota); the in-memory copy
    // still keeps the dismissal active for the current page load.
  }
};

/**
 * Local-only dismissal store for anonymous (logged-out) users and as a
 * synchronous fallback while the server query is loading.
 *
 * Synchronizes across tabs of the same browser via the `storage` event so
 * dismissing a tip in one tab hides it in another.
 */
export const useLocalDismissals = () => {
  const [ids, setIds] = useState<Set<string>>(() => readStorage());

  useEffect(() => {
    if (globalThis.window === undefined) return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setIds(readStorage());
    };

    globalThis.addEventListener("storage", onStorage);
    return () => globalThis.removeEventListener("storage", onStorage);
  }, []);

  const dismiss = useCallback((tipId: string) => {
    setIds((prev) => {
      if (prev.has(tipId)) return prev;
      const next = new Set(prev);
      next.add(tipId);
      writeStorage(next);
      return next;
    });
  }, []);

  const reset = useCallback((tipIds?: string[]) => {
    setIds((prev) => {
      if (!tipIds || tipIds.length === 0) {
        writeStorage(new Set());
        return new Set();
      }
      const next = new Set(prev);
      for (const id of tipIds) next.delete(id);
      writeStorage(next);
      return next;
    });
  }, []);

  return { ids, dismiss, reset };
};

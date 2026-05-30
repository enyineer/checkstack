import { useState } from "react";

/**
 * Pure decision function powering {@link useInitOnceForKey}. Extracted so
 * it can be unit-tested without a DOM (the hook itself wraps this with
 * a `useRef` + `useEffect`).
 *
 * Returns `true` iff the caller should run their initialiser:
 *
 *  - `value` is defined (the query has finished loading), AND
 *  - `key` is defined (we have a discriminator to track init-per-record),
 *    AND
 *  - we haven't yet initialised for this key (i.e. `initialisedKey !== key`).
 *
 * Background refetches of the same record produce a new `value` reference
 * but the same `key`, so the function returns `false` for them — that's
 * the whole point.
 */
export function shouldInitForKey({
  value,
  key,
  initialisedKey,
}: {
  value: unknown;
  key: string | number | null | undefined;
  initialisedKey: string | number | null | undefined;
}): boolean {
  if (value === undefined || value === null) return false;
  if (key === undefined || key === null) return false;
  return initialisedKey !== key;
}

/**
 * Run a one-shot initialiser exactly once per `key`, ignoring subsequent
 * `value` changes that keep the same key.
 *
 * Built for forms that need to seed local state from a react-query result
 * but **must not** reset that state when the query refetches in the
 * background. The canonical use case is the healthcheck editor: a realtime
 * `HEALTH_CHECK_RUN_COMPLETED` signal invalidates the configuration query
 * on every run, which would otherwise wipe the user's in-progress edits
 * via a naive `useEffect([data], () => setState(data))`.
 *
 * Behaviour:
 *  - Calls `onInit(value)` the first time `value` is defined for a given
 *    `key`.
 *  - **Does NOT** call it again if `value` changes but `key` stays the
 *    same. Background refetches keep the same key (= the same record's
 *    primary id) and therefore don't re-run the initialiser.
 *  - **Does** call it again when `key` changes — e.g. when the user
 *    navigates to a different record without unmounting the page.
 *  - Skips initialisation entirely while either `value` or `key` is
 *    `undefined`/`null`.
 *
 * Seeding runs **during render** (not in a `useEffect`). This is deliberate:
 * the app is wrapped in `<StrictMode>`, which double-mounts components and
 * **discards a `setState` scheduled from an effect** when the source query
 * resolves synchronously — e.g. a warm react-query cache on reopen. That made
 * the one-shot init silently no-op, reverting seeded form state (a renamed id
 * snapping back to its default, etc.) while a cold-cache first open worked.
 * Seeding during render with a state guard is React's recommended
 * "adjust state when data changes" pattern and is immune to that race. `onInit`
 * must therefore be pure aside from calling this component's state setters.
 *
 * @example
 *   useInitOnceForKey(existingConfig, existingConfig?.id, (config) => {
 *     setFormState({
 *       name: config.name,
 *       collectors: config.collectors ?? [],
 *     });
 *   });
 */
export function useInitOnceForKey<T>(
  value: T | undefined | null,
  key: string | number | null | undefined,
  onInit: (value: T) => void,
): void {
  const [initialisedKey, setInitialisedKey] =
    useState<string | number | null | undefined>();

  if (shouldInitForKey({ value, key, initialisedKey })) {
    // Setting state + invoking `onInit` (which sets this component's state)
    // during render is the supported "store info from previous renders"
    // pattern: React restarts this component's render with the new state
    // before committing, and the `initialisedKey` guard makes it idempotent
    // (no loop; background refetches of the same key are ignored).
    setInitialisedKey(key);
    onInit(value as T);
  }
}

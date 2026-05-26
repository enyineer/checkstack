import { useEffect, useRef } from "react";

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
 * `onInit` is read from a ref so callers can safely pass a fresh closure
 * each render without re-firing the effect.
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
  const initialisedKeyRef = useRef<string | number | null | undefined>(undefined);
  const onInitRef = useRef(onInit);

  // Keep the latest callback in a ref so a fresh closure each render doesn't
  // re-trigger the effect; only `value` and `key` should drive it.
  useEffect(() => {
    onInitRef.current = onInit;
  });

  useEffect(() => {
    if (!shouldInitForKey({ value, key, initialisedKey: initialisedKeyRef.current })) {
      return;
    }
    initialisedKeyRef.current = key;
    onInitRef.current(value as T);
  }, [value, key]);
}

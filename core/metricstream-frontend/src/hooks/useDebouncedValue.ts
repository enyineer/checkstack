import React from "react";

/**
 * Return `value` debounced by `delayMs`: the returned value only updates after
 * `value` has stopped changing for `delayMs`. Used to throttle the metric-name
 * search so a fast typist doesn't re-query on every keystroke.
 *
 * Copied (not imported) from logstream-frontend per the code-style guide - there
 * is no shared `useDebounce` in `@checkstack/ui` yet.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

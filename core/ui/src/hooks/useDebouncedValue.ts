import React from "react";

/**
 * Return `value` debounced by `delayMs`: the result only updates once `value`
 * has stopped changing for `delayMs`.
 *
 * The canonical use is a live search box over a large list - the input stays
 * responsive on the raw value while the expensive filter runs on the debounced
 * one, so a fast typist does not re-filter on every keystroke. It is equally the
 * right tool before a server-side query input.
 *
 * This lives in `@checkstack/ui` because it had been copied verbatim into six
 * plugin packages, each carrying a comment noting that no shared version
 * existed.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

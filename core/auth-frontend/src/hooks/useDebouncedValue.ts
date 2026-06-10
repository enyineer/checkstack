import React from "react";

/**
 * Return `value` debounced by `delayMs`: the returned value only updates after
 * `value` has stopped changing for `delayMs`. Used to throttle the live
 * user-directory search so a fast typist doesn't fan out a request per
 * keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

import { useRef } from "react";

/**
 * Pure selection of the data to display while a refetch is in flight.
 *
 * Returns the previous non-empty data (marked stale) while `isFetching` and the
 * incoming data is empty, otherwise the current data. Extracted so the
 * keep-previous decision is unit-testable without React.
 */
export const selectKeptPrevious = <T>({
  data,
  previous,
  isFetching,
}: {
  data: T[];
  previous: T[];
  isFetching: boolean;
}): { data: T[]; isStale: boolean } => {
  if (isFetching && data.length === 0 && previous.length > 0) {
    return { data: previous, isStale: true };
  }
  return { data, isStale: isFetching && previous.length > 0 };
};

export interface UseKeptPreviousResult<T> {
  /** Rows to render: previous rows while refetching, otherwise the latest. */
  data: T[];
  /**
   * True while a refetch is in flight and previous rows are being shown. Use it
   * to dim the table (e.g. `opacity-50`) so the refresh is visible without a
   * layout jump.
   */
  isStale: boolean;
}

/**
 * Keep the previously-rendered list while a refetch is in flight to avoid a
 * layout jump, and report whether the shown rows are stale so the consumer can
 * dim them.
 *
 * Generalises the keep-previous pattern in the healthcheck runs table: hold the
 * last non-empty `data` whenever `isFetching` produces a transient empty list,
 * and surface `isStale` for the dimming treatment.
 */
export function useKeptPrevious<T>({
  data,
  isFetching,
}: {
  data: T[];
  isFetching: boolean;
}): UseKeptPreviousResult<T> {
  const previousRef = useRef<T[]>(data);

  const result = selectKeptPrevious({
    data,
    previous: previousRef.current,
    isFetching,
  });

  // Remember the latest settled non-empty data as the value to keep next time.
  if (!isFetching && data.length > 0) {
    previousRef.current = data;
  }

  return result;
}

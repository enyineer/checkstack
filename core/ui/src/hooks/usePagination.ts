import { useState, useCallback, useMemo, useEffect } from "react";

/**
 * Pagination state and controls.
 * Used with TanStack Query's useQuery hook for paginated data.
 */
export interface PaginationState {
  /** Current page (1-indexed) */
  page: number;
  /** Items per page */
  limit: number;
  /** Offset for query (calculated from page and limit) */
  offset: number;
  /** Total number of items (set via setTotal) */
  total: number;
  /** Total number of pages */
  totalPages: number;
  /** Whether there is a next page */
  hasNext: boolean;
  /** Whether there is a previous page */
  hasPrev: boolean;
  /** Go to a specific page (1-indexed) */
  setPage: (page: number) => void;
  /** Change items per page (resets to page 1) */
  setLimit: (limit: number) => void;
  /** Update total count from query response */
  setTotal: (total: number) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
}

/**
 * Options for usePagination hook.
 */
export interface UsePaginationOptions {
  /**
   * Initial page number (1-indexed)
   * @default 1
   */
  defaultPage?: number;

  /**
   * Items per page
   * @default 10
   */
  defaultLimit?: number;
}

/**
 * Hook for managing pagination state to use with TanStack Query.
 *
 * This hook manages page/limit state and provides computed offset for queries.
 * Use with useQuery to build paginated data fetching.
 *
 * @example
 * ```tsx
 * // Simple usage with usePluginClient
 * const pagination = usePagination({ defaultLimit: 20 });
 *
 * const { data, isLoading } = notificationClient.getNotifications.useQuery({
 *   limit: pagination.limit,
 *   offset: pagination.offset,
 *   unreadOnly: true,
 * });
 *
 * // Update total when data changes
 * useEffect(() => {
 *   if (data) pagination.setTotal(data.total);
 * }, [data, pagination]);
 *
 * return (
 *   <>
 *     {data?.notifications.map(n => <Notification key={n.id} {...n} />)}
 *     <Pagination {...pagination} loading={isLoading} />
 *   </>
 * );
 * ```
 */
export function usePagination({
  defaultPage = 1,
  defaultLimit = 10,
}: UsePaginationOptions = {}): PaginationState {
  const [page, setPageState] = useState(defaultPage);
  const [limit, setLimitState] = useState(defaultLimit);
  const [total, setTotalState] = useState(0);

  const offset = useMemo(() => (page - 1) * limit, [page, limit]);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / limit)),
    [total, limit]
  );
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  const setPage = useCallback((newPage: number) => {
    setPageState(Math.max(1, newPage));
  }, []);

  const setLimit = useCallback((newLimit: number) => {
    setLimitState(newLimit);
    setPageState(1); // Reset to first page when limit changes
  }, []);

  const setTotal = useCallback((newTotal: number) => {
    setTotalState(newTotal);
  }, []);

  const nextPage = useCallback(() => {
    if (hasNext) {
      setPageState((p) => p + 1);
    }
  }, [hasNext]);

  const prevPage = useCallback(() => {
    if (hasPrev) {
      setPageState((p) => p - 1);
    }
  }, [hasPrev]);

  return {
    page,
    limit,
    offset,
    total,
    totalPages,
    hasNext,
    hasPrev,
    setPage,
    setLimit,
    setTotal,
    nextPage,
    prevPage,
  };
}

/**
 * Helper hook to sync query total with pagination state.
 * Use this to automatically update pagination.total when query data changes.
 *
 * @example
 * ```tsx
 * const pagination = usePagination({ defaultLimit: 20 });
 *
 * const { data, isLoading } = notificationClient.getNotifications.useQuery({
 *   limit: pagination.limit,
 *   offset: pagination.offset,
 * });
 *
 * // Auto-sync total from response
 * usePaginationSync(pagination, data?.total);
 * ```
 */
export function usePaginationSync(
  pagination: PaginationState,
  total: number | undefined
): void {
  useEffect(() => {
    if (total !== undefined) {
      pagination.setTotal(total);
    }
  }, [total, pagination]);
}

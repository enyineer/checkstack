import { useState, useEffect, useCallback, useMemo, useRef } from "react";

/**
 * Pagination parameters passed to the fetch function
 */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Options for usePagination hook
 */
export interface UsePaginationOptions<TResponse, TItem, TExtraParams = object> {
  /**
   * Fetch function that receives pagination + extra params and returns response
   */
  fetchFn: (params: PaginationParams & TExtraParams) => Promise<TResponse>;

  /**
   * Extract items array from the response
   */
  getItems: (response: TResponse) => TItem[];

  /**
   * Extract total count from the response
   */
  getTotal: (response: TResponse) => number;

  /**
   * Extra parameters to pass to fetchFn (merged with pagination params)
   * Changes to this object will trigger a refetch
   */
  extraParams?: TExtraParams;

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

  /**
   * Whether to fetch on mount
   * @default true
   */
  fetchOnMount?: boolean;
}

/**
 * Pagination state returned by usePagination hook
 */
export interface PaginationState {
  /** Current page (1-indexed) */
  page: number;
  /** Items per page */
  limit: number;
  /** Total number of items */
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
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Refresh current page */
  refetch: () => void;
}

/**
 * Return value of usePagination hook
 */
export interface UsePaginationResult<TItem> {
  /** Current page items */
  items: TItem[];
  /** Loading state */
  loading: boolean;
  /** Error if fetch failed */
  error: Error | undefined;
  /** Pagination controls and state */
  pagination: PaginationState;
}

/**
 * Hook for managing paginated data fetching with automatic state management.
 *
 * @example
 * ```tsx
 * const { items, loading, pagination } = usePagination({
 *   fetchFn: (p) => client.getNotifications(p),
 *   getItems: (r) => r.notifications,
 *   getTotal: (r) => r.total,
 *   extraParams: { unreadOnly: true },
 * });
 *
 * return (
 *   <>
 *     {items.map(item => <Card key={item.id} {...item} />)}
 *     <Pagination {...pagination} />
 *   </>
 * );
 * ```
 */
export function usePagination<TResponse, TItem, TExtraParams = object>({
  fetchFn,
  getItems,
  getTotal,
  extraParams,
  defaultPage = 1,
  defaultLimit = 10,
  fetchOnMount = true,
}: UsePaginationOptions<
  TResponse,
  TItem,
  TExtraParams
>): UsePaginationResult<TItem> {
  const [items, setItems] = useState<TItem[]>([]);
  const [loading, setLoading] = useState(fetchOnMount);
  const [error, setError] = useState<Error>();
  const [page, setPageState] = useState(defaultPage);
  const [limit, setLimitState] = useState(defaultLimit);
  const [total, setTotal] = useState(0);

  // Use refs for callback functions to avoid re-creating fetchData when they change
  // This is better DX - callers don't need to memoize their functions
  const fetchFnRef = useRef(fetchFn);
  const getItemsRef = useRef(getItems);
  const getTotalRef = useRef(getTotal);
  const extraParamsRef = useRef(extraParams);

  // Update refs when functions change
  fetchFnRef.current = fetchFn;
  getItemsRef.current = getItems;
  getTotalRef.current = getTotal;
  extraParamsRef.current = extraParams;

  // Memoize extraParams to detect changes
  const extraParamsKey = useMemo(
    () => JSON.stringify(extraParams ?? {}),
    [extraParams]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const offset = (page - 1) * limit;
      const params = {
        limit,
        offset,
        ...extraParamsRef.current,
      } as PaginationParams & TExtraParams;

      const response = await fetchFnRef.current(params);
      setItems(getItemsRef.current(response));
      setTotal(getTotalRef.current(response));
    } catch (error_) {
      setError(error_ instanceof Error ? error_ : new Error(String(error_)));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, extraParamsKey]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    if (fetchOnMount || page !== defaultPage || limit !== defaultLimit) {
      void fetchData();
    }
  }, [fetchData, fetchOnMount, page, limit, defaultPage, defaultLimit]);

  // Reset to page 1 when extraParams change
  useEffect(() => {
    setPageState(1);
  }, [extraParamsKey]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  const setPage = useCallback((newPage: number) => {
    setPageState(Math.max(1, newPage));
  }, []);

  const setLimit = useCallback((newLimit: number) => {
    setLimitState(newLimit);
    setPageState(1); // Reset to first page when limit changes
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

  const pagination: PaginationState = {
    page,
    limit,
    total,
    totalPages,
    hasNext,
    hasPrev,
    setPage,
    setLimit,
    nextPage,
    prevPage,
    refetch: fetchData,
  };

  return { items, loading, error, pagination };
}

import * as React from "react";
import { type PaginationState } from "../hooks/usePagination";
import { Pagination } from "./Pagination";
import { cn } from "../utils";

export interface PaginatedListProps<TItem> {
  /**
   * Items to display
   */
  items: TItem[];

  /**
   * Loading state
   */
  loading: boolean;

  /**
   * Pagination state from usePagination hook
   */
  pagination: PaginationState;

  /**
   * Render function for the items
   */
  children: (
    items: TItem[],
    loading: boolean,
    pagination: PaginationState
  ) => React.ReactNode;

  /**
   * Show loading spinner
   * @default true
   */
  showLoadingSpinner?: boolean;

  /**
   * Content to show when no items
   */
  emptyContent?: React.ReactNode;

  /**
   * Show pagination controls
   * @default true
   */
  showPagination?: boolean;

  /**
   * Show page size selector
   * @default true
   */
  showPageSize?: boolean;

  /**
   * Show total items count
   * @default true
   */
  showTotal?: boolean;

  /**
   * Available page sizes
   */
  pageSizes?: number[];

  /**
   * Container class name
   */
  className?: string;

  /**
   * Pagination container class name
   */
  paginationClassName?: string;
}

/**
 * Paginated list component for rendering paginated data.
 * Use with usePagination() hook and TanStack Query.
 *
 * @example
 * ```tsx
 * const pagination = usePagination({ defaultLimit: 20 });
 * const { data, isLoading } = notificationClient.getNotifications.useQuery({
 *   limit: pagination.limit,
 *   offset: pagination.offset,
 * });
 * usePaginationSync(pagination, data?.total);
 *
 * <PaginatedList
 *   items={data?.notifications ?? []}
 *   loading={isLoading}
 *   pagination={pagination}
 * >
 *   {(items) => items.map((item) => <Card key={item.id} {...item} />)}
 * </PaginatedList>
 * ```
 */
export function PaginatedList<TItem>({
  items,
  loading,
  pagination,
  children,
  showLoadingSpinner = true,
  emptyContent,
  showPagination = true,
  showPageSize = true,
  showTotal = true,
  pageSizes,
  className,
  paginationClassName,
}: PaginatedListProps<TItem>) {
  const showEmpty = !loading && items.length === 0 && emptyContent;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Loading state */}
      {loading && showLoadingSpinner && (
        <div className="flex justify-center py-8 text-muted-foreground">
          Loading...
        </div>
      )}

      {/* Empty state */}
      {showEmpty && (
        <div className="flex justify-center py-8 text-muted-foreground">
          {emptyContent}
        </div>
      )}

      {/* Content */}
      {!showEmpty && children(items, loading, pagination)}

      {/* Pagination controls */}
      {showPagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={pagination.setPage}
          limit={pagination.limit}
          onPageSizeChange={pagination.setLimit}
          total={showTotal ? pagination.total : undefined}
          showPageSize={showPageSize}
          showTotal={showTotal}
          pageSizes={pageSizes}
          className={paginationClassName}
        />
      )}
    </div>
  );
}

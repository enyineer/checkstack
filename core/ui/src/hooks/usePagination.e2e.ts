import { describe, expect, it } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { usePagination, usePaginationSync } from "./usePagination";

describe("usePagination", () => {
  describe("initial state", () => {
    it("should return default initial state", () => {
      const { result } = renderHook(() => usePagination());

      expect(result.current.page).toBe(1);
      expect(result.current.limit).toBe(10);
      expect(result.current.offset).toBe(0);
      expect(result.current.total).toBe(0);
      expect(result.current.totalPages).toBe(1);
      expect(result.current.hasNext).toBe(false);
      expect(result.current.hasPrev).toBe(false);
    });

    it("should accept custom default values", () => {
      const { result } = renderHook(() =>
        usePagination({ defaultPage: 2, defaultLimit: 25 })
      );

      expect(result.current.page).toBe(2);
      expect(result.current.limit).toBe(25);
      expect(result.current.offset).toBe(25); // (2-1) * 25
    });
  });

  describe("setPage", () => {
    it("should update page and recalculate offset", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 10 }));

      act(() => {
        result.current.setPage(3);
      });

      expect(result.current.page).toBe(3);
      expect(result.current.offset).toBe(20); // (3-1) * 10
    });

    it("should not allow page below 1", () => {
      const { result } = renderHook(() => usePagination());

      act(() => {
        result.current.setPage(0);
      });

      expect(result.current.page).toBe(1);

      act(() => {
        result.current.setPage(-5);
      });

      expect(result.current.page).toBe(1);
    });
  });

  describe("setLimit", () => {
    it("should update limit and reset page to 1", () => {
      const { result } = renderHook(() => usePagination());

      // First go to page 3
      act(() => {
        result.current.setPage(3);
      });

      expect(result.current.page).toBe(3);

      // Then change limit - should reset to page 1
      act(() => {
        result.current.setLimit(25);
      });

      expect(result.current.limit).toBe(25);
      expect(result.current.page).toBe(1);
      expect(result.current.offset).toBe(0);
    });
  });

  describe("setTotal", () => {
    it("should update total and recalculate totalPages", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 10 }));

      act(() => {
        result.current.setTotal(45);
      });

      expect(result.current.total).toBe(45);
      expect(result.current.totalPages).toBe(5); // ceil(45/10)
    });

    it("should update hasNext and hasPrev correctly", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 10 }));

      // Set total to have 5 pages
      act(() => {
        result.current.setTotal(50);
      });

      // On page 1, should have next but no prev
      expect(result.current.hasNext).toBe(true);
      expect(result.current.hasPrev).toBe(false);

      // Go to middle page
      act(() => {
        result.current.setPage(3);
      });

      expect(result.current.hasNext).toBe(true);
      expect(result.current.hasPrev).toBe(true);

      // Go to last page
      act(() => {
        result.current.setPage(5);
      });

      expect(result.current.hasNext).toBe(false);
      expect(result.current.hasPrev).toBe(true);
    });
  });

  describe("nextPage", () => {
    it("should increment page when hasNext is true", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 10 }));

      act(() => {
        result.current.setTotal(30);
      });

      expect(result.current.page).toBe(1);
      expect(result.current.hasNext).toBe(true);

      act(() => {
        result.current.nextPage();
      });

      expect(result.current.page).toBe(2);
    });

    it("should not increment page when on last page", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 10 }));

      act(() => {
        result.current.setTotal(10);
      });

      expect(result.current.hasNext).toBe(false);

      act(() => {
        result.current.nextPage();
      });

      expect(result.current.page).toBe(1);
    });
  });

  describe("prevPage", () => {
    it("should decrement page when hasPrev is true", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 10 }));

      act(() => {
        result.current.setTotal(30);
        result.current.setPage(3);
      });

      expect(result.current.hasPrev).toBe(true);

      act(() => {
        result.current.prevPage();
      });

      expect(result.current.page).toBe(2);
    });

    it("should not decrement page when on first page", () => {
      const { result } = renderHook(() => usePagination());

      expect(result.current.hasPrev).toBe(false);

      act(() => {
        result.current.prevPage();
      });

      expect(result.current.page).toBe(1);
    });
  });

  describe("offset calculation", () => {
    it("should calculate correct offset for different page/limit combinations", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 20 }));

      expect(result.current.offset).toBe(0);

      act(() => {
        result.current.setPage(2);
      });

      expect(result.current.offset).toBe(20);

      act(() => {
        result.current.setPage(5);
      });

      expect(result.current.offset).toBe(80);

      act(() => {
        result.current.setLimit(50);
      });

      // Limit change resets to page 1
      expect(result.current.offset).toBe(0);

      act(() => {
        result.current.setPage(3);
      });

      expect(result.current.offset).toBe(100);
    });
  });

  describe("totalPages edge cases", () => {
    it("should have minimum of 1 totalPages even with 0 total", () => {
      const { result } = renderHook(() => usePagination());

      expect(result.current.totalPages).toBe(1);
    });

    it("should round up for partial pages", () => {
      const { result } = renderHook(() => usePagination({ defaultLimit: 10 }));

      act(() => {
        result.current.setTotal(25);
      });

      expect(result.current.totalPages).toBe(3); // 25/10 = 2.5, ceil = 3
    });
  });
});

describe("usePaginationSync", () => {
  it("should sync total from query response", () => {
    const { result, rerender } = renderHook(
      ({ total }: { total?: number }) => {
        const pagination = usePagination();
        usePaginationSync(pagination, total);
        return pagination;
      },
      { initialProps: { total: undefined as number | undefined } }
    );

    expect(result.current.total).toBe(0);

    rerender({ total: 100 });

    expect(result.current.total).toBe(100);
    expect(result.current.totalPages).toBe(10);
  });

  it("should not update when total is undefined", () => {
    const { result, rerender } = renderHook(
      ({ total }: { total?: number }) => {
        const pagination = usePagination();
        usePaginationSync(pagination, total);
        return pagination;
      },
      { initialProps: { total: 50 as number | undefined } }
    );

    expect(result.current.total).toBe(50);

    rerender({ total: undefined });

    // Should keep the old value
    expect(result.current.total).toBe(50);
  });
});

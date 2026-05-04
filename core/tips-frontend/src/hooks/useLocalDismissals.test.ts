import { describe, it, expect, beforeEach } from "bun:test";
import { renderHook, act } from "@checkstack/test-utils-frontend";
import { useLocalDismissals } from "./useLocalDismissals";

const STORAGE_KEY = "checkstack.tips.dismissed";

describe("useLocalDismissals", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts with no dismissals when storage is empty", () => {
    const { result } = renderHook(() => useLocalDismissals());
    expect(result.current.ids.size).toBe(0);
  });

  it("hydrates from localStorage on mount", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["catalog.systems.create"]),
    );

    const { result } = renderHook(() => useLocalDismissals());
    expect(result.current.ids.has("catalog.systems.create")).toBe(true);
  });

  it("ignores corrupted JSON without throwing", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");
    const { result } = renderHook(() => useLocalDismissals());
    expect(result.current.ids.size).toBe(0);
  });

  it("ignores non-array storage values", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 1 }));
    const { result } = renderHook(() => useLocalDismissals());
    expect(result.current.ids.size).toBe(0);
  });

  it("dismiss() persists to localStorage and updates state", () => {
    const { result } = renderHook(() => useLocalDismissals());

    act(() => {
      result.current.dismiss("catalog.systems.create");
    });

    expect(result.current.ids.has("catalog.systems.create")).toBe(true);
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    expect(stored).toContain("catalog.systems.create");
  });

  it("dismiss() is idempotent", () => {
    const { result } = renderHook(() => useLocalDismissals());

    act(() => {
      result.current.dismiss("catalog.systems.create");
      result.current.dismiss("catalog.systems.create");
    });

    expect(result.current.ids.size).toBe(1);
  });

  it("reset() with specific ids only clears those", () => {
    const { result } = renderHook(() => useLocalDismissals());

    act(() => {
      result.current.dismiss("a");
      result.current.dismiss("b");
    });
    act(() => {
      result.current.reset(["a"]);
    });

    expect(result.current.ids.has("a")).toBe(false);
    expect(result.current.ids.has("b")).toBe(true);
  });

  it("reset() with no argument clears everything", () => {
    const { result } = renderHook(() => useLocalDismissals());

    act(() => {
      result.current.dismiss("a");
      result.current.dismiss("b");
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current.ids.size).toBe(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");
  });
});

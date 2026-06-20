import { useCallback, useEffect } from "react";

/** Default copy shown in the discard confirmation prompt. */
export const DEFAULT_DISCARD_MESSAGE =
  "You have unsaved changes. Are you sure you want to leave?";

/**
 * Pure decision for an in-app navigation guard: block a transition only when the
 * form is dirty AND we're actually moving to a different location. Kept as a
 * unit-testable pure helper for a future data-router migration (see the note on
 * {@link useUnsavedChanges} about why `useBlocker` is not used today).
 */
export const shouldBlockNavigation = ({
  isDirty,
  currentPathname,
  nextPathname,
}: {
  isDirty: boolean;
  currentPathname: string;
  nextPathname: string;
}): boolean => isDirty && currentPathname !== nextPathname;

export interface UseUnsavedChangesOptions {
  /** Whether the guarded form currently has unsaved changes. */
  isDirty: boolean;
  /** Message used for both the `beforeunload` and in-app discard prompts. */
  message?: string;
}

export interface UseUnsavedChangesResult {
  /**
   * Whether an in-app navigation is currently blocked awaiting confirmation.
   * Reflects the react-router blocker's `blocked` state.
   */
  isBlocked: boolean;
  /**
   * Confirm discarding changes and proceed with a blocked in-app navigation.
   * No-op when nothing is blocked.
   */
  confirmDiscard: () => void;
  /** Cancel a blocked navigation and stay on the page. No-op when not blocked. */
  cancelDiscard: () => void;
}

/**
 * Guard against losing unsaved form edits.
 *
 * - Installs a `beforeunload` listener while `isDirty` so closing the tab / a
 *   hard reload triggers the browser's native confirm prompt. This works under
 *   any router.
 *
 * In-app navigation interception is intentionally NOT done here: the app mounts
 * a `<BrowserRouter>` (not a data router), and react-router's `useBlocker`
 * throws outside a data router. Editors guard their own close affordance
 * (Cancel / backdrop / Escape) by routing through a confirmation modal in their
 * `onOpenChange`, which covers the common discard case without `useBlocker`.
 * `isBlocked` is therefore always `false` and the discard callbacks are no-ops;
 * the API shape is preserved so callers (and a future data-router migration via
 * {@link shouldBlockNavigation}) need not change.
 */
export function useUnsavedChanges({
  isDirty,
  message = DEFAULT_DISCARD_MESSAGE,
}: UseUnsavedChangesOptions): UseUnsavedChangesResult {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require setting returnValue to trigger the prompt.
      event.returnValue = message;
      return message;
    };
    globalThis.addEventListener("beforeunload", handler);
    return () => {
      globalThis.removeEventListener("beforeunload", handler);
    };
  }, [isDirty, message]);

  const confirmDiscard = useCallback(() => {
    // No in-app blocker to resolve under a non-data router (see doc comment).
  }, []);

  const cancelDiscard = useCallback(() => {
    // No in-app blocker to resolve under a non-data router (see doc comment).
  }, []);

  return {
    isBlocked: false,
    confirmDiscard,
    cancelDiscard,
  };
}

import { useState } from "react";

/**
 * Pure decision function powering {@link useSeedFormOnOpen}. Extracted so it
 * can be unit-tested without a DOM.
 *
 * Returns `true` iff `open` has just transitioned from closed to open, i.e.
 * `open` is `true` but our tracked `wasOpen` is still `false`. That is the one
 * render on which a dialog-hosted form should (re-)seed its local state.
 */
export function shouldSeedOnOpen({
  open,
  wasOpen,
}: {
  open: boolean;
  wasOpen: boolean;
}): boolean {
  return open && !wasOpen;
}

/**
 * Run `onOpen` exactly once each time `open` transitions from `false` to
 * `true`.
 *
 * Built for dialog-hosted forms that seed their local `useState` from props
 * when they open, but **must not** re-seed while they stay open. A dialog
 * editor is typically always mounted - only its `open` prop toggles - and its
 * parent usually rebuilds the seed prop (`initialData={{ ... }}`) as a fresh
 * object literal on every render. So a naive
 * `useEffect(() => { if (open) setState(initialData) }, [open, initialData])`
 * re-fires on **every** parent re-render while the dialog is open (a realtime
 * query invalidation refetching the underlying record, a sibling state change,
 * StrictMode) and wipes the user's in-progress edits. Keying the seed on the
 * record id via {@link useInitOnceForKey} does not fit either: an always-mounted
 * dialog reopened for the *same* record keeps the same key and would never
 * re-seed.
 *
 * `onOpen` runs **during render** on the open transition (React's "adjust
 * state when a prop changes" pattern), not in a `useEffect`. This is
 * deliberate: the app is wrapped in `<StrictMode>`, which can discard a
 * `setState` scheduled from an effect on its double-mount, silently no-opping
 * the seed. Seeding during render with a state guard is immune to that race.
 * `onOpen` must therefore be pure aside from calling this component's state
 * setters, and it reads the current props via closure (no dependency array to
 * keep in sync).
 *
 * @example
 *   useSeedFormOnOpen(open, () => {
 *     setName(initialData?.name ?? "");
 *     setDescription(initialData?.description ?? "");
 *   });
 */
export function useSeedFormOnOpen(open: boolean, onOpen: () => void): void {
  const [wasOpen, setWasOpen] = useState(false);

  if (shouldSeedOnOpen({ open, wasOpen })) {
    // Setting state + invoking `onOpen` (which sets this component's state)
    // during render is the supported "store info from previous renders"
    // pattern: React restarts this component's render with the new state
    // before committing, and the `wasOpen` guard makes it idempotent so the
    // seed runs once per open transition, never on subsequent renders.
    setWasOpen(true);
    onOpen();
  } else if (!open && wasOpen) {
    // Arm the next open transition once the dialog has closed.
    setWasOpen(false);
  }
}

import React, { Suspense, type ComponentType } from "react";

/**
 * Framework-owned wrapper for a lazily-loaded plugin contribution (a route page
 * or a heavy slot extension declared via a `load` thunk).
 *
 * It does three things a plugin should NOT have to reimplement:
 *  1. `React.lazy(load)` — code-splits the contribution so its chunk is fetched
 *     on demand, not in the initial app load.
 *  2. `<Suspense>` — shows a fallback while the chunk loads.
 *  3. `<PluginErrorBoundary>` — contains a load/render failure to this one
 *     contribution. A third-party plugin that throws (bad bundle, runtime
 *     error) degrades to a small inline fallback instead of white-screening the
 *     whole shell. This is essential once external plugins exist.
 *
 * Components are cached by a stable `id` so the same `React.lazy` instance is
 * reused across renders (recreating it would discard its loaded state and
 * remount on every parent render).
 */

interface PluginErrorBoundaryProps {
  /** Human-readable contribution id, used in the console error + fallback. */
  label: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Default fallback for a contribution that throws without a caller-supplied
 * `errorFallback`. Kept framework-agnostic (plain markup + design-token classes)
 * so `frontend-api` doesn't have to depend on `@checkstack/ui`; route pages pass
 * a richer `QueryErrorState`-style card via `errorFallback`. Visible and
 * actionable rather than the previous invisible `null`, so a broken slot
 * extension degrades to a small notice instead of silently vanishing.
 */
function DefaultContributionFallback() {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>This section failed to load.</span>
      <button
        type="button"
        onClick={() => globalThis.location.reload()}
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        Reload
      </button>
    </div>
  );
}

interface PluginErrorBoundaryState {
  hasError: boolean;
}

class PluginErrorBoundary extends React.Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  state: PluginErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PluginErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(
      `❌ Plugin contribution "${this.props.label}" failed to load/render:`,
      error,
    );
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultContributionFallback />;
    }
    return this.props.children;
  }
}

/** Props a plugin contribution component may receive (slot context, or none). */
type ContributionProps = Record<string, unknown>;

type LazyLoader = () => Promise<{ default: ComponentType<ContributionProps> }>;

interface GetLazyContributionArgs {
  /** Stable identity for caching (route path or extension id). */
  id: string;
  load: LazyLoader;
  /** Shown while the chunk loads. Defaults to nothing (invisible). */
  suspenseFallback?: React.ReactNode;
  /**
   * Shown if the chunk fails to load/render. Defaults to a small, visible
   * "this section failed to load" notice with a reload action.
   */
  errorFallback?: React.ReactNode;
}

// Cache keyed by `id` so the lazy component (and its loaded state) is stable
// across renders. Contributions have heterogeneous prop shapes, so the cache is
// typed by the shared `ContributionProps` upper bound.
const lazyComponentCache = new Map<string, ComponentType<ContributionProps>>();

/**
 * Return a stable component that lazily loads `load` and renders it inside a
 * Suspense + error boundary. Safe to call on every render — memoised by `id`.
 */
export function getLazyContribution({
  id,
  load,
  suspenseFallback = null,
  // Left undefined when the caller passes nothing, so `PluginErrorBoundary`
  // falls back to its visible default notice rather than rendering nothing.
  errorFallback,
}: GetLazyContributionArgs): ComponentType<ContributionProps> {
  const cached = lazyComponentCache.get(id);
  if (cached) {
    return cached;
  }

  const Lazy = React.lazy(load);
  const Wrapped: ComponentType<ContributionProps> = (props) => (
    <PluginErrorBoundary label={id} fallback={errorFallback}>
      <Suspense fallback={suspenseFallback}>
        <Lazy {...props} />
      </Suspense>
    </PluginErrorBoundary>
  );
  Wrapped.displayName = `LazyContribution(${id})`;

  lazyComponentCache.set(id, Wrapped);
  return Wrapped;
}

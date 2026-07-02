/**
 * Pure view logic for the instance-namespace banner. Kept separate from the
 * component so it can be unit-tested without a DOM/React render.
 */

export interface InstanceBannerView {
  /** Short label shown in the banner strip. */
  label: string;
  /** Longer explanation surfaced as the strip's `title` (hover tooltip). */
  title: string;
}

/**
 * Decide whether the "preview instance" banner should render, and with what
 * copy, from the runtime `instanceNamespace`.
 *
 * Returns `null` for the default instance (unset / blank namespace) so the shell
 * renders nothing. A non-empty namespace yields the banner view.
 */
export function describeInstanceBanner({
  namespace,
}: {
  namespace: string | undefined | null;
}): InstanceBannerView | null {
  const ns = (namespace ?? "").trim();
  if (ns === "") return null;
  return {
    label: `Preview instance: ${ns}`,
    title:
      `You are viewing the "${ns}" preview instance. It shares external ` +
      `infrastructure (redis, etc.) with the default instance but is isolated ` +
      `by namespace, so it cannot collide with or read the default instance's ` +
      `state.`,
  };
}

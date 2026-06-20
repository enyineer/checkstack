import { z } from "zod";

/**
 * Density mode for the adaptive component tree.
 *
 * - `comfortable` (default): big legible numbers, generous hit targets,
 *   breathing room - the homelab/at-a-glance audience.
 * - `compact`: tighter rhythm, ~30% more rows per screen - the power-user /
 *   wall-display audience.
 *
 * Both modes render from the SAME markup; only the `--d-*` CSS vars change,
 * driven by the `.density-comfortable` / `.density-compact` wrapper class.
 */
export const densitySchema = z.enum(["comfortable", "compact"]);

export type Density = z.infer<typeof densitySchema>;

export const DEFAULT_DENSITY: Density = "comfortable";

/**
 * Maps a density value to the wrapper class that overrides the `--d-*`
 * tokens (declared in `themes.css`).
 */
export const densityClassName = (density: Density): string =>
  density === "compact" ? "density-compact" : "density-comfortable";

/**
 * Resolves a persisted/raw value (e.g. from `localStorage`, which is
 * `string | null`, or an unknown config payload) into a valid {@link Density},
 * falling back to `fallback` when the input is absent or malformed.
 *
 * Pure + total: never throws, so it is safe to call during render/init.
 */
export const resolveDensity = ({
  value,
  fallback = DEFAULT_DENSITY,
}: {
  value: unknown;
  fallback?: Density;
}): Density => {
  const parsed = densitySchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
};

/**
 * Toggles between the two density modes.
 */
export const toggleDensity = (density: Density): Density =>
  density === "comfortable" ? "compact" : "comfortable";

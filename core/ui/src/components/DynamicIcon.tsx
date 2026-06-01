import { lazy, Suspense } from "react";
import { Settings, type LucideIcon } from "lucide-react";
import type { IconName, BrandIconName } from "@checkstack/common";
import { brandIcons } from "./BrandIcon";

// Re-export the icon-name types for convenience.
export type { IconName, LucideIconName } from "@checkstack/common";

/**
 * Props for the DynamicIcon component
 */
export interface DynamicIconProps {
  /**
   * Icon name. Lucide names are PascalCase (e.g. 'CircleAlert', 'HeartPulse');
   * the few brand names lucide v1 dropped ('Github', 'Gitlab') resolve to
   * vendored marks.
   */
  name?: IconName;
  /** CSS class name to apply to the icon */
  className?: string;
  /** Fallback icon if name is not provided */
  fallback?: LucideIcon;
}

// The lucide icon set is loaded lazily through `iconRegistry` (see that file):
// importing lucide's `icons` map eagerly would ship the entire ~1600-icon set
// in the initial bundle. `RegistryIcon` is the only importer of that map, and
// it's behind React.lazy, so the icon set is fetched on demand the first time a
// data-driven icon renders - never in the initial load.
const RegistryIcon = lazy(() => import("./iconRegistry"));

function isBrandIcon(name: string): name is BrandIconName {
  return Object.prototype.hasOwnProperty.call(brandIcons, name);
}

/**
 * Dynamically renders an icon by name. Lucide icons are code-split into a single
 * on-demand chunk; vendored brand icons render synchronously. Falls back to the
 * Settings icon if no name is provided.
 *
 * @example
 * <DynamicIcon name="CircleAlert" />
 * <DynamicIcon name="Github" className="h-6 w-6" />
 */
export function DynamicIcon({
  name,
  className = "h-5 w-5",
  fallback: FallbackIcon = Settings,
}: DynamicIconProps) {
  if (!name) {
    return <FallbackIcon className={className} />;
  }

  // Brand marks lucide v1 removed - render the vendored component synchronously.
  if (isBrandIcon(name)) {
    const Brand = brandIcons[name];
    return <Brand className={className} />;
  }

  return (
    // Invisible, correctly-sized placeholder while the icon chunk loads, so
    // there's no layout shift and no flash of a wrong (fallback) icon.
    <Suspense fallback={<span aria-hidden className={className} />}>
      <RegistryIcon name={name} className={className} />
    </Suspense>
  );
}

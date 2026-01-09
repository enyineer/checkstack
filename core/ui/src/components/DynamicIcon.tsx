import { icons, type LucideIcon } from "lucide-react";
import { Settings } from "lucide-react";
import type { LucideIconName } from "@checkmate-monitor/common";

// Re-export the type for convenience
export type { LucideIconName } from "@checkmate-monitor/common";

/**
 * Props for the DynamicIcon component
 */
export interface DynamicIconProps {
  /** Lucide icon name in PascalCase (e.g., 'AlertCircle', 'HeartPulse') */
  name?: LucideIconName;
  /** CSS class name to apply to the icon */
  className?: string;
  /** Fallback icon if name is not provided */
  fallback?: LucideIcon;
}

/**
 * Dynamically renders a Lucide icon by name.
 * Falls back to Settings icon if the icon name is not provided.
 *
 * @example
 * <DynamicIcon name="AlertCircle" />
 * <DynamicIcon name="HeartPulse" className="h-6 w-6" />
 */
export function DynamicIcon({
  name,
  className = "h-5 w-5",
  fallback: FallbackIcon = Settings,
}: DynamicIconProps) {
  if (!name) {
    return <FallbackIcon className={className} />;
  }

  const Icon = icons[name];

  // Fallback if icon name doesn't exist in lucide-react
  if (!Icon) {
    return <FallbackIcon className={className} />;
  }

  return <Icon className={className} />;
}

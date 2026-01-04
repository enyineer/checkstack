import { icons, type LucideIcon } from "lucide-react";
import { Settings } from "lucide-react";

/**
 * Props for the DynamicIcon component
 */
export interface DynamicIconProps {
  /** Lucide icon name (e.g., 'mail', 'slack', 'message-circle') */
  name?: string;
  /** CSS class name to apply to the icon */
  className?: string;
  /** Fallback icon if the name is not found */
  fallback?: LucideIcon;
}

/**
 * Dynamically renders a Lucide icon by name.
 * Falls back to Settings icon if the icon name is not found.
 */
export function DynamicIcon({
  name,
  className = "h-5 w-5",
  fallback: FallbackIcon = Settings,
}: DynamicIconProps) {
  if (!name) {
    return <FallbackIcon className={className} />;
  }

  // Convert kebab-case to PascalCase (e.g., 'message-circle' -> 'MessageCircle')
  const pascalCase = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  // Look up the icon in lucide-react's icons object
  const Icon = icons[pascalCase as keyof typeof icons];

  if (!Icon) {
    // If not found, try the original name directly (for single-word icons)
    const directIcon =
      icons[
        (name.charAt(0).toUpperCase() + name.slice(1)) as keyof typeof icons
      ];
    if (directIcon) {
      const DirectIcon = directIcon;
      return <DirectIcon className={className} />;
    }
    return <FallbackIcon className={className} />;
  }

  return <Icon className={className} />;
}

import { icons } from "lucide-react";
import type { LucideIconName } from "@checkstack/common";

// Lazy-loaded icon registry.
//
// Importing lucide's `icons` map pulls the ENTIRE ~1600-icon set into one
// module. This file is therefore imported ONLY via `React.lazy` from
// `DynamicIcon`, so that whole set lands in a single on-demand chunk that the
// initial load never fetches (DynamicIcon isn't rendered in the global nav -
// it's used in dialogs, cards, and specific pages). Statically named-imported
// icons elsewhere (`import { Plus } from "lucide-react"`) are unaffected and
// tree-shaken normally into their eager chunks.

/**
 * Render a lucide icon by its PascalCase name. Falls back to the `Settings`
 * icon for an unknown name (matching the previous DynamicIcon behaviour).
 */
export default function RegistryIcon({
  name,
  className,
}: {
  name: LucideIconName;
  className?: string;
}) {
  const Icon = icons[name] ?? icons.Settings;
  return <Icon className={className} />;
}

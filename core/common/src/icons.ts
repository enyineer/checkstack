/**
 * Lucide icon name type and Zod schema.
 * This type is derived from the 'lucide-react' package icons export.
 * Uses type-only import to avoid React runtime dependency on the backend.
 *
 * Icon names are PascalCase (e.g., 'CircleAlert', 'HeartPulse', 'Users')
 */
import type { icons } from "lucide-react";
import { z } from "zod";

/**
 * Valid Lucide icon names (PascalCase).
 * @example "CircleAlert", "Settings", "Users"
 */
export type LucideIconName = keyof typeof icons;

/**
 * Brand icon names that lucide-react v1 removed (all brand marks were dropped
 * for trademark reasons) but that we still support as data-driven icon names.
 * The frontend's `DynamicIcon` resolves these to vendored brand SVGs in
 * `@checkstack/ui`. Keep this in sync with the `brandIcons` map there.
 */
export type BrandIconName = "Github" | "Gitlab";

/**
 * Any icon name accepted across the platform: a lucide icon or a vendored
 * brand icon.
 * @example "CircleAlert", "Settings", "Github"
 */
export type IconName = LucideIconName | BrandIconName;

/**
 * Zod schema for {@link IconName}.
 * Uses string at runtime but infers `IconName` for compile-time safety.
 * Use this in RPC contracts to get proper type inference.
 *
 * @example
 * const schema = z.object({ icon: lucideIconSchema.optional() });
 * // Infers: { icon?: IconName }
 */
export const lucideIconSchema = z.string() as z.ZodType<IconName>;

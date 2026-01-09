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
 * Zod schema for LucideIconName.
 * Uses string at runtime but infers LucideIconName type for compile-time safety.
 * Use this in RPC contracts to get proper type inference.
 *
 * @example
 * const schema = z.object({ icon: lucideIconSchema.optional() });
 * // Infers: { icon?: LucideIconName }
 */
export const lucideIconSchema = z.string() as z.ZodType<LucideIconName>;

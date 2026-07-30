/**
 * Naming for "clone this" flows (roles, systems, environments, ...).
 *
 * Shared so every clone affordance in the product produces the same shape of
 * name. The suffix matters for two reasons: the copy cannot be mistaken for the
 * original in a list before the author renames it, and a name-unique resource
 * cannot fail to save merely because the seeded name collided.
 */

/** The suffix appended to a cloned resource's name. */
export const CLONE_NAME_SUFFIX = "(copy)";

/**
 * The name a cloned resource opens with.
 *
 * Deliberately NOT idempotent: cloning a clone yields `Foo (copy) (copy)`.
 * Collapsing repeats would make two different copies of the same source share a
 * name, which is exactly the collision the suffix exists to avoid.
 */
export function buildClonedName({ name }: { name: string }): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed} ${CLONE_NAME_SUFFIX}` : CLONE_NAME_SUFFIX;
}

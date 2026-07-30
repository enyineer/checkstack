/**
 * What a catalog identity editor (system / environment / group) is doing with
 * its `initialData`.
 *
 * The mode has to be explicit. These editors used to derive "am I editing?"
 * from `initialData?.id` being present, which cannot express the third case:
 * SEEDED FROM an existing record but saving as a CREATE. Deriving it also made
 * every downstream branch (the team picker, the modelling hint, the link to the
 * detail page) silently wrong for a clone.
 */
export type CatalogEditorMode = "create" | "edit" | "clone";

/**
 * Whether the editor should save through the CREATE path.
 *
 * True for both `create` and `clone` - a clone is a create with a head start,
 * and everything create-only (owning-team picker, modelling hint) must show for
 * it, while everything that needs a saved record (the detail-page link) must
 * not.
 */
export function isCreateMode({ mode }: { mode: CatalogEditorMode }): boolean {
  return mode !== "edit";
}

/**
 * Resolve the mode when a caller has not passed one.
 *
 * Preserves the historical behaviour (`initialData` present means edit) so
 * every existing call site keeps working untouched. Only a caller that wants a
 * clone has to say so.
 */
export function resolveEditorMode({
  mode,
  hasInitialData,
}: {
  mode?: CatalogEditorMode;
  hasInitialData: boolean;
}): CatalogEditorMode {
  return mode ?? (hasInitialData ? "edit" : "create");
}

/**
 * SHALLOW clone semantics, for the copy explaining itself to the author.
 *
 * Copied: name (suffixed), description, custom fields.
 *
 * Deliberately NOT copied: group and environment membership, tags, contacts,
 * links, dependencies, team grants, and health-check assignments. Those all
 * imply an ongoing relationship the copy has not earned, and duplicating
 * health-check assignments in particular would silently multiply probe volume
 * and notification noise with every clone.
 */
export const CLONE_SCOPE_NOTE =
  "Copies the description and custom fields only. Memberships, links, team access and health checks are not copied.";

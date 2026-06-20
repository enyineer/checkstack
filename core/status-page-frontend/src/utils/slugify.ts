/**
 * Derive a URL-safe slug from arbitrary text: lowercase, collapse every run of
 * non-alphanumeric characters into a single hyphen, and strip leading/trailing
 * hyphens. Used to auto-fill the status-page slug from its title in the create
 * dialog (until the operator edits the slug themselves).
 */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

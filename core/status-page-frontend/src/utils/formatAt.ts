/**
 * Absolute date + time in the viewer's locale. Shared by the public status page
 * widgets and the public incident / maintenance detail pages so both read the
 * same way.
 */
export const formatAt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

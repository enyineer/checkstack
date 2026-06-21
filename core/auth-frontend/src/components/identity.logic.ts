/**
 * Derive a single-character identity initial for an avatar/anchor chip from a
 * user's display name, falling back to their email and finally to a neutral
 * placeholder. Pure presentation helper - no new data is fetched, it only
 * reshapes values already on the row.
 */
export const deriveInitial = ({
  name,
  email,
}: {
  name?: string | null;
  email?: string | null;
}): string => {
  const fromName = name?.trim();
  if (fromName) {
    return fromName.charAt(0).toUpperCase();
  }

  const fromEmail = email?.trim();
  if (fromEmail) {
    return fromEmail.charAt(0).toUpperCase();
  }

  return "?";
};

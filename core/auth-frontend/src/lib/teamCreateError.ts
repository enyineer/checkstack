/**
 * Map a failed-create error to a short, actionable message to show INLINE on a
 * `TeamOwnershipPicker`, based on the structured `data.code` the auth service
 * emits. Returns `null` when the error isn't a team-create error (caller should
 * fall back to its generic toast).
 *
 * Codes (see auth-backend `authorizeCreate`):
 * - OWNER_TEAM_REQUIRED      — the caller is in multiple eligible teams and must pick one
 * - RESOURCE_TEAM_FORBIDDEN  — the chosen team isn't one the caller belongs to
 * - RESOURCE_CREATE_FORBIDDEN — no team/parent grant allows creating this type
 */
export function teamCreateErrorMessage(error: unknown): string | null {
  const data = (error as { data?: { code?: unknown } } | null | undefined)
    ?.data;
  const code = typeof data?.code === "string" ? data.code : undefined;
  switch (code) {
    case "OWNER_TEAM_REQUIRED": {
      return "Choose which of your teams should own this.";
    }
    case "RESOURCE_TEAM_FORBIDDEN": {
      return "You are not a member of the selected team.";
    }
    case "RESOURCE_CREATE_FORBIDDEN": {
      return "Your team isn't allowed to create this. Ask an administrator to grant it, or pick a team that can.";
    }
    default: {
      return null;
    }
  }
}

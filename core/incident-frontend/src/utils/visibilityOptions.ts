import type { IncidentVisibility } from "@checkstack/incident-common";

/**
 * Audience options offered for an incident update or hotlink in the editor.
 * Mirrors the `IncidentVisibilityEnum` values; the labels are the user-facing
 * copy.
 */
export const INCIDENT_VISIBILITY_OPTIONS: {
  value: IncidentVisibility;
  label: string;
}[] = [
  { value: "public", label: "Public" },
  { value: "logged_in", label: "Logged-in users" },
  { value: "internal", label: "Internal (managers only)" },
];

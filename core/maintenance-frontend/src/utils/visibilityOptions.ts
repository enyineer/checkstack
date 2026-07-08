import type { MaintenanceVisibility } from "@checkstack/maintenance-common";

/**
 * Audience options offered for a maintenance update or hotlink in the editor.
 * Mirrors the `MaintenanceVisibilityEnum` values; the labels are the user-facing
 * copy.
 */
export const MAINTENANCE_VISIBILITY_OPTIONS: {
  value: MaintenanceVisibility;
  label: string;
}[] = [
  { value: "public", label: "Public" },
  { value: "logged_in", label: "Logged-in users" },
  { value: "internal", label: "Internal (managers only)" },
];

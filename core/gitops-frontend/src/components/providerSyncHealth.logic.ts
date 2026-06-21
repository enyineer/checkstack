/**
 * Pure classification of a Git provider's sync health into the colorblind-safe
 * status triad, used to drive the row accent stripe + status pill. Kept logic
 * free of any React/JSX so it can be unit-tested in isolation.
 */

export type SyncHealthTone = "ok" | "down" | "unknown";

export interface SyncHealthInput {
  lastSyncAt: Date | null;
  lastSyncError: string | null;
}

export interface SyncHealthResult {
  tone: SyncHealthTone;
  label: string;
}

/**
 * Classify provider sync health:
 * - an error present (regardless of last-sync time) reads as "Sync error"
 * - a successful sync with no error reads as "Synced"
 * - never synced and no error reads as "Never synced"
 */
export const classifySyncHealth = ({
  lastSyncAt,
  lastSyncError,
}: SyncHealthInput): SyncHealthResult => {
  if (lastSyncError) {
    return { tone: "down", label: "Sync error" };
  }
  if (lastSyncAt) {
    return { tone: "ok", label: "Synced" };
  }
  return { tone: "unknown", label: "Never synced" };
};

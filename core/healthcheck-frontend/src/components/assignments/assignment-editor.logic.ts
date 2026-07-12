import {
  DEFAULT_NOTIFICATION_POLICY,
  DEFAULT_RETENTION_CONFIG,
} from "@checkstack/healthcheck-common";
import type {
  AssociateHealthCheck,
  NotificationPolicy,
  RetentionConfig,
  StateThresholds,
} from "@checkstack/healthcheck-common";
import type { RetentionData } from "./RetentionPanel";

/**
 * Pure state/merge logic for the check editor's Assignment section (DOM-free).
 * Extracted from the former system-centric AssignmentIDEPage so the panels
 * stay dumb and the merge semantics are unit-testable.
 */

/**
 * One assignment row of a configuration, as returned by
 * `getConfigurationAssignments` (systemName omitted where irrelevant).
 */
export interface AssignmentDetails {
  systemId: string;
  enabled: boolean;
  stateThresholds?: StateThresholds;
  satelliteIds?: string[];
  /** null = all current environments; [] = opt out; non-empty = those ids. */
  environmentIds?: string[] | null;
  includeLocal: boolean;
  notificationPolicy?: NotificationPolicy;
}

/**
 * Build the FULL `associateSystem` body (an upsert of the whole assignment)
 * from an existing row plus a partial patch. Centralises what used to be
 * seven hand-rolled body copies: every field the operator did not touch is
 * carried over verbatim, and the `environmentIds` null/[]/list distinction is
 * preserved (a `??` here would silently turn "all environments" into a
 * dropped field).
 */
export function buildAssociationBody({
  configurationId,
  assignment,
  patch = {},
}: {
  configurationId: string;
  assignment: AssignmentDetails;
  patch?: Partial<Omit<AssociateHealthCheck, "configurationId">>;
}): AssociateHealthCheck {
  const body: AssociateHealthCheck = {
    configurationId,
    enabled: assignment.enabled,
    stateThresholds: assignment.stateThresholds,
    satelliteIds: assignment.satelliteIds,
    environmentIds: assignment.environmentIds,
    includeLocal: assignment.includeLocal,
    notificationPolicy: assignment.notificationPolicy,
  };
  for (const [key, value] of Object.entries(patch)) {
    // Patches assign explicitly-provided keys even when the value is
    // `undefined` (e.g. clearing `notificationPolicy` back to platform
    // defaults) — a spread would do the same, but this keeps `environmentIds:
    // null` distinguishable from "not patched" for readers.
    (body as Record<string, unknown>)[key] = value;
  }
  return body;
}

/**
 * Resolve what the Notifications panel shows for one assignment: the draft
 * being edited, else the persisted override, else the platform defaults.
 * `isOverridden` is true while a draft exists OR the persisted assignment
 * carries its own policy - both mean "not inheriting".
 */
export function resolveNotificationPolicyView({
  draft,
  persisted,
  platformDefaults,
}: {
  draft: NotificationPolicy | undefined;
  persisted: NotificationPolicy | undefined;
  platformDefaults: NotificationPolicy | undefined;
}): { policy: NotificationPolicy; isOverridden: boolean } {
  return {
    policy:
      draft ?? persisted ?? platformDefaults ?? DEFAULT_NOTIFICATION_POLICY,
    isOverridden: draft !== undefined || persisted !== undefined,
  };
}

/**
 * Seed the retention editor's local state from a fetched per-assignment
 * retention config. `null`/absent means "using platform defaults" - the
 * defaults are shown as editable values with `isCustom: false`.
 */
export function seedRetentionData(
  retentionConfig: RetentionConfig | null | undefined,
): RetentionData {
  return {
    rawRetentionDays:
      retentionConfig?.rawRetentionDays ??
      DEFAULT_RETENTION_CONFIG.rawRetentionDays,
    hourlyRetentionDays:
      retentionConfig?.hourlyRetentionDays ??
      DEFAULT_RETENTION_CONFIG.hourlyRetentionDays,
    dailyRetentionDays:
      retentionConfig?.dailyRetentionDays ??
      DEFAULT_RETENTION_CONFIG.dailyRetentionDays,
    isCustom: !!retentionConfig,
  };
}

/**
 * The explicit environment-id set to seed "specific" mode from: the current
 * explicit selection when one exists, else all of the system's current
 * environments (a sensible starting point for narrowing).
 */
export function seedSpecificEnvironmentIds({
  environmentIds,
  systemEnvironmentIds,
}: {
  environmentIds: string[] | null | undefined;
  systemEnvironmentIds: string[];
}): string[] {
  return environmentIds && environmentIds.length > 0
    ? environmentIds
    : systemEnvironmentIds;
}

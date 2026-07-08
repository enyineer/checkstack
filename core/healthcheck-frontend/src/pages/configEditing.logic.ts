/**
 * The health-check editor route param (`configId`) is either a persisted
 * configuration id or the literal `"new"` sentinel for an unsaved check.
 *
 * Several IDE plugin slots (e.g. the Anomaly "Template Anomaly Defaults" panel)
 * mount on this id and immediately fire parent-scoped queries
 * (`getAnomalyConfig` / `getConfiguration`) whose `enabled: !!configurationId`
 * guard is DEFEATED by the truthy `"new"` sentinel. The backend then rejects the
 * non-existent parent id and the editor 400s in the console until the check is
 * saved.
 *
 * Collapsing the sentinel to `undefined` restores those `enabled` guards and
 * lets the slot-mount gate treat an unsaved check as "no id yet".
 */
export function resolvePersistedConfigId(
  configId: string | undefined,
): string | undefined {
  return configId && configId !== "new" ? configId : undefined;
}

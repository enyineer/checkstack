/**
 * Identifiers the seeder produces that the capturer needs to build deep-link
 * routes (system detail, SLO detail, incident timeline, health-check history
 * detail, ...). Kept small and explicit: capture only needs one representative
 * id per detail surface, chosen by the seeder to be the richest example.
 */
export interface SeedRefs {
  /** The flagship system, used for the system-detail and drawer shots. */
  systemId: string;
  /** A health-check configuration assigned to {@link systemId}. */
  configurationId: string;
  /**
   * The most-recent synthesized run for {@link configurationId}. Used to
   * deep-link the run-history master-detail into a run-selected state (the
   * selected run is a trailing path segment), so the detail panel renders
   * populated instead of the "select a run" placeholder.
   */
  historyRunId: string;
  /** A representative SLO objective id for the SLO detail shot. */
  sloId: string;
  /** An active incident id for the incident-timeline shot. */
  incidentId: string;
  /** A maintenance window id for the maintenance-detail shot. */
  maintenanceId: string;
}

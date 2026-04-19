import type { SatelliteAssignment } from "@checkstack/satellite-common";

/**
 * Builds the full configuration payload for a satellite.
 * Queries systemHealthChecks for associations that reference this satellite's ID,
 * then joins with healthCheckConfigurations to build the full assignment list.
 */
export class ConfigRelay {
  constructor(
    /**
     * The healthcheck database connection.
     * This is passed in from the healthcheck-backend's schema context.
     */
    private getHealthcheckDb: () => Promise<{
      getAssignmentsForSatellite: (
        satelliteId: string,
      ) => Promise<SatelliteAssignment[]>;
    }>,
  ) {}

  /**
   * Get all health check assignments for a specific satellite.
   * Returns the full configuration payload needed for the satellite to execute checks.
   */
  async getAssignmentsForSatellite(
    satelliteId: string,
  ): Promise<SatelliteAssignment[]> {
    const db = await this.getHealthcheckDb();
    return db.getAssignmentsForSatellite(satelliteId);
  }
}

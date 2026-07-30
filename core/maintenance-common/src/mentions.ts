/**
 * The cross-entity mention type maintenance windows own.
 *
 * STABLE by contract: baked into every mention already written
 * (`[Label](checkstack:maintenance/<id>)`), so changing it orphans them all.
 *
 * Lives in `*-common` because both halves must agree - the frontend registers
 * its provider under this type, and the backend's status-page widget declares
 * the same value as its `mentionType`. See `INCIDENT_MENTION_TYPE`.
 */
export const MAINTENANCE_MENTION_TYPE = "maintenance";

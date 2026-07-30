/**
 * The cross-entity mention type incidents own.
 *
 * STABLE by contract: it is baked into every mention already written into an
 * update or a description (`[Label](checkstack:incident/<id>)`), so changing it
 * orphans them all.
 *
 * Lives in `*-common` because BOTH halves need it and they must agree: the
 * frontend registers its provider under this type, and the backend's
 * status-page widget declares the same value as its `mentionType` so a public
 * page can resolve a reference to an incident it surfaces. A drift between the
 * two would silently stop public mentions resolving.
 */
export const INCIDENT_MENTION_TYPE = "incident";

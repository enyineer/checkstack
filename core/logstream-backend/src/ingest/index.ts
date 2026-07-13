/**
 * Public surface of the ingest area. The backend `index.ts` registers the
 * endpoints via {@link registerIngestEndpoints} (kept in `./setup` as the
 * Foundation seam); the API area reads per-pod ingest counters via
 * {@link getIngestCounters} for the stream overview page.
 */

export { registerIngestEndpoints } from "./setup";
export { getIngestCounters, ingestCounters } from "./counters";
export { streamConfigCacheKey } from "./stream-config";
// The token-cache key builder is owned by the API area; re-exported here for
// callers that only import from the ingest surface.
export { ingestTokenCacheKey } from "../api/token-cache";

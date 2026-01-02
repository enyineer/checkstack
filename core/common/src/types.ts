// =============================================================================
// RPC PROCEDURE METADATA
// =============================================================================

/**
 * Metadata interface for RPC procedures.
 * Used by contracts to define auth requirements and by backend middleware to enforce them.
 *
 * @example
 * const contract = {
 *   getItems: baseContractBuilder
 *     .meta({
 *       userType: "user",
 *       permissions: [permissions.myPluginRead.id]
 *     })
 *     .output(z.array(ItemSchema)),
 * };
 */
export interface ProcedureMetadata {
  /**
   * Which type of caller can access this endpoint.
   * - "anonymous": No authentication required, no permission checks (fully public)
   * - "public": Anyone can attempt, but permissions are checked (uses anonymous role for guests)
   * - "user": Only real users (frontend authenticated)
   * - "service": Only services (backend-to-backend)
   * - "authenticated": Either users or services, but must be authenticated (default)
   */
  userType?: "anonymous" | "public" | "user" | "service" | "authenticated";

  /**
   * Permissions required to access this endpoint.
   * Only enforced for real users - services are trusted.
   * For "public" userType, permissions are checked against the anonymous role if not authenticated.
   * User must have at least one of the listed permissions, or "*" (wildcard).
   */
  permissions?: string[];
}

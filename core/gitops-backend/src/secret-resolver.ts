/**
 * The schema-driven secret resolver was promoted to the central Secrets
 * platform (`@checkstack/secrets-backend`). This module re-exports it so
 * gitops's sync worker / reconciler keep their existing import paths while
 * the canonical implementation + tests live in secrets-backend.
 */
export {
  resolveSecretsBySchema,
  type SecretStore,
  type SecretResolutionResult,
} from "@checkstack/secrets-backend";

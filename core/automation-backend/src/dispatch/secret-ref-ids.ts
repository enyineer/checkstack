/**
 * Service-ref ids the dispatch engine intercepts to capture resolved
 * secret values for run-wide output masking.
 *
 * These are kept as plain string constants (rather than importing the
 * `secretResolverRef` / `connectionStoreRef` objects) so the dispatch core
 * does NOT take a hard dependency on `@checkstack/secrets-backend` or
 * `@checkstack/integration-backend` (which would risk a dependency cycle).
 * A unit test asserts these match the real ref ids, so a rename in either
 * package fails CI rather than silently disabling masking.
 */

/** Must equal `secretResolverRef.id` in `@checkstack/secrets-backend`. */
export const SECRET_RESOLVER_REF_ID = "secrets.resolver";

/** Must equal `connectionStoreRef.id` in `@checkstack/integration-backend`. */
export const CONNECTION_STORE_REF_ID = "integration.connectionStore";

import type { Versioned } from "@checkstack/backend-api";

/**
 * Migrate-then-validate a stored per-strategy `userConfig` blob against the
 * strategy's own {@link Versioned} schema before it is handed to `send()`.
 *
 * The user-preference record stores `userConfig` as a bare object (see
 * `UserPreferenceConfigSchema.userConfig`), so it is never validated against
 * the strategy's `userConfig` schema on the read path. This helper closes that
 * gap: the raw blob is treated as a `version: 1` record and run through
 * `strategy.userConfig.parseAssumingV1`, which migrates it forward and
 * validates it. The result is the value `send()` actually receives.
 *
 * Returns `undefined` when the strategy declares no `userConfig` schema or the
 * user has not stored one yet, matching the previous pass-through behaviour.
 */
export async function resolveStrategyUserConfig({
  userConfigSchema,
  storedUserConfig,
}: {
  /** The strategy's own per-user config schema, if it declares one. */
  userConfigSchema: Versioned<unknown> | undefined;
  /** The raw `userConfig` blob read from the user-preference record. */
  storedUserConfig: unknown;
}): Promise<unknown> {
  if (!userConfigSchema || storedUserConfig === undefined) {
    return undefined;
  }

  // Stored userConfig blobs are unversioned today, so assume-v1: wrap as
  // { version: 1, data } and run migrate-then-validate. The shared
  // `parseAssumingV1` helper lives on `Versioned`.
  return userConfigSchema.parseAssumingV1(storedUserConfig);
}

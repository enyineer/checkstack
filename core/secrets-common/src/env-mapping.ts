import { z } from "zod";
import { secretTemplateSchema } from "./secret-field";

/**
 * Valid POSIX-ish environment variable name: starts with a letter or
 * underscore, then letters, digits, underscores. Upper-case is the
 * convention but not enforced (shells are case-sensitive).
 */
export const ENV_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const envNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    ENV_NAME_REGEX,
    "Environment variable names must start with a letter or underscore and contain only letters, digits, or underscores",
  );

/**
 * A consumer's explicit secret→env allowlist:
 * `{ API_TOKEN: "${{ secrets.jira_token }}" }`.
 *
 * Each key is the env var the consumer's run sees; each value is a
 * `${{ secrets.NAME }}` template resolved against the active backend.
 * This is the least-privilege contract: only the secrets named here are
 * resolved and injected for the consumer's runs (no ambient access).
 */
export const secretEnvMappingSchema = z.record(
  envNameSchema,
  secretTemplateSchema,
);

export type SecretEnvMapping = z.infer<typeof secretEnvMappingSchema>;

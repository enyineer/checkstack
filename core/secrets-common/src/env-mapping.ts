import { z } from "zod";
import {
  SECRET_NAME_REGEX,
  secretNameSchema,
  secretTemplateSchema,
} from "./secret-field";

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
 * Render a bare secret name as its canonical `${{ secrets.NAME }}` template.
 * Shared with the UI serializer so both produce identical canonical output.
 */
export function toSecretTemplate(secretName: string): string {
  return `\${{ secrets.${secretName} }}`;
}

/**
 * A single secret→env mapping VALUE. The canonical (stored / serialized)
 * form is the `${{ secrets.NAME }}` template, but a bare secret name (e.g.
 * `"jira_token"`, as a YAML / GitOps shorthand or legacy data) is TOLERATED
 * on input. Only a pure secret reference (a whole-value template) or a pure
 * bare secret name is accepted — arbitrary interpolation or partial templates
 * are not.
 *
 * IMPORTANT: this is a plain union with NO `.transform()`. This schema is
 * embedded (via `secretEnvMappingSchema`) in plugin action/collector CONFIG
 * schemas, which the plugin manager renders to JSON Schema for the UI — and a
 * zod transform "cannot be represented in JSON Schema" (it throws at load
 * time). Normalization of a bare name to the canonical template therefore
 * happens at the CONSUMPTION boundary instead, via
 * {@link normalizeSecretEnvValue} (called by the run resolver and the test
 * placeholder builder), not on parse.
 */
export const secretEnvValueSchema = z.union([
  secretTemplateSchema,
  secretNameSchema,
]);

/**
 * Normalize a single `secretEnv` mapping value to its canonical
 * `${{ secrets.NAME }}` template form: a bare secret name is wrapped, an
 * already-canonical template (or any value containing a `${{ … }}`) is
 * returned unchanged. Apply this at every point that parses the value as a
 * template, so a tolerated bare name resolves / placeholder-builds correctly.
 */
export function normalizeSecretEnvValue(value: string): string {
  return SECRET_NAME_REGEX.test(value) ? toSecretTemplate(value) : value;
}

/**
 * A consumer's explicit secret→env allowlist:
 * `{ API_TOKEN: "${{ secrets.jira_token }}" }`.
 *
 * Each key is the env var the consumer's run sees; each value is a
 * `${{ secrets.NAME }}` template resolved against the active backend (a bare
 * secret name is tolerated on input and normalized to the template — see
 * {@link secretEnvValueSchema}). This is the least-privilege contract: only
 * the secrets named here are resolved and injected for the consumer's runs
 * (no ambient access).
 */
export const secretEnvMappingSchema = z.record(
  envNameSchema,
  secretEnvValueSchema,
);

export type SecretEnvMapping = z.infer<typeof secretEnvMappingSchema>;

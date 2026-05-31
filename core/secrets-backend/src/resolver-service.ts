import { z } from "zod";
import {
  collectSecretNames,
  normalizeSecretEnvValue,
  type SecretEnvMapping,
} from "@checkstack/secrets-common";
import {
  resolveSecretsBySchema,
  type SecretResolutionResult,
  type SecretStore,
} from "./secret-resolver";
import {
  createMaskingContext,
  type SecretMaskingContext,
} from "./masking-context";

/**
 * Cross-plugin secret resolution service, exposed via `secretResolverRef`.
 *
 * Wraps the promoted `resolveSecretsBySchema` so any consumer plugin
 * (gitops, automation, healthcheck) resolves `${{ secrets.NAME }}` in
 * `x-secret` fields on demand against the active backend, and can resolve
 * a run's least-privilege env-mapping allowlist into values + a masking
 * context.
 *
 * NOTE: every method here returns secret VALUES. It is a service-typed,
 * backend-to-backend interface only — it MUST NOT be exposed to a browser
 * client. Output produced from these values must pass through the
 * returned `SecretMaskingContext` before it is persisted or returned.
 */
export interface SecretResolverService {
  /** Resolve a single secret value by name. Throws if not found. */
  resolveSecret(input: { name: string }): Promise<string>;

  /**
   * Resolve `${{ secrets.NAME }}` templates in `x-secret`-annotated fields
   * of `value`, per `schema`. Promoted from gitops-backend.
   */
  resolveBySchema<T>(input: {
    value: T;
    schema: z.ZodTypeAny;
  }): Promise<SecretResolutionResult<T>>;

  /**
   * Resolve a consumer's least-privilege secret→env allowlist into the
   * concrete env vars for a run, plus a run-scoped masking context holding
   * exactly those values. If any referenced secret is missing, this throws
   * (the run must fail clearly rather than run without a required secret).
   */
  resolveForRun(input: {
    secretEnv: SecretEnvMapping;
  }): Promise<{ env: Record<string, string>; masking: SecretMaskingContext }>;
}

/**
 * Build the resolver service over a {@link SecretStore} (typically backed
 * by the active backend's `get`).
 */
export function createSecretResolverService({
  secretStore,
}: {
  secretStore: SecretStore;
}): SecretResolverService {
  return {
    resolveSecret({ name }) {
      return secretStore.resolve(name);
    },

    resolveBySchema({ value, schema }) {
      return resolveSecretsBySchema({ value, schema, secretStore });
    },

    async resolveForRun({ secretEnv }) {
      // Normalize tolerated bare secret names to the canonical template
      // (the value schema no longer transforms — see `secretEnvValueSchema`),
      // so collection + substitution below see only `${{ secrets.NAME }}`.
      const normalized: Record<string, string> = {};
      for (const [envName, value] of Object.entries(secretEnv)) {
        normalized[envName] = normalizeSecretEnvValue(value);
      }

      // Collect every distinct secret name referenced by the mapping, so
      // we resolve each once even if reused across multiple env vars.
      const names = new Set(
        collectSecretNames({ value: Object.values(normalized) }),
      );

      const resolved = new Map<string, string>();
      for (const name of names) {
        resolved.set(name, await secretStore.resolve(name));
      }

      // Build the env by substituting templates in each mapping value.
      const env: Record<string, string> = {};
      for (const [envName, template] of Object.entries(normalized)) {
        env[envName] = substituteTemplate({ template, resolved });
      }

      const masking = createMaskingContext({ values: resolved.values() });
      return { env, masking };
    },
  };
}

const TEMPLATE_RE = /\$\{\{\s*secrets\.([a-zA-Z0-9_-]+)\s*\}\}/g;

function substituteTemplate({
  template,
  resolved,
}: {
  template: string;
  resolved: Map<string, string>;
}): string {
  TEMPLATE_RE.lastIndex = 0;
  return template.replaceAll(TEMPLATE_RE, (_full, name: string) => {
    const value = resolved.get(name);
    if (value === undefined) {
      throw new Error(`Required secret not available: ${name}`);
    }
    return value;
  });
}

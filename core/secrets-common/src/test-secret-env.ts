import { SECRET_TEMPLATE_REGEX } from "./secret-field";
import { normalizeSecretEnvValue } from "./env-mapping";

/**
 * Placeholder a declared secret is injected as in the test path when the
 * user provides no override (decision 4: real values never reach the test
 * surface).
 */
export function secretTestPlaceholder(name: string): string {
  return `__SECRET_${name}__`;
}

/**
 * Build the env to inject for an in-UI script/collector TEST run from the
 * consumer's declared `secretEnv` mapping. NO real secret value is ever
 * resolved here (decision 4): for each `{ ENV_NAME: "${{ secrets.NAME }}" }`
 * entry, inject the user's override for NAME if provided, otherwise a
 * `__SECRET_<NAME>__` placeholder. Also returns the override values so they
 * can be masked out of the test result (an override must not round-trip
 * unmasked).
 */
export function buildTestSecretEnv({
  secretEnv,
  secretOverrides,
}: {
  secretEnv?: Record<string, string>;
  secretOverrides?: Record<string, string>;
}): { env: Record<string, string>; maskValues: string[] } {
  const env: Record<string, string> = {};
  const maskValues: string[] = [];
  if (!secretEnv) return { env, maskValues };

  for (const [envName, rawValue] of Object.entries(secretEnv)) {
    // A tolerated bare secret name is normalized to the canonical template
    // here (the schema no longer transforms — see `secretEnvValueSchema`).
    const template = normalizeSecretEnvValue(rawValue);
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    const match = SECRET_TEMPLATE_REGEX.exec(template);
    const secretName = match?.[1];
    if (!secretName) {
      // Non-template, non-name value (shouldn't happen given schema validation).
      env[envName] = secretTestPlaceholder(envName);
      continue;
    }
    const override = secretOverrides?.[secretName];
    if (override === undefined) {
      env[envName] = secretTestPlaceholder(secretName);
    } else {
      env[envName] = override;
      maskValues.push(override);
    }
  }
  return { env, maskValues };
}

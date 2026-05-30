import { maskSecrets, maskSecretsDeep } from "@checkstack/secrets-common";

/**
 * Run-scoped masking context: holds the resolved secret VALUES for a
 * single run (the consumer's least-privilege allowlist only) and applies
 * Jenkins-style by-value redaction at every output boundary before the
 * output is persisted or returned.
 *
 * The value set is the run's resolved secrets, NOT the whole secret store
 * — this is both least-privilege and avoids masking unrelated coincidental
 * strings. Create one per run, register the run's resolved values, and
 * pass the result of `mask*` through to persistence/RPC.
 */
export interface SecretMaskingContext {
  /** Number of distinct values held (for diagnostics, never the values). */
  readonly size: number;
  /** Redact every literal occurrence of a held value in `text`. */
  maskText(text: string): string;
  /** Recursively redact held values in a JSON-like payload (keys + leaves). */
  maskDeep(value: unknown): unknown;
}

/**
 * Build a masking context from a run's resolved secret values.
 */
export function createMaskingContext({
  values,
}: {
  values: Iterable<string>;
}): SecretMaskingContext {
  const valueSet = new Set<string>(values);
  return {
    get size() {
      return valueSet.size;
    },
    maskText(text) {
      if (valueSet.size === 0) return text;
      return maskSecrets({ text, values: valueSet });
    },
    maskDeep(value) {
      if (valueSet.size === 0) return value;
      return maskSecretsDeep({ value, values: valueSet });
    },
  };
}

/** A no-op context (no values) for paths with no resolved secrets. */
export const EMPTY_MASKING_CONTEXT: SecretMaskingContext = createMaskingContext(
  { values: [] },
);

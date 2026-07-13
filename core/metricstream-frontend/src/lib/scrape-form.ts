import {
  DEFAULT_SCRAPE_TIMEOUT_MS,
  MAX_SCRAPE_INTERVAL_SECONDS,
  MIN_SCRAPE_INTERVAL_SECONDS,
  type CreateScrapeTarget,
  type MetricScrapeTarget,
  type UpdateScrapeTarget,
} from "@checkstack/metricstream-common";

/**
 * Editor state for the bearer-token secret field. Mirrors the DynamicForm
 * `SecretField` affordance for a bespoke CRUD resource: a stored secret reads
 * back as empty (`value: ""`, `stored: true`); typing REPLACES it; the explicit
 * `cleared` flag REMOVES it. `stored` is the read DTO's `hasBearerToken`.
 */
export interface ScrapeSecretState {
  /** The plaintext the operator typed, or "" when untouched. */
  value: string;
  /** True when a secret is already stored server-side (`hasBearerToken`). */
  stored: boolean;
  /** True when the operator pressed "Clear" to remove the stored secret. */
  cleared: boolean;
}

/** Full editor state for the create/edit scrape-target dialog. */
export interface ScrapeFormState {
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutMs: number;
  enabled: boolean;
  secret: ScrapeSecretState;
  /** Scrape source: `null` = the core, else the bound satellite's id. */
  satelliteId: string | null;
}

/** Fresh create-dialog state (matches the schema defaults). */
export function emptyScrapeForm(): ScrapeFormState {
  return {
    name: "",
    url: "",
    intervalSeconds: 60,
    timeoutMs: DEFAULT_SCRAPE_TIMEOUT_MS,
    enabled: true,
    secret: { value: "", stored: false, cleared: false },
    satelliteId: null,
  };
}

/** Seed the edit-dialog state from an existing target (secret reads back blank). */
export function scrapeFormFromTarget(
  target: MetricScrapeTarget,
): ScrapeFormState {
  return {
    name: target.name,
    url: target.url,
    intervalSeconds: target.intervalSeconds,
    timeoutMs: target.timeoutMs,
    enabled: target.enabled,
    secret: { value: "", stored: target.hasBearerToken, cleared: false },
    satelliteId: target.satelliteId,
  };
}

/** Trimmed typed secret, or "" when nothing was typed. */
function typedSecret(secret: ScrapeSecretState): string {
  return secret.value.trim();
}

/** True when the operator has started entering a replacement secret. */
export function hasSecretInput(secret: ScrapeSecretState): boolean {
  return typedSecret(secret).length > 0;
}

/**
 * The `bearerToken` value for a CREATE payload: the typed secret, or `undefined`
 * (omit) when the field was left blank. There is no "clear" on create.
 */
export function createBearerToken(
  secret: ScrapeSecretState,
): string | undefined {
  const typed = typedSecret(secret);
  return typed.length > 0 ? typed : undefined;
}

/**
 * The `bearerToken` value for an UPDATE payload, per the frozen contract
 * sentinel: `null` = clear the stored secret, a string = set a new one,
 * `undefined` = keep the existing secret untouched. Clearing wins over an
 * accidental leftover input.
 */
export function updateBearerToken(
  secret: ScrapeSecretState,
): string | null | undefined {
  if (secret.cleared) return null;
  const typed = typedSecret(secret);
  return typed.length > 0 ? typed : undefined;
}

/** Trim + validate the shared fields; returns an error message or null. */
export function validateScrapeForm(form: ScrapeFormState): string | null {
  if (form.name.trim().length === 0) return "Name is required";
  const url = form.url.trim();
  if (url.length === 0) return "URL is required";
  try {
    // Match the contract's `z.string().url()` guard client-side for a friendly
    // inline message instead of a raw 400.
    new URL(url);
  } catch {
    return "Enter a valid URL (including http:// or https://)";
  }
  if (
    form.intervalSeconds < MIN_SCRAPE_INTERVAL_SECONDS ||
    form.intervalSeconds > MAX_SCRAPE_INTERVAL_SECONDS
  ) {
    return `Interval must be between ${MIN_SCRAPE_INTERVAL_SECONDS} and ${MAX_SCRAPE_INTERVAL_SECONDS} seconds`;
  }
  return null;
}

/** Build the `createScrapeTarget` input from the dialog state. */
export function buildScrapeTargetCreate({
  form,
  streamId,
}: {
  form: ScrapeFormState;
  streamId: string;
}): CreateScrapeTarget {
  return {
    streamId,
    name: form.name.trim(),
    url: form.url.trim(),
    intervalSeconds: form.intervalSeconds,
    timeoutMs: form.timeoutMs,
    enabled: form.enabled,
    bearerToken: createBearerToken(form.secret),
    satelliteId: form.satelliteId,
  };
}

/** Build the `updateScrapeTarget` input from the dialog state. */
export function buildScrapeTargetUpdate({
  form,
  streamId,
  targetId,
}: {
  form: ScrapeFormState;
  streamId: string;
  targetId: string;
}): UpdateScrapeTarget {
  return {
    streamId,
    targetId,
    name: form.name.trim(),
    url: form.url.trim(),
    intervalSeconds: form.intervalSeconds,
    timeoutMs: form.timeoutMs,
    enabled: form.enabled,
    bearerToken: updateBearerToken(form.secret),
    // The selector always reflects the chosen binding, so send it explicitly:
    // `null` unbinds (scrape from core), a string (re)binds to that satellite.
    satelliteId: form.satelliteId,
  };
}

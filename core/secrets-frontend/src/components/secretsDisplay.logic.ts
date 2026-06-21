import type { BackendConfigDto } from "@checkstack/secrets-common";

/** The colorblind-safe status triad used across the secrets UI. */
export type StatusTone = "ok" | "warn" | "down" | "unknown";

/** Minimal shape of a secret needed to summarize inventory health. */
export interface SecretInventoryItem {
  hasValue: boolean;
}

export interface SecretInventory {
  total: number;
  withValue: number;
  missingValue: number;
}

/**
 * Derive the secrets inventory breakdown purely from the loaded list. No query,
 * no mutation - this is presentation-only state for the hero summary strip.
 */
export const summarizeSecrets = (
  secrets: readonly SecretInventoryItem[],
): SecretInventory => {
  let withValue = 0;
  for (const secret of secrets) {
    if (secret.hasValue) withValue += 1;
  }
  return {
    total: secrets.length,
    withValue,
    missingValue: secrets.length - withValue,
  };
};

/**
 * Classify the active-backend connection posture into the status triad so the
 * header can multi-encode it (hue + dot + label + left accent stripe).
 *
 * - `unknown` while the config is still loading.
 * - `warn` when Vault is the active backend but is not yet configured
 *   (no address) or its plugin is unavailable.
 * - `ok` once a backend is active and, for Vault, has an address set.
 */
export const classifyBackendPosture = (
  config: BackendConfigDto | undefined,
): StatusTone => {
  if (!config) return "unknown";

  const isVault = config.activeBackend === "vault";
  if (isVault) {
    const available = config.availableBackends ?? [];
    const vaultAvailable = available.includes("vault");
    const hasAddress = (config.vault?.address ?? "").trim().length > 0;
    if (!vaultAvailable || !hasAddress) return "warn";
  }

  return "ok";
};

/** Human label for the writable vs. read-through posture pill. */
export const presentWritability = (
  config: BackendConfigDto | undefined,
): { label: string; tone: StatusTone } => {
  if (!config) return { label: "loading", tone: "unknown" };
  return config.writable === false
    ? { label: "read-through", tone: "warn" }
    : { label: "writable", tone: "ok" };
};

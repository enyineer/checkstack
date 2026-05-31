import type { ManifestEntry } from "@checkstack/script-packages-common";

/**
 * Pure delta computation for reconciliation: given the desired manifest and
 * the set of integrities already present in the local content-addressed
 * cache, return the integrities that must be pulled. Changing one package
 * in the allowlist ships exactly one blob, not a new full tree.
 */
export function computeMissingBlobs({
  manifest,
  localIntegrities,
}: {
  manifest: ManifestEntry[];
  localIntegrities: Iterable<string>;
}): ManifestEntry[] {
  const local = new Set(localIntegrities);
  const missing: ManifestEntry[] = [];
  const seen = new Set<string>();
  for (const entry of manifest) {
    if (local.has(entry.integrity)) continue;
    if (seen.has(entry.integrity)) continue;
    seen.add(entry.integrity);
    missing.push(entry);
  }
  return missing;
}

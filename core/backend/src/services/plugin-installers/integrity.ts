import { createHash } from "node:crypto";
import { z } from "zod";
import { PluginInstallError } from "./plugin-install-error";

/**
 * Plugin supply-chain integrity pinning.
 *
 * Every tarball we install is verified and pinned by a canonical SHA-256
 * digest of its raw bytes:
 *
 *  - npm: the registry metadata carries an SRI `dist.integrity`
 *    (`sha512-<base64>`); we recompute SHA-512 over the downloaded bytes and
 *    fail CLOSED on mismatch. When `integrity` is absent we fall back to the
 *    legacy `dist.shasum` (SHA-1, logged as a warning).
 *  - github: a release asset MAY expose a `digest` (`sha256:<hex>`); when
 *    present we verify the downloaded bytes against it.
 *
 * Regardless of source we ALWAYS compute the canonical SHA-256 digest and
 * persist it on the `plugins` row (`installedDigest`) so a later reload can
 * re-verify the artifact bytes have not been tampered with.
 *
 * All helpers here are pure (no network / fs) so they unit-test trivially.
 */

/** npm `dist` block we rely on for integrity. Parsed defensively with zod. */
export const npmDistSchema = z.object({
  tarball: z.string().url(),
  integrity: z.string().optional(),
  shasum: z.string().optional(),
});
export type NpmDist = z.infer<typeof npmDistSchema>;

/** npm version metadata document (only the fields we consume). */
export const npmVersionMetadataSchema = z.object({
  name: z.string(),
  version: z.string(),
  dist: npmDistSchema.optional(),
});

/** A single GitHub release asset (only fields we consume). `digest` is new-ish. */
export const githubReleaseAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string().url(),
  size: z.number(),
  /** e.g. `sha256:9f86d0...`. Optional: older assets / GHES may omit it. */
  digest: z.string().nullish(),
});

export const githubReleaseSchema = z.object({
  tag_name: z.string(),
  assets: z.array(githubReleaseAssetSchema),
});

/** Compute the canonical lower-case hex SHA-256 of raw bytes. */
export function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Compute the lower-case hex SHA-512 of raw bytes. */
export function computeSha512Hex(bytes: Uint8Array): string {
  return createHash("sha512").update(bytes).digest("hex");
}

/** Compute the lower-case hex SHA-1 of raw bytes (npm legacy `shasum`). */
export function computeSha1Hex(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * Parse a Subresource Integrity (SRI) string and return the SHA-512 entry as a
 * lower-case hex digest.
 *
 * SRI is a space-separated list of `<alg>-<base64>` tokens. npm publishes
 * `sha512-<base64>` (sometimes alongside weaker algorithms). We require an
 * sha512 entry and ignore the rest. Returns `undefined` when the string carries
 * no sha512 token (caller decides whether to fall back to `shasum`).
 */
export function parseSriSha512ToHex(sri: string): string | undefined {
  for (const token of sri.trim().split(/\s+/)) {
    const dash = token.indexOf("-");
    if (dash === -1) continue;
    const alg = token.slice(0, dash);
    const b64 = token.slice(dash + 1);
    if (alg !== "sha512" || b64.length === 0) continue;
    const buf = Buffer.from(b64, "base64");
    // A SHA-512 digest is 64 bytes; reject anything malformed rather than
    // silently comparing against a truncated value.
    if (buf.byteLength !== 64) {
      throw new PluginInstallError(
        "VALIDATION_FAILED",
        `Malformed sha512 SRI integrity value (decoded ${buf.byteLength} bytes, expected 64).`,
      );
    }
    return buf.toString("hex");
  }
  return undefined;
}

/**
 * Parse a GitHub asset `digest` of the form `sha256:<hex>`. Returns the
 * lower-case hex digest, or `undefined` when the value is absent / not a
 * sha256 digest we can verify.
 */
export function parseGithubSha256Digest(
  digest: string | null | undefined,
): string | undefined {
  if (!digest) return undefined;
  const colon = digest.indexOf(":");
  if (colon === -1) return undefined;
  const alg = digest.slice(0, colon);
  const hex = digest.slice(colon + 1).toLowerCase();
  if (alg !== "sha256") return undefined;
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new PluginInstallError(
      "VALIDATION_FAILED",
      `Malformed GitHub asset sha256 digest '${digest}'.`,
    );
  }
  return hex;
}

/**
 * Fail-closed integrity verification for an npm-downloaded tarball.
 *
 * Prefers the SRI `dist.integrity` (sha512). Falls back to the legacy
 * `dist.shasum` (sha1) with a warning. Throws `PluginInstallError` on mismatch
 * or when NO integrity material is present at all (we never install
 * unverifiable bytes from a registry).
 *
 * Returns the verification method used, for logging.
 */
export function verifyNpmTarballIntegrity({
  tarball,
  dist,
  packageRef,
  onWarn,
}: {
  tarball: Uint8Array;
  dist: NpmDist | undefined;
  packageRef: string;
  onWarn?: (message: string) => void;
}): { method: "sha512" | "sha1" } {
  const integrity = dist?.integrity?.trim();
  if (integrity) {
    const expected = parseSriSha512ToHex(integrity);
    if (expected) {
      const actual = computeSha512Hex(tarball);
      if (actual !== expected) {
        throw new PluginInstallError(
          "VALIDATION_FAILED",
          `Integrity check FAILED for '${packageRef}': the downloaded tarball's ` +
            `SHA-512 does not match the registry's dist.integrity. The bytes may ` +
            `have been tampered with in transit or by a compromised mirror. Refusing to install.`,
        );
      }
      return { method: "sha512" };
    }
    // `integrity` present but no sha512 token — fall through to shasum.
  }

  const shasum = dist?.shasum?.trim();
  if (shasum) {
    if (!/^[0-9a-f]{40}$/i.test(shasum)) {
      throw new PluginInstallError(
        "VALIDATION_FAILED",
        `Malformed dist.shasum '${shasum}' for '${packageRef}'.`,
      );
    }
    const actual = computeSha1Hex(tarball);
    if (actual !== shasum.toLowerCase()) {
      throw new PluginInstallError(
        "VALIDATION_FAILED",
        `Integrity check FAILED for '${packageRef}': the downloaded tarball's ` +
          `SHA-1 does not match the registry's dist.shasum. Refusing to install.`,
      );
    }
    onWarn?.(
      `Verified '${packageRef}' using the legacy SHA-1 dist.shasum; the registry ` +
        `did not provide a stronger dist.integrity (sha512) value.`,
    );
    return { method: "sha1" };
  }

  throw new PluginInstallError(
    "VALIDATION_FAILED",
    `Registry metadata for '${packageRef}' carries no integrity material ` +
      `(neither dist.integrity nor dist.shasum). Refusing to install unverifiable bytes.`,
  );
}

/**
 * Verify a GitHub-downloaded tarball against the asset's `digest` when present.
 * Always returns the computed canonical SHA-256 hex of the bytes; when a
 * `digest` was provided and does NOT match, throws `PluginInstallError`
 * (fail-closed). When no digest is present, records the SHA-256 without failing
 * (GitHub does not universally expose asset digests yet).
 */
export function verifyGithubTarballIntegrity({
  tarball,
  digest,
  assetName,
}: {
  tarball: Uint8Array;
  digest: string | null | undefined;
  assetName: string;
}): { sha256: string; verified: boolean } {
  const sha256 = computeSha256Hex(tarball);
  const expected = parseGithubSha256Digest(digest);
  if (!expected) {
    return { sha256, verified: false };
  }
  if (sha256 !== expected) {
    throw new PluginInstallError(
      "VALIDATION_FAILED",
      `Integrity check FAILED for release asset '${assetName}': the downloaded ` +
        `bytes' SHA-256 does not match the asset's published digest. Refusing to install.`,
    );
  }
  return { sha256, verified: true };
}

/**
 * Re-verify an artifact's recorded digest at reload time.
 *
 * Returns:
 *  - `"verified"`  — a digest was recorded AND matches the on-disk/store bytes.
 *  - `"backfill"`  — no digest was recorded (legacy install); caller should
 *                    record the freshly computed digest and proceed.
 *  - throws        — a digest WAS recorded but does NOT match (tamper); the
 *                    caller must refuse to load this plugin (fail-closed).
 */
export function verifyRecordedDigest({
  tarball,
  recordedDigest,
  pluginRef,
}: {
  tarball: Uint8Array;
  recordedDigest: string | null | undefined;
  pluginRef: string;
}): { outcome: "verified" | "backfill"; sha256: string } {
  const sha256 = computeSha256Hex(tarball);
  const recorded = recordedDigest?.trim();
  if (!recorded) {
    return { outcome: "backfill", sha256 };
  }
  if (sha256 !== recorded.toLowerCase()) {
    throw new PluginInstallError(
      "VALIDATION_FAILED",
      `Tamper detected for plugin '${pluginRef}': the stored artifact's SHA-256 ` +
        `(${sha256}) does not match the digest pinned at install time (${recorded}). ` +
        `Refusing to load this plugin.`,
    );
  }
  return { outcome: "verified", sha256 };
}

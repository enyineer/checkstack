import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  parseSriSha512ToHex,
  parseGithubSha256Digest,
  computeSha256Hex,
  computeSha512Hex,
  computeSha1Hex,
  verifyNpmTarballIntegrity,
  verifyGithubTarballIntegrity,
  verifyRecordedDigest,
} from "./integrity";
import { PluginInstallError } from "./plugin-install-error";

const bytes = new Uint8Array([1, 2, 3, 4, 5]);

function sriFor(b: Uint8Array): string {
  const digest = createHash("sha512").update(b).digest("base64");
  return `sha512-${digest}`;
}

describe("computeSha256Hex / computeSha512Hex / computeSha1Hex", () => {
  it("computes canonical lower-case hex digests", () => {
    expect(computeSha256Hex(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(computeSha512Hex(bytes)).toBe(
      createHash("sha512").update(bytes).digest("hex"),
    );
    expect(computeSha1Hex(bytes)).toBe(
      createHash("sha1").update(bytes).digest("hex"),
    );
  });
});

describe("parseSriSha512ToHex", () => {
  it("parses a sha512 SRI string to a 64-byte hex digest", () => {
    const sri = sriFor(bytes);
    const hex = parseSriSha512ToHex(sri);
    expect(hex).toBe(computeSha512Hex(bytes));
    expect(hex).toHaveLength(128);
  });

  it("picks the sha512 entry when multiple algorithms are present", () => {
    const sha256b64 = createHash("sha256").update(bytes).digest("base64");
    const sri = `sha256-${sha256b64} ${sriFor(bytes)}`;
    expect(parseSriSha512ToHex(sri)).toBe(computeSha512Hex(bytes));
  });

  it("returns undefined when no sha512 token is present", () => {
    const sha256b64 = createHash("sha256").update(bytes).digest("base64");
    expect(parseSriSha512ToHex(`sha256-${sha256b64}`)).toBeUndefined();
  });

  it("throws on a malformed (truncated) sha512 value", () => {
    expect(() => parseSriSha512ToHex("sha512-YWJj")).toThrow(PluginInstallError);
  });
});

describe("parseGithubSha256Digest", () => {
  it("parses a sha256:<hex> digest", () => {
    const hex = computeSha256Hex(bytes);
    expect(parseGithubSha256Digest(`sha256:${hex}`)).toBe(hex);
  });

  it("uppercases hex are normalized to lower-case", () => {
    const hex = computeSha256Hex(bytes);
    expect(parseGithubSha256Digest(`sha256:${hex.toUpperCase()}`)).toBe(hex);
  });

  it("returns undefined for absent / non-sha256 digests", () => {
    expect(parseGithubSha256Digest(undefined)).toBeUndefined();
    expect(parseGithubSha256Digest(null)).toBeUndefined();
    expect(parseGithubSha256Digest("sha1:abcd")).toBeUndefined();
    expect(parseGithubSha256Digest("nocolon")).toBeUndefined();
  });

  it("throws on a malformed sha256 hex", () => {
    expect(() => parseGithubSha256Digest("sha256:nothex")).toThrow(
      PluginInstallError,
    );
  });
});

describe("verifyNpmTarballIntegrity", () => {
  it("passes when sha512 integrity matches (preferred)", () => {
    const result = verifyNpmTarballIntegrity({
      tarball: bytes,
      dist: { tarball: "https://x/y.tgz", integrity: sriFor(bytes) },
      packageRef: "pkg@1.0.0",
    });
    expect(result.method).toBe("sha512");
  });

  it("FAILS CLOSED on sha512 mismatch", () => {
    const wrong = sriFor(new Uint8Array([9, 9, 9]));
    expect(() =>
      verifyNpmTarballIntegrity({
        tarball: bytes,
        dist: { tarball: "https://x/y.tgz", integrity: wrong },
        packageRef: "pkg@1.0.0",
      }),
    ).toThrow(/Integrity check FAILED/);
  });

  it("falls back to sha1 shasum with a warning when integrity is absent", () => {
    const warnings: string[] = [];
    const result = verifyNpmTarballIntegrity({
      tarball: bytes,
      dist: { tarball: "https://x/y.tgz", shasum: computeSha1Hex(bytes) },
      packageRef: "pkg@1.0.0",
      onWarn: (m) => warnings.push(m),
    });
    expect(result.method).toBe("sha1");
    expect(warnings).toHaveLength(1);
  });

  it("FAILS CLOSED on sha1 shasum mismatch", () => {
    expect(() =>
      verifyNpmTarballIntegrity({
        tarball: bytes,
        dist: { tarball: "https://x/y.tgz", shasum: computeSha1Hex(new Uint8Array([7])) },
        packageRef: "pkg@1.0.0",
      }),
    ).toThrow(/Integrity check FAILED/);
  });

  it("FAILS CLOSED when no integrity material is present at all", () => {
    expect(() =>
      verifyNpmTarballIntegrity({
        tarball: bytes,
        dist: { tarball: "https://x/y.tgz" },
        packageRef: "pkg@1.0.0",
      }),
    ).toThrow(/no integrity material/);
  });
});

describe("verifyGithubTarballIntegrity", () => {
  it("verifies and reports verified=true when digest matches", () => {
    const sha = computeSha256Hex(bytes);
    const r = verifyGithubTarballIntegrity({
      tarball: bytes,
      digest: `sha256:${sha}`,
      assetName: "x.tgz",
    });
    expect(r).toEqual({ sha256: sha, verified: true });
  });

  it("records sha256 with verified=false when no digest is provided", () => {
    const r = verifyGithubTarballIntegrity({
      tarball: bytes,
      digest: null,
      assetName: "x.tgz",
    });
    expect(r.sha256).toBe(computeSha256Hex(bytes));
    expect(r.verified).toBe(false);
  });

  it("FAILS CLOSED on digest mismatch", () => {
    const wrong = computeSha256Hex(new Uint8Array([0]));
    expect(() =>
      verifyGithubTarballIntegrity({
        tarball: bytes,
        digest: `sha256:${wrong}`,
        assetName: "x.tgz",
      }),
    ).toThrow(/Integrity check FAILED/);
  });
});

describe("verifyRecordedDigest", () => {
  it("returns verified when the recorded digest matches", () => {
    const sha = computeSha256Hex(bytes);
    expect(
      verifyRecordedDigest({ tarball: bytes, recordedDigest: sha, pluginRef: "p" }),
    ).toEqual({ outcome: "verified", sha256: sha });
  });

  it("returns backfill when no digest was recorded", () => {
    const r = verifyRecordedDigest({
      tarball: bytes,
      recordedDigest: null,
      pluginRef: "p",
    });
    expect(r.outcome).toBe("backfill");
    expect(r.sha256).toBe(computeSha256Hex(bytes));
  });

  it("FAILS CLOSED (throws tamper) on a recorded-digest mismatch", () => {
    expect(() =>
      verifyRecordedDigest({
        tarball: bytes,
        recordedDigest: computeSha256Hex(new Uint8Array([42])),
        pluginRef: "evil-plugin",
      }),
    ).toThrow(/Tamper detected/);
  });
});

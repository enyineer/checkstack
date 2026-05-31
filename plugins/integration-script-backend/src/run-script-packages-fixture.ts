/**
 * Hermetic test fixture for the script-packages import e2e.
 *
 * `LEFTPAD_CACHE_BLOB_BASE64` is a base64-encoded gzip-tar of a real Bun
 * cache entry for `leftpad@0.0.1` (the entry dir `leftpad@0.0.1@@@1` produced
 * by `bun install` against the default registry). It is the SAME shape of
 * blob the central resolver publishes, so feeding it to the reconcile path
 * lets the FULL resolve->reconcile->materialize->import-through-execute()
 * pipeline run with ZERO network access in CI.
 *
 * To regenerate (only needed if the offline reconstruct breaks on a future
 * Bun major):
 *
 *   mkdir /tmp/cap && cd /tmp/cap
 *   printf '{"name":"c","private":true,"dependencies":{"leftpad":"0.0.1"}}' > package.json
 *   printf '[install]\nauto = "disable"\n' > bunfig.toml
 *   BUN_INSTALL_CACHE_DIR=/tmp/cap/cache bun install
 *   tar -czf /tmp/cap/blob.tgz -C /tmp/cap/cache 'leftpad@0.0.1@@@1'
 *   base64 -i /tmp/cap/blob.tgz | tr -d '\n'
 *
 * leftpad@0.0.1 is a 2-file, dependency-free, pure-JS package, so the blob is
 * tiny (~2 KB) and stable.
 */
export const LEFTPAD_CACHE_BLOB_BASE64 =
  "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";

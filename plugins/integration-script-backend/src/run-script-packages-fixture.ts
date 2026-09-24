/**
 * Hermetic test fixture for the script-packages import e2e.
 *
 * `LEFTPAD_CACHE_BLOB_BASE64` is a base64-encoded gzip-tar of a real Bun
 * cache entry for `leftpad@0.0.1` (the entry dir `leftpad@0.0.1@@@1` produced
 * by `bun install` against the default registry) PLUS Bun's registry
 * manifest-cache sidecar (`<hash>.npm` at the cache root). Since Bun 1.4,
 * `bun install --offline` resolves versions from that sidecar, so a blob
 * with only the extracted entry dir fails with "no cached manifest" - the
 * same sidecar the resolver now packs into every published blob. The blob is
 * the SAME shape of blob the central resolver publishes, so feeding it to
 * the reconcile path lets the FULL resolve->reconcile->materialize->
 * import-through-execute() pipeline run with ZERO network access in CI.
 *
 * To regenerate (only needed if the offline reconstruct breaks on a future
 * Bun major):
 *
 *   mkdir /tmp/cap && cd /tmp/cap
 *   printf '{"name":"c","private":true,"dependencies":{"leftpad":"0.0.1"}}' > package.json
 *   printf '[install]\nauto = "disable"\n' > bunfig.toml
 *   BUN_INSTALL_CACHE_DIR=/tmp/cap/cache bun install
 *   tar -czf /tmp/cap/blob.tgz -C /tmp/cap/cache 'leftpad@0.0.1@@@1' *.npm
 *   base64 -i /tmp/cap/blob.tgz | tr -d '\n'
 *
 * leftpad@0.0.1 is a 2-file, dependency-free, pure-JS package, so the blob is
 * tiny (~4 KB) and stable.
 */
export const LEFTPAD_CACHE_BLOB_BASE64 =
  "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";

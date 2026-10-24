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

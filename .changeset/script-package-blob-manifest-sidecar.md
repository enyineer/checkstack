---
"@checkstack/script-packages-backend": patch
"@checkstack/integration-script-backend": patch
---

Fix offline reconstruction of published script-package blobs on Bun >= 1.4. Bun now resolves `bun install --offline` versions from registry manifest-cache sidecars (`<hash>.npm` in the cache root); blobs containing only the extracted package entry failed with "no cached manifest". The central resolver now packs the package's manifest-cache sidecar into each blob (discovered by content, gracefully absent on older Bun), and the hermetic e2e fixture was regenerated in the same shape.

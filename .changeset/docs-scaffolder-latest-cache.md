---
"@checkstack/ai-backend": patch
---

Refresh the bundled docs search index (`ai.searchDocs` / `ai.getDoc`) for the
updated plugin-authoring documentation: one-off `bunx` examples now pin
`@latest`, committed `pack` scripts use the installed `checkstack-scripts` bin,
and a new "Keep the tooling current" section documents Bun's scaffolder cache
behaviour (latest re-resolved per run within the ~5 min registry-manifest
window; tarballs content-addressed by version). Cutting this release also
rebuilds the Docker image, so the bundled in-app docs served at `/checkstack/*`
pick up the changes.

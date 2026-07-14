---
"@checkstack/scripts": patch
---

Pin `@module-federation/vite` to 1.16.15 in the scaffolded plugin frontend
template. The template's `^1.16` range floats to the newest release at
install time (a scaffolded workspace has no lockfile and, unlike this repo,
no minimum-release-age cooldown), and upstream 1.17.1 - published 80 minutes
before it broke CI - regressed named-export detection for `import: false`
shared subpaths (`@checkstack/ui/code-editor`), failing every scaffolded
frontend build with MISSING_EXPORT "CodeEditor". Verified against the full
external-plugin lifecycle: 1.16.15/1.16.16/1.17.0 pass, 1.17.1 fails. The
exact pin makes scaffolded builds deterministic; bump it deliberately once
upstream ships a fix (Renovate does not manage the `.hbs` templates).

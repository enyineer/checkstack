---
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Refresh `bun.lock` to the newest versions permitted by the existing semver
ranges (Renovate lock-file maintenance). No `package.json` range changed, so
this only affects the resolutions baked into the production image.

Updated dependencies:

- `@floating-ui/core` 1.7.5 -> 1.8.0
- `@floating-ui/dom` 1.7.6 -> 1.8.0
- `@floating-ui/react-dom` 2.1.8 -> 2.1.9
- `@floating-ui/utils` 0.2.11 -> 0.2.12
- `dompurify` 3.4.11 -> 3.4.12
- `fast-xml-builder` 1.2.1 -> 1.3.0
- `fast-xml-parser` 5.9.3 -> 5.10.0
- `is-unsafe` 1.0.1 -> 2.0.0
- `xml-naming` 0.1.0 -> 0.3.0

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
- `@oxc-resolver/binding-android-arm-eabi` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-android-arm64` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-darwin-arm64` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-darwin-x64` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-freebsd-x64` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-arm-gnueabihf` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-arm-musleabihf` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-arm64-gnu` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-arm64-musl` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-ppc64-gnu` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-riscv64-gnu` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-riscv64-musl` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-s390x-gnu` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-x64-gnu` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-linux-x64-musl` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-openharmony-arm64` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-wasm32-wasi` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-win32-arm64-msvc` 11.23.0 -> 11.24.1
- `@oxc-resolver/binding-win32-x64-msvc` 11.23.0 -> 11.24.1
- `baseline-browser-mapping` 2.10.42 -> 2.10.43
- `browserslist` 4.28.5 -> 4.28.6
- `bullmq` 5.80.1 -> 5.80.2
- `caniuse-lite` 1.0.30001803 -> 1.0.30001805
- `dompurify` 3.4.11 -> 3.4.12
- `es-module-lexer` 2.3.0 -> 2.3.1
- `fast-xml-builder` 1.2.1 -> 1.3.0
- `fast-xml-parser` 5.9.3 -> 5.10.0
- `is-unsafe` 1.0.1 -> 2.0.0
- `ldapts` 8.1.8 -> 8.2.0
- `nanoid` 3.3.15 -> 3.3.16
- `oxc-resolver` 11.23.0 -> 11.24.1
- `postcss` 8.5.16 -> 8.5.17
- `svgo` 4.0.1 -> 4.0.2
- `tar` 7.5.19 -> 7.5.20
- `xml-naming` 0.1.0 -> 0.3.0

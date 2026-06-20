---
title: "Plugin Distribution & Packing"
description: "This guide is for plugin authors - anyone publishing a Checkstack plugin that operators install via the runtime Plugin Manager UI. It covers the required package.json shape, how to pack with the @c…"
---

This guide is for **plugin authors** - anyone publishing a Checkstack plugin
that operators install via the runtime Plugin Manager UI. It covers the
required `package.json` shape, how to pack with the
`@checkstack/scripts plugin-pack` CLI, single-package vs bundle mode, and
release workflow patterns for npm, GitHub, and direct tarball delivery.

If you only want to *consume* a plugin as a platform operator, see
[Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) for
the Plugin Manager UI walkthrough.

> **Looking for the dev loop?** This doc covers the *distribution
> mechanics* (packing, bundles, channels). For local development - add
> `@checkstack/dev-server` as a devDependency, wire `"dev": "checkstack-dev"`
> into your `package.json` scripts, and run `bun run dev` - see
> [Developing Plugins in Isolation](/checkstack/developer-guide/getting-started/plugin-development/).

> **Distinction:** monorepo-internal plugins (the ones living in `core/` and
> `plugins/` of this repo) are loaded automatically at boot via filesystem
> discovery. Everything below is about plugins that ship **independently**
> via npm / GitHub release / tarball upload - the mechanism the runtime
> Plugin Manager uses.

## Anatomy of an installable plugin

Every installable plugin is just an npm package whose `package.json` declares
a `checkstack` block. The platform's install pipeline validates this block
(plus a few standard fields) on every install.

### Required `package.json` fields

| Field                     | Source                | Notes                                                                                       |
|---------------------------|-----------------------|---------------------------------------------------------------------------------------------|
| `name`                    | standard              | Must be the npm package name. Scoped names (`@org/foo`) are fine.                            |
| `version`                 | standard              | A valid semver string. Used for compatibility checks.                                       |
| `description`             | standard              | One-line summary shown in the install confirmation modal.                                   |
| `author`                  | standard              | String (`"Jane <jane@example.com>"`) or object (`{ name, email?, url? }`).                  |
| `license`                 | standard              | Any SPDX identifier (or `SEE LICENSE IN ...`).                                              |
| `checkstack.type`         | Checkstack            | One of `"backend"`, `"frontend"`, `"common"`.                                                |
| `checkstack.pluginId`     | Checkstack            | Stable runtime id (e.g. `"healthcheck-http"`). Must match `pluginId` in `plugin-metadata.ts`.|

### Optional fields

| Field                              | Notes                                                                                              |
|------------------------------------|----------------------------------------------------------------------------------------------------|
| `homepage`                         | Linked from the install confirmation modal.                                                        |
| `repository`                       | Standard `repository` form. Surfaced in the admin UI for the operator's reference.                 |
| `checkstack.bundle`                | Array of sibling package names that install/uninstall atomically with this one. Set on the **primary** package only. |
| `checkstack.usageInstructions`     | Markdown string shown in the install confirmation modal. Use it to describe required env vars, config, integrations, etc. |
| `checkstack.allowInstallScripts`   | Default `false`. When `true`, the platform runs `bun install` *without* `--ignore-scripts`. Surfaces in the security warning. Use sparingly - it's the loudest dial-up of trust requirements during install. |

A minimal valid package.json:

```json
{
  "name": "@my-org/widget-backend",
  "version": "1.2.3",
  "description": "Widget tracker for Checkstack",
  "author": "ACME Corp",
  "license": "MIT",
  "checkstack": {
    "type": "backend",
    "pluginId": "widget"
  },
  "devDependencies": {
    "@checkstack/scripts": "^0.4.0"
  },
  "scripts": {
    "pack": "checkstack-scripts plugin-pack"
  }
}
```

The `pack` script is the single supported entrypoint. It calls the
`checkstack-scripts` bin from the `@checkstack/scripts` devDependency (resolved
from `node_modules/.bin`), so a committed script always runs the pinned version
- not a cache-resolved "latest". Do not call `bun pm pack` directly -
`plugin-pack` validates metadata before packing, catching issues at build time
instead of install time.

## The `plugin-pack` CLI

For a one-off run without installing, use `bunx` with an explicit `@latest` so
Bun does not execute a stale cached copy:

```bash
bunx @checkstack/scripts@latest plugin-pack --help
```

```text
Usage: checkstack-scripts plugin-pack [options]

Options:
  --bundle           Pack the primary plus every sibling declared in
                     package.json#checkstack.bundle into a single outer
                     tarball with a bundle.json manifest.
  --out-dir <dir>    Output directory (default: ./dist)
  --validate-only    Only validate metadata; do not pack.
  --cwd <dir>        Run as if invoked from <dir> (default: process.cwd())
  --help, -h         Show this message.
```

### What it does (in order)

1. Reads `<cwd>/package.json` and validates it against
   `installPackageMetadataSchema` - the same Zod schema the runtime install
   pipeline uses. Failures are reported with the specific field path so you
   know exactly what to fix.
2. Runs `bun run typecheck` and `bun run lint` if those scripts exist.
   Mirrors what CI does - catches type/lint regressions before packing.
3. Resolves any `workspace:*` dependency ranges to concrete versions read
   from sibling `package.json`s. If you publish from a workspace, **never**
   ship `workspace:*` to npm - `plugin-pack` rewrites them at pack time and
   restores your source on disk afterward, so your dev tree is unchanged.
4. Calls `bun pm pack --destination <out-dir>` to produce the tarball.
5. (Bundle mode only) Wraps the per-package tarballs in an outer
   `<name>-<version>-bundle.tgz` with a `bundle.json` manifest.

### Two output modes

**Per-package mode** (default - what you publish to npm):

```bash
cd packages/widget-backend
bun run pack
# → dist/my-org-widget-backend-1.2.3.tgz
```

**Bundle mode** (what you attach to a GitHub release or upload via the
Plugin Manager UI):

```bash
cd packages/widget-backend  # the *primary* — the one with checkstack.bundle
bun run pack -- --bundle
# → dist/my-org-widget-backend-1.2.3-bundle.tgz
```

Bundle tarballs are **never** published to npm. npm always gets the
per-package `.tgz`s individually.

## Multi-package plugins (bundles)

A "plugin" the operator installs may consist of several npm packages - the
classic example is a backend (`-backend`), a frontend (`-frontend`), and a
shared types package (`-common`). The platform installs and uninstalls
all of them atomically.

### Declaring a bundle

Pick one package as the **primary** (typically `-backend`) and add a
`checkstack.bundle` array listing the sibling package names:

```json
// my-org-widget-backend/package.json
{
  "name": "@my-org/widget-backend",
  "version": "1.2.3",
  "checkstack": {
    "type": "backend",
    "pluginId": "widget",
    "bundle": [
      "@my-org/widget-common",
      "@my-org/widget-frontend"
    ]
  }
}
```

Siblings should NOT carry `checkstack.bundle` - only the primary does.
Siblings can still ship the same `pluginId` if they're part of the same
logical plugin.

### Versioning rule

All siblings in a bundle **must share the same `version`** at pack time.
The compatibility checker resolves bundle-internal `@checkstack/*`
dependencies against the bundle's package set first, falling back to the
platform's loaded versions only when the dep isn't part of the bundle.
Mismatched sibling versions will fail the install with a clear message.

Use changesets or a release tool that bumps siblings in lockstep.

### Installing bundles via npm

For npm distribution, **publish each sibling separately** as a normal npm
package. The platform installs the primary by name; on `previewInstall`,
the runtime resolves each sibling from `checkstack.bundle` against the same
registry and pins to the primary's exact version. The Plugin Manager UI
shows the full list before the operator confirms.

```bash
# In CI, publish each sibling
cd packages/widget-common && bun publish --access public
cd packages/widget-backend && bun publish --access public
cd packages/widget-frontend && bun publish --access public
```

### Distributing bundles via GitHub release or tarball upload

For GitHub or direct upload, use **bundle mode** to produce a single outer
tarball that contains every sibling and a manifest:

```bash
bun run pack -- --bundle
```

The result has this layout:

```text
my-org-widget-backend-1.2.3-bundle.tgz
├── bundle.json                                 # manifest
└── packages/
    ├── my-org-widget-common-1.2.3.tgz
    ├── my-org-widget-backend-1.2.3.tgz
    └── my-org-widget-frontend-1.2.3.tgz
```

`bundle.json`:

```json
{
  "bundleVersion": 1,
  "primary": "@my-org/widget-backend",
  "packages": [
    { "name": "@my-org/widget-backend", "version": "1.2.3",
      "tarball": "packages/my-org-widget-backend-1.2.3.tgz" },
    { "name": "@my-org/widget-common", "version": "1.2.3",
      "tarball": "packages/my-org-widget-common-1.2.3.tgz" },
    { "name": "@my-org/widget-frontend", "version": "1.2.3",
      "tarball": "packages/my-org-widget-frontend-1.2.3.tgz" }
  ]
}
```

Attach this single tarball to your GitHub release; the platform unpacks
all siblings on install.

## Compatibility (no manual declaration needed)

You do **not** declare a "compatible Checkstack version" anywhere. The
platform reads the semver ranges in your plugin's `dependencies` block and
checks each `@checkstack/*` entry with `semver.satisfies` against the
loaded core packages.

```jsonc
{
  "dependencies": {
    "@checkstack/backend-api": "^0.20.0",  // → must match what's loaded
    "@checkstack/widget-common": "^0.1.0", // → resolved from bundle if present
    "lodash": "^4.0.0"                     // → ignored (not @checkstack/*)
  }
}
```

If the platform has `@checkstack/backend-api@2.0.0` loaded but your plugin
declared `^1.0.0`, install fails with a `BAD_REQUEST` and the message
`"Plugin '...' requires @checkstack/backend-api@^1.0.0 but this platform
has 2.0.0."`

`workspace:*` ranges are explicitly rejected by the runtime - they're a
pack-time-only construct. The `plugin-pack` CLI resolves them
automatically.

## Distribution channels

| Channel              | Best for                                    | Pack mode      |
|----------------------|---------------------------------------------|----------------|
| npm (public)         | Community plugins; broad discoverability     | per-package    |
| npm (private)        | Org-internal plugins behind an npm registry  | per-package    |
| GitHub release       | Plugins not published to npm; signed artifacts | `--bundle`   |
| GitHub Enterprise    | Air-gapped / private GHE deployments         | `--bundle`     |
| Tarball upload (UI)  | Local dev; one-off testing                   | per-package or `--bundle` |

### npm

Publish per-package as you would any npm library. The platform's npm
installer hits the registry's metadata endpoint
(`<registry>/<package>/<version>`), downloads the `dist.tarball` URL, verifies
the bytes against the registry's `dist.integrity` (SHA-512 SRI) before
accepting them, and stores the bytes in Postgres. Configurable per-source via
`PluginSource.registry` so deployments behind a private registry (Verdaccio,
JFrog, GitHub Packages, …) work without env-var twiddling.

### GitHub releases

Convention: each release tag has **exactly one** `.tgz` asset (the bundle
tarball produced by `plugin-pack --bundle`). The platform fetches via the
GitHub API, downloads the asset, validates, and stores.

For repos with multiple `.tgz` assets, the install source carries an
optional `assetName` field - the Plugin Manager UI exposes this.

### GitHub Enterprise

Three additional fields on the install source:

| Source field   | Meaning                                                                        |
|----------------|--------------------------------------------------------------------------------|
| `apiBaseUrl`   | Your GHE API root, e.g. `https://github.example.com/api/v3`. Defaults to public github.com when omitted. |
| `tokenEnvVar`  | Name of the env var on the platform that holds the PAT. Defaults to `GITHUB_TOKEN`. |

Multiple GitHub instances in the same deployment? Set different
`tokenEnvVar` values per source - e.g. `GITHUB_TOKEN_PUBLIC`,
`GITHUB_TOKEN_GHE`.

### Tarball upload (Plugin Manager UI)

Operators can drag-and-drop a `.tgz` directly. The platform:
1. Stores the bytes in `plugin_artifacts` and returns an `artifactId`.
2. Treats it the same as a GitHub-release source - peek the package.json or
   `bundle.json`, validate, install.

Useful for local development where you don't want to push to a registry.
The 50MB tarball cap applies to all sources.

## Recommended release workflow (GitHub Actions)

A copy-paste starting point lives at
[`plugin-release.yml`](/checkstack/examples/plugin-release.yml). The
short version:

```yaml
name: Release Plugin
on:
  push:
    tags: ["v*.*.*"]
permissions:
  contents: write   # to upload release assets
  id-token: write   # for npm provenance
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: bunx @checkstack/scripts@latest plugin-pack --bundle
      - name: Attach bundle to release
        uses: softprops/action-gh-release@v2
        with:
          files: dist/*-bundle.tgz
      # Optional: publish per-package to npm in a matrix
      # - run: cd packages/widget-backend && bun publish --access public
      #   env:
      #     NPM_CONFIG_TOKEN: ${{ secrets.NPM_TOKEN }}
```

For per-package npm publish, run `bun publish --access public` in each
sibling directory. Don't run `bun publish` on the bundle tarball - npm
won't accept it.

## CI-friendly metadata validation

Lint your `package.json` against the install-time schema in your own CI,
without pack:

```bash
bunx @checkstack/scripts@latest plugin-pack --validate-only
```

Returns non-zero on any schema violation with a per-field error list. We
run this in our own publish script before each `bun publish` - 
[`scripts/publish-packages.ts`](https://github.com/enyineer/checkstack/blob/main/scripts/publish-packages.ts)
is a working reference if you want to mirror the pattern.

## Security model

Plugins run **in-process with full platform access** - same Bun event
loop, same database connection, same secrets. The platform's defenses are:

1. **Strong typed-confirmation modal** - operator types the exact plugin
   name to install. No "click OK" muscle-memory bypass.
2. **`bun install --ignore-scripts`** - postinstall scripts in the plugin
   and its transitive deps don't execute. Opt out per-plugin via
   `checkstack.allowInstallScripts: true`; this surfaces in the security
   warning so the operator sees it.
3. **Source disclosure** - the install modal shows source type
   (npm/github/tarball), the package name + version, the author, license,
   homepage, and any compatibility issues before commit.
4. **Bundle atomicity** - partial installs aren't possible; if any sibling
   fails validation, none commit.
5. **Integrity pinning (fail-closed)** - every downloaded artifact is verified
   against a source-provided digest before it is installed, and a canonical
   SHA-256 of the tarball bytes is pinned to the plugin's row and re-verified on
   every reload. See [Integrity verification](#integrity-verification) below.

The platform does **not** sandbox plugin code (process isolation, V8
contexts, etc. - see the design doc for why). Operators should only install
plugins from trusted authors. Plugin authors should make their distribution
channels easy to audit (signed tags, reproducible builds, public source).

### Integrity verification

The install pipeline verifies the bytes it downloads and pins them so later
reloads can detect tampering. This is fail-closed: a verification failure aborts
the install (or refuses to load the plugin), it never silently proceeds.

**At install time**, verification depends on the source:

- **npm** - the registry version metadata carries a Subresource Integrity (SRI)
  value `dist.integrity` of the form `sha512-<base64>`. The platform recomputes
  the SHA-512 of the downloaded tarball and refuses to install on mismatch. When
  a registry only exposes the legacy `dist.shasum` (SHA-1), it falls back to
  that with a logged warning. If a registry provides neither, the install is
  refused rather than installing unverifiable bytes.
- **GitHub release** - when the release asset exposes a `digest`
  (`sha256:<hex>`), the downloaded bytes are verified against it (fail-closed on
  mismatch). GitHub does not yet expose asset digests universally, so when it is
  absent the platform records the computed SHA-256 without failing.
- **Tarball upload** - the operator-provided bytes are stored and pinned as-is;
  there is no external digest to compare against, so the pin established here is
  what protects subsequent reloads.

**Pinning.** Regardless of source, the canonical lower-case hex SHA-256 of the
artifact tarball is written to the plugin's `plugins.installed_digest` column at
install time (it equals the artifact store's `content_hash`). Because it lives
in shared Postgres, every pod reads the same pinned value.

**At reload / bootstrap time**, when a freshly spun pod (or an install
broadcast) re-hydrates a plugin from `plugin_artifacts`, the platform re-hashes
the stored tarball bytes and compares to the pinned digest:

- **Match** - the plugin loads normally.
- **Mismatch** - tamper is assumed; that plugin is refused (fail-closed) and the
  failure is logged, but the rest of the platform continues to boot.
- **No pinned digest** (a plugin installed before integrity pinning existed) -
  the digest is backfilled from the current bytes and the plugin loads. The
  `installed_digest` column is nullable precisely so these legacy rows keep
  working; a missing value means "not yet pinned", not "fail".

> [!NOTE]
> This is integrity *pinning*, not author *trust*. It guarantees the bytes you
> install are the bytes the source published and have not changed since, but it
> does not by itself prove the publisher is who they claim to be. Cryptographic
> signature verification against a trust store is a separate, future layer.

## See also

- [Developing Plugins in Isolation](/checkstack/developer-guide/getting-started/plugin-development/) - 
  running Checkstack locally to develop your plugin, iteration patterns
- [Plugin Architecture Overview](/checkstack/developer-guide/architecture/plugin-system/) - how plugins fit
  into Checkstack at runtime
- [Backend Plugin Development](/checkstack/developer-guide/backend/plugins/) - writing the
  `-backend` package
- [Frontend Plugin Development](/checkstack/developer-guide/frontend/plugins/) - writing the
  `-frontend` package
- [`plugin-release.yml`](/checkstack/examples/plugin-release.yml) - 
  GitHub Actions release workflow template

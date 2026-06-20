---
title: "Dependency Architecture Linter"
description: "This document explains the dependency validation system that enforces clean architecture rules."
---

This document explains the dependency validation system that enforces clean architecture rules.

## Overview

The project uses a custom validation script (`scripts/validate-dependencies.ts`) that runs as part of the linting process to ensure all packages follow the dependency architecture rules.

## Architecture Rules

The linter enforces these strict dependency rules:

| Package Type     | Can Depend On                              |
|------------------|--------------------------------------------|
| Common plugins   | Common plugins ONLY                        |
| Frontend plugins | Frontend plugins OR common plugins         |
| Backend plugins  | Backend plugins OR common plugins          |
| Core packages    | Common packages (minimal dependencies)     |

## How It Works

### Package Type Detection

The script automatically detects package types based on naming conventions:

- **Common**: Packages ending with `-common` or named `@checkstack/common`
- **Frontend**: Packages ending with `-frontend`, `-frontend-plugin`, or starting with `@checkstack/frontend` or `@checkstack/ui`
- **Backend**: Packages ending with `-backend`, `-backend-plugin`, or starting with `@checkstack/backend`
- **Core**: The `@checkstack/common` package
- **External**: Non-`@checkstack/*` packages (always allowed)

### Validation Process

1. Scans all packages in `core/*` and `plugins/*` directories
2. Reads each `package.json` file
3. Checks `dependencies` and `peerDependencies`
4. Validates each internal dependency against the architecture rules
5. Reports violations and exits with error code 1 if any are found

## Running the Linter

### As Part of Lint

The dependency validation runs automatically with the regular linting:

```bash
bun run lint
```

This command runs:
1. `bun run lint:code` - ESLint for code quality
2. `bun run lint:deps` - Dependency architecture validation

### Standalone

You can run just the dependency validation:

```bash
bun run lint:deps
```

Or directly:

```bash
bun run scripts/validate-dependencies.ts
```

## Example Violations

### Violation: Common Depending on Backend

```json
{
  "name": "@checkstack/catalog-common",
  "dependencies": {
    "@checkstack/backend-api": "workspace:*"  // ❌ VIOLATION
  }
}
```

**Error:**
```text
❌ Dependency Architecture Violations Found:

  @checkstack/catalog-common
    → depends on @checkstack/backend-api
    → common packages cannot depend on backend packages
```

**Fix:** Depend on `@checkstack/common` instead:
```json
{
  "name": "@checkstack/catalog-common",
  "dependencies": {
    "@checkstack/common": "workspace:*"  // ✅ OK
  }
}
```

### Violation: Frontend Depending on Backend

```json
{
  "name": "@checkstack/catalog-frontend-plugin",
  "dependencies": {
    "@checkstack/catalog-backend-plugin": "workspace:*"  // ❌ VIOLATION
  }
}
```

**Error:**
```text
❌ Dependency Architecture Violations Found:

  @checkstack/catalog-frontend-plugin
    → depends on @checkstack/catalog-backend-plugin
    → frontend packages cannot depend on backend packages
```

**Fix:** Depend on common package instead:
```json
{
  "name": "@checkstack/catalog-frontend-plugin",
  "dependencies": {
    "@checkstack/catalog-common": "workspace:*"  // ✅ OK
  }
}
```

## Allowed Dependencies

### ✅ Common → Common
```json
{
  "name": "@checkstack/catalog-common",
  "dependencies": {
    "@checkstack/common": "workspace:*"
  }
}
```

### ✅ Frontend → Frontend or Common
```json
{
  "name": "@checkstack/catalog-frontend-plugin",
  "dependencies": {
    "@checkstack/frontend-api": "workspace:*",
    "@checkstack/catalog-common": "workspace:*",
    "@checkstack/ui": "workspace:*"
  }
}
```

### ✅ Backend → Backend or Common
```json
{
  "name": "@checkstack/catalog-backend-plugin",
  "dependencies": {
    "@checkstack/backend-api": "workspace:*",
    "@checkstack/catalog-common": "workspace:*"
  }
}
```

### ✅ External Dependencies

All packages can depend on external (non-`@checkstack/*`) packages:
```json
{
  "name": "@checkstack/catalog-common",
  "dependencies": {
    "zod": "^4.2.1",
    "react": "^18.2.0"
  }
}
```

## CI/CD Integration

The lint check runs in CI/CD pipelines. If dependency violations are detected, the build will fail, preventing broken architectures from being merged.

## Benefits

1. **Enforces Clean Architecture**: Prevents runtime-specific code from leaking into shared packages
2. **Prevents Circular Dependencies**: Type system issues are caught early
3. **Maintains Separation of Concerns**: Frontend, backend, and common code stay properly isolated
4. **Fail Fast**: Violations are caught during development, not deployment
5. **Clear Error Messages**: Developers immediately know what's wrong and how to fix it

## Troubleshooting

### False Positives

If you have a package that doesn't follow naming conventions, it will be treated as "unknown" and won't be validated. To fix this:

1. Update the package name to follow conventions
2. Or update `getPackageType()` in `scripts/validate-dependencies.ts` to recognize your package

### Adding New Package Types

To add support for new package types (e.g., `*-node`, `*-react`):

1. Add the type to `PackageType` union in the script
2. Update `getPackageType()` to recognize the pattern
3. Add validation rules in `isDependencyAllowed()`

## Version alignment (syncpack)

The architecture linter above governs *which* internal packages may depend on
each other. A separate check governs *which version range* a shared external
dependency is declared at across the workspace, so the same dependency does not
drift to several ranges in different `package.json` files. (A past regression
declared `react-router-dom` at four ranges, which resolved two router majors
into one bundle.)

This is enforced with [syncpack](https://syncpack.dev/) and configured in
[`.syncpackrc.json`](https://github.com/enyineer/checkstack/blob/main/.syncpackrc.json).
The enforced set is deliberately narrow: only the externally-shared runtime and
tooling packages that were unified are required to match. Everything else
(workspace `@checkstack/*` ranges, intentionally loose dev types like
`@types/bun: latest`, and dependencies whose cross-major upgrade is deferred to
its own issue) is ignored so the check does not churn on deliberate variance.

```bash
bun run deps:check   # syncpack lint - fails if an enforced dep diverges
bun run deps:fix     # auto-align mismatches, then run `bun install`
```

The check runs in CI as the **Deps** job in
[`pr-checks.yml`](https://github.com/enyineer/checkstack/blob/main/.github/workflows/pr-checks.yml).
To widen enforcement to another dependency, add its name to the first version
group in `.syncpackrc.json`.

## See also

- [Security maintenance](/checkstack/developer-guide/tooling/security-maintenance/) - the daily workflow that range-bumps vulnerable shared deps in lockstep across the workspace (keeping this check green) and audits the managed-override manifest.

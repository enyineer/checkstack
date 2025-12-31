---
---
# Dependency Architecture Linter

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

- **Common**: Packages ending with `-common` or named `@checkmate/common`
- **Frontend**: Packages ending with `-frontend`, `-frontend-plugin`, or starting with `@checkmate/frontend` or `@checkmate/ui`
- **Backend**: Packages ending with `-backend`, `-backend-plugin`, or starting with `@checkmate/backend`
- **Core**: The `@checkmate/common` package
- **External**: Non-`@checkmate/*` packages (always allowed)

### Validation Process

1. Scans all packages in `packages/*` and `plugins/*` directories
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
  "name": "@checkmate/catalog-common",
  "dependencies": {
    "@checkmate/backend-api": "workspace:*"  // ❌ VIOLATION
  }
}
```

**Error:**
```
❌ Dependency Architecture Violations Found:

  @checkmate/catalog-common
    → depends on @checkmate/backend-api
    → common packages cannot depend on backend packages
```

**Fix:** Depend on `@checkmate/common` instead:
```json
{
  "name": "@checkmate/catalog-common",
  "dependencies": {
    "@checkmate/common": "workspace:*"  // ✅ OK
  }
}
```

### Violation: Frontend Depending on Backend

```json
{
  "name": "@checkmate/catalog-frontend-plugin",
  "dependencies": {
    "@checkmate/catalog-backend-plugin": "workspace:*"  // ❌ VIOLATION
  }
}
```

**Error:**
```
❌ Dependency Architecture Violations Found:

  @checkmate/catalog-frontend-plugin
    → depends on @checkmate/catalog-backend-plugin
    → frontend packages cannot depend on backend packages
```

**Fix:** Depend on common package instead:
```json
{
  "name": "@checkmate/catalog-frontend-plugin",
  "dependencies": {
    "@checkmate/catalog-common": "workspace:*"  // ✅ OK
  }
}
```

## Allowed Dependencies

### ✅ Common → Common
```json
{
  "name": "@checkmate/catalog-common",
  "dependencies": {
    "@checkmate/common": "workspace:*"
  }
}
```

### ✅ Frontend → Frontend or Common
```json
{
  "name": "@checkmate/catalog-frontend-plugin",
  "dependencies": {
    "@checkmate/frontend-api": "workspace:*",
    "@checkmate/catalog-common": "workspace:*",
    "@checkmate/ui": "workspace:*"
  }
}
```

### ✅ Backend → Backend or Common
```json
{
  "name": "@checkmate/catalog-backend-plugin",
  "dependencies": {
    "@checkmate/backend-api": "workspace:*",
    "@checkmate/catalog-common": "workspace:*"
  }
}
```

### ✅ External Dependencies

All packages can depend on external (non-`@checkmate/*`) packages:
```json
{
  "name": "@checkmate/catalog-common",
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

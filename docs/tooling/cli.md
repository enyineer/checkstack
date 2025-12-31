---
---
# Monorepo Tooling

Checkmate uses a set of shared configurations and scripts to maintain consistency and reduce boilerplate across all packages and plugins.

## 1. Shared TypeScript Configurations

Instead of defining full TypeScript configurations in every package, we use `@checkmate/tsconfig`, which exports specialized base configurations.

### Available Configurations

| Config | Path | Usage |
|--------|------|-------|
| **Base** | `@checkmate/tsconfig/base.json` | Common settings for all packages |
| **Backend** | `@checkmate/tsconfig/backend.json` | For backend plugins and core (includes Bun types) |
| **Frontend** | `@checkmate/tsconfig/frontend.json` | For React-based frontend plugins (React, Vite) |
| **Common** | `@checkmate/tsconfig/common.json` | For platform-agnostic common packages |

### Usage

In your package's `tsconfig.json`, simply extend the appropriate configuration:

```json
{
  "extends": "@checkmate/tsconfig/backend.json",
  "include": ["src"]
}
```

## 2. Shared Scripts and Synchronization

To avoid redundant script definitions in `package.json`, we use the `@checkmate/scripts` package along with a synchronization tool.

### Standard Scripts

The following scripts should be consistent across all plugins:

- `typecheck`: Runs `tsc --noEmit` using the shared configuration.
- `lint`: Runs our standard code linting suite.
- `lint:code`: Runs ESLint with predefined rules and strict error reporting.

### Synchronization Tool

We provide a tool to automatically keep all `package.json` and `tsconfig.json` files in sync with the project's standards.

**How to run synchronization:**

```bash
# From the root of the monorepo
bun run packages/scripts/src/sync.ts
```

This tool will:
1. Add `@checkmate/scripts` to `devDependencies` if missing.
2. Standardize `typecheck` and `lint` scripts.
3. Ensure the correct `tsconfig.extends` is used based on the package type.
4. Auto-repair common configuration issues.

## 3. Creating a New Package

When creating a new package or plugin:

1. Create a minimal `package.json` with a `name` and `version`.
2. Create a minimal `tsconfig.json`.
3. Run the synchronization tool:
   ```bash
   bun run packages/scripts/src/sync.ts
   ```
4. Run `bun install` to link the new dependencies.

This ensures your new package immediately follows all Checkmate architecture and code style rules.

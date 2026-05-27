---
title: "Monorepo tooling"
description: "Shared TypeScript configs, lint setup, scaffold commands, and other scripts that keep Checkstack's workspace packages consistent."
---

Checkstack uses a set of shared configurations and scripts to maintain consistency and reduce boilerplate across all packages and plugins.

## 1. Shared TypeScript Configurations

Instead of defining full TypeScript configurations in every package, we use `@checkstack/tsconfig`, which exports specialized base configurations.

### Available Configurations

| Config | Path | Usage |
|--------|------|-------|
| **Base** | `@checkstack/tsconfig/base.json` | Common settings for all packages |
| **Backend** | `@checkstack/tsconfig/backend.json` | For backend plugins and core (includes Bun types) |
| **Frontend** | `@checkstack/tsconfig/frontend.json` | For React-based frontend plugins (React, Vite) |
| **Common** | `@checkstack/tsconfig/common.json` | For platform-agnostic common packages |

### Usage

In your package's `tsconfig.json`, simply extend the appropriate configuration:

```json
{
  "extends": "@checkstack/tsconfig/backend.json",
  "include": ["src"]
}
```

## 2. Shared Scripts and Synchronization

To avoid redundant script definitions in `package.json`, we use the `@checkstack/scripts` package along with a synchronization tool.

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
bun run core/scripts/src/sync.ts
```

This tool will:
1. Add `@checkstack/scripts` to `devDependencies` if missing.
2. Standardize `typecheck` and `lint` scripts.
3. Ensure the correct `tsconfig.extends` is used based on the package type.
4. Auto-repair common configuration issues.

## 3. Creating a New Package

Use the interactive CLI to create new packages or plugins:

```bash
# From the root of the monorepo
bun run cli create
```

The CLI will guide you through:

1. **Location choice**: `core/` (core components) or `plugins/` (replaceable providers)
2. **Package type**: backend, frontend, common, node, or react
3. **Package name**: Base name for your package (e.g., "auth" for "auth-backend")
4. **Description**: Optional description for your package

### Package Location Guidelines

| Location | Use For |
|----------|---------|
| `core/` | Core platform components that are essential and non-replaceable |
| `plugins/` | Replaceable providers that can be swapped (auth providers, queue backends) |

See [Packages vs Plugins Architecture](/checkstack/developer-guide/architecture/packages-vs-plugins/) for detailed decision criteria.

### Manual Setup Alternative

If the CLI doesn't work in your environment:

1. Create a minimal `package.json` with a `name` and `version`.
2. Create a minimal `tsconfig.json`.
3. Run the synchronization tool:
   ```bash
   bun run core/scripts/src/sync.ts
   ```
4. Run `bun install` to link the new dependencies.

This ensures your new package immediately follows all Checkstack architecture and code style rules.

---
---
# Contributing to Checkmate

Thank you for your interest in contributing to Checkmate! This guide will help you get started with contributing plugins or code to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Creating a Plugin](#creating-a-plugin)
- [Code Style](#code-style)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Plugin Guidelines](#plugin-guidelines)

## Getting Started

### Prerequisites

- **Bun** v1.0 or higher
- **PostgreSQL** 14 or higher
- **Node.js** 20+ (for some tooling)
- **Git**

### Fork and Clone

```bash
# Fork the repository on GitHub
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/checkmate.git
cd checkmate
```

### Install Dependencies

```bash
bun install
```

### Synchronize Configurations

Ensure your project follows the shared standards for TypeScript and package scripts:

```bash
bun run core/scripts/src/sync.ts
```

### Set Up Database

```bash
# Create a PostgreSQL database
createdb checkmate_dev

# Set environment variables
cp .env.example .env
# Edit .env and set DATABASE_URL
```

### Run Development Server

```bash
# Start backend and frontend
bun run dev
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Development Setup

### Project Structure

```
checkmate/
├── core/          # Core packages
│   ├── backend/      # Backend core
│   ├── frontend/     # Frontend core
│   ├── backend-api/  # Backend plugin API
│   ├── frontend-api/ # Frontend plugin API
│   ├── common/       # Shared types
│   ├── ui/           # UI components
│   ├── tsconfig/     # Shared TypeScript configurations
│   └── scripts/      # Shared monorepo scripts
│
├── plugins/          # Plugin packages
│   ├── catalog-backend/
│   ├── catalog-frontend/
│   ├── catalog-common/
│   └── ...
│
├── docs/             # Documentation
└── scripts/          # Build and utility scripts
```

### Available Scripts

```bash
# Development
bun run dev              # Start dev servers
bun run dev:backend      # Backend only
bun run dev:frontend     # Frontend only

# Building
bun run build            # Build all packages
bun run build:backend    # Backend only
bun run build:frontend   # Frontend only

# Testing
bun test                 # Run all tests
bun test:watch           # Watch mode

# Tooling (Standardized via @checkmate-monitor/scripts)
bun run sync             # Synchronize project configurations
bun run lint             # Run all linters
bun run typecheck        # TypeScript type checking

# Database
bun run db:generate      # Generate migrations
bun run db:migrate       # Run migrations
bun run db:studio        # Open Drizzle Studio
```

## Creating a Plugin

### 1. Choose Plugin Type

Decide what type of plugin you're creating:
- **Backend**: REST APIs, business logic, database
- **Frontend**: UI components, pages, routing
- **Common**: Shared types, permissions, constants

Most plugins will have all three.

### 2. Create Plugin Structure

```bash
# Create directories
mkdir -p plugins/myplugin-backend/src
mkdir -p plugins/myplugin-frontend/src
mkdir -p plugins/myplugin-common/src
```

### 3. Initialize Packages

Create `package.json` for each package. Then run the sync tool to apply shared configurations:

```bash
bun run sync
```

See:
- [Backend Plugin Guide](../backend/plugins.md)
- [Frontend Plugin Guide](../frontend/plugins.md)
- [Common Plugin Guidelines](../common/plugins.md)
- [Monorepo Tooling Guide](../tooling/cli.md)

### 4. Implement Plugin

Follow the guides above to implement your plugin.

### 5. Test Your Plugin

Write tests for your plugin:

```bash
# Unit tests
bun test plugins/myplugin-backend/src/**/*.test.ts

# Integration tests
bun test plugins/myplugin-backend/src/**/*.integration.test.ts
```

### 6. Document Your Plugin

Create a README in your plugin directory:

```markdown
# My Plugin

## Description

What does this plugin do?

## Configuration

How to configure this plugin.

## Usage

How to use this plugin.

## API

API endpoints or components provided.
```

## Code Style

### TypeScript

- Use **TypeScript** for all code
- Extend shared configurations from `@checkmate-monitor/tsconfig`
- Enable **strict mode**
- Avoid `any` types (use `unknown` if needed)
- Use **type inference** where possible

### Naming Conventions

- **Files**: kebab-case (`my-service.ts`)
- **Classes**: PascalCase (`MyService`)
- **Functions**: camelCase (`myFunction`)
- **Constants**: UPPER_SNAKE_CASE (`MY_CONSTANT`)
- **Interfaces**: PascalCase (`MyInterface`)
- **Types**: PascalCase (`MyType`)

### Code Organization

```typescript
// 1. Imports (grouped)
import { z } from "zod";
import { createBackendPlugin } from "@checkmate-monitor/backend-api";

// 2. Types and interfaces
interface MyData {
  id: string;
  name: string;
}

// 3. Constants
const DEFAULT_TIMEOUT = 5000;

// 4. Implementation
export class MyService {
  // ...
}
```

### Comments

- Use JSDoc for public APIs
- Explain **why**, not **what**
- Keep comments up to date

```typescript
/**
 * Fetches items from the database.
 * @param filter - Optional filter criteria
 * @returns Array of items matching the filter
 */
async getItems(filter?: ItemFilter): Promise<Item[]> {
  // Use a transaction to ensure consistency
  return await db.transaction(async (tx) => {
    // ...
  });
}
```

## Testing

### Unit Tests

Test individual functions and classes:

```typescript
import { describe, expect, test } from "bun:test";
import { MyService } from "./my-service";

describe("MyService", () => {
  test("creates item", async () => {
    const service = new MyService(mockDb);
    const item = await service.createItem({ name: "Test" });
    expect(item.name).toBe("Test");
  });
});
```

### Integration Tests

Test plugin integration with the core:

```typescript
import { describe, expect, test } from "bun:test";
import plugin from "./index";

describe("MyPlugin Integration", () => {
  test("registers correctly", () => {
    expect(plugin.pluginId).toBe("myplugin");
    expect(plugin.register).toBeFunction();
  });
});
```

### E2E Tests (Frontend)

Use Playwright for end-to-end tests:

```typescript
import { test, expect } from "@playwright/test";

test("user can create item", async ({ page }) => {
  await page.goto("/items");
  await page.click("text=Create Item");
  await page.fill("#name", "New Item");
  await page.click("text=Save");
  await expect(page.locator("text=New Item")).toBeVisible();
});
```

### Test Coverage

Aim for:
- **80%+ coverage** for business logic
- **100% coverage** for critical paths
- Test **error cases** and edge cases

## Submitting Changes

### 1. Create a Branch

```bash
git checkout -b feature/my-new-plugin
```

Use prefixes:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `refactor/` - Code refactoring
- `test/` - Test additions

### 2. Make Changes

- Follow code style guidelines
- Write tests
- Update documentation
- Run standardized linters
- Ensure configurations are synchronized

```bash
bun run sync
bun run lint
bun run typecheck
bun test
```

### 3. Commit Changes

Use conventional commits:

```bash
git commit -m "feat(myplugin): add new feature"
git commit -m "fix(catalog): resolve bug in entity service"
git commit -m "docs: update plugin architecture guide"
```

Prefixes:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code refactoring
- `test` - Tests
- `chore` - Maintenance

### 4. Push and Create PR

```bash
git push origin feature/my-new-plugin
```

Then create a Pull Request on GitHub.

### PR Guidelines

- **Title**: Clear and descriptive
- **Description**: Explain what and why
- **Tests**: Include test results
- **Screenshots**: For UI changes
- **Breaking Changes**: Clearly marked

Example PR description:

```markdown
## Description

Adds a new HTTP health check plugin that supports custom headers and retry logic.

## Changes

- Created `healthcheck-http-backend` plugin
- Added support for custom headers
- Implemented retry logic with exponential backoff
- Added comprehensive tests

## Testing

- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing completed

## Screenshots

![Health check configuration](./screenshots/config.png)

## Breaking Changes

None
```

## Plugin Guidelines

### Backend Plugins

- ✅ Use Hono for routing
- ✅ Use Drizzle for database
- ✅ Use Zod for validation
- ✅ Implement permission checks
- ✅ Write comprehensive tests
- ✅ Document all endpoints
- ❌ Don't use `pgSchema()` in Drizzle
- ❌ Don't hardcode URLs or ports
- ❌ Don't skip validation

### Frontend Plugins

- ✅ Use React hooks
- ✅ Use ShadCN components
- ✅ Implement permission checks
- ✅ Handle loading states
- ✅ Handle error states
- ✅ Use TypeScript
- ❌ Don't use inline styles
- ❌ Don't hardcode API URLs
- ❌ Don't skip accessibility

### Common Plugins

- ✅ Export permissions
- ✅ Export shared types
- ✅ Use Zod for schemas
- ✅ Keep dependencies minimal
- ❌ Don't import backend packages
- ❌ Don't import frontend packages
- ❌ Don't include runtime-specific code

### Documentation

- ✅ Document all public APIs
- ✅ Include usage examples
- ✅ Explain configuration options
- ✅ Document breaking changes
- ❌ Don't assume prior knowledge
- ❌ Don't skip edge cases

## Architecture Rules

### Dependency Rules

These are **automatically enforced** by the linter:

- Common plugins → Common only
- Frontend plugins → Frontend or Common
- Backend plugins → Backend or Common

See [dependency-linter.md](../tooling/dependency-linter.md) for details.

### Database Isolation

- Each plugin gets its own schema
- Don't use `pgSchema()` in table definitions
- Migrations are automatic

See [drizzle-schema-isolation.md](../backend/drizzle-schema.md) for details.

### Versioned Configs

- Use versioned configs for extension points
- Provide migrations for schema changes
- Test migrations thoroughly

See [versioned-configs.md](../backend/versioned-configs.md) for details.

## Getting Help

### Documentation

- [Plugin Architecture](../architecture/plugin-system.md)
- [Monorepo Tooling](../tooling/cli.md)
- [Backend Plugins](../backend/plugins.md)
- [Frontend Plugins](../frontend/plugins.md)
- [Extension Points](./extension-points.md)
- [Versioned Configs](../backend/versioned-configs.md)

### Community

- **GitHub Issues**: Report bugs or request features
- **GitHub Discussions**: Ask questions or share ideas
- **Pull Requests**: Submit code contributions

### Code Review

All contributions go through code review. Reviewers will check:
- Code quality and style
- Test coverage
- Documentation
- Architecture compliance
- Security considerations

Be responsive to feedback and iterate on your PR.

## License

By contributing to Checkmate, you agree that your contributions will be licensed under the same license as the project.

## Thank You!

Thank you for contributing to Checkmate! Your contributions help make this project better for everyone.

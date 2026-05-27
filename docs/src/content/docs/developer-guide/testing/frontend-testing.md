---
title: "Frontend testing"
description: "Playwright end-to-end test setup, fixtures, and how to run the suite locally."
---

Frontend plugins use Playwright for end-to-end testing through the shared `@checkstack/test-utils-frontend` package. This page covers configuration, writing tests, and running them against your local dev servers.

## E2E Testing with Playwright

For end-to-end testing of frontend plugins, use Playwright through the same `@checkstack/test-utils-frontend` package.

### Quick Setup

#### 1. Create playwright.config.ts

```typescript
import { createPlaywrightConfig } from "@checkstack/test-utils-frontend/playwright";

export default createPlaywrightConfig({
  baseURL: "http://localhost:5173",
});
```

#### 2. Create E2E Tests

Create an `e2e/` directory and add test files with `.e2e.ts` extension:

> **Important:** Use `.e2e.ts` extension (not `.spec.ts` or `.test.ts`) to ensure E2E tests are **not** picked up by `bun test` when running unit tests from the monorepo root. The `.e2e.ts` pattern is specifically excluded from Bun's default test discovery.

```typescript
// e2e/login.e2e.ts
import { test, expect } from "@checkstack/test-utils-frontend/playwright";

test.describe("Login Page", () => {
  test("should display the login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toBeVisible();
  });
});
```

#### 3. Add Test Script

```json
{
  "scripts": {
    "test:e2e": "bunx playwright test"
  }
}
```

### Running E2E Tests

**Prerequisites:** Both frontend and backend dev servers must be running.

```bash
# Terminal 1: Start backend
cd core/backend && bun run dev

# Terminal 2: Start frontend
cd core/frontend && bun run dev

# Terminal 3: Run E2E tests
cd plugins/your-plugin && bun run test:e2e
```

### Installing Playwright Browsers

On first run, install the required browsers:

```bash
bunx playwright install chromium
```

### Configuration Options

```typescript
createPlaywrightConfig({
  baseURL: "http://localhost:5173",  // Frontend URL
  testDir: "./e2e",                   // Test directory
  webServer: {                        // Optional: auto-start dev server
    command: "bun run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});
```

### Best Practices

1. **Use flexible selectors** - Prefer `data-testid`, roles, or text content over CSS classes
2. **Test user workflows** - Focus on complete user journeys rather than individual elements
3. **Keep tests independent** - Each test should be able to run in isolation
4. **Use page objects** - For complex pages, extract common interactions into helpers

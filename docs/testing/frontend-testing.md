---
---
# Frontend Testing with Bun

This guide explains how to test React components and hooks in frontend plugins using Bun's test runner with Happy DOM.

## Quick Setup

### 1. Add the Test Utils Dependency

Add `@checkmate/test-utils-frontend` to your package's `devDependencies`:

```json
{
  "devDependencies": {
    "@checkmate/test-utils-frontend": "workspace:*"
  }
}
```

### 2. Create bunfig.toml

Create a `bunfig.toml` file in your package root:

```toml
[test]
preload = ["@checkmate/test-utils-frontend/setup"]
```

This single preload file:
- Registers Happy DOM globals (`document`, `window`, etc.)
- Extends `expect` with Testing Library matchers (`toBeInTheDocument`, etc.)
- Sets up automatic cleanup after each test

### 3. Write Tests

```typescript
import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MyComponent } from "./MyComponent";

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(<MyComponent title="Hello" />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});
```

## Testing React Hooks

Use `renderHook` from `@testing-library/react`:

```typescript
import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useCounter } from "./useCounter";

describe("useCounter", () => {
  it("increments count", () => {
    const { result } = renderHook(() => useCounter());

    act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(1);
  });
});
```

## Running Tests

```bash
cd your-package
bun test
```

Or from the monorepo root:

```bash
bun test --filter your-package
```

## What's Included

The `@checkmate/test-utils-frontend` package includes:

| Package | Purpose |
|---------|---------|
| `@happy-dom/global-registrator` | Provides DOM globals for Bun |
| `@testing-library/react` | React component/hook testing utilities |
| `@testing-library/dom` | DOM querying utilities |
| `@testing-library/jest-dom` | Custom matchers like `toBeInTheDocument` |

## Re-exported Utilities

For convenience, common utilities are re-exported from the main entry:

```typescript
import { render, screen, renderHook, act, waitFor } from "@checkmate/test-utils-frontend";
```

## Limitations

### Async Effects in Happy DOM

Testing hooks with async `useEffect` requires careful handling. Happy DOM's event loop doesn't automatically flush async operations like a real browser.

**Recommended approach:** Test synchronous behavior (method calls, state changes) rather than waiting for async fetch completion:

```typescript
it("should call fetch with correct params", () => {
  const mockFetch = mock(async () => ({ data: [] }));
  
  renderHook(() => useMyHook({ fetchFn: mockFetch }));
  
  // Test that the fetch was called with correct params
  expect(mockFetch).toHaveBeenCalledWith({ limit: 10 });
});
```

## See Also

- [Backend Testing Utilities](./backend-utilities.md)
- [Bun Test Runner Documentation](https://bun.com/docs/test)
- [Testing Library Documentation](https://testing-library.com/)

---

## E2E Testing with Playwright

For end-to-end testing of frontend plugins, use Playwright through the same `@checkmate/test-utils-frontend` package.

### Quick Setup

#### 1. Create playwright.config.ts

```typescript
import { createPlaywrightConfig } from "@checkmate/test-utils-frontend/playwright";

export default createPlaywrightConfig({
  baseURL: "http://localhost:5173",
});
```

#### 2. Create E2E Tests

Create an `e2e/` directory and add test files with `.e2e.ts` extension:

> **Important:** Use `.e2e.ts` extension (not `.spec.ts` or `.test.ts`) to ensure E2E tests are **not** picked up by `bun test` when running unit tests from the monorepo root. The `.e2e.ts` pattern is specifically excluded from Bun's default test discovery.

```typescript
// e2e/login.e2e.ts
import { test, expect } from "@checkmate/test-utils-frontend/playwright";

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

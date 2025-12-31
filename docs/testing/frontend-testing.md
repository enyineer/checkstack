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

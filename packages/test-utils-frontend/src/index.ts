/**
 * @checkmate/test-utils-frontend
 *
 * Centralized testing utilities for frontend packages in Checkmate.
 * Provides Happy DOM and Testing Library integration for Bun tests.
 *
 * ## Quick Setup (Unit Tests)
 *
 * 1. Add as devDependency:
 *    ```json
 *    "devDependencies": {
 *      "@checkmate/test-utils-frontend": "workspace:*"
 *    }
 *    ```
 *
 * 2. Create bunfig.toml:
 *    ```toml
 *    [test]
 *    preload = ["@checkmate/test-utils-frontend/setup"]
 *    ```
 *
 * 3. Write tests using @testing-library/react
 *
 * ## E2E Testing with Playwright
 *
 * Import from "@checkmate/test-utils-frontend/playwright":
 *    ```typescript
 *    import { createPlaywrightConfig, test, expect } from "@checkmate/test-utils-frontend/playwright";
 *    ```
 */

// Re-export testing library for convenience
export {
  render,
  screen,
  cleanup,
  renderHook,
  act,
  waitFor,
} from "@testing-library/react";

/**
 * @checkmate/test-utils-frontend/playwright
 *
 * Shared Playwright configuration and utilities for E2E testing.
 *
 * ## Quick Setup
 *
 * 1. Add devDependency: "@checkmate/test-utils-frontend": "workspace:*"
 *
 * 2. Create playwright.config.ts in your package:
 *    ```typescript
 *    import { createPlaywrightConfig } from "@checkmate/test-utils-frontend/playwright";
 *    export default createPlaywrightConfig();
 *    ```
 *
 * 3. Create e2e/ directory and add *.spec.ts tests
 *
 * 4. Run: bunx playwright test
 */

import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from "@playwright/test";

export interface PlaywrightConfigOptions {
  /** Base URL for tests (default: http://localhost:5173) */
  baseURL?: string;
  /** Test directory relative to package root (default: ./e2e) */
  testDir?: string;
  /** Whether to start the dev server (default: false - assumes already running) */
  webServer?: {
    command: string;
    url: string;
    timeout?: number;
    reuseExistingServer?: boolean;
  };
  /** Additional config overrides */
  overrides?: Partial<PlaywrightTestConfig>;
}

/**
 * Creates a standardized Playwright configuration for Checkmate plugins.
 *
 * @example
 * ```typescript
 * // playwright.config.ts
 * import { createPlaywrightConfig } from "@checkmate/test-utils-frontend/playwright";
 *
 * export default createPlaywrightConfig({
 *   baseURL: "http://localhost:5173",
 * });
 * ```
 */
export function createPlaywrightConfig(
  options: PlaywrightConfigOptions = {}
): PlaywrightTestConfig {
  const {
    baseURL = "http://localhost:5173",
    testDir = "./e2e",
    webServer,
    overrides = {},
  } = options;

  return defineConfig({
    testDir,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? "github" : "html",
    use: {
      baseURL,
      trace: "on-first-retry",
      screenshot: "only-on-failure",
    },
    projects: [
      {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
      },
    ],
    ...(webServer && { webServer }),
    ...overrides,
  });
}

// Re-export common Playwright utilities
export { test, expect } from "@playwright/test";
export type { Page, Locator, BrowserContext } from "@playwright/test";

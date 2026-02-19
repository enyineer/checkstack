/**
 * Test Setup for Frontend Packages
 *
 * This file sets up the DOM environment and Testing Library for Bun tests.
 * Preload this single file in bunfig.toml.
 *
 * Usage in bunfig.toml:
 * [test]
 * preload = ["@checkstack/test-utils-frontend/setup"]
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register Happy DOM globals first (document, window, etc.)
// This must happen BEFORE importing @testing-library/react, which captures the environment on import.
GlobalRegistrator.register();

// Then set up Testing Library (dynamic import ensures global env is ready)
const { afterEach, expect } = await import("bun:test");
const { cleanup } = await import("@testing-library/react");
const matchers = await import("@testing-library/jest-dom/matchers");

// Extend expect with Testing Library matchers (toBeInTheDocument, etc.)
// Handle both default export and named exports scenarios
expect.extend(matchers.default || matchers);

// Clean up render after each test to prevent memory leaks
afterEach(() => {
  cleanup();
});

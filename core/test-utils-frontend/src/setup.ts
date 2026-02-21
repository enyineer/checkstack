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
import { afterEach, expect } from "bun:test";

// Register Happy DOM globals first (document, window, etc.)
GlobalRegistrator.register();

// Use dynamic imports to ensure DOM is registered before Testing Library loads
const { cleanup } = await import("@testing-library/react");
const matchers = await import("@testing-library/jest-dom/matchers");

// Extend expect with Testing Library matchers (toBeInTheDocument, etc.)
// @ts-ignore
expect.extend(matchers.default || matchers);

// Clean up render after each test to prevent memory leaks
afterEach(() => {
  cleanup();
});

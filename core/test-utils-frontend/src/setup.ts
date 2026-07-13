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

// Register Happy DOM globals first (document, window, etc.). Idempotent: a
// test FILE may import this setup directly (so it also runs under the ROOT
// test runner, whose bunfig does not preload it), while the package-level
// bunfig preload has already registered the DOM in package-scoped runs -
// registering twice throws, so guard on an existing document.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (!("document" in globalThis)) {
  GlobalRegistrator.register();
}

// Then set up Testing Library
import { afterEach, expect } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend expect with Testing Library matchers (toBeInTheDocument, etc.)
expect.extend(matchers);

// Clean up render after each test to prevent memory leaks
afterEach(() => {
  cleanup();
});

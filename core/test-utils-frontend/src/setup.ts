/**
 * Test Setup for Frontend Packages
 *
 * This file sets up the DOM environment and Testing Library for Bun tests.
 * Preload this single file in bunfig.toml.
 *
 * Usage in bunfig.toml:
 * [test]
 * preload = ["@checkmate-monitor/test-utils-frontend/setup"]
 */

// Register Happy DOM globals first (document, window, etc.)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

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

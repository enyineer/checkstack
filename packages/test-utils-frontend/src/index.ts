/**
 * @checkmate/test-utils-frontend
 *
 * Centralized testing utilities for frontend packages in Checkmate.
 * Provides Happy DOM and Testing Library integration for Bun tests.
 *
 * ## Quick Setup
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
 *    preload = ["@checkmate/test-utils-frontend/happydom", "@checkmate/test-utils-frontend/setup"]
 *    ```
 *
 * 3. Write tests using @testing-library/react:
 *    ```typescript
 *    import { describe, it, expect } from "bun:test";
 *    import { renderHook, act } from "@testing-library/react";
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

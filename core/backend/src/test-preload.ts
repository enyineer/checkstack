/**
 * Test Preload File
 *
 * This file is loaded BEFORE any test file runs (via bunfig.toml).
 * It ensures that mock.module() is called before the mocked modules
 * are ever imported, preventing side effects like DATABASE_URL checks.
 *
 * Without this preload:
 * 1. Test file imports: mock.module("./db", ...) -- BUT imports are hoisted
 * 2. Static import: import { PluginManager } from "./plugin-manager" runs FIRST
 * 3. plugin-manager imports something that imports ./db
 * 4. ./db throws "DATABASE_URL is not defined"
 *
 * With this preload:
 * 1. preload runs: mock.module("./db", ...) is registered
 * 2. Test file loads
 * 3. Any import of ./db uses the mock
 */

import { mock } from "bun:test";
import {
  createMockDbModule,
  createMockLoggerModule,
} from "@checkmate-monitor/test-utils-backend";

// Mock database module - prevents DATABASE_URL check from throwing
mock.module("./db", () => createMockDbModule());

// Mock logger module - prevents any logging side effects
mock.module("./logger", () => createMockLoggerModule());

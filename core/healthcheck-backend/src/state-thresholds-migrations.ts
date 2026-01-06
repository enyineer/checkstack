import { Versioned } from "@checkmate-monitor/backend-api";
import {
  StateThresholdsSchema,
  type StateThresholds,
} from "@checkmate-monitor/healthcheck-common";

/**
 * Versioned handler for state thresholds.
 * Provides parsing, validation, and migration capabilities.
 */
export const stateThresholds = new Versioned<StateThresholds>({
  version: 1,
  schema: StateThresholdsSchema,
  migrations: [],
});

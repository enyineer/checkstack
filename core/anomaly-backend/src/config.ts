import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import type { VersionedRecord } from "@checkstack/backend-api";
import {
  AnomalySettingsSchema,
  PartialAnomalySettingsSchema,
} from "@checkstack/anomaly-common";
import type {
  AnomalySettings,
  PartialAnomalySettings,
} from "@checkstack/anomaly-common";

/**
 * Envelope schema for the stored versioned record. Stored configs come back
 * from the jsonb column typed as `unknown`, so we validate the wrapper shape
 * (`{ version, data }`) before handing it to `Versioned.parseRecord`, which
 * then migrates + validates the inner `data` against the strategy schema.
 */
const versionedEnvelopeSchema = z.object({
  version: z.number(),
  data: z.unknown(),
  migratedAt: z.date().optional(),
  originalVersion: z.number().optional(),
});

/**
 * Narrow a stored jsonb config (`unknown`) into a {@link VersionedRecord}
 * envelope so it can be passed to `Versioned.parse`/`parseRecord`.
 */
export function toVersionedRecord(stored: unknown): VersionedRecord<unknown> {
  return versionedEnvelopeSchema.parse(stored);
}

export const anomalySettingsConfig = new Versioned<AnomalySettings>({
  version: 1,
  schema: AnomalySettingsSchema,
});

/**
 * Versioned config for assignment-level overrides. Stored alongside the
 * template config and migrated/validated on read via {@link Versioned.parseRecord}.
 * `version: 1` with no migrations today; threading it through the read path
 * means a future reshape only needs a migration step added here.
 */
export const anomalyAssignmentConfig = new Versioned<PartialAnomalySettings>({
  version: 1,
  schema: PartialAnomalySettingsSchema,
});

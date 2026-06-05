/**
 * DOM-free helpers backing the "Preview as: <environment>" picker.
 *
 * Host plugins (e.g. the health-check collector editor) let an author pick a
 * catalog environment to preview `x-templatable` config fields against. These
 * helpers map a catalog `Environment` onto the `environment` slice of a
 * template-preview context and pick a selected environment by id. Kept pure so
 * they can be unit-tested without a DOM (CI runs `bun test` from the repo root
 * without happy-dom).
 */

import type { Environment } from "@checkstack/catalog-common";

/**
 * Option shown in the environment picker. `name` is the catalog environment's
 * display name; `id` is its stable id (the picker's `value`).
 */
export interface EnvironmentPreviewOption {
  id: string;
  name: string;
}

/**
 * Map catalog environments to picker options, preserving input order. The
 * environment's display name is used verbatim; ids are assumed unique (the
 * catalog guarantees this).
 */
export function toPreviewOptions(
  environments: ReadonlyArray<Environment>,
): EnvironmentPreviewOption[] {
  return environments.map((env) => ({ id: env.id, name: env.name }));
}

/**
 * The custom-field record a chosen environment contributes to the preview
 * context's `environment` slice. Mirrors the run-time semantics exactly:
 * the backend exposes `environment.fields = env.metadata ?? {}` to the
 * `x-templatable` render pass (see `effective-environments.ts`), so the
 * editor preview must use the same source to never diverge.
 */
export function environmentToPreviewFields(
  environment: Environment | null | undefined,
): Record<string, unknown> {
  return environment?.metadata ?? {};
}

/**
 * Resolve the selected environment from a list by id. Returns `null` when no
 * id is selected or the id is no longer present (e.g. the environment was
 * removed since selection). Callers treat `null` as "no preview environment".
 */
export function findSelectedEnvironment({
  environments,
  selectedId,
}: {
  environments: ReadonlyArray<Environment>;
  selectedId: string | null | undefined;
}): Environment | null {
  if (!selectedId) return null;
  return environments.find((env) => env.id === selectedId) ?? null;
}

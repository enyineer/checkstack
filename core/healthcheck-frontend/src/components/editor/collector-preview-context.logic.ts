/**
 * DOM-free helpers backing the collector config "preview-as-environment" UX.
 *
 * Two concerns, both kept pure so they run in the repo-root `bun test` (no
 * happy-dom):
 *
 * 1. Detect whether a collector's config schema has any `x-templatable` field
 *    (recursively), so the editor only shows the environment picker when a
 *    preview would actually be meaningful.
 * 2. Build the `templatePreviewContext` fed to `DynamicForm` from a chosen
 *    environment's custom fields plus curated check/system metadata. The shape
 *    `{ environment, check, system }` mirrors the backend's run-time render
 *    context exactly (see `queue-executor.ts`), so the preview never diverges
 *    from what runs.
 */

import type { JsonSchema, JsonSchemaProperty } from "@checkstack/ui";

/**
 * True when `schema` (or any nested object/array property) declares at least
 * one `x-templatable` field. Used to gate the preview picker: no templatable
 * field means no `{{ … }}` to resolve, so the picker stays hidden.
 */
export function schemaHasTemplatableFields(
  schema: JsonSchema | undefined | null,
): boolean {
  if (!schema?.properties) return false;
  return Object.values(schema.properties).some((property) =>
    propertyHasTemplatable(property),
  );
}

function propertyHasTemplatable(property: JsonSchemaProperty): boolean {
  if (property["x-templatable"]) return true;
  if (
    property.properties &&
    Object.values(property.properties).some((nested) =>
      propertyHasTemplatable(nested),
    )
  ) {
    return true;
  }
  if (property.items && propertyHasTemplatable(property.items)) {
    return true;
  }
  return false;
}

/**
 * Curated check/system metadata exposed to the preview, matching the run-time
 * `CollectorRunContext` subset that templating sees. Optional because the
 * editor may not have a concrete system in context (the author writes a config
 * that several systems may later use).
 */
export interface PreviewCheckMeta {
  id: string;
  name: string;
  intervalSeconds: number;
}

export interface PreviewSystemMeta {
  id: string;
  name: string;
}

/**
 * Build the sample `templatePreviewContext` for `DynamicForm`. `environment`
 * carries the chosen environment's verbatim custom fields (its catalog
 * `metadata`); `check`/`system` carry curated metadata when available. The
 * resulting shape `{ environment, check, system }` matches the backend
 * `templateContext` so `{{ environment.baseUrl }}` previews exactly as it
 * renders at run time.
 */
export function buildTemplatePreviewContext({
  environmentFields,
  check,
  system,
}: {
  environmentFields: Record<string, unknown>;
  check?: PreviewCheckMeta;
  system?: PreviewSystemMeta;
}): Record<string, unknown> {
  return {
    environment: environmentFields,
    check: check ?? {},
    system: system ?? {},
  };
}

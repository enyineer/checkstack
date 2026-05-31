// Headless TypeScript / JavaScript script validator.
//
// Type-checks user scripts against their generated `context` types WITHOUT a
// mounted editor, so an automation's collapsed-card scripts (or any script the
// user isn't currently looking at) still surface type errors. It drives the
// SAME standalone TS worker the editor uses, via off-screen models.
//
// Browser-only (imports `monaco` + the worker accessor). The pure mapping /
// offset logic lives in `scriptDiagnostics.ts` and is unit-tested there; this
// module is the thin async glue and is intentionally not unit-tested (no DOM /
// worker under bun).
//
// Why prepend instead of an extra-lib: a global `context` extra-lib would
// collide with any open editor's own `declare const context` (extra-libs are
// global to the shared service). Prepending the type defs onto each validated
// source keeps `context` scoped to that one off-screen file. See
// `buildValidationSource`.
import * as monaco from "@codingame/monaco-vscode-editor-api";
import {
  getJavaScriptWorker,
  getTypeScriptWorker,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";
import {
  areVscodeServicesReady,
  ensureStandaloneStdlib,
} from "./monacoTsService";
import {
  buildValidationSource,
  mapWorkerDiagnostics,
  type RawTsDiagnostic,
  type ScriptDiagnostic,
} from "./scriptDiagnostics";

export type { ScriptDiagnostic } from "./scriptDiagnostics";

export interface ScriptValidationInput {
  /** Caller-chosen identity; the returned map is keyed by this. */
  id: string;
  /** The user's script source (without any generated type prefix). */
  source: string;
  /** Generated `context.d.ts` (+ ambient augmentations) for this script. */
  typeDefinitions: string;
  language: "typescript" | "javascript";
}

// Monotonic across overlapping validation passes so two passes never reuse the
// same off-screen model URI (which would race on create/dispose).
let runCounter = 0;

/**
 * Validate each script against its `typeDefinitions`. Returns a map keyed by
 * input `id` to that script's diagnostics (empty array = clean). Never throws:
 * any worker/setup failure resolves to no diagnostics so validation can never
 * break the editor it augments.
 *
 * Runs serially. The inline-prepend strategy removes the shared-state
 * constraint that would otherwise force serialization, but validation is not
 * latency-critical and serial keeps worker load predictable.
 */
export async function validateTypeScriptSources({
  sources,
}: {
  sources: ScriptValidationInput[];
}): Promise<Map<string, ScriptDiagnostic[]>> {
  const results = new Map<string, ScriptDiagnostic[]>();
  if (sources.length === 0) {
    return results;
  }
  // CRITICAL: only proceed once an editor has initialized the monaco-vscode
  // services. Initializing them here would collide with the editor wrapper's
  // one-time init ("Services are already initialized") and break the editor.
  if (!areVscodeServicesReady()) {
    return results;
  }
  try {
    await ensureStandaloneStdlib();
  } catch {
    return results;
  }

  for (const input of sources) {
    try {
      results.set(input.id, await validateOne(input));
    } catch {
      results.set(input.id, []);
    }
  }
  return results;
}

async function validateOne(
  input: ScriptValidationInput,
): Promise<ScriptDiagnostic[]> {
  const { text, prependedLineCount } = buildValidationSource({
    typeDefinitions: input.typeDefinitions,
    source: input.source,
  });
  const ext = input.language === "javascript" ? "js" : "ts";
  const uri = monaco.Uri.parse(
    `file:///script-validation/${runCounter++}.${ext}`,
  );
  monaco.editor.getModel(uri)?.dispose();
  const model = monaco.editor.createModel(text, input.language, uri);
  try {
    const getWorker =
      input.language === "javascript"
        ? await getJavaScriptWorker()
        : await getTypeScriptWorker();
    const client = await getWorker(uri);
    const fileName = uri.toString();
    const [syntactic, semantic] = await Promise.all([
      client.getSyntacticDiagnostics(fileName),
      client.getSemanticDiagnostics(fileName),
    ]);
    const diagnostics: RawTsDiagnostic[] = [...syntactic, ...semantic].map(
      (diagnostic) => ({
        start: diagnostic.start,
        length: diagnostic.length,
        messageText: diagnostic.messageText,
        category: diagnostic.category,
        code: diagnostic.code,
      }),
    );
    return mapWorkerDiagnostics({
      diagnostics,
      validationText: text,
      prependedLineCount,
    });
  } finally {
    model.dispose();
  }
}

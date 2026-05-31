import React from "react";
import type { AutomationDefinition } from "@checkstack/automation-common";
import { onVscodeServicesReady, validateTypeScriptSources } from "@checkstack/ui";
import {
  generateAutomationContextTypes,
  generateSecretEnvTypes,
} from "../script-context";
import { useAutomationRegistry } from "./registry-context";
import { collectScriptActions } from "./script-actions";
import type { DefinitionIssue } from "./editor-validation";

/**
 * Continuously type-check every inline TS/JS script action in `definition`
 * against its generated `context` types - even the ones whose editor cards are
 * collapsed or never opened - and surface the results as `DefinitionIssue`s so
 * they flow through the same `ValidationProvider` / per-card badge path as
 * structural validation.
 *
 * The check runs in the browser via the headless `validateTypeScriptSources`
 * (the same standalone TS worker the editor uses), so it needs no backend
 * round-trip. It is debounced and generation-guarded so a burst of edits
 * collapses to one pass and a stale async result never overwrites a newer one.
 *
 * NOTE: this only covers the automation currently open in the editor. Scripts
 * in OTHER automations, or definitions authored via YAML/API, are not seen here
 * - that platform-wide coverage is the (deferred) backend typecheck's job.
 */
export function useScriptDiagnostics({
  definition,
}: {
  definition: AutomationDefinition;
}): DefinitionIssue[] {
  const { triggers, actions, artifactTypes } = useAutomationRegistry();
  const [issues, setIssues] = React.useState<DefinitionIssue[]>([]);
  const generationRef = React.useRef(0);

  // The validator no-ops until an editor initializes the monaco-vscode services
  // (it must never init them itself). Bumping this when services become ready
  // re-runs the effect below, so opening any one script editor immediately
  // validates ALL scripts - including the still-collapsed ones.
  const [servicesReadyTick, setServicesReadyTick] = React.useState(0);
  React.useEffect(
    () => onVscodeServicesReady(() => setServicesReadyTick((tick) => tick + 1)),
    [],
  );

  React.useEffect(() => {
    const generation = ++generationRef.current;
    const handle = setTimeout(() => {
      const refs = collectScriptActions({ definition, actions });
      if (refs.length === 0) {
        if (generation === generationRef.current) setIssues([]);
        return;
      }

      // Each script validates against the SAME merged type defs the editor
      // shows it: the scope-derived `context` union for the action's position,
      // plus the `process.env.*` augmentation for its declared secrets.
      const sources = refs.map((ref) => {
        const { typeDefinitions } = generateAutomationContextTypes({
          definition,
          triggers,
          actions: actions.map((action) => ({
            qualifiedId: action.qualifiedId,
            produces: action.produces,
          })),
          artifactTypes,
          path: ref.path,
        });
        const secretEnvLib = generateSecretEnvTypes({
          envNames: ref.secretEnvNames,
        });
        return {
          id: ref.id,
          source: ref.source,
          typeDefinitions: [typeDefinitions, secretEnvLib]
            .filter(Boolean)
            .join("\n\n"),
          language: ref.language,
        };
      });

      void validateTypeScriptSources({ sources })
        .then((byId) => {
          if (generation !== generationRef.current) return;
          const next: DefinitionIssue[] = [];
          for (const ref of refs) {
            for (const diagnostic of byId.get(ref.id) ?? []) {
              next.push({
                path: ref.issuePath,
                message: `Line ${diagnostic.line}: ${diagnostic.message}`,
              });
            }
          }
          setIssues(next);
        })
        .catch(() => {
          // Validator failure (e.g. worker unavailable) must never break the
          // editor; just leave script issues empty for this pass.
          if (generation === generationRef.current) setIssues([]);
        });
    }, 400);

    return () => clearTimeout(handle);
  }, [definition, triggers, actions, artifactTypes, servicesReadyTick]);

  return issues;
}

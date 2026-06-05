import React from "react";
import {
  CodeEditor,
  areVscodeServicesReady,
  onVscodeServicesReady,
} from "@checkstack/ui";

/**
 * Boots the shared monaco-vscode services so the headless script validator can
 * run from the moment an automation is opened - WITHOUT waiting for the
 * operator to expand a script action card.
 *
 * Why this exists: the validator must not initialize the monaco-vscode services
 * itself (that collides with the editor wrapper's one-time init and throws
 * "Services are already initialized"). Only a real editor may init them. So
 * when an automation already contains inline scripts, we mount ONE tiny,
 * offscreen, read-only editor purely to trigger that init. Its
 * `onEditorStartDone` flips the global "services ready" flag, the validator's
 * subscription fires, and every script - collapsed cards included - validates.
 *
 * Once services are ready the booter unmounts (it has done its job), so there's
 * no lingering hidden editor. It is only rendered when the definition actually
 * has a script action, so automations with none never pay the Monaco load.
 */
export const ScriptServicesBooter: React.FC = () => {
  const [ready, setReady] = React.useState(() => areVscodeServicesReady());

  React.useEffect(() => {
    if (ready) return;
    return onVscodeServicesReady(() => setReady(true));
  }, [ready]);

  if (ready) return null;

  return (
    <div
      aria-hidden
      // Pulled far offscreen with a tiny footprint so it never affects layout
      // or interaction; it exists only to start the editor services.
      className="pointer-events-none fixed left-[-9999px] top-0 h-[2px] w-[2px] overflow-hidden opacity-0"
    >
      <CodeEditor
        id="automation-script-services-booter"
        language="typescript"
        value=""
        onChange={() => {}}
        minHeight="1px"
        allowPopout={false}
        readOnly
        // Never let this hidden editor be the sole cold-init driver: a hidden
        // editor's monaco-vscode init may never complete. It defers to a
        // visible editor, then attaches once services are up.
        deferInit
      />
    </div>
  );
};

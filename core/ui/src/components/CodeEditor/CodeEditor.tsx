// Public `CodeEditor` component. Adapts the stable `CodeEditorProps` API to the
// `@typefox/monaco-editor-react`-backed `TypefoxEditor` (real VS Code language
// services in the browser). Consumers (DynamicForm, automation, healthcheck)
// import this and are unaffected by the underlying editor implementation.
import { useEffect, useState, type ComponentType } from "react";
import { Maximize2 } from "lucide-react";
import type { TypefoxEditorProps } from "./TypefoxEditor";
import { popoutTitle } from "./popoutTitle";
import type { CodeEditorProps } from "./types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../Dialog";
import { Skeleton } from "../Skeleton";
import { usePerformance } from "../PerformanceProvider";
import { cn } from "../../utils";

// Load the Monaco-backed editor chunk on demand WITHOUT React.lazy/Suspense.
//
// The `import("./TypefoxEditor")` is still dynamic, so the whole `@codingame/*`
// / Monaco stack stays in its own chunk and off pages that merely import
// primitives from the `@checkstack/ui` barrel (e.g. the login page) - the
// bundle-split goal is preserved. But we deliberately do NOT use `React.lazy` +
// `<Suspense>`: suspending THROUGH `@typefox`'s `MonacoEditorReactComp` makes
// React (under StrictMode's mount -> unmount -> remount) re-run the wrapper's
// ONE-SHOT global monaco-vscode init against already-initialized services,
// throwing "Services are already initialized" so the editor never reaches
// `onEditorStartDone` and never renders (dev-only; the prod Rollup build is
// fine). The wrapper expects a stable, non-suspending parent. So we resolve the
// chunk imperatively and render the wrapper only once it's loaded - a plain,
// synchronous mount, exactly as the pre-#236 static import behaved.
let editorModulePromise: Promise<typeof import("./TypefoxEditor")> | undefined;
const loadEditorModule = (): Promise<typeof import("./TypefoxEditor")> =>
  (editorModulePromise ??= import("./TypefoxEditor"));

const useTypefoxEditor = (): ComponentType<TypefoxEditorProps> | null => {
  const [Editor, setEditor] = useState<ComponentType<TypefoxEditorProps> | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void loadEditorModule().then((mod) => {
      if (active) setEditor(() => mod.TypefoxEditor);
    });
    return () => {
      active = false;
    };
  }, []);
  return Editor;
};

/**
 * Placeholder shown while the Monaco chunk loads. A plain `Skeleton` block
 * (which already honours `usePerformance` / `isLowPower`) sized to the editor's
 * height, so the layout doesn't jump and low-power devices avoid a heavy
 * spinner.
 */
const EditorLoadingFallback = ({ minHeightPx }: { minHeightPx: number }) => (
  <Skeleton
    className="w-full rounded-md"
    style={{ height: `${minHeightPx}px` }}
  />
);

/**
 * Code editor with context-aware IntelliSense, template / shell completion, and
 * structural validation. See `CodeEditorProps`.
 *
 * Renders the inline editor with a subtle top-right "expand" affordance that
 * opens the SAME editor (same `value` / `onChange` / completion props) in a
 * large full-screen overlay for comfortably editing big scripts. Both the
 * inline and overlay editors are `TypefoxEditor` instances bound to the same
 * controlled `value`, so edits stay in sync and closing the overlay keeps them.
 */
export const CodeEditor = ({
  id,
  value,
  onChange,
  language = "typescript",
  minHeight = "100px",
  readOnly,
  placeholder,
  typeDefinitions,
  templateProperties,
  shellEnvVars,
  markers,
  acquireTypes,
  acquireResetKey,
  sdkTypes,
  sdkTypesResetKey,
  importablePackages,
  allowPopout = true,
  title,
  deferInit,
}: CodeEditorProps) => {
  const [popoutOpen, setPopoutOpen] = useState(false);
  const { isLowPower } = usePerformance();
  // Resolved Monaco editor component (null until its chunk loads). Loaded
  // imperatively rather than via React.lazy/Suspense - see loadEditorModule.
  const TypefoxEditor = useTypefoxEditor();

  // CodeEditorProps.minHeight is a CSS length string ("240px"); TypefoxEditor
  // takes a pixel number.
  const minHeightPx = Number.parseInt(minHeight, 10) || 100;
  const editorId = id ?? "code-editor";

  // Shared editor props for both the inline and overlay instances. The overlay
  // instance overrides only `id` (a distinct model URI so the two Monaco models
  // don't fight) and `fillHeight` (so it fills the tall dialog body). Both are
  // bound to the same `value` / `onChange`, keeping edits in sync.
  const sharedEditorProps: Omit<TypefoxEditorProps, "id" | "fillHeight"> = {
    value,
    onChange,
    language,
    minHeight: minHeightPx,
    readOnly,
    placeholder,
    typeDefinitions,
    templateProperties,
    shellEnvVars,
    markers,
    acquireTypes,
    acquireResetKey,
    sdkTypes,
    sdkTypesResetKey,
    importablePackages,
    deferInit,
  };

  const dialogTitle = title ?? popoutTitle({ language });

  return (
    <div className="relative">
      {TypefoxEditor ? (
        <TypefoxEditor id={editorId} {...sharedEditorProps} />
      ) : (
        <EditorLoadingFallback minHeightPx={minHeightPx} />
      )}
      {allowPopout && (
        <button
          type="button"
          aria-label="Expand editor"
          title="Expand editor"
          onClick={() => setPopoutOpen(true)}
          className={cn(
            // Sits above the editor in the top-right corner. A faint background
            // keeps the muted icon legible over code; hover emphasises it.
            "absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center",
            "rounded-md bg-background/70 text-muted-foreground",
            !isLowPower && "backdrop-blur-sm",
            "transition-colors hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          )}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
      <Dialog open={popoutOpen} onOpenChange={setPopoutOpen}>
        {/* Tall flex column: override the default `overflow-y-auto` so the
            editor (not the dialog) scrolls internally, and give the body a
            fixed tall height so the `fillHeight` editor has something to fill. */}
        <DialogContent
          size="full"
          className="flex h-[85dvh] flex-col overflow-hidden overflow-y-hidden"
        >
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {/* The second Monaco instance only mounts while the dialog is open,
              so there's no double-editor cost when closed. Distinct
              `${id}-popout` id => distinct model URI. */}
          {popoutOpen && TypefoxEditor && (
            <div className="flex-1 min-h-0">
              <TypefoxEditor
                id={`${editorId}-popout`}
                fillHeight
                {...sharedEditorProps}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export type {
  CodeEditorProps,
  CodeEditorLanguage,
  TemplateProperty,
  ShellEnvVar,
  EditorMarker,
  AcquireTypes,
  AcquiredTypeFile,
} from "./types";

export {
  generateTypeDefinitions,
  type GenerateTypesOptions,
} from "./generateTypeDefinitions";

export {
  healthcheckScriptContext,
  integrationScriptContext,
  type ScriptEditorContext,
} from "./scriptContext";

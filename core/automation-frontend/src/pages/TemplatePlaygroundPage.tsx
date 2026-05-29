import React from "react";
import { FlaskConical } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  automationAccess,
} from "@checkstack/automation-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  CodeEditor,
  PageLayout,
  Alert,
  AlertTitle,
  AlertDescription,
  Label,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";

const DEFAULT_TEMPLATE = `Hello {{ trigger.payload.title }}!

The incident severity is {{ trigger.payload.severity | upper }}.`;

const DEFAULT_CONTEXT = `{
  "trigger": {
    "event": "incident.created",
    "payload": {
      "incidentId": "INC-42",
      "title": "API latency spike",
      "severity": "high"
    }
  }
}`;

/**
 * Live template-engine playground. Two editors on top — template body
 * (with `{{ }}` syntax) and sample JSON context — and a button that
 * sends both to the `renderTemplate` RPC; the result drops into the
 * output card at the bottom.
 *
 * Switching the mode between `template` and `condition` swaps which
 * field on the response is rendered (`output` for templates,
 * `booleanResult` for conditions). Parse errors come back with a
 * `line` / `column` so the alert can point the operator at the right
 * spot — Monaco doesn't get inline markers yet (that's a Phase 12.x
 * polish), but the message text is precise.
 */
const TemplatePlaygroundContent: React.FC = () => {
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const { allowed, loading: accessLoading } = accessApi.useAccess(
    automationAccess.read,
  );

  const [template, setTemplate] = React.useState(DEFAULT_TEMPLATE);
  const [contextText, setContextText] = React.useState(DEFAULT_CONTEXT);
  const [mode, setMode] = React.useState<"template" | "condition">("template");
  const [result, setResult] = React.useState<
    | { kind: "ok"; output?: string; booleanResult?: boolean }
    | { kind: "err"; message: string; line?: number; column?: number }
    | null
  >(null);

  const renderMutation = client.renderTemplate.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setResult({
          kind: "ok",
          output: data.output,
          booleanResult: data.booleanResult,
        });
      } else if (data.error) {
        setResult({
          kind: "err",
          message: data.error.message,
          line: data.error.line,
          column: data.error.column,
        });
      } else {
        setResult({ kind: "err", message: "Unknown rendering error" });
      }
    },
    onError: (error) => {
      setResult({ kind: "err", message: extractErrorMessage(error) });
    },
  });

  const handleRender = () => {
    let parsedContext: Record<string, unknown> = {};
    try {
      parsedContext = JSON.parse(contextText) as Record<string, unknown>;
    } catch (error) {
      setResult({
        kind: "err",
        message: `Sample context is not valid JSON: ${extractErrorMessage(error)}`,
      });
      return;
    }
    renderMutation.mutate({
      template,
      context: parsedContext,
      mode,
    });
  };

  return (
    <PageLayout
      title="Template Playground"
      subtitle="Test templates and conditions against a sample trigger payload"
      icon={FlaskConical}
      loading={accessLoading}
      allowed={allowed}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base flex items-center gap-2">
              Template
              <Select
                value={mode}
                onValueChange={(value) =>
                  setMode(value as "template" | "condition")
                }
              >
                <SelectTrigger className="ml-auto h-7 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="template">Template</SelectItem>
                  <SelectItem value="condition">Condition</SelectItem>
                </SelectContent>
              </Select>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CodeEditor
              value={template}
              onChange={setTemplate}
              language="markdown"
              minHeight="320px"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Sample context (JSON)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CodeEditor
              value={contextText}
              onChange={setContextText}
              language="json"
              minHeight="320px"
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          onClick={handleRender}
          disabled={renderMutation.isPending}
        >
          {renderMutation.isPending ? "Rendering…" : "Render"}
        </Button>
      </div>

      <Card className="mt-4">
        <CardHeader className="border-b">
          <CardTitle className="text-base">Result</CardTitle>
        </CardHeader>
        <CardContent>
          {!result && (
            <p className="text-sm text-muted-foreground italic">
              Click Render to evaluate.
            </p>
          )}
          {result?.kind === "ok" && mode === "template" && (
            <pre className="whitespace-pre-wrap font-mono text-sm">
              {result.output ?? ""}
            </pre>
          )}
          {result?.kind === "ok" && mode === "condition" && (
            <Label className="text-sm">
              Result:{" "}
              <span className="font-mono">
                {result.booleanResult === true ? "true" : "false"}
              </span>
            </Label>
          )}
          {result?.kind === "err" && (
            <Alert variant="error">
              <AlertTitle>Render failed</AlertTitle>
              <AlertDescription>
                {result.message}
                {result.line !== undefined && (
                  <span className="ml-2 text-xs font-mono opacity-70">
                    (line {result.line}, column {result.column})
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const TemplatePlaygroundPage = wrapInSuspense(TemplatePlaygroundContent);

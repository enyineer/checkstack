import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  PageLayout,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  CodeEditor,
  MarkdownBlock,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  usePerformance,
  cn,
} from "@checkstack/ui";
import {
  ChevronDown,
  ChevronRight,
  Puzzle,
  Blocks,
  BookOpen,
} from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { GitOpsApi } from "@checkstack/gitops-common";
import { extractErrorMessage } from "@checkstack/common";
import {
  generateSchemaYaml,
  generateYamlExample,
  type KindDescription,
} from "./kindRegistryYaml.logic";

// ─── Spec Schema Documentation ─────────────────────────────────────────────

function SpecSchemaDocumentationSection({
  docs,
  selections,
  onSelect,
}: {
  docs: NonNullable<KindDescription["specSchemaDocumentation"]>;
  selections: Record<string, string>;
  onSelect: (fieldPath: string, variantId: string) => void;
}) {
  const groupedDocs: Record<string, typeof docs> = {};
  for (const doc of docs) {
    if (!groupedDocs[doc.fieldPath]) {
      groupedDocs[doc.fieldPath] = [];
    }
    groupedDocs[doc.fieldPath].push(doc);
  }

  return (
    <div className="space-y-6">
      <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
        <BookOpen className="h-4 w-4" />
        Additional Schemas
      </h4>

      {Object.entries(groupedDocs).map(([fieldPath, fieldDocs]) => {
        return (
          <SpecSchemaDocumentationField
            key={fieldPath}
            fieldPath={fieldPath}
            docs={fieldDocs.toSorted((a, b) => a.label.localeCompare(b.label))}
            selections={selections}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

function SpecSchemaDocumentationField({
  fieldPath,
  docs,
  selections,
  onSelect,
}: {
  fieldPath: string;
  docs: NonNullable<KindDescription["specSchemaDocumentation"]>;
  selections: Record<string, string>;
  onSelect: (fieldPath: string, variantId: string) => void;
}) {
  const availableDocs = useMemo(() => {
    return docs.filter((doc) => {
      if (!doc.conditions || doc.conditions.length === 0) return true;
      return doc.conditions.every((cond) => {
        const selectedForField = selections[cond.fieldPath];
        if (!selectedForField) return false;
        return cond.variantIds.includes(selectedForField);
      });
    });
  }, [docs, selections]);

  const { isLowPower } = usePerformance();

  const currentSelection = selections[fieldPath] || "";
  const isValidSelection =
    currentSelection !== "" &&
    availableDocs.some((d) => (d.variantId || d.label) === currentSelection);

  useEffect(() => {
    if (currentSelection !== "" && !isValidSelection) {
      onSelect(fieldPath, "");
    }
  }, [currentSelection, isValidSelection, onSelect, fieldPath]);

  if (availableDocs.length === 0) {
    return <></>;
  }

  const selectedDoc = availableDocs.find(
    (d) => (d.variantId || d.label) === currentSelection,
  );

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            {fieldPath}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {availableDocs.length} variant{availableDocs.length > 1 ? "s" : ""}
          </span>
        </div>

        <div className="w-full sm:w-64">
          <Select
            value={isValidSelection ? currentSelection : ""}
            onValueChange={(val) => onSelect(fieldPath, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a schema variant..." />
            </SelectTrigger>
            <SelectContent>
              {availableDocs.map((doc, i) => (
                <SelectItem key={i} value={doc.variantId || doc.label}>
                  {doc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedDoc ? (
        <div
          className={cn(
            "space-y-3",
            !isLowPower &&
              "animate-in fade-in slide-in-from-top-2 duration-200",
          )}
        >
          {selectedDoc.description && (
            <div className="text-sm text-muted-foreground">
              <MarkdownBlock>{selectedDoc.description}</MarkdownBlock>
            </div>
          )}
          <div className="rounded-md overflow-hidden border border-input">
            <CodeEditor
              value={generateSchemaYaml(selectedDoc.specSchema)}
              language="yaml"
              readOnly
              onChange={() => {}}
              minHeight={`${Math.max(100, generateSchemaYaml(selectedDoc.specSchema).split("\n").length * 20 + 20)}px`}
            />
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic bg-surface-inset rounded-md p-4 text-center">
          Select a variant from the dropdown above to view its schema.
        </div>
      )}
    </div>
  );
}

// ─── Kind Card ─────────────────────────────────────────────────────────────

function KindCard({ kind }: { kind: KindDescription }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});

  const handleSelect = useCallback((fieldPath: string, variantId: string) => {
    setSelections((prev) => {
      if (prev[fieldPath] === variantId) return prev;
      return { ...prev, [fieldPath]: variantId };
    });
  }, []);

  const yamlExample = useMemo(() => generateYamlExample({ kind, selections }), [kind, selections]);

  return (
    <Card className="mb-3">
      <CardHeader
        className="cursor-pointer hover:bg-accent/50 transition-colors py-4"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          <Blocks className="h-5 w-5 text-info shrink-0" />
          <CardTitle className="text-lg">{kind.kind}</CardTitle>
          <Badge variant="secondary" className="font-mono text-xs">
            {kind.apiVersion}
          </Badge>
          {kind.extensions.length > 0 && (
            <Badge
              variant="outline"
              className="text-xs flex items-center gap-1"
            >
              <Puzzle className="h-3 w-3" />
              {kind.extensions.length} extension
              {kind.extensions.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <CardDescription className="ml-8">
          Entity kind with{" "}
          {Object.keys(kind.specSchema.properties ?? {}).length} base properties
          {kind.extensions.length > 0 &&
            ` and ${kind.extensions.length} extension namespace${kind.extensions.length > 1 ? "s" : ""}`}
        </CardDescription>
      </CardHeader>

      {isOpen && (
        <CardContent className="pt-0 space-y-6">
          <Accordion type="multiple">
            {/* Entity Envelope Fields */}
            <AccordionItem value="envelope" className="border-b-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Entity Envelope Fields
                </h4>
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-md overflow-hidden border border-input mt-2">
                  <CodeEditor
                    value={generateSchemaYaml(kind.metadataSchema)}
                    language="yaml"
                    readOnly
                    onChange={() => {}}
                    minHeight={`${Math.max(100, generateSchemaYaml(kind.metadataSchema).split("\n").length * 20 + 20)}px`}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Base Spec Schema */}
            <AccordionItem value="base-spec" className="border-b-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Base Spec Schema
                </h4>
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-md overflow-hidden border border-input mt-2">
                  <CodeEditor
                    value={generateSchemaYaml(kind.specSchema)}
                    language="yaml"
                    readOnly
                    onChange={() => {}}
                    minHeight={`${Math.max(100, generateSchemaYaml(kind.specSchema).split("\n").length * 20 + 20)}px`}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Extensions */}
          {kind.extensions.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Puzzle className="h-4 w-4" />
                Extensions
              </h4>
              {kind.extensions.map((ext) => (
                <div
                  key={ext.namespace}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      {ext.namespace}
                    </Badge>
                  </div>
                  <div className="rounded-md overflow-hidden border border-input">
                    <CodeEditor
                      value={generateSchemaYaml(ext.specSchema)}
                      language="yaml"
                      readOnly
                      onChange={() => {}}
                      minHeight={`${Math.max(100, generateSchemaYaml(ext.specSchema).split("\n").length * 20 + 20)}px`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Spec Schema Documentation */}
          {kind.specSchemaDocumentation &&
            kind.specSchemaDocumentation.length > 0 && (
              <SpecSchemaDocumentationSection
                docs={kind.specSchemaDocumentation}
                selections={selections}
                onSelect={handleSelect}
              />
            )}

          {/* YAML Example */}
          <div>
            <h4 className="text-sm font-medium mb-2 text-muted-foreground">
              YAML Example
            </h4>
            <div className="rounded-md overflow-hidden border border-input">
              <CodeEditor
                value={yamlExample}
                language="yaml"
                readOnly
                onChange={() => {}}
                minHeight={`${Math.max(100, yamlExample.split("\n").length * 20 + 20)}px`}
              />
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function KindRegistryPage() {
  const client = usePluginClient(GitOpsApi);

  const { data: kinds, isLoading, error } = client.listKinds.useQuery({});

  return (
    <PageLayout
      title="Entity Kind Registry"
      subtitle="Browse registered entity kinds, their spec schemas, and extensions from all plugins"
      icon={Blocks}
      loading={isLoading}
      maxWidth="full"
    >
      {error && (
        <Card>
          <CardHeader>
            <CardTitle>Error Loading Kind Registry</CardTitle>
            <CardDescription>
              {extractErrorMessage(error, "Unknown error")}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!isLoading && !error && (!kinds || kinds.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No entity kinds are registered. Kinds are registered by plugins
            during startup.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {(kinds ?? [])
          .toSorted((a, b) => a.kind.localeCompare(b.kind))
          .map((kind) => (
            <KindCard
              key={`${kind.apiVersion}::${kind.kind}`}
              kind={kind as KindDescription}
            />
          ))}
      </div>
    </PageLayout>
  );
}

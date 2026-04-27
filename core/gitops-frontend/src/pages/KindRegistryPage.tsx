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

// ─── Types ─────────────────────────────────────────────────────────────────

interface JsonSchemaProperty {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  required?: string[];
  description?: string;
  enum?: string[];
  anyOf?: JsonSchemaProperty[];
  default?: unknown;
}

interface KindDescription {
  apiVersion: string;
  kind: string;
  metadataSchema: JsonSchemaProperty;
  specSchema: JsonSchemaProperty;
  extensions: Array<{
    namespace: string;
    specSchema: JsonSchemaProperty;
  }>;
  specSchemaDocumentation?: Array<{
    fieldPath: string;
    variantId?: string;
    label: string;
    description?: string;
    specSchema: JsonSchemaProperty;
    conditions?: Array<{
      fieldPath: string;
      variantIds: string[];
    }>;
  }>;
}

// ─── Schema Display ────────────────────────────────────────────────────────



function generateSchemaYaml(schema: JsonSchemaProperty): string {
  const lines: string[] = [];
  
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required);
    for (const [key, prop] of Object.entries(schema.properties)) {
      emitProperty({
        lines,
        key,
        prop,
        indent: 0,
        required: required.has(key),
      });
    }
  } else {
    emitProperty({
      lines,
      key: "value",
      prop: schema,
      indent: 0,
      required: true,
    });
  }
  
  if (lines.length === 0) {
    return "# No properties defined";
  }
  
  return lines.join("\n");
}

// ─── YAML Example Generator ────────────────────────────────────────────────

function generateYamlExample({
  kind,
  selections,
}: {
  kind: KindDescription;
  selections?: Record<string, string>;
}): string {
  const lines = [`apiVersion: ${kind.apiVersion}`, `kind: ${kind.kind}`];

  if (kind.metadataSchema) {
    lines.push("metadata:");
    const metadataProps = kind.metadataSchema.properties ?? {};
    const metadataRequired = new Set(kind.metadataSchema.required);

    for (const [key, prop] of Object.entries(metadataProps)) {
      // Provide a nice default for name instead of generic "..."
      const customProp =
        key === "name"
          ? { ...prop, default: `my-${kind.kind.toLowerCase()}` }
          : prop;

      emitProperty({
        lines,
        key,
        prop: customProp,
        indent: 2,
        required: metadataRequired.has(key),
      });
    }
  } else {
    lines.push("metadata:", `  name: my-${kind.kind.toLowerCase()}`);
  }

  const baseProps = kind.specSchema.properties ?? {};
  const hasBaseProps = Object.keys(baseProps).length > 0;
  const hasExtensions = kind.extensions.length > 0;

  if (!hasBaseProps && !hasExtensions) {
    lines.push("spec: {}");
    return lines.join("\n");
  }

  lines.push("spec:");

  const baseRequired = new Set(kind.specSchema.required);
  for (const [key, prop] of Object.entries(baseProps)) {
    emitProperty({
      lines,
      key,
      prop,
      indent: 2,
      required: baseRequired.has(key),
      path: key,
      kind,
      selections,
    });
  }

  for (const ext of kind.extensions) {
    emitProperty({
      lines,
      key: ext.namespace,
      prop: ext.specSchema,
      indent: 2,
      required: false,
    });
  }

  return lines.join("\n");
}

/**
 * Recursively emits a YAML property with proper indentation.
 * Annotates optional and nullable fields with inline comments.
 */
function emitProperty({
  lines,
  key,
  prop,
  indent,
  required,
  path,
  kind,
  selections,
}: {
  lines: string[];
  key: string;
  prop: JsonSchemaProperty;
  indent: number;
  required: boolean;
  path?: string;
  kind?: KindDescription;
  selections?: Record<string, string>;
}) {
  const pad = " ".repeat(indent);

  let effectiveProp = prop;
  if (path && kind?.specSchemaDocumentation && selections && selections[path]) {
    const variantId = selections[path];
    const doc = kind.specSchemaDocumentation.find(
      (d) => d.fieldPath === path && (d.variantId || d.label) === variantId
    );
    if (doc) {
      effectiveProp = doc.specSchema;
    }
  }

  const annotation = buildAnnotation({ prop: effectiveProp, required });
  const effective = resolveEffective({ prop: effectiveProp });

  if (effective.type === "object" && effective.properties) {
    lines.push(`${pad}${key}:${annotation}`);
    const objRequired = new Set(effective.required);
    for (const [k, p] of Object.entries(effective.properties)) {
      emitProperty({
        lines,
        key: k,
        prop: p,
        indent: indent + 2,
        required: objRequired.has(k),
        path: path ? `${path}.${k}` : undefined,
        kind,
        selections,
      });
    }
  } else if (effective.type === "array") {
    lines.push(`${pad}${key}:${annotation}`);
    if (effective.items) {
      emitArrayItem({
        lines,
        itemSchema: effective.items,
        indent: indent + 2,
        path: path ? `${path}[]` : undefined,
        kind,
        selections,
      });
    } else {
      lines.push(`${pad}  - # ...`);
    }
  } else {
    let val = scalarExample({ prop: effective });
    
    if (key === "strategy" && path === "strategy" && selections?.["config"]) {
      val = `"${selections["config"]}"`;
    }
    if (key === "collectorId" && path === "collectors[].collectorId" && selections?.["collectors[].config"]) {
      val = `"${selections["collectors[].config"]}"`;
    }

    lines.push(`${pad}${key}: ${val}${annotation}`);
  }
}

/**
 * Emits a single array item (the `- ` prefix) with proper handling of
 * objects, nested arrays, and scalar values.
 */
function emitArrayItem({
  lines,
  itemSchema,
  indent,
  path,
  kind,
  selections,
}: {
  lines: string[];
  itemSchema: JsonSchemaProperty;
  indent: number;
  path?: string;
  kind?: KindDescription;
  selections?: Record<string, string>;
}) {
  const pad = " ".repeat(indent);
  const effective = resolveEffective({ prop: itemSchema });

  if (effective.type === "object" && effective.properties) {
    const itemRequired = new Set(effective.required);
    const entries = Object.entries(effective.properties);
    for (const [i, [k, p]] of entries.entries()) {
      const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
      
      const nextPath = path ? (path.endsWith("[]") ? `${path}.${k}` : `${path}[].${k}`) : undefined;
      
      let currentProp = p;
      if (nextPath && kind?.specSchemaDocumentation && selections && selections[nextPath]) {
        const variantId = selections[nextPath];
        const doc = kind.specSchemaDocumentation.find(
          (d) => d.fieldPath === nextPath && (d.variantId || d.label) === variantId
        );
        if (doc) {
          currentProp = doc.specSchema;
        }
      }

      const itemAnnotation = buildAnnotation({
        prop: currentProp,
        required: itemRequired.has(k),
      });
      const inner = resolveEffective({ prop: currentProp });

      if (inner.type === "object" && inner.properties) {
        // Recurse into nested objects
        lines.push(`${prefix}${k}:${itemAnnotation}`);
        const nestedRequired = new Set(inner.required);
        for (const [nk, np] of Object.entries(inner.properties)) {
          emitProperty({
            lines,
            key: nk,
            prop: np,
            indent: indent + 4,
            required: nestedRequired.has(nk),
            path: nextPath ? `${nextPath}.${nk}` : undefined,
            kind,
            selections,
          });
        }
      } else if (inner.type === "array") {
        lines.push(`${prefix}${k}:${itemAnnotation}`);
        if (inner.items) {
          emitArrayItem({
            lines,
            itemSchema: inner.items,
            indent: indent + 4,
            path: nextPath ? `${nextPath}[]` : undefined,
            kind,
            selections,
          });
        } else {
          lines.push(`${" ".repeat(indent + 4)}- # ...`);
        }
      } else {
        let val = scalarExample({ prop: currentProp });
        if (k === "collectorId" && nextPath === "collectors[].collectorId" && selections?.["collectors[].config"]) {
          val = `"${selections["collectors[].config"]}"`;
        }
        lines.push(
          `${prefix}${k}: ${val}${itemAnnotation}`,
        );
      }
    }
  } else {
    lines.push(`${pad}- ${scalarExample({ prop: itemSchema })}`);
  }
}

/**
 * Builds an inline YAML comment annotation for optional/nullable fields.
 */
function buildAnnotation({
  prop,
  required,
}: {
  prop: JsonSchemaProperty;
  required: boolean;
}): string {
  const tags: string[] = [];
  if (!required) tags.push("optional");
  if (isNullable({ prop })) tags.push("nullable");
  return tags.length > 0 ? ` # ${tags.join(", ")}` : "";
}

/**
 * Checks if a property allows null values (via anyOf with null type).
 */
function isNullable({ prop }: { prop: JsonSchemaProperty }): boolean {
  if (prop.anyOf) {
    return prop.anyOf.some((s) => s.type === "null");
  }
  return false;
}

/**
 * Resolves the effective schema by unwrapping nullable anyOf wrappers.
 */
function resolveEffective({
  prop,
}: {
  prop: JsonSchemaProperty;
}): JsonSchemaProperty {
  if (prop.anyOf) {
    const nonNull = prop.anyOf.filter((s) => s.type !== "null");
    if (nonNull.length === 1) return nonNull[0];
  }
  return prop;
}

/**
 * Returns a scalar YAML example value for a property.
 * Objects without defined properties (z.record) get a comment annotation.
 */
function scalarExample({ prop }: { prop: JsonSchemaProperty }): string {
  const effective = resolveEffective({ prop });
  if (effective.enum) return effective.enum.map((e) => `"${e}"`).join(" | ");
  if (effective.default !== undefined) return JSON.stringify(effective.default);
  switch (effective.type) {
    case "string": {
      return '"..."';
    }
    case "number":
    case "integer": {
      return "0";
    }
    case "boolean": {
      return "false";
    }
    case "array": {
      return "[]";
    }
    case "object": {
      // Object without properties = z.record() or z.unknown() — annotate
      return "{} # key-value pairs";
    }
    default: {
      return '"..."';
    }
  }
}

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
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
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
        <div className="text-sm text-muted-foreground italic bg-muted/50 rounded-md p-4 text-center">
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
          <Blocks className="h-5 w-5 text-blue-500 shrink-0" />
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

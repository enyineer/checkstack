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

const TYPE_COLORS: Record<string, string> = {
  string: "text-green-600 dark:text-green-400",
  number: "text-amber-600 dark:text-amber-400",
  integer: "text-amber-600 dark:text-amber-400",
  boolean: "text-red-600 dark:text-red-400",
  array: "text-blue-600 dark:text-blue-400",
  object: "text-purple-600 dark:text-purple-400",
};

function SchemaPropertyDisplay({
  schema,
  depth = 0,
}: {
  schema: JsonSchemaProperty;
  depth?: number;
}) {
  if (schema.enum) {
    return (
      <span className="text-green-600 dark:text-green-400">
        {schema.enum.map((e) => `"${e}"`).join(" | ")}
      </span>
    );
  }

  if (schema.anyOf) {
    return (
      <span>
        {schema.anyOf.map((s, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> | </span>}
            <SchemaPropertyDisplay schema={s} depth={depth} />
          </span>
        ))}
      </span>
    );
  }

  if (schema.type === "object" && schema.properties) {
    return (
      <div className="font-mono text-sm" style={{ marginLeft: depth * 16 }}>
        {"{"}
        {Object.entries(schema.properties).map(([key, value]) => (
          <div key={key} className="ml-4">
            <span className="text-blue-600 dark:text-blue-400">{key}</span>
            {schema.required?.includes(key) && (
              <span className="text-red-500">*</span>
            )}
            : <SchemaPropertyDisplay schema={value} depth={depth + 1} />
            {value.description && (
              <span className="text-muted-foreground ml-2 text-xs">
                // {value.description}
              </span>
            )}
          </div>
        ))}
        {"}"}
      </div>
    );
  }

  if (schema.type === "array" && schema.items) {
    return (
      <span>
        <SchemaPropertyDisplay schema={schema.items} depth={depth} />
        {"[]"}
      </span>
    );
  }

  const typeStr = schema.type ?? "unknown";
  return (
    <span className={TYPE_COLORS[typeStr] ?? "text-gray-600"}>
      {typeStr}
      {schema.default !== undefined && (
        <span className="text-muted-foreground ml-1">
          = {JSON.stringify(schema.default)}
        </span>
      )}
    </span>
  );
}

function SchemaBlock({
  schema,
  label,
}: {
  schema: JsonSchemaProperty;
  label: string;
}) {
  const hasProperties =
    schema.type === "object" &&
    schema.properties &&
    Object.keys(schema.properties).length > 0;

  if (!hasProperties) {
    return (
      <div>
        <h4 className="text-sm font-medium mb-2 text-muted-foreground">
          {label}
        </h4>
        <div className="bg-muted rounded-md p-3 text-sm text-muted-foreground italic">
          No properties defined
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-medium mb-2 text-muted-foreground">
        {label}
      </h4>
      <div className="bg-muted rounded-md p-3 overflow-x-auto">
        <SchemaPropertyDisplay schema={schema} />
      </div>
    </div>
  );
}

// ─── YAML Example Generator ────────────────────────────────────────────────

function generateYamlExample({ kind }: { kind: KindDescription }): string {
  const lines = [
    `apiVersion: ${kind.apiVersion}`,
    `kind: ${kind.kind}`,
    "metadata:",
    `  name: my-${kind.kind.toLowerCase()}`,
  ];

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
}: {
  lines: string[];
  key: string;
  prop: JsonSchemaProperty;
  indent: number;
  required: boolean;
}) {
  const pad = " ".repeat(indent);
  const annotation = buildAnnotation({ prop, required });

  // Resolve the effective schema (unwrap nullable / anyOf wrappers)
  const effective = resolveEffective({ prop });

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
      });
    }
  } else if (effective.type === "array") {
    lines.push(`${pad}${key}:${annotation}`);
    if (effective.items) {
      emitArrayItem({ lines, itemSchema: effective.items, indent: indent + 2 });
    } else {
      lines.push(`${pad}  - # ...`);
    }
  } else {
    lines.push(`${pad}${key}: ${scalarExample({ prop })}${annotation}`);
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
}: {
  lines: string[];
  itemSchema: JsonSchemaProperty;
  indent: number;
}) {
  const pad = " ".repeat(indent);
  const effective = resolveEffective({ prop: itemSchema });

  if (effective.type === "object" && effective.properties) {
    const itemRequired = new Set(effective.required);
    const entries = Object.entries(effective.properties);
    for (const [i, [k, p]] of entries.entries()) {
      const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
      const itemAnnotation = buildAnnotation({
        prop: p,
        required: itemRequired.has(k),
      });
      const inner = resolveEffective({ prop: p });

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
          });
        }
      } else if (inner.type === "array") {
        lines.push(`${prefix}${k}:${itemAnnotation}`);
        if (inner.items) {
          emitArrayItem({ lines, itemSchema: inner.items, indent: indent + 4 });
        } else {
          lines.push(`${" ".repeat(indent + 4)}- # ...`);
        }
      } else {
        lines.push(
          `${prefix}${k}: ${scalarExample({ prop: p })}${itemAnnotation}`,
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
  if (effective.enum) return `"${effective.enum[0]}"`;
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
}: {
  docs: NonNullable<KindDescription["specSchemaDocumentation"]>;
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  const handleSelect = useCallback((fieldPath: string, variantId: string) => {
    setSelections((prev) => {
      if (prev[fieldPath] === variantId) return prev;
      return { ...prev, [fieldPath]: variantId };
    });
  }, []);

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
            onSelect={handleSelect}
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
            <div className="text-sm text-muted-foreground italic">
              {selectedDoc.description}
            </div>
          )}
          <div className="bg-muted rounded-md p-3 overflow-x-auto">
            <SchemaPropertyDisplay schema={selectedDoc.specSchema} />
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
          {/* Base Spec Schema */}
          <SchemaBlock schema={kind.specSchema} label="Base Spec Schema" />

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
                  <div className="bg-muted rounded-md p-3 overflow-x-auto">
                    <SchemaPropertyDisplay schema={ext.specSchema} />
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
              />
            )}

          {/* YAML Example */}
          <div>
            <h4 className="text-sm font-medium mb-2 text-muted-foreground">
              YAML Example
            </h4>
            <pre className="bg-muted rounded-md p-3 overflow-x-auto text-sm">
              <code>{generateYamlExample({ kind })}</code>
            </pre>
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

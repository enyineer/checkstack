import { createContext, useContext, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  PageLayout,
  StatusPill,
  Markdown,
  cn,
  usePerformance,
} from "@checkstack/ui";
import {
  ChevronDown,
  Copy,
  Check,
  Lock,
  Globe,
  User,
  Server,
  FileCode,
  KeyRound,
} from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";
import {
  accessToneForUserType,
  isExternallyAccessible,
} from "./apiDocsStatus.logic";
import { accessToneStyles } from "./apiDocsTone";
import {
  generateFetchExample,
  type OpenApiSpec,
  type OperationObject,
  type ParameterObject,
  type SchemaObject,
} from "./apiDocsFetchExample";

/**
 * Pick the access-status icon for a userType. The glyph distinguishes the four
 * concrete types (public/user/service/authenticated); its color is driven by
 * the colorblind-safe access triad so the hue still maps to security posture.
 */
function getUserTypeIcon(userType?: string) {
  const iconColor = accessToneStyles[accessToneForUserType(userType)].icon;
  switch (userType) {
    case "public": {
      return <Globe className={cn("w-4 h-4", iconColor)} />;
    }
    case "user": {
      return <User className={cn("w-4 h-4", iconColor)} />;
    }
    case "service": {
      return <Server className={cn("w-4 h-4", iconColor)} />;
    }
    case "authenticated": {
      return <Lock className={cn("w-4 h-4", iconColor)} />;
    }
    default: {
      return <Lock className={cn("w-4 h-4", iconColor)} />;
    }
  }
}

/**
 * The multi-encoded access status pill: a tone-colored dot plus the exact
 * userType label (public/user/service/authenticated/unknown). Hue and dot
 * both carry the security posture so the signal is not color-only.
 */
function AccessStatusPill({ userType }: { userType?: string }) {
  return (
    <StatusPill tone={accessToneForUserType(userType)}>
      {userType ?? "unknown"}
    </StatusPill>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

const SchemasContext = createContext<Record<string, SchemaObject>>({});

const PRIMITIVE_COLORS: Record<string, string> = {
  string: "text-green-600 dark:text-green-400",
  number: "text-amber-600 dark:text-amber-400",
  boolean: "text-red-600 dark:text-red-400",
  integer: "text-amber-600 dark:text-amber-400",
  null: "text-muted-foreground",
};

function PrimitiveType({ type, format }: { type: string; format?: string }) {
  const className = PRIMITIVE_COLORS[type] ?? "text-muted-foreground";
  return (
    <span className={className}>
      {type}
      {format ? (
        <span className="text-muted-foreground"> &lt;{format}&gt;</span>
      ) : null}
    </span>
  );
}

const MAX_DEPTH = 12;

function SchemaDisplay({
  schema,
  depth = 0,
  refStack = [],
}: {
  schema?: SchemaObject;
  depth?: number;
  /** Tracks $refs already in the current chain to halt cycles. */
  refStack?: string[];
}) {
  const schemas = useContext(SchemasContext);

  if (!schema) return <span className="text-muted-foreground">unknown</span>;
  if (depth > MAX_DEPTH) {
    return <span className="text-muted-foreground">…</span>;
  }

  // Resolve $ref via the spec's components.schemas registry, guarding against
  // cycles. If the ref can't be resolved we show its name as a leaf.
  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop() ?? schema.$ref;
    if (refStack.includes(schema.$ref)) {
      return (
        <span
          className="text-purple-600 dark:text-purple-400"
          title="recursive reference"
        >
          {refName} ↻
        </span>
      );
    }
    const resolved = schemas[refName];
    if (!resolved) {
      return (
        <span className="text-purple-600 dark:text-purple-400">{refName}</span>
      );
    }
    return (
      <span>
        <span className="mr-1 text-purple-600 dark:text-purple-400">
          {refName}
        </span>
        <SchemaDisplay
          schema={resolved}
          depth={depth}
          refStack={[...refStack, schema.$ref]}
        />
      </span>
    );
  }

  // Union / intersection — render variants separated by | or & .
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants && variants.length > 0) {
    return (
      <span>
        {variants.map((v, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> | </span>}
            <SchemaDisplay schema={v} depth={depth} refStack={refStack} />
          </span>
        ))}
      </span>
    );
  }
  if (schema.allOf && schema.allOf.length > 0) {
    return (
      <span>
        {schema.allOf.map((v, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> &amp; </span>}
            <SchemaDisplay schema={v} depth={depth} refStack={refStack} />
          </span>
        ))}
      </span>
    );
  }

  // Treat type: ["string", "null"] as a nullable union.
  if (Array.isArray(schema.type)) {
    return (
      <span>
        {schema.type.map((t, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> | </span>}
            <PrimitiveType type={t} format={schema.format} />
          </span>
        ))}
      </span>
    );
  }

  if (schema.enum) {
    return (
      <span className="text-green-600 dark:text-green-400">
        {schema.enum
          .map((e) => (typeof e === "string" ? `"${e}"` : String(e)))
          .join(" | ")}
      </span>
    );
  }

  if (
    schema.type === "object" ||
    schema.properties ||
    schema.additionalProperties !== undefined
  ) {
    const props = schema.properties;
    const ap = schema.additionalProperties;

    // zod `z.record(K, V)` → no `properties`, just `additionalProperties: V`.
    // Render as `{ [key]: V }` so the value type is visible.
    if (!props && ap !== undefined && ap !== false) {
      return (
        <div
          className="inline-block font-mono text-sm align-top"
          style={{ marginLeft: depth * 16 }}
        >
          {"{ "}
          <span className="text-muted-foreground">[key]</span>:{" "}
          {ap === true ? (
            <span className="text-muted-foreground">any</span>
          ) : (
            <SchemaDisplay schema={ap} depth={depth + 1} refStack={refStack} />
          )}
          {" }"}
        </div>
      );
    }

    if (props) {
      return (
        <div
          className="inline-block font-mono text-sm align-top"
          style={{ marginLeft: depth * 16 }}
        >
          {"{"}
          {Object.entries(props).map(([key, value]) => (
            <div key={key} className="ml-4">
              <span className="text-blue-600 dark:text-blue-400">{key}</span>
              {schema.required?.includes(key) && (
                <span className="text-red-500">*</span>
              )}
              :{" "}
              <SchemaDisplay
                schema={value}
                depth={depth + 1}
                refStack={refStack}
              />
            </div>
          ))}
          {ap !== undefined && ap !== false && (
            <div className="ml-4">
              <span className="text-muted-foreground">[key]</span>:{" "}
              {ap === true ? (
                <span className="text-muted-foreground">any</span>
              ) : (
                <SchemaDisplay
                  schema={ap}
                  depth={depth + 1}
                  refStack={refStack}
                />
              )}
            </div>
          )}
          {"}"}
        </div>
      );
    }

    return <PrimitiveType type="object" />;
  }

  if (schema.type === "array" && schema.items) {
    return (
      <span>
        <SchemaDisplay
          schema={schema.items}
          depth={depth}
          refStack={refStack}
        />
        []
      </span>
    );
  }

  if (typeof schema.type === "string") {
    return <PrimitiveType type={schema.type} format={schema.format} />;
  }

  return <span className="text-muted-foreground">unknown</span>;
}

const parameterColumns: DataTableColumn<ParameterObject>[] = [
  {
    id: "name",
    header: "Name",
    cellClassName: "font-mono align-top",
    sortValue: (p) => p.name,
    cell: (p) => (
      <>
        <span className="text-blue-600 dark:text-blue-400">{p.name}</span>
        {p.required && <span className="text-red-500">*</span>}
      </>
    ),
  },
  {
    id: "type",
    header: "Type",
    cellClassName: "font-mono align-top",
    cell: (p) => <SchemaDisplay schema={p.schema} />,
  },
  {
    id: "description",
    header: "Description",
    cellClassName: "text-muted-foreground align-top",
    cell: (p) => p.description ?? "",
  },
];

function ParametersTable({
  parameters,
}: {
  parameters: ParameterObject[];
}) {
  const byLocation: Record<string, ParameterObject[]> = {};
  for (const p of parameters) {
    (byLocation[p.in] ??= []).push(p);
  }

  const sectionTitle: Record<string, string> = {
    query: "Query Parameters",
    path: "Path Parameters",
    header: "Header Parameters",
    cookie: "Cookie Parameters",
  };

  return (
    <div className="space-y-3">
      {(["path", "query", "header", "cookie"] as const).map((loc) => {
        const items = byLocation[loc];
        if (!items || items.length === 0) return null;
        return (
          <div key={loc}>
            <h4 className="mb-2 text-sm font-medium">{sectionTitle[loc]}</h4>
            <DataTable
              data={items}
              columns={parameterColumns}
              getRowId={(p) => `${p.in}:${p.name}`}
              searchable={false}
            />
          </div>
        );
      })}
    </div>
  );
}

function EndpointCard({
  path,
  method,
  operation,
  spec,
}: {
  path: string;
  method: string;
  operation: OperationObject;
  spec: OpenApiSpec;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const meta = operation["x-orpc-meta"];
  const inputSchema =
    operation.requestBody?.content?.["application/json"]?.schema;
  const outputSchema = Object.values(operation.responses ?? {})[0]?.content?.[
    "application/json"
  ]?.schema;

  const { isLowPower } = usePerformance();

  // Raw HTTP-method palette colors are an intentional API-docs convention and
  // are preserved deliberately; only the security/access status moves to the
  // colorblind-safe triad.
  const methodColors: Record<string, string> = {
    get: "bg-green-500",
    post: "bg-blue-500",
    put: "bg-amber-500",
    patch: "bg-orange-500",
    delete: "bg-red-500",
  };

  const accent = accessToneStyles[accessToneForUserType(meta?.userType)].accent;

  return (
    <div className="group mb-2">
      <Card
        className={cn(
          "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-0 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all",
          !isLowPower &&
            "group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl",
        )}
      >
        {/* Access status accent stripe: status by position + hue, not color alone. */}
        <span
          className={cn("absolute inset-y-0 left-0 w-1", accent)}
          aria-hidden
        />

        <CardHeader
          className="cursor-pointer py-3 pl-5 transition-colors hover:bg-surface-inset/60"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex items-center gap-3">
            <ChevronDown
              className={cn(
                "w-4 h-4 shrink-0 text-muted-foreground transition-transform",
                !isOpen && "-rotate-90",
              )}
            />
            <Badge
              className={`${methodColors[method]} text-white uppercase text-xs font-mono`}
            >
              {method}
            </Badge>
            <div className="flex min-w-0 flex-1 flex-col text-left">
              <code className="truncate font-mono text-sm font-medium text-foreground">
                {path}
              </code>
              {operation.summary && (
                <span className="truncate text-xs text-muted-foreground">
                  {operation.summary}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {getUserTypeIcon(meta?.userType)}
              <AccessStatusPill userType={meta?.userType} />
              {!isExternallyAccessible(meta?.userType) && (
                <Badge variant="destructive" className="text-xs">
                  Internal Only
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        {isOpen && (
          <CardContent className="space-y-4 border-t border-border/60 bg-surface/40 pl-5 pt-4">
          {operation.description && (
            <div className="text-sm leading-relaxed text-muted-foreground">
              <Markdown>{operation.description}</Markdown>
            </div>
          )}

          {meta?.accessRules && meta.accessRules.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium">
                Required Access Rules
              </h4>
              <div className="flex flex-wrap gap-2">
                {meta.accessRules.map((perm) => (
                  <Badge key={perm} variant="secondary">
                    {perm}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {operation.parameters && operation.parameters.length > 0 && (
            <ParametersTable parameters={operation.parameters} />
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {inputSchema && (
              <div>
                <h4 className="mb-2 text-sm font-medium">
                  {method.toLowerCase() === "get"
                    ? "Input Schema (encoded as query params)"
                    : "Input Schema"}
                </h4>
                <div className="p-3 overflow-x-auto rounded-md bg-surface-inset">
                  <SchemaDisplay schema={inputSchema} />
                </div>
              </div>
            )}

            {outputSchema && (
              <div>
                <h4 className="mb-2 text-sm font-medium">Output Schema</h4>
                <div className="p-3 overflow-x-auto rounded-md bg-surface-inset">
                  <SchemaDisplay schema={outputSchema} />
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Fetch Example</h4>
              <CopyButton
                text={generateFetchExample({ path, method, operation, spec })}
              />
            </div>
            <pre className="p-3 overflow-x-auto text-sm rounded-md bg-surface-inset">
              <code>{generateFetchExample({ path, method, operation, spec })}</code>
            </pre>
          </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/**
 * An access filter button that echoes the same status triad used on the
 * endpoint rows via a leading tone dot. Selection logic is unchanged: it is
 * still primary when active and outline otherwise.
 */
function FilterChip({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: "ok" | "warn";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "primary" : "outline"}
      size="sm"
      onClick={onClick}
      className="gap-1.5"
    >
      <span
        className={cn("size-1.5 rounded-full", accessToneStyles[tone].dot)}
        aria-hidden
      />
      {label}
    </Button>
  );
}

export function ApiDocsPage() {
  const [spec, setSpec] = useState<OpenApiSpec>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  // Default to showing externally accessible endpoints only
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(["authenticated", "public"]),
  );

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const showAll = () => {
    setSelectedTypes(new Set());
  };

  useEffect(() => {
    const fetchSpec = async () => {
      try {
        const response = await fetch("/api/openapi.json");
        if (!response.ok) {
          throw new Error(`Failed to fetch API spec: ${response.statusText}`);
        }
        const data = (await response.json()) as OpenApiSpec;
        setSpec(data);
      } catch (error_) {
        setError(extractErrorMessage(error_, "Unknown error"));
      } finally {
        setLoading(false);
      }
    };

    void fetchSpec();
  }, []);

  if (loading || !spec) {
    return (
      <PageLayout title="API Documentation" icon={FileCode} loading={loading}>
        {error && (
          <Card>
            <CardHeader>
              <CardTitle>Error Loading API Documentation</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        )}
      </PageLayout>
    );
  }

  // Group endpoints by tag/plugin
  const endpointsByPlugin: Record<
    string,
    Array<{ path: string; method: string; operation: OperationObject }>
  > = {};

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      // Apply userType filter if types are selected
      const meta = operation["x-orpc-meta"];
      const opUserType = meta?.userType ?? "unknown";
      if (selectedTypes.size > 0 && !selectedTypes.has(opUserType)) {
        continue;
      }

      // Extract plugin name from path (e.g. /rest/catalog/getEntities -> catalog).
      // Paths in the generated spec are prefixed with /rest (the REST mount); a
      // bare /plugin/... fallback is kept in case the prefix is ever stripped.
      const pluginMatch = path.match(/^\/?(?:rest\/)?([^/]+)/);
      const pluginName = pluginMatch?.[1] ?? "other";

      if (!endpointsByPlugin[pluginName]) {
        endpointsByPlugin[pluginName] = [];
      }
      endpointsByPlugin[pluginName].push({ path, method, operation });
    }
  }

  return (
    <SchemasContext.Provider value={spec.components?.schemas ?? {}}>
      <PageLayout
        title={spec.info.title}
        subtitle={spec.info.description}
        icon={FileCode}
        loading={loading}
        maxWidth="full"
      >
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--d-card-r)] border border-border/70 bg-surface-2/60 p-3">
          <Badge variant="secondary">v{spec.info.version}</Badge>
          <span className="ml-1 text-sm text-muted-foreground">
            Filter by access:
          </span>
          <Button
            variant={selectedTypes.size === 0 ? "primary" : "outline"}
            size="sm"
            onClick={showAll}
          >
            All
          </Button>
          <FilterChip
            label="Authenticated"
            tone="ok"
            active={selectedTypes.has("authenticated")}
            onClick={() => toggleType("authenticated")}
          />
          <FilterChip
            label="Public"
            tone="ok"
            active={selectedTypes.has("public")}
            onClick={() => toggleType("public")}
          />
          <FilterChip
            label="User Only"
            tone="warn"
            active={selectedTypes.has("user")}
            onClick={() => toggleType("user")}
          />
          <FilterChip
            label="Service Only"
            tone="warn"
            active={selectedTypes.has("service")}
            onClick={() => toggleType("service")}
          />
        </div>

        <Card className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
          <CardHeader className="flex-row items-start gap-3 space-y-0 p-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </span>
            <div className="space-y-1">
              <CardTitle>Authentication</CardTitle>
              <CardDescription>
                Endpoints marked as <strong>authenticated</strong> or{" "}
                <strong>public</strong> can be accessed using an application
                token. Other endpoints are for internal use only.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0 pt-4">
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-surface-inset p-1 pl-3">
              <pre className="flex-1 overflow-x-auto text-sm">
                <code>
                  Authorization: Bearer ck_{"<application-id>"}_{"<secret>"}
                </code>
              </pre>
              <CopyButton text="Authorization: Bearer ck_<application-id>_<secret>" />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-10">
          {Object.entries(endpointsByPlugin)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([pluginName, endpoints]) => (
              <div key={pluginName}>
                <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border/60 pb-2">
                  <h2 className="text-xl font-semibold capitalize">
                    {pluginName}
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {endpoints.length} endpoints
                  </span>
                </div>
                {endpoints.map(({ path, method, operation }) => (
                  <EndpointCard
                    key={`${method}-${path}`}
                    path={path}
                    method={method}
                    operation={operation}
                    spec={spec}
                  />
                ))}
              </div>
            ))}
        </div>
      </PageLayout>
    </SchemasContext.Provider>
  );
}

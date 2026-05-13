import { createContext, useContext, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  PageLayout,
} from "@checkstack/ui";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Lock,
  Globe,
  User,
  Server,
  FileCode,
} from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";

interface OpenApiSpec {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, OperationObject>>;
  components?: {
    schemas?: Record<string, SchemaObject>;
  };
}

interface ParameterObject {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: SchemaObject;
      };
    };
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: SchemaObject }>;
    }
  >;
  "x-orpc-meta"?: {
    userType?: string;
    accessRules?: string[];
  };
}

interface SchemaObject {
  type?: string | string[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  description?: string;
  enum?: (string | number | boolean | null)[];
  format?: string;
  nullable?: boolean;
  $ref?: string;
  additionalProperties?: SchemaObject | boolean;
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
}

function getUserTypeIcon(userType?: string) {
  switch (userType) {
    case "public": {
      return <Globe className="w-4 h-4 text-green-500" />;
    }
    case "user": {
      return <User className="w-4 h-4 text-blue-500" />;
    }
    case "service": {
      return <Server className="w-4 h-4 text-purple-500" />;
    }
    case "authenticated": {
      return <Lock className="w-4 h-4 text-amber-500" />;
    }
    default: {
      return <Lock className="w-4 h-4 text-gray-500" />;
    }
  }
}

function getUserTypeBadge(userType?: string) {
  const colors: Record<string, string> = {
    public:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    user: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    service:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    authenticated:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  };
  return (
    colors[userType ?? ""] ??
    "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  );
}

/**
 * Check if an endpoint is accessible via external application tokens.
 */
function isExternallyAccessible(userType?: string): boolean {
  return userType === "authenticated" || userType === "public";
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

function generateFetchExample(
  path: string,
  method: string,
  operation: OperationObject,
): string {
  const baseUrl = "http://localhost:3000";
  const upperMethod = method.toUpperCase();
  const hasBody = operation.requestBody?.content?.["application/json"]?.schema;

  const queryParams =
    operation.parameters?.filter((p) => p.in === "query") ?? [];
  const queryString =
    queryParams.length > 0
      ? "?" +
        queryParams
          .map((p) => `${p.name}=<${p.required ? "required" : "optional"}>`)
          .join("&")
      : "";

  const includeContentType = hasBody;
  let example = `const response = await fetch("${baseUrl}${path}${queryString}", {
  method: "${upperMethod}",
  headers: {
${includeContentType ? '    "Content-Type": "application/json",\n' : ""}    "Authorization": "Bearer ck_<application-id>_<secret>"
  }`;

  if (hasBody) {
    example += `,
  body: JSON.stringify({
    // Request body - see schema above
  })`;
  }

  example += `
});

const data = await response.json();`;

  return example;
}

const SchemasContext = createContext<Record<string, SchemaObject>>({});

const PRIMITIVE_COLORS: Record<string, string> = {
  string: "text-green-600 dark:text-green-400",
  number: "text-amber-600 dark:text-amber-400",
  boolean: "text-red-600 dark:text-red-400",
  integer: "text-amber-600 dark:text-amber-400",
  null: "text-gray-500",
};

function PrimitiveType({ type, format }: { type: string; format?: string }) {
  const className = PRIMITIVE_COLORS[type] ?? "text-gray-600";
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
            <span className="text-gray-600">any</span>
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
                <span className="text-gray-600">any</span>
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

  return <span className="text-gray-600">unknown</span>;
}

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
            <div className="overflow-x-auto rounded-md bg-muted">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border/50">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr
                      key={`${p.in}:${p.name}`}
                      className="align-top border-t border-border/30"
                    >
                      <td className="px-3 py-2 font-mono">
                        <span className="text-blue-600 dark:text-blue-400">
                          {p.name}
                        </span>
                        {p.required && (
                          <span className="text-red-500">*</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        <SchemaDisplay schema={p.schema} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.description ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
}: {
  path: string;
  method: string;
  operation: OperationObject;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const meta = operation["x-orpc-meta"];
  const inputSchema =
    operation.requestBody?.content?.["application/json"]?.schema;
  const outputSchema = Object.values(operation.responses ?? {})[0]?.content?.[
    "application/json"
  ]?.schema;

  const methodColors: Record<string, string> = {
    get: "bg-green-500",
    post: "bg-blue-500",
    put: "bg-amber-500",
    patch: "bg-orange-500",
    delete: "bg-red-500",
  };

  return (
    <Card className="mb-2">
      <CardHeader
        className="py-3 transition-colors cursor-pointer hover:bg-accent/50"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <Badge
            className={`${methodColors[method]} text-white uppercase text-xs font-mono`}
          >
            {method}
          </Badge>
          <code className="flex-1 font-mono text-sm text-left">{path}</code>
          <div className="flex items-center gap-2">
            {getUserTypeIcon(meta?.userType)}
            <Badge
              variant="outline"
              className={getUserTypeBadge(meta?.userType)}
            >
              {meta?.userType ?? "unknown"}
            </Badge>
            {!isExternallyAccessible(meta?.userType) && (
              <Badge variant="destructive" className="text-xs">
                Internal Only
              </Badge>
            )}
          </div>
        </div>
        {operation.summary && (
          <CardDescription className="ml-8 text-left">
            {operation.summary}
          </CardDescription>
        )}
      </CardHeader>

      {isOpen && (
        <CardContent className="pt-0 space-y-4">
          {operation.description && (
            <p className="text-sm text-muted-foreground">
              {operation.description}
            </p>
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
                <div className="p-3 overflow-x-auto rounded-md bg-muted">
                  <SchemaDisplay schema={inputSchema} />
                </div>
              </div>
            )}

            {outputSchema && (
              <div>
                <h4 className="mb-2 text-sm font-medium">Output Schema</h4>
                <div className="p-3 overflow-x-auto rounded-md bg-muted">
                  <SchemaDisplay schema={outputSchema} />
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Fetch Example</h4>
              <CopyButton
                text={generateFetchExample(path, method, operation)}
              />
            </div>
            <pre className="p-3 overflow-x-auto text-sm rounded-md bg-muted">
              <code>{generateFetchExample(path, method, operation)}</code>
            </pre>
          </div>
        </CardContent>
      )}
    </Card>
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
        <Badge variant="secondary">v{spec.info.version}</Badge>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Filter by access:
          </span>
          <Button
            variant={selectedTypes.size === 0 ? "primary" : "outline"}
            size="sm"
            onClick={showAll}
          >
            All
          </Button>
          <Button
            variant={selectedTypes.has("authenticated") ? "primary" : "outline"}
            size="sm"
            onClick={() => toggleType("authenticated")}
          >
            Authenticated
          </Button>
          <Button
            variant={selectedTypes.has("public") ? "primary" : "outline"}
            size="sm"
            onClick={() => toggleType("public")}
          >
            Public
          </Button>
          <Button
            variant={selectedTypes.has("user") ? "primary" : "outline"}
            size="sm"
            onClick={() => toggleType("user")}
          >
            User Only
          </Button>
          <Button
            variant={selectedTypes.has("service") ? "primary" : "outline"}
            size="sm"
            onClick={() => toggleType("service")}
          >
            Service Only
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>
              Endpoints marked as <strong>authenticated</strong> or{" "}
              <strong>public</strong> can be accessed using an application
              token. Other endpoints are for internal use only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="p-3 overflow-x-auto text-sm rounded-md bg-muted">
              <code>
                Authorization: Bearer ck_{"<application-id>"}_{"<secret>"}
              </code>
            </pre>
          </CardContent>
        </Card>

        <div className="space-y-8">
          {Object.entries(endpointsByPlugin)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([pluginName, endpoints]) => (
              <div key={pluginName}>
                <h2 className="mb-4 text-xl font-semibold capitalize">
                  {pluginName}
                </h2>
                {endpoints.map(({ path, method, operation }) => (
                  <EndpointCard
                    key={`${method}-${path}`}
                    path={path}
                    method={method}
                    operation={operation}
                  />
                ))}
              </div>
            ))}
        </div>
      </PageLayout>
    </SchemasContext.Provider>
  );
}

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
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
} from "lucide-react";

interface OpenApiSpec {
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, OperationObject>>;
}

interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
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
  type?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  description?: string;
  enum?: string[];
  $ref?: string;
}

function getUserTypeIcon(userType?: string) {
  switch (userType) {
    case "public": {
      return <Globe className="h-4 w-4 text-green-500" />;
    }
    case "user": {
      return <User className="h-4 w-4 text-blue-500" />;
    }
    case "service": {
      return <Server className="h-4 w-4 text-purple-500" />;
    }
    case "authenticated": {
      return <Lock className="h-4 w-4 text-amber-500" />;
    }
    default: {
      return <Lock className="h-4 w-4 text-gray-500" />;
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
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function generateFetchExample(
  path: string,
  method: string,
  operation: OperationObject
): string {
  const baseUrl = "http://localhost:3000";
  const hasBody = operation.requestBody?.content?.["application/json"]?.schema;

  let example = `const response = await fetch("${baseUrl}${path}", {
  method: "${method.toUpperCase()}",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ck_<application-id>_<secret>"
  }`;

  if (hasBody) {
    example += `,
  body: JSON.stringify({
    // Request body - see schema below
  })`;
  }

  example += `
});

const data = await response.json();`;

  return example;
}

function SchemaDisplay({
  schema,
  depth = 0,
}: {
  schema?: SchemaObject;
  depth?: number;
}) {
  if (!schema) return <span className="text-muted-foreground">unknown</span>;

  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop();
    return (
      <span className="text-purple-600 dark:text-purple-400">{refName}</span>
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
            : <SchemaDisplay schema={value} depth={depth + 1} />
          </div>
        ))}
        {"}"}
      </div>
    );
  }

  if (schema.type === "array" && schema.items) {
    return (
      <span>
        <SchemaDisplay schema={schema.items} depth={depth} />
        []
      </span>
    );
  }

  if (schema.enum) {
    return (
      <span className="text-green-600 dark:text-green-400">
        {schema.enum.map((e) => `"${e}"`).join(" | ")}
      </span>
    );
  }

  const typeColors: Record<string, string> = {
    string: "text-green-600 dark:text-green-400",
    number: "text-amber-600 dark:text-amber-400",
    boolean: "text-red-600 dark:text-red-400",
    integer: "text-amber-600 dark:text-amber-400",
  };

  return (
    <span className={typeColors[schema.type ?? ""] ?? "text-gray-600"}>
      {schema.type ?? "unknown"}
    </span>
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
        className="cursor-pointer hover:bg-accent/50 transition-colors py-3"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <Badge
            className={`${methodColors[method]} text-white uppercase text-xs font-mono`}
          >
            {method}
          </Badge>
          <code className="font-mono text-sm flex-1 text-left">{path}</code>
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
              <h4 className="text-sm font-medium mb-2">Required Access Rules</h4>
              <div className="flex flex-wrap gap-2">
                {meta.accessRules.map((perm) => (
                  <Badge key={perm} variant="secondary">
                    {perm}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {inputSchema && (
              <div>
                <h4 className="text-sm font-medium mb-2">Input Schema</h4>
                <div className="bg-muted rounded-md p-3 overflow-x-auto">
                  <SchemaDisplay schema={inputSchema} />
                </div>
              </div>
            )}

            {outputSchema && (
              <div>
                <h4 className="text-sm font-medium mb-2">Output Schema</h4>
                <div className="bg-muted rounded-md p-3 overflow-x-auto">
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
            <pre className="bg-muted rounded-md p-3 overflow-x-auto text-sm">
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
    new Set(["authenticated", "public"])
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
        setError(error_ instanceof Error ? error_.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    void fetchSpec();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="animate-pulse">Loading API documentation...</div>
      </div>
    );
  }

  if (error || !spec) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Error Loading API Documentation</CardTitle>
            <CardDescription>{error ?? "Unknown error"}</CardDescription>
          </CardHeader>
        </Card>
      </div>
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

      // Extract plugin name from path (e.g., /catalog/getEntities -> catalog)
      // Path can be /api/plugin/... or /plugin/... depending on OpenAPI prefix setting
      const pluginMatch = path.match(/^\/?(?:api\/)?([^/]+)/);
      const pluginName = pluginMatch?.[1] ?? "other";

      if (!endpointsByPlugin[pluginName]) {
        endpointsByPlugin[pluginName] = [];
      }
      endpointsByPlugin[pluginName].push({ path, method, operation });
    }
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{spec.info.title}</h1>
        <p className="text-muted-foreground mt-2">{spec.info.description}</p>
        <Badge variant="secondary" className="mt-2">
          v{spec.info.version}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Filter by access:</span>
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
            <strong>public</strong> can be accessed using an application token.
            Other endpoints are for internal use only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted rounded-md p-3 overflow-x-auto text-sm">
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
              <h2 className="text-xl font-semibold mb-4 capitalize">
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
    </div>
  );
}

---
title: "Public REST API"
description: "Call Checkstack from external clients using REST or oRPC, with curl, JavaScript, and Python examples."
---

Checkstack exposes its plugins' procedures through two HTTP surfaces. Pick whichever shape suits your client - the REST surface is friendlier for ad-hoc curl/Python calls, the native oRPC surface supports batching.

Authentication for both surfaces uses an Application API key. Create the key first via the UI (see [API keys](/checkstack/user-guide/reference/api-keys/)) and pass it on every request.

## Two API surfaces

The same contracts are exposed through two HTTP shapes:

| Mount | Shape | Body / params |
|-------|-------|----------------|
| `/api/{pluginId}/` | oRPC native wire protocol - POST a `{procedure: input}` envelope. Supports batching multiple procedures per request. | `{"getSystems": {}}` |
| `/rest/{pluginId}/{procedure}` | REST / OpenAPI - one procedure per request. Method depends on the procedure (see table below). | varies |

The machine-readable schema for the REST surface is published at `/api/openapi.json` (paths listed there are under `/rest/...`). The method for each endpoint comes directly from the contract definition - always trust the spec over this page.

## Authentication

Use the `Authorization` header with the Bearer scheme:

```http
Authorization: Bearer ck_{applicationId}_{secret}
```

## Calling REST endpoints (recommended for ad-hoc clients)

The HTTP method follows REST conventions, derived from the procedure name and `operationType` in the contract:

| Procedure shape | HTTP method | Input goes to |
|-----------------|-------------|---------------|
| Query (read)                     | `GET`    | URL query params, bracket-notation encoded |
| `create*` / `add*` mutation      | `POST`   | JSON body |
| `update*` mutation               | `PATCH`  | JSON body |
| `delete*` / `remove*` mutation   | `DELETE` | JSON body |
| Bulk query (`getBulk*`, or any query taking a large array) | `POST` | JSON body |

> [!NOTE]
> The "bulk query is POST" exception exists because `@orpc/openapi@1.13.x` has no automatic GET to POST fallback when the URL would exceed length limits (browsers / proxies typically cap around 8 KB), and bracket-encoding a large `string[]` blows past that quickly. The OpenAPI spec at `/api/openapi.json` lists the real method for every endpoint.

### Examples

**Query (`GET`, bracket-notation params):**

```bash
curl "https://your-checkstack-instance.com/rest/healthcheck/getSystemHealthStatus?systemId=YOUR_SYSTEM_ID" \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET"
```

Nested object inputs and arrays use bracket notation:

```bash
# Input: { filter: { status: "active" }, ids: ["a", "b"] }
curl "https://your-checkstack-instance.com/rest/foo/getItems?filter[status]=active&ids[0]=a&ids[1]=b" \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET"
```

#### Typed query parameters

Query-string values are always strings on the wire, but the REST surface coerces each one to the type its procedure declares, so you pass `true` / `false` and numbers as plain text:

```bash
# includeResolved is a boolean; count is a number. Both are coerced from the
# query string, so this returns resolved incidents too.
curl "https://your-checkstack-instance.com/rest/incident/listIncidents?includeResolved=true" \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET"
```

> [!NOTE]
> Coercion is type-aware: `includeResolved=false` is read as the boolean `false` (not "any non-empty string is true"). Booleans accept `true` / `false`, numbers accept their decimal text, and dates accept ISO-8601 strings. This applies only to the REST surface; the native oRPC surface already carries real JSON types.

**Create (`POST`):**

```bash
curl -X POST https://your-checkstack-instance.com/rest/incident/createIncident \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title": "Database down", "severity": "high"}'
```

**Update (`PATCH`):**

```bash
curl -X PATCH https://your-checkstack-instance.com/rest/incident/updateIncident \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"id": "inc_123", "status": "resolved"}'
```

**Delete (`DELETE`):**

```bash
curl -X DELETE https://your-checkstack-instance.com/rest/incident/deleteIncident \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"id": "inc_123"}'
```

**Bulk query (`POST` despite being read-only):**

```bash
curl -X POST https://your-checkstack-instance.com/rest/healthcheck/getBulkSystemHealthStatus \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"systemIds": ["sys_1", "sys_2", "sys_3"]}'
```

> [!NOTE]
> If you POST a raw JSON body to `/api/{pluginId}/{procedure}` and get `"Invalid input: expected object, received undefined"`, you're hitting the oRPC wire-protocol mount - use the `/rest/...` path described above instead, or wrap the body in `{procedure: input}` and POST to `/api/{pluginId}/`.

## Calling oRPC endpoints

All oRPC endpoints are available at `/api/{pluginId}/` and accept JSON POST requests.

### Basic example (curl)

```bash
curl -X POST https://your-checkstack-instance.com/api/catalog/ \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"getSystems": {}}'
```

### JavaScript/TypeScript (fetch)

```typescript
const API_BASE = "https://your-checkstack-instance.com";
const API_KEY = "ck_YOUR_APP_ID_YOUR_SECRET";

// Call a single procedure
async function callRpc<T>(
  pluginId: string,
  procedure: string,
  input?: unknown
): Promise<T> {
  const response = await fetch(`${API_BASE}/api/${pluginId}/`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ [procedure]: input ?? {} }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result[procedure];
}

// Usage examples
const systems = await callRpc("catalog", "getSystems");
const health = await callRpc("healthcheck", "getHealthChecks");
```

### Batching multiple calls

oRPC supports batching multiple procedure calls in a single request:

```typescript
const response = await fetch(`${API_BASE}/api/catalog/`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    getSystems: {},
    getGroups: {},
  }),
});

const { getSystems, getGroups } = await response.json();
```

### Python example

```python
import requests

API_BASE = "https://your-checkstack-instance.com"
API_KEY = "ck_YOUR_APP_ID_YOUR_SECRET"

def call_rpc(plugin_id: str, procedure: str, input_data=None):
    response = requests.post(
        f"{API_BASE}/api/{plugin_id}/",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={procedure: input_data or {}},
    )
    response.raise_for_status()
    return response.json()[procedure]

# Usage
systems = call_rpc("catalog", "getSystems")
```

## Available endpoints

Each plugin exposes its procedures at both `/api/{pluginId}/` (oRPC wire format) and `/rest/{pluginId}/{procedure}` (REST). Common plugins include:

| Plugin | oRPC mount | REST mount | Example procedures |
|--------|------------|------------|-------------------|
| `catalog` | `/api/catalog/` | `/rest/catalog/...` | `getSystems`, `getGroups` |
| `healthcheck` | `/api/healthcheck/` | `/rest/healthcheck/...` | `getHealthChecks`, `getHistory` |
| `maintenance` | `/api/maintenance/` | `/rest/maintenance/...` | `getWindows`, `scheduleWindow` |
| `incident` | `/api/incident/` | `/rest/incident/...` | `getIncidents`, `createIncident` |

> [!NOTE]
> Available procedures depend on your application's assigned access. Check each plugin's contract definition for the full procedure list and required access.

## Error handling

oRPC returns structured error responses:

```json
{
  "code": "FORBIDDEN",
  "message": "Missing access: catalog.catalog.read"
}
```

Common error codes:

- **`UNAUTHORIZED`**: Missing or invalid API key
- **`FORBIDDEN`**: Valid key but missing required access
- **`NOT_FOUND`**: Procedure or resource not found
- **`BAD_REQUEST`**: Invalid input parameters

## Access reference

Applications use the same RBAC system as users. To call an endpoint, the application must have a role with the required access rule. Access rule format:

```text
{pluginId}.{accessRuleId}
```

Example: To call `catalog.getSystems`, the application needs a role with `catalog.catalog.read` access rule.

## See also

- [API keys](/checkstack/user-guide/reference/api-keys/) - creating, rotating, and assigning applications in the UI.
- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) - operator reference for human login strategies.

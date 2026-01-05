---
title: External Applications (API Keys)
---

# External Applications (API Keys)

External Applications provide programmatic access to the Checkmate API for non-human clients like CI/CD pipelines, monitoring tools, and custom integrations.

## Overview

- **Identity Type**: Applications are RBAC-controlled identities (like users), not trusted services
- **Authentication**: Bearer token via the `Authorization` header
- **Permissions**: Enforced by standard RBAC - applications must be assigned roles with appropriate permissions

## Creating an Application

1. Navigate to **Authentication Settings** → **Applications** tab
2. Click **Create Application**
3. Enter a name and optional description
4. **Copy the secret immediately** - it will never be shown again

New applications are automatically assigned the `applications` role. Assign additional roles via the inline checkboxes in the Applications table.

## Token Format

Application secrets follow a structured format:

```
ck_{applicationId}_{randomSecret}
```

- **`ck_`**: Prefix for easy identification in logs
- **`applicationId`**: UUID identifying the application
- **`randomSecret`**: Cryptographically random token

Example:
```
ck_a1b2c3d4-e5f6-7890-abcd-ef1234567890_f8k2mN9xZpW3qR7vL5tY
```

## Authentication

Use the `Authorization` header with the Bearer scheme:

```http
Authorization: Bearer ck_{applicationId}_{secret}
```

## Calling oRPC Endpoints

All oRPC endpoints are available at `/api/{pluginId}/` and accept JSON POST requests.

### Basic Example (curl)

```bash
curl -X POST https://your-checkmate-instance.com/api/catalog/ \
  -H "Authorization: Bearer ck_YOUR_APP_ID_YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"getSystems": {}}'
```

### JavaScript/TypeScript (fetch)

```typescript
const API_BASE = "https://your-checkmate-instance.com";
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

### Batching Multiple Calls

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

### Python Example

```python
import requests

API_BASE = "https://your-checkmate-instance.com"
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

## Available Endpoints

Each plugin exposes its procedures at `/api/{pluginId}/`. Common endpoints include:

| Plugin | Endpoint | Example Procedures |
|--------|----------|-------------------|
| `catalog` | `/api/catalog/` | `getSystems`, `getGroups` |
| `healthcheck` | `/api/healthcheck/` | `getHealthChecks`, `getHistory` |
| `maintenance` | `/api/maintenance/` | `getWindows`, `scheduleWindow` |
| `incident` | `/api/incident/` | `getIncidents`, `createIncident` |

> **Note**: Available procedures depend on your application's assigned permissions. Check each plugin's contract definition for the full procedure list and required permissions.

## Error Handling

oRPC returns structured error responses:

```json
{
  "code": "FORBIDDEN",
  "message": "Missing permission: catalog.catalog.read"
}
```

Common error codes:
- **`UNAUTHORIZED`**: Missing or invalid API key
- **`FORBIDDEN`**: Valid key but missing required permission
- **`NOT_FOUND`**: Procedure or resource not found
- **`BAD_REQUEST`**: Invalid input parameters

## Security Best Practices

1. **Store secrets securely** - Use environment variables or secret managers
2. **Rotate secrets periodically** - Use the "Regenerate Secret" button in the UI
3. **Apply least privilege** - Assign only the roles/permissions needed
4. **Monitor usage** - Check the "Last Used" column for inactive applications
5. **Delete unused applications** - Expired keys stop working immediately

## Permissions Reference

Applications use the same RBAC system as users. To call an endpoint, the application must have a role with the required permission. Permission format:

```
{pluginId}.{permissionId}
```

Example: To call `catalog.getSystems`, the application needs a role with `catalog.catalog.read` permission.

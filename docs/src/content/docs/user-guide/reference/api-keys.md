---
title: "API keys (External Applications)"
description: "Create, rotate, and assign Checkstack API keys for non-human clients like CI pipelines and monitoring tools."
---

External Applications provide programmatic access to the Checkstack API for non-human clients like CI/CD pipelines, monitoring tools, and custom integrations. This page covers managing applications in the UI. For the wire format, methods, and examples, see [Public REST API](/checkstack/user-guide/reference/public-rest-api/).

## Overview

- **Identity type**: Applications are RBAC-controlled identities (like users), not trusted services
- **Authentication**: Bearer token via the `Authorization` header
- **Access**: Enforced by standard RBAC - applications must be assigned roles with appropriate access rules

## Creating an application

1. Navigate to **Authentication Settings** -> **Applications** tab
2. Click **Create Application**
3. Enter a name and optional description
4. **Copy the secret immediately** - it will never be shown again

New applications are automatically assigned the `applications` role. Assign additional roles via the inline checkboxes in the Applications table.

## Token format

Application secrets follow a structured format:

```text
ck_{applicationId}_{randomSecret}
```

- **`ck_`**: Prefix for easy identification in logs
- **`applicationId`**: UUID identifying the application
- **`randomSecret`**: Cryptographically random token

Example:

```text
ck_a1b2c3d4-e5f6-7890-abcd-ef1234567890_f8k2mN9xZpW3qR7vL5tY
```

## Rotation

Use the **Regenerate Secret** button on the Applications table to rotate a key. The old secret stops working immediately when the new one is generated, so update consumers before regenerating.

## Team assignments

Applications can be assigned to teams for resource-level access control. When an application is a member of a team, it can access resources that team has been granted access to.

The same Teams page that manages user assignments handles applications - add the application as a team member.

## Security best practices

1. **Store secrets securely** - Use environment variables or secret managers.
2. **Rotate secrets periodically** - Use the **Regenerate Secret** button in the UI.
3. **Apply least privilege** - Assign only the roles/access rules needed.
4. **Monitor usage** - Check the **Last Used** column for inactive applications.
5. **Delete unused applications** - Expired keys stop working immediately.

## See also

- [Public REST API](/checkstack/user-guide/reference/public-rest-api/) - how to call Checkstack with the API key you create here.
- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) - human login configuration alongside machine access.

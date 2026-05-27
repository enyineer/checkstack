---
title: "Custom auth plugins"
description: "Build a custom authentication strategy as a plugin: the auth-* naming convention, Wildcard Scope Pattern, and identity assertion contract."
---

Checkstack's architecture supports building custom internal or third-party authentication plugins. To ensure secure privilege isolation, the core API enforces a strict naming convention for plugins attempting to synchronize external users.

For the operator-facing view of built-in strategies (SAML, LDAP, GitHub OAuth) see [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/). For error redirect handling, see [Auth error handling](/checkstack/developer-guide/security/auth-error-handling/).

## The `auth-*` naming convention

If your plugin provides an authentication strategy (and thus needs to securely call internal identity endpoints like `upsertExternalUser`), its plugin ID **MUST** begin with the `auth-` prefix (e.g., `auth-custom-backend`).

Checkstack uses a **Wildcard Scope Pattern** (`serviceScope: ["auth-*"]`) on sensitive endpoints. This allows new authentication plugins to seamlessly integrate and assert identity claims without requiring modifications to the core platform's hardcoded allowlists, while still thoroughly blocking arbitrary plugins from escalating privileges.

## Why the wildcard

Identity endpoints like `upsertExternalUser` create or update real user records. Restricting these to a fixed list of plugin IDs would mean every new auth strategy required a core change. The wildcard scope:

- Lets new auth plugins be installed at runtime without core modifications.
- Blocks non-auth plugins from calling identity endpoints by enforcing the prefix at the scope check.
- Makes it obvious from the plugin ID alone that a plugin claims auth privileges.

## See also

- [Auth error handling](/checkstack/developer-guide/security/auth-error-handling/) - `redirectToAuthError` contract for surfacing failures to the user.
- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) - operator-facing reference for the built-in strategies your plugin sits alongside.

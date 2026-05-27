---
title: "Authentication strategies"
description: "Configure built-in credentials, GitHub OAuth, SAML 2.0 SSO, LDAP/Active Directory, and group-to-role mapping for Checkstack."
---

Checkstack provides flexible authentication options for both small teams and enterprise environments. This page is the operator reference for configuring the built-in strategies and mapping directory groups to Checkstack roles.

For machine-to-machine access (CI pipelines, scripts), see [API keys](/checkstack/user-guide/reference/api-keys/) and the [public REST API](/checkstack/user-guide/reference/public-rest-api/). To build your own auth strategy as a plugin, see [Custom auth plugins](/checkstack/developer-guide/security/custom-auth-plugins/).

## Built-in authentication

### Credential login

Standard email/password authentication with:

- Secure password hashing (bcrypt)
- Password reset via email
- Account lockout protection

### GitHub OAuth

Single sign-on using GitHub accounts. Users authenticate through GitHub and are automatically created in Checkstack on first login.

## Enterprise SSO

### SAML 2.0

Checkstack supports SAML 2.0 Service Provider (SP) initiated SSO, enabling integration with enterprise identity providers:

- **Okta**
- **Azure Active Directory**
- **OneLogin**
- **Google Workspace**
- **Any SAML 2.0 compliant IdP**

#### Configuration

Navigate to **Settings -> Authentication -> Strategies** and configure the SAML strategy:

| Field | Description |
|-------|-------------|
| `IdP Metadata URL` | URL to your IdP's SAML metadata (recommended) |
| `IdP SSO URL` | Single Sign-On URL (if not using metadata) |
| `IdP Certificate` | X.509 certificate for signature validation |
| `SP Entity ID` | Unique identifier for Checkstack (default: `checkstack`) |
| `Attribute Mapping` | Map SAML claims to user fields (email, name) |

### LDAP/Active Directory

Checkstack supports LDAP and Active Directory authentication:

| Field | Description |
|-------|-------------|
| `Server URL` | LDAP server URL (e.g., `ldaps://ldap.example.com:636`) |
| `Bind DN` | Service account for searching users |
| `Bind Password` | Service account password |
| `Base DN` | Search base (e.g., `ou=users,dc=example,dc=com`) |
| `Search Filter` | User search filter (e.g., `(uid={0})` or `(sAMAccountName={0})`) |

## Group-to-role mapping

Both SAML and LDAP strategies support automatic role assignment based on directory group memberships.

### How it works

1. **Group extraction**: When a user authenticates, Checkstack extracts their group memberships from the directory response
2. **Mapping lookup**: Groups are matched against configured mappings
3. **Role assignment**: Matched Checkstack roles are assigned to the user

### Configuration

Enable group mapping in the strategy configuration:

```
Group Mapping:
  - Enabled: true
  - Group Attribute: memberOf (LDAP) or http://schemas.xmlsoap.org/claims/Group (SAML)
  - Mappings:
    - Directory Group: CN=Developers,OU=Groups,DC=example,DC=com
      Checkstack Role: developers
    - Directory Group: CN=Admins,OU=Groups,DC=example,DC=com
      Checkstack Role: admin
  - Default Role: users (optional, assigned to all users from this directory)
```

### Managed role sync

Checkstack uses a **managed role sync** pattern that distinguishes between directory-controlled roles and manually-assigned roles:

**Managed roles** (roles configured in mappings):

- Added when user gains group membership in directory
- Removed when user loses group membership in directory
- Fully synchronized on every login

**Unmanaged roles** (roles not in any mapping):

- Preserved during sync
- Can be manually assigned/removed by Checkstack administrators
- Not affected by directory changes

**Example scenario:**

1. User belongs to "Developers" group in AD -> assigned `developers` role
2. User is also manually assigned `reporting-viewer` role in Checkstack
3. User is removed from "Developers" group in AD
4. On next login: `developers` role is removed, `reporting-viewer` role is preserved

### Invalid role handling

If a mapping contains a role ID that no longer exists in Checkstack:

- The invalid role is silently skipped
- Other valid roles are still assigned
- Authentication succeeds (never fails due to mapping issues)

## API tokens (External Applications)

For machine-to-machine access, create **External Applications** in **Settings -> Authentication -> Applications**:

- Each application receives an API key (`ck_<appId>_<secret>`)
- Assign roles to control what the application can access
- Optionally assign to teams for resource-level access

See [API keys](/checkstack/user-guide/reference/api-keys/) for the full operator walkthrough and [Public REST API](/checkstack/user-guide/reference/public-rest-api/) for the wire format.

## See also

- [Custom auth plugins](/checkstack/developer-guide/security/custom-auth-plugins/) - building your own authentication strategy as a plugin.

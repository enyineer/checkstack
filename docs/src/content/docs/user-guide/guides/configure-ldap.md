---
title: "Configure LDAP"
description: "Connect Checkstack to an LDAP directory or Active Directory, map groups to roles, and enable LDAP-backed sign in for your users."
---

This walkthrough configures the LDAP authentication strategy against an external directory and maps `memberOf` groups to Checkstack roles so users land with the right access on first login. Active Directory and OpenLDAP are both supported; the worked example covers Active Directory, with notes for OpenLDAP where the syntax differs.

For the full strategy reference, see [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/).

## 1. Install the LDAP plugin

If the LDAP strategy is not already installed on your instance, follow [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) to add `@checkstack/auth-ldap-backend` from npm.

Once installed, the **LDAP** strategy appears in the authentication settings.

## 2. Prepare a service account on the directory

The strategy needs a bind DN with read access to the user and group subtrees. Do not reuse a human account.

For Active Directory, create a service user (e.g. `svc-checkstack`) in an OU you control, set a strong password, and grant it `Read` permission on the OUs that contain the users you will authenticate.

For OpenLDAP, create an entry like `cn=checkstack,ou=services,dc=example,dc=com` with read ACLs on the user and group subtrees.

> [!IMPORTANT]
> Use LDAPS (`ldaps://`) in production. The strategy supports plain LDAP for local testing, but it sends the bind password in clear text.

## 3. Open the Checkstack auth settings

Sign in to Checkstack as an administrator. From the user menu, open **Settings -> Authentication -> Strategies** and select the **LDAP** strategy.

## 4. Fill in the connection settings

Active Directory example:

| Field | Value |
|-------|-------|
| **Enabled** | `true` |
| **Server URL** | `ldaps://ad.example.com:636` |
| **Bind DN** | `CN=svc-checkstack,OU=ServiceAccounts,DC=example,DC=com` |
| **Bind Password** | The service account password (marked secret, masked in the UI) |
| **Base DN** | `OU=Users,DC=example,DC=com` |
| **Search Filter** | `(sAMAccountName={0})` |
| **Username attribute** | `sAMAccountName` |
| **Timeout** | `5000` (milliseconds) |

OpenLDAP example:

| Field | Value |
|-------|-------|
| **Server URL** | `ldaps://ldap.example.com:636` |
| **Bind DN** | `cn=checkstack,ou=services,dc=example,dc=com` |
| **Base DN** | `ou=people,dc=example,dc=com` |
| **Search Filter** | `(uid={0})` |
| **Username attribute** | `uid` |

`{0}` in the search filter is the placeholder for the username the user types at sign in.

### Attribute mapping

The defaults work for most directories:

- **Email** - `mail`
- **Name** - `displayName`
- **First name** - `givenName` (optional)
- **Last name** - `sn` (optional)

Override these if your schema uses different attribute names.

### TLS

If you front the directory with a private CA:

- **Reject unauthorized certificates** - leave `true`.
- **Custom CA certificate** - paste the CA in PEM format. This field is marked secret.

### Provisioning

- **Auto-create users** - if `true`, users are created in Checkstack on first successful sign in. Recommended.
- **Auto-update users** - if `true`, attribute mappings are refreshed on every login (name, email, group memberships).

## 5. Configure group-to-role mapping

Group mapping auto-assigns Checkstack roles based on `memberOf` attributes returned in the user record. Without it, every LDAP user lands with no roles.

In the **Group Mapping** section:

1. Toggle **Enabled** on.
2. **Group Attribute** - `memberOf` for AD and most LDAP schemas.
3. **Mappings** - add one row per directory group you want to map. For each row:
   - **Directory group** - the full DN of the group, exactly as it appears in `memberOf`. For example `CN=Checkstack Admins,OU=Groups,DC=example,DC=com`.
   - **Checkstack role** - pick a role from the dropdown.
4. **Default role** (optional) - assign a baseline role to every user authenticated through LDAP.

> [!NOTE]
> Group mapping uses **managed role sync**: roles configured in mappings are added when the user is in the group and removed when they leave. Roles assigned manually by an admin are preserved across logins. See [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/).

## 6. Save and test

1. Click **Save**.
2. Open a private browser window and visit your Checkstack instance.
3. Sign in with an LDAP username and password.

On first login, Checkstack runs the bind, searches for the user using your filter, fetches the configured attributes, and provisions the local account.

## 7. Troubleshoot

If sign-in fails:

- **Bad credentials** - confirm the user types the same username format your filter expects. `sAMAccountName` for AD does not include the domain prefix.
- **No such object / no results** - the search filter or base DN is wrong. Test the filter with `ldapsearch` against the same bind DN.
- **Connection refused / timeout** - network or firewall problem. Confirm the Checkstack host can reach the directory on port 636 (LDAPS) or 389 (LDAP).
- **Self-signed certificate** - either install the CA into the strategy config or, for local testing only, set **Reject unauthorized certificates** to `false`.
- **Groups not mapping** - log a failed user's `memberOf` value (in debug log mode) and confirm the DN you configured in the mapping matches exactly, including case.

## See also

- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) - full strategy reference and managed role sync.
- [Configure SAML SSO](/checkstack/user-guide/guides/configure-saml-sso/) - the SAML 2.0 walkthrough.
- [Create your first team](/checkstack/user-guide/guides/create-a-team/) - layer resource-scoped access on top of role assignments.

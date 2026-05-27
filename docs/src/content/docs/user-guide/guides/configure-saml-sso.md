---
title: "Configure SAML SSO"
description: "Wire Checkstack to a SAML 2.0 identity provider like Okta, map IdP groups to Checkstack roles, and enable SSO for your users."
---

This walkthrough configures the SAML 2.0 authentication strategy against an external identity provider (IdP) and maps directory groups to Checkstack roles so users are provisioned with the right access on first login. Okta is used as the worked example; the steps are the same for Azure Active Directory, OneLogin, Google Workspace, or any SAML 2.0 compliant IdP.

For the full strategy reference (every field, attribute mapping defaults, managed-role-sync behaviour), see [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/).

## 1. Install the SAML plugin

If the SAML strategy is not already installed on your instance, follow [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) to add `@checkstack/auth-saml-backend` from npm.

Once installed, the **SAML 2.0** strategy appears in the authentication settings.

## 2. Register Checkstack as a SAML application in your IdP

In Okta:

1. Open **Applications -> Applications -> Create App Integration**.
2. Choose **SAML 2.0** and click **Next**.
3. Name the app `Checkstack` and click **Next**.

Configure these SAML settings:

| Field | Value |
|-------|-------|
| **Single sign on URL** | `https://<your-checkstack-host>/api/auth/sso/saml/callback` |
| **Audience URI (SP Entity ID)** | `checkstack` (default; can be customised in step 4) |
| **Name ID format** | `EmailAddress` |
| **Application username** | `Email` |

Add the attribute statements Checkstack expects (these are the defaults; you can change them in step 4):

| Name | Format | Value |
|------|--------|-------|
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | URI Reference | `user.email` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name` | URI Reference | `user.displayName` |

If you intend to map groups (recommended), add a **Group Attribute Statement**:

| Name | Format | Filter |
|------|--------|--------|
| `http://schemas.xmlsoap.org/claims/Group` | URI Reference | `Matches regex: .*` (or a narrower filter that includes the groups you want to map) |

Finish the wizard. Open the **Sign On** tab and either:

- Copy the **Identity Provider metadata** URL (recommended), or
- Download the metadata XML and copy the **IdP SSO URL** and the **X.509 certificate** for manual entry.

## 3. Open the Checkstack auth settings

Sign in to Checkstack as an administrator. From the user menu, open **Settings -> Authentication -> Strategies** and select the **SAML 2.0** strategy.

## 4. Fill in the IdP configuration

The SAML strategy supports both metadata-URL and manual configuration. Pick one:

### Option A: IdP metadata URL (recommended)

- **IdP Metadata URL** - paste the metadata URL you copied from Okta.

Checkstack fetches the metadata at boot and extracts the Entity ID, SSO URL, and certificate. Rotating the IdP certificate happens transparently as long as the metadata URL keeps serving the new one.

### Option B: Manual entry

- **IdP Entity ID** - the entity ID Okta uses (e.g. `http://www.okta.com/<app-id>`).
- **IdP SSO URL** - the IdP's Single Sign-On URL.
- **IdP Certificate** - paste the X.509 certificate in PEM format. This field is marked secret and masked in the UI.

### Service provider settings

- **SP Entity ID** - default `checkstack`. Must match the Audience URI configured in Okta.
- **Want Assertions Signed** - leave `true` unless your IdP cannot sign assertions.

### Attribute mapping

The defaults work for Okta out of the box:

- **Email attribute** - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
- **Name attribute** - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name`

Override these only if your IdP exposes different claim names.

## 5. Configure group-to-role mapping

Group mapping auto-assigns Checkstack roles based on directory group membership. Without it, every SSO user lands with no roles.

In the **Group Mapping** section:

1. Toggle **Enabled** on.
2. **Group Attribute** - `http://schemas.xmlsoap.org/claims/Group` (matches the attribute statement you added in step 2).
3. **Mappings** - add one row per group you want to map. For each row:
   - **Directory group** - the exact group name as it arrives in the SAML response (e.g. `Checkstack Admins`).
   - **Checkstack role** - pick a role from the dropdown (the dropdown is populated by your local Roles configuration).
4. **Default role** (optional) - assign a baseline role to every SSO user from this IdP. Use this for read-only access.

> [!NOTE]
> Group mapping uses **managed role sync**: roles configured in mappings are added when the user is in the group and removed when they leave. Roles assigned manually by an admin are preserved. See [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) for the full sync model.

## 6. Save and test

1. Click **Save**.
2. Open a private browser window and visit your Checkstack instance.
3. Click **Sign in with SAML**.
4. You are redirected to Okta. Authenticate, then return to Checkstack.

On first login, Checkstack provisions the user account, sets the email and name from the SAML response, and applies the role mappings.

## 7. Troubleshoot

If sign-in fails:

- **Authentication error page** - Checkstack redirects to a structured error page rather than swallowing the failure. The query string carries the reason (signature mismatch, missing attribute, etc.).
- **Backend logs** - the auth backend logs every SAML response it receives. Look for `samlify` errors or schema-validation failures.
- **Clock drift** - SAML assertions are time-bound. Make sure the Checkstack host and the IdP are in NTP sync.
- **Assertion not signed** - if you set `wantAssertionsSigned: true` (the default), the IdP must sign assertions. Check the Okta SAML settings.

## See also

- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) - full reference for built-in strategies, group mapping, and managed role sync.
- [Configure LDAP](/checkstack/user-guide/guides/configure-ldap/) - the equivalent walkthrough for LDAP / Active Directory.
- [Create your first team](/checkstack/user-guide/guides/create-a-team/) - resource-scoped access on top of role assignments.

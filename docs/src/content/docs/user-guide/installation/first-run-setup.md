---
title: First-run setup
description: What happens the first time Checkstack starts, how to create the first admin user, and what to do before your first health check.
---

A freshly-started Checkstack container does two things on first boot: it runs database migrations for every built-in plugin, and it serves a one-time onboarding form to create the first admin user. This page walks through that flow and what to do once you have a working admin account.

## What happens during first boot

When the container starts against an empty database:

1. **Migrations run.** Each backend plugin owns its own Postgres schema (`plugin_catalog-backend`, `plugin_auth-backend`, and so on). Plugins create their schema and apply migrations on boot.
2. **Plugins initialise.** Each plugin's `register()` and `init()` hooks fire. Routes are registered, services come online, and access rules are added to the registry.
3. **Readiness flips to true.** The platform answers `/.checkstack/ready` with 200 only after every critical readiness probe is passing. See [Health probes](/checkstack/user-guide/reference/health-probes/).
4. **The frontend is served.** Hitting `BASE_URL` in a browser loads the SPA.

You can watch this whole sequence in the logs. The relevant line is `core init complete`; after that, the container is ready for users.

## The onboarding screen

The very first time you load the UI, you land on the onboarding screen at `/auth/onboarding`. It asks for:

- A **display name** (for the first user).
- An **email address**.
- A **password** (must satisfy the configured password policy).

Submit the form. Checkstack creates the user, grants them the built-in `admin` role, and logs you in automatically. From now on the onboarding route is gone; subsequent loads of `BASE_URL` go to the regular login page.

> [!IMPORTANT]
> The first user always becomes the platform admin. There is no separate `ADMIN_EMAIL` environment variable to seed; the admin is whoever fills the onboarding form. Make sure the person filling it in is the right person.

If the onboarding page never appears, see the troubleshooting note below.

## Troubleshooting: onboarding never loads

The single most common first-run failure is a mismatched `BASE_URL`. If the page loads blank, looks stuck on a spinner, or shows the login form instead of the onboarding form, check this first.

### What `BASE_URL` must equal

`BASE_URL` is the exact URL you type in the browser to reach Checkstack. Protocol, host, and port all matter. A few examples:

| You reach Checkstack at | Set `BASE_URL` to |
|--------------------------|--------------------|
| `http://localhost:3000` (local Docker) | `http://localhost:3000` |
| `http://192.168.1.50:3000` (LAN) | `http://192.168.1.50:3000` |
| `https://status.example.com` (prod) | `https://status.example.com` |
| `https://status.example.com:8443` (custom port) | `https://status.example.com:8443` |

### Verify what the container is using

Hit the runtime config endpoint:

```bash
curl http://localhost:3000/api/config
# Expected: {"baseUrl":"http://localhost:3000"}
```

If the response does not match the URL you actually visit, fix `BASE_URL` and restart the container:

```bash
# Docker Compose
docker compose up -d --force-recreate

# Kubernetes (edit the ConfigMap, then)
kubectl -n checkstack rollout restart deploy/checkstack
```

For a deeper troubleshooting guide, see [Installation troubleshooting](/checkstack/user-guide/troubleshooting/).

## After you log in

Once you are signed in as the first admin, the dashboard is empty. That is expected; nothing in Checkstack is seeded by default. There are no demo systems, no example checks, no fake data.

Walk through the following short list before your first real health check.

### 1. Confirm authentication strategies

Out of the box, the credential auth plugin is the only login method. If your organisation uses SSO, configure SAML, OIDC, or LDAP before inviting other users:

- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/)
- [Configure SAML SSO](/checkstack/user-guide/guides/configure-saml-sso/)
- [Configure LDAP](/checkstack/user-guide/guides/configure-ldap/)

### 2. Create your first system

Systems are the catalog units that everything else attaches to. From the main nav:

1. Go to **Catalog -> Systems**.
2. Click **Add system**.
3. Give it a name (for example, `Payments API`) and an optional description.
4. Save.

The system appears in the catalog. You can add contacts and hotlinks now or later.

For the conceptual background, see [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/).

### 3. Attach your first health check

This is the moment Checkstack starts doing what it is built for. Walk through [Set up your first health check](/checkstack/user-guide/guides/first-health-check/) for a step-by-step guide. The short version:

1. Go to **Health checks -> Configurations -> Add configuration**.
2. Pick a strategy (start with HTTP, Ping, or TCP for the simplest cases).
3. Enter the config (URL, host, port, ...).
4. Set the interval (60 seconds is a good default).
5. Save, then attach the check to the system you just created.

Within one interval you should see the first run on the system detail page. Latency charts populate as more runs accumulate.

### 4. Invite the rest of the team

Add other users from **Infrastructure -> Auth -> Users**. Or, if you configured SSO, let them log in through that path and assign them roles via the SSO group mapping covered in [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/).

> [!TIP]
> Hold off on creating teams until you have at least one or two real systems in the catalog. Team grants make more sense when there is something to grant access to.

### 5. Decide on notification delivery

In-app notifications work immediately. For external delivery (Slack, email, ...), you have two paths:

- **Per-user notification strategies** for personal alerts. Each user configures their own strategy in their notification settings. See [Notifications](/checkstack/user-guide/concepts/notifications/).
- **Integration subscriptions** for org-wide channels (a single Slack #ops-alerts channel for the whole team). See [Integrations](/checkstack/user-guide/concepts/integrations/).

A common setup uses both: integrations for the team Slack room, per-user for individual on-call DMs.

## Recommended hardening before going live

Before pointing real production systems at Checkstack:

- **Back up the database.** Even on day one. Postgres dumps plus your `.env` (or the equivalent Kubernetes Secret backup) are the minimum.
- **Pin your image tag.** Never `:latest`. See [Upgrading](/checkstack/user-guide/installation/upgrading/).
- **Lock down access.** The default `users` role can read most things. If that is too permissive, edit it now before more accounts exist.
- **Verify TLS.** If `BASE_URL` is `https://...`, confirm the certificate is valid and the proxy forwards the WebSocket upgrade headers.

## Where to go next

- **Hands-on.** [Set up your first health check](/checkstack/user-guide/guides/first-health-check/).
- **Plain-language tour.** [Overview](/checkstack/user-guide/concepts/overview/) and the rest of the [Concepts](/checkstack/user-guide/concepts/) section.
- **Reference.** [Configuration reference](/checkstack/user-guide/reference/) for every supported environment variable.
- **Going to production.** [Upgrading](/checkstack/user-guide/installation/upgrading/) for the BETA versioning policy and safe upgrade flow.

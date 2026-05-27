---
title: Overview
description: A plain-language introduction to Checkstack, what it monitors, and the mental model you will use day to day.
---

Checkstack is a self-hosted monitoring and incident-tracking platform. You install it once, point it at the systems you care about, and use it to detect outages, coordinate the human response, and keep an audit trail of what happened. This page is the high-level picture; the rest of the Concepts section drills into each piece.

## What Checkstack does

Checkstack covers three jobs that often live in three separate tools:

- **Health checking.** It probes your infrastructure on a schedule and records the results. You can monitor HTTP endpoints, TCP/TLS sockets, DNS records, PostgreSQL, MySQL, Redis, Jenkins jobs, Minecraft RCON servers, and anything else a plugin exposes. Custom logic goes into a script health check.
- **Incident tracking.** When something breaks, your team opens an incident, attaches the affected systems, writes updates as the situation evolves, and resolves it. The full timeline stays in Checkstack.
- **Notifications and integrations.** In-app notifications keep operators informed. Outbound integrations forward events to Slack, Microsoft Teams, Discord, Webex, Telegram, Pushover, Gotify, SMTP, Backstage, Jira, or any HTTP webhook.

It is not an APM, a log aggregator, or a metrics database. It does not auto-discover your infrastructure. Checkstack is deliberately small and opinionated: you tell it what to watch, and it tells you when something is off.

## The deployment shape

A complete Checkstack install is just two things:

- **One container.** A single backend process serves both the API and the frontend SPA. Run it with Docker, Docker Compose, or Kubernetes.
- **One PostgreSQL database.** Checkstack stores every piece of state here, including encrypted secrets and runtime-installed plugins.

> [!NOTE]
> Checkstack does not bundle a database, even for evaluation. You always provide a PostgreSQL instance. See the [Docker Compose install](/checkstack/user-guide/installation/docker-compose/) for a recipe that runs Postgres in the same compose file.

Optional pieces you might add later:

- **Satellites** for executing health checks from other networks or geographic regions. See [Satellites](/checkstack/user-guide/concepts/satellites/).
- **Object storage** is not required. Plugin artifacts live in Postgres as `bytea`, so a single database backup snapshots both data and installed plugins.

## The mental model

Everything you do in Checkstack maps onto four concepts that build on each other:

```
Systems -> Health checks -> Incidents -> Notifications
   |             |              |              |
   |             |              |              +-- in-app + Slack/Jira/...
   |             |              +-- manual, with a timeline
   |             +-- scheduled probes that produce results
   +-- the catalog of what you monitor
```

- A **System** is the unit of "thing you monitor". It has a name, optional description, contacts, groups, and links.
- A **Health check** is a scheduled probe attached to one or more Systems. Each run produces a result (healthy, degraded, or unhealthy) plus strategy-specific metrics.
- An **Incident** is a manual record of a real-world disruption. Operators open it, attach the affected Systems, post updates as they investigate, and resolve it. **Checkstack does not auto-open incidents from failing checks.**
- A **Notification** is the delivery channel. In-app notifications appear in the bell icon for subscribed users; external notifications go to Slack, email, and so on via plugins.

Read [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/) next to see how the catalog is organised, then [Health checks](/checkstack/user-guide/concepts/health-checks/) to learn how probes are configured.

## Plugins, in one paragraph

Almost every capability in Checkstack ships as a plugin. The platform itself is a thin host that loads plugins at runtime. That includes authentication strategies (LDAP, SAML, GitHub OAuth, credential), health check strategies (HTTP, SSH, Postgres, ...), notification strategies (Slack, Discord, SMTP, ...), and integration providers. You can install or remove plugins from the UI without restarting the container in most cases. If you want to extend Checkstack with your own check or notification type, see the [Developer Guide](/checkstack/developer-guide/).

> [!TIP]
> If a feature you want is missing, check the Plugin Manager in the UI first. There is a good chance a plugin already exists for it.

## What you bring vs what Checkstack brings

| You bring | Checkstack brings |
|-----------|-------------------|
| A PostgreSQL database | A single backend container that serves the UI and API |
| A reachable URL or domain to access the UI | Per-plugin schema isolation in your database |
| Secrets (`ENCRYPTION_MASTER_KEY`, `BETTER_AUTH_SECRET`) | Encryption at rest for any field a plugin marks as secret |
| The systems and endpoints to monitor | A catalog model, scheduler, retention pipeline, and notification fan-out |
| Optional: a Slack/Jira/SMTP endpoint to deliver alerts to | Bundled integration and notification plugins for common channels |

## Self-hosting trade-offs

Checkstack is BETA software at the time of writing. A few things you should know up front:

- **Versioning policy.** While in BETA, breaking changes ship as minor version bumps, not majors. Always pin your image tag and read the release notes before upgrading. See [Upgrading](/checkstack/user-guide/installation/upgrading/).
- **Single-replica today.** The recommended deployment is one Checkstack container plus one Postgres. Horizontal scaling is on the roadmap but not yet supported as a general path.
- **Backups are your problem.** Checkstack does not back itself up. Snapshot Postgres on whatever schedule your data sensitivity demands.

> [!IMPORTANT]
> Treat your `ENCRYPTION_MASTER_KEY` like a database password. If you lose it, every encrypted secret in the database (OAuth tokens, webhook URLs, SSH keys, ...) becomes unrecoverable. See [Secret encryption](/checkstack/user-guide/reference/secret-encryption/).

## Where to go next

- **Ready to install?** Start with [Docker Compose](/checkstack/user-guide/installation/docker-compose/) or [Kubernetes](/checkstack/user-guide/installation/kubernetes/).
- **Already installed?** Walk through [First-run setup](/checkstack/user-guide/installation/first-run-setup/) and then [Set up your first health check](/checkstack/user-guide/guides/first-health-check/).
- **Need to understand a specific piece?** Jump to the relevant concept page: [Systems and groups](/checkstack/user-guide/concepts/systems-and-groups/), [Health checks](/checkstack/user-guide/concepts/health-checks/), [Incidents](/checkstack/user-guide/concepts/incidents/), [Notifications](/checkstack/user-guide/concepts/notifications/), [Teams and access](/checkstack/user-guide/concepts/teams-and-access/), [Satellites](/checkstack/user-guide/concepts/satellites/), or [GitOps](/checkstack/user-guide/concepts/gitops/).

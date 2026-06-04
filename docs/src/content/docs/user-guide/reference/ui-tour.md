---
title: "UI tour"
description: "Annotated walkthrough of every page in the Checkstack UI - what each surface is for and the actions you can take from it."
---

This page lists every top-level surface in the Checkstack UI and explains, in one paragraph each, what you do there. Treat it as the navigation glossary you reach for after a fresh install when something is "in the UI somewhere" but you cannot remember which menu.

The exact names you see in the sidebar depend on which plugins are installed. Core pages are always present; plugin pages (Jenkins, Pushover, etc.) appear as their plugins are enabled.

## Status pages

### Dashboard

The default landing page once you are signed in. It surfaces only the systems that need attention right now - degraded, unhealthy, breaching an SLO, under an incident or maintenance, anomalous, or with a dependency problem - and hides everything that is healthy. A compact header summarises fleet health and lets you filter by severity (critical, degraded, watch), and each problem shows one row per issue that links straight to where it originates (the incident, the SLO, the failing check, and so on). When nothing needs you, the dashboard shows a calm "all clear" state. A live "recent activity" feed of health-check runs sits below, and a "View catalog" link opens the full system list. Use it as the live operations view - everything else is a drill-down from here.

### System list

Linear, filterable list of every System (registered service, server, or asset). Use the search box to find a system by name, and the filters to narrow by group, tag, or status. The list reflects the same access rules as the dashboard, so you only see systems you can read.

### System detail

Opens when you click any system. The page is split into sheets that you can open one at a time:

- **Overview** - tags, owner team, summary status.
- **Health checks** - the checks attached to this system, with sparklines and the most recent run.
- **Incidents** - past and active incidents touching the system.
- **Maintenances** - past and scheduled maintenance windows.
- **Dependencies** - the dependency graph (other systems this one depends on or that depend on it).
- **SLOs** - service-level objectives bound to this system, if any.

Each sheet has its own actions (create incident, schedule maintenance, edit check, etc.).

## Health checks

### Health check editor (IDE)

The full-screen editor for a single health check assignment: pick a strategy (HTTP, TCP, DNS, script, etc.), fill in the strategy-specific config, set the run schedule, and choose which satellite the check should run on (if any). The right-hand pane previews the most recent runs while you tune the config so you can validate without leaving the editor.

### Health check history

Time-series view of a single check's runs. The chart re-aggregates on the fly across raw/hourly/daily storage tiers (see [Retention and limits](/checkstack/user-guide/reference/retention-and-limits/)), so the same page works for "the last hour" and "the last year". Click a point to drill into a single run.

### Health check history detail

Single-run page. Shows the strategy-specific result payload (status code, stdout/stderr, query result, ...) plus latency and timestamp. Linked from charts, incident pages, and the system detail health-check sheet.

### Strategy picker

A small page that lists every health check strategy registered by an installed plugin and lets you pick one to start a new assignment. The pickers shown depend on which `healthcheck-*` plugins are installed.

## Incidents

### Incidents page

Lists past and current incidents across all systems you have access to. Filter by status (open, resolved), severity, or affected system. New incidents are created from this page (or from the system detail sheet) - **Checkstack does not auto-open incidents from failing health checks**; they are explicit operator-reported events. See [Incidents are manual](/checkstack/user-guide/troubleshooting/faq/#are-incidents-auto-created) in the FAQ for the rationale.

### Incident detail

The page for a single incident. From here you write timeline updates, change status, attach affected systems, link to an integration ticket (Jira if installed), and resolve the incident. The `suppressNotifications` toggle on the detail page silences alert dispatch for the incident's lifetime - see [Silence alerts](/checkstack/user-guide/guides/silence-alerts/).

### Incident config

Admin-only configuration page for incident defaults: severity levels, default notification templates, and similar org-wide knobs.

## Maintenances

### Maintenance config

Lists past and scheduled maintenance windows. Create a new window from here, with a start/end time, a set of affected systems, and optional `suppressNotifications` to keep the window quiet.

### Maintenance detail

The page for a single maintenance window. Edit dates, change affected systems, and view the timeline of updates.

### System maintenance history

Per-system view of every maintenance window that has ever touched a system. Reached from the system detail sheet.

## Notifications

### Notifications page

The bell. Per-user inbox of every notification dispatched to you, with status (delivered, snoozed, dismissed). Use this to verify a notification actually fired without going to the integration log.

### Notification settings

Per-user preferences: which subscription targets you opt in to (email, Slack, Teams, ...), digest schedules, and per-system overrides. Each available target type comes from an installed `notification-*` plugin.

### Delivery attempts

Audit log of every notification dispatch. Includes the target, the strategy, the payload, the status, and any retries. Reach for this when "I didn't get a notification" - it tells you whether the platform tried, succeeded, or skipped.

## Integrations

### Integrations page

The provider catalog. One row per installed integration plugin (Jira, webhooks, Teams, Webex, ...). Each row has actions to configure the provider, test the connection, and see active subscriptions.

### Provider connections

Per-provider list of connection instances. A single integration plugin (e.g. webhook) can power multiple connections, each with its own credentials and target URL.

### Delivery logs

Cross-provider delivery log for outbound integration events. Like the notification delivery log, but for integration providers that fire on platform events.

## Plugin manager

### Installed plugins

Lists every plugin loaded in the current process. Core plugins show as "Built-in" and cannot be uninstalled; runtime plugins installed through the Plugin Manager show with an Uninstall action. Each row shows the plugin's source (npm, GitHub, tarball, catalog), version, and access rules.

### Install plugin

The install flow: pick a source (npm package, GitHub release URL, uploaded tarball, or the curated catalog), confirm metadata, accept the install-scripts warning if the plugin requests it, and click Install. The plugin is then loaded on every replica. See [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) for the walkthrough.

### Plugin events

Lifecycle event log for every install/uninstall step on every replica. Use this when an install reports success but a plugin is missing - the events page will show whether a single replica failed.

## Settings

The Settings area collects the org-wide admin pages. The exact tabs you see depend on installed plugins.

### Infrastructure config

Sets which backing services to use for cluster-wide concerns: which queue backend is active (in-memory vs BullMQ), which cache backend is active, anything else that has multiple available providers. Most pages here gate on admin access.

### Authentication settings

Enable/disable individual auth strategies (credential, GitHub OAuth, SAML, LDAP), configure each strategy's settings, and edit the group-to-team mapping rules.

### Teams

Manage teams and team membership. Teams are the unit of access in Checkstack - access rules grant capabilities, and a user picks up rules through team membership.

### Profile

Per-user page: change your own password, configure 2FA (if the strategy supports it), and revoke active sessions.

### API keys

Generate, rotate, and revoke personal API keys. Tokens issued here authenticate requests to the public REST API. See [API keys](/checkstack/user-guide/reference/api-keys/).

### Theme

The theming page: pick a built-in palette or, if a `theme-*` plugin is installed, customise per-tenant colours.

### About

Shows the running core version and every loaded plugin with its version. Use this when filing bugs - the version table is the fastest way to confirm what is actually running.

## GitOps

### GitOps page

Lists registered GitOps providers (Git repos, file-system mounts, etc.). Each provider source-of-truths a set of YAML manifests; changes there are reconciled into Checkstack on every sync. See [GitOps kinds](/checkstack/user-guide/reference/gitops-kinds/) for the YAML schema reference.

### Kind registry

Read-only catalog of every YAML kind a plugin has registered with GitOps. Use this page to confirm a kind is available before you ship a manifest that uses it.

## Satellites

### Satellite list

Inventory of every registered satellite agent. Each row shows the satellite's id, whether it is currently connected, its last heartbeat, and the assignments running on it. The Register button on this page issues a new client id and token pair that you paste into a satellite container's `CHECKSTACK_SATELLITE_CLIENT_ID` and `CHECKSTACK_SATELLITE_TOKEN` env vars.

## Where to go next

- [Configuration reference](/checkstack/user-guide/reference/configuration/) - the env vars that govern what you see here.
- [Retention and limits](/checkstack/user-guide/reference/retention-and-limits/) - how long the platform keeps the data behind these pages.
- [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) - the walkthrough for adding new pages to the sidebar.

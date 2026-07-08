---
"@checkstack/status-page-common": minor
"@checkstack/status-page-backend": minor
"@checkstack/status-page-frontend": minor
---

Granular status-page email subscriptions: subscribers now choose WHICH update
categories (Incidents, Scheduled maintenance, Health & status changes) and WHICH
systems (all systems on the page, or a chosen subset) they receive, instead of
the previous all-or-nothing fan-out.

- New subscriptions default to incidents + maintenance (health OFF) and all
  systems. Legacy subscribers (NULL scope) keep receiving everything, so the
  change is fully backward compatible.
- The subscribe endpoint clamps invalid categories and systems not surfaced by
  the page silently, preserving its constant, non-enumerable response.
- Send-time fan-out (`notifyForSystems`) now honors each subscriber's category
  scope (derived from the notification's source plugin: incident -> incident,
  maintenance -> maintenance, healthcheck -> health) and system scope, on top of
  the existing page-scope privacy boundary.
- The public subscribe form gains category checkboxes and an all/selected system
  chooser; the admin subscriber list shows each subscriber's scope. The public
  read exposes the page's subscribable systems, resolved from the same live scope
  source the fan-out uses so the picker can never offer a hidden system.

Adds a nullable `categories` / `system_ids` column to `status_page_subscribers`
(forward-only migration; existing rows stay NULL = "everything").

Docs: updated the notifications subscriptions guide and the status-pages
architecture page to describe per-subscription category + system scope.

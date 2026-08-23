# @checkstack/catalog-backend

## 1.10.5

### Patch Changes

- 68ef4b2: Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

  - `hono` 4.12.31 → 4.12.34 (CVE-2026-69207, CVE-2026-71848, CVE-2026-71850)
  - `js-yaml` 4.3.0 → 4.3.1 (GHSA-5p4m-2wfm-xmqj)
  - `postcss` 8.5.19 → 8.5.23 (CVE-2026-69153)
  - `brace-expansion` 5.0.8 → 5.0.9 (CVE-2026-69152)
  - `dompurify` 3.4.12 → 3.4.13 (GHSA-55q2-fjhq-7xh7)
  - `fast-uri` 3.1.4 → 3.1.5 (CVE-2026-18446)
  - `mermaid` 11.16.0 → 11.16.1 (CVE-2026-50159, CVE-2026-71436, CVE-2026-71437, CVE-2026-71439)
  - `nanoid` 3.3.16 → 3.3.18 (CVE-2026-67213)
  - `undici` 7.28.0 → 7.29.0 (CVE-2026-13697, CVE-2026-14643, CVE-2026-15157, CVE-2026-16728, CVE-2026-16729)

- Updated dependencies [68ef4b2]
- Updated dependencies [c972254]
  - @checkstack/auth-backend@0.14.2
  - @checkstack/backend-api@0.35.2
  - @checkstack/ai-backend@0.11.8
  - @checkstack/auth-common@0.17.1
  - @checkstack/automation-backend@0.11.12
  - @checkstack/command-backend@0.3.2
  - @checkstack/gitops-backend@0.5.30
  - @checkstack/catalog-common@2.8.4

## 1.10.4

### Patch Changes

- Updated dependencies [c83d0d1]
  - @checkstack/ai-backend@0.11.7
  - @checkstack/automation-backend@0.11.11

## 1.10.3

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ai-backend@0.11.6
  - @checkstack/automation-backend@0.11.10
  - @checkstack/catalog-common@2.8.3
  - @checkstack/backend-api@0.35.1
  - @checkstack/auth-backend@0.14.1
  - @checkstack/command-backend@0.3.1
  - @checkstack/gitops-backend@0.5.29

## 1.10.2

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
  - @checkstack/common@0.24.0
  - @checkstack/auth-common@0.17.0
  - @checkstack/command-backend@0.3.0
  - @checkstack/notification-common@1.9.0
  - @checkstack/ai-backend@0.11.5
  - @checkstack/backend-api@0.35.0
  - @checkstack/auth-backend@0.14.0
  - @checkstack/automation-backend@0.11.9
  - @checkstack/ai-common@0.6.8
  - @checkstack/cache-api@0.3.21
  - @checkstack/catalog-common@2.8.2
  - @checkstack/gitops-backend@0.5.28
  - @checkstack/gitops-common@0.7.5
  - @checkstack/signal-common@0.3.2
  - @checkstack/cache-utils@0.3.2

## 1.10.1

### Patch Changes

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/ai-backend@0.11.4
  - @checkstack/notification-common@1.8.0
  - @checkstack/auth-backend@0.13.0
  - @checkstack/auth-common@0.16.0
  - @checkstack/automation-backend@0.11.8
  - @checkstack/catalog-common@2.8.1
  - @checkstack/backend-api@0.34.1
  - @checkstack/command-backend@0.2.27
  - @checkstack/gitops-backend@0.5.27

## 1.10.0

### Minor Changes

- 6c8b36b: Catalog **Groups** and **Environments** are now team-manageable. Their reads
  stay public (they are shared browse facets everyone can see), but creating,
  renaming, and deleting them is team-scoped exactly like Systems: a create
  writes an owning-team grant, and edit/delete require a per-instance manage
  grant. A team that can create Systems can also create Groups and Environments
  (and attach them to systems it manages) with no extra grant.

  New reusable platform seam `instanceAccess.create.alsoAcceptCreatorOf: string[]`:
  a create procedure can declare sibling types whose `creator` (create-capability)
  grant also authorizes the create - strictly the type-level creator grant, so it
  stays orthogonal to `create.parent` (which is instance-manage). It is backed by a
  new strict-creator auth primitive `hasCreateCapability({ objectType })` consumed
  by BOTH the create middleware and the frontend `canCreate` verdict (extended with
  an optional `alsoAcceptCreatorOf`), so the button gate and the backend can never
  drift. The boot conformance check now also verifies every `alsoAcceptCreatorOf`
  type is a real team-scoped type, and `catalog.group` / `catalog.environment` gain
  resource-name resolvers so their team grants render by name.

  BREAKING: `catalog.deleteGroup` input reshaped from a bare `string` to
  `{ id: string }` (mirrors the earlier `deleteSystem` reshape) so the per-group
  manage check can resolve the target id. `catalog.reorderGroups` stays a
  global-admin operation (it rewrites the single global sort order for all groups).
  Existing ownerless (global) groups and environments remain editable only by
  global catalog admins until re-owned; no data migration is required (team grants
  live in the auth relation store).

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/auth-common@0.15.0
  - @checkstack/auth-backend@0.12.0
  - @checkstack/ai-backend@0.11.3
  - @checkstack/backend-api@0.34.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/common@0.23.0
  - @checkstack/automation-backend@0.11.7
  - @checkstack/command-backend@0.2.26
  - @checkstack/gitops-backend@0.5.26
  - @checkstack/ai-common@0.6.7
  - @checkstack/cache-api@0.3.20
  - @checkstack/gitops-common@0.7.4
  - @checkstack/notification-common@1.7.2
  - @checkstack/signal-common@0.3.1
  - @checkstack/cache-utils@0.3.1

## 1.9.2

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ai-backend@0.11.2
  - @checkstack/automation-backend@0.11.6
  - @checkstack/ai-common@0.6.6
  - @checkstack/auth-backend@0.11.2
  - @checkstack/auth-common@0.14.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/gitops-backend@0.5.25
  - @checkstack/gitops-common@0.7.3
  - @checkstack/notification-common@1.7.1
  - @checkstack/signal-common@0.3.0

## 1.9.1

### Patch Changes

- Updated dependencies [6540703]
- Updated dependencies [099045f]
  - @checkstack/ai-backend@0.11.1
  - @checkstack/automation-backend@0.11.5

## 1.9.0

### Minor Changes

- d00e099: Make a catalog System's free-form `metadata` (custom fields) genuinely usable
  end to end, mirroring how Environment custom fields already work. Previously a
  System's `metadata` column was writable but nothing consumed it - it did not
  surface in templating, could not be set via GitOps, and had no UI editor, so
  models (and users) had no way to understand what it was for.

  Now a system's custom fields are surfaced everywhere an environment's already
  are:

  - **Config templating**: a system's fields render as
    `{{ system.metadata.<key> }}` in templatable health-check config (e.g. an
    HTTP URL). They are namespaced under `.metadata` so a field named `id`/`name`
    can never shadow the structural `{{ system.id }}` / `{{ system.name }}`.
  - **Satellites**: the fields ride the satellite assignment
    (`SatelliteAssignment.systemMetadata`) so satellite runs template
    `{{ system.metadata.<key> }}` identically to local runs.
  - **UI**: the System editor gains a free-form key/value custom-fields editor
    (extracted into a shared `CustomFieldsEditor` used by both the System and
    Environment editors).
  - **GitOps**: the `System` kind accepts optional `spec.fields`, replaced on
    every reconcile (same shape as the `Environment` kind).
  - **Script collectors**: inline TS collectors read `context.system.metadata`
    (SDK editor types updated), and shell collectors get one
    `CHECKSTACK_SYSTEM_<FIELD>` env var per field, mirroring
    `CHECKSTACK_ENV_<FIELD>`. A field that normalizes to a reserved name
    (`CHECKSTACK_SYSTEM_ID`/`_NAME`) is now skipped with a warning rather than
    clobbering the built-in; the same reserved-name guard was added to the
    environment shell-env builder (previously a custom field named `id`/`name`
    could shadow the structural var).
  - **Editor autocomplete/preview**: the health-check editor offers
    `{{ system.metadata.<key> }}` completions and previews their values when a
    concrete system is in context.

  The AI assistant is corrected on two fronts:

  - The catalog create/update-system (and create-environment) tool schemas now
    `.describe()` their `metadata` field, so a model knows it is free-form custom
    fields that surface in templating - not a tagging/labeling mechanism - and
    should only set keys the user explicitly asks for.
  - A new "Acting on requests" chat system-prompt rule tells the assistant to
    perform a requested change via its tool instead of deflecting to a manual
    GitOps/UI how-to, and to name the missing permission when a tool is genuinely
    unavailable. (This entry also covers the regenerated docs index reflecting the
    updated GitOps/templating docs.)

  State & scale: a system's metadata continues to live solely in the
  `catalog.systems.metadata` Postgres column and is read via the existing
  `getSystem` RPC, so every pod reads the same value. The satellite assignment
  carries a per-dispatch snapshot for the duration of that run (ephemeral,
  re-read on the next dispatch), not a second source of truth. No new table or
  migration.

### Patch Changes

- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d9f2771]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/ai-backend@0.11.0
  - @checkstack/signal-common@0.3.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/backend-api@0.33.0
  - @checkstack/automation-backend@0.11.4
  - @checkstack/ai-common@0.6.6
  - @checkstack/auth-backend@0.11.2
  - @checkstack/auth-common@0.14.0
  - @checkstack/cache-api@0.3.19
  - @checkstack/cache-utils@0.3.0
  - @checkstack/command-backend@0.2.25
  - @checkstack/common@0.22.0
  - @checkstack/gitops-backend@0.5.25
  - @checkstack/gitops-common@0.7.3
  - @checkstack/notification-common@1.7.1

## 1.8.1

### Patch Changes

- Updated dependencies [1f20b5a]
- Updated dependencies [5e704cd]
  - @checkstack/ai-backend@0.10.12
  - @checkstack/automation-backend@0.11.3
  - @checkstack/catalog-common@2.7.2
  - @checkstack/backend-api@0.32.1
  - @checkstack/auth-backend@0.11.1
  - @checkstack/command-backend@0.2.24
  - @checkstack/gitops-backend@0.5.24

## 1.8.0

### Minor Changes

- bd41130: perf(catalog): add index systems_environments_environment_idx on systems_environments(environment_id)

  The systems_environments junction table's primary key leads with system_id, leaving the environment_id direction unindexed. Reverse lookups (inArray(environment_id, ids)) used by the environment and system detail views had to scan the table. This adds a btree index on environment_id to serve those reverse-lookup queries.

### Patch Changes

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/auth-common@0.14.0
  - @checkstack/auth-backend@0.11.0
  - @checkstack/cache-utils@0.3.0
  - @checkstack/ai-backend@0.10.11
  - @checkstack/notification-common@1.7.0
  - @checkstack/automation-backend@0.11.2
  - @checkstack/command-backend@0.2.23
  - @checkstack/gitops-backend@0.5.23
  - @checkstack/catalog-common@2.7.1

## 1.7.0

### Minor Changes

- 43e4484: Persist a browse order for catalog groups.

  Groups gained a `sortOrder` column and a new `reorderGroups` procedure, so the
  order you arrange groups in is saved to the database and returned by
  `getGroups()` instead of being an ephemeral client-side header sort. The Groups
  management tab now has up/down reorder controls (disabled while a search filter
  is active, since reordering a filtered subset is ambiguous). A forward-only
  migration backfills a deterministic order (`row_number()` over `created_at, id`)
  for pre-existing groups. `reorderGroups` is gated on the global
  `catalog.group.manage` rule, consistent with the other group mutations.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- 43e4484: Batch the catalog backend's scoped-db read fan-outs and write groups into
  single `withScopedTransaction` calls so each pays one
  `BEGIN`/`SET LOCAL search_path`/`COMMIT` and holds one connection, instead of
  issuing N standalone per-query transactions. No behavior change: the same
  records, ordering, and output shapes are returned.

  - `getEntities` now reads systems + groups (with their memberships) via one
    batched `getEntitiesTopology()` under a single transaction (was 3 standalone
    scoped queries from `getSystems()` + `getGroups()` back-to-back).
  - `getGroups` batches its 2 reads (groups + all memberships) into one
    transaction.
  - `createGroup` wraps the `max(sortOrder)` read and the insert in one
    transaction. Besides cutting a round-trip, this tightens the
    read-then-insert window: the max read and insert now run back-to-back on one
    connection with no await interleaving between them.
  - `setSystemEnvironments` reads current membership, diffs, and applies the
    adds/removes inside one transaction, making the membership swap atomic (no
    partial state is observable) as well as batched.
  - The environment read fan-outs (`getEnvironments`, `getEnvironment`,
    `getEnvironmentsByIds`, and the system-scoped resolution behind
    `getSystemEnvironments` / `resolveSystemEnvironments`) each run their 2-3
    reads under one transaction.

- 43e4484: Incidents and maintenance: richer, safer update timelines.

  - **Markdown updates and descriptions.** Update messages and descriptions now
    render sanitized Markdown (bold, links, lists) everywhere they appear -
    detail pages, editors, the shared status-update timeline, and the public
    status page (which stays sanitized via `rehype-sanitize`). An "Markdown
    supported" hint is shown under the update composer.
  - **Edit and delete published updates.** New `editUpdate` / `deleteUpdate`
    procedures let a manager correct or remove an update in place; edited updates
    are marked "edited". Editing the `statusChange` of the latest update
    re-derives the incident/maintenance status. Deletion is irreversible and, on
    the AI path, always routes through propose/apply. Both procedures are
    object-scoped on the owning incident/maintenance (`idParam`), so team-scoped
    managers can use them without a global rule.
  - **Edit the published time of an update.** `editUpdate` now accepts an optional
    `createdAt`, and the update editor exposes a date/time picker (the same
    `DateTimePicker` used for maintenance windows) when editing an existing update.
    Re-timing an update re-orders the timeline and re-derives the incident/
    maintenance status (the header still follows the latest status-bearing
    update), so moving an update never leaves the header and timeline diverged.
  - **Per-update edit history (GitHub-style "history of edits").** Each in-place
    edit now archives the prior version of the update into a new durable
    `edit_history` `jsonb` column (a snapshot of message, status, visibility, and
    the published time it carried, plus when it was superseded). The shared status
    timeline turns the "edited" marker into an "edited (N)" disclosure that
    expands to show those prior versions. History is **manager-facing only**: the
    read path attaches `editHistory` solely for the manager audience and strips it
    for public / logged-in readers, so a version that was `internal` before being
    made `public` can never leak its prior internal content. A no-op edit
    (nothing actually changed) neither archives a snapshot nor marks the update
    "edited". Adds a forward-only, additive migration to each backend
    (`edit_history jsonb NOT NULL DEFAULT '[]'`, backfilling existing rows).
    We framed this as "either a delayed publish with undo OR a history of
    edits"; edit history satisfies the ask, so undo-send / delayed-publish is
    intentionally **deferred** (it would need a queue-delay + pending state and is
    redundant with history).
  - **Status updates are now editable from the editor dialog too, via one shared
    implementation.** The status-updates surface (add / edit / delete an update,
    including its published time and edit history) is extracted into a single
    `IncidentUpdatesSection` / `MaintenanceUpdatesSection` used by BOTH the detail
    page and the create/edit editor dialog, so the two surfaces can no longer
    drift. Previously the editor dialog showed a read-only timeline with no way to
    edit an existing update.
  - **Editable hotlinks.** Added-links can now be edited in place (label, URL, and
    visibility where applicable) instead of only added/removed. The shared
    `LinksEditor` gains an inline edit affordance, backed by a new `updateLink`
    procedure on incidents and maintenances and `updateSystemLink` on catalog
    systems (so system links are editable too). Each is object-scoped on its
    parent (`incidentId` / `maintenanceId` / `systemId`) with the same anti-spoof
    WHERE-clause scoping as the remove path, so a link id cannot be paired with a
    foreign parent the caller happens to manage. No migration is needed (the
    columns already exist).
  - **Per-update / per-link visibility.** A new shared visibility level
    (`public` / `logged_in` / `internal`) can be set on both updates and hotlinks
    via the same three-way visibility select in the editor (the update composer
    previously exposed only a binary public/internal toggle, so `logged_in` was
    unreachable for updates even though the backend already accepted and filtered
    it). Filtering is enforced SERVER-SIDE on every read path: anonymous callers
    and the public status-page projection see only `public`; authenticated
    non-managers additionally see `logged_in`; managers see everything. Updates
    still default to `public`, and `internal` updates never broadcast a
    notification. Adds a forward-only migration to each backend (new visibility
    enum + column, plus a nullable `edited_at` on updates).
  - **"Keep Current" shows the current status**, e.g. "Keep Current
    (Investigating)".
  - **Status colors.** Adds a blue `--status-info` token and a shared
    `StatusPillTone` / `pillToneStyles` in `@checkstack/ui`; incident "monitoring"
    and maintenance "scheduled" now read as informational (blue) instead of grey.
    The incident severity ramp is now blue(minor) -> amber(major) -> red(critical):
    a minor incident uses the blue `info` hue instead of grey, with no minor/major
    amber collision. This corrected ramp now also applies on the public status
    page (active-incident cards, severity pills, and the incident detail page) and
    in the system-detail active-incidents panel, which both previously still
    rendered `minor` grey.
  - **Logged-out overview.** Incidents and maintenance now expose a public,
    read-gated overview page and sidebar entry (the manage-gated config page is
    renamed "Manage ..."), so anonymous visitors who hold the default read rule
    can browse them.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/ai-backend@0.10.10
  - @checkstack/auth-backend@0.10.1
  - @checkstack/automation-backend@0.11.1
  - @checkstack/catalog-common@2.7.0
  - @checkstack/backend-api@0.31.1
  - @checkstack/notification-common@1.6.0
  - @checkstack/gitops-backend@0.5.22
  - @checkstack/command-backend@0.2.22

## 1.6.9

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/catalog-common@2.6.3
  - @checkstack/ai-backend@0.10.9
  - @checkstack/backend-api@0.31.0
  - @checkstack/automation-backend@0.11.0
  - @checkstack/auth-common@0.13.0
  - @checkstack/auth-backend@0.10.0
  - @checkstack/ai-common@0.6.6
  - @checkstack/cache-api@0.3.19
  - @checkstack/command-backend@0.2.21
  - @checkstack/gitops-backend@0.5.21
  - @checkstack/gitops-common@0.7.3
  - @checkstack/notification-common@1.5.3
  - @checkstack/signal-common@0.2.17
  - @checkstack/cache-utils@0.2.24

## 1.6.8

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
  - @checkstack/ai-backend@0.10.8
  - @checkstack/backend-api@0.30.0
  - @checkstack/automation-backend@0.10.10
  - @checkstack/auth-backend@0.9.5
  - @checkstack/command-backend@0.2.20
  - @checkstack/gitops-backend@0.5.20

## 1.6.7

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [a83bcc2]
- Updated dependencies [c55d7c6]
  - @checkstack/ai-backend@0.10.7
  - @checkstack/common@0.21.0
  - @checkstack/automation-backend@0.10.9
  - @checkstack/backend-api@0.29.1
  - @checkstack/ai-common@0.6.5
  - @checkstack/auth-backend@0.9.4
  - @checkstack/auth-common@0.12.2
  - @checkstack/cache-api@0.3.18
  - @checkstack/catalog-common@2.6.2
  - @checkstack/command-backend@0.2.19
  - @checkstack/gitops-backend@0.5.19
  - @checkstack/gitops-common@0.7.2
  - @checkstack/notification-common@1.5.2
  - @checkstack/signal-common@0.2.16
  - @checkstack/cache-utils@0.2.23

## 1.6.6

### Patch Changes

- Updated dependencies [faf98f5]
- Updated dependencies [faf98f5]
  - @checkstack/ai-backend@0.10.6
  - @checkstack/backend-api@0.29.0
  - @checkstack/common@0.20.0
  - @checkstack/automation-backend@0.10.8
  - @checkstack/auth-backend@0.9.3
  - @checkstack/command-backend@0.2.18
  - @checkstack/gitops-backend@0.5.18
  - @checkstack/gitops-common@0.7.1
  - @checkstack/ai-common@0.6.4
  - @checkstack/auth-common@0.12.1
  - @checkstack/cache-api@0.3.17
  - @checkstack/catalog-common@2.6.1
  - @checkstack/notification-common@1.5.1
  - @checkstack/signal-common@0.2.15
  - @checkstack/cache-utils@0.2.22

## 1.6.5

### Patch Changes

- Updated dependencies [e819276]
- Updated dependencies [e819276]
  - @checkstack/ai-backend@0.10.5
  - @checkstack/backend-api@0.28.0
  - @checkstack/automation-backend@0.10.7
  - @checkstack/auth-backend@0.9.2
  - @checkstack/command-backend@0.2.17
  - @checkstack/gitops-backend@0.5.17

## 1.6.4

### Patch Changes

- Updated dependencies [b4e0832]
  - @checkstack/ai-backend@0.10.4
  - @checkstack/automation-backend@0.10.6

## 1.6.3

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/ai-backend@0.10.3
  - @checkstack/gitops-common@0.7.0
  - @checkstack/automation-backend@0.10.5
  - @checkstack/gitops-backend@0.5.16
  - @checkstack/backend-api@0.27.1
  - @checkstack/auth-backend@0.9.1
  - @checkstack/command-backend@0.2.16

## 1.6.2

### Patch Changes

- Updated dependencies [0d912a3]
- Updated dependencies [d1b71b6]
- Updated dependencies [7c18b25]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [53666a7]
- Updated dependencies [0d912a3]
  - @checkstack/auth-backend@0.9.0
  - @checkstack/notification-common@1.5.0
  - @checkstack/ai-backend@0.10.2
  - @checkstack/common@0.19.0
  - @checkstack/backend-api@0.27.0
  - @checkstack/auth-common@0.12.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/automation-backend@0.10.4
  - @checkstack/ai-common@0.6.3
  - @checkstack/cache-api@0.3.16
  - @checkstack/cache-utils@0.2.21
  - @checkstack/command-backend@0.2.15
  - @checkstack/gitops-backend@0.5.15
  - @checkstack/gitops-common@0.6.8
  - @checkstack/signal-common@0.2.14

## 1.6.1

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ai-backend@0.10.1
  - @checkstack/automation-backend@0.10.3

## 1.6.0

### Minor Changes

- defb97b: feat(catalog): AI tools for environments

  Add `catalog.createEnvironment` and `catalog.setSystemEnvironments` AI tools plus
  a `catalog.listEnvironments` read projection, so the assistant can model
  one-system-many-environments instead of suggesting a separate system per
  environment. The `catalog.createSystem` tool description now teaches the 1-1
  system/check pairing and points to environments for modelling dev/staging/prod.

- defb97b: fix(catalog): emit a realtime signal on catalog mutations so clients refresh

  Catalog was the only domain plugin that never broadcast a realtime signal, so
  any out-of-band write - the AI assistant (which mutates on the backend, with no
  frontend mutation to invalidate), GitOps reconcile, or another pod/user - left
  every other client's catalog cache stale until a hard reload. Most visibly, a
  system created via the assistant 404'd on the catalog detail page (which
  resolves a system by finding it in the cached `getSystems` list) until reload.

  Add a `CATALOG_CHANGED` signal (`catalog.changed`) and broadcast it from every
  catalog mutation (system, group, environment CRUD and membership changes). The
  frontend signal auto-invalidator refreshes the `[[catalog]]` react-query cache
  on every connected client, so out-of-band catalog changes now appear without a
  reload.

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/ai-backend@0.10.0
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/automation-backend@0.10.2
  - @checkstack/ai-common@0.6.2
  - @checkstack/auth-backend@0.8.2
  - @checkstack/auth-common@0.11.2
  - @checkstack/backend-api@0.26.1
  - @checkstack/cache-api@0.3.15
  - @checkstack/command-backend@0.2.14
  - @checkstack/gitops-backend@0.5.14
  - @checkstack/gitops-common@0.6.7
  - @checkstack/notification-common@1.4.2
  - @checkstack/signal-common@0.2.13
  - @checkstack/cache-utils@0.2.20

## 1.5.5

### Patch Changes

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/ai-backend@0.9.1
  - @checkstack/backend-api@0.26.0
  - @checkstack/ai-common@0.6.1
  - @checkstack/auth-common@0.11.1
  - @checkstack/catalog-common@2.4.3
  - @checkstack/gitops-common@0.6.6
  - @checkstack/notification-common@1.4.1
  - @checkstack/auth-backend@0.8.1
  - @checkstack/automation-backend@0.10.1
  - @checkstack/cache-api@0.3.14
  - @checkstack/cache-utils@0.2.19
  - @checkstack/command-backend@0.2.13
  - @checkstack/common@0.17.0
  - @checkstack/gitops-backend@0.5.13

## 1.5.4

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/automation-backend@0.10.0
  - @checkstack/ai-backend@0.9.0

## 1.5.3

### Patch Changes

- 8cad340: refactor: typed router-factory args and structured logging

  Internal router factories that took long positional argument lists
  (`incident-backend`, `maintenance-backend`, and `notification-backend`'s
  `createNotificationRouter`) now take a single typed `deps` object, matching the
  `RouterDeps` convention already used by sibling routers and removing a class of
  easy-to-transpose call sites.

  Backend code paths that wrote to `console.*` now use the injected structured
  `Logger` so they respect log levels and correlation: the catalog router's
  notification-resource lifecycle warnings, the notification OAuth callback
  handler's errors, and the command router's search-provider failures. The
  command router factory now takes a typed `{ logger }` object.

- 8cad340: refactor: type Drizzle JSON columns at the schema to remove boundary casts

  The catalog `metadata` (systems/groups/environments) and `configuration`
  (views) JSON columns now carry their concrete shape via `.$type<>()`
  (`Record<string, unknown>` and `string[]` respectively), so the column type
  flows naturally into the RPC contract output and the ~14 `as unknown as
Array<... & { metadata: ... }>` and `as Record<string, unknown> | null` reader
  casts in the catalog router are gone. The plugin-system `source` column in
  `@checkstack/backend` is typed as `PluginSource`, removing its read-site cast.

  This is a type-only change: `.$type<>()` does not alter SQL, so no new
  migration is generated and existing migrations are untouched.

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/ai-backend@0.8.0
  - @checkstack/ai-common@0.6.0
  - @checkstack/auth-backend@0.8.0
  - @checkstack/automation-backend@0.9.3
  - @checkstack/gitops-backend@0.5.12
  - @checkstack/backend-api@0.25.0
  - @checkstack/notification-common@1.4.0
  - @checkstack/common@0.17.0
  - @checkstack/auth-common@0.11.0
  - @checkstack/command-backend@0.2.12
  - @checkstack/catalog-common@2.4.2
  - @checkstack/cache-api@0.3.14
  - @checkstack/gitops-common@0.6.5
  - @checkstack/cache-utils@0.2.19

## 1.5.2

### Patch Changes

- 2ec8f64: Security: auto-remediated fixable vulnerabilities flagged by the daily scan.

  - `hono` 4.12.23 → 4.12.25 (CVE-2026-54286, CVE-2026-54287, CVE-2026-54288, CVE-2026-54289, CVE-2026-54290)
  - `nodemailer` 9.0.0 → 9.0.1 (GHSA-p6gq-j5cr-w38f)
  - `dompurify` 3.4.3 → 3.4.11 (CVE-2026-49458, CVE-2026-49459, CVE-2026-49978, GHSA-76mc-f452-cxcm, GHSA-cmwh-pvxp-8882)
  - `protobufjs` 7.5.8 → 7.6.3 (CVE-2026-48712, CVE-2026-54269)
  - `undici` 7.24.7 → 7.28.0 (CVE-2026-9678, CVE-2026-9697)

- Updated dependencies [2ec8f64]
  - @checkstack/auth-backend@0.7.2
  - @checkstack/backend-api@0.24.1
  - @checkstack/automation-backend@0.9.2
  - @checkstack/ai-backend@0.7.2
  - @checkstack/command-backend@0.2.11
  - @checkstack/gitops-backend@0.5.11

## 1.5.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/backend-api@0.24.0
  - @checkstack/ai-backend@0.7.1
  - @checkstack/auth-backend@0.7.1
  - @checkstack/automation-backend@0.9.1
  - @checkstack/command-backend@0.2.10
  - @checkstack/gitops-backend@0.5.10
  - @checkstack/catalog-common@2.4.1

## 1.5.0

### Minor Changes

- d2077bd: Platform-wide team-scoped access control on a unified relation-tuple store.

  Admins can scope any resource to teams, and the **platform** (not each plugin)
  enforces it. A plugin opts in declaratively by adding `instanceAccess` to a
  procedure's contract; the auth middleware does the rest, so enforcement is
  consistent across catalog, health checks, incidents, maintenances, SLOs,
  automations, and the dependency map, and any third-party plugin gets it for free.

  Core model:

  - **Teams are optional.** A resource with no team grants behaves exactly as
    before.
  - **Team grants are additive and restrict who can CHANGE a resource, not who can
    SEE it.** Granting a team `Manage` lets its members view and change the
    resource; `Read-only` lets them view it. Either level grants access to team
    members **even when they lack the global permission**, and granting never
    removes read from anyone who already had it (e.g. a public status page stays
    readable). Privacy is a separate, explicit opt-in via the **Private** toggle,
    which removes the global read path so only the resource's teams can see it.
  - **Ownership at creation.** Create forms expose an **Owning team** picker. A
    non-admin can create a resource for a team they belong to that holds a
    create-capability grant for that type; the new resource is auto-granted to that
    team. Incidents and maintenances are **parent-gated**: anyone who can manage a
    system may open incidents/maintenances for it, no separate grant needed.
  - **Meaningful authorization errors.** A caller with neither the global rule nor
    any team grant for a resource type gets a `403` with a structured body instead
    of a silently-empty `200`. Anonymous callers on public endpoints are never
    `403`'d, so status pages keep rendering.

  Unified relation-tuple store:

  - The previously separate access primitives (`resource_team_access.canRead` /
    `.canManage`, ownership, `resource_access_settings.teamOnly`, and
    `resource_create_grant`) are collapsed onto ONE
    `relation_tuple(object, relation, subject)` store: "a team has
    `viewer`/`editor`/`owner` on an object, or `creator` on a type". Privacy is an
    explicit **`private` marker** tuple — its **presence** closes the global read
    path (team grants only), its **absence** is the readable-by-default state, so a
    private resource with zero grants is correctly inaccessible to everyone rather
    than silently globalized. The access decision is a pure, unit-tested function.
  - The auth API is generic: `writeRelation` / `removeRelation` / `setObjectPublic`
    / `listObjectRelations` / `listSubjectRelations` / `setCreateGrant` /
    `listTeamCreateGrants` (user-facing) and `check` / `listAccessibleObjectIds` /
    `hasAnyTypeGrant` / `authorizeCreate` / `setOwner` / `deleteObjectRelations`
    (service-to-service). Migration `0008` backfills tuples from the legacy tables
    and drops them.

  Explicit per-procedure scoping:

  - Access rules (`access()` / `accessPair()`) define only the rule (id, level,
    defaults); every procedure declares its own `instanceAccess`. This removes a
    "loaded gun" default that silently applied a shared `idParam` to any procedure
    which forgot its own override.
  - Modes: `idParam` (single-resource pre-check, fails **closed** if the id does
    not resolve), `listKey` / `recordKey` (post-filter a list/record to the
    accessible subset), `create` (authorize creation + write the owning-team
    grant), `parentScope` (scope by read/manage access to a PARENT type,
    cross-plugin single-hop: "you may see incidents/maintenances/SLOs/health for
    system S iff you may see S"), and `global: true` (the honest "intentionally not
    team-scoped" opt-out). A boot-time validator **rejects** any procedure gated on
    a team-scopable resource type that declares no `instanceAccess`, turning the
    previous fail-open into a boot error.

  Teams administration:

  - **Team managers** manage their own team's members and managers without the
    global `auth.teams.manage` rule; creating, deleting, and granting a team access
    remain admin-only.
  - A **standalone Teams page** (gated on `auth.teams.read`) lets managers reach
    team administration without the admin Auth Settings page; members are added via
    a debounced directory picker.
  - A **cross-plugin `ResourceResolverRegistry`** lets owning plugins register a
    name/search resolver for their resource types, so the Teams page lists a team's
    grants **by name** (grouped by type) and offers a resource picker — an admin can
    change a grant's level, revoke it, or add one, without auth depending on every
    plugin. Resolvers shipped for catalog systems, health-check configurations,
    incidents, maintenances, SLO objectives, and automations.

  Frontend:

  - The resource-side editor is **"Who can change this"** (one Manage checkbox per
    team; unticked = read-only), with an always-visible **Private** toggle
    (disabled until a team that can Manage exists, so a resource can't be stranded).
  - `TeamOwnershipPicker` explains _why_ there's nothing to pick (not a member of
    any team, or none of your teams manage the selected parent) instead of a bare
    "global resource" line.
  - Read-only **"who can change this"** indicators on resource detail pages expand
    to the actual people by name; bulk + per-row **Scope to team** actions in the
    catalog systems list; and the team-access copy spells out that grants are
    additive and that Read-only grants view (not change) even without the global
    permission.

  Security hardening:

  - Child deletes in catalog (`removeSystemContact` / `removeSystemLink`) are scoped
    to both the child id and its parent `systemId`, closing a cross-system IDOR for
    team-scoped managers.
  - `searchUsers` is restricted to team administrators, closing a directory/email
    enumeration path opened by the default `auth.teams.read` rule.
  - Grant setters reject unregistered resource types.

  BREAKING CHANGES (beta; shipped as minor bumps):

  - `access()` and `accessPair()` no longer accept `idParam` / `listKey` /
    `recordKey`; move instance config to the procedure's `instanceAccess`.
  - Boot fails if a procedure gated on a team-scopable resource type omits
    `instanceAccess`. Declare a scoping mode or `instanceAccess: { global: true }`.
  - The `AuthService` interface is reshaped: `check`, `listAccessibleObjectIds`,
    `hasAnyTypeGrant`, `authorizeCreate` (returns `isPrivate`), `setOwner`
    (`isPrivate`), and `deleteObjectRelations`. Custom `AuthService` implementations
    and mocks must update.
  - The auth RPC contract's per-concept resource-access endpoints are replaced by
    the generic tuple API above; external callers of the old
    `getResourceTeamAccess` / `setResourceTeamAccess` / `setResourceAccessSettings`
    / `grantResourceCreate` / etc. must move to the new procedures.
  - Several contract inputs changed from a bare `string` to an object so the
    middleware can resolve the resource id: catalog `deleteSystem` (`{ id }`),
    `removeSystemContact` / `removeSystemLink` (`{ id, systemId }`); health-check
    `deleteConfiguration` / `pauseConfiguration` / `resumeConfiguration` (`{ id }`).
    All in-tree callers are updated.
  - List/record endpoints that relied on returning an empty `200` to signal "no
    access" now return a `403` for categorically-unauthorized principals.
  - The mis-keyed bulk endpoints `getBulkIncidentsForSystems`,
    `getBulkMaintenancesForSystems`, and `getBulkObjectivesForSystems` no longer
    post-filter their (systemId-keyed) result; access is already gated by
    `catalog.system` upstream.
  - Team membership/manager mutations (`addUserToTeam`, `removeUserFromTeam`,
    `addTeamManager`, `removeTeamManager`) now require `auth.teams.read` instead of
    `auth.teams.manage` at the contract level (broadened to per-team managers).
  - The `resource_team_access`, `resource_access_settings`, and
    `resource_create_grant` tables are dropped (data backfilled into
    `relation_tuple` by migration `0008`). A previously inconsistent "team-only with
    zero grants" resource is now correctly inaccessible to global-access holders.

### Patch Changes

- Updated dependencies [551eaa9]
- Updated dependencies [d2077bd]
- Updated dependencies [5c6393f]
  - @checkstack/ai-backend@0.7.0
  - @checkstack/ai-common@0.5.0
  - @checkstack/auth-backend@0.7.0
  - @checkstack/auth-common@0.10.0
  - @checkstack/backend-api@0.23.0
  - @checkstack/common@0.16.0
  - @checkstack/automation-backend@0.9.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/command-backend@0.2.9
  - @checkstack/gitops-backend@0.5.9
  - @checkstack/cache-api@0.3.13
  - @checkstack/gitops-common@0.6.4
  - @checkstack/notification-common@1.3.4
  - @checkstack/cache-utils@0.2.18

## 1.4.12

### Patch Changes

- Updated dependencies [bb6f0fe]
  - @checkstack/ai-backend@0.6.1
  - @checkstack/automation-backend@0.8.1

## 1.4.11

### Patch Changes

- 079369a: Fix producing automation actions that double-prefixed their artifact type. The
  action registry qualifies `produces` with the owning plugin id, but several
  actions set `produces` to an already-qualified id, so it became
  `plugin.plugin.type` (e.g. `automation.automation.analysis`,
  `maintenance.maintenance.window`). This stored artifacts under a type that
  matched no registered artifact type, and — because the run scope exposes a
  produced artifact under its type's local name — broke the documented downstream
  reference `artifacts.<actionId>.<name>.<field>` (a `choose`/condition/template
  referencing the analysis output, a created incident/maintenance/etc. silently
  saw `undefined` and took the wrong branch).

  Fixed in `ai_analyze` (`analysis`), the built-in `notify_user`
  (`notify_user_result`), and the catalog (`system_record`), maintenance
  (`window`), notification (`send_result`), dependency (`edge`), and healthcheck
  (`assignment`) actions — each now uses the unqualified local id matching its
  artifact-type definition.

  BREAKING (beta): any automation that referenced one of these artifacts via the
  old double-prefixed scope key (e.g. `artifacts.x['automation.analysis']`) must
  switch to the documented form (`artifacts.x.analysis.<field>`). The
  double-prefixed key was never the intended/documented path.

- Updated dependencies [079369a]
- Updated dependencies [4134ed9]
- Updated dependencies [6005271]
- Updated dependencies [748268c]
- Updated dependencies [4134ed9]
- Updated dependencies [4134ed9]
- Updated dependencies [079369a]
- Updated dependencies [079369a]
  - @checkstack/ai-backend@0.6.0
  - @checkstack/ai-common@0.4.0
  - @checkstack/automation-backend@0.8.0
  - @checkstack/backend-api@0.22.0
  - @checkstack/auth-backend@0.6.1
  - @checkstack/auth-common@0.9.1
  - @checkstack/command-backend@0.2.8
  - @checkstack/gitops-backend@0.5.8
  - @checkstack/catalog-common@2.3.6

## 1.4.10

### Patch Changes

- Updated dependencies [ebef442]
- Updated dependencies [ebef442]
  - @checkstack/automation-backend@0.7.0
  - @checkstack/auth-backend@0.6.0
  - @checkstack/auth-common@0.9.0
  - @checkstack/ai-backend@0.5.0
  - @checkstack/ai-common@0.3.0
  - @checkstack/catalog-common@2.3.5
  - @checkstack/backend-api@0.21.7
  - @checkstack/command-backend@0.2.7
  - @checkstack/gitops-backend@0.5.7

## 1.4.9

### Patch Changes

- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [0ffe357]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
- Updated dependencies [c4bebbb]
  - @checkstack/ai-backend@0.4.0
  - @checkstack/automation-backend@0.6.0
  - @checkstack/ai-common@0.2.0

## 1.4.8

### Patch Changes

- Updated dependencies [dbb76a2]
- Updated dependencies [0b6f01b]
  - @checkstack/ai-backend@0.3.0
  - @checkstack/automation-backend@0.5.8
  - @checkstack/backend-api@0.21.6
  - @checkstack/auth-backend@0.5.6
  - @checkstack/command-backend@0.2.6
  - @checkstack/gitops-backend@0.5.6

## 1.4.7

### Patch Changes

- Updated dependencies [2428bfc]
  - @checkstack/ai-backend@0.2.0
  - @checkstack/automation-backend@0.5.7

## 1.4.6

### Patch Changes

- Updated dependencies [f9cfdae]
  - @checkstack/ai-backend@0.1.6
  - @checkstack/automation-backend@0.5.6

## 1.4.5

### Patch Changes

- Updated dependencies [0626782]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/backend-api@0.21.5
  - @checkstack/auth-backend@0.5.5
  - @checkstack/auth-common@0.8.3
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ai-backend@0.1.5
  - @checkstack/common@0.15.0
  - @checkstack/ai-common@0.1.3
  - @checkstack/gitops-common@0.6.3
  - @checkstack/notification-common@1.3.3
  - @checkstack/automation-backend@0.5.5
  - @checkstack/command-backend@0.2.5
  - @checkstack/gitops-backend@0.5.5
  - @checkstack/cache-api@0.3.12
  - @checkstack/cache-utils@0.2.17

## 1.4.4

### Patch Changes

- Updated dependencies [b50916d]
  - @checkstack/backend-api@0.21.4
  - @checkstack/ai-backend@0.1.4
  - @checkstack/auth-backend@0.5.4
  - @checkstack/automation-backend@0.5.4
  - @checkstack/command-backend@0.2.4
  - @checkstack/gitops-backend@0.5.4

## 1.4.3

### Patch Changes

- Updated dependencies [00b9367]
  - @checkstack/ai-backend@0.1.3
  - @checkstack/automation-backend@0.5.3
  - @checkstack/catalog-common@2.3.3
  - @checkstack/ai-common@0.1.2
  - @checkstack/auth-backend@0.5.3
  - @checkstack/auth-common@0.8.2
  - @checkstack/backend-api@0.21.3
  - @checkstack/cache-api@0.3.11
  - @checkstack/cache-utils@0.2.16
  - @checkstack/command-backend@0.2.3
  - @checkstack/common@0.14.1
  - @checkstack/gitops-backend@0.5.3
  - @checkstack/gitops-common@0.6.2
  - @checkstack/notification-common@1.3.2

## 1.4.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/ai-backend@0.1.2
  - @checkstack/ai-common@0.1.2
  - @checkstack/auth-backend@0.5.2
  - @checkstack/auth-common@0.8.2
  - @checkstack/automation-backend@0.5.2
  - @checkstack/backend-api@0.21.2
  - @checkstack/cache-api@0.3.11
  - @checkstack/catalog-common@2.3.2
  - @checkstack/command-backend@0.2.2
  - @checkstack/gitops-backend@0.5.2
  - @checkstack/gitops-common@0.6.2
  - @checkstack/notification-common@1.3.2
  - @checkstack/cache-utils@0.2.16

## 1.4.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/backend-api@0.21.1
  - @checkstack/cache-api@0.3.10
  - @checkstack/ai-backend@0.1.1
  - @checkstack/ai-common@0.1.1
  - @checkstack/auth-backend@0.5.1
  - @checkstack/auth-common@0.8.1
  - @checkstack/automation-backend@0.5.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/command-backend@0.2.1
  - @checkstack/gitops-backend@0.5.1
  - @checkstack/gitops-common@0.6.1
  - @checkstack/notification-common@1.3.1
  - @checkstack/cache-utils@0.2.15

## 1.4.0

### Minor Changes

- 9dcc848: Plugin-owned AI tools: every domain plugin contributes its own AI tools (chat assistant + automation AI action), and `ai-backend` is platform-only.

  Every plugin-specific AI tool is owned by the plugin whose domain it acts on, registered via that plugin's own `aiToolExtensionPoint` / `aiToolProjectionExtensionPoint` from its init - the same path an external plugin author uses. `ai-backend` no longer imports or depends on any capability plugin's `*-common`; the dependency direction is strictly plugin -> ai-platform. Pure helpers (`computeFieldDiff`, capability-summary, `ScriptContextKind`) live in `@checkstack/ai-common`.

  Tools shipped:

  - Health checks and automations: full CRUD - `healthcheck.propose` / `automation.propose` and `*.update` (`mutate`, deep-validated) and `*.delete` (`destructive`, always confirm-gated). `healthcheck.propose`'s dry-run calls the new deep `validateConfiguration` so propose-time validation matches apply-time. Assertions are validated against the collector's result schema and the canonical operator vocabulary. Capability-catalog tools (`ai.listCapabilities`, `ai.getCapabilitySchema`), script context tools (`ai.getScriptContext`, `ai.testScript`), and notify-subscriber tools (`healthcheck.notifySystemSubscribers` / `...GroupSubscribers`).
  - Catalog: `catalog.createSystem` / `updateSystem` / `createGroup` / `updateGroup` (`mutate`), `catalog.deleteSystem` / `deleteGroup` (`destructive`), membership tools (`mutate`), plus `catalog.listSystems` / `listGroups` read projections.
  - Incident: `incident.create` / `update` / `addUpdate` / `resolve` / `addLink` (`mutate`), `incident.delete` / `removeLink` (`destructive`), and `incident.get` / `incident.list` read projections.
  - Maintenance: `maintenance.create` / `update` / `addUpdate` / `close` / `addLink` (`mutate`), `maintenance.delete` / `removeLink` (`destructive`), and `maintenance.list` / `get` read projections.
  - Read projections for SLO (`slo.listObjectives`), dependency (`dependency.list`), incident (`incident.list`), healthcheck (`healthcheck.status`), and anomaly (`anomaly.explain`), each gated by the source procedure's own access rule and routed as the principal.
  - Documentation grounding: `ai.searchDocs` / `ai.getDoc` over a build-time bundled docs index (BM25-ish ranking), so the assistant grounds how-to answers in Checkstack's own docs offline.
  - URL introspection: `ai.probeUrl`, an SSRF-guarded read tool the assistant uses to inspect a real endpoint before drafting a health check. Update tools compute a before -> after field diff rendered on the confirm card (approve mode) or an "Applied" card (auto mode), so a change is never silent.

  `ai_analyze` automation action (automation-backend, with an editor connection picker + audited tool calls): runs a bounded AI agent on the run context as the automation's `runAs` service account, so it can never exceed that identity's permissions; destructive tools are never offered; mutating tools auto-apply through the service account's client. Produces an `automation.analysis` artifact downstream actions can branch on. The agent loop is exposed as a headless `aiAgentRunnerRef` service so automation-backend can drive it without depending on ai-backend.

  `notification.notifyForSubscription` is now callable by user / application principals holding `notification.send` (previously service-only). Every tool routes through the user-scoped client, so handler-side authorization is enforced exactly as a direct UI/RPC action; the resolver gate plus the propose/apply re-check at propose AND apply are the additional authority. A systemic authz regression test asserts every registered tool falls into exactly one safe authorization category.

  A new `ai_transport` enum value `automation` records the AI action's tool calls in the `ai_tool_calls` audit log. No new durable state beyond that; each tool is a thin, deterministic wrapper over an existing RPC, so every pod behaves identically.

  This is a beta minor.

- 9dcc848: Redesign the catalog into a group-first browse view and tabbed management tables, with inline health rollups.

  - Browse view: the catalog home is a real read-only, scale-built experience - collapsible group sections (with member counts) plus a synthetic Ungrouped section, a shared toolbar (search, group/health/tag filters, density toggle), URL-backed view state (shareable deep links), polished empty states, and a manager-only "Manage catalog" link. Per-system status badges render through the existing `SystemStateBadgesSlot`; filtering is client-side over the loaded set.
  - Management: redesigned as tabbed data tables (Systems / Groups / Environments) replacing the two-column drag-to-assign layout. Systems get multi-select + a bulk bar, inline health, and group + environment membership as removable chips with type-ahead pickers (portaled so they are never clipped); Groups get inline rename and member chips; Environments get a name / members / field-count table (CRUD gated by `catalog.environment.manage`). GitOps-locked rows stay read-only. Drag-and-drop (and `@dnd-kit` on this page) is removed; the management page also shares the browse toolbar.
  - Inline health rollups: a new platform contract `CatalogBrowseHealthSlot` (`@checkstack/catalog-common`) - an additive optional slot catalog-frontend only consumes (a headless data boundary feeding group rollups + the health filter), with a catalog-owned `CatalogHealthStatus` vocabulary so catalog gains no health-plugin dependency. Group headers show a rollup pill derived from the reported status DATA (a system absent from the map is `"unknown"`, never healthy); all-healthy groups start collapsed. The health filter is wired on both toolbars and enables once a filler reports. healthcheck-frontend fills the slot by reusing dashboard-frontend's `SystemBadgeDataProvider`. When no health source is installed the slot is unfilled and the catalog stays fully functional.

  This is a beta minor.

- 9dcc848: Add environments as a first-class catalog primitive, with per-environment health-check fan-out, config templating, per-environment reactive health, and script run-context exposure.

  - Catalog primitive: an environment is a sibling of groups - a named, instance-global record carrying free-form custom fields (baseUrl, region, tier, ...) that any system can belong to many-to-many. New `environments` + `systems_environments` tables, `EnvironmentSchema` + create/update schemas, `EntityService` environment CRUD and membership joins, RPC endpoints gated by a new `catalogAccess.environment` access rule, a GitOps `Environment` kind + `System.environments` extension, and frontend management (an `EnvironmentEditor`, an Environments management panel, and a per-system environment picker). The Environments card's Add/Edit/Delete affordances are gated on `catalogAccess.environment.manage`.
  - Per-environment fan-out: run identity becomes `(systemId, configurationId, environmentId)`. Runs, aggregates, and state transitions gain a nullable `environmentId`. The health-check assignment gains an `environmentIds` selector with three modes (All / Specific / None; `null` and `[]` are distinct). The queue executor resolves the effective environment set via the catalog `resolveSystemEnvironments` read and executes one isolated run per environment.
  - Config templating: a new `x-templatable` config-field marker renders a string field through the template engine at execute time, against `{ environment, check, system }`. A shared `renderTemplatableConfig` and a `renderTemplatePreview` helper (re-exported from `@checkstack/template-engine`) keep editor previews identical to the run-time render. The HTTP collector's `url`, `headers[].value`, and `body` are templatable, rendered per environment (the strategy client build moves inside the per-env loop); the `url`'s `.url()` validation moves post-render. Secrets resolve before templating; a field marked both secret and `x-templatable` is rejected at plugin load. `DynamicForm` shows a live "Preview" line, and the catalog `EnvironmentPreviewPicker` ("Preview as: <environment>") drives it in the collector editor (only when the schema has a templatable field).
  - Script run-context: `CollectorRunContext` gains an optional `environment` field (`{ id, name, fields }`, metadata only). Shell collectors receive `CHECKSTACK_ENV_ID` / `_NAME` / `CHECKSTACK_ENV_<FIELD>` vars; inline TS collectors read `globalThis.context.environment`; the editor test panel mirrors both. The env-less path is unchanged.
  - Per-environment reactive health (see BREAKING below), env-keyed read/write paths, env-qualified serialization locks, an optional `trigger.payload.environmentId`, per-environment isolation, and an `ENVIRONMENT_RESOLUTION_FAILED` signal when catalog resolution degrades to a single env-less run.

  BREAKING CHANGES: the reactive `health` entity's id-shape and cardinality change. It now encodes two views: per-environment (id `"<systemId>::<environmentId>"`) and a system rollup (id `"<systemId>"`, the worst status across environments + env-less runs). The rollup PRESERVES the pre-existing system-level contract - dashboards, status badges, and automations referencing health by `systemId` keep working without re-authoring - but the entity's contract surface changed (new id-shape, higher cardinality, new payload field), so it is flagged breaking. `getBulkHealthState` parses env-qualified ids and keys results by the original id.

  State and scale: membership and custom fields live only in catalog Postgres and are re-read every tick via the cross-plugin RPC; env-keyed health reads from shared `health_check_runs` / aggregates / transitions (compute-on-read). Every pod resolves the same effective set and the same per-environment health. No pod-local environment state.

  Also: `unwrapSchema` in `zod-config.ts` loops instead of single-pass-stripping so multi-layer wrappers (`.optional().default()`) still resolve `x-templatable` meta. The env-less `{{ environment.* }}` run notice logs at `debug` (a legitimate recurring configuration), while the post-render HTTP `.url()` check still fails a genuinely-broken empty render with a clear "Rendered URL is invalid" error.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Write-path hardening: post-commit side effects can no longer fail a committed write, multi-row mutations are now atomic, and retry-duplication is blocked at the database.

  **Platform-level (automatic for all current and future plugins):**

  - signal-backend: `SignalService` (broadcast / sendToUser / sendToUsers / sendToAuthorizedUsers) is now resilient by construction - a transient event-bus/queue failure is caught and logged instead of thrown. Real-time signals are best-effort UI nudges; the authoritative data is already committed by the time a mutation broadcasts, so a signal-transport blip must never turn a successful write into a client-visible error. Every plugin's broadcasts inherit this without per-call-site `try/catch` (which would inevitably be forgotten and regress). This mirrors `createCachedScope`, which already makes cache invalidation non-throwing - so the cache + signal halves of the "post-commit side effect fails the response" class are both closed at the platform seam. Durable side effects (events/hooks that drive automations, queue jobs) intentionally still surface failures. Documented in `developer-guide/backend/signals.md`.

  **Atomic multi-write mutations (each previously committed row-by-row in autocommit, so a mid-sequence failure left partial/orphaned state):**

  - slo-backend: `createObjective` now inserts the objective and its 1:1 streak row in one transaction; the post-create reconcile/status/notify steps are best-effort and can no longer fail the (committed) create.
  - incident-backend: `createIncident`, `updateIncident`, `addUpdate`, and `resolveIncident` wrap their row + system-link + timeline writes in a transaction (no more wiped system associations on a failed re-insert, or status flips with no matching timeline entry).
  - maintenance-backend: same for `createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`.
  - automation-backend: `cancelRun` marks the run cancelled and tears down its wait locks + durable state in one transaction - previously a failure after the status update could leave a wait lock behind, letting a later trigger event resume an already-cancelled run.
  - healthcheck-backend: `ingestSatelliteResult` commits the run row and its hourly-aggregate increment together (no orphaned run, no aggregate without a backing run). NOTE: this guarantees run/aggregate consistency but does not yet make a _duplicate satellite delivery_ idempotent - that needs a dedupe key on the high-volume runs table and is tracked as a follow-up.

  **Retry-duplication blocked at the DB (paired with the SQLSTATE 23505 -> 409 mapping shipped separately):**

  - catalog-backend: new unique indexes on `groups.name`, `environments.name` (consistent with `systems.name`), on `system_links (system_id, url)`, and on `system_contacts (system_id, user_id)` + `(system_id, email)` (NULLs are distinct, so user vs mailbox contacts don't interfere). Name uniqueness is CASE-INSENSITIVE: the three name indexes are functional `lower(name)` indexes (the existing `systems.name` index is rebuilt this way too), so "Api" and "api" collide while the stored value keeps its original casing. The systems pre-write name check (`getSystemByName`) is case-folded to match. Migration `0005` de-dupes any pre-existing rows first - names are preserved by suffixing later case-insensitive duplicates (" (2)", " (3)", ...), redundant contact/link rows are removed keeping the earliest. (Link URLs stay case-sensitive - URL paths are; contact emails are deduped exact-match.)
  - incident-backend / maintenance-backend: unique index on `incident_links (incident_id, url)` / `maintenance_links (maintenance_id, url)`, with a de-dupe step in the migration.

    **Behavior change:** creating a group/environment with a duplicate name, or attaching a duplicate contact/link, now returns `409 Conflict` instead of silently creating a duplicate. The migrations resolve existing duplicates on upgrade.

  This is a beta patch.

- 9dcc848: Assorted bug fixes and small hardening across the platform.

  - announcement-backend: `updateAnnouncement` now invalidates the active-announcements and admin-list caches (it was missing the `invalidateAllActive` / `invalidateListAll` calls), so an edited announcement no longer stays stale up to the 45s TTL.
  - anomaly-backend: anomaly/drift state transitions (confirmations, recoveries, self-resolutions) now log at `debug` instead of info/warn - they are already surfaced via the `ANOMALY_STATE_CHANGED` signal, so logging them louder just added noise; genuine failure paths stay `warn`.
  - backend: the `/api/:pluginId/*` dispatcher now populates `requestHeaders` on the per-request RPC context, so a handler that re-enters the router as the originating user (e.g. an AI tool's user-scoped client) can forward the caller's session cookie / bearer - previously the loopback failed with "Authentication required". Guarded by a real end-to-end integration test. The HTTP server idle timeout is also raised (default 255s, configurable via `CHECKSTACK_SERVER_IDLE_TIMEOUT_SECONDS`, clamped 0-255, reset on each streamed chunk) so long AI chat SSE turns are not severed mid-stream.
  - backend: a request for an unknown plugin id (`/api/<unknown>/...`) now returns `404 Not Found` instead of `500` (and logs at warn, not error, since it is a client request) - an unknown _procedure_ on a known plugin already 404'd. The in-app docs namespace `/checkstack/*` now serves Starlight's own `404.html` with a real 404 status for a missing doc, instead of falling through to the SPA catch-all and 200-ing the app shell. Both guarded by tests.
  - automation-common: remove polynomial-time backtracking from `toShellEnvKey`'s underscore-trim (CodeQL `js/polynomial-redos`); a negative look-behind anchors the trailing run, keeping the trim linear.
  - common + script-packages-common: the pure transport-safe sandbox-policy schema (`sandboxPolicySchema` and its sub-schemas + inferred types) moved to `@checkstack/common` (the neutral base), removing two inverted deps that existed only to reach the shape; `@checkstack/backend-api` continues to re-export it. The schema is no longer exported from `@checkstack/script-packages-common`. Pure refactor, no behavior change.
  - catalog-backend: reject duplicate system names (a `CONFLICT` on create/rename, enforced by a pre-write check AND a new DB unique index on `systems.name`, migration 0004 which first resolves pre-existing duplicates by suffixing).
  - catalog-frontend: detail-page cleanups (use `<NotFound />` not `<AccessDenied />` on the not-found branch, a readable key/value metadata list via `normalizeMetadata`, runtime locale via `formatDate`); and stop the browse view re-rendering on every health report (adopt a new statuses report only when a value actually changed, via `healthStatusesEqual`, so rows stay stable and interactive).
  - healthcheck-backend: fix the daily-rollup retention step failing with an `ON CONFLICT` mismatch (SQLSTATE 42P10) after `environmentId` joined the `health_check_aggregates` unique constraint - the rollup now groups by (day, environmentId, sourceId) and uses a single exported conflict-target constant (`DAILY_AGGREGATE_CONFLICT_TARGET`) kept in lock-step with the schema by a unit test.
  - automation-frontend: the service-account picker's "Learn more" links are now absolute URLs to the deployed Astro docs site (they 404ed as in-app relative paths). The Monaco script editor double-init crash is fixed (serialized cold init, a guarded `monacoGuard` accessor, theme/type effects gated on `apiReady`).
  - auth-frontend: bound the desktop user-menu popover height (`max-h-[var(--radix-popover-content-available-height)]` + `overflow-y-auto`) so it no longer clips on short viewports, and fold the standalone `Account > Profile` item into a focusable name/email header (`profileHref` on `UserMenu`); the now-empty `Account` group no longer renders.
  - satellite-frontend: picked up via the sidebar-nav migration (account-only user menu).

  (Related UI fixes - the Monaco editor following the app theme, the `DynamicOptionsField` no-flash fix, the shared `Spinner`, GFM tables, and the user-menu popover bound - land their `@checkstack/ui` bump in the UI/perf changesets where `@checkstack/ui` is already minored.)

  This is a beta patch.

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ai-backend@0.1.0
  - @checkstack/ai-common@0.1.0
  - @checkstack/auth-backend@0.5.0
  - @checkstack/auth-common@0.8.0
  - @checkstack/backend-api@0.21.0
  - @checkstack/automation-backend@0.5.0
  - @checkstack/notification-common@1.3.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/command-backend@0.2.0
  - @checkstack/gitops-backend@0.5.0
  - @checkstack/gitops-common@0.6.0
  - @checkstack/cache-api@0.3.9
  - @checkstack/cache-utils@0.2.14

## 1.3.1

### Patch Changes

- Updated dependencies [a57f7db]
  - @checkstack/backend-api@0.20.0
  - @checkstack/automation-backend@0.4.0
  - @checkstack/auth-backend@0.4.33
  - @checkstack/cache-api@0.3.8
  - @checkstack/command-backend@0.1.33
  - @checkstack/gitops-backend@0.4.1
  - @checkstack/cache-utils@0.2.13

## 1.3.0

### Minor Changes

- b995afb: Make `catalog-system` and `catalog-group` plugin-backed reactive entities via the Model-B entity state machine.

  Catalog defines a `catalog-system` entity `{ name, description, metadata }` and a `catalog-group` entity `{ name, metadata }`. The `systems` / `groups` tables are BOTH authoritative AND the entities' current-state storage - there is no framework `entity_state` row for a catalog system/group. `defineEntity` is given plugin `read` accessors (`EntityService.getManySystemEntityStates` / `getManyGroupEntityStates`) that project the reactive subsets straight off those tables, and every reactive-state write goes through `handle.mutate` / `handle.remove`: `apply` performs the REAL `systems` / `groups` write (the plugin's own db/tx) and returns the new state; the framework snapshots `prev` via `read` BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED` AFTER the write commits. Covered sites: create-system, update-system, delete-system (tombstone), create-group, update-group, delete-group (tombstone), and the `system.update_metadata` automation action. Create sites pre-generate the id so the handle is keyed on it and the create's `prev` snapshot reads the not-yet-existing row as absent; `EntityService.createSystem` / `createGroup` accept an optional pre-generated `id` (server-owned either way).

  Change -> trigger-event derivers reproduce the existing qualified events (emitting the TRIGGER event ids automations match on, not the dotted hook ids):

  - `catalog-system`: create -> `catalog.created`; tombstone -> `catalog.deleted`; field update -> `catalog.updated`.
  - `catalog-group`: create -> `catalog.group.created`; tombstone -> `catalog.group.deleted` (a pure group update fires nothing).

  Mirrors are diff-suppressed (a save-with-no-diff stays a no-op). The `catalog.system.*` / `catalog.group.*` cross-plugin hooks are removed in the same effort (see the healthcheck/catalog hook-removal changeset); cross-plugin consumers (incident, dependency, slo, healthcheck) read via `onEntityChanged`.

  BREAKING CHANGES (behavior): none for trigger-event consumers - the same qualified trigger events still fire via the change derivers, and `onEntityChanged` consumers see the same change event. The only observable change is internal: catalog current state is read from the `systems` / `groups` tables instead of `entity_state`, and writes route through the entity handle. The `system.update_metadata` action's race-deleted ("disappeared mid-update") path now drives a no-op entity write (the framework diffs it as no change) before returning failure, instead of skipping the write entirely; no event fires either way.

- b995afb: Close a run-secret masking gap on run-originated catalog entity writes (security).

  `writeCatalogSystemEntity` / `writeCatalogGroupEntity` had no `opts` parameter, so the `system.update_metadata` automation action (which has the dispatch `runId` in scope) could not forward it. Catalog `metadata` is `z.record(z.string(), z.unknown())` — the only reactive catalog field that can carry an arbitrary secret string — so a run-resolved secret merged into metadata would land UNMASKED in both the `entity_transitions` rows and the cluster-wide `ENTITY_CHANGED` event.

  The catalog entity writers now accept `opts?: EntityMutationOpts` and forward it into `handle.mutate` / `handle.remove` (mirroring maintenance/slo), and `system.update_metadata` passes `opts: { runId }`. Run-resolved secrets in metadata are now masked in both the emit and the transition rows.

- b995afb: Remove the now-unused healthcheck + catalog entity hooks; rely on the reactive entities + change derivers (reactive automation engine Phase 4, final step of §10.3 / §10.4).

  Now that every cross-plugin consumer (slo, dependency, incident, and healthcheck's own catalog-cleanup) reads these domains via `onEntityChanged`, the producers stop emitting the entity-change hooks and the trigger registrations become entity-driven (fired by the entity change deriver via Stage-1 routing, with a no-op `setup` so they stay in the editor's trigger catalog).

  - **healthcheck**: stops emitting `healthcheck.system.degraded` / `.healthy` / `.health_changed` from the queue executor (the `health` entity mirror is the single source of truth). Its own `catalog.system.deleted` consumer switched to `onEntityChanged({ kind: "catalog-system" })` on tombstones (work-queue delivery preserved). The directional/umbrella triggers are now entity-driven.
  - **catalog**: stops emitting `catalog.system.created` / `.updated` / `.deleted` and `catalog.group.created` / `.deleted` from the router + the `system.update_metadata` action (the `catalog-system` / `catalog-group` mirrors are authoritative). The system triggers are now entity-driven.

  CORRECTNESS FIX (also affects the earlier healthcheck/catalog Phase-4 steps in this branch): the change derivers now emit the TRIGGER qualifiedIds that automations actually store in `trigger.event` and that Stage-1 routing matches on (`findEnabledByTriggerEvent`), NOT the dotted hook ids. Healthcheck triggers use underscore ids, so the deriver emits `healthcheck.system_degraded` / `system_healthy` / `system_health_changed` (not `healthcheck.system.degraded`). Catalog system triggers use ids `created`/`updated`/`deleted`, so the deriver emits `catalog.created` / `catalog.updated` / `catalog.deleted` (not `catalog.system.created`). Without this fix the migrated automations would never fire.

  BREAKING CHANGES:

  - `healthcheck.system.degraded` / `healthcheck.system.healthy` / `healthcheck.system.health_changed` cross-plugin hooks are removed. The reactive `health` entity drives the matching trigger events (`healthcheck.system_degraded` / `_healthy` / `_health_changed`), so existing automations keep firing. Kept healthcheck hooks: `assignment.changed`, `check.completed`, `check.failed`, `flapping_detected`.
  - `catalog.system.created` / `.updated` / `.deleted` and `catalog.group.created` / `.deleted` cross-plugin hooks are removed. The reactive `catalog-system` / `catalog-group` entities drive the matching trigger events (`catalog.created` / `.updated` / `.deleted`); cross-plugin cleanup reactors subscribe to the `catalog-system` tombstone via `onEntityChanged`. `catalogHooks` / `healthCheckHooks` remain exported (the removed members are gone) for a stable import surface.

- b995afb: Restore the documented domain payload fields on entity-driven automation triggers.

  Migrated triggers declare domain-named `payloadSchema`s (incident `incidentId`; health `systemId` / `previousStatus`; catalog `systemId` / `changedFields`; dependency `dependencyId`), but Stage-2 dispatch built `trigger.payload` from the generic entity-change shape (`{ kind, id, prev, next, delta, ...next }`). Operator filters and templates reading `trigger.payload.incidentId` / `.systemId` / `.previousStatus` silently resolved to `undefined` — a regression vs the legacy hook payloads.

  Changes:

  - `@checkstack/automation-backend`: `registerChangeDeriver` now accepts an optional per-kind `toPayload(changed) => Record<string, unknown>` mapper (at most one per kind; a second distinct mapper throws). Stage-2's `changedToPayload` uses the registered mapper to build `trigger.payload` so it matches the kind's declared `payloadSchema`, falling back to the generic change shape for kinds without a mapper. New exported type `EntityChangePayloadMapper`.
  - `@checkstack/incident-backend`, `@checkstack/healthcheck-backend`, `@checkstack/catalog-backend`, `@checkstack/dependency-backend`: implement and register a `toPayload` for each entity-driven kind so `trigger.payload` carries the legacy domain keys again.

  Descriptive incident payload fields not derivable from the reactive entity state (`title`, `description`, `createdAt`, `resolvedAt`) are now OPTIONAL on the incident trigger `payloadSchema`s — they were always absent from an entity-driven payload.

### Patch Changes

- b995afb: Extract a shared `withEntityWrite` / `withEntityRemove` guard for PLUGIN-BACKED (Model B) reactive entities and refactor the per-domain copies onto it.

  Every plugin-backed domain (incident, catalog, dependency, maintenance, slo, satellite) reimplemented the same "no handle wired → run the plugin write directly; handle wired → route through `handle.mutate` / `handle.remove`" guard, varying only in the id-key name. `@checkstack/automation-backend` now exports `withEntityWrite` / `withEntityRemove` (from the entity barrel) and each domain's thin, well-named wrappers (`writeIncidentEntity`, `writeMaintenanceEntity`, satellite's `mirror`, …) delegate to it, so the branch lives in exactly one place. Behavior is unchanged.

  `writeHealthEntity` (healthcheck-backend) is intentionally NOT migrated onto the helper — it is genuinely bespoke (closure-captured durable state, distinct rethrow-vs-fail-soft branches, a per-system serializer, and it returns the computed state). SLO keeps its fail-soft `onError` wrapper around the shared guard.

- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
  - @checkstack/backend-api@0.19.0
  - @checkstack/automation-backend@0.3.0
  - @checkstack/gitops-common@0.5.0
  - @checkstack/gitops-backend@0.4.0
  - @checkstack/auth-backend@0.4.32
  - @checkstack/cache-api@0.3.7
  - @checkstack/command-backend@0.1.32
  - @checkstack/cache-utils@0.2.12

## 1.2.0

### Minor Changes

- 41c77f4: feat(catalog): system triggers + update_metadata action for the Automation Platform

  Ships the catalog chunk of Phase 9:

  - Triggers: `catalog.created`, `catalog.updated`, `catalog.deleted`
    — named consistently with the other plugin lifecycle triggers
    (incident.created, dependency.created, maintenance.created, …).
    Each carries `contextKey: (p) => p.systemId` so `wait_for_trigger`
    can resume the right run.
  - Action: `catalog.update_metadata` — sets or merges metadata on a
    system (`strategy: "merge" | "replace"`). Default is `merge` so
    untouched keys survive. Returns a `catalog.system_record` artifact
    (`systemId`, `systemName`, `metadata`).

  New hook: `catalogHooks.systemUpdated` (`{ systemId, systemName,
changedFields }`). Emitted from both the `updateSystem` RPC handler
  and the `update_metadata` automation action so downstream automations
  and caches see both code paths. Emission is skipped when no tracked
  field changed (no-op saves don't spam subscribers).

  The `system.health_changed`, `system.set_maintenance`, and
  `system.clear_maintenance` items in the original Phase 9 plan move to
  the **healthcheck** and **maintenance** chunks respectively, where the
  underlying data and RPCs live.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-backend@0.2.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/catalog-common@2.2.3
  - @checkstack/auth-backend@0.4.31
  - @checkstack/auth-common@0.7.2
  - @checkstack/command-backend@0.1.31
  - @checkstack/gitops-backend@0.3.7
  - @checkstack/gitops-common@0.4.2
  - @checkstack/notification-common@1.2.1
  - @checkstack/cache-api@0.3.6
  - @checkstack/cache-utils@0.2.11

## 1.1.6

### Patch Changes

- @checkstack/backend-api@0.17.1
- @checkstack/auth-backend@0.4.30
- @checkstack/cache-api@0.3.5
- @checkstack/command-backend@0.1.30
- @checkstack/gitops-backend@0.3.6
- @checkstack/cache-utils@0.2.10

## 1.1.5

### Patch Changes

- f23f3c9: Add `correlationMiddleware` to `@checkstack/backend-api` and apply it
  to every plugin/core router so each request carries a stable
  `x-correlation-id` (read from the inbound header, or freshly minted
  via `crypto.randomUUID()` when absent) and an auto-injected child
  logger bound with `{ correlationId, pluginId, userId? }`. The ID is
  echoed back on the response header so the caller can correlate their
  client-side trace to the server logs.

  The `Logger` interface in `@checkstack/backend-api` now formally
  documents the structured-metadata convention (`logger.info("msg",
{ ...meta })`) alongside the long-standing varargs shape. Winston's
  splat handling already routes both shapes through the same vararg
  slot, so existing call sites are unaffected. A new optional
  `Logger.child(meta)` method captures the metadata-binding contract the
  new middleware relies on; production loggers always implement it,
  minimal test mocks may omit it (the middleware falls back gracefully).

  `RpcContext` grew two optional `Headers` bags, `requestHeaders` and
  `responseHeaders`, populated by the outer Hono `/api/*` and `/rest/*`
  handlers in `@checkstack/backend`. They are write-through observation
  points for middleware; an `RpcContext` constructed without them (S2S
  clients, tests) keeps working — the echo is a silent no-op and the ID
  is still bound onto the child logger for server-side correlation.

  The scaffolding template in `@checkstack/scripts` was updated so any
  new plugin generated via `bun run create` wires the middleware in the
  expected `.use(correlationMiddleware).use(autoAuthMiddleware)` order
  out of the box.

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/backend-api@0.17.0
  - @checkstack/auth-backend@0.4.29
  - @checkstack/command-backend@0.1.29
  - @checkstack/gitops-backend@0.3.5
  - @checkstack/notification-common@1.2.0
  - @checkstack/auth-common@0.7.1
  - @checkstack/catalog-common@2.2.2
  - @checkstack/gitops-common@0.4.1
  - @checkstack/cache-api@0.3.4
  - @checkstack/cache-utils@0.2.9

## 1.1.4

### Patch Changes

- Updated dependencies [a06b899]
- Updated dependencies [a06b899]
  - @checkstack/backend-api@0.16.0
  - @checkstack/notification-common@1.1.1
  - @checkstack/auth-backend@0.4.28
  - @checkstack/cache-api@0.3.3
  - @checkstack/command-backend@0.1.28
  - @checkstack/gitops-backend@0.3.4
  - @checkstack/catalog-common@2.2.1
  - @checkstack/cache-utils@0.2.8

## 1.1.3

### Patch Changes

- b33fb4d: Refresh `bun.lock` to clear MEDIUM-severity Trivy advisories on transitive
  runtime dependencies. No public API change — bumping every workspace
  package that lists `@orpc/server` as a direct dep so consumers re-resolve
  the optional `ws` peer to the patched release on their next install.

  - `ws` `8.20.0` → `8.20.1` (CVE-2026-45736). Pulled into the install tree
    as `@orpc/server`'s optional WebSocket peer; Bun auto-installs it into
    every backend package that depends on `@orpc/server`, so a stale 8.20.0
    ships in the consumer's `node_modules` until the parent package
    re-resolves.
  - `brace-expansion` `5.0.5` → `5.0.6` (CVE-2026-45149). Pulled in only
    through dev tooling (`minimatch@10` via `@typescript-eslint` and
    `storybook`'s `glob@13`), so it does not ship to consumers and no
    workspace `package.json` lists it; the lockfile bump alone clears the
    finding for the Docker image and the local dev tree. No version bump
    is attributed to this advisory.

  The fix lives entirely in `bun.lock` — no `package.json`, `overrides`, or
  `resolutions` change is needed because both parent ranges (`minimatch@10
→ brace-expansion@^5.0.5`, `@orpc/server / storybook / happy-dom →
ws@>=8.18.x`) already accept the patched releases, and `bun install`
  keeps the resolved versions sticky after the initial `bun update`.

- Updated dependencies [1909a61]
- Updated dependencies [b33fb4d]
  - @checkstack/backend-api@0.15.3
  - @checkstack/auth-backend@0.4.27
  - @checkstack/command-backend@0.1.27
  - @checkstack/gitops-backend@0.3.3
  - @checkstack/cache-api@0.3.2
  - @checkstack/cache-utils@0.2.7

## 1.1.2

### Patch Changes

- b627562: Bump direct and transitive dependencies to clear MEDIUM-severity advisories
  that Trivy now surfaces alongside CRITICAL/HIGH.

  Direct version bumps in package.json:

  - `@checkstack/catalog-backend`, `@checkstack/gitops-backend`,
    `@checkstack/healthcheck-frontend`: `uuid` `^13.0.0` → `^14.0.0`
    (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6). Also
    dropped the now-redundant `@types/uuid` devDependency — uuid 14 ships
    its own types and the npm `@types/uuid` package is a stub.
  - `@checkstack/gitops-backend`: `yaml` `^2.7.0` → `^2.8.3`
    (GHSA-48c2-rrv3-qjmp, stack overflow on deeply nested collections).
  - `@checkstack/dev-server`: `vite` `^5.4.0` → `^8.0.12`
    (GHSA-4w7w-66w2-5vf9, path traversal in optimized-deps `.map` handling)
    and `@vitejs/plugin-react` `^4.3.4` → `^6.0.1` to stay inside the new
    vite peer range.

  Root `overrides` / `resolutions` to bypass transitive pins that block the
  walk:

  - `dompurify` `^3.4.3` — `monaco-editor@0.55.1` pins `dompurify@3.2.7`
    exactly, so the only way to pick up the eight DOMPurify XSS / prototype
    pollution advisories (GHSA-v2wj-7wpq-c8vv et al.) is an override.
    Affects `@checkstack/ui`, which is the only consumer of monaco.
  - `uuid` `^14.0.0` — also forces `bullmq`'s nested `uuid@11.1.0`
    (vulnerable per GHSA-w5hq-g745-h8pq) to the patched line. Affects
    `@checkstack/queue-bullmq-backend`.
  - `yaml` `^2.9.0` — covers transitive resolutions that would otherwise
    pin pre-2.8.3 yaml.

  The CI image scan (`.github/workflows/pr-checks.yml`) and the local
  `bun run audit:*` helper now include `MEDIUM` alongside `CRITICAL,HIGH`,
  so future MEDIUM regressions fail the pipeline. The production Dockerfile
  also strips vendored `test/`, `tests/`, `__tests__/`, `benchmark/`,
  `benchmarks/`, `example/` and `examples/` folders from `node_modules`
  before the runtime stage — those tarball artefacts ship their own
  nested `package.json` (`benchmark`, `tedious-benchmarks`, etc.) which
  Trivy was scanning as if they were real packages.

- Updated dependencies [b627562]
  - @checkstack/gitops-backend@0.3.2

## 1.1.1

### Patch Changes

- Updated dependencies [9016526]
- Updated dependencies [080627f]
  - @checkstack/common@0.10.0
  - @checkstack/auth-common@0.7.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/notification-common@1.1.0
  - @checkstack/gitops-common@0.4.0
  - @checkstack/auth-backend@0.4.26
  - @checkstack/backend-api@0.15.2
  - @checkstack/command-backend@0.1.26
  - @checkstack/gitops-backend@0.3.1
  - @checkstack/cache-api@0.3.1
  - @checkstack/cache-utils@0.2.6

## 1.1.0

### Minor Changes

- 1ef2e79: feat: hotlinks on incidents/maintenances and additional links on systems

  Users with `manage` access on an incident, maintenance, or system can now
  attach free-form URL "hotlinks" — Jira tickets, runbooks, dashboards, ticket
  tools, etc. — alongside the existing fields.

  - **Incidents** & **maintenances**: links live on the entity itself and are
    surfaced both in the editor dialog and on the public detail page. Two new
    RPC procedures per plugin (`addLink`, `removeLink`) gated behind the
    existing `manage` access rule. Links are returned as part of
    `getIncident` / `getMaintenance` and cache-invalidated on every link
    mutation.
  - **Systems**: a parallel `system_links` table with `getSystemLinks`,
    `addSystemLink`, `removeSystemLink` procedures. Surfaced inside the
    system editor (next to contacts) and on the read-only system detail
    sidebar. Cache-scoped per-system so list endpoints remain hot.
  - **Shared UI**: a `LinksEditor` component in `@checkstack/ui` does the
    presentation; the three plugins each own their own RPC wiring.

  Database changes ship as additive migrations (new `incident_links`,
  `maintenance_links`, `system_links` tables, all FK-cascaded on parent
  delete). No existing columns or rows are touched.

  The system incident and maintenance history pages now sort by relevance:
  active entries (non-`resolved` incidents, `scheduled` or `in_progress`
  maintenances) appear at the top, with creation date descending as the
  tiebreaker.

### Patch Changes

- Updated dependencies [42abfff]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
  - @checkstack/common@0.9.0
  - @checkstack/gitops-common@0.3.0
  - @checkstack/gitops-backend@0.3.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/cache-api@0.3.0
  - @checkstack/auth-backend@0.4.25
  - @checkstack/auth-common@0.6.6
  - @checkstack/backend-api@0.15.1
  - @checkstack/command-backend@0.1.25
  - @checkstack/notification-common@1.0.2
  - @checkstack/cache-utils@0.2.5

## 1.0.2

### Patch Changes

- 50e5f5f: Runtime plugin system: install + uninstall plugins from npm, GitHub releases
  (including private GitHub Enterprise instances), or tarball uploads at
  runtime, with multi-package bundles, dependency-derived compatibility checks,
  multi-instance coordination via a Postgres artifact store, and
  single-coordinator destructive cleanup.

  Highlights:

  - New `PluginSource` discriminated union and `PluginInstaller` /
    `PluginInstallerRegistry` interfaces in `@checkstack/backend-api`. The
    GitHub variant accepts an optional `apiBaseUrl` so deployments backed by
    GitHub Enterprise can install from `https://ghe.example.com/api/v3`
    instead of `api.github.com`.
  - New `installPackageMetadataSchema` (Zod) in `@checkstack/common` validates
    every plugin's `package.json` at install time. Required fields: `name`,
    `version`, `description`, `author`, `license`, `checkstack.type`,
    `checkstack.pluginId`. Optional: `checkstack.bundle`,
    `checkstack.usageInstructions`, `checkstack.allowInstallScripts`.
  - New `pluginManagerContract` in `@checkstack/pluginmanager-common` with
    `list`, `previewInstall`, `install`, `previewUninstall`, `uninstall`, and
    `events` procedures.
  - New `@checkstack/pluginmanager-frontend` admin UI: installed-plugins list
    with per-row uninstall (typed-confirmation modal, schema/configs/cascade
    toggles), install page with NPM / Tarball Upload / GitHub Release tabs
    (Catalog tab disabled — coming soon), and an events page surfacing the
    install/uninstall audit log.
  - New `bunx @checkstack/scripts plugin-pack` CLI for plugin authors —
    per-package mode produces an npm-shaped tarball; `--bundle` mode produces
    an outer tarball containing every sibling declared in
    `package.json#checkstack.bundle`. Published to npm so external authors
    can `bunx` it directly without a workspace checkout.
  - Compatibility derived from `package.json#dependencies` ranges
    (`semver.satisfies` against the platform's loaded `@checkstack/*`
    versions) — no separate `compatibility` field.
  - Multi-instance: originator persists artifacts + `plugins` rows + broadcasts
    install/uninstall; receiving instances do in-process register/unregister
    only. Destructive ops (drop schema, delete plugin_configs, delete
    artifacts, delete `plugins` rows) run exactly once on the originator.
  - Fresh-instance bootstrap: `loadPlugins()` hydrates any
    `is_uninstallable=true` plugin missing from `node_modules` from the
    artifact store before normal Phase 1 register.
  - New schema: `plugin_artifacts` (tarball storage), `plugin_install_events`
    (audit/error log). `plugins` extended with `version`, `metadata`,
    `source`, `bundle_id`, `is_primary`. Local plugin sync now writes
    `version` from each plugin's `package.json` so the admin UI shows real
    versions instead of `—`.
  - Tarball-upload endpoint (`POST /api/pluginmanager/upload-tarball`) for
    the install UI; access-gated by `pluginmanager.plugin.manage`.
  - Plugin Manager menu link added to the user menu (main grid, alongside
    Profile / Notification Settings / etc.).

  Cross-cutting changes:

  - Backend request/response logging now flows through `rootLogger` (winston)
    instead of `hono/logger`. 5xx responses include the response body inline
    so swallowed early-return errors are visible in the log.
  - The `/api/:pluginId/*` dispatcher now logs which core service is missing
    or which `pluginId` had no metadata when it 500s.
  - New `registerCorePluginMetadata` on `PluginManager` for core routers
    (like the plugin manager itself) that need their metadata visible to the
    RPC dispatcher without going through the full plugin lifecycle.
  - ESLint: `unicorn/no-null` is now disabled globally. Drizzle distinguishes
    between `null` (writes a real SQL NULL) and `undefined` (skip the column
    on insert), so treating them as interchangeable produced latent bugs at
    the persistence boundary. The bulk of the patch-bumped packages above
    reflect lint-fix touches that landed when this rule was relaxed.
  - Workspace-wide license normalization to `Elastic-2.0` (matches
    `LICENSE.md`). Every `package.json` in the workspace now declares the
    same SPDX identifier; the patch bumps capture this.

  Plugin packages (every `plugins/*`): added a `pack` npm script
  (`bunx @checkstack/scripts plugin-pack`), mirrored each plugin's
  `pluginId` from `plugin-metadata.ts` into `package.json#checkstack.pluginId`
  so install-time validation passes, stubbed any missing required metadata
  fields (`description`, `author`, `license`), and added
  `checkstack.bundle` to multi-package plugin primaries (telegram, rcon, ssh,
  jira, queue-bullmq, queue-memory, cache-memory).

  Breaking changes:

  - The legacy single-method `PluginInstaller` interface (`install(packageName)`)
    is removed. Callers must use `coreServices.pluginInstallerRegistry`.
  - The old `pluginAdminContract` and `createPluginAdminRouter` are removed.
    Replaced by `pluginManagerContract` in `@checkstack/pluginmanager-common`
    and `createPluginManagerRouter` in `core/backend`.
  - `@checkstack/test-utils-backend` no longer exports
    `createMockPluginInstaller` / `MockPluginInstaller` (the legacy interface
    it shimmed is gone).

  Note: bumps are limited to `minor` (for packages with new public API
  surface) and `patch` (for downstream consumers, license normalization,
  and lint fixes). No `major` bumps despite the `PluginInstaller` removal —
  the legacy interface had no third-party consumers in the wild before this
  runtime plugin system landed, and the contract surface is the same shape
  modulo the rename.

- Updated dependencies [50e5f5f]
  - @checkstack/auth-common@0.6.5
  - @checkstack/backend-api@0.15.0
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/gitops-backend@0.2.8
  - @checkstack/gitops-common@0.2.2
  - @checkstack/auth-backend@0.4.24
  - @checkstack/cache-api@0.2.4
  - @checkstack/cache-utils@0.2.4
  - @checkstack/command-backend@0.1.24
  - @checkstack/notification-common@1.0.1

## 1.0.1

### Patch Changes

- Updated dependencies [302cd3f]
  - @checkstack/backend-api@0.14.1
  - @checkstack/auth-backend@0.4.23
  - @checkstack/cache-api@0.2.3
  - @checkstack/command-backend@0.1.23
  - @checkstack/gitops-backend@0.2.7
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-utils@0.2.3
  - @checkstack/catalog-common@2.0.0
  - @checkstack/common@0.7.0
  - @checkstack/gitops-common@0.2.1
  - @checkstack/notification-common@1.0.0

## 1.0.0

### Major Changes

- 32d52c6: feat: notification target pattern + per-spec subscriptions

  Replaces the all-or-nothing catalog system/group notification model with a
  platform-level target pattern. Each notification-emitting plugin declares
  _subscription specs_ against typed _target_ objects exported from the
  target's owning plugin (catalog ships `catalogSystemTarget` and
  `catalogGroupTarget`). Notification-backend handles every per-resource
  group lifecycle, parent-edge inheritance, and legacy-subscription seeding
  — plugins never author groupId helpers, lifecycle hooks, or migration
  code again.

  **Plugin-author surface area is now ~12 lines per emitter:**

  ```ts
  // <plugin>-common
  const { defineSubscription } = createSubscriptionFactory(pluginMetadata);
  export const fooSystemSubscription = defineSubscription({
    localId: "system",
    target: catalogSystemTarget,
    display: { title: "Foo Alerts", description: "...", iconName: "Bell" },
  });

  // <plugin>-backend register()
  env.registerSubscriptionSpecs([fooSystemSubscription]);
  //   ^ feeds the plugin loader's dependency sorter — each spec's
  //     target.ownerPlugin becomes an implicit init-order dep, so this
  //     plugin automatically waits for catalog (the target owner) to
  //     finish init + afterPluginsReady before its own runs.

  // <plugin>-backend afterPluginsReady
  await notificationClient.registerSubscriptionSpec(
    specToRegistration(fooSystemSubscription)
  );
  // dispatch
  await notificationClient.notifyForSubscription({
    specId: fooSystemSubscription.specId,
    resourceKeys: [systemId],
    title,
    body,
    importance,
    action,
    collapseKey,
    subjects,
  });

  // <plugin>-frontend
  createNotificationSubscriptionExtension({ spec: fooSystemSubscription });
  ```

  **Migrated plugins**: anomaly, incident, maintenance, healthcheck,
  dependency. Each lost its bespoke `notification-groups.ts`,
  `bootstrap*NotificationGroups`, `ensure*Group`, and inheritance walk —
  all of that is now centralized in notification-backend's
  `subscription-engine`.

  **Plugin loader change** (`@checkstack/backend-api`,
  `@checkstack/backend`): the register-time API gains
  `env.registerSubscriptionSpecs([...specs])`. The dependency sorter
  walks `spec.target.ownerPlugin` for every declared spec and adds the
  target owner as an init-order dependency of the emitting plugin. This
  guarantees that catalog (the owner of the platform's `system` and
  `group` targets) completes init + afterPluginsReady before any
  emitting plugin tries to register its specs against the notification
  service — no string-prefix heuristics, no manual `dependsOnPlugins`
  list, no stub rows. Plugins that fail to declare their specs at
  register time get a clear `Target type X is not registered. Did the
emitting plugin declare this spec via env.registerSubscriptionSpecs?`
  error from the dispatcher.

  **Removed** (no backwards compat):

  - `catalogClient.notifySystemSubscribers` and
    `catalogClient.notifyManySystemSubscribers`
  - `notificationClient.notifyUsers` and `notificationClient.notifyGroups`
    as direct dispatch primitives — replaced by spec-bound
    `notifyForSubscription`
  - catalog's `bootstrapNotificationGroups` (replaced by
    `bootstrapNotificationTargets`)

  **Enforcement**: the dispatcher rejects calls referencing unregistered
  specIds, specs owned by other plugins, or resourceKeys that haven't been
  pushed via `upsertNotificationResource`. Display metadata for any
  groupId is recoverable via the spec registry, so audit lists render
  correct labels even when an emitter's frontend isn't loaded.

  **Per-field anomaly mute** keeps working — it now lives inside the
  generic SubscriptionRow's optional `SubControls` panel
  (`AnomalyFieldMuteList`), exposed through the catalog system detail
  page's notifications card.

  The catalog system detail page renders a "Notifications" card hosting
  `SystemNotificationSubscriptionsSlot`. The matching group surface is
  not yet rendered — group-level subscriptions are wired end-to-end on
  the backend; a follow-up will add the host UI.

  **Migration of existing subscribers**: target types declare a
  `legacyGroupIdTemplate`; on first registration of each spec,
  notification-backend reads subscribers from the legacy
  `catalog.system.<id>` / `catalog.group.<id>` groups and seeds the new
  spec groups exactly once per (spec × resource) pair, tracked in
  `subscription_migrations`. Anomaly stays opt-in (its target also
  declares the template, but the user-explicit nature of the original
  opt-in flow means the seeding produces the same set of subscribers
  they already had).

### Minor Changes

- 32d52c6: feat(anomaly): per-system and per-field notification mute

  Anomaly notifications now flow through their own subscription group
  (`anomaly.system.<systemId>`) instead of the shared catalog system group, so
  users can opt out of anomaly noise without losing incident or healthcheck
  alerts for the same system. On first deploy, existing subscribers of each
  `catalog.system.<id>` group are seeded onto the new anomaly group so no one
  silently stops getting alerts.

  A new mute table (`anomaly_notification_mutes`) backs two granularities:

  - **Per-field**: silence a single noisy metric on one system.
  - **Per-system**: silence every anomaly for one system in one click.

  The system anomaly widget now exposes a bell icon on each anomaly row plus a
  `Mute all` toggle in the card header. Mutes are user-scoped and persist
  across sessions.

  Catalog gains a `systemCreated` hook so anomaly (and any future plugin) can
  provision per-system state on creation rather than waiting for a restart.
  The notification service gains a `bulkSubscribe` service-RPC used by the
  one-time migration described above.

- 32d52c6: Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

  Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

  Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

  All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/gitops-backend@0.2.6
  - @checkstack/notification-common@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/backend-api@0.14.0
  - @checkstack/auth-backend@0.4.22
  - @checkstack/auth-common@0.6.4
  - @checkstack/cache-api@0.2.2
  - @checkstack/command-backend@0.1.22
  - @checkstack/cache-utils@0.2.2

## 0.7.1

### Patch Changes

- Updated dependencies [208ad71]
  - @checkstack/notification-common@0.3.0
  - @checkstack/backend-api@0.13.1
  - @checkstack/catalog-common@1.5.3
  - @checkstack/auth-backend@0.4.21
  - @checkstack/cache-api@0.2.1
  - @checkstack/command-backend@0.1.21
  - @checkstack/gitops-backend@0.2.5
  - @checkstack/cache-utils@0.2.1

## 0.7.0

### Minor Changes

- 8d1ef12: ## Per-entity caching with single-flight + safe invalidation across the dashboard hot paths

  ### `@checkstack/cache-api`

  - **Breaking** for backend implementors: `CacheProvider` now requires `deleteByPrefix(prefix: string): Promise<number>` for family-level invalidation. The in-memory provider implements it; downstream providers (Redis, etc.) must add it before upgrading.
  - `createScopedCache` forwards `deleteByPrefix` and keeps prefixes scoped to the calling plugin.

  ### `@checkstack/cache-utils` (new package)

  High-level read-through caching helpers built on `CacheProvider`:

  - `createCachedScope({ cacheManager, pluginId })` returns a scope with `wrap`, `wrapMany`, `invalidate`, and `invalidatePrefix`.
  - **Single-flight**: concurrent cache misses for the same key share one loader.
  - **Per-entity bulk caching** via `wrapMany` so list/bulk RPCs cache by id rather than by the full input shape — overlapping callers share entries and invalidation stays exact.
  - **Race-safe invalidation** via per-key epoch counters: a loader started before a mutation cannot repopulate the cache with stale data after the mutation invalidates it. The mutation invariant is `db.write → cache.invalidate (await) → signals.emit`.
  - Cache failures fall through to the loader so a cache outage cannot break reads.

  ### `@checkstack/backend`

  - The internal null `CacheProvider` (used when no cache backend is configured) now implements the new `deleteByPrefix` method as a no-op. Patch bump only — no behavior change for existing callers.

  ### `@checkstack/healthcheck-backend`

  - `getSystemHealthStatus` and `getBulkSystemHealthStatus` now read through a per-system cache (`healthcheck:status:<systemId>`), eliminating N database queries per dashboard refresh for unchanged systems.
  - Mutation paths (configuration CRUD, system associations, satellite ingest, queue-driven check runs, system/satellite removal hooks) invalidate affected keys before broadcasting their signals so frontend refetches always observe fresh data.

  ### `@checkstack/incident-backend`

  - `listIncidents`, `getIncident`, `getIncidentsForSystem`, and `getBulkIncidentsForSystems` now read through a scoped cache:
    - per-incident at `incident:<id>`
    - per-system at `system:<systemId>`
    - per-filter-shape at `list:<stable-stringify(filters)>` for the few list shapes the dashboard polls
  - Mutations (`createIncident`, `updateIncident`, `addUpdate`, `resolveIncident`, `deleteIncident`) invalidate the incident, every affected system, and every cached list before broadcasting `INCIDENT_UPDATED`.
  - The catalog `systemDeleted` cleanup hook drops that system's cached entries.

  ### `@checkstack/maintenance-backend`

  - `listMaintenances`, `getMaintenance`, `getMaintenancesForSystem`, and `getBulkMaintenancesForSystems` use the same per-entity / per-system / per-filter-shape pattern as incidents.
  - Mutations (`createMaintenance`, `updateMaintenance`, `addUpdate`, `closeMaintenance`, `deleteMaintenance`) invalidate before broadcasting `MAINTENANCE_UPDATED`.

  ### `@checkstack/catalog-backend`

  - Topology reads (`getEntities`, `getSystems`, `getSystem`, `getGroups`, `getSystemGroupIds`) cache under the `entity:` family (25s TTL).
  - Views (`getViews`) and per-system contacts (`getSystemContacts`) cache in their own families.
  - System / group / membership mutations drop the entire `entity:` family (every reader joins the same tables); view and contact mutations drop only their respective scopes.

  ### `@checkstack/slo-backend`

  - `listObjectives`, `getObjective`, `getObjectivesForSystem`, and `getBulkObjectivesForSystems` cache results including the expensive `engine.computeStatus` output.
  - Per-entity caching for the bulk handler so dashboards with overlapping system sets share entries.
  - Mutations (`createObjective`, `updateObjective`, `deleteObjective`) invalidate before broadcasting `SLO_STATUS_CHANGED`.

  ### `@checkstack/anomaly-backend`

  - New `router-cache.ts` adds a cache scope distinct from the existing detector baseline cache, keyed by stable filter hash.
  - `getAnomalies` and `getAnomalyBaselines` cache through this scope (15s TTL).
  - The detector invalidates the router cache before broadcasting `ANOMALY_STATE_CHANGED` on every state transition (suspicious/anomaly/recovered).
  - Config mutations also invalidate.

  ### `@checkstack/notification-backend`

  - `getUnreadCount`, `getNotifications`, and `getSubscriptions` cache per-user.
  - `markAsRead`, `deleteNotification`, `notifyUsers`, and `notifyGroups` invalidate every affected user's cache before sending realtime signals to that user.
  - `subscribe` and `unsubscribe` invalidate the user's subscription cache.

  ### `@checkstack/announcement-backend`

  - `getActiveAnnouncements` caches per-user (or anonymous) and per-`includeDismissed` flag (45s TTL — admin-driven, slowly changing).
  - `listAllAnnouncements` caches under a single key.
  - `dismissAnnouncement` only drops that user's cache; `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` drop every user's cache before broadcasting `ANNOUNCEMENT_UPDATED`.
  - The auth `userDeleted` cleanup hook drops that user's cached entries.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0
  - @checkstack/cache-api@0.2.0
  - @checkstack/cache-utils@0.2.0
  - @checkstack/backend-api@0.13.0
  - @checkstack/auth-backend@0.4.20
  - @checkstack/auth-common@0.6.3
  - @checkstack/catalog-common@1.5.2
  - @checkstack/command-backend@0.1.20
  - @checkstack/gitops-backend@0.2.4
  - @checkstack/gitops-common@0.2.1
  - @checkstack/notification-common@0.2.9

## 0.6.1

### Patch Changes

- @checkstack/catalog-common@1.5.1

## 0.6.0

### Minor Changes

- 298bf42: ### Notification System Optimizations

  **System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

  **Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

  **New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0

## 0.5.4

### Patch Changes

- Updated dependencies [adc89a8]
  - @checkstack/gitops-backend@0.2.3

## 0.5.3

### Patch Changes

- Updated dependencies [b53a40e]
  - @checkstack/gitops-backend@0.2.2

## 0.5.2

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/gitops-backend@0.2.1

## 0.5.1

### Patch Changes

- Updated dependencies [889dd8c]
  - @checkstack/auth-common@0.6.2
  - @checkstack/auth-backend@0.4.19
  - @checkstack/catalog-common@1.4.1

## 0.5.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

## 0.4.4

### Patch Changes

- Updated dependencies [bb1fea0]
  - @checkstack/catalog-common@1.4.0

## 0.4.3

### Patch Changes

- cb65e9d: ### Schema-driven secret resolution, rotation invalidation, and security hardening

  **Breaking**: Replaced `{ secretRef: "..." }` object syntax with `${{ secrets.NAME }}` template interpolation. The `secretField()`, `secretRefSchema`, `isSecretRef`, `SecretRef`, and `ResolvedSecretField` exports have been removed from `@checkstack/gitops-common`.

  **Breaking**: `ReconcileContext.resolveSecretsBySchema()` now returns `{ resolved: T; warnings: string[] }` instead of `T` directly. Plugins must destructure the result. Warnings contain messages for `${{ secrets.NAME }}` templates found in non-secret fields (fields without `x-secret` annotation).

  **New features**:

  - Secrets can be referenced in **any string field** using `${{ secrets.NAME }}` syntax
  - Inline interpolation is supported: `"postgres://user:${{ secrets.DB_PASS }}@host/db"`
  - Resolution is **schema-driven** — reuses the existing `configString({ "x-secret": true })` pattern from DynamicForm
  - Secret rotation now automatically invalidates affected entities, triggering re-reconciliation on the next sync cycle
  - New `getSecretUsage` RPC endpoint to look up which entities reference a given secret
  - Secrets UI now shows an expandable usage panel per secret showing referencing entities
  - Reconciliation warnings: templates in non-secret fields are detected and surfaced in the provenance UI
  - New `secretNameSchema` and `SECRET_NAME_REGEX` exports for validating secret names

  **Security**:

  - Secret names are validated at creation: must start with a letter, contain only `[a-zA-Z0-9_-]`, max 63 chars
  - Secrets are validated to exist at sync time but **not pre-resolved** into the spec
  - Templates in `metadata` fields are **rejected** to prevent secret leaks via display fields
  - Only fields with `x-secret` schema annotations get resolved — no escape hatch
  - Templates in non-secret fields emit warnings (stored in provenance, visible in UI) instead of silently passing

  **Migration**: Update YAML descriptors to use `${{ secrets.NAME }}` instead of `secretRef: name`. Remove `secretField()` imports from plugin schemas — use `configString({ "x-secret": true })` to annotate secret fields. Destructure `const { resolved } = await context.resolveSecretsBySchema({ value, schema })` (return type changed from `T` to `{ resolved: T; warnings: string[] }`).

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-common@0.2.0
  - @checkstack/gitops-backend@0.2.0

## 0.4.2

### Patch Changes

- Updated dependencies [79cf5f8]
  - @checkstack/gitops-backend@0.1.2

## 0.4.1

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-backend@0.1.1
  - @checkstack/gitops-common@0.1.1

## 0.4.0

### Minor Changes

- b01078f: Added GitOps System kind extension for managing system group associations

## 0.3.0

### Minor Changes

- 6c40b5b: Register catalog System and Group as GitOps entity kinds

  - **catalog-backend**: Registers `kind: System` and `kind: Group` with the GitOps Entity Kind Registry. The catalog now supports declarative management via YAML descriptors in Git repositories. Systems and groups are reconciled using the `metadata.gitops_entity_name` marker for cross-sync identity lookup.
  - **gitops-backend**: Wires up the delete reconciler for orphan cleanup — both automatic deletion (via `deletionPolicy: "auto"`) and manual orphan confirmation now invoke the owning plugin's `delete()` handler before removing provenance entries.

- 6c40b5b: Generalized provenance system and GitOps frontend plugin

  **Breaking**: `EntityKindDefinition.reconcile()` now returns `{ entityId: string }` instead of `void`. Plugins must return the plugin-specific entity ID (e.g., catalog system UUID) so the engine can store it in provenance.

  - Added `entityId` column to the provenance table (non-nullable)
  - Reconciler engine passes `existingEntityId` to plugins for updates
  - `getProvenance` now supports lookup by `entityId` in addition to `entityName`
  - Added provider CRUD endpoints: `createProvider`, `updateProvider`, `deleteProvider`
  - Created `gitops-frontend` plugin with provider management, secret management, and sync status dashboard
  - Removed `gitops_entity_name` metadata markers from catalog entities
  - Removed `findSystemByGitOpsName`, `deleteSystemByGitOpsName` (and Group equivalents) from EntityService
  - Added provenance-based UI locking in catalog-frontend: edit/delete/drag disabled for GitOps-managed systems and groups

### Patch Changes

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
  - @checkstack/gitops-backend@0.1.0
  - @checkstack/gitops-common@0.1.0

## 0.2.24

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/backend-api@0.12.0
  - @checkstack/auth-backend@0.4.18
  - @checkstack/command-backend@0.1.19

## 0.2.23

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

  **New utility**

  - `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

  **ESLint rules**

  - `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
  - `no-console` in frontend packages — forces `toast` over silent `console.error`
  - `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
  - Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

  **Refactoring**

  - Replace 141 `instanceof Error` boilerplate patterns across the codebase
  - Replace swallowed `console.error` with user-visible `toast.error()` feedback
  - Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
  - Consolidate 3 identical callback handlers into `handleDialogClose`
  - Fix conditional React hook call in `FormField.tsx`
  - Fix unstable useMemo deps in `Dashboard.tsx`
  - Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
  - Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
  - Delete obvious comments in `encryption.ts` and Teams `provider.ts`

- Updated dependencies [d1a2796]
- Updated dependencies [3c34b07]
  - @checkstack/common@0.6.5
  - @checkstack/backend-api@0.11.1
  - @checkstack/auth-backend@0.4.17
  - @checkstack/catalog-common@1.3.1
  - @checkstack/auth-common@0.6.1
  - @checkstack/command-backend@0.1.18
  - @checkstack/notification-common@0.2.8

## 0.2.22

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/backend-api@0.11.0
  - @checkstack/auth-backend@0.4.16
  - @checkstack/command-backend@0.1.17

## 0.2.21

### Patch Changes

- Updated dependencies [3f36a64]
  - @checkstack/catalog-common@1.3.0
  - @checkstack/backend-api@0.10.1
  - @checkstack/auth-backend@0.4.15
  - @checkstack/command-backend@0.1.16

## 0.2.20

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/backend-api@0.10.0
  - @checkstack/auth-backend@0.4.14
  - @checkstack/command-backend@0.1.15

## 0.2.19

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-backend@0.4.13

## 0.2.18

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/backend-api@0.9.0
  - @checkstack/auth-common@0.6.0
  - @checkstack/auth-backend@0.4.12
  - @checkstack/command-backend@0.1.14
  - @checkstack/catalog-common@1.2.11

## 0.2.17

### Patch Changes

- 67158e2: Standardize package metadata, unify AJV versions to 8.18.0, and enforce monorepo architecture rules via updated ESLint configuration. This ensures consistent package discovery and runtime dependency safety across the platform.
- b839ccb: Security: Hardened production Docker image by upgrading Alpine system libraries, migrating to Drizzle beta (v1.0.0-beta.21), and implementing aggressive binary pruning to eliminate vulnerable build-time tools (esbuild/drizzle-kit).
- Updated dependencies [67158e2]
- Updated dependencies [b839ccb]
  - @checkstack/auth-backend@0.4.11
  - @checkstack/auth-common@0.5.7
  - @checkstack/backend-api@0.8.2
  - @checkstack/catalog-common@1.2.10
  - @checkstack/command-backend@0.1.13
  - @checkstack/common@0.6.4
  - @checkstack/notification-common@0.2.7

## 0.2.16

### Patch Changes

- Updated dependencies [eb353a4]
  - @checkstack/auth-backend@0.4.10

## 0.2.15

### Patch Changes

- @checkstack/catalog-common@1.2.9

## 0.2.14

### Patch Changes

- Updated dependencies [0ebbe56]
  - @checkstack/auth-backend@0.4.9
  - @checkstack/auth-common@0.5.6
  - @checkstack/backend-api@0.8.1
  - @checkstack/common@0.6.3
  - @checkstack/catalog-common@1.2.8
  - @checkstack/command-backend@0.1.12
  - @checkstack/notification-common@0.2.6

## 0.2.13

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/auth-backend@0.4.8
  - @checkstack/command-backend@0.1.11

## 0.2.12

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/auth-backend@0.4.7
  - @checkstack/command-backend@0.1.10

## 0.2.11

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/auth-backend@0.4.6
  - @checkstack/auth-common@0.5.5
  - @checkstack/catalog-common@1.2.7
  - @checkstack/command-backend@0.1.9
  - @checkstack/notification-common@0.2.5

## 0.2.10

### Patch Changes

- Updated dependencies [e5079e1]
  - @checkstack/catalog-common@1.2.6

## 0.2.9

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/backend-api@0.5.2
  - @checkstack/catalog-common@1.2.5
  - @checkstack/command-backend@0.1.8
  - @checkstack/common@0.6.1
  - @checkstack/notification-common@0.2.4

## 0.2.8

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0
  - @checkstack/backend-api@0.5.1
  - @checkstack/catalog-common@1.2.4
  - @checkstack/command-backend@0.1.7
  - @checkstack/notification-common@0.2.3

## 0.2.7

### Patch Changes

- 66a3963: Update database types to use SafeDatabase

  - Updated all database type declarations from `NodePgDatabase` to `SafeDatabase` for compile-time safety

- Updated dependencies [66a3963]
  - @checkstack/backend-api@0.5.0
  - @checkstack/command-backend@0.1.6

## 0.2.6

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/backend-api@0.4.1
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/command-backend@0.1.5
  - @checkstack/notification-common@0.2.2

## 0.2.5

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
  - @checkstack/backend-api@0.4.0
  - @checkstack/common@0.4.0
  - @checkstack/command-backend@0.1.4
  - @checkstack/catalog-common@1.2.2
  - @checkstack/notification-common@0.2.1

## 0.2.4

### Patch Changes

- Updated dependencies [d94121b]
  - @checkstack/backend-api@0.3.3
  - @checkstack/command-backend@0.1.3

## 0.2.3

### Patch Changes

- @checkstack/catalog-common@1.2.1

## 0.2.2

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0
  - @checkstack/backend-api@0.3.2
  - @checkstack/catalog-common@1.2.0
  - @checkstack/notification-common@0.2.0
  - @checkstack/command-backend@0.1.2

## 0.2.1

### Patch Changes

- @checkstack/backend-api@0.3.1
- @checkstack/command-backend@0.1.1

## 0.2.0

### Minor Changes

- 9faec1f: # Unified AccessRule Terminology Refactoring

  This release completes a comprehensive terminology refactoring from "permission" to "accessRule" across the entire codebase, establishing a consistent and modern access control vocabulary.

  ## Changes

  ### Core Infrastructure (`@checkstack/common`)

  - Introduced `AccessRule` interface as the primary access control type
  - Added `accessPair()` helper for creating read/manage access rule pairs
  - Added `access()` builder for individual access rules
  - Replaced `Permission` type with `AccessRule` throughout

  ### API Changes

  - `env.registerPermissions()` → `env.registerAccessRules()`
  - `meta.permissions` → `meta.access` in RPC contracts
  - `usePermission()` → `useAccess()` in frontend hooks
  - Route `permission:` field → `accessRule:` field

  ### UI Changes

  - "Roles & Permissions" tab → "Roles & Access Rules"
  - "You don't have permission..." → "You don't have access..."
  - All permission-related UI text updated

  ### Documentation & Templates

  - Updated 18 documentation files with AccessRule terminology
  - Updated 7 scaffolding templates with `accessPair()` pattern
  - All code examples use new AccessRule API

  ## Migration Guide

  ### Backend Plugins

  ```diff
  - import { permissionList } from "./permissions";
  - env.registerPermissions(permissionList);
  + import { accessRules } from "./access";
  + env.registerAccessRules(accessRules);
  ```

  ### RPC Contracts

  ```diff
  - .meta({ userType: "user", permissions: [permissions.read.id] })
  + .meta({ userType: "user", access: [access.read] })
  ```

  ### Frontend Hooks

  ```diff
  - const canRead = accessApi.usePermission(permissions.read.id);
  + const canRead = accessApi.useAccess(access.read);
  ```

  ### Routes

  ```diff
  - permission: permissions.entityRead.id,
  + accessRule: access.read,
  ```

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [827b286]
- Updated dependencies [f533141]
- Updated dependencies [aa4a8ab]
  - @checkstack/backend-api@0.3.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/common@0.2.0
  - @checkstack/notification-common@0.1.0

## 0.1.0

### Minor Changes

- 8e43507: BREAKING: `getSystems` now returns `{ systems: [...] }` instead of plain array

  This change enables resource-level access control filtering for the catalog plugin. The middleware needs a consistent object format with named keys to perform post-execution filtering on list endpoints.

  ## Breaking Changes

  - `getSystems()` now returns `{ systems: System[] }` instead of `System[]`
  - All call sites must update to destructure: `const { systems } = await api.getSystems()`

  ## New Features

  - Added `resourceAccess` metadata to catalog endpoints:
    - `getSystems`: List filtering by team access
    - `getSystem`: Single resource pre-check by team access
    - `getEntities`: List filtering for systems by team access

  ## Migration

  ```diff
  - const systems = await catalogApi.getSystems();
  + const { systems } = await catalogApi.getSystems();
  ```

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
  - @checkstack/backend-api@0.2.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/command-backend@0.0.4
  - @checkstack/notification-common@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/command-backend@0.0.3
  - @checkstack/catalog-common@0.0.3
  - @checkstack/notification-common@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/backend-api@0.0.2
  - @checkstack/catalog-common@0.0.2
  - @checkstack/command-backend@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/notification-common@0.0.2

## 0.1.0

### Minor Changes

- a65e002: Add command palette commands and deep-linking support

  **Backend Changes:**

  - `healthcheck-backend`: Add "Manage Health Checks" (⇧⌘H) and "Create Health Check" commands
  - `catalog-backend`: Add "Manage Systems" (⇧⌘S) and "Create System" commands
  - `integration-backend`: Add "Manage Integrations" (⇧⌘G), "Create Integration Subscription", and "View Integration Logs" commands
  - `auth-backend`: Add "Manage Users" (⇧⌘U), "Create User", "Manage Roles", and "Manage Applications" commands
  - `command-backend`: Auto-cleanup command registrations when plugins are deregistered

  **Frontend Changes:**

  - `HealthCheckConfigPage`: Handle `?action=create` URL parameter
  - `CatalogConfigPage`: Handle `?action=create` URL parameter
  - `IntegrationsPage`: Handle `?action=create` URL parameter
  - `AuthSettingsPage`: Handle `?tab=` and `?action=create` URL parameters

### Patch Changes

- Updated dependencies [b4eb432]
- Updated dependencies [a65e002]
- Updated dependencies [a65e002]
  - @checkstack/backend-api@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/command-backend@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/notification-common@0.1.1

## 0.0.3

### Patch Changes

- @checkstack/catalog-common@0.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [71275dd]
- Updated dependencies [ae19ff6]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
- Updated dependencies [81f3f85]
  - @checkstack/common@0.1.0
  - @checkstack/backend-api@1.0.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/notification-common@0.1.0
  - @checkstack/command-backend@0.0.2

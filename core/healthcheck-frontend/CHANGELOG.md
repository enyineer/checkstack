# @checkstack/healthcheck-frontend

## 0.40.0

### Minor Changes

- c83d0d1: Render markdown wherever operator-authored content is shown, and give the status-update history its hierarchy back

  Two reported problems on the public status page, plus the same defect found in
  three more places while fixing them.

  **Markdown was not rendered.** Every one of these surfaces drew authored content
  with the INLINE `<Markdown>` component. That renderer exists for one-line
  summaries: it maps every paragraph to a `<span>` and registers no heading, list,
  blockquote, table, or code-block renderers at all. So an operator who wrote a
  structured post-mortem - a `## Impact` heading, a bulleted list of affected
  flows, several paragraphs - got one undifferentiated run of text with the
  paragraphs collapsed onto a single line. The markdown editor's preview had been
  showing them the correct rendering the whole time, because the preview uses
  `MarkdownBlock`. Now fixed in:

  - the public incident / maintenance detail pages (descriptions and updates),
  - the public status page's event widgets,
  - `StatusUpdateTimeline` in `@checkstack/ui`, which is the in-app "Status
    Updates" list on the incident and maintenance detail pages and inside their
    editor dialogs (edit-history snapshots too),
  - a health-check strategy's setup guide, which is long-form prose with numbered
    steps and code blocks,
  - an API-docs operation description.

  **The status label sat flush against the message.** In the public page's history
  list, an update's status change ("IDENTIFIED") is a small coloured label above
  the message. It was an `inline-block`, and because the message beside it was also
  inline, the two flowed onto the SAME line with nothing between them
  ("IDENTIFIEDWe have found the cause"). Fixing the markdown rendering is most of
  the fix - the message is a block element now, so it cannot share the label's
  line - and the label is additionally a `block` with its own bottom margin, so an
  entry reads status, then message, then timestamp.

  **The rail dot went near-invisible between status changes.** On the public page,
  an update that changed no status drew its dot in `bg-border` - all but
  invisible against the page - even though the event was plainly still in
  whatever status it had last been set to. The dot now shows the status IN EFFECT
  at that entry: a changeless update inherits the nearest change at or before it,
  and never a NEWER one (which would paint an update "resolved" green while the
  incident was still being investigated). Only an entry older than every change
  in the published window - possible because the widget caps how many updates it
  emits - falls back to the event's own tone, an incident's severity or a
  maintenance's status.

  The in-app maintenance timeline had the same hole, dropping to a flat grey
  between status changes, so the carry-forward (`resolveEffectiveStatuses`) lives
  in `@checkstack/ui` and both surfaces use it. `StatusUpdateTimeline` hands each
  dot the status in effect as `renderDot`'s new third argument - a caller holding
  one update cannot derive it, since it depends on the timeline's own sort order.
  The argument is additive, so existing `renderDot` callbacks are unaffected;
  in-app incidents already coloured every dot by severity and are unchanged.

  The public timeline was two near-identical copies, one in the widget renderers
  and one in the detail pages, which is how the same two bugs shipped in both. It
  is now a single `UpdatesTimeline` component used by both, with the widget passing
  the mention resolver from `StatusMentionContext` and the detail pages passing
  their own. Mention resolution is unchanged everywhere: a reference still links
  only when the viewer may open its target, and renders as plain text otherwise.

  The one deliberate holdout is the notifications list, where a body stays inline
  because that row is meant to be a compact one-liner.

### Patch Changes

- Updated dependencies [c83d0d1]
  - @checkstack/ui@1.33.0
  - @checkstack/auth-frontend@0.16.2
  - @checkstack/catalog-frontend@0.22.2
  - @checkstack/dashboard-frontend@0.12.2
  - @checkstack/gitops-frontend@0.8.2
  - @checkstack/script-packages-frontend@0.5.2
  - @checkstack/secrets-frontend@0.4.2
  - @checkstack/tips-frontend@0.5.8

## 0.39.1

### Patch Changes

- Updated dependencies [c38551f]
  - @checkstack/ui@1.32.0
  - @checkstack/frontend-api@0.19.0
  - @checkstack/auth-frontend@0.16.1
  - @checkstack/catalog-frontend@0.22.1
  - @checkstack/dashboard-frontend@0.12.1
  - @checkstack/gitops-frontend@0.8.1
  - @checkstack/script-packages-frontend@0.5.1
  - @checkstack/secrets-frontend@0.4.1
  - @checkstack/tips-frontend@0.5.7
  - @checkstack/catalog-common@2.8.3
  - @checkstack/healthcheck-common@1.19.2
  - @checkstack/anomaly-common@1.8.5
  - @checkstack/satellite-common@0.12.1

## 0.39.0

### Minor Changes

- 88f4333: Preview system custom fields in the health-check editor

  The editor gained a **System** picker beside the existing "Preview as"
  environment picker, so `{{ system.metadata.<key> }}` resolves in the preview line
  and offers `{{ }}` autocomplete.

  Previously system templating could only be previewed when the editor happened to
  be opened FROM a system: a shared-config authoring flow and every edit-mode
  session got no preview and no completions at all, because the systems list was
  not even fetched in edit mode.

  Selecting only a system is now enough to preview - an environment is no longer
  required, since `system.metadata.*` is fully resolvable without one. Both pickers
  only offer resources the caller may read.

- 56e5375: Migrate the frontend from react-router-dom v7 to react-router v8

  Resolves GHSA-qwww-vcr4-c8h2 (HIGH): React Router before 8.3.0 has an RSC-mode
  CSRF bypass that lets an action execute before the 400 response. Checkstack runs
  a client-side SPA (`<BrowserRouter>`) and does not use RSC mode, so the platform
  was not exploitable through it - but the advisory kept the dependency-graph
  security gate red on every pull request, and the fix is only available in the 8.x
  line, which the auto-remediation deliberately will not reach (it refuses major
  bumps).

  `react-router-dom` has no v8: it was folded into `react-router` in v7 and v8
  ships as `react-router` only. So this is a package swap rather than a range bump:

  - 31 packages now depend on `react-router@^8.3.0` instead of
    `react-router-dom@^7.16.0`, and 97 source files import from `react-router`.
  - The Module Federation host share, `optimizeDeps` and `dedupe` entries move to
    `react-router` (shared singleton `requiredVersion` `^8.0.0`). Remotes never
    shared the router, so the remote contract is unchanged.
  - The syncpack unified-range group tracks `react-router`, keeping the enforced
    single-range guarantee that a past four-range regression motivated.

  The API surface Checkstack uses is unchanged between v7 and v8 - `BrowserRouter`,
  `MemoryRouter`, `Routes`, `Route`, `Link`, `NavLink`, `useLocation`,
  `useNavigate`, `useParams` and `useSearchParams` are all exported by v8 with the
  same signatures - so no routing code changed beyond the import specifier. v8
  requires React >= 19.2.7, which the workspace already pins.

- 88f4333: Per-satellite offline threshold, connectivity notifications, and stop satellite-only checks going silent

  **A satellite going offline was invisible, and so were its checks.** Three
  related changes:

  **Per-satellite offline threshold.** The 45-second global constant is now a
  per-satellite override (**Offline after**, 2 minutes to 24 hours), because
  tolerance is a property of the link, not of the platform: a satellite on a flaky
  uplink needs grace that should not be forced on every other satellite. The
  threshold is carried on every row read by `computeStatus`, so the entity read,
  the admin list and the heartbeat monitor cannot disagree about the same
  satellite. Additive, nullable column - existing satellites keep the default.

  **Connectivity notifications.** Satellites are now a notification target with a
  **Satellite connectivity** subscription: a warning when a satellite stops
  heartbeating, informational when it returns. A reconnect only notifies if the
  satellite was actually offline, so a redeploy is not an event. (The same
  transitions remain available as `satellite.heartbeat_lost` / `.connected`
  automation triggers for anyone wanting different routing.)

  **Satellite-only checks no longer go silent.** BUG FIX: a check with
  `includeLocal: false` whose satellites were all offline recorded NOTHING, so it
  displayed its last known status indefinitely - a dead probe was indistinguishable
  from a passing one. The core now records a `degraded` run with a clear message.
  Degraded rather than unhealthy because the target may be fine; what failed is our
  ability to observe it. Liveness that cannot be resolved is treated as "executing"
  so a transient lookup failure cannot mark the whole fleet degraded at once.

  Checks also surface staleness: a last run older than five intervals (minimum ten
  minutes) is highlighted, so an ageing status is visible even with no run to
  explain it. Paused checks are never stale, and neither is a RETIRED slice - one
  whose environment was removed or whose satellite was unassigned - because
  warning about something you retired on purpose trains operators to ignore the
  badge.

  The unobservable run does NOT notify subscribers. One offline satellite degrades
  every check assigned to it in the same tick, and `healthy -> degraded` is an
  escalation, so notifying per check would turn a single root cause into one alert
  per check. The satellite's own connectivity subscription reports the cause once;
  the runs are still recorded, so health and the UI stay honest.

  Satellite liveness is cached on the shared platform cache with a 5s TTL. The
  executor asks per tick of every satellite-only check and the read is a full
  scan, so the uncached version scaled with the number of such checks. The TTL is
  well below the smallest offline threshold the schema allows, so a cached answer
  can lag a transition by one tick but never span one.

  Corrects the user guide, which claimed offline satellites produced failed runs -
  they produced nothing at all.

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [56e5375]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
  - @checkstack/auth-frontend@0.16.0
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/ui@1.31.0
  - @checkstack/catalog-frontend@0.22.0
  - @checkstack/frontend-api@0.18.0
  - @checkstack/dashboard-frontend@0.12.0
  - @checkstack/gitops-frontend@0.8.0
  - @checkstack/script-packages-frontend@0.5.0
  - @checkstack/secrets-frontend@0.4.0
  - @checkstack/satellite-common@0.12.0
  - @checkstack/tips-frontend@0.5.6
  - @checkstack/anomaly-common@1.8.4
  - @checkstack/catalog-common@2.8.2
  - @checkstack/signal-frontend@0.3.8

## 0.38.0

### Minor Changes

- be74b01: Evaluate health per probe location, so a failing satellite can no longer read as healthy

  Thanks to @stuajnht for reporting: a system whose local check succeeded and
  whose satellite check failed was shown as **healthy**, and the report correctly
  guessed the cause - one combined verdict where there should have been one per
  location.

  A check's runs were grouped into slices by environment alone, so both locations'
  runs landed in the same slice and were handed to the threshold evaluator as one
  interleaved stream. In the default `consecutive` mode the streak breaks on every
  alternation, no threshold is ever reached, and evaluation falls through to its
  healthy default. A satellite failing 100% of the time was therefore invisible
  for as long as a local check succeeded between its runs.

  A slice is now an **(environment, source)** pair - one environment as probed
  from one location - and each is evaluated on its own window, with the worst
  result deciding the check. This is the same rule environments already followed;
  the source dimension was simply never considered. Both the system rollup and the
  system overview were affected, and both are fixed.

  Related correctness fixes that fall out of keying slices by source:

  - A **de-assigned satellite** (or the core after **Include local** is turned
    off) stops counting immediately instead of dragging the rollup with its last
    failures until they age out of the window. Its history moves under **Old
    checks**.
  - **Per-satellite environment scoping** is honoured when resolving slices, so a
    satellite narrowed to production no longer keeps a stale staging slice alive.
  - A satellite scoped to run env-less while the core fans out keeps its slice
    live; the "has a live environment slice" question is now answered per
    location, as the backend already did.

  The system overview shows one row per slice and names the location (for example
  **EU West**) as soon as a check runs from more than one place. A check that only
  ever runs on the core shows no location label - there is nothing to
  disambiguate.

  `checkStatuses[].slices` and the overview's per-slice entries carry the
  breakdown (`sourceId`, `sourceLabel`, `sourceOrphaned`) on the wire, and
  `sliceCount` / `failingSliceCount` now count locations as well as environments -
  so a check probing one environment from the core and one satellite contributes
  2 to the dashboard's "X of Y checks failing" denominator, not 1.

- be74b01: Satellites run per environment, and can be scoped to specific ones

  Satellites were handed no environment information at all, so every result they
  reported was stored env-less. On a system with environments that meant satellite
  checks contributed nothing to per-environment health - and, until the preceding
  fix, were labelled "Old checks" for it.

  A satellite now fans out exactly as the local executor does:

  - `getAssignmentsForSatellite` resolves each assignment's effective environments
    and sends them with the assignment.
  - The agent schedules ONE run per environment and reports each result with its
    `environmentId`, so per-environment history, charts and rollups include
    satellite results.
  - Collectors on a satellite now receive the `environment` run-context block, so
    `{{ environment.<key> }}` templating resolves there exactly as it does locally.

  **A satellite can also be scoped to specific environments.** Without that, every
  satellite would probe every environment - a staging-network satellite would start
  failing prod checks it has no route to, and one per-environment slice would merge
  results from satellites in different networks. A new `satelliteEnvironmentIds`
  map on the assignment scopes each satellite: an absent key means "all
  environments" (so every existing assignment behaves exactly as before), `[]` means
  one env-less run, and a list narrows to those ids. A satellite can only ever
  narrow the assignment's own selector, never widen it.

  Both protocol additions are optional, for version skew in either direction: an
  older satellite sends no `environmentId` and its runs are stored env-less as they
  always were, while an older core sends no environments and the agent falls back to
  a single env-less run.

  The assignment's Execution panel gains a per-satellite environment picker,
  shown for each assigned satellite once the system has environments.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- be74b01: Migrate the automation surfaces onto the shared filter bar, and dedupe useDebouncedValue

  Follows the native `DataTable` facet API with the first wave of migrations.

  - `DataTableFacet` gains `kind: "select" | "pills"`. A segmented pill row is the
    right control for two or three short options a reader benefits from seeing at
    a glance, and several surfaces had independently built one - so the shared bar
    renders that variant rather than forcing every list into a dropdown. Both
    variants share one state, sentinel and URL round-trip, and the pills set
    `aria-pressed`, which two of the hand-rolled groups they replace had omitted.
  - `parsedFacetValue` reads a facet's selection back as a domain value by parsing
    it against the schema that defines it. Facet state is stringly-typed because
    it round-trips through the URL, but a server-side filter needs the narrow union
    its query input declares; parsing rather than casting means a stale link
    degrades to unconstrained instead of smuggling an unknown value into a request.
  - The automation list and run-history pages drop their hand-rolled status pill
    rows for the shared bar. Their filters now persist to the URL, so a link to
    "the failed runs of this automation" reopens filtered. The run-history table
    also gains the `surface={false}` it was missing, fixing a panel-in-panel.
  - `useDebouncedValue` had been copied verbatim into six plugin packages, each
    with a comment noting no shared version existed. All six now import the one in
    `@checkstack/ui` and the copies are deleted.

- be74b01: Migrate the catalog and health-check filters onto the shared filter bar

  Completes the consolidation. Every faceted list surface now renders one control
  set over one state model.

  `@checkstack/ui` gains what those two surfaces genuinely needed:

  - `DataTableFacetControl` splits the PRESENTATIONAL half of a facet from its row
    accessor. The catalog's matching cannot be a `value(row): string` - a system
    belongs to several groups and carries several tags, its health lives in a
    separate status map, and the same three controls also narrow GROUPS, a
    different row type entirely. Such a surface can now use the shared bar and keep
    its own matching, instead of being shut out or supplying fake accessors.
  - `disabled` / `disabledReason` keep a control visibly present-but-unavailable
    (the catalog's health filter before a health source is installed). Preferred to
    dropping the control: present-but-disabled says the capability exists and what
    would unlock it. It also keeps the parameter declared, so a selection arriving
    on a shared link still constrains rather than silently widening the list.
  - A facet option may carry a `tone`, applied while that option is selected. This
    is reserved for a dimension that genuinely IS a status: the health-check run
    filter's green "Healthy" / red "Failing" is the product's vocabulary, and a
    shared control that could not express it would be a downgrade on the one
    surface where colour carries the most meaning. Tone never affects matching.

  Migrated:

  - **Catalog** - `CatalogBrowseToolbar` becomes a thin wrapper over the shared
    bar; the density toggle rides in its `children` slot, since it narrows nothing
    and as a facet would sit behind Clear, where "clear filters" would silently
    reset row height. One toolbar still drives the browse grid and all three manage
    tabs, and `GroupsTab`'s reorder arrows are still gated on the filtered state.
    Environments were filtered by an ad-hoc substring match in the page; they now
    go through the shared logic and match descriptions too.
  - **Health checks** - the list toolbar (a self-declared copy of the catalog's)
    and both hand-rolled pill groups are deleted. The run-history filters gain URL
    persistence, so a filtered run view is now shareable, and both pill groups gain
    the `aria-pressed` and labelled group they were missing.

  All existing URL parameters are preserved, guarded by tests, so links shared
  before the migration still reopen the same view - including the catalog's
  per-system "view health checks" link, whose server-side authorization path is
  deliberately kept as a control without a row accessor.

- be74b01: Move every table's filters into the table itself

  The earlier migration unified how filter controls are BUILT but left several
  rendering above their table as a detached bar, justified by the filtering
  running server-side. That justification was wrong: where the narrowing runs says
  nothing about where the control belongs, and a bar floating above a card reads
  as unrelated to the list under it.

  Now in the table's own bar:

  - **Incidents** and **maintenances** - the Status column declares `filterValue`,
    so the control sits with the column it filters. The selection still narrows
    the list query, which is what actually reduces the fetch; the column filter
    re-applying it over already-scoped rows is a harmless no-op.
  - **Automation run history** - same, with the status pills.
  - **Health-check list** - search, strategy and status move onto their columns.
    The assigned-system control has no row to read (selecting a system swaps the
    data source, which is what makes the catalog's per-system link work without
    health-check grants), so it rides in as a control-only facet.
  - **Health-check drawer** - the run-status control moves into the runs table.

  `DataTable`'s `facets` now accepts a control WITHOUT a row accessor, rendered but
  not applied. That is what lets a server-applied dimension stay in the table's bar
  instead of forcing a second bar onto the page.

  Fixes a trap the move exposed: with server-side filtering an empty `data` means
  either "none exist" or "none match", and three of these pages rendered their
  onboarding empty state either way - automation's run history replaced the whole
  table, taking the filter controls with it, so a filter matching nothing could not
  be cleared. Each now suppresses its `emptyState` while a filter is active and
  offers a "no matches, clear filters" state instead.

  Three surfaces deliberately keep an external bar, each narrowing more than one
  list: the catalog toolbar (a browse grid plus three manage tabs), the automation
  list (one table per accordion group), and the health-check drawer's source
  control (it scopes the charts as well as the runs). The history detail page's
  list is not a `DataTable` at all.

- be74b01: Source every status tone from the one shared table

  Nineteen plugin modules each re-declared the tone-to-class table verbatim
  (`pill: "bg-status-ok/10 text-status-ok"`, `dot: "bg-status-ok"`, ...), some
  reproducing every field of the shared one. They now take those classes from
  `pillToneStyles` in `@checkstack/ui` while keeping their own domain mapping -
  which value means which tone - since that is real domain knowledge and is unit
  tested. A repo-wide search for a hand-written triad row now returns only the
  shared table.

  Several hand-rolled pills went with them, onto the shared `StatusPill`: the
  automation run pill, the satellite status badge, the notification channel pill,
  the SLO objective pill and both AI tool-card pills.

  Four rows are deliberately still local, each with a comment saying why, because
  they are NOT the shared tone despite looking like it:

  - The dashboard's `info` uses the `--info` token, a different hue from
    `--status-info` (light: `217 91% 60%` vs `214 90% 45%`).
  - Integrations' and notifications' `unknown`/`neutral` use the muted treatment -
    the ABSENCE of a tone - not the shared grey.
  - The queue's "processing" uses opacity-softened muted classes that match
    neither the shared table nor the pill's neutral.

  One genuine class divergence was found and NOT normalised: the system incident
  panel draws its borders at `/30` where the shared table uses `/20`. It is now a
  single documented map instead of a full private table.

  Pills whose geometry has no shared equivalent (the dependency canvas node with
  its animated halo, the incident panel's compact chips, the dashboard's
  non-triad signal tone) keep their markup and now only share the classes.

- be74b01: Stop the history page labelling live environments as "Removed environment"

  The health-check history page showed "Removed environment" beside runs whose
  environment was perfectly healthy - while opening the same run showed the
  environment correctly.

  The page rendered the runs table without passing `environmentLabels` at all. The
  prop was optional, so the table received no environment names, found nothing to
  resolve each run's id against, and fell back to its "this environment no longer
  exists" label. Every other caller passed the prop; the history page was the only
  one that did not, which is why the bug appeared on exactly one screen.

  The page now resolves names from every environment in the instance (as the other
  screens do) and holds its rows until they load, so a still-loading environment
  cannot flash as removed either.

  The prop is now REQUIRED on both run lists. "Removed environment" is a claim
  that an id is absent from the complete list, which is only sound if the complete
  list was actually supplied - and while the prop was optional, forgetting it
  produced a confident lie rather than a visible gap. The three cases (env-less,
  named, genuinely removed) are now resolved by one tested helper instead of a
  lookup that could not tell "no list" from "not in the list".

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- be74b01: Stop labelling live satellite checks as "Old checks"

  On a system that has environments, a check assigned to both the local core and a
  satellite showed the satellite's results under "Old checks" the moment the
  satellite first reported - even though they were the freshest data on the page.

  The cause is that satellites are handed no environment information: every result
  a satellite reports is written env-less. The overview decided a slice was old
  STRUCTURALLY - an env-less slice must be historical, it reasoned, because a check
  that fans out per environment cannot still be writing env-less runs. That held
  while only the local executor wrote runs, and satellites break it.

  The rule now means what its name says: an env-less slice is old only when it has
  actually stopped receiving runs, judged from its own run timestamps against the
  check's interval, with a generous allowance (five missed intervals, and a
  ten-minute floor) so a probe that is merely slow or backing off is never
  mistaken for a dead one. A slice that has never run at all is pending, not old.

  A concrete environment that left the system, or was disabled for the assignment,
  is still called old immediately - that verdict is certain, so making it wait
  would only delay a correct label.

  This fixes the mislabelling. The underlying gap - satellites receiving no
  environment context, so satellite checks contribute no per-environment health -
  is tracked separately.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- be74b01: Consolidate eight status pills into one

  `StatusPill` moves into `@checkstack/ui`. It replaces six near-identical local
  components (announcements, incidents, maintenance, health checks, notifications,
  script packages) and three hand-rolled inline chips (the public status page's
  event card and event detail page, the announcements status widget). They
  differed only in whether they took `label` or `children`, whether they forwarded
  `className`, and whether they set `shrink-0` - they agreed on everything that
  mattered, which is why they collapse cleanly.

  The shared pill absorbs the variations rather than flattening them:

  - `tone="neutral"` for a state that deliberately carries no hue, read from its
    label alone. This was hand-rolled in three places after the "at most one
    coloured dimension per row" rule landed. It drops the dot, since with no hue
    to encode a grey dot adds nothing.
  - `size="sm"` for dense contexts - a public event card, a widget list - which
    previously meant inline `text-[11px]` chips.
  - `shrink-0` is now unconditional: a pill squashed by a greedy sibling is
    unreadable, and its text is the accessible encoding of the status.

  Domain plugins keep their thin wrappers (`HealthStatusPill`,
  `getIncidentSeverityBadge`, ...) because mapping a domain value to a tone and a
  label IS domain knowledge - only the chip moved.

  Also removes two related duplications found in the same sweep: the dependency
  plugin hand-wrote the pill's classes inline in a `getImpactBadge` switch
  duplicated across its alert banner and its editor (now one `ImpactBadge`
  component over the tone mapping its own logic module already owned), and its
  private tone table now sources the triad from the shared one.

  `status-page-frontend`'s local `StatusPill` is renamed `PublicStatusPill`: it is
  keyed by the public status enum and draws from that enum's own visual tokens, so
  it is a genuinely different component and the name now says so.

- be74b01: Stop a system with no health data from reading as "Degraded"

  A system with no health checks (or whose checks have not run yet) has health
  status `unknown`, but two display paths treated every non-`healthy` status as a
  problem and fell through to the amber "Degraded" label - so a check-less system
  falsely showed "Degraded" on its detail page, in catalog rows, and as a problem
  card on the dashboard, with no incident, no failing check, and no failing
  dependency to explain it.

  Both now omit `unknown` alongside `healthy` (only `degraded` / `unhealthy`
  produce a badge or signal), matching the "an unmeasured system is no signal, not
  a fault" model the catalog rollup already uses:

  - `deriveHealthcheckSignals` (`@checkstack/healthcheck-common`) no longer emits a
    dashboard signal for an `unknown` system. Its doc already said healthy and
    unknown are omitted; the code only skipped healthy.
  - The system health badge (`@checkstack/healthcheck-frontend`) returns no badge
    for `unknown`. The decision was extracted into a pure `resolveHealthBadge`
    helper with unit tests.

  The dependency "Degrading impact" chips on the edge are unrelated - they show the
  edge's configured impact type, and the dependency warning engine already maps an
  unmeasured upstream to operational, so it raises no warning.

- be74b01: Stop reporting systems as healthy when nothing has measured them

  A system whose health check had never produced a run reported `healthy` - so it
  showed green in the catalog, kept its group green, and read "operational" on the
  public status page. A system with no checks at all did the same. For a
  monitoring product that is the worst possible default: the one state you must
  never invent is the reassuring one.

  `getSystemHealthStatus` began each check at `healthy` and each system's
  aggregate at `healthy`, then only ever downgraded. With no runs to examine,
  nothing downgraded them. `HealthCheckStatus` had no way to say "not measured".

  A new `SystemHealthStatus` adds `unknown` for systems and their checks. It is
  deliberately NOT a run status - a run that happened is always healthy, degraded
  or unhealthy, and the database enum stays three-valued. Now:

  - A check with no runs is `unknown`, not `healthy`.
  - A system reports `unknown` when no check contributed a signal. A system with
    one healthy check and one never-run check still reads `healthy`: it has
    positive evidence, and the unmeasured check is visible on its own page.
  - The catalog reports `unknown` by OMISSION, which its group rollup already
    treats as "no signal" - so a group with an unmeasured member stops claiming to
    be healthy. That is the reported bug.
  - The public status page maps it to its existing `unknown`, which is ignored for
    the overall banner unless everything is unknown. One unmeasured system no
    longer claims "operational" for itself, and does not panic the whole page.
  - A first measurement records a transition with a NULL `fromStatus` - the column
    was already nullable for exactly this case - instead of pretending the system
    was healthy beforehand.
  - Automations matching on `unhealthy` do not fire for a merely unmeasured
    system, which is correct: an unmeasured system is not a detected outage.

  Dependency warnings deliberately keep their current behaviour: an unmeasured
  upstream raises no warning, and a never-run check is dropped from the evaluation
  rather than counted as passing.

  Note that pausing a system's only check now leaves it `unknown` rather than
  `healthy`. Paused failures still do not keep a system degraded - that behaviour
  is unchanged - but with nothing running, the system is genuinely unmeasured.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- Updated dependencies [be74b01]
- Updated dependencies [be5c907]
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
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/ui@1.30.0
  - @checkstack/dashboard-frontend@0.11.2
  - @checkstack/catalog-frontend@0.21.2
  - @checkstack/auth-frontend@0.15.0
  - @checkstack/script-packages-frontend@0.4.18
  - @checkstack/gitops-frontend@0.7.9
  - @checkstack/secrets-frontend@0.3.17
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/satellite-common@0.11.0
  - @checkstack/frontend-api@0.17.0
  - @checkstack/tips-frontend@0.5.5
  - @checkstack/anomaly-common@1.8.3
  - @checkstack/catalog-common@2.8.1

## 0.37.1

### Patch Changes

- Updated dependencies [53081bd]
  - @checkstack/catalog-frontend@0.21.1
  - @checkstack/dashboard-frontend@0.11.1

## 0.37.0

### Minor Changes

- 6c8b36b: Smooth out loading states so surfaces no longer flash a wrong resolved state or
  pop content in one piece at a time.

  - **Dashboard no longer flashes "all systems healthy".** The overview aggregates
    per-system signals from many plugins (health, incidents, SLOs, anomalies,
    dependencies, log/metric/trace streams), each reporting asynchronously - so
    before any had loaded, an empty problem list briefly read as an all-clear.
    `SystemSignalsSlot` gains an additive `onLoadingChange` report; every source
    filler reports its load state, and the dashboard holds its existing skeleton
    until all mounted sources have settled (bounded by a grace period so a
    non-reporting source cannot hang it).
  - **System detail overview cards reveal together.** Each `SystemDetailsSlot` card
    self-loads and several self-hide when empty, so they popped in one after
    another. The slot gains an additive `onLoadingChange`; each card reports, and
    the detail page keeps the cards mounted but behind a skeleton set until all
    have settled, then reveals them at once - no stagger, no layout shift, and
    cards with no content simply never appear.
  - **Catalog manage "Health" column no longer pops in.** `CatalogBrowseHealthSlot`
    gains an additive `onLoading` report (sourced from the health filler's bulk
    fetch); the manage Systems tab shows a per-row placeholder until the health
    data settles, so the status badges swap in instead of appearing onto an empty
    cell. The same tab also keeps its state badges on one row (side by side)
    instead of wrapping.
  - The system detail **Dependencies** and **Logs / Metrics / Traces** cards are now
    collapsed by default: each shows a compact "<title> N" summary and expands its
    detail on click, so the overview column stays short. They render through a new
    shared `CollapsibleDetailCard` (`@checkstack/ui`) that single-sources the header
    layout (icon + title + count + rotating chevron) so every collapsible overview
    card is vertically centred and behaves identically - the earlier per-card header
    markup had drifted and left the Logs/Metrics/Traces titles off-centre when
    collapsed.
  - Moved the system detail **SLO card** from the full-width alert strip into the
    left (monitoring) column, so it sits at the same width as the dependencies and
    health cards; only maintenances and incidents stay full width. It now joins the
    coordinated card reveal above.
  - Removed a dead, unreferenced duplicate dashboard component
    (`dashboard-frontend/src/Dashboard.tsx`); the live overview is
    `DashboardSystemHealthSection`.

  All slot-contract additions are optional/additive - existing fillers and
  consumers keep working unchanged.

- 6c8b36b: Cross-signal trace correlation. Log events, traces, and health-check runs
  now link to each other:

  - logstream: `searchEvents` accepts an exact `traceId` filter (Explore gets
    a matching, deep-linkable filter input backed by a new partial
    `(trace_id, ts)` index), and the new cross-stream `findEventsByTraceId`
    returns per-stream match groups post-filtered by the caller's read grants.
    Streams can declare `config.traceExtraction` rules (attribute paths and a
    capture-group body regex, validated at save) that populate trace/span ids
    for non-OTLP sources at the ingest flush seam - OTLP and native reserved
    keys always win.
  - Correlation slots: `LogEventDetailSlot` (logstream-common, expanded event
    row), `TraceCorrelationsSlot` (tracestream-common, trace detail view), and
    `RunDetailExtrasSlot` (healthcheck-common, run detail panel) with
    `extractRunTraceIds` owning the run-result trace-id shape.
  - Fills: the trace view shows the trace's correlated log events grouped per
    readable stream; log events and health-check runs with a known trace id
    get a "View trace" jump resolved through `findTraceById`.

### Patch Changes

- 6c8b36b: The Logs, Metrics, and Traces cards on the system overview page now match the
  other cards. They had drifted to a flat `bg-card` background with a
  hairline-only shadow, so they rendered visibly flatter than their siblings
  (health, dependency, SLO, incident, anomaly, maintenance), which all use the
  detail-page gradient plus a soft two-layer elevation shadow.

  The shared card surface is now a single primitive - `DetailCard` (and the
  `detailCardSurface` / `detailCardSurfaceFlat` class constants) in
  `@checkstack/ui` - instead of a className that was copy-pasted (and could
  diverge) in every system-overview card. All of those cards now render from the
  one primitive, so they cannot drift apart again. A new `error`-level ESLint
  rule `checkstack/no-inline-detail-card-chrome` fails the build if a card in that
  family re-declares the surface inline instead of using `DetailCard`.

- 6c8b36b: Edit forms stay stable while you are typing. Previously, editing a system's
  description (and many other edit dialogs/settings pages) would reset the field
  mid-edit whenever a webhook update or realtime signal refetched the underlying
  query: the form re-seeded its local state from the fresh query result on every
  refetch. Forms now seed their local state ONCE - on the dialog's open
  transition, or once per record via a stable key - and ignore background
  refetches while you are editing.

  New shared primitive `useSeedFormOnOpen(open, onInit)` in `@checkstack/ui`
  (alongside the existing `useInitOnceForKey`) seeds a dialog form once per
  open transition, StrictMode-safe. Fixed surfaces include the catalog
  system/environment/group editors, the healthcheck platform-defaults dialog,
  the SLO / gitops-provider / telemetry-source / satellite / announcement /
  role edit dialogs, and the cache / queue / notification / secrets / anomaly /
  profile / strategies settings pages (query-seeded pages also drop their loader
  cache via `gcTime: 0` so a warm cache cannot race the one-shot seed).

- 6c8b36b: Speed up the catalog manage Systems tab and unify its per-row actions.

  - The per-row `SystemHealthCheckAssignment` no longer runs two allocation-heavy
    access hooks (`useCanAccessType` + `useResourceAccess`) plus a counts query
    PER ROW - profiling showed this as the dominant, GC-bound cost of opening the
    Systems tab. A new `CatalogSystemHealthCheckDataProvider`, folded around the
    catalog tree via `CatalogBrowseDataBoundarySlot`, resolves the gate + counts
    once for the whole visible list; the row action reads them from context (the
    heavy standalone path is only rendered on surfaces without the provider, e.g.
    the system detail page).
  - The per-row `SystemAnomalyBadge` no longer instantiates two live query
    observers (and scans up to 500-element arrays) per row. A new
    `AnomalyBadgeDataProvider`, folded around the catalog browse/manage tree via
    `CatalogBrowseDataBoundarySlot`, fetches the active + suspicious anomaly sets
    once and exposes an O(1) per-system lookup - matching the SLO / incident /
    health / dependency badges. Without the provider the badge falls back to its
    own (deduped) queries, so the system detail page is unchanged.
  - `ScopeSystemToTeamAction` and `SystemHealthCheckAssignment` now render through
    the shared `RowAction`, so a system row's action cluster looks uniform.
    `ScopeSystemToTeamAction` additionally defers mounting its Radix dialog until
    first use, so a table of rows no longer mounts an idle dialog per row.
  - `@checkstack/ui` `RowAction` gains an optional `badge` (e.g. an assigned-count
    indicator) rendered next to the icon, so a count action stays a normal
    `RowAction` instead of a bespoke button.

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
  - @checkstack/ui@1.29.0
  - @checkstack/auth-frontend@0.14.0
  - @checkstack/catalog-frontend@0.21.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/catalog-common@2.8.0
  - @checkstack/dashboard-frontend@0.11.0
  - @checkstack/frontend-api@0.16.1
  - @checkstack/gitops-frontend@0.7.8
  - @checkstack/secrets-frontend@0.3.16
  - @checkstack/common@0.23.0
  - @checkstack/script-packages-frontend@0.4.17
  - @checkstack/tips-frontend@0.5.4
  - @checkstack/anomaly-common@1.8.2
  - @checkstack/satellite-common@0.10.1
  - @checkstack/signal-frontend@0.3.7

## 0.36.2

### Patch Changes

- Updated dependencies [56af572]
- Updated dependencies [56af572]
  - @checkstack/ui@1.28.2
  - @checkstack/auth-frontend@0.13.6
  - @checkstack/catalog-frontend@0.20.2
  - @checkstack/dashboard-frontend@0.10.11
  - @checkstack/gitops-frontend@0.7.7
  - @checkstack/script-packages-frontend@0.4.16
  - @checkstack/secrets-frontend@0.3.15
  - @checkstack/tips-frontend@0.5.3
  - @checkstack/anomaly-common@1.8.1
  - @checkstack/catalog-common@2.7.3
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.16.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/signal-frontend@0.3.6

## 0.36.1

### Patch Changes

- Updated dependencies [6540703]
  - @checkstack/ui@1.28.1
  - @checkstack/auth-frontend@0.13.5
  - @checkstack/catalog-frontend@0.20.1
  - @checkstack/dashboard-frontend@0.10.10
  - @checkstack/gitops-frontend@0.7.6
  - @checkstack/script-packages-frontend@0.4.15
  - @checkstack/secrets-frontend@0.3.14
  - @checkstack/tips-frontend@0.5.2

## 0.36.0

### Minor Changes

- a74fa01: Redesign the assertion builder for readability by non-technical operators.
  Conditions now read as sentences with inline controls -
  "[Response Time] must [be less than] [500] ms" - driven by the collector
  metadata that already powers the auto-charts:

  - Field names come from `x-chart-label` (with a humanized fallback) instead
    of machine-derived paths like "Body → Status"; nested fields compose as
    "TLS › Days Left".
  - Numeric values render their `x-chart-unit` suffix; boolean conditions use
    the collector's `x-chart-true-label`/`x-chart-false-label` prose ("must be
    successful" instead of "Is True").
  - The field picker sorts by `x-chart-priority` and groups JSONPath fields
    under "Advanced" (with an inline expression input and example help);
    "Add condition" seeds the highest-priority field instead of the first one.
  - Incomplete conditions (missing value, invalid regex, blank JSONPath) show
    an inline explanation and block Save through the editor's existing
    validity plumbing; duplicate conditions get a hint.
  - Persisted data is untouched: field paths, operator strings, and the
    `CollectorAssertion` shape are byte-for-byte unchanged, so existing checks
    round-trip as-is. The builder is now typed against `CollectorAssertion`
    directly (the duplicated local `Assertion` type and its casts are gone),
    and the dead `CollectorList` component was removed.

  The `@checkstack/ai-backend` patch is the regenerated docs index for the
  documentation pages updated in this release (assignment flow, assertions,
  and the slimmed system/incident/maintenance edit dialogs).

- a74fa01: Relocate health-check assignment management from the catalog-entered,
  system-centric Assignment IDE into the check editor itself, so a check's
  settings AND its assignments (with their per-system settings) are managed in
  one place. Users think in terms of "Health Checks", not the catalog - the
  old flow was discovered through a catalog system row and inverted that mental
  model.

  - **Check editor Assignment section** (edit mode): lists every assigned
    system as a tree group with the per-assignment panels (General, Thresholds,
    Retention, Execution with satellites + environment fan-out, Notifications)
    plus an "Assign to system..." picker that only offers systems the caller
    can manage. The `AssignmentIDENodeSlot`/`AssignmentIDEPanelSlot` extension
    points keep their names and context shape - extension node ids are
    namespaced per system internally so config-keyed ids (e.g. the anomaly
    panels) no longer collide across systems.
  - **New procedure `getConfigurationAssignments`** (config → systems, the
    inverse of `getSystemAssociations`), handler-authorized fail-closed: global
    configuration read or a team grant on the configuration sees every row;
    otherwise rows filter to systems the caller may read.
  - **`getConfiguration` relaxed** (handler-authorized): a reader of an
    ASSIGNED system may load the (redacted) configuration - the same exposure
    `getSystemConfigurations` already allowed - so system managers can open the
    editor. Unauthorized callers still get the same `undefined` as a missing id.
  - **RLAC**: the edit and config routes now declare
    `manageCapability.parentType: catalog.system`, so a pure system manager
    reaches the editor for its Assignment section; the config side renders
    read-only for them (Save disabled, strategies/collectors/access-control
    gated per-node) while their systems' assignment panels stay writable.
    GitOps-locked systems lock exactly their own assignment nodes.
  - **Catalog wayfinding**: the per-system row button is now a
    "Manage health checks" link opening the Health Checks list pre-filtered to
    that system (`?system=<id>`); the filtered list loads via the
    system-read-gated `getSystemConfigurations`, so it also works for system
    managers without healthcheck grants.

  BREAKING CHANGES: the standalone system-centric assignment page is removed -
  the `healthcheck` plugin's `assignments` route (`/assignments/:systemId`) no
  longer exists and `healthcheckRoutes.routes.assignments` is gone from
  `@checkstack/healthcheck-common`. Deep links to the old page now 404; use the
  check editor's Assignment section (or the filtered Health Checks list)
  instead.

- 4568dcc: Render the log-stream health-check config as real dropdowns. The check editor
  now forwards dynamic-option resolvers to its strategy and collector config
  forms, so the `logstream` strategy's **stream** field and the
  `pattern-occurrence` collector's **pattern** field become pickers instead of
  plain text inputs.

  The health-check editor gains a contribution point,
  `HealthCheckConfigOptionsResolverSlot`: a plugin that registers a strategy whose
  config declares `x-options-resolver` fields contributes a factory that turns the
  editor's generic context (the RPC api plus the current strategy config) into the
  concrete resolvers. The editor stays ignorant of any specific strategy - the
  owning plugin supplies the resolvers, mirroring the backend extension-point
  pattern. Because the editor passes the strategy config down to the collector
  forms, a collector-field resolver can read a selection made in the sibling
  strategy form (the pattern picker lists the chosen stream's Drain patterns).

  `logstream-frontend` contributes the `logstreamStreamId` and
  `logstreamPatternId` resolvers, backed by the `typeScoped` `listStreamsForPicker`
  and `listPatterns` procedures, and `logstream-common` now exports the shared
  strategy id and resolver-name constants so the backend annotations and the
  frontend resolvers reference one source and cannot drift.

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
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [4568dcc]
- Updated dependencies [a74fa01]
- Updated dependencies [d00e099]
  - @checkstack/ui@1.28.0
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/auth-frontend@0.13.4
  - @checkstack/frontend-api@0.16.0
  - @checkstack/satellite-common@0.10.0
  - @checkstack/catalog-frontend@0.20.0
  - @checkstack/catalog-common@2.7.3
  - @checkstack/dashboard-frontend@0.10.9
  - @checkstack/gitops-frontend@0.7.5
  - @checkstack/script-packages-frontend@0.4.14
  - @checkstack/secrets-frontend@0.3.13
  - @checkstack/tips-frontend@0.5.1
  - @checkstack/anomaly-common@1.8.1
  - @checkstack/common@0.22.0
  - @checkstack/signal-frontend@0.3.6

## 0.35.2

### Patch Changes

- Updated dependencies [1f20b5a]
- Updated dependencies [5e704cd]
  - @checkstack/anomaly-common@1.8.0
  - @checkstack/ui@1.27.0
  - @checkstack/frontend-api@0.15.0
  - @checkstack/tips-frontend@0.5.0
  - @checkstack/auth-frontend@0.13.3
  - @checkstack/catalog-frontend@0.19.1
  - @checkstack/dashboard-frontend@0.10.8
  - @checkstack/gitops-frontend@0.7.4
  - @checkstack/script-packages-frontend@0.4.13
  - @checkstack/secrets-frontend@0.3.12
  - @checkstack/catalog-common@2.7.2
  - @checkstack/healthcheck-common@1.16.2
  - @checkstack/satellite-common@0.9.6

## 0.35.1

### Patch Changes

- b80160a: perf(healthcheck): batch the system-access gate in the catalog "Health Checks"
  action so it no longer N+1s per row

  `SystemHealthCheckAssignment` (contributed once per system row to the catalog
  `CatalogSystemActionsSlot`) gated its button with
  `useResourceAccess({ resourceIds: [systemId] })` - a single id per row. Each
  row's query key differed, so React Query could not dedupe them and N systems
  fired N separate `listMyAccessibleResources` requests on every catalog-manager
  render. It now passes the `visibleSystemIds` it already receives (the whole
  visible list), so every row's identical-input query dedupes to ONE request and
  the row still gates on `canAccess(systemId)` - the exact pattern the same file's
  `getBulkAssignedHealthCheckCounts` counts query already uses.

- Updated dependencies [bd41130]
- Updated dependencies [bd41130]
- Updated dependencies [b80160a]
  - @checkstack/ui@1.26.1
  - @checkstack/catalog-frontend@0.19.0
  - @checkstack/frontend-api@0.14.2
  - @checkstack/auth-frontend@0.13.2
  - @checkstack/dashboard-frontend@0.10.7
  - @checkstack/gitops-frontend@0.7.3
  - @checkstack/script-packages-frontend@0.4.12
  - @checkstack/secrets-frontend@0.3.11
  - @checkstack/tips-frontend@0.4.12
  - @checkstack/catalog-common@2.7.1
  - @checkstack/healthcheck-common@1.16.1
  - @checkstack/anomaly-common@1.7.2
  - @checkstack/satellite-common@0.9.5

## 0.35.0

### Minor Changes

- 43e4484: Fix an N+1 in the catalog manager: the per-system "Health Checks" count badge
  fired one `getSystemAssociations` request per system row, each holding a pooled
  Postgres connection that contended with the background health-check run
  executor and could exhaust the pool on large catalogs.

  - Add `getBulkAssignedHealthCheckCounts({ systemIds })` to healthcheck, which
    returns per-system assignment counts (0 for systems with no assignments) from
    ONE grouped `COUNT(*) ... GROUP BY system_id` query. Read authorization
    matches the per-system endpoint it replaces (`configuration.read` +
    `catalog.system` read via `recordKey`), so a team-scoped user only sees counts
    for systems they may read.
  - `CatalogSystemActionsSlot` now passes `visibleSystemIds` (every system id in
    the row's list) so a per-row filler can bulk-fetch for the whole visible set
    in a single deduped request instead of one request per row. This mirrors how
    `CatalogBrowseHealthSlot` / `SystemSignalsSlot` already pass `systemIds`.
  - The health-check count badge now reads its count from that one deduped bulk
    query. N visible rows cause 1 request instead of N.

  State & scale: the counts are derived on read from the shared
  `system_health_checks` table, so every pod returns the same answer; no
  process-local or duplicated state is introduced.

- 43e4484: Extend `{{ … }}` environment templating across every built-in health-check type
  and add editor UX for it, so one check config can cover N environments (mirrors
  the existing HTTP `url` pattern).

  Templatable connection/target fields now marked `x-templatable`:

  - TLS: `host`, `servername`; TCP: `host`; Ping: `host`; gRPC: `host`, `service`.
  - MySQL / Postgres: `host`, `database`, `user`, `query`.
  - SSH: `host`, `username`, `command`; Redis: `host`, `args`; RCON: `host`,
    `command`.
  - DNS: `hostname`, `nameserver`; Jenkins: `url` (`baseUrl`), `jobName`;
    Container: `endpoint`, `container`.
  - SNMP: `host` (strategy), `oid` (collector).
  - Script (shell): `cwd` (working directory).

  This closes the last gaps so the coverage is now truly every built-in
  health-check type. The Script collectors' `script` bodies are deliberately NOT
  templatable: rendering `{{ … }}` into shell/TypeScript source would splice env
  values into executed code. Per-environment data reaches those scripts safely via
  the reserved `CHECKSTACK_ENV_*` shell vars (shell collector) and
  `globalThis.context.environment` (inline collector) instead.

  Because templating strips `{{ }}` and renders an undefined variable to an empty
  string, every REQUIRED templatable field now has a post-render config-error
  guard so an empty/invalid render is treated as a transport failure instead of a
  silent "healthy" empty probe. Strategy connection fields (host, database, user,
  endpoint, container, Jenkins base URL, SNMP host) throw from `createClient`;
  collector target fields (query, command, hostname, jobName, SNMP oid) return a
  `CollectorResult` with an `error`. Jenkins `baseUrl` moves its `.url()` validation to post-render.
  Secret fields (passwords/tokens/keys) are never templatable; optional fields
  (SNI `servername`, gRPC `service`, DNS `nameserver`, Redis `args`, Script `cwd`)
  are templatable but not non-empty-guarded, since an empty render is a legitimate
  "unset". SSRF/egress guards continue to run on the rendered host (rendering
  happens before `createClient`).

  Editor UX (`@checkstack/ui` + `@checkstack/healthcheck-frontend`):

  - The environment "Preview as" picker + live preview line now also apply to the
    strategy (connection) form, not just collector forms, so host/port templates
    preview too.
  - A single-line templatable field shows a small "Templating" badge next to its
    label and, when a completion provider is supplied, renders a
    `TemplateValueInput` with `{{ … }}` autocomplete. The health-check editor
    seeds the provider with the fixed `environment.* / check.* / system.*`
    namespace (`createReferenceCompletionProvider`, new `@checkstack/ui` export),
    and `DynamicForm` gains a `templatableFieldsOnly` prop so only `x-templatable`
    fields become template inputs (automation keeps templating every string field).

  BREAKING CHANGE: none. Existing non-templatable configs and stored values are
  unaffected; only fields explicitly marked `x-templatable` change behavior.

  The `@checkstack/ai-backend` bump reflects the regenerated docs index for the
  updated health-check collector and config-schema templating documentation.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- 43e4484: Fix a console 400 when creating a new health check: the IDE config plugin slots
  (e.g. the Anomaly "Template Anomaly Defaults" panel) mounted on the `"new"` route
  sentinel and fired parent-scoped queries (`getAnomalyConfig` /
  `getConfiguration`) with a non-existent id. The truthy `"new"` sentinel is now
  collapsed to `undefined`, so those slots do not mount and every
  `enabled: !!configurationId` guard works until the check is first saved. The
  Anomaly Defaults tab still appears immediately after the first save.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

- 43e4484: fix(healthcheck): disabling an environment for an assignment now clears its stale slice from the rollup and overview immediately

  Disabling an environment for a health-check assignment (removing it from the
  assignment's `environmentIds`) stopped that environment from fanning out, but a
  check that was FAILING there kept dragging the system health rollup/badge to
  unhealthy and kept showing as a live failing row in the system overview. Because
  the rollup is recomputed by an event-driven consumer subscribed to per-env health
  CHANGES, and a disabled env produces no further runs (so no change event fires),
  the stale unhealthy status was never recomputed away - it only cleared
  incidentally, once the disabled env's runs aged out of the bounded run window
  (which needs the assignment's OTHER active environments to produce enough newer
  runs first). With a single active/failing env, it could persist until retention.

  Scope: this reconciles environments DISABLED/removed ON THE ASSIGNMENT (its
  `systemHealthChecks.environmentIds` selector - switching to Specific and
  deselecting, or None).

  Fixes:

  - The rollup aggregation (`getSystemHealthStatus`) and the per-check status in
    `getSystemHealthOverview` now consider only CURRENTLY-EFFECTIVE environment
    slices, derived from the durable `systemHealthChecks.environmentIds` selector
    (catalog-free, identical on every pod). A slice whose environment was disabled
    for the assignment, or the stale env-less slice of a check that now fans out,
    no longer contributes.

  Known limitation: under an "all-environments" assignment (`environmentIds` is
  `null`), an environment removed only from the system's CATALOG MEMBERSHIP (rather
  than disabled on the assignment) can still contribute to the backend rollup/badge
  until the assignment is re-evaluated, because the rollup read path is
  intentionally catalog-free for horizontal-scale correctness (it must return the
  same answer on every pod without a per-read catalog lookup). This is pre-existing;
  the frontend overview, which can see membership, still orphans such a slice.

  - Each environment is now windowed by its OWN query in the rollup, instead of a
    single shared `LIMIT` across the mixed-env pool. The old shared window
    truncated per-env evaluation for checks that fan out to many environments (or
    with large threshold windows); every environment now gets its full evaluation
    depth.
  - Changing an assignment's environment set now triggers an immediate rollup
    recompute for that system, so the persisted `health` entity (badge + SLO
    downtime) converges at once rather than waiting for stale runs to age out.
  - The system-overview frontend tucks a slice whose environment was disabled for
    the assignment under "Old checks" (system membership alone could not detect it,
    since the environment is still part of the system). `getSystemHealthOverview`
    now returns each check's `environmentIds` selector to drive this.

  Shared pure helpers `selectorIncludesEnvironment` / `isEnvSliceEffective` /
  `selectEffectiveEnvKeys` are added to `@checkstack/healthcheck-common` so the
  backend and frontend agree on effective-slice detection.

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
  - @checkstack/dashboard-frontend@0.10.6
  - @checkstack/catalog-common@2.7.0
  - @checkstack/catalog-frontend@0.18.0
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/ui@1.26.0
  - @checkstack/frontend-api@0.14.1
  - @checkstack/anomaly-common@1.7.1
  - @checkstack/auth-frontend@0.13.1
  - @checkstack/satellite-common@0.9.4
  - @checkstack/gitops-frontend@0.7.2
  - @checkstack/script-packages-frontend@0.4.11
  - @checkstack/secrets-frontend@0.3.10
  - @checkstack/tips-frontend@0.4.11

## 0.34.0

### Minor Changes

- f93ee7a: Derive frontend authorization gates from the RPC contract instead of hand-picking
  a hook per call site. The backend contract already declares, per procedure, both
  the access rule (`access`) and how it is instance-scoped (`instanceAccess`); the
  frontend gate was a hand re-encoding of that, which is how the "global-only
  team-grant" drift shipped (nothing enforced that the hook a page chose matched
  the mode the contract declared).

  New `resolveProcedureGate` (`@checkstack/common`) reads a contract procedure's
  metadata and returns the single gate the backend will enforce - classifying
  `global` / `idParam` / `create` / `typeScoped` / post-filtered `open`, deriving
  the object type from the rule and resolving the resource id from the input via
  the contract's declared path. `parentScope` is normalized into an `idParam`/`open`
  gate on a reconstructed parent rule + the parent type (the parent grant string the
  backend checks is exactly `${resourceType}.${action}`, so no contract change was
  needed). New `accessApi.useProcedureAccess(procedure, input)`
  (`@checkstack/frontend-api` / `@checkstack/auth-frontend`) dispatches on the
  derived gate; a call site can no longer gate on the wrong thing.

  Fix a latent `create.parent` gap: the create gate's global-RBAC path only checked
  the procedure's own manage rule, so a user with GLOBAL manage on the PARENT type
  (e.g. a global system manager creating an incident/maintenance/SLO "for" a system,
  which the backend authorizes via the parent gate) was not offered the create
  affordance. The derived create gate now also ORs global manage on the parent type.

  Migrate every `useCanCreate` create-button gate (catalog systems, health checks,
  incidents, maintenance, SLOs, automations, status pages) to `useProcedureAccess`
  on the owning create procedure, which also delivers the `create.parent` fix to
  each, then remove `useCanCreate` from the `AccessApi`.

  BREAKING CHANGES: `accessApi.useCanCreate(...)` is removed from
  `@checkstack/frontend-api`. Replace it with
  `accessApi.useProcedureAccess(SomeApi.contract.createX)` - the create procedure's
  `instanceAccess.create` supplies the object type and parent gate, so no more
  hand-passed `objectType` / `parentType`. The remaining hooks (`useAccess`,
  `useCanAccessType`, `useResourceAccess`, `useRouteAccess`, `useIsAuthenticated`)
  are unchanged: they gate surfaces/rows/routes that are not tied to a single
  procedure. No gate became more restrictive; the create fix makes global
  parent-managers correctly see create controls they were wrongly denied.

  Patch-level adaptations to the `AccessApi` interface change (no behavior change of
  their own): the host app's fallback `AccessApi` stubs (`@checkstack/frontend`) and
  Storybook's mock (`@checkstack/ui`) drop `useCanCreate` and add the new
  `useProcedureAccess` / `useSurfaceAccess` members so they match the interface, and
  a `@checkstack/catalog-common` doc comment now names `useProcedureAccess` instead
  of the removed hook.

- f93ee7a: Fix a class of 403s where team-scoped managers were blocked from endpoints they
  needed. A repo-wide audit of every `instanceAccess: { global: true }` procedure
  found more instances of the same bug behind the health-check editor fix: an
  endpoint on a team-scopable resource type, gated so only the GLOBAL access rule
  (never a team grant) authorizes it.

  Automation: the editor utilities and catalogs (`validateDefinition`,
  `listTriggers`, `listActions`, `listArtifactTypes`, `listAutomationGroups`,
  `listAutomationTemplates`, `renderTemplate`, `testScript`) now use `typeScoped`
  so a team-scoped automation manager can author without the global rule. The run
  endpoints (`listRuns`, `getRun`, `cancelRun`, `getRunScopeForReplay`) are scoped
  to their parent automation via `parentScope` on `automationId`; `getRun`,
  `cancelRun`, and `getRunScopeForReplay` now take the owning `automationId`
  (always available in the run URL/editor) and the handler filters the run fetch by
  it, so a run id cannot be paired with a foreign automation the caller happens to
  hold a grant on. The two migration-admin endpoints stay `global: true` (genuine
  platform-admin actions).

  Health check: `validateConfiguration` (editor deep-validate) and
  `getPlatformNotificationDefaults` (fetched on every assignment-editor mount) move
  to `typeScoped`. The paired WRITE `setPlatformNotificationDefaults` stays
  `global: true` on purpose - it rewrites instance-wide defaults for every team, so
  a single team grant must not authorize it. Because that write stays global-only,
  the assignment editor's "Notification defaults" button is now gated on the global
  `configuration.manage` rule (`healthcheck-frontend`), so a team-scoped manager no
  longer sees an editor whose Save always 403'd.

  Anomaly: the anomaly settings panels embedded in the health-check editor
  (`updateAnomalyConfig` / `getAnomalyConfig` and `updateAnomalyAssignmentConfig` /
  `getAnomalyAssignmentConfig`) were authorized against the non-team-scopable
  `anomaly_feed` type (via `global: true` or an `idParam` that could never match a
  team grant), so a team-scoped manager who owns the check/system saw "Save
  Defaults" / "Save Exceptions" buttons whose Save always 403'd. They now
  `parentScope` on the owning health-check configuration (`healthcheck.healthcheck`)
  and catalog system (`catalog.system`) respectively, so managing the check/system
  authorizes reading and editing its anomaly settings. The frontend needed no
  change: those buttons were already disabled for non-managers, and the panels are
  only reachable inside the manager-gated editor. Also, the automation "New
  automation" template picker (`automation-frontend`) gated its page on the bare
  global manage rule; it now uses the create capability, so a team-scoped creator
  (whom the route already reveals the page to) is no longer shown a blocked page.

  Incident & maintenance: `removeLink` was `global: true` because its input carried
  only the link id. It now takes the owning `incidentId` / `maintenanceId`
  (mirroring `addLink`), authorizes per-instance via `idParam`, and the service
  scopes the delete by that parent id so a link cannot be removed by pairing its id
  with a different incident/maintenance the caller manages. The AI `removeLink`
  tools carry the parent id too.

  BREAKING CHANGES: `automation.getRun`, `automation.cancelRun`,
  `automation.getRunScopeForReplay`, `incident.removeLink`, and
  `maintenance.removeLink` now require a parent id (`automationId` /
  `incidentId` / `maintenanceId`) in their input. Endpoints previously gated by a
  global rule alone now also accept the owning team's grant; no endpoint became
  more permissive for a user who lacks both the global rule and a relevant team
  grant.

  Not team-scopable, so intentionally left `global: true` (verified by the audit):
  catalog environments, anomaly config, SLO list/streak/milestone reads and
  health-check history/stats (their read rules are public/default), and every
  hand-rolled HTTP route (global admin/infra or already team-aware).

- 8aae4e2: Show the last successful run per check (or per check+environment when fanned
  out) in the system overview.

  Each overview row that is currently degraded or unhealthy now shows when it was
  last healthy (for example "Healthy until 2h ago", or "Never healthy" when it has
  never succeeded), so operators can see at a glance since when a system has been
  degraded or unhealthy without opening the drawer.

  `getSystemHealthOverview` gains a `lastSuccessfulRunAt` field at both the check
  level (most recent healthy run across all of the check's environments) and per
  environment (`perEnvironment[].lastSuccessfulRunAt`). It is computed with a
  dedicated max-per-environment aggregate query OUTSIDE the bounded sparkline
  window, so it stays accurate even when a check has been failing for far longer
  than the last runs shown in the sparkline.

### Patch Changes

- 8aae4e2: Count fanned-out environment slices in the dashboard's "X of Y checks failing".

  The dashboard problem card counted CHECKS, so a system with a single check that
  fans out to three environments showed "Unhealthy 1 of 1 checks failing" even
  when only one of the three environments was failing. It now counts (check ×
  environment) slices: that system reads "1 of 3 checks failing", and a system
  with a three-environment check plus a single-environment check with one
  environment failing reads "1 of 4 checks failing". An env-less check counts as a
  single slice, so a system with no environments reads exactly as before.

  The per-check status DTO (`SystemCheckStatus`, returned by
  `getSystemHealthStatus` / `getBulkSystemHealthStatus` /
  `getBulkSystemHealthMatrix`) gains two fields: `sliceCount` (environment slices
  this check currently fans out to, always >= 1) and `failingSliceCount` (how many
  of those slices are non-healthy). `deriveHealthcheckSignals` sums them across
  checks for the honest numerator/denominator.

- d0eddc9: Cut health-check connection churn and de-cluster the scheduling "thundering
  herd" so per-run durations stop varying wildly for the same check against the
  same target. Grounded in live OpenTelemetry phase histograms: per-run wall time
  was dominated by TCP/TLS connection setup under a self-inflicted burst, not by
  slow targets, CPU, or the database.

  - **In-memory queue now honors `startDelay` in `scheduleRecurring`.** It was
    silently dropped, so every recurring job (health checks included) fired
    immediately on boot and then on a boot-anchored interval grid - keeping all
    equal-interval checks phase-aligned forever. `scheduleRecurring` now defers the
    first execution by `startDelay` and anchors the recurrence to that first fire,
    matching the queue contract and the BullMQ backend's intent. Jobs scheduled
    without `startDelay` are unchanged (first run is immediate).
  - **The BullMQ queue now honors `startDelay` in `scheduleRecurring` too.** It also
    dropped `startDelay`, and its `every` scheduler captures the grid phase from
    whenever `upsertJobScheduler` first runs - so a bootstrap loop scheduling many
    equal-interval jobs at ~the same instant handed them all the same phase.
    `scheduleRecurring` now pins the first fire to `now + startDelay` via the
    scheduler's `startDate`, which shifts the whole recurrence, so the same jittered
    `startDelay` de-clusters checks on the Redis backend identically to the
    in-memory one. Cron schedules (absolute times) are unaffected.
  - **The health-check scheduler jitters each check's first fire** by a small,
    deterministic fraction of its interval (stable across restarts, keyed on the
    check). A synchronized set of checks now spreads across the interval instead of
    hammering their targets at the same instant. Because the queue anchors the
    recurrence to the first fire, this offset persists for every subsequent run.
  - **The HTTP collector refreshes its TCP/TLS connect-timing probe in the
    background, per origin, and never awaits it.** Bun's `fetch` already pools and
    reuses connections across runs (verified: warm reuse survives 20s+ idle gaps),
    but the timing probe opened a fresh handshake on EVERY run - mis-reporting the
    reused request's real latency and doubling the connection count under a burst.
    The probe now refreshes a per-origin sample at most once per TTL (60s) and runs
    fully in the background: it is NEVER on a request's critical path. Pinned to one
    resolved IP, the probe can be far slower than the reused fetch (e.g. an
    intermittent IPv6 SYN retry the real request never pays), and per the collector
    contract best-effort timing must never delay the check - the previous code
    `await`ed it, so a slow probe's refresh run showed up as a latency outlier. The
    `connect`/`tls` phases are now explicitly a cached, per-host estimate.
  - **The run detail UI now labels the estimate.** The timing-breakdown caption
    clarifies that DNS, wait, and transfer are measured on the request, while
    connection and TLS setup are an estimate sampled from a periodic per-host probe
    and cached briefly (about a minute), so an operator does not read the cached
    connect/TLS value as a per-run measurement.

  Behaviour is otherwise unchanged: health status and assertions are the same;
  there are simply far fewer connections, the herd is spread out, and the timing
  breakdown can no longer be inflated by a slow best-effort probe. No configuration
  or API changes.

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0
  - @checkstack/auth-frontend@0.13.0
  - @checkstack/catalog-frontend@0.17.0
  - @checkstack/ui@1.25.1
  - @checkstack/catalog-common@2.6.3
  - @checkstack/anomaly-common@1.7.0
  - @checkstack/dashboard-frontend@0.10.5
  - @checkstack/satellite-common@0.9.3
  - @checkstack/gitops-frontend@0.7.1
  - @checkstack/script-packages-frontend@0.4.10
  - @checkstack/secrets-frontend@0.3.9
  - @checkstack/tips-frontend@0.4.10
  - @checkstack/signal-frontend@0.3.5

## 0.33.0

### Minor Changes

- 390d9cf: Add a **Container** health-check strategy for monitoring Docker and Podman
  containers that expose no external service of their own. It reports container
  existence, running state, healthcheck status, exit code, restart count, and
  OOM-killed via the **Container Status** collector, and CPU/memory usage via the
  **Container Stats** collector. Both collectors issue only read (GET) requests
  against the runtime REST API.

  The check runs wherever the executor runs: locally on the core instance (the
  default) to watch containers that share a host with Checkstack, or on a
  satellite pinned to another host.

  Critically, Checkstack never touches the raw container socket. The strategy
  talks the Docker Engine / Podman libpod API over either a unix socket path or an
  `http(s)` endpoint, so operators point it at a **read-only socket-proxy**
  (`lscr.io/linuxserver/socket-proxy` with `POST=0`) running next to whichever
  Checkstack instance runs the check - core or a satellite - or at a rootless
  Podman socket. The raw socket is mounted only into the proxy; even a compromised
  instance can only read container state, never control the host. A stopped or missing container is a successful collection whose metrics
  feed assertions (following the transport-failure-vs-metric rule) - only an
  unreachable runtime endpoint fails the check. Container `exec` probes are
  intentionally not offered because they would require write access to the socket.

  To support in-product setup guidance, the health-check strategy contract gains
  an optional `setupInstructions` (Markdown) field, surfaced in the DTO and
  rendered as a collapsible "Setup guide" callout above the strategy config fields
  in the editor. The Container strategy populates it with the secure proxy setup.

  The hardened socket-proxy compose is maintained as a single canonical file
  (`deploy/socket-proxy/docker-compose.yml`) that operators `include:` from their
  core or satellite compose, so the read-only / `POST=0` / internal-network
  hardening is defined in exactly one place; the docs and the in-product setup
  guide reference it rather than duplicating the YAML.

  Also removes a stale hand-written `HealthCheckStrategyDto` interface in
  `@checkstack/healthcheck-common` that shadowed (and lagged behind) the
  Zod-inferred DTO; the inferred type from `schemas.ts` is now the single source
  of truth and correctly carries `resultSchema`, `aggregatedResultSchema`, and the
  new `setupInstructions`.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
  that shaped this release.

- 9d30324: Incidents can now optionally override the health status of their affected
  systems. When creating or editing an incident you can pick "Override system
  health" (Degraded or Unhealthy); while the incident is active (not resolved)
  that status is folded into every affected system's derived health via
  worst-wins, so it shows on every health surface (status pages, dashboards,
  dependency map, catalog badges). A health check reporting a worse status still
  wins, and the override lifts automatically when the incident resolves. This
  covers components that no automated check can monitor (e.g. a running app whose
  licenses were revoked so it won't open).

  The override is a deliberate operator choice, independent of the incident's
  severity. A new service-typed incident RPC `getActiveHealthOverrides` exposes
  active overrides per system, which `@checkstack/healthcheck-backend` reads and
  folds into `getSystemHealthStatus`. The system-health response gains an optional
  `override` field naming the contributing incident so UIs can explain why a
  system reads unhealthy when its checks look fine. The system health badge uses
  it to show, on hover, when a status was forced by an incident.

  The dashboard "problem system" signal attributes an override-forced status to
  the incident ("Forced by incident: <title>") instead of misreporting
  "0 of N checks failing", while a genuinely worse health check still drives the
  signal and its detail. Public status pages reflect the forced status but never
  carry the incident title (the widget DTOs project only the status), so an
  override cannot leak the name of a hidden incident.

  Behavior change: a system's derived health now reflects active incident
  overrides in addition to its health checks. Adds a forward-only migration for
  the new nullable `incidents.health_override` column.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
  that shaped this release.

- b218e3e: Migrate every list table to the shared `DataTable`, so columns can now be
  sorted by clicking their headers (name, status, severity, timestamps, counts,
  ...) and tables that had no search gain a global search box. Tables render on
  an opaque `bg-card` surface, fixing the previously transparent, hard-to-read
  tables (e.g. Catalog Management). Existing per-page filters, bulk selection,
  access gating, extension slots, provenance locks, row-click drawers, and
  mobile card layouts are preserved. Incident/maintenance severity and status
  sort by impact rank (most urgent first), not alphabetically. Server-paginated
  tables keep server-side ordering and do not add a misleading page-local search.

  Row action buttons are now standardized on the shared `RowActions`/`RowAction`
  primitive, so every table's edit/delete/etc. look identical (a subtle ghost
  icon button; destructive tinted red, confirmatory tinted green, never a loud
  filled button). Redundant section headings that merely echoed the page title on
  single-table pages (Incidents, Maintenances, SLO Objectives, Installed Plugins,
  Satellite Nodes) were removed. The Infrastructure Settings tab rail gained an
  accessible `Infrastructure settings` navigation label so its tab buttons stay
  distinguishable from the new sortable column-header buttons in each tab's table.

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
- Updated dependencies [b218e3e]
- Updated dependencies [b218e3e]
  - @checkstack/healthcheck-common@1.14.0
  - @checkstack/catalog-frontend@0.16.0
  - @checkstack/auth-frontend@0.12.0
  - @checkstack/gitops-frontend@0.7.0
  - @checkstack/ui@1.25.0
  - @checkstack/dashboard-frontend@0.10.4
  - @checkstack/satellite-common@0.9.2
  - @checkstack/tips-frontend@0.4.9
  - @checkstack/script-packages-frontend@0.4.9
  - @checkstack/secrets-frontend@0.3.8

## 0.32.0

### Minor Changes

- 67b50f5: Health-check overview and run history: group stale checks, resolve environment
  names for old runs, and show absolute run timestamps.

  - The system overview now detects health-check slices that no longer receive
    runs after an environment change - the env-less leftover of a check that has
    since fanned out to environments, a slice for an environment that was removed,
    and the case where all environments are removed - and tucks them into a
    collapsed "Old checks" group. Their history is preserved; they just stop
    cluttering the live list.
  - Environment pills across the overview and the run-history surfaces now resolve
    names from all environments (not only those still assigned to the system), so
    a run for an environment that was later UNASSIGNED shows the environment's
    name instead of its raw id. An environment that was actually DELETED reads as
    "Removed environment" rather than a UUID.
  - The overview environment pill is now a single shared primitive with
    context-independent sizing, so pills render at the same size inside the "Old
    checks" group as in the live list.
  - The "Recent Runs" table now stacks the absolute datetime over the relative
    "x ago" string instead of hiding the datetime behind a hover tooltip, so the
    exact time is readable at a glance.

## 0.31.0

### Minor Changes

- c55d7c6: Make collector assertions analyzable: structured per-assertion outcomes on
  every run, pass/fail counts in every aggregate tier, and dedicated analysis
  surfaces. Previously a passing assertion left no trace and only the first
  failure was recorded as a string.

  - `@checkstack/healthcheck-common` adds the assertion-analytics contract:
    `AssertionOutcomeSchema`, per-bucket `BucketAssertionStats` (stored under
    the platform-owned top-level `assertions` key of `aggregatedResult`), and
    the canonical assertion identity key (`computeAssertionKey` /
    `parseAssertionKey`, a JSON tuple of field/jsonPath/operator/value).
    Editing an assertion starts a new series; identical duplicates collapse.
  - The executor evaluates ALL assertions (no first-failure short-circuit) and
    stores `_assertions` on each collector entry alongside the unchanged
    `_assertionFailed` compatibility string. Pass/fail counts are folded into
    the hourly realtime aggregation, the on-read raw tier, cross-tier bucket
    re-merges, and the daily retention rollup (assertion counts are the only
    `aggregatedResult` content that survives the rollup - they are purely
    additive), so assertion analytics do not silently end at the hourly
    retention horizon.
  - Satellite ingest now evaluates assertions on the core
    (`ingestSatelliteResult`), downgrading a satellite-reported healthy run
    whose assertions fail, and strips ephemeral result fields (e.g. raw HTTP
    bodies) at ingest for parity with local runs. BEHAVIOR CHANGE:
    satellite-executed checks previously never enforced assertions at all;
    they now do, with no satellite upgrade or wire-protocol change. Buffered
    satellite results are evaluated against the configuration current at
    ingest time.
  - The run detail gains an Assertions tab (per-collector groups, pass AND
    fail rows with expected vs actual, a legacy fallback for pre-feature
    runs), and the drawer's auto-chart grid leads each collector group with
    per-assertion pass-rate tiles (sparkline of per-bucket pass rate,
    expandable to a pass/fail StackedTimeline; currently-configured assertions
    appear before any data exists, historical-only series are flagged).

  State & scale: all new state lives in the existing `healthCheckRuns.result`
  and `healthCheckAggregates.aggregated_result` jsonb columns (durable, shared
  Postgres - no new tables, no pod-local state); reads resolve identically on
  every pod; the run-vs-bucket duplication is the platform's existing
  raw-vs-aggregate tiering with the existing single-writer upsert paths.

- c55d7c6: Unify the healthcheck chart system on the `@checkstack/ui` SVG kit and
  redesign the HealthCheck drawer.

  - `@checkstack/ui` gains six chart primitives (each with a Storybook story):
    `StackedTimeline` (stacked status counts per bucket on the colorblind-safe
    status triad), `ChartTooltip` + `useBandHover` (the one shared chart
    tooltip and its cursor hit-testing), `ChartCard` / `chartCardChromeClass`
    (the premium gradient card chrome, flat on low-power devices), `StatTile`
    (number-led metric tile with delta chip, sparkline/ribbon footer, and
    click-to-expand disclosure), `DistributionBar` (stacked horizontal
    distribution + legend, replaces pies), and `CategoryRibbon` (categorical
    history ribbon). `TimeSeriesChart` gains a hover tooltip with a crosshair
    marker.
  - `@checkstack/common` adds four optional chart metadata keys to
    `BaseHealthResultMeta`: `x-chart-priority` (tile sort weight, lower first,
    default 100), `x-chart-good-direction` (`"up" | "down"`, which direction
    of change is an improvement; consumers fall back to
    `x-anomaly-direction`), and `x-chart-true-label` / `x-chart-false-label`
    (prose for a boolean field's values wherever they surface in text, e.g. a
    dominance chip reading "Usually successful (98%)" instead of "Usually
    true"). Built-in collector backends annotate their headline metrics and
    boolean fields accordingly (purely additive metadata).
  - `@checkstack/healthcheck-frontend` rebuilds the drawer: a hero status
    banner (status pill, healthy %, avg latency, interval, last run with the
    exact datetime on hover, full-width status ribbon) replaces the metric
    tiles; the status timeline and latency heroes share the `ChartCard`
    chrome; the auto-generated charts become a prioritized, click-to-expand
    2-up tile grid (collector ids demoted to hover titles); the anomaly
    Expected/Trend derivation is consolidated into one tested module shared by
    the latency hero and the tiles.

  BREAKING CHANGES: `recharts` is removed from `@checkstack/healthcheck-frontend`
  (and the unused dependency from `@checkstack/ui`); the
  `HealthCheckStatusTimeline` and `SparklineTooltip` components are deleted.
  Extensions rendering into `HealthCheckDiagramSlot` should build on the
  `@checkstack/ui` chart primitives instead.

- c55d7c6: Rebuild the health-check run history as a master-detail split view.

  - `@checkstack/ui` gains `SplitPane` (master-detail grid with independently
    scrolling columns; the detail column hides below `md` so callers present
    mobile detail in a `Sheet`) and `VirtualList` (windowed list built on the
    new `@tanstack/react-virtual` dependency), both with Storybook stories.
  - The run-history detail page pins the run detail beside a virtualized run
    list instead of mounting it above the table, so selecting a run never
    scrolls the list away. The selected run stays in the URL (deep links keep
    working), gains prev/next navigation with page fall-through, ArrowUp/Down
    keyboard walking, a loading skeleton, and an explicit "run not found"
    retention message. The raw run payload becomes viewable for the first time
    in a Raw payload tab.
  - The list ends, on its last page, with an explicit "Aggregated before
    <date>" divider followed by the pre-retention aggregate buckets instead of
    an unexplained empty page. The retention config read falls back to the
    platform default for system-owner viewers without configuration access.
  - `HealthCheckRunsTable` turns selection into a prop (`onRowSelect` /
    `selectedRunId`), gains keyboard operability (`role="button"`, Enter/Space,
    focus ring, `aria-current`) and a status-toned selected-row accent; its
    timestamp shows the exact datetime on hover for every viewer. The drawer
    reuses it and opens run details in a nested sheet instead of ejecting to
    the history page; its hand-rolled source filter is replaced by a shared,
    tokenized `SourceFilterPills` (removing the raw orange Tailwind colors).

  BREAKING CHANGES: `HealthCheckRunsTable` no longer navigates on row click by
  itself; callers pass `onRowSelect`. Its row type's `result` field is now
  optional.

### Patch Changes

- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
- Updated dependencies [c55d7c6]
  - @checkstack/healthcheck-common@1.13.0
  - @checkstack/ui@1.24.0
  - @checkstack/common@0.21.0
  - @checkstack/auth-frontend@0.11.3
  - @checkstack/dashboard-frontend@0.10.3
  - @checkstack/satellite-common@0.9.1
  - @checkstack/catalog-frontend@0.15.3
  - @checkstack/gitops-frontend@0.6.8
  - @checkstack/script-packages-frontend@0.4.8
  - @checkstack/secrets-frontend@0.3.7
  - @checkstack/tips-frontend@0.4.8
  - @checkstack/anomaly-common@1.6.2
  - @checkstack/catalog-common@2.6.2
  - @checkstack/frontend-api@0.13.2
  - @checkstack/signal-frontend@0.3.4

## 0.30.0

### Minor Changes

- faf98f5: Security: config secrets (health-check strategy/collector credentials such as
  SSH passwords, DB credentials, HTTP auth, and integration connection
  credentials) ride ONE shared, domain-agnostic extraction channel instead of
  being stored as plaintext or re-implemented per plugin.

  New primitive and shared service:

  - `configSecret({ id })` (in `@checkstack/backend-api`) declares an
    extraction-channel secret keyed by a STABLE `id`, independent of field name or
    position, so renaming or reordering a field never orphans its value. Use it
    (not `configString({ "x-secret": true })`) for any credential whose config is
    relayed to a satellite, projected to AI, or diffed by GitOps. `validateSecretIds`
    rejects, at plugin registration, an `x-secret` field with no `id`, a duplicate
    `id`, or a secret nested in an un-keyable container (array / record / tuple /
    map) - so a mis-keyable schema fails boot rather than at run time.
  - `ConfigSecretChannel` (in `@checkstack/secrets-backend`) is the single
    extract / inflate / collect / redact / merge / delete / prune implementation.
    Health-checks and integration connections both BIND it to their own scope
    (marker prefix + internal-secret key layout); neither re-implements the walk.

  Lifecycle (both bindings):

  - **Write**: an inline value is extracted into the encrypted internal secret
    store; the stored config keeps only an opaque marker. `${{ secrets.NAME }}`
    references are stored verbatim and resolve through the active backend (local
    or Vault) at run time.
  - **Read**: configuration and connection reads strip `x-secret` values and
    internal markers while keeping `${{ secrets.NAME }}` references visible; the
    AI `getConfigurations` tool and create/update responses are redacted too. A
    value never reaches a browser or an AI model context.
  - **Run**: the core executor inflates markers/references in memory just before
    the client is built. Satellites receive markers only and fetch values
    just-in-time over the authenticated WS channel, per run, never persisted, then
    fail CLOSED if any marker/reference survives resolution.
  - **No orphan**: clearing a secret, removing a field/collector, swapping an
    inline value for a reference, updating a connection, or deleting a
    configuration/connection deletes the now-unreferenced internal secret. Cleanup
    is schema-free (scans markers by prefix) and best-effort on delete, so it works
    even when the owning plugin is uninstalled and never blocks a delete.
  - **Forged-marker safe**: extract/inflate key each internal secret by the
    SCHEMA leaf's stable `id`, never by an id parsed out of a stored marker string,
    so a crafted marker can never resolve or delete another scope's secret.

  Health-checks additionally get an idempotent, advisory-locked backfill that
  moves pre-existing plaintext values into the internal store, and per-config-id
  locking so concurrent writers across pods can never leave a dangling marker.
  Integration connection credentials keep their released `__connref__:` marker
  prefix and key layout (id equals the flat field name), so existing stored
  connections are byte-compatible.

  BREAKING CHANGES:

  - Configuration and connection reads no longer include `x-secret` field values
    (clients must treat blank-on-save as keep-existing; the bundled editors
    already do).
  - Satellites must be upgraded together with the core: an old satellite cannot
    resolve the markers a new core stores, so its credentialed checks fail until
    upgraded.

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/healthcheck-common@1.12.0
  - @checkstack/satellite-common@0.9.0
  - @checkstack/ui@1.23.0
  - @checkstack/secrets-frontend@0.3.6
  - @checkstack/anomaly-common@1.6.1
  - @checkstack/auth-frontend@0.11.2
  - @checkstack/catalog-common@2.6.1
  - @checkstack/catalog-frontend@0.15.2
  - @checkstack/dashboard-frontend@0.10.2
  - @checkstack/frontend-api@0.13.1
  - @checkstack/gitops-frontend@0.6.7
  - @checkstack/script-packages-frontend@0.4.7
  - @checkstack/tips-frontend@0.4.7
  - @checkstack/signal-frontend@0.3.3

## 0.29.0

### Minor Changes

- e819276: Fix JSONPath collector assertions: the executor previously evaluated every
  assertion with a flat field lookup, so a `Body (JSONPath)` assertion compared
  against `undefined` and the configured path was silently ignored (`Exists`
  always failed, `Not Exists` always passed). The executor now parses the source
  field as JSON and extracts the configured path via `jsonpath-plus` (with
  expression evaluation disabled - filter/script expressions are rejected).
  Fail-closed: a non-JSON body, missing expression, or invalid path fails the
  assertion with a diagnostic, never the collection.

  Also adds `isEmpty` / `isNotEmpty` to the JSONPath operator set (and the
  AssertionBuilder), treating `[]`, `{}`, `""`, and missing values as empty - so
  "no errors reported" is a single `$.errors Is Empty` assertion, and "key exists
  but is empty" is `Exists` + `Is Empty` on the same path.

## 0.28.0

### Minor Changes

- 0cac684: Align the health-check run-history gates end to end. The history surfaces had a
  three-way drift: the route allowed `configuration.read`, the page required
  manage capability, and the procedures required the standalone
  `healthcheck.details` rule - so global read-rule holders reached a page that
  denied them, and team-scoped managers passed the page gate but got 403s from
  every data call.

  Detailed run history is now a MANAGER surface everywhere, with system owners
  included: access requires global `configuration.manage`, a team manage grant
  on the CONFIGURATION, or manage access to the SYSTEM - a system's owning team
  sees every run of that system, whoever owns the configuration.

  - Routes, pages, drawer links, and the anomaly/health signals gate on the
    manage capability (with `catalog.system` as the parent type); the drawer and
    chart hook check the caller's grant on the specific configuration OR system.
  - All three history procedures (`getDetailedHistory`,
    `getDetailedAggregatedHistory`, `getRunById`) are authorized in the handler
    via a shared fail-closed module (`history-access.ts`) - the triple-OR is not
    expressible with the declarative instanceAccess modes. `getRunById`
    authorizes against the fetched run's own configuration/system, and answers
    `undefined` for unauthorized callers so run ids don't leak existence.
  - The feed (`getDetailedHistory`) scopes team callers to runs of their
    configurations UNION runs of their systems, with correct pagination totals.

  BREAKING CHANGES:

  - The standalone `healthcheck.details` access rule is REMOVED. Roles that held
    `details` without `configuration.manage` lose access to detailed run data;
    grant them the manage rule (or a team grant on the configuration/system)
    instead. Stale role rows referencing the removed rule are inert.
  - `getDetailedAggregatedHistory` is `authenticated` (was `public`); anonymous
    callers could never pass its access rule anyway.

### Patch Changes

- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
- Updated dependencies [0cac684]
  - @checkstack/auth-frontend@0.11.1
  - @checkstack/healthcheck-common@1.11.0
  - @checkstack/catalog-frontend@0.15.1
  - @checkstack/tips-frontend@0.4.6
  - @checkstack/gitops-frontend@0.6.6
  - @checkstack/dashboard-frontend@0.10.1
  - @checkstack/satellite-common@0.8.14
  - @checkstack/script-packages-frontend@0.4.6

## 0.27.0

### Minor Changes

- 52c55bf: Anomaly baselines are now per-environment, so the env-scoped
  `HealthCheckDrawer` shows the clicked env's baseline (not a cross-env
  one). Closes the follow-up noted in `healthcheck-per-env-rollup`.

  ## What changed

  - **`anomaly_baselines`** now carries a nullable `environment_id`
    column, and its unique constraint grew to
    `(systemId, configurationId, environmentId, fieldPath)` with
    `NULLS NOT DISTINCT` — so there is exactly one baseline per
    `(system, config, env, path)` tuple, and the env-less slice (`NULL`)
    stays a single row (the pre-feature cross-env baseline, preserved as
    the env-less row until the next analyzer tick rewrites per-env rows).
    Existing rows backfill to `environment_id = NULL` with no data work.
  - **Baseline analyzer** (`jobs/baseline-analyzer.ts`) now fans out per
    environment within each assignment: runs are grouped by
    `environmentId` (null = env-less), stats are computed per env, and
    the upsert targets the 4-tuple. The cache key gained an env segment
    (`baseline:${config}:${system}:${env ?? "<none>"}:${path}`) and the
    `ANOMALY_BASELINE_UPDATED` signal payload now carries `environmentId`.
    Previously the analyzer computed one cross-env batch per assignment.
  - **Inline detector** (`detector.ts`) resolves the per-env baseline:
    the lookup matches `environmentId` when present or `IS NULL` for the
    env-less slice, and the cache key matches the analyzer's env segment.
    `environmentId` is threaded from the `checkCompleted` hook (see
    below); it defaults to `null` (env-less) so a caller that omits it
    resolves the env-less baseline rather than failing.
  - **`getAnomalyBaselines` RPC** now accepts an optional
    `environmentId: string | null` filter and surfaces `environmentId` on
    every `AnomalyBaselineDto`. Tristate semantics, mirroring
    `getHistory`: `undefined` → all envs (no predicate), `null` → env-less
    slice (`IS NULL`), a string → that env. The service predicate is at
    the DB layer.
  - **`HealthCheckDrawer`** threads `item.environmentId` (already on its
    props) into the baselines query, so the drawer's anomaly overlay
    resolves server-side to the clicked env's baseline only — matching the
    env-scoping already applied to its history table and charts. The
    latency chart tolerates the new field (it picks the single
    `"latencyMs"` baseline, which the env filter guarantees is unique).
  - **`getRunsForAnalysis`** (healthcheck) now returns `environmentId`
    on each run so the analyzer can group by env. Additive optional
    field; only the analyzer consumes it.
  - **`checkCompleted` / `checkFailed` hooks** (healthcheck) now carry
    `environmentId: string | null` on their payloads, sourced from the
    per-env execution loop. Only the anomaly detector subscribes to
    `checkCompleted` (it was updated); the failure-path emit (rollup
    error) passes `null`.

  ## Notes

  - Anomaly _rows_ (`anomalies` table) remain cross-env by design in this
    step — only baselines are env-scoped, matching the scoped task. A
    detector run for env A and env B's normal value still share one
    `(system, config, path)` anomaly row; env-scoping the anomalies table
    is tracked as a separate follow-up so this change stays focused on
    the drawer's baseline overlay.
  - The `checkCompleted` / `checkFailed` payload change is technically
    breaking for hook subscribers that destructure the payload, but the
    only in-tree subscriber (the anomaly plugin) was updated in lockstep.
    External webhook subscribers receive an additional field and are not
    affected unless they reject unknown keys (uncommon).
  - Migration `0006_sad_retro_girl.sql` drops + recreates the unique
    constraint with `NULLS NOT DISTINCT` and adds the column. It applies
    cleanly to fresh and already-populated DBs (existing NULL-env rows
    remain unique under the new key).

- b45be8e: Add a filter input to the "Available" section of the system ↔ healthcheck
  assignment editor.

  The assignment IDE tree's "Available" list now has a search box that filters
  assignable health checks by name or strategy-id tail (case-insensitive), with
  an empty-state message when the filter yields no matches. The one-click-to-assign
  interaction is unchanged.

- d9f4654: Fix team-scoped health-check management being invisible. Health-check
  configuration team grants are keyed on `healthcheck.healthcheck` (the RPC
  middleware derives the grant key from the configuration access rule's
  `resource`, and that rule is `accessPair("healthcheck", ...)`), but the frontend
  capability gate, the route `manageCapability`, and the Teams grant-name resolver
  all declared `healthcheck.configuration`. Because the two never matched, a user
  who could manage a health check via a team grant (without the global manage
  rule) saw none of the health-check management surfaces, and health-check grant
  names did not resolve in the Teams admin UI.

  `healthCheckResourceTypes.configuration` now resolves to `healthcheck.healthcheck`
  (with a regression test pinning it to the middleware's grant key), the resolver
  registers under the same type, and the create/edit/assignments routes gain the
  `manageCapability` they were missing so team-scoped health-check managers (and,
  for create/assign, system managers) can reach them. This is a non-breaking fix:
  no stored access-rule id or grant key changes.

- 3420d24: Show a "No environment configured" empty-state in the health-check assignment IDE's Execution tab when the current system belongs to no environment. Previously the panel still rendered the All/Specific/None fan-out selector even though those modes are meaningless without any environment, and only surfaced a small inline note while in Specific mode. The Environments subsection now collapses to a clear empty-state prompting you to attach environments to the system in the catalog, while local/satellite execution config stays usable.
- dea02f0: Add search, filters, and name sorting to the Health Checks overview.

  The "Health Checks" config page now ships a toolbar with a name search, a
  strategy filter, an active/paused status filter, and a "show all assigned to
  system X" filter. Results are sorted by name (case-insensitive). Filter state
  is held in URL params (shareable links) and debounced for smooth typing.

  Because a health-check configuration carries no system field of its own (the
  assignment is a separate entity), the system filter resolves the assigned
  config id set for the selected system via `getSystemConfigurations` and
  intersects it with the loaded configurations.

- 21e0d88: Paused health-check configurations no longer contribute to their systems'
  health aggregate, pausing one now closes any open SLO downtime event it was
  keeping open, and the system overview's "Health Checks" list renders a
  "Paused" pill for paused checks instead of their stale run-evaluated status.

  Previously, pausing a configuration only skipped execution — its stale
  failing runs inside the evaluation window kept the system's rollup status
  `degraded`/`unhealthy`, which in turn kept any open SLO downtime event open
  until those runs aged out, and the system overview list still showed the
  paused check as "Unhealthy". Now:

  - `getSystemHealthStatus` excludes paused configurations from the worst-
    wins aggregate, so a system whose only failing check is paused reads
    healthy (and paused checks no longer drive the system's red badge).
  - The `pauseConfiguration` RPC recomputes the rollup `health` entity for
    every system the config is enabled-assigned to. If the recomputed
    aggregate transitions degraded → healthy, the existing `HEALTH_ENTITY_KIND`
    "recovered" edge fires and the SLO engine closes the open downtime event
    at the pause time. If the system stays degraded (other failing checks),
    the event correctly stays open.
  - `resumeConfiguration` intentionally does NOT recompute. The next actual
    run drives any degraded transition: if the check still fails, a fresh
    downtime event opens (the previous one was closed on pause, so the
    `handleSystemDown` idempotent guard doesn't suppress it); if it now
    passes, no event opens. This avoids fabricating a downtime from stale
    last-known state when the underlying condition may have been fixed
    during the pause.
  - `getSystemHealthOverview` now returns a `paused` boolean per check. The
    system overview's "Health Checks" list renders a "Paused" pill (unknown
    tone) for paused checks instead of the run-evaluated status, while still
    showing the pre-pause sparkline for context. Paused checks only appear
    under the "All" filter tab, not "Failing" or "Healthy".

- 52c55bf: Per-environment health semantics: rollup no longer masks sibling outages,
  and notifications + automation windows are env-scoped.

  ## The bug

  When a `(system, configuration)` assignment fanned out to multiple
  environments and only some of them failed, the system rollup could
  read **healthy** (masking a permanently-failing env), or **flap**
  healthy↔degraded/unhealthy tick-by-tick whenever env insertion order
  drifted, because the rollup derivation flattened every env's runs into
  one `timestamp DESC` list and handed the interleaved list to the
  threshold evaluator. The default `consecutive` mode walks newest-first
  and breaks the streak on the first interleaving env, so the rollup
  collapsed to whichever single env's status the most recent run landed
  on. Each flap fired an escalation/recovery notification + a
  `system_health_changed` trigger event.

  ## What changed

  - **`getSystemHealthStatus(systemId)` rollup** now groups the latest
    run window by `environmentId`, evaluates the threshold window PER
    ENVIRONMENT, and takes worst-wins across envs within each association
    (unhealthy > degraded > healthy) before worst-wins across associations.
    This is stable regardless of env insertion order or multi-pod racing.
    For a single-env (or env-less-only) assignment this reduces to the
    pre-existing flat-window behavior. Per-env and env-less slices
    (`environmentId: string` / `null`) are unchanged.
  - **`getSystemHealthOverview`** now groups runs per `(configurationId,
environmentId)`, evaluates each env's slice on its own monotonic run
    window, and worst-wins across envs — mirroring `getSystemHealthStatus`.
    The response carries `environmentId` on every `recentRuns[]` entry,
    and adds `perEnvironment[]` per check (one entry per env with its own
    `status` and env-scoped `recentRuns`) so a frontend can render one
    row per `(check, environment)` pair, surfacing per-env outages the
    rollup intentionally hides in the aggregate view. The top-level
    `recentRuns[]` and `status` keep their pre-existing shape for
    backwards compatibility (single-env checks are unchanged).
  - **`HealthCheckSystemOverview`** (frontend) now flattens multi-env
    assignments into one row per `(check, environment)` — each row carries
    the check name, an env pill (resolved via the same
    `getSystemEnvironments` query the drawer already uses), the per-env
    status, sparkline, and last-run. With the "Failing"/"Healthy" filter
    now scoped per env, a permanently-failing environment surfaces as its
    own failing row beside its healthy sibling, instead of being masked by
    the rollup's worst-wins / latest-wins. Single-env and env-less
    assignments render the historical single row (no env pill). Clicking
    any env row opens the check-level drawer, scoped to that env via the
    server-side env filter on the queries below — the drawer's run
    history table, charts, and tiles all see only the (check, environment)
    pair the operator clicked, never a mixed-env pool.
  - **`getHistory`, `getDetailedHistory`, `getRunStats`,
    `getAggregatedHistory`, and `getDetailedAggregatedHistory`** now accept
    an optional `environmentId: string | null` input that filters
    server-side at the DB layer (`environment_id = $X` for an env, `IS
NULL` for the env-less slice, no predicate when omitted). The drawer's
    charts and Recent Runs table pass the clicked row's `environmentId`
    so the pagination, totals, and buckets reflect only that env — a
    client-side filter would double-paginate and miscount totals; the
    filter is at the DB so the data is honest end-to-end. The aggregated
    history applies the env filter to all three tiers the cross-tier
    aggregation engine reads (raw `health_check_runs` + hourly and daily
    `health_check_aggregates`), since both tables are env-keyed. Single-env
    and env-less rows omit the filter, so historical callers are
    unchanged.
  - **Anomaly baselines are NOT yet env-scoped** — `anomaly_baselines` is
    keyed on `(systemId, configurationId, fieldPath)` with no
    `environmentId` column, and the detector computes a single baseline
    across all envs of an assignment. Scoping the drawer's anomaly overlay
    per env needs a schema migration + a per-env detector rewrite, and is
    tracked as a follow-up. The drawer continues to show the cross-env
    baseline next to the (now env-scoped) history + charts.
  - **`system_health_changed` / `system_degraded` / `system_healthy`
    triggers** now partition by `(systemId, environmentId)` instead of
    the bare `systemId` when the trigger fires from a per-env change.
    Two failing environments of one system now fire two distinct events
    with independent flapping/dwell/dedup windows — operators can author
    per-env automations and get per-env notifications. A bare rollup
    transition (`environmentId` absent) partitions on `systemId` alone,
    so existing recipes that read only `payload.systemId` keep working.
  - **`notifyStateChange`** now accepts `environmentId` +
    `environmentName`. Per-env notifications get an env-qualified title
    (`"System health critical (prod): ..."`) and body, and an
    env-qualified collapse key (`systemHealthCollapseKey(systemId, envId)`)
    so two failing envs render as two independent cards instead of
    merging into one. Suppression checks (maintenance/incident) remain
    system-scoped.

  ## Notes

  - Each failing env now fires its own `system_health_changed` event with
    its own partition — this is the documented migration away from the
    bug-report flapping cadence into a per-env flap cadence. Operators
    with existing `window:` / `dwell:` recipes on `system_health_changed`
    may see different refire cadence per env (one flapping env no longer
    drowns out its steady sibling). To opt back into the pooled
    historical behavior, an automation recipe can override its own
    `partitionBy: (p) => p.systemId`.
  - `SYSTEM_STATUS_CHANGED` remains rollup-only (one broadcast per tick
    on the rollup status transition): it drives low-noise cache
    invalidation for `SystemHealthBadge` and `DependencyBadge`, and the
    per-env trigger events above already cover per-env automation needs.

- 935d34e: Fix team-scoped access to health-check management and remove redundant create toggles.

  - **Health Checks page no longer denies team-scoped users.** The management page gated its body on the GLOBAL `configuration.read` rule (`useAccess`), so a user with only a team grant (a create-capability grant, or a per-config team grant) saw "Access Denied" even though the route guard let them in and the "Create Check" button rendered. The page now resolves the same capability the route uses (`useCanAccessType`), so page and route agree.
  - **Health-check history pages reachable by team-scoped managers.** The run-history list and detail/run pages gated their body on the GLOBAL `configuration.manage` rule and their routes carried no `manageCapability`, so a team member who manages a health check via a team grant (no global rule) could not review its run history. The history routes now declare `manageCapability` and the pages resolve the manage capability via `useCanAccessType`.
  - **Parent-gated creates are no longer offered as "Resource creation" toggles.** `getResourceKinds` marked a type create-capable whenever any procedure declared `instanceAccess.create`, including parent-gated creates (incident/maintenance "for a system"). Those are authorized via MANAGE on the parent, so a per-type toggle was redundant and misleading. The derivation now excludes a create that carries a `parent` gate; a type with both a parent-less and a parent-gated create is still enumerated.

  No schema or migration change. Backend create authorization is unchanged - only the Teams UI enumeration and the frontend page gate.

- 0d912a3: Make the frontend fully RLAC-aware so team-scoped users see and can use exactly
  what the backend already authorises - no more, no less. Previously every nav
  entry, route, management page, create button, per-row action, and resource
  picker gated purely on a user's GLOBAL access rule, so a user whose team manages
  a system saw none of the surfaces the backend would happily let them use, and
  (where a page did render) could select systems they don't manage and only fail
  after submit.

  Platform primitives (on `AccessApi`, from `@checkstack/frontend-api`, implemented
  in `@checkstack/auth-frontend`). Each ORs the global RBAC rule with team-derived
  (ReBAC) grants, so a global-rule holder always sees everything:

  - `useCanCreate({ accessRule, objectType, parentType? })` - may the user create
    this type (global rule, a team `creator` grant, or managing a parent resource).
  - `useCanAccessType({ accessRule, objectType, parentType? })` - may the user
    reach a management SURFACE for this type at all (create capability OR managing
    any existing object of the type / its parent). Powers route guards, sidebar
    entries, and a management page's top-level `allowed`.
  - `useResourceAccess({ accessRule, objectType, resourceIds })` - a `canAccess(id)`
    predicate for per-row controls and for filtering resource pickers.

  Backed by three authenticated `auth` RPC procedures - `canCreate`,
  `myManageableTypes`, and `listMyAccessibleResources` - the frontend-facing
  mirrors of the existing S2S authorization endpoints, resolved against the
  caller's own team grants.

  Route/nav gating is now capability-aware: a route may declare
  `manageCapability: { objectType, parentType? }`; the route guard and sidebar then
  show/allow it for team-scoped users via `myManageableTypes`. Applied to the
  catalog, incident, maintenance, SLO, healthcheck, automation, and status-page
  management routes. The route guard resolves this through a single
  `useRouteAccess` hook with a constant hook count, since the guard is reconciled
  in place as the URL changes (a conditional hook there would trip the rules of
  hooks).

  Resource types are now typed, plugin-qualified constants. A new
  `resourceType(pluginMetadata, localType)` factory in `@checkstack/common` mints a
  nominal `ResourceType`, and each `*-common` package exports its constants (e.g.
  `catalogResourceTypes.system`, `incidentResourceTypes.incident`). The capability
  APIs accept `ResourceType`, so a mistyped `"catalog.system"` string now fails
  typecheck instead of silently breaking a gate.

  Resource pickers now offer only what the backend will accept:

  - Incident and maintenance "Affected Systems" pickers show only systems the user
    manages (or all with the global rule), matching the backend's requirement of
    MANAGE on every referenced system.
  - SLO creation is now system-scoped end to end: `createObjective` gains a
    `catalog.system` parent gate (managing the target system authorises creating an
    SLO for it, like incident/maintenance), and the SLO editor's system picker is
    filtered to manageable systems.
  - Catalog group and environment membership (add-to-group / add-to-environment,
    per-row and bulk) is gated on managing the system being (re)assigned.
  - The health-check assignment surface (Assignment IDE + the system-detail
    "Health Checks" action) requires MANAGE on the target system.

  Catalog membership chips only render a removable "x" for systems the user
  manages (removing a group/environment membership requires managing the system),
  and the Dependency Map only lets a user originate an edge from a system they
  manage (the source is access-checked; the target is not).

  Owning-team correctness: a parent-gated creator (team member, no global rule)
  who left the owning team unset previously created an object with no team grant -
  which they then could not edit. The `authorizeCreate` parent-gate path now
  resolves an owning team instead of silently orphaning the object (auto-assigns
  when the caller belongs to exactly one team, requires an explicit choice when
  several), and the `TeamOwnershipPicker` marks the field required and
  auto-selects the sole eligible team.

  Dependency writes are fixed to authorize on the SOURCE system. `createDependency`
  / `updateDependency` / `deleteDependency` previously used `instanceAccess:
{ idParam: "systemId" }`, which made the middleware look for a `dependency` grant
  keyed by the system id - a grant that never exists - so every team-scoped source
  manager was denied ("Access denied to resource dependency:<systemId>"). They now
  `parentScope` on `catalog.system` manage, so managing the source system
  authorises editing its dependencies (the target is not access-checked), matching
  health-check assignment.

  The backend authorization changes are limited to: the new read-only capability
  procedures (`canCreate` / `myManageableTypes` / `listMyAccessibleResources`), the
  SLO create parent gate, the `authorizeCreate` owning-team resolution, and the
  dependency source-scope fix. Everything else only aligns the UI with
  authorization the backend already enforced.

### Patch Changes

- Updated dependencies [0d912a3]
- Updated dependencies [52c55bf]
- Updated dependencies [5236e41]
- Updated dependencies [0d912a3]
- Updated dependencies [d9f4654]
- Updated dependencies [d1b71b6]
- Updated dependencies [0d912a3]
- Updated dependencies [a07b375]
- Updated dependencies [d9f4654]
- Updated dependencies [d9f4654]
- Updated dependencies [21e0d88]
- Updated dependencies [52c55bf]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [d2d49cf]
- Updated dependencies [0d912a3]
- Updated dependencies [692fa18]
  - @checkstack/auth-frontend@0.11.0
  - @checkstack/anomaly-common@1.6.0
  - @checkstack/healthcheck-common@1.10.0
  - @checkstack/catalog-frontend@0.15.0
  - @checkstack/ui@1.22.0
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0
  - @checkstack/dashboard-frontend@0.10.0
  - @checkstack/catalog-common@2.6.0
  - @checkstack/tips-frontend@0.4.5
  - @checkstack/satellite-common@0.8.13
  - @checkstack/gitops-frontend@0.6.5
  - @checkstack/script-packages-frontend@0.4.5
  - @checkstack/secrets-frontend@0.3.5
  - @checkstack/signal-frontend@0.3.2

## 0.26.1

### Patch Changes

- Updated dependencies [baf9b6e]
  - @checkstack/ui@1.21.0
  - @checkstack/auth-frontend@0.10.2
  - @checkstack/catalog-frontend@0.14.1
  - @checkstack/dashboard-frontend@0.9.4
  - @checkstack/gitops-frontend@0.6.4
  - @checkstack/script-packages-frontend@0.4.4
  - @checkstack/secrets-frontend@0.3.4
  - @checkstack/tips-frontend@0.4.4

## 0.26.0

### Minor Changes

- defb97b: feat(frontend): guided "create your first check" wizard and onboarding nudges

  Add a `FirstCheckWizard`, reachable both from the Health Checks empty state and
  an always-available "Quick start" header button: the user picks a system (a new
  one or an existing one), pastes a URL, and the wizard creates the HTTP health
  check and the assignment (started immediately) in one guided flow, built on the
  new `@checkstack/ui` Stepper. This makes guided setup usable when onboarding into
  an instance that already has systems and checks, not only on first run.

  Also add two in-product nudges: an inline "one system, many environments" hint
  on the Create System form (so new users stop cloning a system per stage), and a
  clear "what an assignment is and why a check needs one" explainer on the
  assignment screen's empty state.

### Patch Changes

- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
- Updated dependencies [defb97b]
  - @checkstack/catalog-common@2.5.0
  - @checkstack/common@0.18.0
  - @checkstack/catalog-frontend@0.14.0
  - @checkstack/healthcheck-common@1.9.0
  - @checkstack/ui@1.20.0
  - @checkstack/anomaly-common@1.5.4
  - @checkstack/auth-frontend@0.10.1
  - @checkstack/dashboard-frontend@0.9.3
  - @checkstack/frontend-api@0.12.1
  - @checkstack/gitops-frontend@0.6.3
  - @checkstack/satellite-common@0.8.12
  - @checkstack/script-packages-frontend@0.4.3
  - @checkstack/secrets-frontend@0.3.3
  - @checkstack/tips-frontend@0.4.3
  - @checkstack/signal-frontend@0.3.1

## 0.25.2

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
- Updated dependencies [2e20792]
  - @checkstack/frontend-api@0.12.0
  - @checkstack/ui@1.19.0
  - @checkstack/auth-frontend@0.10.0
  - @checkstack/signal-frontend@0.3.0
  - @checkstack/anomaly-common@1.5.3
  - @checkstack/catalog-common@2.4.3
  - @checkstack/catalog-frontend@0.13.2
  - @checkstack/dashboard-frontend@0.9.2
  - @checkstack/gitops-frontend@0.6.2
  - @checkstack/healthcheck-common@1.8.1
  - @checkstack/satellite-common@0.8.11
  - @checkstack/script-packages-frontend@0.4.2
  - @checkstack/secrets-frontend@0.3.2
  - @checkstack/tips-frontend@0.4.2
  - @checkstack/common@0.17.0

## 0.25.1

### Patch Changes

- Updated dependencies [748dc50]
  - @checkstack/ui@1.18.0
  - @checkstack/auth-frontend@0.9.1
  - @checkstack/catalog-frontend@0.13.1
  - @checkstack/dashboard-frontend@0.9.1
  - @checkstack/gitops-frontend@0.6.1
  - @checkstack/script-packages-frontend@0.4.1
  - @checkstack/secrets-frontend@0.3.1
  - @checkstack/tips-frontend@0.4.1

## 0.25.0

### Minor Changes

- 8cad340: Design-system rework: a premium, consistent UI language across the platform.

  Foundation (`@checkstack/ui` + the shared Tailwind preset):

  - A token system wired into the shared preset so it generates app-wide: a
    surface elevation ramp (`surface` / `surface-2` / `surface-inset`), the
    aurora gradient stops, a colorblind-safe `status` triad, and `grid-line`.
  - A density model (`comfortable` / `compact`) via `--d-*` vars + `DensityProvider`
    / `useDensity`, with a user-menu density toggle, plus the polished
    skeleton / empty / error state set.
  - Honest, token-driven chart primitives (`TimeSeriesChart`, `Sparkline`,
    `RadialGauge` / aurora hero, `RequestWaterfall`, `UptimeRibbon`).
  - A signature aurora moment per page: `PageHeader` paints its icon strokes with
    the aurora gradient and adds a hairline; `Card` gains soft layered depth.

  Shell + surfaces:

  - The app shell adopts the elevation ramp (header `surface-2`, sidebar
    `surface`, content on the ambient base).
  - The system-health dashboard, health-check latency / single-run views, and the
    SLO dashboard are reskinned onto the primitives (aurora confidence gauge,
    honest p50/p95 latency, request waterfall, number-led status cards).

  App-wide adoption + premium rework:

  - Every plugin frontend adopts the tokens, status triad, density, and elevation.
  - The highest-impact surfaces in each plugin are then redesigned to a premium
    bar: real depth, number-led hierarchy, multi-encoded status (pill + dot +
    accent stripe), and refined list/table density. Several plugins extract pure
    tone/label/format logic into unit-tested modules.

  Alerts:

  - Every alert/callout is unified onto a single premium `Alert` (depth surface +
    status-accent stripe + toned icon chip, variant-driven).

  BREAKING CHANGE: the duplicate `InfoBanner` component (and its sub-components)
  is removed; use `Alert` instead - it is a drop-in replacement with the same
  variants and composable parts.

- 8cad340: Add a finer per-run transport timing breakdown to health checks.

  Each run now records an optional structured `metadata.timings` (DNS, connect,
  TLS, wait/time-to-first-byte, transfer, and a `processing` catch-all for
  non-HTTP operation time). The run-detail view renders the phases it has, in
  transport order, and falls back to the previous Connection + Processing split
  for older runs that lack the finer data.

  For HTTP the request is issued verbatim through `fetch` (original URL, headers,
  and body), so request behavior is identical to a plain `fetch`. The timing is
  measured around it: `fetch` resolves at the response headers, so wait
  (time-to-first-byte) and transfer (body) are measured exactly on the request,
  DNS is timed at the resolve step, and connect/TLS come from a short-lived,
  best-effort raw `net`/`tls` probe to the same already-validated IP (the request
  socket exposes no connect/handshake events on the Bun runtime). The probe is
  timing-only and never fails the check. The probe validates the TLS certificate
  (against the original hostname via SNI) like the real request does - it does not
  disable certificate validation; an unverifiable cert simply yields no TLS-phase
  timing rather than aborting. Other transports surface the connect and operation
  times they already measure.

  The SSRF guard now validates the resolved host (rejecting cloud-metadata /
  link-local and operator-denied ranges) as a pre-flight check and no longer pins
  the request to the resolved IP. Pinning rewrote the URL to the IP literal and
  moved the host to the `Host` header, which breaks HTTP/2 origins (their
  authority comes from the URL's `:authority`, not `Host`) - that is why real
  hosts such as `google.com` started answering 404/429 instead of 200. The
  pre-flight validation keeps blocking static metadata/link-local targets and
  direct denied IP literals; the only thing dropped is DNS-rebind TOCTOU
  protection (a narrow window that pinning closed at the cost of breaking
  legitimate HTTP/2 requests).

  The run-detail "slowest" badge no longer collides with the timing bar, and a
  genuinely sub-millisecond phase reads as "<1 ms" instead of a bare "0 ms".

- 8cad340: Add point-of-use coaching across the feature config pages and onboarding.

  - The deep-link registry (`@checkstack/common`'s `APP_DOC_SLUGS`) now exposes
    the core-concept docs pages (systems and groups, health checks, SLOs,
    incidents). Each is verified against the real docs content by the existing
    `docs-links.test.ts` rename guard.
  - The catalog, health-check, SLO and incident config pages now carry a
    one-time, dismissable `TipBanner` with a concise orientation sentence and an
    inline "Learn more" deep-link to the matching concept page, so first-time
    visitors get oriented and returning users keep a persistent header
    subtitle plus a replayable banner. The same "Learn more" link is also added
    inside each page's existing concept `<Tip>` popover (catalog has no `<Tip>`,
    so it gains only the banner).
  - The first-run onboarding form now shows a LIVE per-criterion password
    checklist that ticks green as you type, replacing the static rules text and
    the submit-only destructive error list. The criteria live in
    `@checkstack/auth-common` (`PASSWORD_CRITERIA` / `evaluatePasswordCriteria`),
    kept in lock-step with `passwordSchema` and covered by a unit test.
  - The AI chat empty state now leads with orientation-style example prompts
    ("Explain SLOs and how they relate to health checks", "How do I add a system
    to the catalog?") alongside the existing task prompts; clicking one seeds the
    composer for editing. The prompts only appear when an AI integration is
    configured.

- 8cad340: Make data-dense tables mobile-friendly and align status colors with semantic tokens.

  - Migrated the remaining data-dense tables to the `ResponsiveTable` + `MobileCardList` dual-layout: catalog (Systems/Groups/Environments), incident config, maintenance config + system history, announcement management, notification delivery attempts, plugin manager (installed plugins + events), satellite list, automation list, healthcheck runs, OAuth applications, and the queue runtime panel. On viewports below `sm` these now render stacked cards surfacing the high-priority fields instead of an overflowing table. Genuinely narrow or runtime-diagnostic panels (cache runtime, healthcheck history, anomaly mute list) were intentionally left as plain tables.
  - Swapped hardcoded semantic status colors for design tokens (`text-warning`, `text-success`, `text-destructive`, `text-muted-foreground`) in GitOps provenance status, healthcheck editor warnings, dependency canvas node status, automation run-step status, queue runtime tone map, and script-packages settings. Chart-series literals, syntax/terminal palettes, and intentional brand accents (tips lightbulb, SLO streak flame ramp) were left untouched.
  - Extracted pure display/validation logic into sibling `.logic.ts` modules (SLO display + editor, maintenance editor + config summary, dependency display, incident sort + validation, gitops kind-registry YAML) so it can be unit-tested in isolation. These extractions are behavior-preserving.

- 8cad340: Explain why Save is disabled and guard against losing unsaved edits in the
  automation and health-check editors.

  - A greyed-out Save is no longer a dead end: both editors now render a
    "N issue(s) blocking" affordance next to the Save button. Opening it
    lists every blocker, and clicking one jumps to the offending field/section
    (the automation Name / Run-as fields or the visual definition editor; the
    health-check tree node that owns the issue). The existing validation logic is
    unchanged - the blockers are just surfaced and made actionable.
  - The first field of a fresh automation (Name) now auto-focuses so keyboard-first
    users can type immediately.
  - Both editors now use the shared `useUnsavedChanges` hook for unsaved-changes
    protection: a native prompt on tab close / refresh plus an in-app
    "Discard unsaved changes?" confirmation when navigating away mid-edit. The
    health-check editor's previous hand-rolled `beforeunload` listener is migrated
    to the shared hook; the automation editor gains dirty tracking and the same
    guard.

- 8cad340: Apply cross-cutting UX consistency sweeps to the SLO and health-check
  frontends.

  Formatting: inline date and percentage formatting now routes through the
  shared `@checkstack/ui` helpers (`formatDate`, `formatPercent`). The SLO trend
  chart and achievement badge no longer hardcode the `en-US` locale, and
  availability / error-budget percentages render with a consistent,
  locale-aware precision policy.

  Success colors: success-semantic palette literals (`text-emerald-*` /
  `bg-emerald-*`) in the SLO dependency-exclusion selector and attribution chart
  now use the `--success` token so they follow theme and dark-mode adjustments.

  Source pill: the health-check runs table's `RunSourceChip` previously
  hand-rolled a pill with a hardcoded `orange` palette; it now renders the
  shared `Badge` (`warning` for remote, `secondary` for local) so it themes and
  matches the surrounding badge row. The displayed "Remote" / "Local" text is
  unchanged.

  Error state: the SLO overview page now renders a `QueryErrorState` (with a
  Retry button) when its list query fails, instead of silently falling through
  to the "No SLOs configured" empty state. The branch is additive, so the
  existing empty-state copy is unchanged.

  Toasts: error-bearing toast call sites now route through the shared
  `toastError` / `toastSuccess` helpers for consistent voice and truncation.
  Error toasts that previously showed only the raw backend message now read
  `"<action>: <message>"` (e.g. `Failed to create: <message>`). Success-toast
  text is unchanged.

### Patch Changes

- 8cad340: Refactor `HealthCheckRunsTable` to consume the shared `useKeptPrevious` hook
  from `@checkstack/ui` for its keep-previous-rows-during-refetch behaviour.
  Behaviour is unchanged: previous rows are held to avoid a layout jump and dimmed
  while stale.
- 8cad340: Improve health check readability on narrow viewports. The health check history
  table and the drawer's recent-runs table now render a stacked `MobileCardList`
  below the `sm` breakpoint (the desktop `<table>` is unchanged), and the latency
  and auto-generated line charts reduce x-axis tick density on phones so labels
  stay legible. No change to chart data or the desktop layout.
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
  - @checkstack/auth-frontend@0.9.0
  - @checkstack/ui@1.17.0
  - @checkstack/catalog-frontend@0.13.0
  - @checkstack/dashboard-frontend@0.9.0
  - @checkstack/gitops-frontend@0.6.0
  - @checkstack/script-packages-frontend@0.4.0
  - @checkstack/secrets-frontend@0.3.0
  - @checkstack/tips-frontend@0.4.0
  - @checkstack/healthcheck-common@1.8.0
  - @checkstack/common@0.17.0
  - @checkstack/frontend-api@0.11.1
  - @checkstack/anomaly-common@1.5.2
  - @checkstack/catalog-common@2.4.2
  - @checkstack/satellite-common@0.8.10
  - @checkstack/signal-frontend@0.2.6

## 0.24.1

### Patch Changes

- Updated dependencies [b1a5f3c]
  - @checkstack/frontend-api@0.11.0
  - @checkstack/auth-frontend@0.8.1
  - @checkstack/catalog-common@2.4.1
  - @checkstack/catalog-frontend@0.12.1
  - @checkstack/dashboard-frontend@0.8.11
  - @checkstack/gitops-frontend@0.5.9
  - @checkstack/healthcheck-common@1.7.1
  - @checkstack/script-packages-frontend@0.3.13
  - @checkstack/secrets-frontend@0.2.8
  - @checkstack/tips-frontend@0.3.9
  - @checkstack/ui@1.16.2
  - @checkstack/anomaly-common@1.5.1
  - @checkstack/satellite-common@0.8.9

## 0.24.0

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
- Updated dependencies [551eaa9]
- Updated dependencies [9ab73c5]
- Updated dependencies [5c6393f]
  - @checkstack/healthcheck-common@1.7.0
  - @checkstack/auth-frontend@0.8.0
  - @checkstack/common@0.16.0
  - @checkstack/anomaly-common@1.5.0
  - @checkstack/catalog-common@2.4.0
  - @checkstack/catalog-frontend@0.12.0
  - @checkstack/ui@1.16.1
  - @checkstack/frontend-api@0.10.0
  - @checkstack/dashboard-frontend@0.8.10
  - @checkstack/satellite-common@0.8.8
  - @checkstack/tips-frontend@0.3.8
  - @checkstack/gitops-frontend@0.5.8
  - @checkstack/script-packages-frontend@0.3.12
  - @checkstack/secrets-frontend@0.2.7
  - @checkstack/signal-frontend@0.2.5

## 0.23.11

### Patch Changes

- @checkstack/dashboard-frontend@0.8.9
- @checkstack/script-packages-frontend@0.3.11

## 0.23.10

### Patch Changes

- Updated dependencies [6005271]
  - @checkstack/ui@1.16.0
  - @checkstack/auth-frontend@0.7.7
  - @checkstack/catalog-frontend@0.11.7
  - @checkstack/dashboard-frontend@0.8.8
  - @checkstack/gitops-frontend@0.5.7
  - @checkstack/script-packages-frontend@0.3.10
  - @checkstack/secrets-frontend@0.2.6
  - @checkstack/tips-frontend@0.3.7
  - @checkstack/catalog-common@2.3.6
  - @checkstack/anomaly-common@1.4.2
  - @checkstack/healthcheck-common@1.6.2
  - @checkstack/satellite-common@0.8.7

## 0.23.9

### Patch Changes

- @checkstack/auth-frontend@0.7.6
- @checkstack/catalog-common@2.3.5
- @checkstack/catalog-frontend@0.11.6
- @checkstack/script-packages-frontend@0.3.9
- @checkstack/tips-frontend@0.3.6
- @checkstack/anomaly-common@1.4.1
- @checkstack/dashboard-frontend@0.8.7
- @checkstack/healthcheck-common@1.6.1
- @checkstack/gitops-frontend@0.5.6
- @checkstack/satellite-common@0.8.6

## 0.23.8

### Patch Changes

- @checkstack/script-packages-frontend@0.3.8

## 0.23.7

### Patch Changes

- 0b6f01b: feat(healthcheck): contribute health problems to the backend system.issues aggregator

  The healthcheck plugin now registers a `system.issues` contributor (sourceId
  `healthcheck`) from its backend `init`, so the AI assistant surfaces degraded
  and unhealthy systems alongside incidents, SLOs, anomalies, and dependency
  problems.

  The contributor enforces its own `healthcheck.status` access gate (returning an
  empty map - never throwing - when the principal lacks access; service users get
  no signals), then reads the current problem rows for every system from the
  shared, durable `health_check_runs` / `system_health_checks` tables via a new
  global `getAllUnhealthySystemStatuses` service method (every system with an
  enabled check association, evaluated with the same per-system evaluator the
  dashboard uses, healthy systems omitted). The answer is therefore identical on
  every pod, and only systems with a current problem appear in the result.

  The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
  extracted into a new pure `deriveHealthcheckSignals` deriver in
  `@checkstack/healthcheck-common`, shared by both the backend contributor and the
  frontend `HealthSignalsFiller` so the two surfaces stay in lockstep. The
  frontend filler now delegates to that deriver with unchanged behavior.

- Updated dependencies [0b6f01b]
- Updated dependencies [0b6f01b]
  - @checkstack/anomaly-common@1.4.0
  - @checkstack/healthcheck-common@1.6.0
  - @checkstack/dashboard-frontend@0.8.6
  - @checkstack/satellite-common@0.8.5
  - @checkstack/script-packages-frontend@0.3.7

## 0.23.6

### Patch Changes

- @checkstack/script-packages-frontend@0.3.6

## 0.23.5

### Patch Changes

- 56e7c75: Hide navigation, actions and links that the current user cannot use, so anonymous
  and read-only users no longer see entries that lead to "Access Denied" or to
  actions the server would reject.

  - **Sidebar**: a nav entry can now declare a dynamic `nav.isVisible({ accessRules, isAuthenticated })` predicate (in addition to the static `accessRule`). A group whose every entry is filtered out is no longer rendered. The filtering/grouping logic is extracted to a pure, unit-tested helper.
  - **Infrastructure**: its sidebar entry is shown only when the user can READ at least one contributed tab (queue, cache, …), instead of always (it previously had no static rule because tabs are contributed at runtime).
  - **Notification Settings**: hidden from anonymous users - notifications are per-user, so an anonymous visitor can't have any.
  - **Anomaly Mute / Suppress**: the "Mute" / "Mute all" controls (a per-user preference) are hidden from anonymous visitors; the "Suppress" control is gated on `anomalyAccess.feed.manage`. Both were previously always visible.
  - **Dashboard**: the "Open Catalog" actions (which open the manage-only Catalog config page) are hidden from users without `catalogAccess.system.manage`, and the "View catalog" link is gated on `catalogAccess.system.read`.
  - **Dashboard status signals**: the per-system status rows contributed by plugins (`SystemSignalsSlot`) now render as a LINK only when the user can open the target, and as plain text otherwise. `SystemSignal` gains an optional `accessRule`; the healthcheck, anomaly, and dependency fillers set it for their gated targets (check-history / assignments / dependency-map). Signals pointing at ungated pages (incident / maintenance / SLO detail) stay links.
  - **Plugin Manager**: the "Install plugin" button (which opens the install-gated page) is hidden from users with only `plugin` view access.
  - **Satellites**: the page is entirely manage-gated, but its route/sidebar entry was gated on `read`, so read-only users saw the nav item and hit "Access Denied" on click. The route and nav entry now require `satellite.manage`.

  The `@checkstack/ai-backend` bump is only the regenerated bundled docs index
  (the frontend routing guide gained the `nav.isVisible` section); no code change.

  **BREAKING (`@checkstack/frontend-api`):** the `AccessApi` interface gains a
  required `useIsAuthenticated()` method. Custom `AccessApi` implementations must
  add it (it returns `{ loading, isAuthenticated }`). The built-in auth
  implementation and the no-auth fallback already do. `NavEntry` also gains an
  optional `isVisible` predicate (purely additive).

- Updated dependencies [0626782]
- Updated dependencies [460ffd6]
- Updated dependencies [56e7c75]
- Updated dependencies [56e7c75]
  - @checkstack/auth-frontend@0.7.5
  - @checkstack/dashboard-frontend@0.8.5
  - @checkstack/frontend-api@0.9.0
  - @checkstack/catalog-common@2.3.4
  - @checkstack/ui@1.15.1
  - @checkstack/common@0.15.0
  - @checkstack/anomaly-common@1.3.4
  - @checkstack/healthcheck-common@1.5.4
  - @checkstack/satellite-common@0.8.4
  - @checkstack/catalog-frontend@0.11.5
  - @checkstack/tips-frontend@0.3.5
  - @checkstack/gitops-frontend@0.5.5
  - @checkstack/script-packages-frontend@0.3.5
  - @checkstack/secrets-frontend@0.2.5
  - @checkstack/signal-frontend@0.2.4

## 0.23.4

### Patch Changes

- fb705df: Upgrade React 18 to React 19 across the platform.

  **BREAKING (runtime frontend plugins):** React is shared as a Module Federation
  singleton, so the host now provides **React 19** to every runtime plugin.
  Frontend plugins built against React 18 must be rebuilt against React 19
  (`react` / `react-dom` `^19`). The scaffold templates and the host/plugin MF
  `requiredVersion` are updated to `^19`. `react` (and now `react-dom`) are pinned
  to a single version across the workspace via syncpack so the singleton can never
  skew (react and react-dom must match exactly).

  The React 19 removed-API surface was audited - the codebase used only no-arg
  `useRef()` (now `useRef<T | undefined>(undefined)`); no `ReactDOM.render`,
  legacy context, string refs, or function-component `defaultProps`. This also
  clears the `IMPORT_IS_UNDEFINED` build warnings for `React.use` /
  `React.useOptimistic` (react-router 7 feature-detection), which React 19 exports.

  The downstream `*-frontend` packages (and `@checkstack/infrastructure-common`)
  receive only the mechanical `react` dependency bump (`patch`); the framework
  packages carrying the shared-singleton change are bumped `minor`.

- Updated dependencies [9d8961c]
- Updated dependencies [fb705df]
  - @checkstack/ui@1.15.0
  - @checkstack/frontend-api@0.8.0
  - @checkstack/auth-frontend@0.7.4
  - @checkstack/catalog-frontend@0.11.4
  - @checkstack/dashboard-frontend@0.8.4
  - @checkstack/gitops-frontend@0.5.4
  - @checkstack/script-packages-frontend@0.3.4
  - @checkstack/secrets-frontend@0.2.4
  - @checkstack/signal-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.4
  - @checkstack/catalog-common@2.3.3
  - @checkstack/anomaly-common@1.3.3
  - @checkstack/common@0.14.1
  - @checkstack/healthcheck-common@1.5.3
  - @checkstack/satellite-common@0.8.3

## 0.23.3

### Patch Changes

- Updated dependencies [ed251b6]
- Updated dependencies [968c12f]
  - @checkstack/ui@1.14.0
  - @checkstack/auth-frontend@0.7.3
  - @checkstack/catalog-frontend@0.11.3
  - @checkstack/dashboard-frontend@0.8.3
  - @checkstack/gitops-frontend@0.5.3
  - @checkstack/script-packages-frontend@0.3.3
  - @checkstack/secrets-frontend@0.2.3
  - @checkstack/tips-frontend@0.3.3
  - @checkstack/anomaly-common@1.3.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/common@0.14.1
  - @checkstack/frontend-api@0.7.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/satellite-common@0.8.2
  - @checkstack/signal-frontend@0.2.2

## 0.23.2

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1
  - @checkstack/anomaly-common@1.3.2
  - @checkstack/auth-frontend@0.7.2
  - @checkstack/catalog-common@2.3.2
  - @checkstack/catalog-frontend@0.11.2
  - @checkstack/dashboard-frontend@0.8.2
  - @checkstack/frontend-api@0.7.2
  - @checkstack/gitops-frontend@0.5.2
  - @checkstack/healthcheck-common@1.5.2
  - @checkstack/satellite-common@0.8.2
  - @checkstack/script-packages-frontend@0.3.2
  - @checkstack/secrets-frontend@0.2.2
  - @checkstack/tips-frontend@0.3.2
  - @checkstack/ui@1.13.2
  - @checkstack/signal-frontend@0.2.2

## 0.23.1

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0
  - @checkstack/anomaly-common@1.3.1
  - @checkstack/auth-frontend@0.7.1
  - @checkstack/catalog-common@2.3.1
  - @checkstack/catalog-frontend@0.11.1
  - @checkstack/dashboard-frontend@0.8.1
  - @checkstack/frontend-api@0.7.1
  - @checkstack/gitops-frontend@0.5.1
  - @checkstack/healthcheck-common@1.5.1
  - @checkstack/satellite-common@0.8.1
  - @checkstack/script-packages-frontend@0.3.1
  - @checkstack/secrets-frontend@0.2.1
  - @checkstack/tips-frontend@0.3.1
  - @checkstack/ui@1.13.1
  - @checkstack/signal-frontend@0.2.1

## 0.23.0

### Minor Changes

- 9dcc848: Redesign the catalog into a group-first browse view and tabbed management tables, with inline health rollups.

  - Browse view: the catalog home is a real read-only, scale-built experience - collapsible group sections (with member counts) plus a synthetic Ungrouped section, a shared toolbar (search, group/health/tag filters, density toggle), URL-backed view state (shareable deep links), polished empty states, and a manager-only "Manage catalog" link. Per-system status badges render through the existing `SystemStateBadgesSlot`; filtering is client-side over the loaded set.
  - Management: redesigned as tabbed data tables (Systems / Groups / Environments) replacing the two-column drag-to-assign layout. Systems get multi-select + a bulk bar, inline health, and group + environment membership as removable chips with type-ahead pickers (portaled so they are never clipped); Groups get inline rename and member chips; Environments get a name / members / field-count table (CRUD gated by `catalog.environment.manage`). GitOps-locked rows stay read-only. Drag-and-drop (and `@dnd-kit` on this page) is removed; the management page also shares the browse toolbar.
  - Inline health rollups: a new platform contract `CatalogBrowseHealthSlot` (`@checkstack/catalog-common`) - an additive optional slot catalog-frontend only consumes (a headless data boundary feeding group rollups + the health filter), with a catalog-owned `CatalogHealthStatus` vocabulary so catalog gains no health-plugin dependency. Group headers show a rollup pill derived from the reported status DATA (a system absent from the map is `"unknown"`, never healthy); all-healthy groups start collapsed. The health filter is wired on both toolbars and enables once a filler reports. healthcheck-frontend fills the slot by reusing dashboard-frontend's `SystemBadgeDataProvider`. When no health source is installed the slot is unfilled and the catalog stays fully functional.

  This is a beta minor.

- 9dcc848: Redesign the dashboard as an extensible "needs attention" overview, and normalize system state badges.

  The dashboard now surfaces ONLY systems that need attention (degraded, unhealthy, breaching/at-risk SLO, under an incident or active maintenance, anomalous, or with a dependency problem) and hides everything healthy. A compact header summarises fleet health and filters by severity; each problem renders as an elevated card with one row per issue that deep-links to where the issue originates. A calm "all clear" state shows when nothing needs attention, a live "recent activity" feed sits below, and a "View catalog" link replaces the duplicated system list.

  New platform contract `SystemSignalsSlot` (`@checkstack/catalog-common`): a headless, render-once slot where any plugin bulk-fetches and reports structured `SystemSignal[]` per system via `onSignals(sourceId, map)`. The dashboard aggregates every source agnostic to which plugins contribute; each core reliability plugin (healthcheck, incident, SLO, maintenance, anomaly, dependency) ships a filler, and third-party plugins add new per-system state the same way with no dashboard change. Signals carry an `iconName` rendered via `DynamicIcon` so the contract stays React-free. The dashboard's old summary tiles and overview sheets are removed, so it no longer depends on those plugins' packages. The group "subscribe" control moved onto the catalog browse page's group headers.

  System state badges are normalized into one icon-only `@checkstack/ui` `StatusBadge` primitive - a small tinted icon chip with the full label on hover/focus (and via `aria-label`). Each signal uses its feature's navbar icon (health = Activity, incident = AlertTriangle, SLO = Target, maintenance = Wrench, dependency = GitBranch; anomaly = ChartSpline). Badges self-sort by severity via CSS `order` (error -> warn -> info), tooltips are scoped to a named group, and in catalog browse rows the cluster moved to the right edge.

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

- 9dcc848: Cut initial-load JS: lazy plugin contributions, a hardened lazy-by-default contribution contract, on-demand Monaco, and a lighter icon/chart load.

  - Lazy plugin route pages: each plugin's route `element` references a `React.lazy`-wrapped page rendered inside a shared `<Suspense>` boundary. Plugins still register synchronously, so nav, slots, commands, API factories, and `foreignSignals` are available on first paint. This moves ~37 route-page chunks (~600 KB) out of the entry; the entry chunk drops from ~2.4 MB to ~190 KB. Auth flow pages stay eager. The `@checkstack/scripts` scaffold template generates lazy route pages too.
  - Hardened contribution contract (BREAKING, frontend plugin contract): plugins declare contributions lazily and let the framework own code-splitting, Suspense, and per-plugin error isolation. Routes use `load: () => import("./Page").then((m) => ({ default: m.Page }))` instead of `element: <Page />` (`element` is still accepted for the rare page that must paint without a chunk fetch; provide exactly one). Slot extensions accept either an eager `component` or a lazy `load`; new `getLazyContribution` + `ExtensionComponent` exports from `@checkstack/frontend-api` render either kind. This also fixes runtime-installed plugins: `ExtensionSlot` subscribes to the plugin registry, and the API registry rebuilds when the plugin set changes (`getPlugins()` returns an immutable snapshot via `useSyncExternalStore`). A per-plugin error boundary contains a bad contribution.
  - On-demand Monaco: the `@checkstack/ui` barrel no longer pulls the `@codingame/*` / `monaco-languageclient` stack into the initial load. `CodeEditor` lazy-loads its Monaco-backed editor behind `React.lazy` + Suspense, `validateTypeScriptSources` imports the editor API via in-body `await import(...)`, and the "vscode services ready" signal moved to a Monaco-free module. The ~10 MB editor body loads only when a `CodeEditor` mounts. A `react-vendor` `manualChunks` split was added for stable vendor caching.
  - lucide-react 1.x + lighter icons/charts (BREAKING for icon consumers): lucide-react unified from three drifting ranges to `^1.17.0`. lucide v1 removed brand icons, so the GitHub/GitLab marks are vendored in `@checkstack/ui` (`GithubIcon`, `GitlabIcon`, `brandIcons`); a new `IconName` type (`LucideIconName | BrandIconName`) in `@checkstack/common` is canonical, accepted by `AuthStrategy.icon` and the card components, so data-driven brand names keep working. `DynamicIcon` no longer eagerly imports lucide's ~1600-icon map (~1 MB) - it lives in a `React.lazy` `iconRegistry` chunk fetched on first data-driven render, while statically named-imported icons tree-shake normally. The recharts-backed health-check charts (~300 KB) and the `HealthCheckSystemOverview` drawer leave the initial load.

  BREAKING CHANGES:

  - Frontend plugin contract: routes/slot contributions are lazy-by-default (`load` instead of `element`/eager elements) as described above.
  - Any external consumer importing a brand icon from `lucide-react` (e.g. `import { Github } from "lucide-react"`) must switch to the vendored `@checkstack/ui` brand icons or a custom SVG.

  This is a beta minor.

- 9dcc848: Add the auto-generated, version-pinned `@checkstack/sdk` package + codegen, and serve its types live to the in-app editor.

  - A new committed workspace package `@checkstack/sdk`, generated from the platform's source of truth by `scripts/generate-sdk.ts` (`generate:sdk` / `generate:sdk:check`): a fully-typed oRPC client (`createCheckstackClient`) over the REST surface with one `InferClient` per plugin contract, real script-authoring helpers (`@checkstack/sdk/healthcheck`, `@checkstack/sdk/integration`) whose runtime body is the same identity function the in-app runner injects, per-subpath `.d.ts` under the package `exports` map, and an editor-only ambient bundle. A `generate:sdk:check` CI guard fails when the committed SDK files drift from a fresh generation. The `@checkstack/sdk` version is stamped from `@checkstack/release` and MUST NOT appear in a changeset (a guard enforces this); the `@checkstack/release` bump here advances the release version so the generated SDK can be published later. The generated client also normalizes its base URL without a backtracking-prone regex, closing a CodeQL `js/polynomial-redos` finding.
  - Live editor type injection: a new version-keyed route `GET /api/script-packages/sdk-types/:releaseVersion` (raw handler in `@checkstack/script-packages-backend`) serves the generated SDK editor bundle with `Cache-Control: private, max-age=1y, immutable`; the pure path-build/parse module lives in `@checkstack/script-packages-common`, shared by backend and frontend. A mismatched version returns `409` so the editor refetches and never serves stale types after an upgrade. The frontend `useSdkTypeInjection` hook fetches the bundle once per session and mounts it into Monaco via `addExtraLib`. Schema-narrowed `context.config` / `context.event.payload` editor types stay local; the package-resolving module declarations come from the one published `@checkstack/sdk` source.

  BREAKING CHANGES: the script-authoring import surface moves from the bare `@checkstack/healthcheck` / `@checkstack/integration` virtual modules to the `@checkstack/sdk/healthcheck` / `@checkstack/sdk/integration` subpaths of the published `@checkstack/sdk` package. The old bare-name imports no longer resolve (an old import now errors in the editor, surfacing the migration). Existing scripts must update the module specifier:

      - import { defineHealthCheck } from "@checkstack/healthcheck";
      + import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

      - import { defineIntegration } from "@checkstack/integration";
      + import { defineIntegration } from "@checkstack/sdk/integration";

  The helper names and their runtime behaviour are unchanged - only the module specifier moves. The global (no-import) helper form continues to work unchanged.

  This is a beta minor.

- 9dcc848: Align workspace dependency versions and migrate React Router to v7.

  BREAKING CHANGES (React Router v7): All frontend packages now depend on `react-router-dom@^7.16.0`. Previously the workspace declared four divergent ranges (`^6.20.0`, `^6.22.0`, `^7.1.1`, `^7.14.2`), which resolved both `react-router@6` and `react-router@7` into a single bundle. Everything is now unified on v7. The public imports the app uses (`BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `MemoryRouter`, `useNavigate`, `useParams`, `useSearchParams`, `useLocation`) are unchanged between v6 and v7, so no source rewrites were required - but any out-of-tree plugin still on react-router v6 should upgrade to v7 (see the React Router v6 -> v7 upgrade guide) to share the host's single router instance via the import map.

  Other unified ranges (no API change): `react` -> `^18.3.1`, the `@orpc/*` family (`contract`, `server`, `client`, `tanstack-query`, `openapi`, `zod`) -> `^1.14.4`, and `better-auth` -> `^1.6.13`.

  Removed the pre-rename `@orpc/react-query` leftover from `@checkstack/frontend-api`; its `createRouterUtils` / `RouterUtils` / `ProcedureUtils` now come from `@orpc/tanstack-query` (the package already in use).

  Stale in-range runtime deps pulled up to current published versions: `hono` `^4.12.23`, `@tanstack/react-query` (+devtools) `^5.100.14`, `date-fns` `^4.4.0`, `jose` `^6.2.3`, `tar` `^7.5.16`, `semver` `^7.8.1`, `@xyflow/react` `^12.11.0`.

### Patch Changes

- 9dcc848: Move primary navigation into a left sidebar, and serve the user guide in-app.

  Feature navigation (a ~20-item user-menu dropdown) now lives in a persistent left sidebar (a slide-over drawer on mobile), grouped by section with the active route highlighted; the user menu keeps only account actions. A route opts into the sidebar with new `nav` metadata (`{ group, icon, label?, order?, accessRule? }`) on its registration, co-located with path + access + title. The sidebar filters entries with the same access check as page guards. `@checkstack/common` gains `isAccessRuleSatisfied` and a centralized set of in-app doc slugs (`APP_DOC_SLUGS` + `docsPath`, with a test asserting each resolves to a real docs page); `@checkstack/auth-frontend` exports `useAccessRules`.

  The backend now serves the Astro Starlight docs build same-origin at `/checkstack/*` (the same artifact deployed to GitHub Pages), so the user guide is available inside the app including for self-hosted / air-gapped installs (served verbatim, no rebuild, no link rewriting; from `CHECKSTACK_DOCS_DIST`, before the SPA catch-all, degrading gracefully when absent; the Docker image builds and ships `docs/dist`; Vite proxies `/checkstack` in dev). The "Docs" link is a shell-owned external sidebar entry under the Documentation group (book icon), opening `/checkstack/user-guide/` in a new tab; the group renders even when no plugin route contributes to it.

  BREAKING (plugin authors): `UserMenuItemsSlot` is no longer the way to add navigation - registering a top user-menu item no longer surfaces it anywhere. Add `nav` to the page's route instead. `UserMenuItemsBottomSlot` (account items) is unchanged. All bundled plugins have been migrated.

  This is a beta minor.

- 9dcc848: Guard component animations behind isLowPower, and add a shared inline Spinner.

  - `@checkstack/ui` shared components (`Tabs`, `ConfirmationModal`, `Accordion`, `CodeEditor` popout-button backdrop blur) now drop their `animate-*` / `backdrop-blur` classes when the device reports the low-power tier, matching `LoadingSpinner` / `Skeleton`. No public API change; normal-power rendering is unchanged.
  - A new shared inline `Spinner` (`@checkstack/ui`) renders a lucide `Loader2` whose `animate-spin` is gated internally behind `usePerformance().isLowPower`, so call sites inherit the low-power guard. Props: `size` (`sm`/`md`/`lg`), `className`, rest spread to the icon; decorative by default (`aria-hidden`), `role="status"` when given `aria-label`. The hand-rolled `Loader2` button/table spinners in `HealthCheckDrawer`, `HealthCheckRunsTable`, `IncidentEditor`, `IncidentUpdateForm`, `ProviderConnectionsPage`, `MaintenanceEditor`, `MaintenanceUpdateForm`, `UserChannelCard`, and `DynamicOptionsField` are migrated onto it.
  - Remaining unguarded `animate-*` / `animate-in` / blur classes across the auth, gitops, healthcheck, incident, integration, maintenance, and notification frontends are gated behind `usePerformance().isLowPower`, so effects degrade gracefully on low-power devices per the performance rule.

  Normal-power behavior is unchanged; low-power rendering drops the animations.

  This is a beta minor.

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
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/ui@1.13.0
  - @checkstack/auth-frontend@0.7.0
  - @checkstack/healthcheck-common@1.5.0
  - @checkstack/anomaly-common@1.3.0
  - @checkstack/catalog-frontend@0.11.0
  - @checkstack/catalog-common@2.3.0
  - @checkstack/common@0.13.0
  - @checkstack/dashboard-frontend@0.8.0
  - @checkstack/frontend-api@0.7.0
  - @checkstack/gitops-frontend@0.5.0
  - @checkstack/script-packages-frontend@0.3.0
  - @checkstack/secrets-frontend@0.2.0
  - @checkstack/tips-frontend@0.3.0
  - @checkstack/satellite-common@0.8.0
  - @checkstack/signal-frontend@0.2.0

## 0.22.0

### Minor Changes

- b995afb: Move health-check flapping configuration from the per-assignment notification policy onto the `healthcheck.flapping_detected` automation trigger.

  Flapping thresholds (`transitions`, `windowMinutes`) are now configured on the trigger itself, next to the automation that reacts to them, instead of on each check assignment. The health-check executor still owns the windowed transition counting (it writes `health_check_unhealthy_transitions` and runs the window query), but it now SOURCES the thresholds from the subscribed automations' trigger config:

  - On a transition-to-unhealthy it records the transition unconditionally (keeping history warm), then looks up the enabled automations subscribed to `healthcheck.flapping_detected`, collects the distinct set of configured windows, counts transitions once per distinct window, and emits one `healthcheck.flapping_detected` per window. The trigger's exact-window `evaluateConfig` gate then fires each automation only for its own window and transition threshold.
  - A missing or partial flapping trigger config defaults to `{ transitions: 3, windowMinutes: 60 }`, so automations created before the trigger carried config keep working unchanged.
  - `automation-backend` exposes a new backend-only, read-only `automationSubscriptionsRef` service ref (`findEnabledByTriggerEvent`) so a plugin that owns a trigger's underlying event can discover its subscribers' trigger config. It is never browser-exposed.

  **BREAKING CHANGES**

  - The per-assignment `notificationPolicy.flappingTrigger` field is removed. `NotificationPolicy` is now `{ suppressDeEscalations }` only. Stored rows that still carry a `flappingTrigger` key parse cleanly - the key is stripped on read - so no data migration is required, but the per-check flapping toggle/threshold in the assignment Notifications tab is gone; configure flapping on the trigger instead.
  - The GitOps `System.healthcheck[].notificationPolicy.flappingTrigger` field is removed. A `flappingTrigger` block in a manifest is ignored. Move the thresholds to the `transitions` / `windowMinutes` config of your `healthcheck.flapping_detected` automation trigger.
  - The standalone `enabled` flag for flapping is gone: flapping is "enabled" precisely when at least one enabled automation subscribes to `healthcheck.flapping_detected`. With no subscriber, the transition is still recorded but nothing is counted or emitted.

- b995afb: Remove the legacy per-assignment auto-incident system. Auto-incidents are now built entirely by user-authored automations; nothing is seeded or hardcoded.

  What was removed:

  - The one-time migration that auto-seeded "sustained unhealthy" and "flapping" default automations from each assignment's notification policy, plus the `listAutoIncidentPolicies` RPC it consumed.
  - The seeder-only notification-policy settings and their UI: `autoOpenIncidentOnUnhealthy`, `useNotificationSuppression`, `skipDuringMaintenance`, `sustainedUnhealthyTrigger`, and `autoCloseAfterMinutes`. The assignment **Notifications** tab now exposes only the two live settings: **Suppress de-escalation notifications** and the **flapping-detection** thresholds.
  - The dead `health_check_auto_incidents` table (no longer written or read; dropped via migration).

  What is preserved: flapping detection (`healthcheck.flapping_detected`) and de-escalation suppression are unchanged. The `flappingTrigger` and `suppressDeEscalations` policy fields stay exactly as before.

  > [!NOTE]
  > One-time cleanup: an automation-backend migration deletes the historically auto-seeded incident automations (`managed_by LIKE 'auto-incident:%'`) from existing databases. This is intentional and destructive - those automations were no longer managed by anything. If you had edited a seeded automation and want to keep it, re-create it as a normal automation before upgrading. See the "Build auto-incident automations" guide for templates.

  > [!IMPORTANT]
  > NARROWING: `NotificationPolicySchema` is narrowed to `{ suppressDeEscalations, flappingTrigger }`. Stored rows that still carry the removed legacy keys parse cleanly - zod strips the unknown keys on read - so no data migration is required for the `system_health_checks.notification_policy` column. GitOps `notificationPolicy` specs that set the removed fields are no longer accepted for those keys.

- 270ef29: Extend in-UI script testing to health-check collectors, and add
  load-from-run replay for automation script tests.

  - Health-check collectors: a new `testCollectorScript` RPC runs the
    inline-script (TypeScript) collector and the shell `script` collector
    against an editable, auto-seeded sample context using the same
    sandboxed runner the real collector uses. Surfaces beneath the
    collector script fields in the collector editor (both marked
    `x-script-testable`). Gated by `healthcheck.configuration.manage`.
  - Automation replay: a new `getRunScopeForReplay` RPC reconstructs an
    editable test context from a real run (trigger + persisted artifacts,
    plus the durable scope snapshot when the run is still in-flight), and
    the script-test panel gains a "Load from run" picker that seeds the
    sample context from a past run.

  Note: health-check executions do not persist the script / config /
  check / system that produced a result, so there is no health-check
  replay - auto-seed is the only context source for collector tests. This
  is by design; see the feature plan.

- b995afb: Autocomplete the import specifier itself in script editors.

  Lazy type acquisition only loads a package's types once its name is already in the buffer, so while you were still typing the import specifier (`import {} from "lod"`) there were no suggestions - the lazy-ATA catch-22. Script editors now suggest installed package names directly in import-specifier position; selecting one (e.g. `lodash`) inserts the name, and the existing ATA loop then loads its `@types/lodash` closure so members complete.

  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `importablePackages?: string[]` prop and a dedicated Monaco completion provider (registered once per `typescript`/`javascript` language, scoped to the editor's model, disposed on unmount). It fires ONLY when the cursor is inside an import/require module-specifier string - detected by a new pure, unit-tested helper `importSpecifierCompletionContext(lineUpToCursor)` that handles `from "…"`, bare `import "…"`, `require("…")`, and dynamic `import("…")`, returns the partial specifier + the replace range, and returns null once the string is closed or outside an import. Items are `kind: Module`, insert the bare name without touching the quotes, and coexist with (do not replace) the TS worker's own completions. Trigger characters: `"`, `'`, and `/` (for scoped subpaths); manual invoke (Ctrl+Space) also works. A new pure helper `importablePackageNames` filters a raw manifest name list (excludes `@types/*`, dedupes, sorts).
  - `@checkstack/script-packages-frontend`: `useScriptPackageTypeAcquisition()` now also returns `importablePackages`, derived from the installed manifest (what is actually resolvable at runtime) with `@types/*` companions excluded - you import `lodash`, never `@types/lodash` (the `@types` package still backs the closure types).
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: pass `importablePackages` into `DynamicForm` alongside the existing `acquireTypes` wiring, so both the Run Script action editor and healthcheck collector editors get import-name completion.

  The completion list is plugin-agnostic in `@checkstack/ui` (the names are injected); it never fires outside import-string positions, so normal completions are unaffected.

- b995afb: Fix package IntelliSense in script editors: lazy Automatic Type Acquisition (ATA) with proper `@types/*` resolution.

  Script editors (automation "Run Script (TypeScript)" and healthcheck collectors) now provide real autocomplete for installed npm packages. Importing a package whose types live in DefinitelyTyped - e.g. `import { debounce } from "lodash"` (lodash ships no own types; `@types/lodash` does) - now yields member completions. Previously no package completions appeared at all.

  Root cause: the old rollup wrapped each package's raw, multi-file `.d.ts` (with `export =`, `export as namespace`, and triple-slash `/// <reference path>` chains) inside a single `declare module "<name>" { ... }`, which the TypeScript worker silently rejected, and it truncated large type sets (lodash is ~866 KB across ~700 files) at a 256 KB cap.

  The fix registers the REAL declaration files at their `node_modules/...` virtual paths and lets TypeScript's own NodeJs + `@types` resolution do the work:

  - `@checkstack/script-packages-backend`: replaced `rollupPackageTypes` with a tree-driven closure extractor (`resolvePackageTypeClosure`). Given a bare specifier, it resolves against the materialized tree - own types via `package.json` `types`/`typings`/`exports` (bundled-types packages like `zod`/`dayjs`), the `@types/<mangled>` companion when it exists (`lodash` -> `@types/lodash`, scoped `@babel/core` -> `@types/babel__core`), or both, or neither (graceful empty, never a throw). It follows `/// <reference path|types>` and relative imports, includes each package's `package.json`, leaves every file UNWRAPPED, and surfaces a `truncated` flag instead of silently capping. Served from a new raw, HTTP-cacheable route `GET /api/script-packages/types/:lockfileHash/:specifier` (`Cache-Control: private, max-age=1y, immutable`), auth-gated by `script-packages.read`.
  - `@checkstack/script-packages-common`: **BREAKING** - replaced the `listPackageTypes` RPC procedure and `PackageTypesSchema { name, version, dts }` with `PackageTypeClosureSchema` (a `{ path, content }` file-map plus `hasOwnTypes`/`hasAtTypes`/`notFound`/`truncated`) served over the cacheable HTTP route. Added a shared `buildTypeAcquisitionPath`/`parseTypeAcquisitionPath` path contract.
  - `@checkstack/ui`: `CodeEditor`/`TypefoxEditor` gained an injected `acquireTypes` resolver + `acquireResetKey`. On debounced buffer change it parses bare `import`/`require` specifiers (pure, unit-tested) and lazily fetches + registers each NEW package's closure via `addExtraLib` at `file:///node_modules/...`, deduped by a shared acquired-set that resets when the install hash changes. Compiler options set `moduleResolution: NodeJs`, `baseUrl: "file:///"`, and `typeRoots` so a bare import resolves to its `@types` companion. The `context` ambient global keeps working unchanged.
  - `@checkstack/script-packages-frontend`: replaced the old `useScriptPackageTypes` (which concatenated the broken `dts`) with `useScriptPackageTypeAcquisition()`, returning the `acquireTypes` resolver (targets the cacheable route, zod-validates the response) and the current `lockfileHash` as `acquireResetKey`.
  - `@checkstack/automation-frontend` / `@checkstack/healthcheck-frontend`: wired the resolver into the Run Script and collector editors.

  State & scale: the type closure is derived on read from the materialized package tree (no new durable state). The editor's acquired-set is pod-local UI bookkeeping; the route is keyed by the cluster-wide `lockfileHash`, so the browser HTTP cache is correct across pods and only refetches after a new install changes the hash.

- 270ef29: Wire up the script-packages RPC router, admin UI, and editor IntelliSense.

  - `script-packages-backend`: the oRPC router implementing the full
    contract (allowlist CRUD, registry config with encrypted write-only auth
    token, `installNow` via the elected installer, size cap, storage backend
    selection, install state, `getManifest` / `downloadBlob` for reconcilers,
    and `listPackageTypes`), the `installNow` controller (election, size-cap
    enforcement, `script-packages.changed` emit, blocked during migration),
    the `.d.ts` rollup, the singleton config stores, and the full plugin
    wiring (broadcast-hook reconcile + startup backstop).
  - `script-packages-common`: admin route for the settings page.
  - `script-packages-frontend`: the Settings -> Script Packages admin page
    (allowlist, install state + size, registry/storage summary, satellite
    sync) and the `useScriptPackageTypes()` hook.
  - `automation-frontend` / `healthcheck-frontend`: merge installed-package
    `.d.ts` into the script-editor `typeDefinitions` so `import` from an
    allowlisted package autocompletes in every script field.

- b995afb: Fix the automation Run Script action's `secretEnv` (secret → env mapping) test wiring and tolerate bare secret names.

  - `@checkstack/ui` `ScriptTestPanel` now accepts the script field's declared `secretEnv` and renders an optional per-secret test-override input. The `ScriptTestRenderer` callback (DynamicForm) receives the SIBLING `x-secret-env` mapping value, located by annotation (not by field name), so a testable script field forwards it to the panel. Previously the test path never sent `secretEnv`, so `buildTestSecretEnv` got `undefined` and `process.env.<env>` was undefined in an in-UI test. Now an override-less test injects `__SECRET_<NAME>__` placeholders, and any operator override is masked from the output. Real secret values are still NEVER resolved in the test path.
  - `@checkstack/automation-frontend` forwards the action's `secretEnv` and the collected overrides to `testScript`.
  - `@checkstack/secrets-common`: the `secretEnv` mapping VALUE now accepts EITHER a `${{ secrets.NAME }}` template OR a bare secret name, normalizing a bare name to the canonical `${{ secrets.NAME }}` template on parse. This is a forgiving / NARROWING input change (more inputs accepted; stored/output form is unchanged and still the template), not a breaking change. Existing data and YAML shorthand like `secretEnv: { secret: SECRET }` now pass config validation instead of failing with "Must contain a ${{ secrets.NAME }} reference". Partial inline interpolation (e.g. `u:${{ secrets.pw }}@host`) keeps working unchanged; values that are neither a secret reference nor a valid secret name are still rejected.
  - `@checkstack/ui` `parseSecretName` tolerates a legacy bare secret name for display so the picker shows the same name for both the template and the bare form.

  The healthcheck collector test panel was checked: its config has no `x-secret-env` field, so it needed no secret wiring (only the `onRun` signature change, which is backward compatible).

- 270ef29: Secrets platform Phase 2: secret -> env-var mapping with central resolve, inject, and mask.

  - Script consumers declare a least-privilege `secretEnv` allowlist
    (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The automation `run_script` /
    `run_shell` actions resolve ONLY the declared secrets via
    `secretResolverRef.resolveForRun`, inject them into the runner env for
    that run (memory-only; the ESM runner gained a per-run `env` option), and
    mask their values out of stdout/stderr/result/error via the run-scoped
    masking context. A missing required secret fails the run clearly. No
    ambient secret access.
  - Test panel: `testScript` / `testCollectorScript` inject named
    `__SECRET_<NAME>__` placeholders by default, or user-supplied per-secret
    overrides; real production values are never resolved in the test path,
    and overrides are masked out of the result.
  - Healthcheck collectors carry the `secretEnv` field for authoring +
    the test panel; runtime injection on satellites lands in Phase 3.
  - Editor UX: a new `@checkstack/ui` `SecretEnvEditor` renders `x-secret-env`
    record fields with `${{ secrets.* }}` name autocomplete (from
    `listSecretNames`), wired into the automation action editor and the
    healthcheck collector editor. New `withConfigMeta` helper +
    `x-secret-env` config-meta key in `@checkstack/backend-api`.

### Patch Changes

- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
- Updated dependencies [b995afb]
- Updated dependencies [270ef29]
- Updated dependencies [b995afb]
  - @checkstack/ui@1.12.0
  - @checkstack/healthcheck-common@1.4.0
  - @checkstack/script-packages-frontend@0.2.0
  - @checkstack/satellite-common@0.7.0
  - @checkstack/secrets-frontend@0.1.0
  - @checkstack/auth-frontend@0.6.7
  - @checkstack/dashboard-frontend@0.7.8
  - @checkstack/gitops-frontend@0.4.7
  - @checkstack/tips-frontend@0.2.7

## 0.21.0

### Minor Changes

- 35bc682: feat(healthcheck): expose check + system run-context to script collectors

  Script health checks can now read which check and system a run is for.
  Previously shell scripts got only a curated env whitelist and inline
  scripts only `context.config`, so a script had no built-in way to know
  its own check name or the system it was checking.

  - `@checkstack/backend-api`: new `CollectorRunContext` type
    (`{ check: { id, name, intervalSeconds }, system: { id, name } }`) and
    an optional `runContext` param on `CollectorStrategy.execute`. Optional,
    so existing collector implementations are unaffected.
  - Shell-script collector: injects reserved `CHECKSTACK_CHECK_ID`,
    `CHECKSTACK_CHECK_NAME`, `CHECKSTACK_CHECK_INTERVAL_SECONDS`,
    `CHECKSTACK_SYSTEM_ID`, `CHECKSTACK_SYSTEM_NAME` env vars (user-supplied
    `env` still wins on collision).
  - Inline-script collector: exposes `context.check` and `context.system`
    alongside `context.config`; the inline-script editor now types them for
    autocomplete.
  - Shell editors (health-check collectors and automation shell actions) now
    also suggest the user's own `env` (JSON) keys as `$NAME` completions, via
    the new exported `customShellEnvVars` helper. Keys that aren't valid shell
    identifiers are omitted.
  - Fix: the Typefox `CodeEditor` captured a stale `onChange` at editor start,
    so editing one `DynamicForm` field reverted sibling fields changed since
    mount (e.g. typing in a shell `script` field wiped an unsaved `env` value,
    or deleted a sibling automation action added after mount). The change
    handler now routes through a ref to the current `onChange`.
  - Fix: focusing a JSON editor threw "LanguageStatusService.addStatus is not
    supported" because the standalone service set omitted `ILanguageStatusService`.
    That one service is now registered via `serviceOverrides`.
  - Fix: the automation trigger card nested a `<Badge>` (a `<div>`) inside a
    `<p>`, producing a `validateDOMNesting` warning. Switched the wrapper to a
    `<div>`.
  - Local runs (`queue-executor`) and satellite runs both populate the
    context. `SatelliteAssignment` (and the `getAssignmentsForSatellite`
    RPC output) gained optional `configName` / `systemName` so the metadata
    reaches satellite-side execution; `HealthCheckService` resolves the
    system name via the catalog client.

  BREAKING CHANGE: `createHealthCheckRouter` now requires a `catalogClient`
  option (used to resolve system names for satellite assignments). Update
  call sites to pass the catalog RPC client.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
- Updated dependencies [c39ee69]
  - @checkstack/frontend-api@0.6.0
  - @checkstack/ui@1.11.0
  - @checkstack/common@0.12.0
  - @checkstack/healthcheck-common@1.3.0
  - @checkstack/satellite-common@0.6.0
  - @checkstack/auth-frontend@0.6.6
  - @checkstack/catalog-common@2.2.3
  - @checkstack/dashboard-frontend@0.7.7
  - @checkstack/gitops-frontend@0.4.6
  - @checkstack/tips-frontend@0.2.6
  - @checkstack/anomaly-common@1.2.3
  - @checkstack/signal-frontend@0.1.5

## 0.20.0

### Minor Changes

- ba07ae2: Quiet down notification spam on flapping systems, auto-open incidents when a check goes critical, and let operators land directly on the broken checks.

  Notification policy lives **per healthcheck assignment** (one row per `system × configuration`). Different checks on the same system are fully independent — disabling a setting on one check does not affect the others. Defaults preserve existing behaviour for `suppressDeEscalations`; **auto-incident defaults to on** for new and existing assignments.

  - **`suppressDeEscalations`** (off by default). When on, transitions from a worse state to a better-but-still-failing state (e.g. `unhealthy → degraded`) no longer fire a notification. Escalations and full recoveries to `healthy` are unaffected. Resolved per assignment (the just-ran check is the one driving any aggregate transition).
  - **`autoOpenIncidentOnUnhealthy`** (on by default). Either of two independent triggers can open the auto-incident:
    - **`sustainedUnhealthyTrigger`** (default 30 min) — opens when the check stays continuously unhealthy for the configured duration. Catches real outages.
    - **`flappingTrigger`** (default 3 transitions in 60 min) — opens when the check flips to unhealthy that many times in the window. Catches persistent flapping where each unhealthy phase is too brief for the sustained trigger.
      Each trigger can be individually disabled. One incident per system: triggering checks attach to an existing active auto-incident.
  - **`useNotificationSuppression`** (on by default, only meaningful when auto-open is on). Controls whether the auto-opened incident is created with `suppressNotifications: true` — leaving this off opens the incident but still pings operators on each transition.
  - **`skipDuringMaintenance`** (on by default). No auto-incident is opened while the system has an active maintenance window with suppression. The system is intentionally down and shouldn't trip the on-call.
  - **`autoCloseAfterMinutes`** (default 30). Auto-close cooldown is now per-assignment and snapshotted per-incident at open time — later policy edits don't alter in-flight incidents. Setting `null` ("Never auto-close") leaves the incident for manual resolution.
  - **Require-recovery rule.** After any auto-incident closes (manual or auto), no new auto-incident can open until the check has logged at least one healthy run. Prevents a "operator dismissed but it's still broken" loop.
  - **Auto-close worker** ticks every 60s and resolves auto-opened incidents whose systems have been healthy for their per-row `cooldownMinutes`. Rows with `null` cooldown are skipped entirely. Per-incident: failed close attempts are logged but never abort the sweep.
  - **`incidentResolved` hook subscriber** syncs the auto-incident mapping when an operator manually resolves the incident, so the require-recovery rule sees the close immediately.
  - **Platform-wide defaults.** New admin RPCs `getPlatformNotificationDefaults` / `setPlatformNotificationDefaults` (under the existing `healthcheck.configuration.{read,manage}` access rules) let operators set notification policy once for the whole instance. Per-assignment rows with `notificationPolicy: null` inherit the platform defaults at read time. UI: a "Notification defaults" button in the Assignment IDE opens a modal editor. The per-assignment Notifications panel shows an inheritance banner — "Using platform defaults" (read-only) with an "Override" button, or "Custom override" with a "Use platform defaults" button to revert. The all-or-nothing model keeps the mental model simple: each assignment is either fully inherited or fully overridden.
  - **New service-level RPCs** on the incident plugin (`createAutoIncident`, `resolveAutoIncident`) let other plugins open/close incidents without a user context. Reused by the healthcheck auto-incident flow.
  - **Health-state notification CTA** now deep-links to `?filter=failing` on the system detail page for non-recovery transitions (label changes to "View failing checks"). The system overview gains an `All / Failing / Healthy` segmented filter wired to the same `?filter=…` param.
  - **Notification bell badge** now counts collapse groups instead of raw rows, so the number matches what the user sees in the notifications list. Built on `COUNT(DISTINCT COALESCE(collapse_key, id))` — notifications without a collapse key still each count as one.
  - **`statusFilter` on `getHistory` / `getDetailedHistory`** lets the run-history page and the drawer's Recent Runs panel filter to `All / Healthy / Failing` via shared pills, with the page resetting to the first page on filter change.
  - **Pagination defaults aligned with selector options.** Several pages defaulted to a page size (5 or 20) that wasn't in the dropdown's options (`[10, 25, 50, 100]`), so the page-size `<Select>` rendered empty. The drawer's Recent Runs now defaults to 10; the Run History, History List, and Delivery Logs pages now default to 25.

  Includes Drizzle migrations adding the `notification_policy` jsonb column to `system_health_checks`, plus two new tables: `health_check_unhealthy_transitions` (for threshold counting) and `health_check_auto_incidents` (for mapping back to incident ids during auto-close).

### Patch Changes

- Updated dependencies [ba07ae2]
  - @checkstack/healthcheck-common@1.2.0
  - @checkstack/dashboard-frontend@0.7.6
  - @checkstack/satellite-common@0.5.3

## 0.19.5

### Patch Changes

- f23f3c9: Retrofit the highest-traffic configuration list tables
  (`HealthCheckList`, `SloConfigPage`, and the integration
  `DeliveryLogsPage`) onto the `ResponsiveTable` + `MobileCardList`
  primitives from `@checkstack/ui`. On `sm` and up each page still
  renders the unchanged 5- to 7-column table; below that breakpoint a
  sibling stacked-card layout surfaces the same data with the resource
  name + status badge at the top, secondary columns in a muted line, and
  the existing action buttons in a right-aligned footer. The
  `HealthCheckListSkeleton` placeholder mirrors both branches so the page
  no longer jumps when data resolves. No business logic, column order,
  or query inputs changed.
- f23f3c9: Establish the canonical optimistic-UI pattern for oRPC mutations
  (`onMutate` snapshot / patch, `onError` rollback, `onSettled`
  invalidate) and apply it to the two highest-frequency toggles where
  perceived latency was most visible:

  - `markAsRead` on the Notifications page — clicking the check on a
    notification card now flips the read state immediately instead of
    waiting for the round-trip.
  - `pauseConfiguration` / `resumeConfiguration` on the Health Check
    Config page — pause/resume now flip the row's badge instantly,
    rolling back on server error.

  The wrapper type for `useMutation` on each plugin client gained an
  optional `TContext` generic so optimistic sites can return a snapshot
  from `onMutate` and consume it in `onError` without `unknown` casts.
  The runtime behaviour and the auto-invalidation on success are
  unchanged; the change is additive on the type surface only.

  Full pattern and "when NOT to use it" guidance live in
  `docs/frontend/optimistic-updates.md`.

- f23f3c9: Gate decorative motion and blur effects behind
  `usePerformance().isLowPower` on a focused set of high-traffic plugin
  pages (Dashboard, Dependency map, System node, Notification bell,
  Announcement banner / cards, Anomaly field overrides editor, SLO
  attribution chart, Catalog droppable group). Hover scales, backdrop
  blurs, `animate-pulse`/`animate-ping` accents, and entry transitions
  now drop to static states on low-power devices; functional UX
  transitions (Drawer/Dialog open-close, colour transitions) are left
  alone.

  Standardise the post-mutation error-toast voice on plugin pages by
  migrating multi-clause `toast.error(extractErrorMessage(error, "Failed
to X"))` call sites onto the `toastError(toast, "Failed to X", error)`
  helper from `@checkstack/ui`. The helper applies the canonical
  `"action: message"` prefix and 100-character truncation in one place,
  and the now-orphaned `extractErrorMessage` imports are dropped from
  the affected files. No business logic or component APIs changed.

- f23f3c9: Standardise the empty / loading / error story on key list pages using
  the shared `ListEmptyState`, `QueryErrorState`, and `Skeleton`
  primitives from `@checkstack/ui`. Each affected page now branches
  through the same `isLoading -> isError -> empty -> data` ladder, so
  failed queries surface a retry-able inline error instead of silently
  rendering an empty table, and loading states match the final layout
  rather than flashing a generic spinner. No layout, business logic, or
  query input shapes changed.
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0
  - @checkstack/auth-frontend@0.6.5
  - @checkstack/frontend-api@0.5.2
  - @checkstack/dashboard-frontend@0.7.5
  - @checkstack/gitops-frontend@0.4.5
  - @checkstack/ui@1.10.0
  - @checkstack/anomaly-common@1.2.2
  - @checkstack/catalog-common@2.2.2
  - @checkstack/healthcheck-common@1.1.2
  - @checkstack/satellite-common@0.5.2
  - @checkstack/tips-frontend@0.2.5
  - @checkstack/signal-frontend@0.1.4

## 0.19.4

### Patch Changes

- a06b899: Fix stale healthcheck editor on reopen after save.

  Deleting a collector from a healthcheck, saving, then reopening the
  editor used to show the deleted collector reappear — only a full page
  refresh cleared it. The editor's `getConfiguration` query was being
  served stale-while-revalidate on remount, and `useInitOnceForKey`
  fired with that stale value before the background refetch landed.

  Setting `gcTime: 0` on the loader query drops the cached entry on
  unmount, so the next mount has nothing stale to serve and the form
  seeds from fresh data.

  The wider rule has been written up at
  `docs/src/content/docs/frontend/query-invalidation.md` (Pillar 3) and
  a pointer added to `.agent/rules/code-style-guide.md`. tl;dr:
  within-plugin mutations are auto-invalidated by the oRPC client (no
  manual `refetch()` needed); cross-plugin mutations must invalidate
  explicitly; one-shot editor forms must use `gcTime: 0` on their loader.

- a06b899: Overhaul shell + inline-script health checks with real shell semantics, real ESM execution, and upstream Node/Bun IntelliSense.

  **BREAKING CHANGES**

  - **Shell collector** — the `Execute Script` collector now takes a single `script` string instead of `{ command, args }`. Existing configs are auto-migrated to v2: `command` + `args` are joined with POSIX single-quote escaping into the new `script` field, so behaviour is preserved. Custom UIs that hard-coded `command`/`args` field names need to switch to `script`.
  - **Inline collector** — scripts are now executed as real ES modules in a Bun subprocess (was: `new Function()` inside a Web Worker). The legacy `return X;` style still works (it's auto-wrapped in an async IIFE), but mixed scripts that `import` _and_ `return` at the top level need to use `export default` for their result.

  **FIXES**

  - Shell scripts containing pipes, redirects, `awk`, command substitution, conditionals etc. no longer fail with `ENOENT`. The collector now runs through `sh -c <script>` instead of passing the full expression as `Bun.spawn`'s argv[0]. This was the original `awk … failed with ENOENT` regression.
  - Inline scripts can now `import { loadavg } from "node:os"` (and any other `node:*` or `bun` import). They could not before, because the executor wrapped user code inside `new Function(...)` and ran it in a Web Worker that had no Node module access; the wrapper also made top-level `import` syntactically invalid (`Unexpected token '{'`).
  - Healthcheck editor fields no longer reset while you're editing. The page was re-running its form-state init `useEffect` on every refetch of the configuration query — and that query is invalidated on every realtime `HEALTH_CHECK_RUN_COMPLETED` signal across the platform, so in-progress edits got wiped within seconds. Replaced the naive `useEffect([existingConfig])` with a new `useInitOnceForKey` hook from `@checkstack/ui` that initialises the form only on first load per healthcheck id and ignores background refetches. The hook's decision logic is a pure function (`shouldInitForKey`) and is unit-tested in `useInitOnceForKey.test.ts`.
  - Switching between healthcheck collectors no longer mis-applies the previous collector's tokenizer / language service to the new editor. `MultiTypeEditorField` was reusing the same React instance across collector switches (same `key="script"` in both `DynamicForm` renders) and `selectedType` was initialised from `useState` only once on first mount. After a shell→typescript switch the new collector's TS content rendered through the shell branch (no TS highlighting, no IntelliSense); the reverse direction tokenised shell content through TS and surfaced nonsense errors like `2304 "Cannot find name 'and'"` on shell comments. Now a `useEffect` re-derives `selectedType` whenever `editorTypes` changes to a set that doesn't contain the current selection.
  - Monaco workers are now bundled locally via Vite `?worker` imports and wired up through `MonacoEnvironment.getWorker` in a new `monacoWorkers.ts` module. The default `@monaco-editor/loader` CDN path silently failed CORS on worker scripts in some browsers, leaving Monaco's TS service with only the generic `editorWorkerService` — which is enough for tokenizer-only languages like shell but breaks TypeScript's semantic features entirely. Same module configures the TS service singleton (compiler options, eager-model-sync, diagnostics-options-ignore-1108) at module load instead of inside per-editor `onMount`, so the service starts pre-configured regardless of which language opens first. Migrated from the deprecated `monaco.languages.typescript.*` path to `monaco.typescript.*` (the old path is marked `{ deprecated: true }` in monaco-editor 0.55).
  - `defineIntegration` / `defineHealthCheck` callback parameters are now typed against the schema. Previously the virtual module declared them as `(ctx: unknown) => …`, so writing `defineIntegration(async (context) => { console.log(context.event.eventId) })` produced `'context' is of type 'unknown'. (18046)`. The result type and the shared `IntegrationScriptContext` / `HealthCheckScriptContext` interfaces are now generated together in `scriptContext.ts`, so both the function-arg form and the ambient `declare const context` reference the same schema-typed shape.
  - The shell starter template no longer uses Linux-only `/proc/loadavg` (which fails on macOS satellites with `awk: can't open file /proc/loadavg`). It now reads the 1-minute load average via `uptime` and parses both the Linux (`load average: 0.00, 0.01, 0.05`) and macOS (`load averages: 0.45 0.55 0.65`) output formats with a portable `sed`/`awk`/`tr` pipeline.
  - Starter-template seeding is now self-healing. `DynamicForm`'s schema-defaults `useEffect` fires AFTER child seed effects in React's child-before-parent order, so the previous one-shot seed got clobbered back to `""` by the defaults call on first mount and never re-fired. Replaced the `[]`-deps effect with a two-effect pattern: an observer that latches `hasSeededRef = true` the first time `value` is observed non-empty, and a seed effect that keeps re-installing the starter while the latch is open. Once the seed sticks the latch closes; subsequent edits and realtime refetches don't re-trigger.

  **NEW**

  - The Monaco editor for inline scripts now mounts the real upstream `@types/node` + `bun-types` declarations as a virtual filesystem (lazy-loaded as its own JS chunk), so IntelliSense covers the full Node/Bun stdlib, the `Bun` global, `process.env`, `Buffer`, etc. DOM types are deliberately excluded so suggestions stay focused on the backend surface. `context.config` is typed from the collector's own JSON Schema.
  - New `healthcheckScriptContext` / `integrationScriptContext` helpers (exported from `@checkstack/ui`) build a complete editor bundle in one call: TS declarations (`context.config` / `context.event.payload` + the virtual `@checkstack/healthcheck` / `@checkstack/integration` result-type modules), starter templates per language, and the shell env-var list (with platform-injected `EVENT_ID` / `DELIVERY_ID` / `PAYLOAD_*` for integrations). Both call sites — `CollectorSection.tsx` and `CreateSubscriptionDialog.tsx` — were rewired to use them, fixing a long-standing wiring gap where IntelliSense for injected values silently never reached the editor.
  - Inline scripts can now `import { defineHealthCheck } from "@checkstack/healthcheck"` (or `defineIntegration` for integrations) for a typed return-shape assertion. The editor catches `{ success: "yes" }` as a type error against `HealthCheckScriptResult`. The runtime is just an identity function — the collector rewrites the import to a sibling helper file in the temp dir before executing.
  - Shell editors now autocomplete env-vars after `$` and `${`. The completion list is supplied by `healthcheckScriptContext` (safe-vars whitelist) and `integrationScriptContext` (whitelist + `EVENT_ID` etc. + `PAYLOAD_*` flattened from the event's payload schema). The matcher is pure and unit-tested in `shellEnvVarMatcher.test.ts` so regex regressions are caught locally.
  - Empty editor fields are now seeded with a working starter template per language (inline TS uses `defineHealthCheck`, inline shell does the `awk` load-average check, integration TS shows `defineIntegration` with `context.event`, integration shell lists the `$EVENT_ID` / `$PAYLOAD_*` env vars). Users see a runnable example instead of a blank canvas; once they edit, we leave their content alone.
  - Hardened concurrency + cleanup model documented and tested: each invocation gets its own `mkdtemp` directory + UUID result marker; the `finally` block clears the timeout handle, kills any surviving subprocess (idempotent), and removes the temp directory on success, throw, _and_ timeout. New `concurrency.test.ts` proves 20 parallel inline scripts don't cross wires and that the temp-dir count returns to baseline after throws and timeouts.

  **TESTING**

  Tight unit tests added so changes to the editor surface don't need smoke testing:

  - `scriptContext.test.ts` — 18 tests covering the generated type declarations (including explicit regression guards for `defineIntegration` / `defineHealthCheck` callback params being typed against the shared context interface rather than `unknown`), starter templates (including a guard that the shell starter doesn't depend on Linux-only `/proc/loadavg`), shell env-vars for both healthcheck + integration flavours, plus the schema-flattening utility.
  - `shellEnvVarMatcher.test.ts` — 12 tests covering the bare `$` / braced `${` / partial-name / case-insensitive matching logic that powers Monaco's shell completion.
  - `inline-script-normaliser.test.ts` — 13 tests covering the legacy `return X;` → IIFE wrap path, the ESM-passthrough path, and the `@checkstack/healthcheck` import rewriter.
  - `inline-script-collector.test.ts` — 18 tests including ones that actually execute a script importing `defineHealthCheck` (named-import form) AND using the global `defineHealthCheck` (no import) to prove both code paths resolve at runtime.
  - `concurrency.test.ts` — 4 tests proving 20 parallel runs don't collide and that the temp-dir count returns to baseline after success, throw, and timeout.
  - `useInitOnceForKey.test.ts` — 10 tests proving the healthcheck-editor form state isn't reset when react-query refetches in the background (the original "fields reset while I'm typing" regression).
  - `starterTemplateSelector.test.ts` — 7 tests for the pure decision function powering empty-field seeding.
  - `security.test.ts` — added an integration test that actually executes the portable load-average pipeline through `Bun.spawn` on the current OS, catching `/proc/loadavg`-style regressions at CI time on macOS runners.

  **SECURITY**

  - Same env-var whitelist as before (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`). Backend secrets in the satellite process's environment remain invisible to user scripts.

  See `docs/src/content/docs/backend/script-healthchecks.md` for the full user-facing guide.

- Updated dependencies [a06b899]
  - @checkstack/ui@1.9.0
  - @checkstack/anomaly-common@1.2.1
  - @checkstack/catalog-common@2.2.1
  - @checkstack/dashboard-frontend@0.7.4
  - @checkstack/healthcheck-common@1.1.1
  - @checkstack/auth-frontend@0.6.4
  - @checkstack/gitops-frontend@0.4.4
  - @checkstack/tips-frontend@0.2.4
  - @checkstack/satellite-common@0.5.1

## 0.19.3

### Patch Changes

- Updated dependencies [1909a61]
  - @checkstack/ui@1.8.3
  - @checkstack/auth-frontend@0.6.3
  - @checkstack/dashboard-frontend@0.7.3
  - @checkstack/gitops-frontend@0.4.3
  - @checkstack/tips-frontend@0.2.3

## 0.19.2

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
  - @checkstack/ui@1.8.2
  - @checkstack/auth-frontend@0.6.2
  - @checkstack/dashboard-frontend@0.7.2
  - @checkstack/gitops-frontend@0.4.2
  - @checkstack/tips-frontend@0.2.2

## 0.19.1

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0
  - @checkstack/catalog-common@2.2.0
  - @checkstack/healthcheck-common@1.1.0
  - @checkstack/anomaly-common@1.2.0
  - @checkstack/satellite-common@0.5.0
  - @checkstack/auth-frontend@0.6.1
  - @checkstack/dashboard-frontend@0.7.1
  - @checkstack/frontend-api@0.5.1
  - @checkstack/gitops-frontend@0.4.1
  - @checkstack/tips-frontend@0.2.1
  - @checkstack/ui@1.8.1
  - @checkstack/signal-frontend@0.1.3

## 0.19.0

### Minor Changes

- 3547670: Wire the new tips infrastructure across the frontends:

  **Empty-state coaching.** Replace generic "no items" copy with onboarding
  guidance — short description, three numbered steps and a primary CTA — on
  every EmptyState that has a meaningful next action. Affects: catalog
  (systems + groups), dashboard, health-check page, integrations (subscriptions

  - provider connections), GitOps providers + secrets, GitOps provenance,
    SLO config + overview, maintenance config, satellites, plugin manager,
    incident config, announcements. Read-only EmptyStates (incident history,
    maintenance history, plugin events) get clearer descriptions explaining
    what would populate them.

  **First-run anchored tips.** Add `<Tip>` popovers to the most important
  "Create" affordances so first-time users see a one-line explanation of
  what they're about to make and why it matters: catalog “Add System” /
  “Add Group”, healthcheck “Create Check”, integrations “New Subscription”,
  GitOps “Add Provider”, SLO “Create SLO”, maintenance “Create Maintenance”,
  satellite “Create Satellite”, plugin-manager “Install plugin”, incident
  “Report Incident”, announcement “New Announcement”. Each tip is dismissed
  per user (server-backed when signed in, localStorage otherwise) and
  namespaced through `qualifyTipId(plugin, …)` so it cannot escape the
  plugin's own namespace.

  **Welcome banner on the dashboard.** A `<TipBanner>` at the top of the
  dashboard introduces Checkstack's main flow ("add a system, then a health
  check") with a one-click jump into the catalog.

### Patch Changes

- 950d6ec: Fix mobile UserMenu items rendering at zero height, group menu items by
  section, and unstack cramped card headers on small viewports.

  - **UserMenu mobile bug**: On mobile, the user-menu Sheet rendered every
    menu item as a grid row, which combined with `flex-shrink: 1` on each
    item collapsed the buttons whose internal layout uses `display: flex`
    (the items registered with `useNavigate` rather than `<Link>`) to zero
    content height. Switched the mobile container to a flex column with
    `[&>*]:shrink-0` and added `min-h-0` so the sheet scrolls correctly
    when the list overflows.

  - **UserMenu grouping**: Slot extensions now accept an optional `group`
    field. The user menu buckets `UserMenuItemsSlot` extensions by `group`
    and renders each group under a labeled header (`Workspace`,
    `Reliability`, `Configuration`, `Documentation`, `Account`). Existing
    core plugins are tagged with the appropriate group; third-party plugins
    can pick any of these or supply their own label. Untagged extensions
    render last with no header. `UserMenuItemsBottomSlot` is unaffected.

  - **Card header responsiveness**: `CardHeaderRow` (the primitive shared by
    Incident, Maintenance, Auth, Catalog, GitOps and other config cards) now
    stacks vertically on narrow viewports and only switches to a single row
    at the `sm` breakpoint, so titles and adjacent filter controls (e.g.
    status `Select`, "Show resolved" checkbox) no longer cram together on
    mobile. Refactored the Incident and Maintenance config pages to use the
    primitive instead of a hand-rolled `flex items-center justify-between`
    row, and made their `Select` triggers full-width on mobile.

- Updated dependencies [42abfff]
- Updated dependencies [42abfff]
- Updated dependencies [3547670]
- Updated dependencies [f6f9a5c]
- Updated dependencies [f6f9a5c]
- Updated dependencies [1ef2e79]
- Updated dependencies [aa89bc5]
- Updated dependencies [3547670]
- Updated dependencies [950d6ec]
- Updated dependencies [3547670]
- Updated dependencies [3547670]
  - @checkstack/anomaly-common@1.1.0
  - @checkstack/common@0.9.0
  - @checkstack/ui@1.8.0
  - @checkstack/satellite-common@0.4.0
  - @checkstack/gitops-frontend@0.4.0
  - @checkstack/catalog-common@2.1.0
  - @checkstack/frontend-api@0.5.0
  - @checkstack/tips-frontend@0.2.0
  - @checkstack/auth-frontend@0.6.0
  - @checkstack/dashboard-frontend@0.7.0
  - @checkstack/healthcheck-common@1.0.2
  - @checkstack/signal-frontend@0.1.2

## 0.18.2

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
  - @checkstack/catalog-common@2.0.1
  - @checkstack/common@0.8.0
  - @checkstack/dashboard-frontend@0.6.1
  - @checkstack/gitops-frontend@0.3.8
  - @checkstack/signal-frontend@0.1.1
  - @checkstack/ui@1.7.1
  - @checkstack/anomaly-common@1.0.1
  - @checkstack/auth-frontend@0.5.33
  - @checkstack/frontend-api@0.4.2
  - @checkstack/healthcheck-common@1.0.1
  - @checkstack/satellite-common@0.3.2

## 0.18.1

### Patch Changes

- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
- Updated dependencies [32d52c6]
  - @checkstack/anomaly-common@1.0.0
  - @checkstack/catalog-common@2.0.0
  - @checkstack/healthcheck-common@1.0.0
  - @checkstack/dashboard-frontend@0.6.0
  - @checkstack/frontend-api@0.4.1
  - @checkstack/auth-frontend@0.5.32
  - @checkstack/ui@1.7.0
  - @checkstack/satellite-common@0.3.1
  - @checkstack/gitops-frontend@0.3.7

## 0.18.0

### Minor Changes

- a914b31: Streamline system → healthcheck assignment flow by allowing in-context creation in both directions.

  - Adds an "Assign to systems" multi-select section to the healthcheck create flow (new "Systems" tree node), so a fresh check can be wired to one or more systems in a single save.
  - Adds a "+ Create new check" button on the system assignment IDE that opens the create flow pre-targeted at that system; on save, the new check is auto-assigned and the user is returned to the assignment IDE.
  - Pre-selects the originating system when the create flow is entered with a `?systemId=` query param, and forwards that param through the strategy picker.
  - Includes an info banner noting that health checks are reusable templates and can be assigned to additional systems at any time, to preserve the "configs are reusable" mental model.

- ac1e5d4: Refactor Status Timeline and Assertion charts to use Recharts with cursor-tracking tooltips, downsampling, and proportional pass/fail stacking.

  - Replaces div-based bar strips with Recharts `BarChart`, so hovering anywhere over the chart resolves the closest bucket.
  - Adds a lightweight time x-axis with smart tick formatting based on the bucket interval.
  - Caps bar count (60 for Status Timeline, 50 for Assertion) by aggregating adjacent buckets, so individual bars stay clickable on dense ranges.
  - Each downsampled Assertion bar is now stacked proportionally — green height shows passed runs and red height shows failed runs across the aggregated window, instead of a worst-case binary color.

### Patch Changes

- 208ad71: Centralize realtime cache invalidation: signals now carry their owning `pluginId` end-to-end, and a single `SignalAutoInvalidator` mounted near the React Query client invalidates `[[pluginId]]` for every incoming signal automatically.

  **Breaking change to `createSignal`** (`@checkstack/signal-common`): the factory now takes a single object argument with `pluginMetadata`, `event`, and `payloadSchema`. The signal id is constructed as `${pluginMetadata.pluginId}.${event}` and the resulting `Signal` carries a `pluginId` field. The `SignalMessage` wire envelope and `ServerToClientMessage` `signal` variant gained a `pluginId` field so the frontend can route invalidations without parsing the id.

  ```ts
  // Before
  export const ANOMALY_STATE_CHANGED = createSignal(
    "anomaly.state_changed",
    z.object({ ... }),
  );

  // After
  export const ANOMALY_STATE_CHANGED = createSignal({
    pluginMetadata,
    event: "state_changed",
    payloadSchema: z.object({ ... }),
  });
  ```

  **New plugin field**: `FrontendPlugin.foreignSignals?: Signal<unknown>[]` lets a plugin opt its `[[pluginId]]` cache into invalidation when another plugin's signal fires (e.g. `dependency-frontend` declares `[SYSTEM_STATUS_CHANGED]` because dependency payloads embed system status). Same-plugin signals must NOT be listed — they are always auto-invalidated.

  **Removed boilerplate**: per-component `useSignal(X, () => refetch())` and `useSignal(X, () => queryClient.invalidateQueries(...))` calls have been removed across `incident-frontend`, `maintenance-frontend`, `healthcheck-frontend`, `slo-frontend`, `dependency-frontend`, `satellite-frontend`, `announcement-frontend`, `notification-frontend`, and `dashboard-frontend`. The `NotificationBell` unread count is now derived directly from the `getUnreadCount` query (auto-invalidated) instead of a local state mirror.

  **User-visible bug fix**: the system detail page anomaly widget (`SystemAnomalyWidget`) now updates in real-time when anomalies change, with no per-widget signal subscription required. The dashboard status page also stays fresh on `ANOMALY_STATE_CHANGED`, `ANOMALY_BASELINE_UPDATED`, and `ANOMALY_TREND_DETECTED`.

  UI-state consumers that legitimately need a `useSignal` (the dashboard activity terminal, the queue lag alert, and the rolling-preset date refresh in `useHealthCheckData`) keep their handlers; the auto-invalidator runs alongside them.

- Updated dependencies [208ad71]
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.4.0
  - @checkstack/anomaly-common@0.3.0
  - @checkstack/healthcheck-common@0.13.0
  - @checkstack/satellite-common@0.3.0
  - @checkstack/dashboard-frontend@0.5.1
  - @checkstack/auth-frontend@0.5.31
  - @checkstack/catalog-common@1.5.3
  - @checkstack/gitops-frontend@0.3.6
  - @checkstack/ui@1.6.1

## 0.17.1

### Patch Changes

- 42b0832: Refactor auto-chart layout to make collector grouping more dominant. Chart titles now show only the metric label (e.g. "Avg Response Time") instead of the prefixed "{collectorId}: Metric" form. Collector groups display the collector name as a heading with a badge containing the full collector id. Cards now stack at full width and their contents are center-aligned.

## 0.17.0

### Minor Changes

- 8d1ef12: ## Anomaly Detection & UI Improvements

  ### Anomaly Detection Enhancements (Phase 2)

  - **`@checkstack/anomaly-backend`**: Implemented background baseline analyzer jobs and anomaly trend deviation detection mechanics.
  - **`@checkstack/anomaly-common`**: Added new baseline statistical logic and inference rules.
  - **`@checkstack/anomaly-frontend`**: Added new Anomaly Widget and refactored system detail rendering to be more human-readable.
  - **`@checkstack/dashboard-frontend`**: Refined the global anomaly widget and fixed hardcoded access gating to render appropriately.
  - **`@checkstack/healthcheck-backend`**: Connected executor telemetry to the anomaly pipeline.
  - **`@checkstack/healthcheck-frontend`**: Reconciled baseline display consistency in Drawer and charts.

  ### Notification Identifiers

  - **`@checkstack/incident-backend`**: Resolved system IDs to human-readable System Names within Incident notifications to eliminate ID-only alert content.
  - **`@checkstack/maintenance-backend`**: Adopted the same resolution strategy for Maintenance notifications to keep parity.

  ### UI Experience

  - **`@checkstack/incident-frontend`**: Fixed the "Back to X" BackLink to properly use `react-router` hook `useNavigate` instead of doing a full application reload.
  - **`@checkstack/healthcheck-frontend`**: Implemented `useNavigate` for seamless SPA back-linking.
  - **`@checkstack/integration-frontend`**: Updated connections and delivery logs links to navigate without hard reloads.

- 8d1ef12: Phase 2 of anomaly detection: trend drift detection.

  The background baseline analyzer now computes a linear regression slope across each field's chronologically-ordered history and runs a `detectDrift` evaluator that catches gradual "creeping degradation" never reaching the 3σ spike threshold. Drifts share the same `anomalies` table as spike anomalies via a new `kind` column (`spike` | `drift`, default `spike`); the existing suspicious → anomaly → recovered lifecycle is reused, ticking at the analyzer's hourly cadence with a default 2-run confirmation window.

  User-facing additions: a Trend Drift toggle and threshold slider on both the template and assignment anomaly settings panels (with per-field overrides), drift rows in the System Anomaly widget, dashed regression-line overlays on the auto-generated line charts, and a new `ANOMALY_TREND_DETECTED` signal for live UI updates. Plugin authors can disable drift per chartable field via `x-anomaly-drift-enabled: false` or tighten/loosen it via `x-anomaly-drift-threshold`.

### Patch Changes

- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
- Updated dependencies [8d1ef12]
  - @checkstack/healthcheck-common@0.12.0
  - @checkstack/anomaly-common@0.2.0
  - @checkstack/dashboard-frontend@0.5.0
  - @checkstack/common@0.7.0
  - @checkstack/ui@1.6.0
  - @checkstack/satellite-common@0.2.1
  - @checkstack/auth-frontend@0.5.30
  - @checkstack/catalog-common@1.5.2
  - @checkstack/frontend-api@0.3.11
  - @checkstack/gitops-frontend@0.3.5
  - @checkstack/signal-frontend@0.0.16

## 0.16.5

### Patch Changes

- c4e7560: Fix data integrity, cache invalidation, and mobile UI issues

  - **Centralized mutation cache invalidation**: Every mutation now automatically invalidates its plugin's query cache on success via the shared `createProcedureHook` in `orpc-query.tsx`. This ensures all views stay in sync without requiring individual components to remember manual `invalidateQueries` calls.
  - **Fixed oRPC query key matching**: Query keys use nested arrays (`[["pluginId"]]`) to correctly match oRPC's `[pathArray, options]` key structure. Fixed the broken flat-string pattern in `SystemBadgeDataProvider`.
  - **Fixed hourly aggregation duplication**: Added `NULLS NOT DISTINCT` to the `health_check_aggregates` unique constraint so local runs (`source_id = NULL`) correctly conflict-match instead of creating duplicate hourly buckets. Includes a migration to clean up existing duplicates.
  - **Fixed modal scrolling on mobile**: Added `max-height` + `overflow-y-auto` to `ConfirmationModal`, and refactored `Dialog` from translate-centering to flex-centering with `dvh` units for reliable mobile scroll containment.

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/dashboard-frontend@0.4.6
  - @checkstack/ui@1.5.1
  - @checkstack/auth-frontend@0.5.29
  - @checkstack/catalog-common@1.5.1
  - @checkstack/gitops-frontend@0.3.4

## 0.16.4

### Patch Changes

- Updated dependencies [298bf42]
  - @checkstack/catalog-common@1.5.0
  - @checkstack/dashboard-frontend@0.4.5

## 0.16.3

### Patch Changes

- Updated dependencies [57d54de]
  - @checkstack/gitops-frontend@0.3.3
  - @checkstack/dashboard-frontend@0.4.4

## 0.16.2

### Patch Changes

- @checkstack/dashboard-frontend@0.4.3
- @checkstack/auth-frontend@0.5.28
- @checkstack/catalog-common@1.4.1

## 0.16.1

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0
  - @checkstack/auth-frontend@0.5.27
  - @checkstack/dashboard-frontend@0.4.2
  - @checkstack/gitops-frontend@0.3.2

## 0.16.0

### Minor Changes

- 80cbc51: Enforce GitOps provenance lock on backend API endpoints to prevent manual configuration drift for synchronized resources.

### Patch Changes

- @checkstack/dashboard-frontend@0.4.1

## 0.15.0

### Minor Changes

- bb1fea0: Redesign system detail page with hero banner, two-column layout, plugin metric tiles, and health check slide-over drawer.

  ### New Components

  - **MetricTile** (`@checkstack/ui`): Compact stat tile with icon, label, value, variant coloring
  - **Sheet** (`@checkstack/ui`): Slide-over drawer built on Radix Dialog primitives

  ### New Extension Slot

  - **SystemOverviewMetricsSlot** (`@checkstack/catalog-common`): Plugin-contributed at-a-glance metric tiles in the system detail hero banner

  ### Layout Changes

  - System detail page now uses a hero banner with breadcrumb, status badges, and metric tile strip
  - Two-column layout: monitoring content (left) and system context (right)
  - Health checks rendered as compact card rows instead of heavy accordions
  - Clicking a health check opens a slide-over drawer with summary tiles, timeline charts, and recent runs
  - Right column uses lightweight borderless sections with dividers instead of heavy Card wrappers

  ### Plugin Extensions

  - Health check, SLO, Incident, and Maintenance plugins each contribute a metric tile to the hero banner

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/dashboard-frontend@0.4.0
  - @checkstack/ui@1.4.0
  - @checkstack/catalog-common@1.4.0
  - @checkstack/auth-frontend@0.5.26
  - @checkstack/gitops-frontend@0.3.1

## 0.14.2

### Patch Changes

- Updated dependencies [8ef367a]
- Updated dependencies [cb65e9d]
  - @checkstack/gitops-frontend@0.3.0
  - @checkstack/dashboard-frontend@0.3.35

## 0.14.1

### Patch Changes

- Updated dependencies [86bab6a]
  - @checkstack/gitops-frontend@0.2.1
  - @checkstack/dashboard-frontend@0.3.34

## 0.14.0

### Minor Changes

- 6c40b5b: ### GitOps Ecosystem: Healthcheck Kind Registration (Phase 5)

  **gitops-common**: Added required `resolveEntityRef` to `ReconcileContext`, enabling extension reconcilers to resolve cross-kind entity references (e.g., healthcheck refs in System extensions).

  **gitops-backend**: Updated reconciler to populate `resolveEntityRef` by querying local provenance — no RPC round-trip needed.

  **healthcheck-backend**: Registered `kind: Healthcheck` and `System → healthchecks` extension with the EntityKindRegistry:

  - Validates strategy configs against registered strategy schemas at reconcile time
  - Validates collector configs against registered collector schemas at reconcile time
  - Manages system ↔ healthcheck associations with automatic stale removal

  **healthcheck-frontend**: Added GitOps provenance locking to the HealthCheck IDE editor — GitOps-managed health checks show a lock banner and disable editing.

  **catalog-backend**: Updated test fixtures for new required `resolveEntityRef` context field.

### Patch Changes

- Updated dependencies [6c40b5b]
- Updated dependencies [6c40b5b]
- Updated dependencies [4b0934d]
  - @checkstack/gitops-frontend@0.2.0
  - @checkstack/ui@1.3.6
  - @checkstack/dashboard-frontend@0.3.33
  - @checkstack/auth-frontend@0.5.25

## 0.13.6

### Patch Changes

- aa2b3aa: fix: remove arbitrary hardcoded assertions in jenkins collectors (queue-info, node-health, job-status) to prevent silent fallback assertion failures, instead properly threading transport execution errors directly to the SingleRunChartGrid UI display widget via a new `_collectorError` result payload property.

## 0.13.5

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5
  - @checkstack/auth-frontend@0.5.24
  - @checkstack/dashboard-frontend@0.3.32

## 0.13.4

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4
  - @checkstack/auth-frontend@0.5.23
  - @checkstack/dashboard-frontend@0.3.31

## 0.13.3

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3
  - @checkstack/auth-frontend@0.5.22
  - @checkstack/dashboard-frontend@0.3.30

## 0.13.2

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2
  - @checkstack/dashboard-frontend@0.3.29
  - @checkstack/auth-frontend@0.5.21

## 0.13.1

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1
  - @checkstack/auth-frontend@0.5.20
  - @checkstack/dashboard-frontend@0.3.28

## 0.13.0

### Minor Changes

- 26d8bae: Distributed satellite health checks and Assignment IDE page

  **Satellite System**

  - New `satellite-backend`, `satellite-common`, `satellite-frontend`, and `satellite` agent packages for distributed health check execution
  - WebSocket-based satellite connectivity with authentication, heartbeats, and live configuration push
  - Satellite management UI with create dialog, status badges, and list page

  **Live Configuration Updates**

  - Added `assignmentChanged` hook to `healthcheck-backend` for cross-plugin communication
  - `satellite-backend` subscribes to assignment changes and pushes config updates to connected satellites in real-time

  **Assignment IDE Page**

  - Replaced the 1028-line modal-based `SystemHealthCheckAssignment` component with a full-page IDE layout
  - New modular components: `AssignmentTree`, `GeneralPanel`, `ThresholdsPanel`, `RetentionPanel`, `ExecutionPanel`
  - Added unassign capability and sorted assignment lists for stable ordering

  **Shared IDE Primitives**

  - Extracted `IDETreeNode`, `IDETreeSection`, `IDEStatusBar`, `IDELayout` to `@checkstack/ui` for cross-plugin reuse
  - Migrated existing health check IDE editor to use shared primitives

  **Infrastructure**

  - Added `Dockerfile.satellite` for containerized satellite deployment
  - WebSocket route registry in `@checkstack/backend` and `@checkstack/backend-api`

- 26d8bae: Source attribution and filtering for satellite health checks

  **Source Attribution**

  - Fixed satellite result attribution: runs from satellites now correctly display their source instead of defaulting to "Local"
  - Added `sourceId` and `sourceLabel` to both public and detailed history API responses

  **Source Filtering**

  - Added `sourceFilter` parameter to `getHistory`, `getDetailedHistory`, and `getDetailedAggregatedHistory` RPC endpoints
  - Source filter supports "local" (core-only), specific satellite UUID, or all sources
  - Filter applies to all three aggregation tiers (raw, hourly, daily)

  **Frontend**

  - System detail accordion shows source filter buttons (All / Local / per-satellite) next to date range filter
  - Filter applies to both charts and recent runs table
  - Source column added to the recent runs table with Local/Remote badges
  - Health check history detail page includes per-satellite source filter buttons

### Patch Changes

- Updated dependencies [26d8bae]
- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0
  - @checkstack/healthcheck-common@0.11.0
  - @checkstack/satellite-common@0.2.0
  - @checkstack/auth-frontend@0.5.19
  - @checkstack/dashboard-frontend@0.3.27

## 0.12.1

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
  - @checkstack/ui@1.2.1
  - @checkstack/auth-frontend@0.5.18
  - @checkstack/dashboard-frontend@0.3.26
  - @checkstack/frontend-api@0.3.9
  - @checkstack/catalog-common@1.3.1
  - @checkstack/healthcheck-common@0.10.1
  - @checkstack/signal-frontend@0.0.15

## 0.12.0

### Minor Changes

- 54a5f80: ### Health Check Editor Redesign — IDE-Style Experience

  Replaces the modal-based health check editor with a full-page, IDE-style experience:

  - **Strategy Picker Page**: New `/config/create` page with categorized strategy discovery, search filtering, and grouped card grid layout
  - **IDE Editor Page**: New `/config/:configId/edit` page with a split-view layout — explorer tree on the left, editor panel on the right
  - **Strategy Categories**: Introduces `StrategyCategory` enum with 16 categories (Networking, Database, Infrastructure, etc.) — all 13 strategy plugins now declare their category
  - **New RPC Endpoint**: Added `getConfiguration` (singular by ID) for efficient single-resource fetching on the edit page
  - **Explorer Tree**: Left-hand navigation with General, Check Items (collectors), and Access Control sections, with real-time validation indicators
  - **Validation Status Bar**: Bottom bar showing aggregated validation issues with clickable navigation
  - **Unsaved Changes Guard**: Browser `beforeunload` protection when the form is dirty
  - **Responsive Design**: Split-view on desktop, stacked layout on mobile
  - **Deleted**: Legacy `HealthCheckEditor.tsx` modal component

### Patch Changes

- Updated dependencies [54a5f80]
  - @checkstack/healthcheck-common@0.10.0
  - @checkstack/dashboard-frontend@0.3.25

## 0.11.8

### Patch Changes

- 1f191cf: Add SYSTEM_STATUS_CHANGED signal and dependency-driven notification improvements

  **healthcheck-common:**

  - New `SYSTEM_STATUS_CHANGED` signal that fires only on system-level health status transitions (healthy ↔ degraded ↔ unhealthy), providing a low-noise alternative to `HEALTH_CHECK_RUN_COMPLETED` for coarse-grained reactivity

  **healthcheck-backend:**

  - Broadcast `SYSTEM_STATUS_CHANGED` signal at both status transition code paths in the queue executor

  **healthcheck-frontend:**

  - Switch `SystemHealthBadge` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` to reduce unnecessary refetch noise

  **dashboard-frontend:**

  - Switch `SystemBadgeDataProvider` from `HEALTH_CHECK_RUN_COMPLETED` to `SYSTEM_STATUS_CHANGED` for more efficient badge updates

  **maintenance-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

  **incident-frontend:**

  - Clarify that notification suppression toggle also applies to downstream dependency-driven notifications

- Updated dependencies [1f191cf]
- Updated dependencies [3f36a64]
  - @checkstack/healthcheck-common@0.9.0
  - @checkstack/dashboard-frontend@0.3.24
  - @checkstack/catalog-common@1.3.0

## 0.11.7

### Patch Changes

- Updated dependencies [23c80bc]
  - @checkstack/ui@1.2.0
  - @checkstack/auth-frontend@0.5.17
  - @checkstack/dashboard-frontend@0.3.23

## 0.11.6

### Patch Changes

- Updated dependencies [e01945b]
  - @checkstack/auth-frontend@0.5.16
  - @checkstack/dashboard-frontend@0.3.22

## 0.11.5

### Patch Changes

- Updated dependencies [95aa716]
  - @checkstack/ui@1.1.5
  - @checkstack/auth-frontend@0.5.15
  - @checkstack/dashboard-frontend@0.3.21

## 0.11.4

### Patch Changes

- Updated dependencies [c0c0ed2]
- Updated dependencies [c0c0ed2]
  - @checkstack/auth-frontend@0.5.14
  - @checkstack/ui@1.1.4
  - @checkstack/catalog-common@1.2.11
  - @checkstack/dashboard-frontend@0.3.20

## 0.11.3

### Patch Changes

- 6c743d4: Resolve AJV version mismatch and update to 8.18.0 for security reasons. Also fixed a TypeScript error in the HealthCheck latency chart caused by the Recharts v3 API change.
- Updated dependencies [67158e2]
- Updated dependencies [6c743d4]
  - @checkstack/auth-frontend@0.5.13
  - @checkstack/catalog-common@1.2.10
  - @checkstack/common@0.6.4
  - @checkstack/dashboard-frontend@0.3.19
  - @checkstack/frontend-api@0.3.8
  - @checkstack/healthcheck-common@0.8.4
  - @checkstack/signal-frontend@0.0.14
  - @checkstack/ui@1.1.3

## 0.11.2

### Patch Changes

- Updated dependencies [0603d39]
  - @checkstack/frontend-api@0.3.7
  - @checkstack/auth-frontend@0.5.12
  - @checkstack/catalog-common@1.2.9
  - @checkstack/dashboard-frontend@0.3.18
  - @checkstack/ui@1.1.2

## 0.11.1

### Patch Changes

- Updated dependencies [0ebbe56]
- Updated dependencies [a340781]
- Updated dependencies [8d2660d]
  - @checkstack/common@0.6.3
  - @checkstack/ui@1.1.1
  - @checkstack/dashboard-frontend@0.3.17
  - @checkstack/auth-frontend@0.5.11
  - @checkstack/catalog-common@1.2.8
  - @checkstack/frontend-api@0.3.6
  - @checkstack/healthcheck-common@0.8.3
  - @checkstack/signal-frontend@0.0.13

## 0.11.0

### Minor Changes

- 84dd430: ## Single Run Auto-Charts

  Added `SingleRunChartGrid` component to display auto-generated charts for individual health check runs when viewing run history details.

  ### Features

  - Renders charts based on the strategy's `resultSchema` metadata (same as aggregated charts)
  - Supports all chart types: gauge, counter, boolean, text, status
  - Groups fields by collector instance with assertion status display
  - Updated `useStrategySchemas` hook to also return `resultSchema` for single-run visualization

  ### Changes

  - Simplified `ExpandedResultView` to show only basic run metadata (status, latency, connection)
  - Collector results and detailed data now displayed via `SingleRunChartGrid`

### Patch Changes

- c842373: ## Animated Numbers & Availability Stats Live Updates

  ### Features

  - **AnimatedNumber component** (`@checkstack/ui`): New reusable component that displays numbers with a smooth "rolling" animation when values change. Uses `requestAnimationFrame` with eased interpolation for a polished effect.
  - **useAnimatedNumber hook** (`@checkstack/ui`): Underlying hook for the animation logic, can be used directly for custom implementations.
  - **Live availability updates**: Availability stats (31-day and 365-day) now automatically refresh when new health check runs are received via signals.

  ### Usage

  ```tsx
  import { AnimatedNumber } from "@checkstack/ui";

  <AnimatedNumber
    value={99.95}
    suffix="%"
    decimals={2}
    duration={500}
    className="text-2xl font-bold text-green-500"
  />;
  ```

- c842373: ## Fix Counter Chart Multiplier Display

  Hide redundant "(1×)" multiplier suffix for single-value counters in auto-charts. For aggregated counter values like "Errors", the displayed value itself represents the count, so showing "(1×)" adds no information and is confusing.

- Updated dependencies [c842373]
  - @checkstack/ui@1.1.0
  - @checkstack/auth-frontend@0.5.10
  - @checkstack/dashboard-frontend@0.3.16

## 0.10.0

### Minor Changes

- 3dd1914: Migrate health check strategies to VersionedAggregated with \_type discriminator

  All 13 health check strategies now use `VersionedAggregated` for their `aggregatedResult` property, enabling automatic bucket merging with 100% mathematical fidelity.

  **Key changes:**

  - **`_type` discriminator**: All aggregated state objects now include a required `_type` field (`"average"`, `"rate"`, `"counter"`, `"minmax"`) for reliable type detection
  - The `HealthCheckStrategy` interface now requires `aggregatedResult` to be a `VersionedAggregated<AggregatedResultShape>`
  - Strategy/collector `mergeResult` methods return state objects with `_type` (e.g., `{ _type: "average", _sum, _count, avg }`)
  - `mergeAggregatedBucketResults`, `combineBuckets`, and `reaggregateBuckets` now require `registry` and `strategyId` parameters
  - `HealthCheckService` constructor now requires both `registry` and `collectorRegistry` parameters
  - Frontend `extractComputedValue` now uses `_type` discriminator for robust type detection

  **Breaking Change**: State objects now require `_type`. Merge functions automatically add `_type` to output. The bucket merging functions and `HealthCheckService` now require additional required parameters.

## 0.9.1

### Patch Changes

- Updated dependencies [f676e11]
  - @checkstack/ui@1.0.0
  - @checkstack/common@0.6.2
  - @checkstack/auth-frontend@0.5.9
  - @checkstack/dashboard-frontend@0.3.15
  - @checkstack/catalog-common@1.2.7
  - @checkstack/frontend-api@0.3.5
  - @checkstack/healthcheck-common@0.8.2
  - @checkstack/signal-frontend@0.0.12

## 0.9.0

### Minor Changes

- 1b9cb25: Unified chart data to always use aggregated history with fixed target points.

  **Breaking Changes:**

  - Removed `RawDiagramContext` type - chart context no longer has a `type` discriminator
  - Removed `TypedHealthCheckRun` type export - charts only use aggregated buckets now
  - Removed `createStrategyDiagramExtension` deprecated function
  - Removed `isAggregated` and `retentionConfig` from `useHealthCheckData` return value

  **Migration:**

  - Strategy diagram extensions should use `createDiagramExtensionFactory` instead of `createStrategyDiagramExtension`
  - Extensions no longer need separate `rawComponent` and `aggregatedComponent` - use a single `component` prop
  - `HealthCheckDiagramSlotContext` now always contains `buckets` array (no `type` field)

  **Benefits:**

  - Simplified frontend logic - no more mode switching based on retention config
  - Consistent chart visualization regardless of selected time range
  - Backend's cross-tier aggregation engine automatically selects optimal data source

  **Other Changes:**

  - Added warning message when configuring sub-minute check intervals, alerting users about potential performance implications

### Patch Changes

- f1ebac2: - Fixed raw data visualization being cut off when viewing "Last 24 hours" timeframe. The `useHealthCheckData` hook was incorrectly applying pagination limits to chart data queries, causing only the oldest runs to be displayed when there were more runs than the limit. Charts now fetch all runs within the selected date range.
  - Updated Status Timeline visualization for raw data to show stacked status distribution (green/yellow/red proportions) instead of the previous "worst status wins" approach. This makes the raw data view consistent with the aggregated data view.

## 0.8.2

### Patch Changes

- Updated dependencies [e5079e1]
- Updated dependencies [9551fd7]
  - @checkstack/catalog-common@1.2.6
  - @checkstack/ui@0.5.3
  - @checkstack/dashboard-frontend@0.3.14
  - @checkstack/auth-frontend@0.5.8

## 0.8.1

### Patch Changes

- 0b9fc58: Fix workspace:\* protocol resolution in published packages

  Published packages now correctly have resolved dependency versions instead of `workspace:*` references. This is achieved by using `bun publish` which properly resolves workspace protocol references.

- Updated dependencies [0b9fc58]
  - @checkstack/auth-frontend@0.5.7
  - @checkstack/catalog-common@1.2.5
  - @checkstack/common@0.6.1
  - @checkstack/dashboard-frontend@0.3.13
  - @checkstack/frontend-api@0.3.4
  - @checkstack/healthcheck-common@0.8.1
  - @checkstack/signal-frontend@0.0.11
  - @checkstack/ui@0.5.2

## 0.8.0

### Minor Changes

- d6f7449: Add availability statistics display to HealthCheckSystemOverview

  - New `getAvailabilityStats` RPC endpoint that calculates availability percentages for 31-day and 365-day periods
  - Availability is calculated as `(healthyRuns / totalRuns) * 100`
  - Data is sourced from both daily aggregates and recent raw runs to include the most up-to-date information
  - Frontend displays availability stats with color-coded badges (green ≥99.9%, yellow ≥99%, red <99%)
  - Shows total run counts for each period

### Patch Changes

- Updated dependencies [d6f7449]
  - @checkstack/healthcheck-common@0.8.0
  - @checkstack/dashboard-frontend@0.3.12

## 0.7.2

### Patch Changes

- e58e994: Fix runtime error in AutoChartGrid when mapping over values with undefined elements

  The filter functions `getAllBooleanValuesWithTime` and `getAllStringValuesWithTime` incorrectly checked `v !== null` instead of `v !== undefined`, allowing undefined elements to pass through and crash when accessing `.value`.

## 0.7.1

### Patch Changes

- deec10c: Fix production crash when opening health check accordion and enable sourcemaps

  - Fixed TypeError in `HealthCheckLatencyChart` where recharts Tooltip content function was returning `undefined` instead of `null`, causing "can't access property 'value', o is undefined" error
  - Enabled production sourcemaps in Vite config for better debugging of production errors

## 0.7.0

### Minor Changes

- 1f81b60: ### Clickable Run History with Deep Linking

  **Backend (`healthcheck-backend`):**

  - Added `getRunById` service method to fetch a single health check run by ID

  **Schema (`healthcheck-common`):**

  - Added `getRunById` RPC procedure for fetching individual runs
  - Added `historyRun` route for deep linking to specific runs (`/history/:systemId/:configurationId/:runId`)

  **Frontend (`healthcheck-frontend`):**

  - Table rows in Recent Runs and Run History now navigate to detailed view instead of expanding inline
  - Added "Selected Run" card that displays when navigating to a specific run
  - Extracted `ExpandedResultView` into reusable component
  - Fixed layout shift during table pagination by preserving previous data while loading
  - Removed accordion expansion in favor of consistent navigation UX

### Patch Changes

- 7a4c70e: Improved chart ordering consistency and status timeline readability

  - **Chart ordering**: All charts now display data from left (oldest) to right (newest) for consistency
    - Fixed `HealthCheckSparkline` to reverse status dots order
    - Fixed `AutoChartGrid` `getAllValues()` to return values in chronological order
    - Fixed `getLatestValue()` to return the newest run's value instead of the oldest
  - **Status timeline redesign**: Replaced thin bar charts with readable equal-width segment strips
    - Raw data: Each run gets equal visual space with 1px gaps between segments
    - Aggregated data: Each bucket shows stacked proportional segments for healthy/degraded/unhealthy
    - Added time span display in aggregated tooltips (e.g., "Jan 20, 09:00 - 10:00")
    - Removed Recharts dependency for timeline, now uses pure CSS flexbox
  - **Label update**: Renamed "Response Latency" chart to "Execution Duration" for accuracy
  - **UI polish**: Added "~" prefix to duration formats in AggregatedDataBanner

- 090143b: ### Health Check Aggregation & UI Fixes

  **Backend (`healthcheck-backend`):**

  - Fixed tail-end bucket truncation where the last aggregated bucket was cut off at the interval boundary instead of extending to the query end date
  - Added `rangeEnd` parameter to `reaggregateBuckets()` to properly extend the last bucket
  - Fixed cross-tier merge logic (`mergeTieredBuckets`) to prevent hourly aggregates from blocking fresh raw data

  **Schema (`healthcheck-common`):**

  - Added `bucketEnd` field to `AggregatedBucketBaseSchema` so frontends know the actual end time of each bucket

  **Frontend (`healthcheck-frontend`):**

  - Updated all components to use `bucket.bucketEnd` instead of calculating from `bucketIntervalSeconds`
  - Fixed aggregation mode detection: changed `>` to `>=` so 7-day queries use aggregated data when `rawRetentionDays` is 7
  - Added ref-based memoization in `useHealthCheckData` to prevent layout shift during signal-triggered refetches
  - Exposed `isFetching` state to show loading spinner during background refetches
  - Added debounced custom date range with Apply button to prevent fetching on every field change
  - Added validation preventing start date >= end date in custom ranges
  - Added sparkline downsampling: when there are 60+ data points, they are aggregated into buckets with informative tooltips

  **UI (`ui`):**

  - Fixed `DateRangeFilter` presets to use true sliding windows (removed `startOfDay` from 7-day and 30-day ranges)
  - Added `disabled` prop to `DateRangeFilter` and `DateTimePicker` components
  - Added `onCustomChange` prop to `DateRangeFilter` for debounced custom date handling
  - Improved layout: custom date pickers now inline with preset buttons on desktop
  - Added responsive mobile layout: date pickers stack vertically with down arrow
  - Added validation error display for invalid date ranges

- bc58c3f: ### Fix layout shift in paginated tables

  - Preserve previous table data during loading to prevent layout shift
  - Add inline loading spinner in table headers without affecting layout
  - Add opacity to table rows during loading to indicate data refresh

- Updated dependencies [1f81b60]
- Updated dependencies [090143b]
  - @checkstack/healthcheck-common@0.7.0
  - @checkstack/ui@0.5.1
  - @checkstack/dashboard-frontend@0.3.11
  - @checkstack/auth-frontend@0.5.6

## 0.6.0

### Minor Changes

- 11d2679: Add ability to pause health check configurations globally. When paused, health checks continue to be scheduled but execution is skipped for all systems using that configuration. Users with manage access can pause/resume from the Health Checks config page.

### Patch Changes

- 223081d: Add icon support to PageLayout and improve mobile responsiveness

  **PageLayout Icons:**

  - Added required `icon` prop to `PageLayout` and `PageHeader` components that accepts a Lucide icon component reference
  - Icons are rendered with consistent `h-6 w-6 text-primary` styling
  - Updated all page components to include appropriate icons in their headers

  **Mobile Layout Improvements:**

  - Standardized responsive padding in main app shell (`p-3` on mobile, `p-6` on desktop)
  - Added `CardHeaderRow` component for mobile-safe card headers with proper wrapping
  - Improved `DateRangeFilter` responsive behavior with vertical stacking on mobile
  - Migrated pages to use `PageLayout` for consistent responsive behavior

- Updated dependencies [11d2679]
- Updated dependencies [223081d]
  - @checkstack/healthcheck-common@0.6.0
  - @checkstack/ui@0.5.0
  - @checkstack/auth-frontend@0.5.5
  - @checkstack/dashboard-frontend@0.3.10

## 0.5.0

### Minor Changes

- ac3a4cf: ### Dynamic Bucket Sizing for Health Check Visualization

  Implements industry-standard dynamic bucket sizing for health check data aggregation, following patterns from Grafana/VictoriaMetrics.

  **What changed:**

  - Replaced fixed `bucketSize: "hourly" | "daily" | "auto"` with dynamic `targetPoints` parameter (default: 500)
  - Bucket interval is now calculated as `(endDate - startDate) / targetPoints` with a minimum of 1 second
  - Added `bucketIntervalSeconds` to aggregated response and individual buckets
  - Updated chart components to use dynamic time formatting based on bucket interval

  **Why:**

  - A 24-hour view with 1-second health checks previously returned 86,400+ data points, causing lag
  - Now returns ~500 data points regardless of timeframe, ensuring consistent chart performance
  - Charts still preserve visual fidelity through proper aggregation

  **Breaking Change:**

  - `bucketSize` parameter removed from `getAggregatedHistory` and `getDetailedAggregatedHistory` endpoints
  - Use `targetPoints` instead (defaults to 500 if not specified)

  ***

  ### Collector Aggregated Charts Fix

  Fixed issue where collector auto-charts (like HTTP request response time charts) were not showing in aggregated data mode.

  **What changed:**

  - Added `aggregatedResultSchema` to `CollectorDtoSchema`
  - Backend now returns collector aggregated schemas via `getCollectors` endpoint
  - Frontend `useStrategySchemas` hook now merges collector aggregated schemas
  - Service now calls each collector's `aggregateResult()` when building buckets
  - Aggregated collector data stored in `aggregatedResult.collectors[uuid]`

  **Why:**

  - Previously only strategy-level aggregated results were computed
  - Collectors like HTTP Request Collector have their own `aggregateResult` method
  - Without calling these, fields like `avgResponseTimeMs` and `successRate` were missing from aggregated buckets

### Patch Changes

- 095cf4e: ### Cross-Tier Data Aggregation

  Implements intelligent cross-tier querying for health check history, enabling seamless data retrieval across raw, hourly, and daily storage tiers.

  **What changed:**

  - `getAggregatedHistory` now queries all three tiers (raw, hourly, daily) in parallel
  - Added `NormalizedBucket` type for unified bucket format across tiers
  - Added `mergeTieredBuckets()` to merge data with priority (raw > hourly > daily)
  - Added `combineBuckets()` and `reaggregateBuckets()` for re-aggregation to target bucket size
  - Raw data preserves full granularity when available (uses target bucket interval)

  **Why:**

  - Previously, the API only queried raw runs, which are retained for a limited period (default 7 days)
  - For longer time ranges, data was missing because hourly/daily aggregates weren't queried
  - The retention job only runs periodically, so we can't assume tier boundaries based on config
  - Querying all tiers ensures no gaps in data coverage

  **Technical details:**

  - Additive metrics (counts, latencySum) are summed correctly for accurate averages
  - p95 latency uses max of source p95s as conservative upper-bound approximation
  - `aggregatedResult` (strategy-specific) is preserved for raw-only buckets

- 538e45d: Fixed 24-hour date range not returning correct data and improved chart display

  - Fixed missing `endDate` parameter in raw data queries causing data to extend beyond selected time range
  - Fixed incorrect 24-hour date calculation using `setHours()` - now uses `date-fns` `subHours()` for correct date math
  - Refactored `DateRangePreset` from string union to enum for improved type safety and IDE support
  - Exported `getPresetRange` function for reuse across components
  - Changed chart x-axis domain from `["auto", "auto"]` to `["dataMin", "dataMax"]` to remove padding gaps

- Updated dependencies [ac3a4cf]
- Updated dependencies [db1f56f]
- Updated dependencies [538e45d]
  - @checkstack/healthcheck-common@0.5.0
  - @checkstack/common@0.6.0
  - @checkstack/ui@0.4.1
  - @checkstack/dashboard-frontend@0.3.9
  - @checkstack/auth-frontend@0.5.4
  - @checkstack/catalog-common@1.2.4
  - @checkstack/frontend-api@0.3.3
  - @checkstack/signal-frontend@0.0.10

## 0.4.10

### Patch Changes

- d1324e6: Removed redundant inner scroll wrapper from HealthCheckEditor - Dialog now handles scrolling
- Updated dependencies [d1324e6]
- Updated dependencies [1f1f6c2]
- Updated dependencies [2c0822d]
  - @checkstack/ui@0.4.0
  - @checkstack/dashboard-frontend@0.3.8
  - @checkstack/auth-frontend@0.5.3

## 0.4.9

### Patch Changes

- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
- Updated dependencies [8a87cd4]
  - @checkstack/catalog-common@1.2.3
  - @checkstack/common@0.5.0
  - @checkstack/healthcheck-common@0.4.2
  - @checkstack/auth-frontend@0.5.2
  - @checkstack/dashboard-frontend@0.3.7
  - @checkstack/frontend-api@0.3.2
  - @checkstack/ui@0.3.1
  - @checkstack/signal-frontend@0.0.9

## 0.4.8

### Patch Changes

- @checkstack/dashboard-frontend@0.3.6

## 0.4.7

### Patch Changes

- Updated dependencies [83557c7]
- Updated dependencies [83557c7]
- Updated dependencies [d316128]
- Updated dependencies [6dbfab8]
  - @checkstack/ui@0.3.0
  - @checkstack/common@0.4.0
  - @checkstack/auth-frontend@0.5.1
  - @checkstack/dashboard-frontend@0.3.5
  - @checkstack/catalog-common@1.2.2
  - @checkstack/frontend-api@0.3.1
  - @checkstack/healthcheck-common@0.4.1
  - @checkstack/signal-frontend@0.0.8

## 0.4.6

### Patch Changes

- Updated dependencies [10aa9fb]
- Updated dependencies [d94121b]
  - @checkstack/auth-frontend@0.5.0
  - @checkstack/ui@0.2.4
  - @checkstack/dashboard-frontend@0.3.4

## 0.4.5

### Patch Changes

- Updated dependencies [cad3073]
  - @checkstack/dashboard-frontend@0.3.3

## 0.4.4

### Patch Changes

- Updated dependencies [f6464a2]
  - @checkstack/ui@0.2.3
  - @checkstack/auth-frontend@0.4.1
  - @checkstack/dashboard-frontend@0.3.2

## 0.4.3

### Patch Changes

- dd07c14: Fix collector add button failing in HTTP contexts by replacing `crypto.randomUUID()` with the `uuid` package

## 0.4.2

### Patch Changes

- Updated dependencies [df6ac7b]
  - @checkstack/auth-frontend@0.4.0
  - @checkstack/dashboard-frontend@0.3.1

## 0.4.1

### Patch Changes

- Updated dependencies [4eed42d]
  - @checkstack/frontend-api@0.3.0
  - @checkstack/dashboard-frontend@0.3.0
  - @checkstack/auth-frontend@0.3.1
  - @checkstack/catalog-common@1.2.1
  - @checkstack/ui@0.2.2

## 0.4.0

### Minor Changes

- 7a23261: ## TanStack Query Integration

  Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

  ### New Features

  - **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
  - **Automatic request deduplication**: Multiple components requesting the same data share a single network request
  - **Built-in caching**: Configurable stale time and cache duration per query
  - **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
  - **Background refetching**: Stale data is automatically refreshed when components mount

  ### Contract Changes

  All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

  ```typescript
  const getItems = proc()
    .meta({ operationType: "query", access: [access.read] })
    .output(z.array(itemSchema))
    .query();

  const createItem = proc()
    .meta({ operationType: "mutation", access: [access.manage] })
    .input(createItemSchema)
    .output(itemSchema)
    .mutation();
  ```

  ### Migration

  ```typescript
  // Before (forPlugin pattern)
  const api = useApi(myPluginApiRef);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    api.getItems().then(setItems);
  }, [api]);

  // After (usePluginClient pattern)
  const client = usePluginClient(MyPluginApi);
  const { data: items, isLoading } = client.getItems.useQuery({});
  ```

  ### Bug Fixes

  - Fixed `rpc.test.ts` test setup for middleware type inference
  - Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
  - Fixed null→undefined warnings in notification and queue frontends

### Patch Changes

- Updated dependencies [180be38]
- Updated dependencies [7a23261]
  - @checkstack/dashboard-frontend@0.2.0
  - @checkstack/frontend-api@0.2.0
  - @checkstack/common@0.3.0
  - @checkstack/auth-frontend@0.3.0
  - @checkstack/catalog-common@1.2.0
  - @checkstack/healthcheck-common@0.4.0
  - @checkstack/ui@0.2.1
  - @checkstack/signal-frontend@0.0.7

## 0.3.0

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

- 827b286: Add array assertion operators for string array fields

  New operators for asserting on array fields (e.g., playerNames in RCON collectors):

  - **includes** - Check if array contains a specific value
  - **notIncludes** - Check if array does NOT contain a specific value
  - **lengthEquals** - Check if array length equals a value
  - **lengthGreaterThan** - Check if array length is greater than a value
  - **lengthLessThan** - Check if array length is less than a value
  - **isEmpty** - Check if array is empty
  - **isNotEmpty** - Check if array has at least one element

  Also exports a new `arrayField()` schema factory for creating array assertion schemas.

### Patch Changes

- f533141: Enforce health result factory function usage via branded types

  - Added `healthResultSchema()` builder that enforces the use of factory functions at compile-time
  - Added `healthResultArray()` factory for array fields (e.g., DNS resolved values)
  - Added branded `HealthResultField<T>` type to mark schemas created by factory functions
  - Consolidated `ChartType` and `HealthResultMeta` into `@checkstack/common` as single source of truth
  - Updated all 12 health check strategies and 11 collectors to use `healthResultSchema()`
  - Using raw `z.number()` etc. inside `healthResultSchema()` now causes a TypeScript error

- Updated dependencies [9faec1f]
- Updated dependencies [95eeec7]
- Updated dependencies [f533141]
  - @checkstack/auth-frontend@0.2.0
  - @checkstack/catalog-common@1.1.0
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/healthcheck-common@0.3.0
  - @checkstack/ui@0.2.0
  - @checkstack/signal-frontend@0.0.6

## 0.2.0

### Minor Changes

- 8e43507: # Teams and Resource-Level Access Control

  This release introduces a comprehensive Teams system for organizing users and controlling access to resources at a granular level.

  ## Features

  ### Team Management

  - Create, update, and delete teams with name and description
  - Add/remove users from teams
  - Designate team managers with elevated privileges
  - View team membership and manager status

  ### Resource-Level Access Control

  - Grant teams access to specific resources (systems, health checks, incidents, maintenances)
  - Configure read-only or manage permissions per team
  - Resource-level "Team Only" mode that restricts access exclusively to team members
  - Separate `resourceAccessSettings` table for resource-level settings (not per-grant)
  - Automatic cleanup of grants when teams are deleted (database cascade)

  ### Middleware Integration

  - Extended `autoAuthMiddleware` to support resource access checks
  - Single-resource pre-handler validation for detail endpoints
  - Automatic list filtering for collection endpoints
  - S2S endpoints for access verification

  ### Frontend Components

  - `TeamsTab` component for managing teams in Auth Settings
  - `TeamAccessEditor` component for assigning team access to resources
  - Resource-level "Team Only" toggle in `TeamAccessEditor`
  - Integration into System, Health Check, Incident, and Maintenance editors

  ## Breaking Changes

  ### API Response Format Changes

  List endpoints now return objects with named keys instead of arrays directly:

  ```typescript
  // Before
  const systems = await catalogApi.getSystems();

  // After
  const { systems } = await catalogApi.getSystems();
  ```

  Affected endpoints:

  - `catalog.getSystems` → `{ systems: [...] }`
  - `healthcheck.getConfigurations` → `{ configurations: [...] }`
  - `incident.listIncidents` → `{ incidents: [...] }`
  - `maintenance.listMaintenances` → `{ maintenances: [...] }`

  ### User Identity Enrichment

  `RealUser` and `ApplicationUser` types now include `teamIds: string[]` field with team memberships.

  ## Documentation

  See `docs/backend/teams.md` for complete API reference and integration guide.

- 97c5a6b: Add UUID-based collector identification for better multiple collector support

  **Breaking Change**: Existing health check configurations with collectors need to be recreated.

  - Each collector instance now has a unique UUID assigned on creation
  - Collector results are stored under the UUID key with `_collectorId` and `_assertionFailed` metadata
  - Auto-charts correctly display separate charts for each collector instance
  - Charts are now grouped by collector instance with clear headings
  - Assertion status card shows pass/fail for each collector
  - Renamed "Success" to "HTTP Success" to clarify it's about HTTP request success
  - Fixed deletion of collectors not persisting to database
  - Fixed duplicate React key warnings in auto-chart grid

### Patch Changes

- 97c5a6b: Fix Radix UI accessibility warning in dialog components by adding visually hidden DialogDescription components
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/ui@0.1.0
  - @checkstack/auth-frontend@0.1.0
  - @checkstack/catalog-common@1.0.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/frontend-api@0.0.4
  - @checkstack/signal-frontend@0.0.5

## 0.1.0

### Minor Changes

- f5b1f49: Added support for nested collector result display in auto-charts and history table.

  - Updated `schema-parser.ts` to traverse `collectors.*` nested schemas and extract chart fields with dot-notation paths
  - Added `getFieldValue()` support for dot-notation paths like `collectors.request.responseTimeMs`
  - Added `ExpandedResultView` component to `HealthCheckRunsTable.tsx` that displays:
    - Connection info (status, latency, connection time)
    - Per-collector results as structured cards with key-value pairs

- f5b1f49: Added JSONPath assertions for response body validation and fully qualified strategy IDs.

  **JSONPath Assertions:**

  - Added `healthResultJSONPath()` factory in healthcheck-common for fields supporting JSONPath queries
  - Extended AssertionBuilder with jsonpath field type showing path input (e.g., `$.data.status`)
  - Added `jsonPath` field to `CollectorAssertionSchema` for persistence
  - HTTP Request collector body field now supports JSONPath assertions

  **Fully Qualified Strategy IDs:**

  - HealthCheckRegistry now uses scoped factories like CollectorRegistry
  - Strategies are stored with `pluginId.strategyId` format
  - Added `getStrategiesWithMeta()` method to HealthCheckRegistry interface
  - Router returns qualified IDs so frontend can correctly fetch collectors

  **UI Improvements:**

  - Save button disabled when collector configs have invalid required fields
  - Fixed nested button warning in CollectorList accordion

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/common@0.0.3
  - @checkstack/ui@0.0.4
  - @checkstack/catalog-common@0.0.3
  - @checkstack/frontend-api@0.0.3
  - @checkstack/signal-frontend@0.0.4

## 0.0.3

### Patch Changes

- cb82e4d: Improved `counter` and `pie` auto-chart types to show frequency distributions instead of just the latest value. Both chart types now count occurrences of each unique value across all runs/buckets, making them more intuitive for visualizing data like HTTP status codes.

  Changed HTTP health check chart annotations: `statusCode` now uses `pie` chart (distribution view), `contentType` now uses `counter` chart (frequency count).

  Fixed scrollbar hopping when health check signals update the accordion content. All charts now update silently without layout shift or loading state flicker.

  Refactored health check visualization architecture:

  - `HealthCheckStatusTimeline` and `HealthCheckLatencyChart` now accept `HealthCheckDiagramSlotContext` directly, handling data transformation internally
  - `HealthCheckDiagram` refactored to accept context from parent, ensuring all visualizations share the same data source and update together on signals
  - `HealthCheckSystemOverview` simplified to use `useHealthCheckData` hook for consolidated data fetching with automatic signal-driven refresh

  Added `silentRefetch()` method to `usePagination` hook for background data refreshes without showing loading indicators.

  Fixed `useSignal` hook to use a ref pattern internally, preventing stale closure issues. Callbacks now always access the latest values without requiring manual memoization or refs in consumer components.

  Added signal handling to `useHealthCheckData` hook for automatic chart refresh when health check runs complete.

- Updated dependencies [cb82e4d]
  - @checkstack/healthcheck-common@0.0.3
  - @checkstack/signal-frontend@0.0.3
  - @checkstack/ui@0.0.3

## 0.0.2

### Patch Changes

- d20d274: Initial release of all @checkstack packages. Rebranded from Checkmate to Checkstack with new npm organization @checkstack and domain checkstack.dev.
- Updated dependencies [d20d274]
  - @checkstack/catalog-common@0.0.2
  - @checkstack/common@0.0.2
  - @checkstack/frontend-api@0.0.2
  - @checkstack/healthcheck-common@0.0.2
  - @checkstack/signal-frontend@0.0.2
  - @checkstack/ui@0.0.2

## 0.2.0

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

- 0afa204: Subscribe health check charts and history table to real-time signal updates. Charts now display the full data for the selected time range independently from the paginated history table, and both update automatically when a health check run completes.
- 32ea706: ### User Menu Loading State Fix

  Fixed user menu items "popping in" one after another due to independent async permission checks.

  **Changes:**

  - Added `UserMenuItemsContext` interface with `permissions` and `hasCredentialAccount` to `@checkstack/frontend-api`
  - `LoginNavbarAction` now pre-fetches all permissions and credential account info before rendering the menu
  - All user menu item components now use the passed context for synchronous permission checks instead of async hooks
  - Uses `qualifyPermissionId` helper for fully-qualified permission IDs

  **Result:** All menu items appear simultaneously when the user menu opens.

- Updated dependencies [52231ef]
- Updated dependencies [b0124ef]
- Updated dependencies [54cc787]
- Updated dependencies [a65e002]
- Updated dependencies [ae33df2]
- Updated dependencies [32ea706]
  - @checkstack/ui@0.1.2
  - @checkstack/common@0.2.0
  - @checkstack/frontend-api@0.1.0
  - @checkstack/catalog-common@0.1.2
  - @checkstack/healthcheck-common@0.1.1
  - @checkstack/signal-frontend@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [0f8cc7d]
  - @checkstack/frontend-api@0.0.3
  - @checkstack/catalog-common@0.1.1
  - @checkstack/ui@0.1.1

## 0.1.0

### Minor Changes

- ae19ff6: Add configurable state thresholds for health check evaluation

  **@checkstack/backend-api:**

  - Added `VersionedData<T>` generic interface as base for all versioned data structures
  - `VersionedConfig<T>` now extends `VersionedData<T>` and adds `pluginId`
  - Added `migrateVersionedData()` utility function for running migrations on any `VersionedData` subtype

  **@checkstack/backend:**

  - Refactored `ConfigMigrationRunner` to use the new `migrateVersionedData` utility

  **@checkstack/healthcheck-common:**

  - Added state threshold schemas with two evaluation modes (consecutive, window)
  - Added `stateThresholds` field to `AssociateHealthCheckSchema`
  - Added `getSystemHealthStatus` RPC endpoint contract

  **@checkstack/healthcheck-backend:**

  - Added `stateThresholds` column to `system_health_checks` table
  - Added `state-evaluator.ts` with health status evaluation logic
  - Added `state-thresholds-migrations.ts` with migration infrastructure
  - Added `getSystemHealthStatus` RPC handler

  **@checkstack/healthcheck-frontend:**

  - Updated `SystemHealthBadge` to use new backend endpoint

- 0babb9c: Add public health status access and detailed history for admins

  **Permission changes:**

  - Added `healthcheck.status.read` permission with `isPublicDefault: true` for anonymous access
  - `getSystemHealthStatus`, `getSystemHealthOverview`, and `getHistory` now public
  - `getHistory` no longer returns `result` field (security)

  **New features:**

  - Added `getDetailedHistory` endpoint with `healthcheck.manage` permission
  - New `/healthcheck/history` page showing paginated run history with expandable result JSON

### Patch Changes

- Updated dependencies [eff5b4e]
- Updated dependencies [ffc28f6]
- Updated dependencies [4dd644d]
- Updated dependencies [ae19ff6]
- Updated dependencies [0babb9c]
- Updated dependencies [b55fae6]
- Updated dependencies [b354ab3]
  - @checkstack/ui@0.1.0
  - @checkstack/common@0.1.0
  - @checkstack/catalog-common@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/signal-frontend@0.1.0
  - @checkstack/frontend-api@0.0.2

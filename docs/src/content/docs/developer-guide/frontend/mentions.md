---
title: "Cross-entity mentions"
description: "How the # picker stores references to other records, and why the href is resolved per render context instead of being frozen at authoring time."
---

An operator writing an incident update often wants to point at another record -
the maintenance window that caused it, a related incident. Typing `#` in any
markdown field opens a picker over every mentionable record type and inserts a
reference.

## A mention stores what, never where

Pasting a URL is what operators did before, and it is wrong in three ways at
once: an admin URL is meaningless on a public status page, a status-page URL is
meaningless in the admin UI, and neither works in an email, which needs an
absolute address. One authored string cannot be correct in all three places.

So a mention records the *target*, not a location:

```text
[Database upgrade](checkstack:maintenance/9f1c-...)
```

That is an ordinary markdown link. The label stays readable in the raw source,
existing markdown tooling parses it unchanged, and a renderer that knows nothing
about mentions still shows the label. Only the **href** is resolved, per
context.

## Resolution may refuse, and that is the point

`resolveMention` returns `undefined` for a reference this context should not
link. The renderer then shows the label as plain text.

> [!CAUTION]
> This is a confidentiality requirement, not a nicety. An internal-only incident
> referenced from a public status update must not become a link - a dead link
> still confirms the incident exists.

Every resolver fails CLOSED: while a check is in flight, when a provider cannot
answer, and when the answer is no, the label renders as plain text. The prose
stays readable either way; only the link is withheld.

### The admin resolver checks VIEWABILITY

`useMentionResolution({ documents })` takes the authored documents a page is
about to render, collects their references, and asks each owning plugin - in one
batched request - which of them this viewer may actually read. Only confirmed
references become links.

```tsx
const mentionDocuments = useMemo(
  () => [incident?.description ?? "", ...(incident?.updates ?? []).map((u) => u.message)],
  [incident],
);
const { resolveMention } = useMentionResolution({ documents: mentionDocuments });
```

The documents are an input because a markdown renderer resolves each link
DURING render and cannot await anything, so the answer has to exist before
rendering starts.

The backing procedure (`resolveIncidentRefs` / `resolveMaintenanceRefs`) takes
ids and returns only those the caller may read. It is deliberately NOT a filter
over the plugin's own search list: that list is shaped for authoring - it is
capped at `MAX_MENTION_RESULTS`, and pagination would hide more - so a
reference missing from it is not evidence the reader cannot open it. It returns
ids and nothing else, so an unreadable record is indistinguishable from a
deleted one.

### Public pages resolve against the PAGE

A public status page links a reference only when the same page also publishes
the target, which is exactly the gate its detail pages already apply
(`resolveDetail`). So a mention to a maintenance window shown on the page
becomes a link to that window's public detail page, while a mention to an
internal-only incident stays plain text.

A widget opts in by declaring which mention type it surfaces, so the
status-page packages never learn what `"incident"` means:

```ts
{
  id: "incidents",
  mentionType: INCIDENT_MENTION_TYPE, // from incident-common
  resolveDetail: async ({ id, config, ctx }) => { /* ... */ },
}
```

> [!IMPORTANT]
> Keep the widget's `mentionType` equal to the `*_MENTION_TYPE` constant its
> frontend provider registers under. Both live in the plugin's `*-common` for
> exactly this reason - if they drift, public mentions silently stop resolving.

### Notification bodies flatten mentions

`checkstack:` is an internal scheme, and notification channels do not
understand it: the email sanitiser drops the href and leaves a dead anchor,
while Slack's mrkdwn emits `<checkstack:incident/123|Label>` and shows the
internal URI to the recipient. So `sanitizeUpdateMessage` removes the link and
keeps only the label, at the one point every channel's body flows through.

Linking instead would need a per-recipient URL and, to be correct, a
per-recipient permission check inside a fan-out that has neither. The
notification already deep-links to the item it is about; the mention is a live,
viewability-checked link once the reader opens it.

## Registering a type

The platform owns the contract; the plugin that owns the record type registers a
provider. No plugin ever imports another.

Register the routing half at module scope, so mentions resolve as soon as the
plugin loads:

```ts
import { registerMentionRoutes } from "@checkstack/frontend-api";

registerMentionRoutes({
  type: "incident", // STABLE - baked into every mention already written
  displayName: "Incidents",
  toRoute: ({ id }) =>
    resolveRoute(incidentRoutes.routes.detail, { incidentId: id }),
});
```

Search needs data, and data needs React, so it is installed separately by a
headless component mounted on an **app-level** slot:

```tsx
export const IncidentMentionRegistrar = () => {
  const client = usePluginClient(IncidentApi);
  // Closed records are INCLUDED - see "Ranking" below.
  const { data } = client.listIncidents.useQuery({ includeResolved: true });

  useEffect(() => {
    const candidates = (data?.incidents ?? []).map((incident) => ({
      id: incident.id,
      label: incident.title,
      description: `Incident - ${incident.status}`,
      isActive: incident.status !== "resolved",
    }));
    setMentionSearch({
      type: "incident",
      search: async ({ query }) => filterMentionCandidates({ candidates, query }),
    });
  }, [data]);

  return <></>;
};
```

> [!WARNING]
> Mount the registrar on `NavbarRightSlot` or another app-level slot, never on a
> per-row slot. A per-row slot mounts it once per visible row, turning one query
> into one query per row.

The search MUST only return records the caller may read. The suggestion list is
an information channel of its own: offering a title the viewer is not allowed to
see leaks it whether or not they pick it. Both built-in providers rely on their
list procedure's `listKey` post-filter for this.

### Ranking

Use `filterMentionCandidates` from `@checkstack/frontend-api` rather than
ranking in your own plugin, so every type is ordered the same way inside one
dropdown. It matches case-insensitively on the label and ranks:

1. **Active before closed**, keyed on `MentionSuggestion.isActive`.
2. **Prefix before mid-word** (only when something has been typed).
3. **Alphabetically**; with an empty query your own order is preserved, so the
   "just pressed `#`" list keeps the API's recency order.

Closed records are offered, not hidden - referencing a resolved incident from a
follow-up is a normal thing to write, and a picker that refuses makes it
unauthorable at exactly the moment you want it. Ranking them last is what keeps
that safe: finished records accumulate without bound while active ones do not.

> [!NOTE]
> Active-first outranks relevance, so an author hunting a CLOSED record by name
> will not see it while `MAX_MENTION_RESULTS` active records also match - they
> have to type enough to narrow the active set.

`isActive` is optional and treated as **active** when omitted, so a provider
with no lifecycle is not demoted below every other type's live records.

## Consuming it

```tsx
const { onMentionSearch, resolveMention } = useMentions();

<MarkdownEditor value={message} onChange={setMessage} onMentionSearch={onMentionSearch} />
<MarkdownBlock resolveMention={resolveMention}>{description}</MarkdownBlock>
```

Pass `onMentionSearch` to every markdown field whose content is rendered with a
`resolveMention` - descriptions as well as update messages. Omitting it does not
degrade gracefully: `#` becomes an ordinary character and the author gets no
picker, while the renderer still resolves references perfectly well, so the
field ends up readable but not writable.

The picker itself is a Radix `Popover` anchored to the textarea, so it renders
in a **portal** - inside a modal Dialog, into that dialog's content (see
`portalContainer`). Two consequences worth knowing: it is not a DOM descendant
of the editor, so tests must query the document rather than the editor's
container; and it escapes the editor shell's `overflow-hidden`, which is the
whole point - an absolutely-positioned list there is clipped to the height of
the field.

`ReferencedItems` derives a "referenced items" list by scanning the authored
markdown - the description plus every update - on each render:

```tsx
<ReferencedItems
  documents={[incident.description ?? "", ...incident.updates.map((u) => u.message)]}
  resolve={(ref) => {
    const url = resolveMention(ref);
    return url ? { ...ref, url } : undefined;
  }}
  renderLink={(reference) => <Link to={reference.url}>{reference.label}</Link>}
/>
```

Derived, not stored, deliberately: a second copy of the relationships would mean
two writers of the same fact, and an edit that removed a reference would leave
the stored copy behind. The label comes from the authored link text, so listing
a reference needs no lookup.

## Current coverage

| Surface | Resolves to | Gate |
|---------|-------------|------|
| Admin UI | in-app route | the owning plugin confirms this viewer may READ the target |
| Public status page | that page's public detail route | the page itself publishes the target |
| Notification bodies | nothing - flattened to the label | no per-recipient context exists |

A reference whose plugin is not installed, whose type has no public page, or
whose check has not returned yet renders as plain text everywhere.

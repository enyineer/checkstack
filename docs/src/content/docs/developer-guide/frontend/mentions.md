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
> still confirms the incident exists. A renderer given no resolver links
> nothing, which is the safe default, and that is why public surfaces currently
> render mentions as plain text.

### What the admin resolver does NOT check

Be precise about the guarantee. The built-in admin resolver maps a well-formed
reference to a route WITHOUT asking whether the target still exists or whether
this viewer may read it. So in the admin UI a mention to a deleted or
unreadable record renders as a link that leads to a not-found or an access
gate.

That is deliberate. The alternative - linking only records present in the
provider's fetched list - would silently downgrade valid references to plain
text whenever the list does not contain them, and it often would not: the
incident search excludes RESOLVED incidents by default, and any future
pagination would exclude more. Silently dropping a valid link is worse than a
link that lands on an access gate the backend already enforces.

The confidentiality property is carried by the PUBLIC renderers, which resolve
nothing.

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
  const { data } = client.listIncidents.useQuery({});

  useEffect(() => {
    setMentionSearch({ type: "incident", search: async ({ query }) => /* ... */ });
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

## Consuming it

```tsx
const { onMentionSearch, resolveMention } = useMentions();

<MarkdownEditor value={message} onChange={setMessage} onMentionSearch={onMentionSearch} />
<MarkdownBlock resolveMention={resolveMention}>{description}</MarkdownBlock>
```

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

Resolution is wired for the **admin UI** (incident and maintenance detail pages,
their update timelines, and their editors). Public status pages and notification
bodies do not resolve mentions yet, so a mention renders there as plain text -
the safe default described above, not a broken link.

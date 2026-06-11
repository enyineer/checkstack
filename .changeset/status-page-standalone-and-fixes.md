---
"@checkstack/frontend-api": minor
"@checkstack/frontend": patch
"@checkstack/status-page-frontend": patch
---

Status pages: render the public page without the admin chrome, fix slug auto-fill, and polish the widgets.

- **Standalone routes.** A plugin route may now set `standalone: true` to render
  WITHOUT the app chrome (no sidebar, header, ambient background, or command
  palette). The router renders standalone routes as siblings of a new shell
  LAYOUT route (`<Outlet/>`), so they show none of the authenticated UI while
  still living inside the API/session providers. The public status page
  (`/status/:slug`) uses it, so a published page no longer embeds the whole
  Checkstack admin UI.
- **Slug auto-fill fix.** In the "new status page" dialog the slug now follows
  the title as you type, until you edit the slug yourself (previously it stopped
  after the first character).
- **Widget polish.** The public renderers and page were redesigned to look like a
  real status page: a brand-accent top bar, a centered header, card sections with
  proper spacing, an icon-led status banner, clearer status pills, nicer uptime
  bars, an incident timeline, and severity-coloured incident badges.
- **Uptime "no data" fix.** A system with no run history in the window showed a
  misleading "0.00%"; the uptime widget now shows "No uptime data for this period
  yet" (a healthy system with no history is not 0% uptime), with accurate
  start/end date labels under the bars.

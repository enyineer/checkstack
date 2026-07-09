---
"@checkstack/satellite-frontend": minor
---

Add the ability to edit a satellite's name and region.

The satellite list only offered "Reset token" and "Delete" actions even though
the backend `updateSatellite` (PATCH) endpoint already existed. A new Edit
dialog (name + region, no credentials panel) is now available as a row action
and in the mobile card, respecting the GitOps provenance lock the same way
Delete does. The token is never touched by an edit.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

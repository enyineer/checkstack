---
"@checkstack/dashboard-frontend": patch
---

Fixed notification group subscription failing for catalog groups. The group ID format was using a colon separator and missing the entity type prefix, causing subscriptions to fail with "Notification group does not exist" error.

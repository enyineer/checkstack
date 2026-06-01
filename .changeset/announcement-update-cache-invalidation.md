---
"@checkstack/announcement-backend": patch
---

fix(announcement-backend): invalidate cache after updateAnnouncement

`updateAnnouncement` was missing the `await Promise.all([cache.invalidateAllActive(), cache.invalidateListAll()])` call that `createAnnouncement` and `deleteAnnouncement` already perform. This caused edited announcements (e.g. toggling active to false) to remain stale in both the admin list and the public active-announcements cache for up to the 45 s TTL, making the change appear to have no effect until the cache expired.

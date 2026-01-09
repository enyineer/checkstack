---
"@checkmate-monitor/auth-frontend": patch
"@checkmate-monitor/ui": patch
---

### Fix Access Denied Flash on Page Load

Fixed the "Access Denied" screen briefly flashing when loading permission-protected pages.

**Root cause:** The `usePermissions` hook was setting `loading: false` when the session was still pending, causing a brief moment where permissions appeared to be denied.

**Changes:**
- `usePermissions` hook now waits for session to finish loading (`isPending`) before determining permission state
- `PageLayout` component now treats `loading=undefined` with `allowed=false` as a loading state
- `AuthSettingsPage` now explicitly waits for permission hooks to finish loading before checking access

**Result:** Pages show a loading spinner until permissions are fully resolved, eliminating the flash.

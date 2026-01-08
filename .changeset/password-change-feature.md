---
"@checkmate-monitor/auth-common": minor
"@checkmate-monitor/auth-frontend": minor
---

Add password change functionality for credential-authenticated users

- Add `changePassword` route to auth-common
- Create `ChangePasswordPage.tsx` component with password validation, current password verification, and session revocation option
- Add "Change Password" menu item in User Menu
- Reuses patterns from existing password reset flow for consistency


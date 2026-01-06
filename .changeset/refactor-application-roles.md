---
"@checkmate-monitor/auth-common": minor
"@checkmate-monitor/auth-backend": minor
"@checkmate-monitor/auth-frontend": minor
---

Refactor application role assignment

- Removed role selection from the application creation dialog
- New applications now automatically receive the "Applications" role
- Roles are now manageable inline in the Applications table (similar to user role management)
- Added informational alert in create dialog explaining default role behavior

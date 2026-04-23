---
"@checkstack/dashboard-frontend": minor
"@checkstack/ui": patch
---

feat: implement active incident and maintenance overview sheets on dashboard

- Replaces direct routing on status cards with slide-out overview sheets to gracefully degrade for users without manage permissions
- Refactors dashboard system groups into a clean table-style list layout for better density
- Makes global status cards more compact

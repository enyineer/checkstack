---
"@checkmate-monitor/incident-frontend": patch
"@checkmate-monitor/maintenance-frontend": patch
---

Improve incident and maintenance detail page layout consistency and navigation

**Layout consistency:**
- Incident detail page now matches maintenance detail page structure
- Both use PageLayout wrapper with consistent card layout
- Affected systems moved into main details card with server icons
- Standardized padding, spacing, and description/date formatting

**Back navigation with system context:**
- Detail pages now track source system via `?from=systemId` query parameter
- "Back to History" navigates to the correct system's history page
- Works when navigating from system panels, history pages, or system detail page
- Falls back to first affected system if no query param present

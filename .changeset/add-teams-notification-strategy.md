---
"@checkmate-monitor/notification-teams-backend": minor
---

Add Microsoft Teams notification strategy - sends alerts to users via OAuth/Graph API

- Admin configures Azure AD app credentials (Tenant ID, Client ID, Client Secret)
- Users link their Microsoft account via OAuth flow
- Messages sent as Adaptive Cards to 1:1 chats via Graph API
- Supports importance-based coloring and action buttons
- Includes detailed admin setup instructions for Azure AD configuration

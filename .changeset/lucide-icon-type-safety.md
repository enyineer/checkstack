---
"@checkmate-monitor/common": minor
"@checkmate-monitor/backend-api": minor
"@checkmate-monitor/command-backend": patch
"@checkmate-monitor/ui": patch
"@checkmate-monitor/auth-common": patch
"@checkmate-monitor/auth-frontend": patch
"@checkmate-monitor/integration-backend": patch
"@checkmate-monitor/integration-frontend": patch
"@checkmate-monitor/notification-frontend": patch
"@checkmate-monitor/dashboard-frontend": patch
"@checkmate-monitor/incident-backend": patch
"@checkmate-monitor/notification-smtp-backend": patch
"@checkmate-monitor/notification-telegram-backend": patch
"@checkmate-monitor/auth-credential-backend": patch
"@checkmate-monitor/auth-ldap-backend": patch
"@checkmate-monitor/auth-github-backend": patch
---

Add compile-time type safety for Lucide icon names

- Add `LucideIconName` type and `lucideIconSchema` Zod schema to `@checkmate-monitor/common`
- Update backend interfaces (`AuthStrategy`, `NotificationStrategy`, `IntegrationProvider`, `CommandDefinition`) to use `LucideIconName`
- Update RPC contracts to use `lucideIconSchema` for proper type inference across RPC boundaries
- Simplify `SocialProviderButton` to use `DynamicIcon` directly (removes 30+ lines of pascalCase conversion)
- Replace static `iconMap` in `SearchDialog` with `DynamicIcon` for dynamic icon rendering
- Add fallback handling in `DynamicIcon` when icon name isn't found
- Fix legacy kebab-case icon names to PascalCase: `mail`→`Mail`, `send`→`Send`, `github`→`Github`, `key-round`→`KeyRound`, `network`→`Network`, `AlertCircle`→`CircleAlert`


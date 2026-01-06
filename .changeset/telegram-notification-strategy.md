---
"@checkmate-monitor/backend-api": minor
"@checkmate-monitor/notification-common": minor
"@checkmate-monitor/notification-backend": minor
"@checkmate-monitor/notification-frontend": minor
"@checkmate-monitor/auth-common": minor
"@checkmate-monitor/auth-backend": minor
"@checkmate-monitor/auth-frontend": minor
"@checkmate-monitor/ui": minor
"@checkmate-monitor/notification-telegram-backend": minor
"@checkmate-monitor/notification-smtp-backend": patch
"@checkmate-monitor/auth-github-backend": patch
"@checkmate-monitor/auth-ldap-backend": patch
---

# Strategy Instructions Support & Telegram Notification Plugin

## Strategy Instructions Interface

Added `adminInstructions` and `userInstructions` optional fields to the `NotificationStrategy` interface. These allow strategies to export markdown-formatted setup guides that are displayed in the configuration UI:

- **`adminInstructions`**: Shown when admins configure platform-wide strategy settings (e.g., how to create API keys)
- **`userInstructions`**: Shown when users configure their personal settings (e.g., how to link their account)

### Updated Components

- `StrategyConfigCard` now accepts an `instructions` prop and renders it before config sections
- `StrategyCard` passes `adminInstructions` to `StrategyConfigCard`
- `UserChannelCard` renders `userInstructions` when users need to connect

## New Telegram Notification Plugin

Added `@checkmate-monitor/notification-telegram-backend` plugin for sending notifications via Telegram:

- Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
- Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
- Includes comprehensive admin instructions for bot setup via @BotFather
- Includes user instructions for account linking

### Configuration

Admins need to configure a Telegram Bot Token obtained from @BotFather.

### User Linking

The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

---
"@checkmate/backend-api": minor
"@checkmate/notification-common": minor
"@checkmate/notification-backend": minor
"@checkmate/notification-frontend": minor
"@checkmate/ui": minor
"@checkmate/notification-telegram-backend": minor
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

Added `@checkmate/notification-telegram-backend` plugin for sending notifications via Telegram:

- Uses [grammY](https://grammy.dev/) framework for Telegram Bot API integration
- Sends messages with MarkdownV2 formatting and inline keyboard buttons for actions
- Includes comprehensive admin instructions for bot setup via @BotFather
- Includes user instructions for account linking

### Configuration

Admins need to configure a Telegram Bot Token obtained from @BotFather.

### User Linking

The strategy uses `contactResolution: { type: "custom" }` for Telegram Login Widget integration. Full frontend integration for the Login Widget is pending future work.

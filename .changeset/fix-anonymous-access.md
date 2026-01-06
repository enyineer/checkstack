---
"@checkmate-monitor/backend-api": minor
"@checkmate-monitor/backend": minor
---

fix: Anonymous and non-admin user authorization

- Fixed permission metadata preservation in `plugin-manager.ts` - changed from outdated `isDefault` field to `isAuthenticatedDefault` and `isPublicDefault`
- Added `pluginId` to `RpcContext` to enable proper permission ID matching
- Updated `autoAuthMiddleware` to prefix contract permission IDs with the pluginId from context, ensuring that contract permissions (e.g., `catalog.read`) correctly match database permissions (e.g., `catalog-backend.catalog.read`)
- Route now uses `/api/:pluginId/*` pattern with Hono path parameters for clean pluginId extraction

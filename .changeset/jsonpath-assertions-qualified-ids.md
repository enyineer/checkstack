---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/backend-api": patch
"@checkstack/backend": patch
---

Added JSONPath assertions for response body validation and fully qualified strategy IDs.

**JSONPath Assertions:**
- Added `healthResultJSONPath()` factory in healthcheck-common for fields supporting JSONPath queries
- Extended AssertionBuilder with jsonpath field type showing path input (e.g., `$.data.status`)
- Added `jsonPath` field to `CollectorAssertionSchema` for persistence
- HTTP Request collector body field now supports JSONPath assertions

**Fully Qualified Strategy IDs:**
- HealthCheckRegistry now uses scoped factories like CollectorRegistry
- Strategies are stored with `pluginId.strategyId` format
- Added `getStrategiesWithMeta()` method to HealthCheckRegistry interface
- Router returns qualified IDs so frontend can correctly fetch collectors

**UI Improvements:**
- Save button disabled when collector configs have invalid required fields
- Fixed nested button warning in CollectorList accordion

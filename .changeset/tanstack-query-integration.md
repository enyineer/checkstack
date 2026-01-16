---
"@checkstack/frontend-api": minor
"@checkstack/common": minor
"@checkstack/backend-api": patch
"@checkstack/frontend": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/auth-frontend": minor
"@checkstack/auth-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/command-frontend": minor
"@checkstack/command-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/incident-frontend": minor
"@checkstack/incident-common": minor
"@checkstack/incident-backend": patch
"@checkstack/maintenance-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": patch
"@checkstack/notification-frontend": minor
"@checkstack/notification-common": minor
"@checkstack/integration-frontend": minor
"@checkstack/integration-common": minor
"@checkstack/queue-frontend": minor
"@checkstack/queue-common": minor
"@checkstack/theme-frontend": minor
"@checkstack/theme-common": minor
"@checkstack/ui": patch
---

## TanStack Query Integration

Migrated all frontend components to use `usePluginClient` hook with TanStack Query integration, replacing the legacy `forPlugin()` pattern.

### New Features

- **`usePluginClient` hook**: Provides type-safe access to plugin APIs with `.useQuery()` and `.useMutation()` methods
- **Automatic request deduplication**: Multiple components requesting the same data share a single network request
- **Built-in caching**: Configurable stale time and cache duration per query
- **Loading/error states**: TanStack Query provides `isLoading`, `error`, `isRefetching` states automatically
- **Background refetching**: Stale data is automatically refreshed when components mount

### Contract Changes

All RPC contracts now require `operationType: "query"` or `operationType: "mutation"` metadata:

```typescript
const getItems = proc()
  .meta({ operationType: "query", access: [access.read] })
  .output(z.array(itemSchema))
  .query();

const createItem = proc()
  .meta({ operationType: "mutation", access: [access.manage] })
  .input(createItemSchema)
  .output(itemSchema)
  .mutation();
```

### Migration

```typescript
// Before (forPlugin pattern)
const api = useApi(myPluginApiRef);
const [items, setItems] = useState<Item[]>([]);
useEffect(() => { api.getItems().then(setItems); }, [api]);

// After (usePluginClient pattern)
const client = usePluginClient(MyPluginApi);
const { data: items, isLoading } = client.getItems.useQuery({});
```

### Bug Fixes

- Fixed `rpc.test.ts` test setup for middleware type inference
- Fixed `SearchDialog` to use `setQuery` instead of deprecated `search` method
- Fixed null→undefined warnings in notification and queue frontends

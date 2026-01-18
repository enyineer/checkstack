---
"@checkstack/common": minor
---

Refactored `accessPair` interface for cleaner access rule definitions

The `accessPair` function now uses a more intuitive interface where each level (read/manage) has its own configuration object:

```typescript
accessPair(
  "incident",
  {
    read: {
      description: "View incidents",
      isDefault: true,
      isPublic: true,
    },
    manage: {
      description: "Manage incidents",
    },
  },
  { idParam: "systemId" }
)
```

Also added `instanceAccess` field to `ProcedureMetadata` allowing bulk endpoints to share the same access rule as single endpoints with different filtering strategies.

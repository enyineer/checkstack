---
"@checkstack/backend-api": patch
---

Fixed anonymous user access to public endpoints with instance-level access rules

The RPC middleware now correctly checks if anonymous users have global access via the anonymous role before denying access to single-resource public endpoints. Also added support for contract-level `instanceAccess` override allowing bulk endpoints to share the same access rule as single endpoints.

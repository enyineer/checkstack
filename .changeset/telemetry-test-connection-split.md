---
"@checkstack/telemetry-common": minor
"@checkstack/telemetry-backend": minor
"@checkstack/telemetry-frontend": patch
---

Split telemetry "Test connection" so its authorization is contract-declared

`testSourceConfig` used to accept an optional `sourceId` (to reuse an existing
source's stored secrets) and verified MANAGE on that source with a hand-rolled
check in the handler - the one telemetry endpoint whose authorization was not
declared on the contract. It is now split into two procedures, each fully
declared:

- `testSourceConfig` - the fresh-editor dry run (no stored secrets), `typeScoped`
  at manage level, as before but with `sourceId` removed from its input.
- `testExistingSource` - the secret-reuse dry run, `sourceId` required and
  authorized by the `idParam` instanceAccess mode (MANAGE on that source),
  enforced by the middleware. The hand-rolled `assertCanManageSource` handler
  check is deleted.

The "Test connection" button calls whichever procedure fits (it has a `sourceId`
or not), so the UI is unchanged.

BREAKING CHANGE: `testSourceConfig` no longer accepts a `sourceId` - callers that
reused stored secrets by passing one must call the new `testExistingSource`
instead. Authorization behaviour is unchanged (still MANAGE on the referenced
source), only the endpoint split.

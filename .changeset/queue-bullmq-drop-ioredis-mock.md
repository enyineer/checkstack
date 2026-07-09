---
"@checkstack/queue-bullmq-backend": patch
---

Remove the unused `ioredis-mock` devDependency. It was declared but never
imported (the queue tests mock the `bullmq` module directly and the recurring-job
suite runs against a real Redis), so dropping it sheds the `fengari` Lua-VM
transitive surface it pulled in with no change to the package's behavior.

---
"@checkstack/healthcheck-frontend": minor
---

Show a "No environment configured" empty-state in the health-check assignment IDE's Execution tab when the current system belongs to no environment. Previously the panel still rendered the All/Specific/None fan-out selector even though those modes are meaningless without any environment, and only surfaced a small inline note while in Specific mode. The Environments subsection now collapses to a clear empty-state prompting you to attach environments to the system in the catalog, while local/satellite execution config stays usable.

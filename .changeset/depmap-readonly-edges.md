---
"@checkstack/dependency-frontend": patch
---

Fix dependency-map edges being invisible to users without manage access on the
systems. React Flow silently drops every edge whose source node has no source
handle, and the source handle was only rendered for systems the user may MANAGE
(the drag-to-connect gate from the RLAC frontend-gating change) - so a read-only
viewer with `dependency.dependency.read` + `dependency.map.read` saw all the
system nodes but zero edges. The source handle is now always rendered; manage
access gates only its connectability (`isConnectable` / `isConnectableStart`),
with the muted styling and explanatory tooltip kept for unmanaged systems.

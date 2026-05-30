---
"@checkstack/script-packages-backend": minor
"@checkstack/integration-script-backend": minor
---

Harden the script-packages store against three confirmed defects:

- **Tree GC no longer deletes live trees.** The tree garbage collector keyed
  its grace window on the materialized tree's dir mtime. A tree that had been
  `current` for days carried an ancient mtime, so it became eligible for
  deletion the instant it was superseded by a flip - and the post-flip sweep
  would then delete a tree that an in-flight run (which snapshots its
  resolution root at run start) was still pinned to. The flip now stamps a
  `.retired-at` marker into the superseded tree, and the grace window is
  measured from that retirement timestamp. A non-current tree with no marker
  is retained (and lazily back-filled) so it ages out instead of leaking, and
  is never deleted on a missing signal.

  BREAKING CHANGE: the tree-GC grace window is now measured from a tree's
  retirement time (when it stopped being `current`), not its dir mtime.
  Existing non-current trees with no `.retired-at` marker are retained on the
  first sweep and back-filled, then collected on a later sweep once the grace
  window elapses from the back-filled time.

- **Installer no longer leaves a plaintext registry token on disk after a
  failed resolve.** The central resolver wrote the auth-token-bearing
  `.npmrc` into its scratch dir but only removed the scratch dir on the
  success path; any failure between `bun install` and packing the cache
  entries left the token on disk. Scratch-dir removal now runs in a `finally`
  so the token is cleaned up on every exit path.

- **Tar extraction rejects symlink/hardlink entries.** Blob unpacking
  validated entry names against zip-slip but not link targets, so a symlink
  with a safe name but an escaping target (for example `-> /etc` or
  `-> ../../..`) passed; a later regular-file entry could then be written
  through it and escape the target directory. The listing pass now inspects
  entry types (`tar -tzvf`) and rejects any non-regular, non-directory entry.

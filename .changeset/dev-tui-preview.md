---
"@checkstack/scripts": patch
---

Add a `preview` mode to the dev TUI

`bun run preview` starts the dev TUI with the frontend serving its production
build (`vite preview`) instead of the dev server, so you can trace real
first-paint behavior on a throttled network. Backend and docker deps run as in
`dev`.

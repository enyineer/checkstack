---
"@checkstack/frontend": patch
"@checkstack/frontend-api": patch
---

Fix onboarding flow not appearing on fresh Docker deployments (issue #79)

The `.env.example` had `BASE_URL` defaulting to `http://localhost:5173`
(the Vite dev server port). Users copying this file verbatim for a Docker
deployment would get a frontend that silently made all API calls to the
wrong origin, causing empty state and extreme sluggishness.

**Changes:**

- `.env.example`: Adds clear comments explaining the value must match the 
  container's exposed port.
- `frontend-api` (`RuntimeConfigProvider`): Removes the silent fallback when
  `/api/config` returns an unreachable baseUrl — instead propagates the error 
  so it can be surfaced.
- `frontend` (`App.tsx`): Renders an actionable error screen when the backend
  config cannot be loaded, showing the exact `BASE_URL` fix and the
  `docker compose` command to recover.
- `docs/getting-started/docker.md`: Adds a dedicated troubleshooting section
  for this exact misconfiguration.

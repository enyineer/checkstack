---
"@checkstack/dependency-frontend": patch
---

Fixed a race condition in the Dependency Map where an auto-layout calculation could permanently override saved user locations when system data loaded faster than position data.

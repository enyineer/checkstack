---
"@checkstack/ai-frontend": minor
---

Show live thinking progress in the AI chat so a slow turn is distinguishable
from a stuck one. The streaming indicator now reports a server-driven step
heartbeat ("Working... (step 3)") that advances each agent round, and tool
activity lines read as friendly verb phrases ("Searching documentation",
"Reading health-check history") instead of raw tool ids. Both are derived from
stream events the SDK already sends, so there is no backend or protocol change.

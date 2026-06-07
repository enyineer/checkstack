---
"@checkstack/ai-backend": patch
---

fix(ai): make the chat off-topic classifier a deny-list (fewer false refusals)

The topical pre-classifier refused legitimate operations questions such as
"analyze the problems <system> has in <environment>" with "That looks outside
my scope". The system prompt was an allow-list that enumerated resources and
CRUD verbs, so anything phrased with an unlisted verb (analyze, investigate,
diagnose, ...) or about an unlisted concept could fall through to OFF_TOPIC.

The classifier is now a deny-list: everything is ON_TOPIC by default and only a
few clearly-unrelated categories (general-purpose coding help, creative
writing, math/homework, general trivia/world knowledge) are rejected. It no
longer enumerates resources, tools, or verbs, so adding new tools/resources
never requires a prompt edit. The fail-open parser is unchanged.

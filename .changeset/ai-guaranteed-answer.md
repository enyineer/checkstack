---
"@checkstack/ai-backend": minor
---

fix(ai): guarantee the agent turn always ends with an answer

The chat loop and the headless AI action cap tool-call rounds with
`stepCountIs(MAX_STEPS)`. A model that kept calling tools right up to the cap
made the loop terminate on a tool-call step with NO final text - the operator
got a blank reply and the AI action an empty summary. This was acute with
reasoning models (e.g. DeepSeek-R1 style), which put their work in the hidden
reasoning channel and "keep thinking about searching" indefinitely when a doc
search does not surface a clean answer.

The final allowed step is now a forced answer: `prepareStep` removes all tools
for that step (`activeTools: []`) and overrides the step system prompt to tell
the model its tool budget is spent and it must answer now from what it gathered
(saying so plainly if the docs do not cover the question, rather than guessing).
The same guard runs in the headless agent runner.

`activeTools: []` is used deliberately instead of `toolChoice: "none"`: with some
OpenAI-compatible models the latter makes the model emit its raw tool-call markup
as the answer text. Verified end-to-end against a reasoning model: a hard
conceptual question that previously returned an empty reply now returns a
grounded answer that correctly distinguishes what the docs cover from what they
do not.

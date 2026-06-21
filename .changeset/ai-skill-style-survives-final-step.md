---
"@checkstack/ai-backend": minor
---

Keep an active chat Skill's voice in force through the final answer.

A user Skill (e.g. "write like a redneck") held during tool-calling steps but
normalized back to professional tone in the synthesized reply. Cause: the
multi-step loop's forced final-answer step (`prepareFinalAnswerStep`) REPLACES
the whole system prompt with a tool-less "write your final answer now, be
concise" instruction - dropping the skill preamble on the exact step that writes
the user-visible answer.

The final-answer step now carries the active skill guidance through (appended
after the base final-answer instruction, so the style is the last thing the model
reads), so the skill's voice governs the synthesized reply too instead of being
silently dropped after tool calls.

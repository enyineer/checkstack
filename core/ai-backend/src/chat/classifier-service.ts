import { generateText, type LanguageModel, type LanguageModelUsage } from "ai";
import {
  buildClassifierPrompt,
  parseClassifierVerdict,
  type ClassifierVerdict,
} from "./classifier.logic";

/**
 * Result of a single classifier call: the verdict plus the (small) token usage
 * so the caller can record it against the spend ledger like any other model
 * call. Usage is best-effort - a provider that omits counts yields zeros.
 */
export interface ClassifierResult {
  verdict: ClassifierVerdict;
  usage: LanguageModelUsage;
}

/**
 * The model call used by the classifier. Defaults to the AI SDK's
 * `generateText` against the turn's resolved model; INJECTABLE (like the title
 * generator) so the chat-service short-circuit logic is unit-testable WITHOUT a
 * live provider mock.
 */
export type ClassifierTextGenerator = (args: {
  model: LanguageModel;
  system: string;
  prompt: string;
}) => Promise<{ text: string; usage: LanguageModelUsage }>;

/** Default generator: a cheap `generateText` reusing the turn's model. */
const defaultGenerateClassifierText: ClassifierTextGenerator = async ({
  model,
  system,
  prompt,
}) => {
  const { text, usage } = await generateText({ model, system, prompt });
  return { text, usage };
};

/**
 * Classify whether the user's message is on-topic for operating Checkstack.
 *
 * Runs the cheap classifier model call and parses its reply. The call is NOT
 * fail-open here: it propagates a thrown error so the caller can decide to
 * fail-open (proceed with the normal turn) AND distinguish a classifier outage
 * from a real OFF_TOPIC verdict. A non-throwing reply is parsed leniently
 * (ambiguous -> ON_TOPIC) by `parseClassifierVerdict`.
 */
export async function classifyTopic({
  model,
  userText,
  generate = defaultGenerateClassifierText,
}: {
  /** The already-built language model used for the turn (provider-agnostic). */
  model: LanguageModel;
  /** The user's new message text. */
  userText: string;
  /** Override the model call (tests inject a fake; defaults to generateText). */
  generate?: ClassifierTextGenerator;
}): Promise<ClassifierResult> {
  const { system, prompt } = buildClassifierPrompt({ userText });
  const { text, usage } = await generate({ model, system, prompt });
  return { verdict: parseClassifierVerdict(text), usage };
}

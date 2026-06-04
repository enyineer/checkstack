import { z } from "zod";
import type { AuthService } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import type { ChatService } from "./chat-service";
import { forwardableAuthHeaders } from "./read-invoker";

/** Body of a streaming chat turn POST (a new user message). */
const ChatTurnBodySchema = z.object({
  conversationId: z.string(),
  connectionId: z.string(),
  model: z.string().optional(),
  message: z.string().min(1),
});

/**
 * Body of a post-confirm-card decision POST: the operator applied or declined a
 * proposal and we stream the model's acknowledgment. The actual apply runs
 * separately via `applyTool`; this only carries the proposal token + decision.
 */
const ChatDecisionBodySchema = z.object({
  conversationId: z.string(),
  connectionId: z.string(),
  model: z.string().optional(),
  decision: z.object({
    token: z.string().min(1),
    kind: z.enum(["apply", "decline"]),
  }),
});

/** A /chat POST is either a new user turn or a confirm-card decision turn. */
const ChatRequestBodySchema = z.union([
  ChatTurnBodySchema,
  ChatDecisionBodySchema,
]);

/**
 * Raw HTTP handler for the streaming chat turn, mounted at /api/ai/chat. SSE
 * streaming requires a raw handler (oRPC does not stream), so authentication is
 * done here via the platform auth strategy — the SAME principal resolution as
 * every other request. The resolved principal must be a logged-in RealUser
 * (chat is RealUser-only); the credential never crosses to the browser.
 */
export function createChatRequestHandler({
  chatService,
  auth,
}: {
  chatService: ChatService;
  auth: AuthService;
}): (req: Request) => Promise<Response> {
  return async function handleChatRequest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    const principal = await auth.authenticate(req);
    if (!principal) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (principal.type !== "user") {
      // Applications/services use MCP, not the in-app chat.
      return Response.json(
        { error: "AI chat is available to logged-in users only." },
        { status: 403 },
      );
    }

    let body: z.infer<typeof ChatRequestBodySchema>;
    try {
      const parsed = ChatRequestBodySchema.safeParse(await req.json());
      if (!parsed.success) {
        return Response.json(
          { error: `Invalid request: ${parsed.error.message}` },
          { status: 400 },
        );
      }
      body = parsed.data;
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const forwardHeaders = forwardableAuthHeaders(req);
    try {
      // A decision turn (operator applied/declined a confirm card) vs a normal
      // user message turn. The union narrows on the presence of `decision`.
      if ("decision" in body) {
        return await chatService.streamDecision({
          principal,
          conversationId: body.conversationId,
          connectionId: body.connectionId,
          model: body.model,
          forwardHeaders,
          token: body.decision.token,
          decision: body.decision.kind,
        });
      }
      return await chatService.streamTurn({
        principal,
        conversationId: body.conversationId,
        connectionId: body.connectionId,
        model: body.model,
        forwardHeaders,
        userText: body.message,
      });
    } catch (error) {
      return Response.json(
        { error: extractErrorMessage(error, "Chat turn failed.") },
        { status: 500 },
      );
    }
  };
}

import { AskRequestSchema } from "@/lib/schemas/requests";
import type { Message, AskRequest } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://heritage-rag.softclicksolutionsgh.workers.dev/api/v1";

export interface StreamingOptions {
  onChunk?: (chunk: string) => void;
  onComplete?: (message: Message, conversationId: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Helper to get identity headers for native fetch
 */
async function getChatHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  try {
    const { getAnonymousId } = await import('@/lib/utils/anonymous-id');
    const anonId = getAnonymousId();
    if (anonId) {
      headers["X-Anonymous-ID"] = anonId;
    }
  } catch (error) {
    console.error("Error setting chat headers:", error);
  }
  
  return headers;
}

/**
 * Send a message to start a new conversation
 * Uses POST /api/v1/chat/new
 */
export async function askNewQuestion(
  query: string,
  model?: string,
  mode: string = "auto",
  options: StreamingOptions = {}
): Promise<{ message: Message; conversationId: string }> {
  const validatedRequest = AskRequestSchema.parse({ query, model, mode });

  try {
    const streamUrl = `${API_URL}/chat/new?stream=true`;
    console.log("🌐 [askNewQuestion] Calling endpoint:", streamUrl, "mode:", mode);
    
    // Get identity headers (fixes 401 bug)
    const headers = await getChatHeaders();

    const response = await fetch(streamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(validatedRequest),
      credentials: "include",
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Conversation not found. Please start a new chat.");
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }

    return handleStreamingResponse(response, options);
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Failed to send message");
    options.onError?.(err);
    throw err;
  }
}

/**
 * Send a message to continue an existing conversation
 * Uses POST /api/v1/chat/{conversation_id}
 */
export async function askQuestion(
  conversationId: string,
  query: string,
  model?: string,
  mode: string = "auto",
  options: StreamingOptions = {}
): Promise<{ message: Message; conversationId: string }> {
  const validatedRequest = AskRequestSchema.parse({ query, model, mode });

  try {
    const streamUrl = `${API_URL}/chat/${conversationId}?stream=true`;
    console.log("🌐 [askQuestion] Calling endpoint:", streamUrl, "mode:", mode);
    
    // Get identity headers (fixes 401 bug)
    const headers = await getChatHeaders();

    const response = await fetch(streamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(validatedRequest),
      credentials: "include",
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Conversation not found - suggest starting a new chat
        const err = new Error("Conversation not found. Starting new chat...");
        options.onError?.(err);
        throw err;
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }

    return handleStreamingResponse(response, options);
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Failed to send message");
    options.onError?.(err);
    throw err;
  }
}

/**
 * Handle streaming response from the API
 */
async function handleStreamingResponse(
  response: Response,
  options: StreamingOptions
): Promise<{ message: Message; conversationId: string }> {
  // Check if response is streaming
  const contentType = response.headers.get("content-type");
  const conversationId = response.headers.get("X-Conversation-Id") || "";

  if (contentType?.includes("text/plain") || contentType?.includes("text/event-stream")) {
    // Handle streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = "";
    let metaBuffer = "";
    let interactionId: string | undefined;

    if (!reader) {
      throw new Error("No response body reader available");
    }

    // The server appends "\n__META__:{...}" at end-of-stream — strip it so the
    // raw JSON never renders inside the assistant bubble.
    const META_RE = /\n__META__:(\{[^\n]*\})\n?/g;
    const META_ONE = /\n__META__:(\{[^\n]*\})\n?/;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      metaBuffer += decoder.decode(value, { stream: true });

      // Emit everything except a trailing (possibly partial) __META__ trailer.
      const metaStart = metaBuffer.indexOf("\n__META__:");
      const emit = metaStart === -1 ? metaBuffer : metaBuffer.slice(0, metaStart);
      if (emit) {
        accumulatedContent += emit;
        options.onChunk?.(emit);
      }
      metaBuffer = metaStart === -1 ? "" : metaBuffer.slice(metaStart);

      // If the full trailer arrived, extract the interaction id.
      const m = META_ONE.exec(metaBuffer);
      if (m) {
        try { interactionId = JSON.parse(m[1]).interactionId; } catch {}
      }
    }

    // Create message object from accumulated content
    const message: Message = {
      id: interactionId || `temp-${Date.now()}`,
      conversation_id: conversationId,
      role: "assistant",
      content: accumulatedContent.replace(META_RE, ""),
      created_at: new Date().toISOString(),
    };

    options.onComplete?.(message, conversationId);

    return { message, conversationId };
  } else {
    // Fallback to non-streaming JSON response
    const data = await response.json();
    const message: Message = {
      id: data.id || `temp-${Date.now()}`,
      conversation_id: data.conversation_id || conversationId,
      role: "assistant",
      content: data.response || data.content || "",
      created_at: data.created_at || new Date().toISOString(),
    };

    const finalConversationId = message.conversation_id || conversationId;
    options.onComplete?.(message, finalConversationId);

    return { message, conversationId: finalConversationId };
  }
}


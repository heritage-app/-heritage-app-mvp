import { AskRequestSchema } from "@/lib/schemas/requests";
import type { Message, AskRequest } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export interface StreamingOptions {
  onChunk?: (chunk: string) => void;
  onComplete?: (message: Message, conversationId: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Send a message to start a new conversation
 * Uses POST /api/v1/chat/new
 */
export async function askNewQuestion(
  query: string,
  options: StreamingOptions = {}
): Promise<{ message: Message; conversationId: string }> {
  const validatedRequest = AskRequestSchema.parse({ query });

  try {
    const streamUrl = `${API_URL}/chat/new?stream=true`;
    console.log("🌐 [askNewQuestion] Calling endpoint:", streamUrl);
    console.log("🌐 [askNewQuestion] Request body:", validatedRequest);
    const response = await fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validatedRequest),
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
  options: StreamingOptions = {}
): Promise<{ message: Message; conversationId: string }> {
  const validatedRequest = AskRequestSchema.parse({ query });

  try {
    const streamUrl = `${API_URL}/chat/${conversationId}?stream=true`;
    console.log("🌐 [askQuestion] Calling endpoint:", streamUrl);
    console.log("🌐 [askQuestion] Request body:", validatedRequest);
    const response = await fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validatedRequest),
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

    if (!reader) {
      throw new Error("No response body reader available");
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulatedContent += chunk;

      // Call onChunk callback
      options.onChunk?.(chunk);
    }

    // Create message object from accumulated content
    const message: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      role: "assistant",
      content: accumulatedContent,
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


import { apiClient } from "./client";
import { ConversationResponseSchema } from "@/lib/schemas/responses";
import type { ConversationsListResponse, Conversation } from "@/types";
import { z } from "zod";

export async function getConversations(
  limit: number = 50
): Promise<ConversationsListResponse> {
  const response = await apiClient.get("/conversations", {
    params: { limit },
  });
  return response.data;
}

export async function getConversationMessages(
  conversationId: string,
  limit?: number
): Promise<Conversation> {
  const response = await apiClient.get(`/conversations/${conversationId}/messages`, {
    params: limit ? { limit } : undefined,
  });
  return response.data;
}


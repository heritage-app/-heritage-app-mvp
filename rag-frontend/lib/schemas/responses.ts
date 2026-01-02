import { z } from "zod";

export const MessageResponseSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  created_at: z.string(),
});

export const ConversationListItemSchema = z.object({
  conversation_id: z.string(),
  title: z.string().nullable(),
  last_message_at: z.string().nullable(),
});

export const ConversationResponseSchema = z.object({
  conversation_id: z.string(),
  title: z.string().nullable(),
  messages: z.array(MessageResponseSchema),
  total: z.number(),
});

export const ConversationsListResponseSchema = z.object({
  conversations: z.array(ConversationListItemSchema),
  total: z.number(),
});

export const UploadResponseSchema = z.object({
  status: z.string(),
  file_path: z.string(),
  public_url: z.string().optional(),
  message: z.string(),
});

export const AskResponseSchema = z.object({
  conversation_id: z.string(),
  response: z.string(),
  query: z.string(),
});

export const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
});


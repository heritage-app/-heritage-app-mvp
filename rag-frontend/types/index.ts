import { z } from "zod";
import {
  MessageResponseSchema,
  ConversationResponseSchema,
  ConversationListItemSchema,
  ConversationsListResponseSchema,
  UploadResponseSchema,
  AskResponseSchema,
  HealthResponseSchema,
} from "@/lib/schemas/responses";
import {
  AskRequestSchema,
  UploadRequestSchema,
} from "@/lib/schemas/requests";

export type Message = z.infer<typeof MessageResponseSchema>;
export type Conversation = z.infer<typeof ConversationResponseSchema>;
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;
export type ConversationsListResponse = z.infer<
  typeof ConversationsListResponseSchema
>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type AskResponse = z.infer<typeof AskResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export type AskRequest = z.infer<typeof AskRequestSchema>;
export type UploadRequest = z.infer<typeof UploadRequestSchema>;




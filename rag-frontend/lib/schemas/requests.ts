import { z } from "zod";

export const AskRequestSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  // Note: conversation_id is now in the URL path, not in the request body
});

export const UploadRequestSchema = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
});


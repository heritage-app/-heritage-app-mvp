import { z } from "zod";

export const AskRequestSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  model: z.string().optional(),
  mode: z.string().optional().default("auto"),
});

export const UploadRequestSchema = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
});


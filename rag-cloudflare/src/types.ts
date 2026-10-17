/**
 * Shared types and Worker environment bindings.
 */

export interface Env {
  // Bindings (wrangler.toml)
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
  DOCS_BUCKET: R2Bucket;
  /** Static files in ./public (wrangler.toml [assets]). */
  ASSETS: Fetcher;
  /** Per-user cap on the agent's tool loop (wrangler.toml [[ratelimits]]). Optional: absent in local tests. */
  AGENT_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };

  // Vars
  LLM_MODEL: string;
  EMBEDDING_MODEL: string;
  CORS_ORIGINS: string;
  ACCESS_TOKEN_EXPIRE_MINUTES: string;
  SUPER_ADMIN_EMAIL: string;

  // Secrets
  JWT_SECRET: string;
  SUPER_ADMIN_PASSWORD?: string;
  /** Resend API key (invite emails). Unset = invite links are shared manually. */
  RESEND_API_KEY?: string;
  /** Invite sender address, e.g. "SpeakGa <invite@speakga.org>" — must be a verified Resend domain. */
  INVITE_EMAIL_FROM?: string;
  /** Google sign-in (OAuth client from Google Cloud Console). Both unset = no Google button. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/** Hono context variables set by auth middleware. */
export type Variables = {
  user?: UserRow;
  userId?: string | null;
  adminId?: string;
};

export interface UserRow {
  id: string;
  email: string;
  hashed_password: string;
  role: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  dob: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  title: string | null;
  summary: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface InteractionRow {
  id: string;
  conversation_id: string;
  user_id: string | null;
  is_guest: number;
  query: string;
  response: string;
  metadata: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  original_filename: string;
  unique_path: string;
  public_url: string | null;
  category: string | null;
  metadata: string | null;
  status: string;
  created_at: string;
}

/** A refined Bible verse record (16-field archival shape). */
export interface VerseRecord {
  id?: string;
  category?: string;
  source_name?: string;
  book?: string;
  traditional_book?: string;
  chapter_num?: number;
  chapter_ref?: string;
  chapter_title_ga?: string;
  chapter_title_en?: string;
  section_ga?: string;
  section_en?: string;
  verse_num?: number;
  verse_ref?: string;
  ga_verse_label?: string;
  reference_display?: string;
  ga?: string;
  en?: string;
  ga_version_name?: string;
  ga_version_abbr?: string;
  english_version_name?: string;
  english_version_abbr?: string;
  ga_label?: string;
  [key: string]: unknown;
}

/** A retrieved chunk with score + metadata (mirrors LlamaIndex NodeWithScore). */
export interface RetrievedNode {
  text: string;
  score: number;
  metadata: Record<string, any>;
}

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
export type RagMode = "auto" | "bible" | "general" | "agent";

export type { Category } from "./config";

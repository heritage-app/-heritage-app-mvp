/**
 * LLM via Workers AI (default @cf/meta/llama-3.1-8b-instruct).
 * Replaces OpenRouter/Gemini. Provides blocking + token-streaming helpers.
 */
import type { Env, ChatMessage } from "../types";

interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * Server-side model allowlist — never trust a client-supplied model id.
 * Anything outside this set (e.g. the Gemini ids the old frontend sent)
 * falls back to env.LLM_MODEL.
 */
const ALLOWED_MODELS = new Set([
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3-8b-instruct",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.2-1b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.1",
]);

function resolveModel(env: Env, requested?: string): string {
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  return env.LLM_MODEL;
}

/** Blocking completion -> full string. */
export async function chat(env: Env, messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const res: any = await env.AI.run(resolveModel(env, opts.model) as any, {
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
    stream: false,
  });
  return typeof res?.response === "string" ? res.response : String(res?.response ?? "");
}

/**
 * Streaming completion -> async generator of text tokens.
 * Workers AI streams SSE lines of the form: data: {"response":"..."}
 */
export async function* streamChat(
  env: Env,
  messages: ChatMessage[],
  opts: ChatOpts = {}
): AsyncGenerator<string> {
  const stream: any = await env.AI.run(resolveModel(env, opts.model) as any, {
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
    stream: true,
  });

  const reader = (stream as ReadableStream).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          if (typeof json.response === "string" && json.response) {
            yield json.response;
          }
        } catch {
          // partial JSON across chunks — ignore, it'll complete next read
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

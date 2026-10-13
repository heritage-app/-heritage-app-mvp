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

/**
 * The text of a model reply. Workers AI parses a reply that looks like JSON
 * and returns it as an object — a tool call the model wrote as text
 * ({"name": …, "parameters": …}), or a structured answer. String() of that
 * object is "[object Object]", which reached users as the answer. Take a text
 * field if there is one; anything else is no reply.
 */
export function replyText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  const o = response as Record<string, unknown>;
  if ("name" in o && ("parameters" in o || "arguments" in o)) return ""; // a tool call, not an answer
  for (const k of ["response", "answer", "text", "content", "message"]) {
    if (typeof o[k] === "string") return o[k] as string;
  }
  return "";
}

/** Blocking completion -> full string. */
export async function chat(env: Env, messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const res: any = await env.AI.run(resolveModel(env, opts.model) as any, {
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
    stream: false,
  });
  return replyText(res?.response);
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

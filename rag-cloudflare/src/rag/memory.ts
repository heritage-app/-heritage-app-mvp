/**
 * Memory window + conversation summarization/title (ported from app/rag/memory.py).
 */
import type { Env, ChatMessage } from "../types";
import { MEMORY_WINDOW_SIZE } from "../config";
import { getByConversation } from "../db/messages";
import { getSessionByIdAndUser, updateSummary, updateTitle } from "../db/sessions";
import { chat } from "./llm";
import { SUMMARIZATION_PROMPT, TITLE_GENERATION_SYSTEM, fill } from "./prompts";

/** Flatten interaction turns into role/content messages. */
async function getMessages(
  env: Env,
  conversationId: string,
  limit = MEMORY_WINDOW_SIZE
): Promise<ChatMessage[]> {
  const turns = await getByConversation(env, conversationId, limit);
  const flat: ChatMessage[] = [];
  for (const t of turns) {
    flat.push({ role: "user", content: t.query ?? "" });
    if (t.response) flat.push({ role: "assistant", content: t.response });
  }
  return flat;
}

export async function summarizeConversation(
  env: Env,
  conversationId: string,
  messages: ChatMessage[] | null,
  model?: string
): Promise<string | null> {
  try {
    const msgs = messages ?? (await getMessages(env, conversationId, 10));
    if (msgs.length < 3) return null;

    const conversationText = msgs
      .slice(-10)
      .map((m) => `${cap(m.role)}: ${m.content}`)
      .join("\n\n");

    const prompt = fill(SUMMARIZATION_PROMPT, {
      summary: "No existing summary.",
      messages: conversationText,
    });
    let summary = await chat(env, [{ role: "user", content: prompt }], {
      temperature: 0.1,
      maxTokens: 120,
      model,
    });

    if (["hello", "hi ", "how are you", "let's start"].some((g) => summary.toLowerCase().includes(g))) {
      return null;
    }

    summary = summary.trim().replace(/^["']|["']$/g, "");
    summary = summary.split(". ")[0].replace(/[.]*$/, "") + ".";

    if (summary && summary !== "Conversation started.") {
      await updateSummary(env, conversationId, summary);
    }
    return summary;
  } catch (e) {
    console.error(`Failed to summarize ${conversationId}:`, e);
    return null;
  }
}

export async function generateTitle(
  env: Env,
  conversationId: string,
  messages: ChatMessage[] | null,
  model?: string
): Promise<string | null> {
  try {
    const msgs = messages ?? (await getMessages(env, conversationId, 6));
    if (msgs.length === 0) return null;

    const userQuery = msgs.find((m) => m.role === "user")?.content ?? msgs[0].content;
    const assistantResp = msgs.find((m) => m.role === "assistant")?.content ?? "";

    let title = await chat(
      env,
      [
        { role: "system", content: TITLE_GENERATION_SYSTEM },
        {
          role: "user",
          content: `User: ${userQuery.slice(0, 200)}\nAssistant: ${assistantResp.slice(0, 300)}\n\nTitle:`,
        },
      ],
      { temperature: 0.7, maxTokens: 30, model }
    );

    title = title.trim().replace(/^["']|["']$/g, "").trim();
    if (title) await updateTitle(env, conversationId, title);
    return title;
  } catch (e) {
    console.error(`Failed to generate title for ${conversationId}:`, e);
    return null;
  }
}

export interface ConversationContext {
  summary: string | null;
  memoryWindow: ChatMessage[];
  title: string;
}

export async function getConversationContext(
  env: Env,
  conversationId: string,
  userId: string,
  model?: string
): Promise<ConversationContext> {
  const [session, messages] = await Promise.all([
    getSessionByIdAndUser(env, conversationId, userId),
    getMessages(env, conversationId, MEMORY_WINDOW_SIZE),
  ]);

  let title = session?.title ?? null;
  let summary = session?.summary ?? null;

  if (messages.length) {
    if (!title) title = await generateTitle(env, conversationId, messages, model);
    if (!summary && messages.length >= 3) {
      summary = await summarizeConversation(env, conversationId, messages, model);
    }
  }

  return {
    summary,
    memoryWindow: messages,
    title: title || "New Conversation",
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * AI-powered Ga language suggestions endpoint
 * Uses the RAG system to provide contextually relevant suggestions
 */

import type { Env } from "../types";

export interface SuggestionRequest {
  input: string;
  context: string;
  language: "ga" | "en";
}

export interface SuggestionResponse {
  suggestions: Array<{
    text: string;
    phonetic?: string;
    english?: string;
    context?: string;
    confidence: number;
  }>;
}

export async function handleSuggestions(request: Request, env: Env): Promise<Response> {
  try {
    const body: SuggestionRequest = await request.json();
    const { input, context, language } = body;

    if (!input || typeof input !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid input" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate AI-powered suggestions based on input and conversation context
    const suggestions = await generateAISuggestions(input, context || "", env);

    return new Response(
      JSON.stringify({ suggestions }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in suggestions endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Generate AI-powered suggestions using the LLM
 */
async function generateAISuggestions(
  input: string,
  context: string,
  env: Env
): Promise<SuggestionResponse["suggestions"]> {
  const prompt = `You are a Ga language expert. Based on the user's partial input and conversation context, suggest 3-5 relevant Ga words or phrases that would logically complete their thought.

User's partial input: "${input}"
Conversation context: "${context || "New conversation"}"

Rules:
1. Only suggest Ga language words/phrases
2. Include phonetic pronunciation for each suggestion
3. Include English translation
4. Provide brief context for when to use each suggestion
5. Assign a confidence score (0-1) based on relevance
6. Prioritize suggestions that match the partial input
7. Include common Ga numbers, Bible terms, and cultural phrases when relevant

Return as JSON:
{
  "suggestions": [
    {
      "text": "Ga word or phrase",
      "phonetic": "pronunciation guide",
      "english": "English translation",
      "context": "when to use this",
      "confidence": 0.9
    }
  ]
}`;

  try {
    // Import chat function dynamically to avoid circular dependencies
    const { chat } = await import("../rag/llm");

    // No model override: use the Workers AI default from env.LLM_MODEL
    // ("gemini-3-flash-preview" is not a Workers AI model and would 404).
    const response = await chat(env, [{ role: "user", content: prompt }], {
      temperature: 0.7,
    });

    // Parse the JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.suggestions || [];
    }

    // Fallback: return empty array if parsing fails
    return [];
  } catch (error) {
    console.error("Error generating AI suggestions:", error);
    return [];
  }
}
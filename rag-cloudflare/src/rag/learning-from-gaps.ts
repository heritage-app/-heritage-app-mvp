/**
 * Learning system for handling queries not in knowledge base
 * Turns "I don't know" into learning opportunities
 */

import type { Env, ChatMessage } from "../types";
import { getLearningGreeting } from "./dynamic-greetings";

export interface KnowledgeGap {
  id: string;
  query: string;
  queryType: string;
  timestamp: string;
  frequency: number;
  suggestedContent?: string;
  userSubmittedAnswer?: string;
  status: 'pending' | 'user_contributed' | 'prioritized' | 'resolved';
  category?: string;
}

/**
 * Log when a query cannot be answered from the knowledge base
 */
export async function logKnowledgeGap(
  env: Env,
  query: string,
  queryType: string,
  context?: string
): Promise<void> {
  const gapId = `gap:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Check if this gap already exists
    const existing = await env.DB.prepare(
      "SELECT * FROM knowledge_gaps WHERE query = ? LIMIT 1"
    ).bind(query.toLowerCase().trim()).first<KnowledgeGap>();

    if (existing) {
      // Increment frequency
      await env.DB.prepare(
        "UPDATE knowledge_gaps SET frequency = frequency + 1, last_seen = ? WHERE id = ?"
      ).bind(new Date().toISOString(), existing.id).run();
    } else {
      // Create new gap record
      await env.DB.prepare(
        `INSERT INTO knowledge_gaps (id, query, query_type, timestamp, frequency, status, context)
         VALUES (?, ?, ?, ?, 1, 'pending', ?)`
      ).bind(
        gapId,
        query.toLowerCase().trim(),
        queryType,
        new Date().toISOString(),
        context || null
      ).run();
    }
  } catch (error) {
    console.error("Failed to log knowledge gap:", error);
  }
}

/**
 * Generate helpful response when content is missing
 */
export function generateHelpfulNotFoundResponse(
  query: string,
  queryType: string,
  similarTopics?: string[]
): string {
  const greeting = getLearningGreeting();
  
  const responses: Record<string, string> = {
    bible: `${greeting} I don't have this Bible verse yet. I have Genesis–Deuteronomy. Know it? Share it and I'll add it.`,
    cultural: `${greeting} I don't have "${query}" in my cultural archives yet. Know about it? Teach me and I'll add it.`,
    translation: `${greeting} I don't know "${query}" yet. Know the Ga word? Share it and I'll add it.`,
    general: `${greeting} I don't have "${query}" yet. Know about it? Share it and I'll add it.`
  };

  return responses[queryType] || responses.general;
}

/**
 * Suggest similar content that might be relevant
 */
export function suggestSimilarContent(query: string, availableTopics: string[]): string[] {
  const queryLower = query.toLowerCase();
  const similar: string[] = [];

  for (const topic of availableTopics) {
    const topicLower = topic.toLowerCase();
    // Simple similarity check
    const queryWords = queryLower.split(/\s+/);
    const topicWords = topicLower.split(/\s+/);
    
    const commonWords = queryWords.filter(word => topicWords.includes(word));
    if (commonWords.length > 0) {
      similar.push(topic);
    }
  }

  return similar.slice(0, 3);
}

/**
 * Handle user contribution to fill knowledge gap
 */
export async function handleUserContribution(
  env: Env,
  query: string,
  userAnswer: string,
  category: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Store the contribution for review
    const contributionId = `contrib:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    
    await env.DB.prepare(
      `INSERT INTO user_contributions (id, original_query, user_answer, category, timestamp, status)
       VALUES (?, ?, ?, ?, ?, 'pending_review')`
    ).bind(
      contributionId,
      query,
      userAnswer,
      category,
      new Date().toISOString()
    ).run();

    // Update the knowledge gap status
    await env.DB.prepare(
      "UPDATE knowledge_gaps SET status = 'user_contributed', user_submitted_answer = ? WHERE query = ?"
    ).bind(userAnswer, query.toLowerCase().trim()).run();

    return {
      success: true,
      message: "Thank you for your contribution! Your answer will be reviewed and added to help others learn."
    };
  } catch (error) {
    console.error("Failed to store user contribution:", error);
    return {
      success: false,
      message: "I couldn't save your contribution right now, but thank you for trying!"
    };
  }
}

/**
 * Get learning insights - what should be added to knowledge base
 */
export async function getLearningInsights(env: Env): Promise<{
  topGaps: KnowledgeGap[];
  recentContributions: any[];
  suggestedAdditions: string[];
}> {
  try {
    // Get most frequent knowledge gaps
    const topGaps = await env.DB.prepare(
      "SELECT * FROM knowledge_gaps WHERE status != 'resolved' ORDER BY frequency DESC LIMIT 10"
    ).all<KnowledgeGap>();

    // Get recent user contributions
    const recentContributions = await env.DB.prepare(
      "SELECT * FROM user_contributions ORDER BY timestamp DESC LIMIT 5"
    ).all();

    // Generate suggestions based on gaps
    const suggestedAdditions = topGaps.results?.map(gap => 
      `Add content for: "${gap.query}" (requested ${gap.frequency} times)`
    ) || [];

    return {
      topGaps: topGaps.results || [],
      recentContributions: recentContributions.results || [],
      suggestedAdditions
    };
  } catch (error) {
    console.error("Failed to get learning insights:", error);
    return {
      topGaps: [],
      recentContributions: [],
      suggestedAdditions: []
    };
  }
}

/**
 * Check if query appears to be Ga language
 */
function isGaQuery(query: string): boolean {
  const gaPatterns = [
    /[ɛɔƐƆ]/, // Ga-specific characters
    /\b(ekome|enyɔ|etɛ|ejwɛ|enumɔ|ekpaa|kpawo|kpaanyɔ|nɛɛhu|nyɔŋma)\b/i, // Ga numbers
    /\b(yitso|kuku|bibele|ɛdzɛ|heɛ|daabi|akwei|mi nɔ|ɛfe|me fe|otukwajaŋ)\b/i, // Common Ga words
  ];
  
  return gaPatterns.some(pattern => pattern.test(query));
}

/**
 * Generate Ga-specific learning response
 */
function generateGaLearningResponse(query: string): string {
  const greeting = getLearningGreeting();
  
  return `${greeting} I don't know "${query}" yet. Know what it means? Share it and I'll add it.`;
}

/**
 * Enhanced "not found" response that offers learning opportunity
 */
export function generateLearningNotFoundResponse(
  query: string,
  queryType: string,
): string {
  if (isGaQuery(query)) {
    return generateGaLearningResponse(query);
  }
  
  const baseResponse = generateHelpfulNotFoundResponse(query, queryType);
  
  return baseResponse;
}
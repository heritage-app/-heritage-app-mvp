/**
 * Learning system for handling queries not in knowledge base
 * Turns "I don't know" into learning opportunities
 */

import type { Env, ChatMessage } from "../types";
import { cleanEnglish } from "./flagging";

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
  // Name the subject, not the whole question ("computer", not "how do you
  // say computer in ga"). The trailing phrases are what the client's
  // NOT_FOUND_MARKERS recognise — keep them word for word.
  const subject = cleanEnglish(query);
  const responses: Record<string, string> = {
    bible: `I couldn't find that verse in the archive — check the book, chapter and verse. Know it? Share the Ga and English version and I'll add it.`,
    cultural: `I don't have “${subject}” in the archive yet. Know about it? Share the Ga and English version and I'll add it.`,
    translation: `I don't know the Ga for “${subject}” yet. Know the Ga word? Share both Ga and English and I'll add it.`,
    general: `I don't have “${subject}” in the archive yet. Know about it? Share the Ga and English version and I'll add it.`
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
  category: string,
  contributorId?: string,
  aiIssues?: string
): Promise<{ success: boolean; message: string; hasConflict?: boolean; contribution_id?: string; conflictDetails?: any }> {
  try {
    const normalizedQuery = query.toLowerCase().trim();
    const normalizedAnswer = userAnswer.toLowerCase().trim();

    // Check for existing contributions on the same query
    const existing = await env.DB.prepare(
      `SELECT id, user_answer, agreement_score
       FROM user_contributions
       WHERE original_query = ? AND status != 'rejected'
       ORDER BY timestamp DESC`
    )
      .bind(normalizedQuery)
      .all<{ id: string; user_answer: string; agreement_score: number }>();

    let hasConflict = false;
    let agreementCount = 0;
    let conflictCount = 0;

    if (existing.results && existing.results.length > 0) {
      for (const e of existing.results) {
        const existingNorm = e.user_answer.toLowerCase().trim();
        const existingWords = new Set(existingNorm.split(/\s+/));
        const newWords = normalizedAnswer.split(/\s+/);
        const commonCount = newWords.filter((w) => existingWords.has(w)).length;
        const similarity = commonCount / Math.max(newWords.length, existingWords.size);

        if (similarity > 0.6) {
          agreementCount++;
          // Boost agreement score for agreeing contributions
          await env.DB.prepare(
            "UPDATE user_contributions SET agreement_score = ? WHERE id = ?"
          )
            .bind(e.agreement_score + 1, e.id)
            .run();
        } else {
          conflictCount++;
          hasConflict = true;
        }
      }
    }

    // Store the contribution
    const contributionId = `contrib:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    const conflictGroupId = hasConflict
      ? `conflict:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`
      : null;

    await env.DB.prepare(
      `INSERT INTO user_contributions (id, original_query, user_answer, category, timestamp, status,
       agreement_score, conflict_group_id, contribution_count, ai_confidence, contributor_id, ai_issues)
       VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?, 1, 0, ?, ?)`
    )
      .bind(
        contributionId,
        normalizedQuery,
        userAnswer,
        category,
        new Date().toISOString(),
        hasConflict ? 0 : 1,
        conflictGroupId,
        contributorId || null,
        aiIssues ?? "[]"
      )
      .run();

    // Side-effect writes are best-effort: the contribution row above is the
    // critical write — gap status and analytics must never fail the submit
    // (e.g. when D1's daily write budget is exhausted mid-request).
    try {
      await env.DB.prepare(
        "UPDATE knowledge_gaps SET status = 'user_contributed', user_submitted_answer = ? WHERE query = ?"
      )
        .bind(userAnswer, normalizedQuery).run();
    } catch (e) {
      console.warn("knowledge_gaps update failed (non-critical):", e);
    }

    try {
      await env.DB.prepare(
        "INSERT INTO learning_analytics (id, metric_name, metric_value, timestamp, metadata) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(
          crypto.randomUUID(),
          hasConflict ? "contribution.conflict" : "contribution.agreement",
          1,
          new Date().toISOString(),
          JSON.stringify({
            query: normalizedQuery,
            agreementCount,
            conflictCount,
          })
        )
        .run();
    } catch (e) {
      console.warn("learning_analytics insert failed (non-critical):", e);
    }

    return {
      success: true,
      hasConflict,
      contribution_id: contributionId,
      message: hasConflict
        ? `Thank you! Your answer differs from ${conflictCount} existing answer(s). It will be reviewed for accuracy.`
        : agreementCount > 0
          ? "Thank you! Your answer agrees with existing contributions."
          : "Thank you for your contribution! Your answer will be reviewed and added to help others learn.",
      conflictDetails: hasConflict
        ? { agreementCount, conflictCount, conflictGroupId }
        : undefined,
    };
  } catch (error) {
    console.error("Failed to store user contribution:", error);
    // Fail closed: hasConflict=true prevents callers from staging unverified
    // content into vocabulary when the contribution wasn't actually stored.
    return {
      success: false,
      hasConflict: true,
      message: "I couldn't save your contribution right now, but thank you for trying!",
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
  return `I don't know “${cleanEnglish(query)}” yet. Know what it means? Share both Ga and English and I'll add it.`;
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

  // A question asking for the Ga of something gets the translation wording.
  const towardGa = /\bin\s+ga\b|\bhow\s+(do\s+(you|i)\s+|to\s+)?say\b|\btranslate\b|\bga\s+(word|for)\b/i.test(query);
  const baseResponse = generateHelpfulNotFoundResponse(query, queryType === "general" && towardGa ? "translation" : queryType);

  return baseResponse;
}
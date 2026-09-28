/**
 * Conflict and agreement tracking routes for collaborative learning.
 */
import type { Env } from "../types";

export async function detectConflicts(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ query?: string; answer?: string; category?: string }>();
    const { query, answer, category } = body;

    if (!query || !answer) {
      return json({ error: "Missing required fields: query, answer" }, 400);
    }

    const normalizedQuery = query.toLowerCase().trim();
    const normalizedAnswer = answer.toLowerCase().trim();

    // Find existing contributions for the same query
    const existing = await env.DB.prepare(
      `SELECT id, user_answer, agreement_score, contribution_count
       FROM user_contributions
       WHERE original_query = ? AND status != 'rejected'
       ORDER BY timestamp DESC`
    )
      .bind(normalizedQuery)
      .all<{
        id: string;
        user_answer: string;
        agreement_score: number;
        contribution_count: number;
      }>();

    if (!existing.results || existing.results.length === 0) {
      // First contribution for this query - no conflicts possible
      return json({
        hasConflict: false,
        existingCount: 0,
        suggestion: null,
      });
    }

    // Check for similar answers (agreement) and different answers (conflict)
    const similarAnswers: string[] = [];
    const differentAnswers: string[] = [];

    for (const e of existing.results) {
      const existingNorm = e.user_answer.toLowerCase().trim();
      // Simple similarity: check if answers share >60% of words
      const existingWords = new Set(existingNorm.split(/\s+/));
      const newWords = normalizedAnswer.split(/\s+/);
      const commonCount = newWords.filter((w) => existingWords.has(w)).length;
      const similarity = commonCount / Math.max(newWords.length, existingWords.size);

      if (similarity > 0.6) {
        similarAnswers.push(e.user_answer);
      } else {
        differentAnswers.push(e.user_answer);
      }
    }

    const hasConflict = differentAnswers.length > 0;
    const agreementCount = similarAnswers.length;
    const totalExisting = existing.results.length;

    // Calculate agreement score
    const agreementScore = totalExisting > 0 ? agreementCount / totalExisting : 0;

    // Update agreement scores for existing contributions
    for (const e of existing.results) {
      const existingNorm = e.user_answer.toLowerCase().trim();
      const existingWords = new Set(existingNorm.split(/\s+/));
      const newWords = normalizedAnswer.split(/\s+/);
      const commonCount = newWords.filter((w) => existingWords.has(w)).length;
      const similarity = commonCount / Math.max(newWords.length, existingWords.size);

      const newScore = similarity > 0.6 ? e.agreement_score + 1 : e.agreement_score - 0.5;
      await env.DB.prepare(
        "UPDATE user_contributions SET agreement_score = ? WHERE id = ?"
      )
        .bind(Math.max(0, newScore), e.id)
        .run();
    }

    // If conflict, create or update conflict group
    let conflictGroupId = null;
    if (hasConflict) {
      conflictGroupId = `conflict:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
      
      // Log conflict to learning_analytics
      await env.DB.prepare(
        "INSERT INTO learning_analytics (id, metric_name, metric_value, timestamp, metadata) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(
          crypto.randomUUID(),
          "conflict.detected",
          1,
          new Date().toISOString(),
          JSON.stringify({
            query: normalizedQuery,
            existingAnswers: differentAnswers.length,
            newAnswer: answer,
          })
        )
        .run();
    }

    return json({
      hasConflict,
      existingCount: totalExisting,
      agreementCount,
      conflictCount: differentAnswers.length,
      agreementScore,
      conflictGroupId,
      existingAnswers: differentAnswers,
      agreeingAnswers: similarAnswers,
      suggestion: hasConflict
        ? `This query has ${differentAnswers.length} different answer(s). Your answer may need review.`
        : agreementCount > 0
          ? "Your answer agrees with existing contributions."
          : null,
    });
  } catch (error) {
    console.error("Error detecting conflicts:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function resolveConflict(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{
      query?: string;
      selectedAnswer?: string;
      conflictGroupId?: string;
    }>();
    const { query, selectedAnswer, conflictGroupId } = body;

    if (!query || !selectedAnswer) {
      return json({ error: "Missing required fields: query, selectedAnswer" }, 400);
    }

    const normalizedQuery = query.toLowerCase().trim();
    const normalizedSelected = selectedAnswer.toLowerCase().trim();

    // Update all contributions for this query - mark selected answer as resolved
    const existing = await env.DB.prepare(
      `SELECT id, user_answer FROM user_contributions 
       WHERE original_query = ? AND status != 'rejected'`
    )
      .bind(normalizedQuery)
      .all<{ id: string; user_answer: string }>();

    if (existing.results) {
      for (const e of existing.results) {
        const isCorrect =
          e.user_answer.toLowerCase().trim() === normalizedSelected;
        await env.DB.prepare(
          `UPDATE user_contributions 
           SET status = ?, conflict_group_id = ?, contribution_count = contribution_count + 1 
           WHERE id = ?`
        )
          .bind(
            isCorrect ? "approved" : "rejected",
            conflictGroupId || null,
            e.id
          )
          .run();
      }
    }

    // Update knowledge gap status
    await env.DB.prepare(
      "UPDATE knowledge_gaps SET status = 'resolved', user_submitted_answer = ? WHERE query = ?"
    )
      .bind(selectedAnswer, normalizedQuery)
      .run();

    // Log resolution
    await env.DB.prepare(
      "INSERT INTO learning_analytics (id, metric_name, metric_value, timestamp, metadata) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        crypto.randomUUID(),
        "conflict.resolved",
        1,
        new Date().toISOString(),
        JSON.stringify({ query: normalizedQuery, selectedAnswer })
      )
      .run();

    return json({
      status: "resolved",
      message: "Conflict resolved. The selected answer has been approved.",
    });
  } catch (error) {
    console.error("Error resolving conflict:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function getConflictStats(request: Request, env: Env): Promise<Response> {
  try {
    const stats = await env.DB.prepare(
      `SELECT 
         COUNT(CASE WHEN status = 'pending_review' THEN 1 END) as pending,
         COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
         COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
         COUNT(CASE WHEN conflict_group_id IS NOT NULL THEN 1 END) as conflicted,
         COUNT(*) as total
       FROM user_contributions`
    ).first<{
      pending: number;
      approved: number;
      rejected: number;
      conflicted: number;
      total: number;
    }>();

    const recentConflicts = await env.DB.prepare(
      `SELECT original_query, COUNT(*) as answer_count 
       FROM user_contributions 
       WHERE status = 'pending_review'
       GROUP BY original_query 
       HAVING COUNT(*) > 1
       ORDER BY MAX(timestamp) DESC 
       LIMIT 10`
    ).all<{ original_query: string; answer_count: number }>();

    return json({
      stats: stats || { pending: 0, approved: 0, rejected: 0, conflicted: 0, total: 0 },
      recentConflicts: recentConflicts.results || [],
    });
  } catch (error) {
    console.error("Error fetching conflict stats:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

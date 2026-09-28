/**
 * Learning and knowledge gap management routes
 */

import type { Env } from "../types";
import {
  getLearningInsights,
  handleUserContribution as submitContribution,
} from "../rag/learning-from-gaps";
import { resolveUserId } from "../auth/jwt";

export async function handleLearningInsights(request: Request, env: Env): Promise<Response> {
  try {
    const insights = await getLearningInsights(env);
    
    return new Response(
      JSON.stringify(insights),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching learning insights:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch learning insights" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function handleUserContribution(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{ query?: string; userAnswer?: string; category?: string }>();
    const { query, userAnswer, category } = body;

    if (!query || !userAnswer || !category) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: query, userAnswer, category" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const userId = await resolveUserId(request, env);
    const result = await submitContribution(env, query, userAnswer, category, userId);
    
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error handling user contribution:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process contribution" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/** Comprehensive admin insights combining all learning data. */
export async function handleAdminInsights(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get("days") ?? "30", 10) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [feedbackStats, topContributors, gapSummary, conflictRate, recentActivity] =
      await Promise.all([
        env.DB.prepare(
          `SELECT rating, COUNT(*) as count FROM response_feedback WHERE created_at >= ? GROUP BY rating`
        )
          .bind(since)
          .all<{ rating: string; count: number }>(),
        env.DB.prepare(
          `SELECT contributor_id AS user_id, COUNT(*) as contributions,
                  SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved
           FROM user_contributions WHERE timestamp >= ? AND contributor_id IS NOT NULL
           GROUP BY contributor_id ORDER BY contributions DESC LIMIT 10`
        )
          .bind(since)
          .all<{ user_id: string; contributions: number; approved: number }>(),
        env.DB.prepare(
          `SELECT status, COUNT(*) as count FROM knowledge_gaps GROUP BY status`
        ).all<{ status: string; count: number }>(),
        env.DB.prepare(
          `SELECT COUNT(*) as total,
                  COUNT(CASE WHEN conflict_group_id IS NOT NULL THEN 1 END) as conflicted
           FROM user_contributions WHERE timestamp >= ?`
        )
          .bind(since)
          .first<{ total: number; conflicted: number }>(),
        env.DB.prepare(
          `SELECT metric_name, COUNT(*) as count FROM learning_analytics 
           WHERE timestamp >= ? GROUP BY metric_name ORDER BY count DESC`
        )
          .bind(since)
          .all<{ metric_name: string; count: number }>(),
      ]);

    const fbHelpful = feedbackStats.results?.find((r) => r.rating === "helpful")?.count ?? 0;
    const fbNotHelpful = feedbackStats.results?.find((r) => r.rating === "not_helpful")?.count ?? 0;
    const fb = {
      helpful: fbHelpful,
      notHelpful: fbNotHelpful,
      total: fbHelpful + fbNotHelpful,
    };

    const gaps: Record<string, number> = {};
    for (const r of gapSummary.results || []) gaps[r.status] = r.count;

    return new Response(
      JSON.stringify({
        period: `${days} days`,
        feedback: fb,
        topContributors: topContributors.results || [],
        knowledgeGaps: gaps,
        conflictRate: {
          total: conflictRate?.total ?? 0,
          conflicted: conflictRate?.conflicted ?? 0,
          rate: (conflictRate?.total ?? 0) > 0 ? (conflictRate?.conflicted ?? 0) / (conflictRate?.total ?? 1) : 0,
        },
        recentActivity: recentActivity.results || [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching admin insights:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch admin insights" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
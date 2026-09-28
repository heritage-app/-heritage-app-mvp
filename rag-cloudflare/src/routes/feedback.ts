/**
 * Response feedback routes — thumbs up/down on bot responses.
 *
 * When rating is `not_helpful`, an optional `correction` field captures what
 * was wrong. If the correction contains both an English and Ga term, it's
 * automatically staged as a user_contribution for review — turning negative
 * feedback into a learning signal without requiring a separate API call.
 */
import type { Env } from "../types";
import { handleUserContribution } from "../rag/learning-from-gaps";
import { resolveUserId } from "../auth/jwt";

export async function handleFeedback(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json<{
      interaction_id?: string;
      rating?: string;
      comment?: string;
      correction?: { english?: string; ga?: string; category?: string };
    }>();
    const { interaction_id, rating, comment, correction } = body;

    if (!interaction_id || !rating) {
      return json({ error: "Missing required fields: interaction_id, rating" }, 400);
    }
    if (rating !== "helpful" && rating !== "not_helpful") {
      return json({ error: "rating must be 'helpful' or 'not_helpful'" }, 400);
    }

    // Verified JWT sub or guest id — never the raw token.
    const userId = await resolveUserId(request, env);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Upsert: if the user already gave feedback on this interaction, update it
    const existing = await env.DB.prepare(
      "SELECT id FROM response_feedback WHERE interaction_id = ? AND user_id = ?"
    )
      .bind(interaction_id, userId)
      .first<{ id: string }>();

    if (existing) {
      await env.DB.prepare(
        "UPDATE response_feedback SET rating = ?, comment = ?, created_at = ? WHERE id = ?"
      )
        .bind(rating, comment || null, now, existing.id)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO response_feedback (id, interaction_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(id, interaction_id, userId, rating, comment || null, now)
        .run();
    }

    // Log to learning_analytics for trend tracking
    await env.DB.prepare(
      "INSERT INTO learning_analytics (id, metric_name, metric_value, timestamp, metadata) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        crypto.randomUUID(),
        `feedback.${rating}`,
        1,
        now,
        JSON.stringify({ interaction_id, user_id: userId })
      )
      .run();

    // If the user provided a correction with not_helpful, stage it as a contribution.
    let contributionResult: { success: boolean; hasConflict?: boolean; message?: string } | null = null;
    if (rating === "not_helpful" && correction?.english?.trim() && correction?.ga?.trim()) {
      const category = correction.category || "general";
      contributionResult = await handleUserContribution(
        env,
        correction.english.trim(),
        correction.ga.trim(),
        category,
        userId
      );

      // Link the contribution back to the interaction for audit trail.
      await env.DB.prepare(
        "INSERT INTO learning_analytics (id, metric_name, metric_value, timestamp, metadata) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(
          crypto.randomUUID(),
          "feedback.correction_submitted",
          1,
          now,
          JSON.stringify({
            interaction_id,
            english: correction.english,
            ga: correction.ga,
            has_conflict: contributionResult.hasConflict,
          })
        )
        .run();
    }

    return json({
      status: "ok",
      rating,
      correction_staged: !!contributionResult,
      correction_conflict: contributionResult?.hasConflict ?? false,
      message: contributionResult?.message,
    });
  } catch (error) {
    console.error("Error handling feedback:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function handleFeedbackStats(request: Request, env: Env): Promise<Response> {
  try {
    const stats = await env.DB.prepare(
      `SELECT
         rating,
         COUNT(*) as count
       FROM response_feedback
       GROUP BY rating`
    ).all<{ rating: string; count: number }>();

    const helpful = stats.results?.find((r) => r.rating === "helpful")?.count ?? 0;
    const notHelpful = stats.results?.find((r) => r.rating === "not_helpful")?.count ?? 0;

    return json({
      helpful,
      not_helpful: notHelpful,
      total: helpful + notHelpful,
      ratio: helpful + notHelpful > 0 ? helpful / (helpful + notHelpful) : 0,
    });
  } catch (error) {
    console.error("Error fetching feedback stats:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

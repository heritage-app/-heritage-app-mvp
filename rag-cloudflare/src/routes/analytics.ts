/**
 * Learning analytics and cycle tracking routes.
 */
import type { Env } from "../types";

export async function getLearningProgress(request: Request, env: Env): Promise<Response> {
  try {
    const period = new URL(request.url).searchParams.get("period") || "30d";
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [feedbackStats, contributionStats, gapStats, trendData] = await Promise.all([
      env.DB.prepare(
        `SELECT rating, COUNT(*) as count 
         FROM response_feedback 
         WHERE created_at >= ? 
         GROUP BY rating`
      )
        .bind(since)
        .all<{ rating: string; count: number }>(),
      env.DB.prepare(
         `SELECT status, COUNT(*) as count 
          FROM user_contributions 
          WHERE timestamp >= ? 
          GROUP BY status`
      )
        .bind(since)
        .all<{ status: string; count: number }>(),
      env.DB.prepare(
        `SELECT status, COUNT(*) as count 
         FROM knowledge_gaps 
         WHERE timestamp >= ? 
         GROUP BY status`
      )
        .bind(since)
        .all<{ status: string; count: number }>(),
      env.DB.prepare(
        `SELECT metric_name, COUNT(*) as count, DATE(timestamp) as date
         FROM learning_analytics 
         WHERE timestamp >= ?
         GROUP BY metric_name, DATE(timestamp)
         ORDER BY date DESC`
      )
        .bind(since)
        .all<{ metric_name: string; count: number; date: string }>(),
    ]);

    const feedbackHelpful = feedbackStats.results?.find((r) => r.rating === "helpful")?.count ?? 0;
    const feedbackNotHelpful = feedbackStats.results?.find((r) => r.rating === "not_helpful")?.count ?? 0;
    const feedbackTotal = feedbackHelpful + feedbackNotHelpful;
    const feedback = {
      helpful: feedbackHelpful,
      notHelpful: feedbackNotHelpful,
      total: feedbackTotal,
      ratio: feedbackTotal > 0 ? feedbackHelpful / feedbackTotal : 0,
    };

    const contribPending = contributionStats.results?.find((r) => r.status === "pending_review")?.count ?? 0;
    const contribApproved = contributionStats.results?.find((r) => r.status === "approved")?.count ?? 0;
    const contribRejected = contributionStats.results?.find((r) => r.status === "rejected")?.count ?? 0;
    const contributions = {
      pending: contribPending,
      approved: contribApproved,
      rejected: contribRejected,
      total: contribPending + contribApproved + contribRejected,
    };

    const gapsPending = gapStats.results?.find((r) => r.status === "pending")?.count ?? 0;
    const gapsContributed = gapStats.results?.find((r) => r.status === "user_contributed")?.count ?? 0;
    const gapsResolved = gapStats.results?.find((r) => r.status === "resolved")?.count ?? 0;
    const gaps = {
      pending: gapsPending,
      userContributed: gapsContributed,
      resolved: gapsResolved,
      total: gapsPending + gapsContributed + gapsResolved,
    };

    // Build daily trend from analytics
    const dailyTrend: Record<string, Record<string, number>> = {};
    for (const row of trendData.results || []) {
      if (!dailyTrend[row.date]) dailyTrend[row.date] = {};
      dailyTrend[row.date][row.metric_name] = row.count;
    }

    return json({
      period,
      days,
      feedback,
      contributions,
      gaps,
      dailyTrend,
    });
  } catch (error) {
    console.error("Error fetching learning progress:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function getLearningCycles(request: Request, env: Env): Promise<Response> {
  try {
    // Get weekly learning cycles for the past 8 weeks
    const cycles = [];
    const now = new Date();

    for (let w = 0; w < 8; w++) {
      const weekEnd = new Date(now.getTime() - w * 7 * 86400000);
      const weekStart = new Date(weekEnd.getTime() - 7 * 86400000);
      const startStr = weekStart.toISOString();
      const endStr = weekEnd.toISOString();

      const [feedback, contributions, gaps] = await Promise.all([
        env.DB.prepare(
          `SELECT COUNT(*) as total,
                  COUNT(CASE WHEN rating = 'helpful' THEN 1 END) as helpful
           FROM response_feedback 
           WHERE created_at >= ? AND created_at < ?`
        )
          .bind(startStr, endStr)
          .first<{ total: number; helpful: number }>(),
        env.DB.prepare(
          `SELECT COUNT(*) as total,
                  COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved
           FROM user_contributions 
           WHERE timestamp >= ? AND timestamp < ?`
        )
          .bind(startStr, endStr)
          .first<{ total: number; approved: number }>(),
        env.DB.prepare(
          `SELECT COUNT(*) as total,
                  COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved
           FROM knowledge_gaps 
           WHERE timestamp >= ? AND timestamp < ?`
        )
          .bind(startStr, endStr)
          .first<{ total: number; resolved: number }>(),
      ]);

      cycles.push({
        weekStart: weekStart.toISOString().split("T")[0],
        weekEnd: weekEnd.toISOString().split("T")[0],
        feedback: {
          total: feedback?.total ?? 0,
          helpful: feedback?.helpful ?? 0,
          ratio: (feedback?.total ?? 0) > 0 ? (feedback?.helpful ?? 0) / (feedback?.total ?? 1) : 0,
        },
        contributions: {
          total: contributions?.total ?? 0,
          approved: contributions?.approved ?? 0,
        },
        gaps: {
          total: gaps?.total ?? 0,
          resolved: gaps?.resolved ?? 0,
        },
        score:
          ((feedback?.helpful ?? 0) + (contributions?.approved ?? 0) + (gaps?.resolved ?? 0)) /
          Math.max(1, (feedback?.total ?? 0) + (contributions?.total ?? 0) + (gaps?.total ?? 0)),
      });
    }

    return json({ cycles: cycles.reverse() });
  } catch (error) {
    console.error("Error fetching learning cycles:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function getSystemHealth(request: Request, env: Env): Promise<Response> {
  try {
    const [userCount, sessionCount, interactionCount, docCount] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) as count FROM chat_sessions").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) as count FROM interactions").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) as count FROM documents").first<{ count: number }>(),
    ]);

    return json({
      users: userCount?.count ?? 0,
      sessions: sessionCount?.count ?? 0,
      interactions: interactionCount?.count ?? 0,
      documents: docCount?.count ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching system health:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

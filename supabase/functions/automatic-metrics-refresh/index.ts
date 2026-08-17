import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type Claim = {
  run_id: string;
  user_id: string;
  retry_post_ids: number[] | null;
};

type StoredPost = {
  id: number;
  post_url: string | null;
  views: number | null;
  likes: number | null;
  reposts: number | null;
  comments: number | null;
  x_published_at: string | null;
};

const xPostPattern = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([^/?#]+)\/status\/(\d+)/i;
const batchSize = 4;

function metric(value: unknown, fallback: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : Number(fallback || 0);
}

function parsePostUrl(value: string) {
  const match = value.trim().match(xPostPattern);
  return match ? { handle: match[1], id: match[2] } : null;
}

async function fetchPublicPost(postUrl: string) {
  const parsed = parsePostUrl(postUrl);
  if (!parsed) throw new Error("URL de postagem do X inválida");

  const response = await fetch(
    `https://api.fxtwitter.com/${encodeURIComponent(parsed.handle)}/status/${parsed.id}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`Consulta do X retornou ${response.status}`);

  const json = await response.json();
  const tweet = json.tweet || json.status;
  if (!tweet) throw new Error("Postagem não encontrada");

  const published = tweet.created_at ? new Date(tweet.created_at) : null;
  return {
    views: Number(tweet.views || 0),
    likes: Number(tweet.likes || 0),
    reposts: Number(tweet.retweets ?? tweet.reposts ?? 0),
    comments: Number(tweet.replies || 0),
    published_at: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceRoleKey) {
    return Response.json({ error: "Server configuration unavailable" }, { status: 500 });
  }

  const suppliedSecret = request.headers.get("x-cron-secret") || "";
  if (!suppliedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const database = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: validSecret, error: secretError } = await database.rpc(
    "validate_automatic_refresh_cron_secret",
    { candidate: suppliedSecret },
  );
  if (secretError || validSecret !== true) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: claimedRows, error: claimError } = await database.rpc(
    "claim_due_automatic_refreshes",
    { batch_limit: 2 },
  );
  if (claimError) {
    return Response.json({ error: "Could not claim scheduled refreshes" }, { status: 500 });
  }

  const claims = (claimedRows || []) as Claim[];
  const summaries: Array<Record<string, number | string>> = [];

  for (const claim of claims) {
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let accountError = "";

    try {
      let query = database
        .from("posts")
        .select("id,post_url,views,likes,reposts,comments,x_published_at")
        .eq("user_id", claim.user_id)
        .eq("admin_eligible", true)
        .order("id", { ascending: true });

      const retryIds = Array.isArray(claim.retry_post_ids) ? claim.retry_post_ids : [];
      if (retryIds.length) query = query.in("id", retryIds);

      const { data: storedRows, error: postsError } = await query;
      if (postsError) throw postsError;

      const targets = ((storedRows || []) as StoredPost[]).filter((post) =>
        Boolean(post.id && parsePostUrl(String(post.post_url || "")))
      );
      attempted = targets.length;

      for (let start = 0; start < targets.length; start += batchSize) {
        const batch = targets.slice(start, start + batchSize);
        await Promise.all(batch.map(async (post) => {
          try {
            const metrics = await fetchPublicPost(String(post.post_url));
            const { error: updateError } = await database
              .from("posts")
              .update({
                views: metric(metrics.views, post.views),
                likes: metric(metrics.likes, post.likes),
                reposts: metric(metrics.reposts, post.reposts),
                comments: metric(metrics.comments, post.comments),
                x_published_at: metrics.published_at || post.x_published_at || null,
                metrics_source: "automatic-server",
                metrics_updated_at: new Date().toISOString(),
              })
              .eq("id", post.id)
              .eq("user_id", claim.user_id);
            if (updateError) throw updateError;
            succeeded++;
          } catch (error) {
            failed++;
            await database.rpc("record_automatic_refresh_failure", {
              target_user: claim.user_id,
              target_post: post.id,
              error_message: error instanceof Error ? error.message : "Falha ao atualizar publicação",
            });
          }
        }));
      }
    } catch (error) {
      accountError = error instanceof Error ? error.message : "Falha ao consultar publicações";
    }

    const { error: completionError } = await database.rpc("complete_automatic_refresh", {
      target_run: claim.run_id,
      target_user: claim.user_id,
      attempted_count: attempted,
      succeeded_count: succeeded,
      failed_count: failed,
      account_error: accountError || null,
    });

    summaries.push({
      attempted,
      succeeded,
      failed,
      status: completionError ? "completion-error" : accountError ? "failed" : failed ? "partial" : "success",
    });
  }

  return Response.json({ ok: true, claimed: claims.length, accounts: summaries });
});

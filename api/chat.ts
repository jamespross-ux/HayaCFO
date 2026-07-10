// Vercel Edge Function: /api/chat
// Proxies CFO Chat requests to Anthropic's Messages API, keeping the
// ANTHROPIC_API_KEY server-side (never exposed to the browser).
//
// Also enforces per-user rate limits:
//   - 100 messages per calendar month
//   - 20 messages per rolling 60 seconds (burst protection)
//
// Set these in Vercel Project Settings -> Environment Variables:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL              (same value as VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY (from Supabase: Project Settings -> API -> service_role key)

export const config = { runtime: 'edge' };

const MONTHLY_LIMIT = 100;
const BURST_LIMIT = 20;
const BURST_WINDOW_SECONDS = 60;

async function supabaseFetch(path: string, init: RequestInit) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      apikey: key!,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Vercel Project Settings > Environment Variables and redeploy.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Server is missing Supabase config for rate limiting.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const bodyJson = await req.json();
  const userId = bodyJson.user_id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing user_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Burst check: how many messages in the last 60 seconds? ---
  const burstSince = new Date(Date.now() - BURST_WINDOW_SECONDS * 1000).toISOString();
  const burstRes = await supabaseFetch(
    `/rest/v1/chat_usage?user_id=eq.${userId}&created_at=gte.${burstSince}&select=id`,
    { method: 'GET', headers: { Prefer: 'count=exact' } }
  );
  const burstCount = parseInt(burstRes.headers.get('content-range')?.split('/')[1] || '0', 10);
  if (burstCount >= BURST_LIMIT) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', reason: 'burst', message: "You're sending messages too quickly. Please wait a moment and try again." }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // --- Monthly check: how many messages since the 1st of this month? ---
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthRes = await supabaseFetch(
    `/rest/v1/chat_usage?user_id=eq.${userId}&created_at=gte.${monthStart}&select=id`,
    { method: 'GET', headers: { Prefer: 'count=exact' } }
  );
  const monthCount = parseInt(monthRes.headers.get('content-range')?.split('/')[1] || '0', 10);
  if (monthCount >= MONTHLY_LIMIT) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', reason: 'monthly', message: "You've reached your monthly message limit. It will reset at the start of next month." }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // --- Log this message (count only — no chat content stored) ---
  await supabaseFetch('/rest/v1/chat_usage', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId }),
  });

  // --- Forward to Anthropic (strip user_id first, Anthropic doesn't need it) ---
  const { user_id, ...anthropicBody } = bodyJson;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(anthropicBody),
  });

  // Pass the (streamed) response straight through to the client.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
    },
  });
}

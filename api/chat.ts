// Vercel Edge Function: /api/chat
// Proxies CFO Chat requests to Anthropic's Messages API, keeping the
// ANTHROPIC_API_KEY server-side (never exposed to the browser).
//
// Set ANTHROPIC_API_KEY in your Vercel project's Environment Variables
// (Project Settings -> Environment Variables) before deploying.

export const config = { runtime: 'edge' };

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

  const body = await req.text();

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body,
  });

  // Pass the (streamed) response straight through to the client.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
    },
  });
}

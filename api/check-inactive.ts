// Vercel Edge Function: /api/check-inactive
// Triggered weekly by Vercel Cron (see vercel.json). Checks for users with no
// activity (no new snapshot) in the last INACTIVE_DAYS days and sends a push
// notification via ntfy.sh with the count — every run, even when the count is
// zero, so silence never means "this might be broken."
//
// Privacy: the notification NEVER contains names, emails, or any personal
// data — just a number. Anyone who happens to see the notification (e.g. on
// a lock screen) learns nothing about who the inactive users are.
//
// IMPORTANT: this ONLY reads data and notifies — it never disables or
// deletes anything. Disabling/deleting stays a manual, reviewed action
// (via Supabase Auth's Ban user, and the deletion query template) exactly
// as designed. This route just saves you from having to remember to check.
//
// Set these in Vercel Project Settings -> Environment Variables:
//   SUPABASE_URL              (already set for chat.ts)
//   SUPABASE_SERVICE_ROLE_KEY (already set for chat.ts)
//   NTFY_TOPIC                (your ntfy.sh topic name)
//
// CRON_SECRET is auto-provisioned by Vercel — no need to set it yourself.
// This route checks it to make sure only Vercel's own scheduler can trigger it.

export const config = { runtime: 'edge' };

const INACTIVE_DAYS = 84; // 12 weeks

export default async function handler(req: Request): Promise<Response> {
  // Only Vercel's own cron scheduler should be able to trigger this.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ntfyTopic = process.env.NTFY_TOPIC;

  if (!supabaseUrl || !serviceKey || !ntfyTopic) {
    return new Response(
      JSON.stringify({ error: 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or NTFY_TOPIC.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Pull every user's stored data (small user base — fine to fetch in full
  // and compute inactivity here rather than needing a dedicated SQL view).
  const dataRes = await fetch(`${supabaseUrl}/rest/v1/cfo_data?select=user_id,data`, {
    headers: authHeaders,
  });
  if (!dataRes.ok) {
    return new Response('Failed to fetch cfo_data', { status: 500 });
  }
  const rows: { user_id: string; data: any }[] = await dataRes.json();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - INACTIVE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Count only — deliberately never collects or sends email/name/user_id.
  let inactiveCount = 0;
  for (const row of rows) {
    const snapshots = row.data?.snapshots || [];
    const dates = snapshots.map((s: any) => s.date).filter(Boolean).sort();
    const lastActive = dates.length ? dates[dates.length - 1] : null;
    if (!lastActive || lastActive < cutoffStr) inactiveCount++;
  }

  const message =
    inactiveCount === 0
      ? 'HayaCFO inactivity check: 0 users inactive.'
      : `${inactiveCount} users are inactive — please consider running the cleanup routine.`;

  await fetch(`https://ntfy.sh/${ntfyTopic}`, {
    method: 'POST',
    headers: { Title: 'HayaCFO inactivity check' },
    body: message,
  });

  return new Response(JSON.stringify({ checked: rows.length, inactive: inactiveCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

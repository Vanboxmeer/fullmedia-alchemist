// admin-stats -- one call returns the whole-business numbers for /admin/ (traffic, signups, activation, revenue, usage).
// Admin only (checked here, server-side). Deploy with verify_jwt=false: auth is done inside.
// The maths lives in the SQL function admin_stats(); this just checks who is asking.
// Admin = the admin email, or an account whose verified Google identity is the admin email.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAILS = ['brad@unitedpress.media'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function isAdmin(user: any): boolean {
  if (ADMIN_EMAILS.includes(String(user?.email || '').toLowerCase())) return true;
  return (user?.identities || []).some((i: any) => i?.provider === 'google'
    && i?.identity_data?.email_verified === true
    && ADMIN_EMAILS.includes(String(i?.identity_data?.email || '').toLowerCase()));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return J({ error: 'POST only' }, 405);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return J({ error: 'not signed in' }, 401);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: u, error } = await sb.auth.getUser(jwt);
  if (error || !u?.user) return J({ error: 'not signed in' }, 401);
  if (!isAdmin(u.user)) return J({ error: 'admin only' }, 403);
  let days = 30;
  try { const b = await req.json(); days = Math.max(1, Math.min(365, Number(b?.days) || 30)); } catch (_e) { /* default */ }
  const { data, error: e2 } = await sb.rpc('admin_stats', { p_days: days });
  if (e2) return J({ error: 'Could not build the report' }, 500);
  // extra numbers (real activity, conversion, support, team usage). Optional: the page still works if the database function is not there yet.
  let plus: Record<string, unknown> = {};
  try { const { data: p2 } = await sb.rpc('admin_stats_plus', { p_days: days }); if (p2 && typeof p2 === 'object') plus = p2 as Record<string, unknown>; } catch (_e) { /* not created yet */ }
  try {
    const recent = (data as any)?.recent as any[] | undefined;
    if (recent?.length) {
      const { data: accts } = await sb.from('fma_accounts').select('id, email').in('email', recent.map((r) => String(r.email || '').toLowerCase()));
      const { data: la } = await sb.rpc('admin_last_active');
      const idByEmail = new Map((accts || []).map((a: any) => [String(a.email), String(a.id)]));
      const act = new Map((la || []).map((r: any) => [String(r.user_id), r.last_active]));
      recent.forEach((r) => { const id = idByEmail.get(String(r.email || '').toLowerCase()); if (id && act.get(id)) r.last_active = act.get(id); });
    }
  } catch (_e) { /* optional */ }
  return J({ ok: true, ...data, ...plus });
});

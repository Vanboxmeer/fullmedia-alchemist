import { createClient } from 'jsr:@supabase/supabase-js@2';

// admin-people (new 2026-10-31). Admin only. One list of everyone who signed up, with how they found us,
// roughly where they are, what they are on (Content and Reach) and what they use, plus the account actions:
//   list           people, newest first
//   gift_credits   add bonus Content credits to an account (kept until used up; logged)
//   comp_reach     put a Reach workspace on a plan for 1, 3 or 12 months without a card (logged)
//   end_reach_comp put a comped Reach workspace back on Free now
// Content comps use the existing admin-grant-comp function. Region is a guess from the browser timezone the
// person's browser reported (no IP address is kept). Source comes from the first visit before they signed up,
// when the visit counter could link it; older accounts show nothing there.
const ADMIN_EMAILS = ['brad@unitedpress.media'];
// Admin = the admin email, or an account whose verified Google identity is the admin email (Brad signs in with Google).
// deno-lint-ignore no-explicit-any
function isAdminUser(user: any): boolean {
  if (ADMIN_EMAILS.includes(String(user?.email || '').toLowerCase())) return true;
  // deno-lint-ignore no-explicit-any
  return (user?.identities || []).some((i: any) => i?.provider === 'google' && i?.identity_data?.email_verified === true && ADMIN_EMAILS.includes(String(i?.identity_data?.email || '').toLowerCase()));
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function addMonths(d: Date, n: number) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }
function channelOf(ref: string, src: string): string {
  if (src) return src.toLowerCase();
  if (!ref || /fullmediaalchemist\.com$/i.test(ref)) return 'Direct';
  if (/(^|\.)(google|bing|duckduckgo|ecosia|yahoo|brave|startpage|baidu|yandex)\./i.test(ref)) return 'Search';
  if (/(claude\.ai|chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com)/i.test(ref)) return 'AI assistants';
  if (/(^|\.)(x\.com|twitter\.com|t\.co)$/i.test(ref)) return 'X';
  if (/(^|\.)reddit\.com$/i.test(ref)) return 'Reddit';
  if (/(linkedin\.com|lnkd\.in)$/i.test(ref)) return 'LinkedIn';
  if (/(facebook\.com|fb\.com|instagram\.com|threads\.net)$/i.test(ref)) return 'Facebook / Instagram';
  if (/(youtube\.com|youtu\.be)$/i.test(ref)) return 'YouTube';
  if (/tiktok\.com$/i.test(ref)) return 'TikTok';
  return 'Referral: ' + ref;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'not signed in' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: ud, error: ue } = await supabase.auth.getUser(jwt);
  if (ue || !ud?.user?.email) return json({ error: 'not signed in' }, 401);
  if (!isAdminUser(ud.user)) return json({ error: 'admin only' }, 403);
  const adminEmail = ud.user.email;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || 'list');

  if (action === 'list') {
    const users: Record<string, any>[] = [];
    for (let page = 1; page <= 6; page++) {
      const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      const got = data?.users || [];
      users.push(...got);
      if (got.length < 1000) break;
    }
    const [{ data: ub }, { data: brands }, { data: clients }, { data: subs }, { data: plans }, { data: arSubs }, { data: arPlans }, { data: sigs }, { data: usage }] = await Promise.all([
      supabase.from('cc_user_brands').select('user_id, brand, client_id'),
      supabase.from('cc_brands').select('name, client_id'),
      supabase.from('cc_clients').select('id, name'),
      supabase.from('cc_subscriptions').select('client_id, plan_id, status, is_comp, comp_ends_at, extra_post_credits, stripe_subscription_id, cancel_at_period_end, created_at').order('created_at', { ascending: true }),
      supabase.from('cc_plans').select('id, key, name, posts_included_monthly'),
      supabase.from('ar_subscriptions').select('client_id, plan_key, status, is_comp, current_period_end, stripe_subscription_id, cancel_at_period_end'),
      supabase.from('ar_plans').select('key, name'),
      supabase.from('site_events').select('sid, extra, at').eq('event', 'signup').not('extra', 'is', null).limit(5000),
      supabase.from('cc_usage_events').select('client_id, credits_consumed, event_type').gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).in('event_type', ['content_generated', 'post_generated']).limit(50000),
    ]);
    // Which app is each account from? The login system is shared with SpinQuest, so the database view fma_accounts classifies every
    // account (alchemist / spinquest / unknown, plus 'internal' for the owner's own accounts). Before that view exists, app is null
    // and the page falls back to its older guess.
    const cls = new Map<string, { app: string; internal: boolean }>();
    let haveView = true;
    for (let from = 0; haveView; from += 1000) {
      const { data, error } = await supabase.from('fma_accounts').select('id, app, internal').range(from, from + 999);
      if (error) { haveView = false; break; }
      (data || []).forEach((r: any) => cls.set(String(r.id), { app: r.app, internal: !!r.internal }));
      if (!data || data.length < 1000) break;
    }
    const planById = new Map((plans || []).map((p: any) => [p.id, p]));
    const subByClient = new Map((subs || []).map((s: any) => [s.client_id, s]));
    const arPlanByKey = new Map((arPlans || []).map((p: any) => [p.key, p]));
    const arByClient = new Map((arSubs || []).map((s: any) => [s.client_id, s]));
    const clientName = new Map((clients || []).map((c: any) => [c.id, c.name]));
    const brandClient = new Map((brands || []).map((b: any) => [b.name, b.client_id]));
    const used30 = new Map<string, number>();
    (usage || []).forEach((u: any) => { used30.set(u.client_id, (used30.get(u.client_id) || 0) + (Number(u.credits_consumed) || 0)); });
    // sign-up source: the signup event carries the user id; the first page view of that browser visit says where they came from
    const sidByUid = new Map<string, string>();
    (sigs || []).forEach((e: any) => { const uid = e.extra && e.extra.uid; if (uid && e.sid) sidByUid.set(String(uid), e.sid); });
    const sids = Array.from(new Set(sidByUid.values()));
    const firstView = new Map<string, any>();
    if (sids.length) {
      const { data: views } = await supabase.from('site_events').select('sid, at, path, ref_host, src, campaign').eq('event', 'view').in('sid', sids).order('at', { ascending: true }).limit(20000);
      (views || []).forEach((v: any) => { if (!firstView.has(v.sid)) firstView.set(v.sid, v); });
    }
    const brandsByUser = new Map<string, { brand: string; client_id: string | null }[]>();
    (ub || []).forEach((r: any) => { const a = brandsByUser.get(r.user_id) || []; a.push({ brand: r.brand, client_id: r.client_id || brandClient.get(r.brand) || null }); brandsByUser.set(r.user_id, a); });

    const people = users.map((u) => {
      const bl = brandsByUser.get(u.id) || [];
      const cid = (bl.find((b) => b.client_id) || {}).client_id || null;
      const sub: any = cid ? subByClient.get(cid) : null;
      const plan: any = sub ? planById.get(sub.plan_id) : null;
      const ar: any = cid ? arByClient.get(cid) : null;
      const arPlan: any = ar ? arPlanByKey.get(ar.plan_key) : null;
      const sid = sidByUid.get(u.id), fv = sid ? firstView.get(sid) : null;
      const um = u.user_metadata || {};
      return {
        id: u.id, email: u.email, name: um.full_name || um.name || null,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null, signup_app: um.signup_app || null,
        app: haveView ? (cls.get(u.id)?.app || 'unknown') : null,
        internal: haveView ? !!cls.get(u.id)?.internal : ADMIN_EMAILS.includes(u.email || ''),
        provider: (u.app_metadata && u.app_metadata.provider) || ((u.identities && u.identities[0] && u.identities[0].provider) || 'email'),
        confirmed: !!u.email_confirmed_at, tz: um.tz || null, lang: um.lang || um.locale || null,
        brands: bl.map((b) => b.brand), client_id: cid, client_name: cid ? clientName.get(cid) || null : null,
        is_admin: ADMIN_EMAILS.includes(u.email || ''),
        content: sub ? {
          plan_key: plan?.key || null, plan_name: plan?.name || null, credits_monthly: plan?.posts_included_monthly ?? null, status: sub.status,
          is_comp: !!sub.is_comp, comp_ends_at: sub.comp_ends_at || null, bonus_credits: sub.extra_post_credits || 0,
          pays_by_card: String(sub.stripe_subscription_id || '').startsWith('sub_') && !sub.cancel_at_period_end, used_30d: Math.round((used30.get(cid!) || 0) * 10) / 10,
        } : null,
        reach: ar ? {
          plan_key: ar.plan_key, plan_name: arPlan?.name || ar.plan_key, status: ar.status, is_comp: !!ar.is_comp, ends_at: ar.current_period_end || null,
          pays_by_card: String(ar.stripe_subscription_id || '').startsWith('sub_') && !ar.cancel_at_period_end,
        } : null,
        source: fv ? { channel: channelOf(fv.ref_host || '', fv.src || ''), campaign: fv.campaign || '', landing: fv.path || '' } : null,
      };
    }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const { data: reachPlans } = await supabase.from('ar_plans').select('key, name, price_cents').eq('active', true).order('sort_order', { ascending: true });
    const { data: contentPlans } = await supabase.from('cc_plans').select('key, name, price_cents, posts_included_monthly').order('sort_order', { ascending: true });
    return json({ ok: true, people, content_plans: contentPlans || [], reach_plans: reachPlans || [] });
  }

  const clientId = String(body.clientId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: 'clientId is required.' }, 400);
  const { data: client } = await supabase.from('cc_clients').select('id, name').eq('id', clientId).maybeSingle();
  if (!client) return json({ error: 'Account not found.' }, 404);
  const now = new Date();
  const log = (detail: Record<string, unknown>) => supabase.from('admin_actions').insert({ admin_email: adminEmail, action, client_id: clientId, detail }).then(() => {}, () => {});

  if (action === 'comp_content' || action === 'end_content_comp') {
    const { data: ex } = await supabase.from('cc_subscriptions').select('id, plan_id, is_comp, comp_previous_plan_id, comp_note, stripe_subscription_id, status, cancel_at_period_end').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (action === 'end_content_comp') {
      if (!ex || !ex.is_comp) return json({ error: 'This account has no comp to end.' }, 400);
      let backId = ex.comp_previous_plan_id as string | null;
      if (!backId) { const { data: free } = await supabase.from('cc_plans').select('id').eq('key', 'free').maybeSingle(); backId = (free?.id as string) || (ex.plan_id as string); }
      const note = `${ex.comp_note || ''} [comp ended early by ${adminEmail} ${now.toISOString().slice(0, 10)}]`.trim().slice(0, 500);
      const { error } = await supabase.from('cc_subscriptions').update({ plan_id: backId, is_comp: false, comp_ends_at: null, comp_previous_plan_id: null, comp_note: note, billing_interval: 'monthly', cancel_at_period_end: false, current_period_start: now.toISOString(), current_period_end: addMonths(now, 1).toISOString(), updated_at: now.toISOString() }).eq('id', ex.id);
      if (error) return json({ error: 'Could not end the comp.' }, 500);
      const { data: back } = await supabase.from('cc_plans').select('name').eq('id', backId).maybeSingle();
      await log({});
      return json({ ok: true, plan_name: back?.name || null });
    }
    const months = parseInt(String(body.durationMonths), 10);
    if (![1, 3, 12].includes(months)) return json({ error: 'Pick 1, 3 or 12 months.' }, 400);
    const { data: planRow } = await supabase.from('cc_plans').select('id, key, name').eq('key', String(body.planKey || '')).maybeSingle();
    if (!planRow || planRow.key === 'free') return json({ error: 'Pick a paid plan.' }, 400);
    const liveCard = ex && String(ex.stripe_subscription_id || '').startsWith('sub_') && ['active', 'trialing', 'past_due'].includes(String(ex.status)) && !ex.cancel_at_period_end;
    if (liveCard) return json({ error: 'This account pays by card. Cancel their card plan first, then comp it.' }, 409);
    const ends = addMonths(now, months);
    const patch: Record<string, unknown> = { client_id: clientId, plan_id: planRow.id, status: 'active', billing_interval: 'monthly', current_period_start: now.toISOString(), current_period_end: addMonths(now, 1).toISOString(), is_comp: true, comp_ends_at: ends.toISOString(), comp_granted_by: adminEmail, comp_granted_at: now.toISOString(), comp_note: String(body.note || '').slice(0, 500) || null, cancel_at_period_end: false, updated_at: now.toISOString() };
    if (ex) {
      patch.comp_previous_plan_id = ex.is_comp ? (ex.comp_previous_plan_id || null) : ex.plan_id;
      const { error } = await supabase.from('cc_subscriptions').update(patch).eq('id', ex.id);
      if (error) return json({ error: 'Could not update the plan.' }, 500);
    } else {
      const { error } = await supabase.from('cc_subscriptions').insert({ ...patch, comp_previous_plan_id: null, extra_post_credits: 0, extra_video_credits: 0, extra_review_credits: 0 });
      if (error) return json({ error: 'Could not create the plan.' }, 500);
    }
    await log({ plan: planRow.key, months, ends: ends.toISOString() });
    return json({ ok: true, plan_name: planRow.name, comp_ends_at: ends.toISOString() });
  }

  if (action === 'gift_credits') {
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > 1000) return json({ error: 'Pick between 1 and 1000 credits.' }, 400);
    const { data: sub } = await supabase.from('cc_subscriptions').select('id, extra_post_credits').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!sub) return json({ error: 'This account has no plan row yet. Comp it first.' }, 400);
    const next = (Number(sub.extra_post_credits) || 0) + amount;
    const { error } = await supabase.from('cc_subscriptions').update({ extra_post_credits: next, updated_at: now.toISOString() }).eq('id', sub.id);
    if (error) return json({ error: 'Could not add the credits.' }, 500);
    await log({ amount, total_bonus: next, note: String(body.note || '').slice(0, 300) });
    return json({ ok: true, bonus_credits: next, client_name: client.name });
  }

  if (action === 'comp_reach') {
    const months = parseInt(String(body.durationMonths), 10);
    if (![1, 3, 12].includes(months)) return json({ error: 'Pick 1, 3 or 12 months.' }, 400);
    const planKey = String(body.planKey || '');
    const { data: plan } = await supabase.from('ar_plans').select('key, name, price_cents').eq('key', planKey).maybeSingle();
    if (!plan || !(plan.price_cents > 0)) return json({ error: 'Pick a paid Reach plan.' }, 400);
    const { data: ex } = await supabase.from('ar_subscriptions').select('client_id, status, stripe_subscription_id, cancel_at_period_end').eq('client_id', clientId).maybeSingle();
    if (ex && String(ex.stripe_subscription_id || '').startsWith('sub_') && ['active', 'trialing', 'past_due'].includes(String(ex.status)) && !ex.cancel_at_period_end) return json({ error: 'This workspace pays by card. Cancel its card plan first, then comp it.' }, 409);
    const ends = addMonths(now, months);
    const row = { client_id: clientId, plan_key: plan.key, status: 'active', is_comp: true, billing_interval: 'monthly', current_period_start: now.toISOString(), current_period_end: ends.toISOString(), cancel_at_period_end: false, updated_at: now.toISOString() };
    const { error } = ex ? await supabase.from('ar_subscriptions').update(row).eq('client_id', clientId) : await supabase.from('ar_subscriptions').insert(row);
    if (error) return json({ error: 'Could not update the Reach plan.' }, 500);
    await log({ plan: plan.key, months, ends: ends.toISOString() });
    return json({ ok: true, plan_name: plan.name, ends_at: ends.toISOString(), client_name: client.name });
  }

  if (action === 'end_reach_comp') {
    const { data: ex } = await supabase.from('ar_subscriptions').select('client_id, is_comp').eq('client_id', clientId).maybeSingle();
    if (!ex || !ex.is_comp) return json({ error: 'This workspace has no comp to end.' }, 400);
    const { error } = await supabase.from('ar_subscriptions').update({ plan_key: 'free', is_comp: false, status: 'active', current_period_start: now.toISOString(), current_period_end: addMonths(now, 1).toISOString(), updated_at: now.toISOString() }).eq('client_id', clientId);
    if (error) return json({ error: 'Could not end the comp.' }, 500);
    await log({});
    return json({ ok: true, client_name: client.name });
  }
  return json({ error: 'Unknown action.' }, 400);
});

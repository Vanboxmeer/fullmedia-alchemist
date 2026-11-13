import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

// Fullmedia Alchemist: ONE place to manage plans for BOTH products (Content and Reach).
//
// The customer picks a tier for Content and a tier for Reach (free | starter | growth | agency each), or only one of
// them, plus monthly/annual. Same tier on both = the Suite: ONE Stripe subscription, 10% off. Anything else = one
// subscription per paid product. This function works out the minimum change from what the account has now and applies it:
//
//   overview                       -> everything the plans screen needs (catalog, what is held now, card on file)
//   preview {content,reach,interval} -> what would happen and what it would cost, nothing is changed
//   change  {content,reach,interval,returnTo} -> does it. Upgrades, downgrades, interval changes and the bundle
//                                     moves happen in place on the existing Stripe subscription (prorated, charged now,
//                                     refused if the card fails). Going to Free = cancel at the end of the paid period.
//                                     A brand-new paid subscription goes through Stripe Checkout (returns {checkoutUrl}).
//   resume                         -> undo a pending cancellation
//   portal                         -> Stripe billing portal (card, invoices)
//
// Every Stripe subscription keeps the metadata alchemist-stripe-webhook already understands
// (type = ccb_subscription | reach_subscription | suite_subscription + client ids + plan keys), and this function also writes
// cc_subscriptions / ar_subscriptions itself, so the screen is right immediately and the webhook only confirms.
// The account billed is always resolved from the caller's own login, never from the request body.
const KEY = Deno.env.get('ALCHEMIST_STRIPE_SECRET_KEY');
const stripe: any = KEY ? new Stripe(KEY, { apiVersion: '2024-06-20' }) : null;
const ADMIN_EMAILS = ['brad@unitedpress.media'];
const ADMIN_HOME = '36e687f6-6c12-49dc-a3af-a637529a1251';
const SITE = 'https://www.fullmediaalchemist.com';
const BUNDLE_OFF = 0.10;
// Reach credit top-ups: packs of 1,000 AI credits, $20 each (a little above Starter's per-credit price so they never beat upgrading).
const TOPUP_CREDITS = 1000, TOPUP_CENTS = 2000;
const MANAGED_PAYMENTS_OFF = { managed_payments: { enabled: false } };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const isStripeSub = (id?: string | null) => !!id && String(id).startsWith('sub_');

// PLANNER-START (pure: no I/O, tested on its own)
const TIERS = ['free', 'starter', 'growth', 'agency'];
function planChange(st: any, want: any): any {
  if (!TIERS.includes(want.c) || !TIERS.includes(want.r)) return { error: 'Unknown plan.' };
  const iv = want.interval === 'annual' ? 'annual' : 'monthly';
  const paid = (t: string) => t !== 'free';
  const name = (k: string) => (k === 'c' ? 'Content' : 'Reach');
  for (const k of ['c', 'r']) {
    const s = st[k];
    const manual = paid(s.tier) && !s.subId; // complimentary or crypto: not ours to change from here
    if (manual && want[k] !== s.tier) {
      return { error: name(k) + ' is on a plan we manage for you (complimentary or paid another way). Contact us to change it.' };
    }
  }
  const ops: any[] = [];
  const manualAny = (paid(st.c.tier) && !st.c.subId) || (paid(st.r.tier) && !st.r.subId);
  const suiteWanted = paid(want.c) && want.c === want.r && !manualAny;
  const suiteNow = !!(st.c.subId && st.c.subId === st.r.subId);
  if (suiteNow) {
    const S = st.c.subId;
    const pending = !!(st.c.cancelPending || st.r.cancelPending);
    if (suiteWanted) {
      if (st.c.tier === want.c && st.r.tier === want.r && st.c.interval === iv) { if (pending) ops.push({ op: 'resume', subId: S }); }
      else ops.push({ op: 'swap', subId: S, layout: 'suite', cTier: want.c, rTier: want.r, interval: iv });
    } else if (!paid(want.c) && !paid(want.r)) {
      if (!pending) ops.push({ op: 'cancel_end', subId: S });
    } else if (paid(want.c) && !paid(want.r)) {
      ops.push({ op: 'swap', subId: S, layout: 'content', cTier: want.c, interval: iv, fromSuite: true });
    } else if (!paid(want.c) && paid(want.r)) {
      ops.push({ op: 'swap', subId: S, layout: 'reach', rTier: want.r, interval: iv, fromSuite: true });
    } else {
      ops.push({ op: 'swap', subId: S, layout: 'content', cTier: want.c, interval: iv, fromSuite: true });
      ops.push({ op: 'checkout', layout: 'reach', rTier: want.r, interval: iv });
    }
  } else if (suiteWanted) {
    if (st.c.subId && st.r.subId) {
      ops.push({ op: 'swap', subId: st.c.subId, layout: 'suite', cTier: want.c, rTier: want.r, interval: iv });
      ops.push({ op: 'cancel_now', subId: st.r.subId });
    } else if (st.c.subId) ops.push({ op: 'swap', subId: st.c.subId, layout: 'suite', cTier: want.c, rTier: want.r, interval: iv });
    else if (st.r.subId) ops.push({ op: 'swap', subId: st.r.subId, layout: 'suite', cTier: want.c, rTier: want.r, interval: iv });
    else ops.push({ op: 'checkout', layout: 'suite', cTier: want.c, rTier: want.r, interval: iv });
  } else {
    for (const k of ['c', 'r']) {
      const s = st[k], w = want[k];
      const layout = k === 'c' ? 'content' : 'reach';
      if (s.subId) {
        if (paid(w)) {
          if (s.tier !== w || s.interval !== iv) ops.push({ op: 'swap', subId: s.subId, layout, cTier: k === 'c' ? w : undefined, rTier: k === 'r' ? w : undefined, interval: iv });
          else if (s.cancelPending) ops.push({ op: 'resume', subId: s.subId });
        } else if (!s.cancelPending) ops.push({ op: 'cancel_end', subId: s.subId, only: k });
      } else if (paid(w) && !paid(s.tier)) {
        ops.push({ op: 'checkout', layout, cTier: k === 'c' ? w : undefined, rTier: k === 'r' ? w : undefined, interval: iv });
      }
    }
  }
  return { ops };
}
// PLANNER-END

async function usableCustomer(id?: string | null): Promise<string | undefined> {
  if (!id || !stripe) return undefined;
  try { const c: any = await stripe.customers.retrieve(id); return c && !c.deleted ? id : undefined; } catch { return undefined; }
}
const iso = (sec: unknown) => (typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : undefined);
function period(sub: any) {
  const item = sub?.items?.data?.[0];
  return { start: iso(sub?.current_period_start ?? item?.current_period_start), end: iso(sub?.current_period_end ?? item?.current_period_end) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'not signed in' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: ud, error: ue } = await sb.auth.getUser(jwt);
    if (ue || !ud?.user?.id || !ud.user.email) return json({ error: 'not signed in' }, 401);
    const email = ud.user.email;
    const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const returnTo = body.returnTo === 'content' ? 'content' : 'reach';
    const backUrl = SITE + (returnTo === 'content' ? '/dashboard/' : '/reach/');

    // The account being billed: the caller's own client.
    const { data: acct } = await sb.from('ar_accounts').select('client_id').eq('user_id', ud.user.id).maybeSingle();
    const { data: grants } = await sb.from('cc_user_brands').select('client_id').eq('user_id', ud.user.id).not('client_id', 'is', null).limit(1);
    const clientId = (acct?.client_id as string | undefined) ?? (grants?.[0]?.client_id as string | undefined) ?? (isAdmin ? ADMIN_HOME : undefined);
    if (!clientId) return json({ error: 'This login has no billing account yet.' }, 400);

    // ---- catalog + what the account holds ----
    const { data: rplans } = await sb.from('ar_plans').select('*').order('sort_order');
    const { data: cplans } = await sb.from('cc_plans').select('id,key,name,tagline,price_cents,annual_price_cents,features,active,sort_order').order('sort_order');
    const cByKey = new Map<string, any>((cplans || []).map((p: any) => [p.key, p]));
    const rByTier = new Map<string, any>();
    for (const p of rplans || []) rByTier.set(p.key === 'free' ? 'free' : String(p.content_pair_key), p);
    const tierOfReachKey = (k: string) => { const p = (rplans || []).find((x: any) => x.key === k); return !p ? 'free' : (p.key === 'free' ? 'free' : String(p.content_pair_key)); };

    const loadSubs = async () => {
      const { data: csub } = await sb.from('cc_subscriptions')
        .select('id, status, billing_interval, current_period_end, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, is_comp, plan_id, cc_plans(key,name)')
        .eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { data: rsub } = await sb.from('ar_subscriptions').select('*').eq('client_id', clientId).maybeSingle();
      return { csub: csub as any, rsub: rsub as any };
    };
    const stateOf = (csub: any, rsub: any) => {
      const cActive = csub && ['active', 'past_due', 'trialing'].includes(String(csub.status));
      const rActive = rsub && ['active', 'past_due', 'trialing'].includes(String(rsub.status));
      const c = {
        tier: cActive ? String(csub?.cc_plans?.key || 'free') : 'free',
        subId: cActive && isStripeSub(csub?.stripe_subscription_id) && !csub?.is_comp ? csub.stripe_subscription_id : null,
        comp: !!csub?.is_comp, interval: csub?.billing_interval === 'annual' ? 'annual' : 'monthly',
        cancelPending: !!csub?.cancel_at_period_end, periodEnd: csub?.current_period_end || null, status: csub?.status || 'active',
      };
      const r = {
        tier: rActive ? tierOfReachKey(String(rsub?.plan_key || 'free')) : 'free',
        subId: rActive && isStripeSub(rsub?.stripe_subscription_id) && !rsub?.is_comp ? rsub.stripe_subscription_id : null,
        comp: !!rsub?.is_comp, interval: rsub?.billing_interval === 'annual' ? 'annual' : 'monthly',
        cancelPending: !!rsub?.cancel_at_period_end, periodEnd: rsub?.current_period_end || null, status: rsub?.status || 'active',
      };
      return { c, r };
    };
    const priceOf = (tier: string, which: 'c' | 'r', interval: string) => {
      if (tier === 'free') return 0;
      const p = which === 'c' ? cByKey.get(tier) : rByTier.get(tier);
      return p ? Number(interval === 'annual' ? p.annual_price_cents : p.price_cents) : 0;
    };
    const suitePrice = (tier: string, interval: string) => Math.round((priceOf(tier, 'c', interval) + priceOf(tier, 'r', interval)) * (1 - BUNDLE_OFF));
    const totalFor = (cT: string, rT: string, interval: string) =>
      (cT !== 'free' && cT === rT) ? suitePrice(cT, interval) : priceOf(cT, 'c', interval) + priceOf(rT, 'r', interval);
    const label = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

    const { csub, rsub } = await loadSubs();
    const st = stateOf(csub, rsub);

    if (action === 'overview') {
      const tiers = TIERS.map((t) => {
        const c: any = cByKey.get(t), r: any = rByTier.get(t);
        return {
          tier: t, label: label(t),
          content: c ? { name: c.name, tagline: c.tagline, features: c.features, monthly: Number(c.price_cents), annual: Number(c.annual_price_cents) } : null,
          reach: r ? { name: label(t), tagline: r.tagline, features: r.features, monthly: Number(r.price_cents), annual: Number(r.annual_price_cents), onSale: t === 'free' ? true : !!r.active } : null,
          suiteMonthly: t === 'free' ? null : suitePrice(t, 'monthly'), suiteAnnual: t === 'free' ? null : suitePrice(t, 'annual'),
        };
      });
      const customer = (rsub?.stripe_customer_id as string | null) || (csub?.stripe_customer_id as string | null) || null;
      return json({
        ok: true, bundleOff: BUNDLE_OFF, tiers, current: st, suite: !!(st.c.subId && st.c.subId === st.r.subId), hasCard: !!customer, admin: isAdmin,
        interval: st.c.subId ? st.c.interval : (st.r.subId ? st.r.interval : 'monthly'),
      });
    }

    // ---- Reach credit top-up: a one-time payment for extra AI credits that last until the end of the current month ----
    if (action === 'topup') {
      if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
      if (st.r.tier === 'free' || st.r.comp) return json({ error: 'Top-ups are for paid Reach plans. Upgrade to get monthly credits.' }, 400);
      const qty = Math.max(1, Math.min(5, Math.floor(Number(body.quantity) || 1)));
      const customer = await usableCustomer(rsub?.stripe_customer_id) ?? await usableCustomer(csub?.stripe_customer_id);
      const meta: Record<string, string> = { type: 'reach_topup', reach_client_id: clientId, credits: String(TOPUP_CREDITS * qty), user_id: ud.user.id };
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        ...(customer ? { customer } : { customer_email: email }),
        client_reference_id: clientId,
        line_items: [{ quantity: qty, price_data: { currency: 'usd', product_data: { name: 'Alchemist Reach: 1,000 AI credits', description: 'Extra AI credits. They last until the end of this month.' }, unit_amount: TOPUP_CENTS } }],
        metadata: meta,
        payment_intent_data: { metadata: meta },
        success_url: `${backUrl}?topup=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${backUrl}?topup=cancelled`,
        ...MANAGED_PAYMENTS_OFF,
      } as any);
      return json({ ok: true, url: session.url });
    }
    if (action === 'topup_confirm') {
      if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
      const sid = String(body.sessionId || '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return json({ error: 'Missing payment reference.' }, 400);
      const s: any = await stripe.checkout.sessions.retrieve(sid);
      if (s?.metadata?.type !== 'reach_topup' || s.metadata.reach_client_id !== clientId) return json({ error: 'That payment does not belong to this account.' }, 400);
      if (s.payment_status !== 'paid') return json({ ok: true, paid: false });
      const credits = Math.round(Number(s.amount_total || 0) / TOPUP_CENTS) * TOPUP_CREDITS;
      if (credits <= 0 || credits !== Number(s.metadata.credits)) return json({ error: 'The payment amount did not match the credits.' }, 400);
      const { error: te } = await sb.from('ar_credit_topups').upsert({ client_id: clientId, credits, amount_cents: Number(s.amount_total), stripe_session_id: sid }, { onConflict: 'stripe_session_id', ignoreDuplicates: true });
      if (te) return json({ error: 'Payment received but credits could not be added yet. Contact support with this reference: ' + sid }, 500);
      return json({ ok: true, paid: true, credits });
    }

    if (action === 'portal') {
      if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
      const customer = await usableCustomer(rsub?.stripe_customer_id) ?? await usableCustomer(csub?.stripe_customer_id);
      if (!customer) return json({ error: 'No card subscription on file for this account.' }, 400);
      const s = await stripe.billingPortal.sessions.create({ customer, return_url: backUrl });
      return json({ ok: true, url: s.url });
    }

    const want = {
      c: String(body.content || st.c.tier), r: String(body.reach || st.r.tier),
      interval: body.interval === 'annual' ? 'annual' : (body.interval === 'monthly' ? 'monthly' : (st.c.subId ? st.c.interval : (st.r.subId ? st.r.interval : 'monthly'))),
    };

    // ---- describe what an op set does, in plain words ----
    const describe = (ops: any[]) => ops.map((o: any) => {
      const per = want.interval === 'annual' ? '/yr' : '/mo';
      const m = (c: number) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)) + per;
      if (o.op === 'swap') {
        if (o.layout === 'suite') return `Move to the ${label(o.cTier)} Suite (Content ${label(o.cTier)} + Reach ${label(o.rTier)}) at ${m(suitePrice(o.cTier, o.interval))}, 10% off. The price difference for the rest of this period is charged or credited now.`;
        if (o.layout === 'content') return `Content: ${label(o.cTier)} at ${m(priceOf(o.cTier, 'c', o.interval))}.${o.fromSuite ? ' The Suite discount ends.' : ''} The price difference for the rest of this period is charged or credited now.`;
        return `Reach: ${label(o.rTier)} at ${m(priceOf(o.rTier, 'r', o.interval))}.${o.fromSuite ? ' The Suite discount ends.' : ''} The price difference for the rest of this period is charged or credited now.`;
      }
      if (o.op === 'cancel_end') {
        const end = (o.only === 'r' ? st.r.periodEnd : st.c.periodEnd) || st.c.periodEnd || st.r.periodEnd;
        const what = o.only === 'c' ? 'Content' : o.only === 'r' ? 'Reach' : 'Your plan';
        return `${what} moves to Free at the end of the period you have paid for${end ? ' (' + String(end).slice(0, 10) + ')' : ''}. Nothing more is charged.`;
      }
      if (o.op === 'resume') return 'Keeps your current plan: the pending cancellation is removed.';
      if (o.op === 'cancel_now') return 'The separate Reach subscription is replaced by the Suite and its unused time is credited to you.';
      if (o.op === 'checkout') {
        const what = o.layout === 'suite' ? `the ${label(o.cTier)} Suite at ${m(suitePrice(o.cTier, o.interval))}` : o.layout === 'content' ? `Content ${label(o.cTier)} at ${m(priceOf(o.cTier, 'c', o.interval))}` : `Reach ${label(o.rTier)} at ${m(priceOf(o.rTier, 'r', o.interval))}`;
        return `Pay for ${what} on Stripe's secure checkout page.`;
      }
      return '';
    });

    if (action === 'preview' || action === 'change') {
      const plan = planChange(st, want);
      if (plan.error) return json({ error: plan.error }, 400);
      const ops = plan.ops as any[];
      const monthlyBefore = totalFor(st.c.tier, st.r.tier, want.interval);
      const after = totalFor(want.c, want.r, want.interval);
      const saved = (want.c !== 'free' && want.c === want.r)
        ? priceOf(want.c, 'c', want.interval) + priceOf(want.r, 'r', want.interval) - suitePrice(want.c, want.interval) : 0;
      if (action === 'preview') {
        return json({ ok: true, noChange: ops.length === 0, steps: describe(ops), interval: want.interval, totalAfter: after, saved, suite: want.c !== 'free' && want.c === want.r });
      }

      if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
      for (const o of ops) {
        if (o.layout === 'reach' || o.layout === 'suite') {
          const rt = rByTier.get(o.rTier);
          if (!rt || !rt.active) return json({ error: 'Reach ' + label(o.rTier) + ' is not on sale yet.' }, 400);
        }
        if (o.layout === 'content' || o.layout === 'suite') {
          const ct = cByKey.get(o.cTier);
          if (!ct || !ct.active) return json({ error: 'Content ' + label(o.cTier) + ' is not on sale yet.' }, 400);
        }
      }

      const { data: freeC } = await sb.from('cc_plans').select('id').eq('key', 'free').maybeSingle();
      const nowIso = new Date().toISOString();
      const monthAhead = new Date(); monthAhead.setMonth(monthAhead.getMonth() + 1);
      const writeContent = async (tier: string, sub: any | null, interval: string) => {
        if (sub) {
          const pe = period(sub);
          await sb.from('cc_subscriptions').upsert({
            client_id: clientId, plan_id: cByKey.get(tier).id, status: 'active', billing_interval: interval,
            stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, cancel_at_period_end: false, cancelled_at: null, cancellation_reason: null,
            ...(pe.start ? { current_period_start: pe.start } : {}), ...(pe.end ? { current_period_end: pe.end } : {}), updated_at: nowIso,
          }, { onConflict: 'client_id' });
        } else {
          await sb.from('cc_subscriptions').upsert({
            client_id: clientId, plan_id: freeC?.id, status: 'active', billing_interval: 'monthly',
            current_period_start: nowIso, current_period_end: monthAhead.toISOString(), stripe_subscription_id: null, cancel_at_period_end: false,
            cancellation_reason: 'moved to Free ' + nowIso.slice(0, 10), updated_at: nowIso,
          }, { onConflict: 'client_id' });
        }
      };
      const writeReach = async (tier: string, sub: any | null, interval: string, bundle: boolean) => {
        if (sub) {
          const pe = period(sub);
          await sb.from('ar_subscriptions').upsert({
            client_id: clientId, plan_key: rByTier.get(tier).key, status: 'active', billing_interval: interval, bundle, is_comp: false,
            stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, cancel_at_period_end: false,
            ...(pe.start ? { current_period_start: pe.start } : {}), ...(pe.end ? { current_period_end: pe.end } : {}), updated_at: nowIso,
          }, { onConflict: 'client_id' });
        } else {
          await sb.from('ar_subscriptions').upsert({
            client_id: clientId, plan_key: 'free', status: 'active', billing_interval: 'monthly', bundle: false,
            stripe_subscription_id: null, cancel_at_period_end: false, updated_at: nowIso,
          }, { onConflict: 'client_id' });
        }
      };
      const flagCancel = async (subId: string, flag: boolean, only?: string) => {
        const cc: any = { cancel_at_period_end: flag, cancelled_at: flag ? nowIso : null, updated_at: nowIso };
        const rr: any = { cancel_at_period_end: flag, updated_at: nowIso };
        if (only !== 'r') await sb.from('cc_subscriptions').update(cc).eq('client_id', clientId).eq('stripe_subscription_id', subId);
        if (only !== 'c') await sb.from('ar_subscriptions').update(rr).eq('client_id', clientId).eq('stripe_subscription_id', subId);
      };
      const metaFor = (o: any) => {
        const m: Record<string, string> = { user_id: ud.user.id };
        if (o.layout === 'suite') Object.assign(m, { type: 'suite_subscription', ccb_client_id: clientId, ccb_plan_key: o.cTier, ccb_interval: o.interval, reach_client_id: clientId, reach_plan_key: rByTier.get(o.rTier).key, reach_interval: o.interval });
        else if (o.layout === 'content') Object.assign(m, { type: 'ccb_subscription', ccb_client_id: clientId, ccb_plan_key: o.cTier, ccb_interval: o.interval, reach_client_id: '', reach_plan_key: '', reach_interval: '' });
        else Object.assign(m, { type: 'reach_subscription', reach_client_id: clientId, reach_plan_key: rByTier.get(o.rTier).key, reach_interval: o.interval, ccb_client_id: '', ccb_plan_key: '', ccb_interval: '' });
        return m;
      };
      const amountFor = (o: any) => o.layout === 'suite' ? suitePrice(o.cTier, o.interval) : o.layout === 'content' ? priceOf(o.cTier, 'c', o.interval) : priceOf(o.rTier, 'r', o.interval);
      const nameFor = (o: any) => o.layout === 'suite' ? `Fullmedia Alchemist Suite — Content ${label(o.cTier)} + Reach ${label(o.rTier)}`
        : o.layout === 'content' ? `Fullmedia Alchemist — ${cByKey.get(o.cTier).name}` : `Alchemist Reach — ${label(o.rTier)}`;

      const applied: string[] = [];
      let checkoutUrl: string | null = null, pendingCheckouts = 0;
      for (const o of ops) {
        try {
          if (o.op === 'swap') {
            const cur: any = await stripe.subscriptions.retrieve(o.subId);
            const item = cur.items?.data?.[0];
            if (!item) return json({ error: 'Stripe has no item on this subscription.', applied }, 502);
            const product = await stripe.products.create({ name: nameFor(o), metadata: { layout: o.layout } });
            const updated: any = await stripe.subscriptions.update(cur.id, {
              items: [{ id: item.id, price_data: { currency: 'usd', product: product.id, unit_amount: amountFor(o), recurring: { interval: o.interval === 'annual' ? 'year' : 'month' } } }],
              proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete', cancel_at_period_end: false,
              metadata: { ...(cur.metadata || {}), ...metaFor(o) },
            });
            if (o.layout === 'suite') { await writeContent(o.cTier, updated, o.interval); await writeReach(o.rTier, updated, o.interval, true); }
            else if (o.layout === 'content') { await writeContent(o.cTier, updated, o.interval); if (o.fromSuite) await writeReach('free', null, 'monthly', false); }
            else { await writeReach(o.rTier, updated, o.interval, false); if (o.fromSuite) await writeContent('free', null, 'monthly'); }
            applied.push('swap:' + o.layout);
          } else if (o.op === 'cancel_end') {
            await stripe.subscriptions.update(o.subId, { cancel_at_period_end: true });
            await flagCancel(o.subId, true, o.only);
            applied.push('cancel_end');
          } else if (o.op === 'resume') {
            await stripe.subscriptions.update(o.subId, { cancel_at_period_end: false });
            await flagCancel(o.subId, false);
            applied.push('resume');
          } else if (o.op === 'cancel_now') {
            await stripe.subscriptions.cancel(o.subId, { prorate: true });
            applied.push('cancel_now');
          } else if (o.op === 'checkout') {
            if (checkoutUrl) { pendingCheckouts++; continue; }
            const customer = await usableCustomer(rsub?.stripe_customer_id) ?? await usableCustomer(csub?.stripe_customer_id);
            const meta: Record<string, string> = {}; for (const [k, v] of Object.entries(metaFor(o))) if (v) meta[k] = v;
            const session = await stripe.checkout.sessions.create({
              mode: 'subscription', payment_method_types: ['card'], payment_method_collection: 'if_required',
              ...(customer ? { customer } : { customer_email: email }),
              client_reference_id: clientId,
              line_items: [{ quantity: 1, price_data: { currency: 'usd', product_data: { name: nameFor(o), description: o.layout === 'suite' ? 'Content + Reach on the same tier, one subscription, 10% off while you keep both.' : 'Fullmedia Alchemist' }, unit_amount: amountFor(o), recurring: { interval: o.interval === 'annual' ? 'year' : 'month' } } }],
              subscription_data: { metadata: meta }, metadata: meta,
              allow_promotion_codes: o.layout !== 'suite',
              success_url: backUrl + '?checkout=success&session_id={CHECKOUT_SESSION_ID}',
              cancel_url: backUrl + '?checkout=cancelled',
              ...MANAGED_PAYMENTS_OFF,
            } as any);
            checkoutUrl = session.url;
          }
        } catch (e) {
          return json({ error: (e as Error).message || 'Stripe could not make this change.', applied }, 502);
        }
      }
      return json({ ok: true, applied, checkoutUrl, pendingCheckouts, totalAfter: after, totalBefore: monthlyBefore, saved });
    }

    if (action === 'resume') {
      if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
      const subs = Array.from(new Set([st.c.subId, st.r.subId].filter(Boolean))) as string[];
      if (!subs.length) return json({ error: 'No card plan to resume.' }, 400);
      for (const s of subs) {
        await stripe.subscriptions.update(s, { cancel_at_period_end: false });
        await sb.from('cc_subscriptions').update({ cancel_at_period_end: false, cancelled_at: null, updated_at: new Date().toISOString() }).eq('client_id', clientId).eq('stripe_subscription_id', s);
        await sb.from('ar_subscriptions').update({ cancel_at_period_end: false, updated_at: new Date().toISOString() }).eq('client_id', clientId).eq('stripe_subscription_id', s);
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown action. Expected overview, preview, change, resume or portal.' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

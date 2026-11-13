import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

// Alchemist Reach billing. Same Stripe account and same pattern as manage-ccb-subscription:
// prices are created inline (price_data) at checkout, never pre-created, so ar_plans / cc_plans stay the single source of truth.
//
// Actions (POST, JSON, caller must be signed in):
//   quote    -> plans with monthly/annual prices and the 20% same-tier bundle prices, plus what the caller holds now
//   checkout { reachPlan, interval: monthly|annual, bundle?: boolean }
//            -> Stripe Checkout URL. bundle=true sells ONE subscription covering the paired Content Engine tier and the
//               Reach tier at 20% off (same tier = ar_plans.content_pair_key).
//   portal   -> Stripe billing portal
//   cancel / resume -> cancel at period end (never immediately)
//
// Safety: plans are sold only while ar_plans.active = true (Brad flips that on when prices are confirmed).
// The client being billed is resolved from the caller's own cc_user_brands grants, never from the request body.
const KEY = Deno.env.get('ALCHEMIST_STRIPE_SECRET_KEY');
const stripe = KEY ? new Stripe(KEY, { apiVersion: '2024-06-20' }) : null;
const ADMIN_EMAILS = ['brad@unitedpress.media'];
const SITE = 'https://www.fullmediaalchemist.com';
const BUNDLE_OFF = 0.10;
// Same as create-stripe-checkout: Managed Payments is on by default for this Stripe account and demands product tax codes,
// so it is switched off per session (card checkout, as the Content Engine does).
const MANAGED_PAYMENTS_OFF = { managed_payments: { enabled: false } };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const isStripeSub = (id?: string | null) => !!id && id.startsWith('sub_');

async function usableCustomer(id?: string | null): Promise<string | undefined> {
  if (!id || !stripe) return undefined;
  try { const c: any = await stripe.customers.retrieve(id); return c && !c.deleted ? id : undefined; } catch { return undefined; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'not signed in' }, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: ud, error: ue } = await supabase.auth.getUser(jwt);
    if (ue || !ud?.user?.id || !ud.user.email) return json({ error: 'not signed in' }, 401);
    const email = ud.user.email;
    const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim();

    // The account being billed: the caller's own client.
    const { data: grants } = await supabase.from('cc_user_brands').select('client_id').eq('user_id', ud.user.id).not('client_id', 'is', null).limit(1);
    const { data: acct } = await supabase.from('ar_accounts').select('client_id').eq('user_id', ud.user.id).maybeSingle();
    const clientId = (acct?.client_id as string | undefined) ?? (grants?.[0]?.client_id as string | undefined) ?? (isAdmin ? '36e687f6-6c12-49dc-a3af-a637529a1251' : undefined);
    if (!clientId) return json({ error: 'This login has no billing account yet.' }, 400);

    const { data: plans } = await supabase.from('ar_plans').select('*').order('sort_order');
    const { data: cplans } = await supabase.from('cc_plans').select('key,name,price_cents,annual_price_cents,active');
    const cmap = new Map((cplans || []).map((p: any) => [p.key, p]));
    const { data: rsub } = await supabase.from('ar_subscriptions').select('*').eq('client_id', clientId).maybeSingle();
    const { data: csub } = await supabase.from('cc_subscriptions')
      .select('id, status, stripe_customer_id, stripe_subscription_id, cc_plans(key)').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle();

    const bundlePrice = (r: number, c: number) => Math.round((r + c) * (1 - BUNDLE_OFF));

    if (action === 'quote') {
      const out = (plans || []).map((p: any) => {
        const c: any = cmap.get(p.content_pair_key);
        const cm = c ? Number(c.price_cents) : 0, ca = c ? Number(c.annual_price_cents) : 0;
        return {
          key: p.key, name: p.name, tagline: p.tagline, features: p.features, active: !!p.active,
          monthly: Number(p.price_cents), annual: Number(p.annual_price_cents),
          content: c ? { key: c.key, name: c.name, monthly: cm, annual: ca } : null,
          bundleMonthly: p.price_cents > 0 && cm > 0 ? bundlePrice(Number(p.price_cents), cm) : null,
          bundleAnnual: p.annual_price_cents > 0 && ca > 0 ? bundlePrice(Number(p.annual_price_cents), ca) : null,
        };
      });
      return json({ ok: true, plans: out, bundleOff: BUNDLE_OFF, current: { reach: rsub?.plan_key ?? null, bundle: !!rsub?.bundle, content: (csub as any)?.cc_plans?.key ?? null, cancelAtPeriodEnd: !!rsub?.cancel_at_period_end, comp: !!rsub?.is_comp } });
    }

    if (action === 'checkout') {
      if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
      const interval = body.interval === 'annual' ? 'annual' : 'monthly';
      const rp: any = (plans || []).find((p: any) => p.key === String(body.reachPlan || ''));
      if (!rp || !rp.active) return json({ error: 'That plan is not on sale yet.' }, 400);
      if (rp.key === 'free') return json({ error: 'Free needs no checkout.' }, 400);
      const unit = interval === 'annual' ? Number(rp.annual_price_cents) : Number(rp.price_cents);
      if (!unit) return json({ error: 'That plan has no price for this billing period.' }, 400);

      let amount = unit;
      let name = `Alchemist Reach — ${rp.name}`;
      const meta: Record<string, string> = { type: 'reach_subscription', reach_client_id: clientId, reach_plan_key: rp.key, reach_interval: interval, user_id: ud.user.id };
      if (body.bundle) {
        const cp: any = cmap.get(rp.content_pair_key);
        const cu = cp ? (interval === 'annual' ? Number(cp.annual_price_cents) : Number(cp.price_cents)) : 0;
        if (!cp || !cp.active || cp.key === 'free' || !cu) return json({ error: 'There is no matching Content Engine plan for a bundle at this tier.' }, 400);
        amount = bundlePrice(unit, cu);
        name = `Fullmedia Alchemist Suite — ${cp.name} + Reach ${rp.name}`;
        Object.assign(meta, { type: 'suite_subscription', ccb_client_id: clientId, ccb_plan_key: cp.key, ccb_interval: interval });
      }
      // A stored customer id may belong to a different Stripe account (older SpinQuest billing); only reuse one that exists here.
      const customer = await usableCustomer(rsub?.stripe_customer_id as string | null) ?? await usableCustomer((csub as any)?.stripe_customer_id as string | null);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        // A 100%-off promotion code leaves nothing to charge, so no card is asked for in that case.
        payment_method_collection: 'if_required',
        ...(customer ? { customer } : { customer_email: email }),
        client_reference_id: clientId,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', product_data: { name, description: body.bundle ? 'Content Engine + Alchemist Reach, 10% off while you keep both.' : 'Alchemist Reach, by Fullmedia Alchemist.' }, unit_amount: amount, recurring: { interval: interval === 'annual' ? 'year' : 'month' } } }],
        subscription_data: { metadata: meta },
        metadata: meta,
        allow_promotion_codes: true,
        success_url: `${SITE}/reach/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE}/reach/?checkout=cancelled`,
        ...MANAGED_PAYMENTS_OFF,
      } as any);
      return json({ ok: true, url: session.url });
    }

    if (action === 'portal') {
      if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
      const customer = await usableCustomer(rsub?.stripe_customer_id as string | null) ?? await usableCustomer((csub as any)?.stripe_customer_id as string | null);
      if (!customer) return json({ error: 'No card subscription on file for this account.' }, 400);
      const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${SITE}/reach/` });
      return json({ ok: true, url: s.url });
    }

    if (action === 'cancel' || action === 'resume') {
      if (!rsub) return json({ error: 'No Reach plan on this account.' }, 404);
      if (rsub.is_comp) return json({ error: 'This account is on a complimentary plan.' }, 400);
      const flag = action === 'cancel';
      if (isStripeSub(rsub.stripe_subscription_id)) {
        if (!stripe) return json({ error: 'Billing is not configured yet.' }, 503);
        await stripe.subscriptions.update(rsub.stripe_subscription_id as string, { cancel_at_period_end: flag });
      }
      await supabase.from('ar_subscriptions').update({ cancel_at_period_end: flag, updated_at: new Date().toISOString() }).eq('client_id', clientId);
      // A bundle is one Stripe subscription, so the Content row shares the flag.
      if (rsub.bundle && csub?.stripe_subscription_id === rsub.stripe_subscription_id) {
        await supabase.from('cc_subscriptions').update({ cancel_at_period_end: flag, updated_at: new Date().toISOString() }).eq('id', (csub as any).id);
      }
      return json({ ok: true, cancel_at_period_end: flag });
    }

    return json({ error: 'Unknown action. Expected quote, checkout, portal, cancel or resume.' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

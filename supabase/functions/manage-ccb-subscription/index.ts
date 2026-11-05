import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

// Self-serve plan management for Content Conveyor Belt clients.
//
// Actions:
//   portal  -- open Stripe's own billing portal for a card subscription, so
//              plan changes, card updates and invoices are handled by Stripe
//              rather than reimplemented here.
//   cancel  -- cancel at PERIOD END, never immediately: the customer keeps
//              what they've already paid for. Works for crypto and comped
//              plans too, which have no Stripe subscription to call.
//   resume  -- undo a pending cancellation before the period ends.
//
// Ownership is never taken from the request body: the caller's own
// cc_user_brands grants are resolved to client_ids through cc_brands, and
// only those clients can be touched. Admins are allowed through, matching
// every other brand-scoped function here.
const ADMIN_EMAILS = ['spinquest.app@gmail.com', 'watchcrypto.media@gmail.com', 'brad@unitedpress.media'];

// Every Stripe object this function touches -- the customer behind the
// billing portal, the subscription it cancels or resumes -- belongs to
// whichever account sold the Alchemist plan. So all three actions must use
// the SAME key create-stripe-checkout sold on, or the portal 404s and
// cancel/resume fail with "No such subscription" the moment Alchemist
// billing moves to its own account. Falls back to the platform key while
// ALCHEMIST_STRIPE_SECRET_KEY is unset, exactly as the checkout does.
const PLATFORM_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const ALCHEMIST_KEY = Deno.env.get('ALCHEMIST_STRIPE_SECRET_KEY') || PLATFORM_KEY;
const alchemistStripe = new Stripe(ALCHEMIST_KEY, { apiVersion: '2024-06-20' });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 2026-09-25: CCB_APP_URL is read by two functions that disagreed about
// what it points at -- create-stripe-checkout appends "/?checkout=success"
// to it (so it wants the dashboard), this one appended "/dashboard" (so it
// wanted the site root). Whichever way the secret is set, one of them was
// wrong. Normalising here means this function lands on the dashboard either
// way and the secret can be set to the dashboard URL -- which is what the
// checkout return needs -- without producing "/dashboard/dashboard".
const CCB_APP_URL_RAW = Deno.env.get('CCB_APP_URL') ?? 'https://www.fullmediaalchemist.com';
const CCB_BASE = CCB_APP_URL_RAW.replace(/\/+$/, '');
const CCB_DASHBOARD_URL = /\/dashboard$/i.test(CCB_BASE) ? CCB_BASE : CCB_BASE + '/dashboard';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// A subscription id that Stripe would actually recognise. Crypto and comped
// plans store synthetic ids (helio_..., comp_...) and must never be sent to
// Stripe -- they're cancelled in our own table instead.
function isStripeSub(id?: string | null): boolean {
  return !!id && id.startsWith('sub_');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'not signed in' }, 401);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user?.id || !userData.user.email) return json({ error: 'not signed in' }, 401);
    const userId = userData.user.id;
    const isAdmin = ADMIN_EMAILS.includes(userData.user.email);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const brand = String(body.brand || '').trim();
    if (!brand) return json({ error: 'Brand is required.' }, 400);

    if (!isAdmin) {
      const { data: grant } = await supabase
        .from('cc_user_brands').select('brand')
        .eq('user_id', userId).eq('brand', brand).maybeSingle();
      if (!grant) return json({ error: 'You do not have access to this brand.' }, 403);
    }

    const { data: brandRow } = await supabase
      .from('cc_brands').select('id, client_id, name').eq('name', brand).maybeSingle();
    if (!brandRow?.client_id) {
      return json({ error: 'This brand has no billing account yet.' }, 400);
    }
    const clientId = brandRow.client_id as string;

    const { data: sub } = await supabase
      .from('cc_subscriptions')
      .select('id, status, billing_interval, current_period_end, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, is_comp, plan_id, cc_plans(key, name)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (action === 'portal') {
      if (!sub?.stripe_customer_id) {
        return json({ error: 'No card subscription on file for this account. Start one from the plan list, or cancel a crypto plan here and pay for the new one.' }, 400);
      }
      const session = await alchemistStripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id as string,
        return_url: CCB_DASHBOARD_URL,
      });
      return json({ ok: true, url: session.url });
    }

    if (action === 'cancel') {
      if (!sub) return json({ error: 'No plan to cancel on this account.' }, 404);
      if (sub.cancel_at_period_end) {
        return json({ ok: true, already: true, current_period_end: sub.current_period_end });
      }
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null;

      // A real Stripe subscription is cancelled at Stripe first, so billing
      // actually stops; our row is then synced. For crypto and comped plans
      // there is nothing at Stripe, and the row IS the record.
      if (isStripeSub(sub.stripe_subscription_id as string)) {
        try {
          await alchemistStripe.subscriptions.update(sub.stripe_subscription_id as string, { cancel_at_period_end: true });
        } catch (e) {
          return json({ error: (e as Error).message || 'Stripe could not cancel this subscription.' }, 502);
        }
      }

      const { error: updErr } = await supabase
        .from('cc_subscriptions')
        .update({
          cancel_at_period_end: true,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id);
      if (updErr) return json({ error: updErr.message }, 500);

      return json({ ok: true, cancel_at_period_end: true, current_period_end: sub.current_period_end });
    }

    if (action === 'resume') {
      if (!sub) return json({ error: 'No plan on this account.' }, 404);
      if (!sub.cancel_at_period_end) return json({ ok: true, already: true });

      if (isStripeSub(sub.stripe_subscription_id as string)) {
        try {
          await alchemistStripe.subscriptions.update(sub.stripe_subscription_id as string, { cancel_at_period_end: false });
        } catch (e) {
          return json({ error: (e as Error).message || 'Stripe could not resume this subscription.' }, 502);
        }
      }

      const { error: updErr } = await supabase
        .from('cc_subscriptions')
        .update({ cancel_at_period_end: false, cancelled_at: null, cancellation_reason: null, updated_at: new Date().toISOString() })
        .eq('id', sub.id);
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true, cancel_at_period_end: false });
    }

    return json({ error: 'Unknown action. Expected portal, cancel or resume.' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

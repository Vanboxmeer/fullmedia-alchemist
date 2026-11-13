import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Webhook for the Fullmedia Alchemist Stripe account.
//
// Why a second function rather than teaching stripe-webhook two secrets:
// constructEventAsync verifies against exactly ONE signing secret, and
// trying each in turn to see which one sticks turns a signature check into
// a guess. One endpoint, one account, one secret.
//
// Scope is deliberately narrow. This function only ever touches
// cc_subscriptions. It never writes subscription_plans, credits or
// referral_earnings -- those are SpinQuest concepts and belong to the
// SpinQuest account's own webhook. An event that is not a CCB subscription
// is recorded and ignored rather than guessed at.
const SECRET_KEY = Deno.env.get('ALCHEMIST_STRIPE_SECRET_KEY');
const WEBHOOK_SECRET = Deno.env.get('ALCHEMIST_STRIPE_WEBHOOK_SECRET');

async function upsertCcbSubscriptionFromCheckout(
  supabase: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
) {
  const { ccb_client_id, ccb_plan_key, ccb_interval } = session.metadata ?? {};
  if (!ccb_client_id || !ccb_plan_key) {
    console.error('alchemist-stripe-webhook: checkout.session.completed missing ccb_client_id/ccb_plan_key', session.id);
    return;
  }

  const { data: plan, error: planErr } = await supabase
    .from('cc_plans')
    .select('id')
    .eq('key', ccb_plan_key)
    .maybeSingle();
  if (planErr || !plan) {
    console.error('alchemist-stripe-webhook: plan lookup failed for key', ccb_plan_key, planErr);
    return;
  }

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  if (ccb_interval === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { error } = await supabase.from('cc_subscriptions').upsert({
    client_id: ccb_client_id,
    plan_id: plan.id,
    status: 'active',
    billing_interval: ccb_interval === 'annual' ? 'annual' : 'monthly',
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    trial_ends_at: null,
    stripe_customer_id: session.customer as string,
    stripe_subscription_id: session.subscription as string,
  }, { onConflict: 'client_id' });

  if (error) console.error('alchemist-stripe-webhook: cc_subscriptions upsert error:', error);
  else console.log(`alchemist-stripe-webhook: activated CCB client ${ccb_client_id} on plan ${ccb_plan_key} (${ccb_interval})`);
}

async function updateCcbSubscriptionStatus(
  supabase: ReturnType<typeof createClient>,
  sub: Stripe.Subscription,
) {
  const ccbClientId = sub.metadata?.ccb_client_id;
  if (!ccbClientId) return;

  const status = sub.status === 'active' ? 'active'
    : sub.status === 'canceled' ? 'canceled'
    : sub.status === 'past_due' ? 'past_due'
    : 'paused';

  const { error } = await supabase.from('cc_subscriptions')
    .update({
      status,
      current_period_end: (sub as any).current_period_end
        ? new Date((sub as any).current_period_end * 1000).toISOString()
        : undefined,
    })
    .eq('client_id', ccbClientId);

  if (error) console.error('alchemist-stripe-webhook: cc_subscriptions status update error:', error);
  else console.log(`alchemist-stripe-webhook: CCB client ${ccbClientId} subscription status -> ${status}`);
}

Deno.serve(async (req: Request) => {
  // Fail closed and say why. A webhook that silently 200s while doing
  // nothing is worse than one that is visibly not configured -- Stripe's
  // delivery log is where this gets noticed.
  if (!SECRET_KEY || !WEBHOOK_SECRET) {
    console.error('alchemist-stripe-webhook: ALCHEMIST_STRIPE_SECRET_KEY / ALCHEMIST_STRIPE_WEBHOOK_SECRET not set');
    return new Response(
      JSON.stringify({ error: 'Alchemist Stripe account is not configured on this project yet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const stripe = new Stripe(SECRET_KEY, { apiVersion: '2024-06-20' });
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, WEBHOOK_SECRET);
  } catch (err: any) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  await supabase.from('stripe_webhooks').insert({
    event_id: event.id,
    event_type: event.type,
    payload: event as any,
  });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.type === 'ccb_subscription') {
      await upsertCcbSubscriptionFromCheckout(supabase, session);
    } else if (session.metadata?.type === 'reach_topup' && session.payment_status === 'paid') {
      // Backup for the confirm call the app makes on return: same row, unique per Checkout session, so it can never double-credit.
      const credits = Number(session.metadata.credits) || 0;
      const cid = session.metadata.reach_client_id;
      if (cid && credits > 0 && credits <= 5000 && credits % 1000 === 0 && Number(session.amount_total) === (credits / 1000) * 2000) {
        const { error } = await supabase.from('ar_credit_topups').upsert({ client_id: cid, credits, amount_cents: Number(session.amount_total), stripe_session_id: session.id }, { onConflict: 'stripe_session_id', ignoreDuplicates: true });
        if (error) console.error('alchemist-stripe-webhook: ar_credit_topups error', error);
      } else console.error('alchemist-stripe-webhook: reach_topup rejected', session.id);
    } else {
      console.log('alchemist-stripe-webhook: ignoring non-CCB checkout session', session.id);
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : (invoice.subscription as any)?.id;

    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        if (sub.metadata?.type === 'ccb_subscription') {
          await updateCcbSubscriptionStatus(supabase, sub);
          const ccbClientId = sub.metadata?.ccb_client_id;
          const interval = sub.metadata?.ccb_interval === 'annual' ? 'annual' : 'monthly';
          if (ccbClientId) {
            const periodStart = new Date();
            const periodEnd = new Date(periodStart);
            if (interval === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            else periodEnd.setMonth(periodEnd.getMonth() + 1);
            await supabase.from('cc_subscriptions').update({
              status: 'active',
              current_period_start: periodStart.toISOString(),
              current_period_end: periodEnd.toISOString(),
            }).eq('client_id', ccbClientId);
          }
        } else {
          console.log('alchemist-stripe-webhook: ignoring non-CCB invoice for', subId);
        }
      } catch (e) {
        console.error('alchemist-stripe-webhook: could not resolve subscription:', e);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.type === 'ccb_subscription') {
      await updateCcbSubscriptionStatus(supabase, sub);
    } else {
      console.log('alchemist-stripe-webhook: ignoring non-CCB subscription event', sub.id);
    }
  }

  await supabase.from('stripe_webhooks').update({ processed: true }).eq('event_id', event.id);
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});

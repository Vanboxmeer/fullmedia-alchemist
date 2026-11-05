import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Two Stripe accounts, one Supabase project.
//
// SpinQuest's own subscriptions and credit top-ups bill from the SpinQuest
// account (STRIPE_SECRET_KEY). Fullmedia Alchemist is a separate product and
// must bill from its own account, because Stripe branding -- the business
// name a customer reads at the top of the Checkout page -- is per ACCOUNT.
// There is no multi-brand switch inside one account, which is why the
// Alchemist checkout read "SpinQuest" while both shared a key.
//
// Until ALCHEMIST_STRIPE_SECRET_KEY exists, the Alchemist path falls back to
// the platform key, so behaviour is byte-for-byte what it is today and there
// is no flag day: setting the secret is what switches it over.
const PLATFORM_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const ALCHEMIST_KEY = Deno.env.get('ALCHEMIST_STRIPE_SECRET_KEY') || PLATFORM_KEY;

const stripe = new Stripe(PLATFORM_KEY, { apiVersion: '2024-06-20' });
const alchemistStripe = ALCHEMIST_KEY === PLATFORM_KEY
  ? stripe
  : new Stripe(ALCHEMIST_KEY, { apiVersion: '2024-06-20' });

const APP_URL = Deno.env.get('APP_URL') ?? 'https://spinquest-adventure-fun-wheel.vercel.app';

// The CCB/Alchemist app URL is read by two functions that historically
// disagreed about whether it points at the site root or at /dashboard.
// manage-ccb-subscription normalises it the same way; keep the two in sync
// so a customer always lands back inside the app after paying rather than
// on the marketing homepage.
const CCB_APP_URL_RAW = Deno.env.get('CCB_APP_URL') ?? 'https://www.fullmediaalchemist.com';
const CCB_BASE = CCB_APP_URL_RAW.replace(/\/+$/, '');
const CCB_DASHBOARD_URL = /\/dashboard$/i.test(CCB_BASE) ? CCB_BASE : CCB_BASE + '/dashboard';

// The product name the customer reads on the Stripe Checkout page and on
// their card statement. 2026-09-25: this said "Content Conveyor Belt",
// the product's pre-rebrand name, which Brad caught on a live checkout --
// a customer would have been asked to pay for something whose name appears
// nowhere on the site they were just on.
const CCB_PRODUCT_BRAND = 'Fullmedia Alchemist';

// These Price objects live in the SpinQuest account and are only ever used
// by the top-up path, which always uses the platform client.
const TOPUP_PRICE_IDS: Record<string, string> = {
  spin: 'price_1TkfDLEHgcDA3gMCVRDImAS4',
  ai: 'price_1SUWGKEHgcDA3gMCKYirz9Tv',
};

// 2026-09-25: `apikey` was missing from Allow-Headers. The dashboard's
// authHeaders() sends apikey alongside authorization on every call, so the
// browser's CORS preflight failed and "Pay by card" died as "Failed to
// fetch" -- before the request ever left the browser. That is why
// stripe_webhooks has never recorded a single event: no CCB checkout
// session has ever been created from the app. Every other CCB function
// already allowed apikey; this one was the odd one out.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json();
    const { priceId, planType, productId, topupType, referralCode, ccbPlanKey, ccbInterval, ccbClientId } = body;

    let session;
    if (ccbPlanKey) {
      // --- Fullmedia Alchemist subscription checkout ---
      // Billed from the Alchemist Stripe account (see the key resolution at
      // the top of this file). Nothing in this branch references an
      // account-scoped object: the price is built inline from cc_plans with
      // price_data, and no coupon is applied. That is what makes it safe to
      // move accounts without creating anything in the new one first.
      //
      // These plans don't have pre-created Stripe Price objects (no dashboard
      // step required to launch billing) -- we price the Checkout Session
      // dynamically from cc_plans itself via Stripe's price_data, so cc_plans
      // stays the single source of truth for pricing.
      if (!ccbClientId) throw new Error('ccbClientId is required for a CCB checkout');
      const interval = ccbInterval === 'annual' ? 'annual' : 'monthly';

      const { data: plan, error: planErr } = await supabaseAdmin
        .from('cc_plans')
        .select('key, name, tagline, price_cents, annual_price_cents, brands_included, posts_included_monthly, active')
        .eq('key', ccbPlanKey)
        .single();
      if (planErr || !plan || !plan.active) throw new Error('Unknown or inactive CCB plan');

      const unitAmount = interval === 'annual' ? plan.annual_price_cents : plan.price_cents;
      const recurringInterval = interval === 'annual' ? 'year' : 'month';

      // Ownership check: the authenticated user must actually be linked to
      // the client they're paying for -- never trust a client_id passed by
      // the caller without verifying it belongs to them.
      const { data: ownedClient } = await supabaseAdmin
        .from('cc_user_brands')
        .select('client_id')
        .eq('user_id', user.id)
        .eq('client_id', ccbClientId)
        .limit(1);
      if (!ownedClient || ownedClient.length === 0) throw new Error('You do not have access to this CCB client account');

      // What the customer sees on the Checkout line item. The plan's own
      // tagline (or, failing that, its real included allowances) goes in the
      // description so the page states what is actually being bought rather
      // than just a tier word.
      const planDescription = (plan.tagline && String(plan.tagline).trim())
        || `${plan.brands_included} brand${plan.brands_included === 1 ? '' : 's'}, ${plan.posts_included_monthly} content pieces per month`;

      session = await alchemistStripe.checkout.sessions.create({
        mode: 'subscription', payment_method_types: ['card'],
        customer_email: user.email,
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: unitAmount,
            recurring: { interval: recurringInterval },
            product_data: {
              name: `${CCB_PRODUCT_BRAND} — ${plan.name}`,
              description: planDescription,
            },
          },
          quantity: 1,
        }],
        success_url: `${CCB_DASHBOARD_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${CCB_DASHBOARD_URL}/?checkout=cancelled`,
        metadata: { type: 'ccb_subscription', ccb_client_id: ccbClientId, ccb_plan_key: ccbPlanKey, ccb_interval: interval, user_id: user.id },
        subscription_data: { metadata: { type: 'ccb_subscription', ccb_client_id: ccbClientId, ccb_plan_key: ccbPlanKey, ccb_interval: interval, user_id: user.id } },
        allow_promotion_codes: true,
      });
    } else if (productId || topupType) {
      const resolvedTopupType = topupType === 'spin' ? 'spin' : 'ai';
      const topupPriceId = TOPUP_PRICE_IDS[resolvedTopupType];
      session = await stripe.checkout.sessions.create({
        mode: 'payment', payment_method_types: ['card'],
        customer_email: user.email,
        line_items: [{ price: topupPriceId, quantity: 1 }],
        success_url: `${APP_URL}/PaymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL}/PaymentCancelled`,
        metadata: { user_id: user.id, type: 'topup', topup_type: resolvedTopupType },
      });
    } else if (priceId) {
      // Referral discount logic (subscription only)
      const discounts: { coupon: string }[] = [];

      if (referralCode && referralCode.trim()) {
        try {
          const { data: referrerProfiles } = await supabaseAdmin
            .from('user_profiles')
            .select('user_id, referral_code')
            .eq('referral_code', referralCode.trim().toLowerCase())
            .neq('user_id', user.id)
            .limit(1);

          if (referrerProfiles && referrerProfiles.length > 0) {
            const referrerId = referrerProfiles[0].user_id;

            let coupon: Stripe.Coupon;
            try {
              coupon = await stripe.coupons.retrieve('SPINQUEST10');
            } catch {
              coupon = await stripe.coupons.create({
                id: 'SPINQUEST10',
                percent_off: 10,
                duration: 'once',
                name: '10% off first billing (SpinQuest referral)',
              });
            }

            discounts.push({ coupon: coupon.id });

            await supabaseAdmin
              .from('referrals')
              .upsert(
                {
                  referrer_id: referrerId,
                  referred_id: user.id,
                  discount_applied: true,
                  discount_pct: 10,
                  ref_code: referralCode.trim().toLowerCase(),
                },
                { onConflict: 'referred_id' }
              );
          }
        } catch (refErr) {
          console.error('[create-stripe-checkout] referral lookup error:', refErr);
          // Non-fatal -- proceed without discount
        }
      }

      session = await stripe.checkout.sessions.create({
        mode: 'subscription', payment_method_types: ['card'],
        customer_email: user.email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${APP_URL}/PaymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL}/PaymentCancelled`,
        metadata: { user_id: user.id, type: 'subscription', plan_type: planType ?? '' },
        // Also stamp metadata onto the resulting Subscription object itself --
        // the Checkout Session's top-level metadata does NOT automatically
        // carry over to the Subscription Stripe creates from it. Without this,
        // the stripe-webhook function's customer.subscription.updated/deleted
        // handler (which reads sub.metadata.user_id) can't identify which user
        // a cancellation/expiry belongs to.
        subscription_data: { metadata: { user_id: user.id, plan_type: planType ?? '' } },
        ...(discounts.length > 0 ? { discounts } : { allow_promotion_codes: true }),
      });
    } else throw new Error('Must provide priceId, productId, topupType, or ccbPlanKey');

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

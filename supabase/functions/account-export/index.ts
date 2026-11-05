import { createClient } from "npm:@supabase/supabase-js@2";

// account-export: a signed-in person downloads their own data as one JSON file.
// Read-only. The caller is identified by their own sign-in token; nothing in the
// request chooses whose data is returned. Secrets (Stripe ids, tokens, keys) and
// bulky image previews are left out.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const CAP = 5000;
const DROP = /^(thumb_data_uri.*|stripe_.*|.*token.*|.*secret.*|.*api_key.*|key_hash|password.*)$/i;
const lastCall = new Map<string, number>();

// deno-lint-ignore no-explicit-any
function strip(rows: any[] | null): any[] {
  return (rows || []).map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(r)) if (!DROP.test(k)) o[k] = r[k];
    return o;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Please sign in again." }, 401);
    const { data: ud, error: ue } = await admin.auth.getUser(jwt);
    const user = ud?.user;
    if (ue || !user) return json({ error: "Please sign in again." }, 401);

    const now = Date.now();
    if (now - (lastCall.get(user.id) || 0) < 15000) return json({ error: "One export at a time. Try again in a few seconds." }, 429);
    lastCall.set(user.id, now);

    const errors: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    const pull = async (name: string, table: string, col: string, vals: any[]): Promise<any[]> => {
      const v = (vals || []).filter((x) => x !== null && x !== undefined);
      if (!v.length) return [];
      const { data, error } = await admin.from(table).select("*").in(col, v).limit(CAP);
      if (error) { errors[name] = error.message.slice(0, 160); return []; }
      return strip(data);
    };

    const links = await pull("content_brand_access", "cc_user_brands", "user_id", [user.id]);
    const reachAcc = await pull("reach_accounts", "ar_accounts", "user_id", [user.id]);
    const clientIds = [...new Set([...links.map((l) => l.client_id), ...reachAcc.map((l) => l.client_id)].filter(Boolean))];
    const brandSlugs = [...new Set(links.map((l) => l.brand).filter(Boolean))];

    // Billing and workspace details are only for workspaces this person owns (their contact email, or their own Reach account).
    // A brand someone was invited to is included as content they can already see, but not that workspace's owner or billing details.
    const allClients = await pull("workspaces", "cc_clients", "id", clientIds);
    const mine = (user.email || "").toLowerCase();
    const reachIds = reachAcc.map((l) => l.client_id).filter(Boolean);
    const ownIds = [...new Set([...allClients.filter((c) => String(c.contact_email || "").toLowerCase() === mine).map((c) => c.id), ...reachIds])];
    const clients = allClients.map((c) => ownIds.includes(c.id) ? c : { id: c.id, name: c.name, shared_with_you: true });
    const subscriptions = await pull("content_subscriptions", "cc_subscriptions", "client_id", ownIds);
    const reachSubs = await pull("reach_subscriptions", "ar_subscriptions", "client_id", ownIds);
    const contentBrands = await pull("content_brands", "cc_brands", "client_id", clientIds);
    const brandIds = contentBrands.map((b) => b.id);
    const campaigns = await pull("campaigns", "cc_campaigns", "brand_id", brandIds);
    const posts = await pull("posts", "content_calendar", "brand", brandSlugs);
    const knowledge = await pull("brand_knowledge", "cc_brand_knowledge", "brand_id", brandIds);
    const reports = await pull("reports", "cc_reports", "brand_id", brandIds);
    const usage = await pull("content_usage", "cc_usage_events", "client_id", ownIds);
    const reachBrands = await pull("reach_brands", "ar_brands", "client_id", reachIds);
    const rbIds = reachBrands.map((b) => b.id);
    const reach = {
      deals: await pull("reach_deals", "ar_deals", "brand_id", rbIds),
      comms: await pull("reach_comms", "ar_comms", "brand_id", rbIds),
      rates: await pull("reach_rates", "ar_rates", "brand_id", rbIds),
      waves: await pull("reach_waves", "ar_waves", "brand_id", rbIds),
      requests: await pull("reach_requests", "ar_requests", "brand_id", rbIds),
    };
    const tickets = await pull("support_reports", "cc_support_tickets", "user_id", [user.id]);
    const terms = await pull("terms_accepted", "cc_terms_acceptance", "user_id", [user.id]);
    const prefs = await pull("email_preferences", "cc_email_prefs", "user_id", [user.id]);

    const factors = Array.isArray(user.factors) ? user.factors.map((f) => ({ type: f.factor_type, status: f.status, added: f.created_at })) : [];
    return json({
      exported_at: new Date().toISOString(),
      note: "Your Fullmedia Alchemist data. Payment card details are held by Stripe and are not in this file. Image previews and access keys are left out.",
      account: {
        id: user.id, email: user.email, created_at: user.created_at, last_sign_in_at: user.last_sign_in_at,
        sign_in_methods: user.app_metadata?.providers || [], two_step_sign_in: factors,
      },
      workspaces: clients, content: { brands: contentBrands, campaigns, posts, brand_knowledge: knowledge, reports, usage },
      reach: { brands: reachBrands, ...reach },
      subscriptions: { content: subscriptions, reach: reachSubs },
      activity: { support_reports: tickets, terms_accepted: terms, email_preferences: prefs },
      row_limit_per_table: CAP,
      skipped: errors,
    });
  } catch (e) {
    console.error("account-export error", e);
    return json({ error: "Could not build your export. Please try again." }, 500);
  }
});

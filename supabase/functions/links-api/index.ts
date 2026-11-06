// links-api — tracking links for the signed-in user's brands (Content and Reach).
//  Step 1: tagged URLs are decided in the app from the per-brand settings returned here.
//  Step 2: short links on the brand's OWN domain: the user adds one DNS record, we attach the domain to our Vercel project
//          and the redirect function (api/l.js) serves it. Paid plans only; enforced here, not just in the app.
// Secrets for custom domains: VERCEL_TOKEN (required), VERCEL_PROJECT_ID (default content-conveyor-belt), VERCEL_TEAM_ID (optional).
// Deploy with verify_jwt=false (auth is done in here).
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const VT = Deno.env.get("VERCEL_TOKEN") || "";
const VP = Deno.env.get("VERCEL_PROJECT_ID") || "content-conveyor-belt";
const VTEAM = Deno.env.get("VERCEL_TEAM_ID") || "";
const CNAME_TARGET = "cname.vercel-dns.com";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
const clean = (v: unknown, n: number) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

async function userCtx(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const sb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser(auth.slice(7));
  if (!u?.user) return null;
  const { data: ub } = await admin.from("cc_user_brands").select("brand").eq("user_id", u.user.id);
  const names = [...new Set(((ub as any[]) || []).map((r) => String(r.brand)))];
  if (!names.length) return { uid: u.user.id, client: null as string | null, brands: new Set<string>() };
  const { data: brs } = await admin.from("cc_brands").select("name,client_id").in("name", names).not("client_id", "is", null);
  const count = new Map<string, number>(); ((brs as any[]) || []).forEach((b) => count.set(b.client_id, (count.get(b.client_id) || 0) + 1));
  const client = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const mine = new Set<string>(((brs as any[]) || []).filter((b) => b.client_id === client).map((b) => String(b.name)));
  return { uid: u.user.id, client, brands: mine };
}

async function vercel(method: string, path: string, body?: unknown) {
  if (!VT) return { ok: false, status: 0, json: { error: { message: "not_configured" } } as any };
  const sep = path.includes("?") ? "&" : "?";
  const url = "https://api.vercel.com" + path + (VTEAM ? `${sep}teamId=${encodeURIComponent(VTEAM)}` : "");
  const r = await fetch(url, { method, headers: { Authorization: "Bearer " + VT, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: json as any };
}

const BAD_HOST = /(^|\.)(fullmediaalchemist\.com|vercel\.app|vercel\.com|vercel\.sh|supabase\.co|supabase\.com|localhost|local|internal|test|example\.com)$/i;
function cleanHost(v: unknown) {
  const h = String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,}$/.test(h)) return "";
  if (BAD_HOST.test(h)) return "";
  return h;
}
const originOf = (u: string) => { try { const x = new URL(/^https?:\/\//i.test(u) ? u : "https://" + u); return x.origin; } catch { return ""; } };

async function info(client: string, brand: string) {
  const { data } = await admin.rpc("fma_track_info", { p_client: client, p_brand: brand });
  return (data || { eligible: false, tag: false, short: false, host: null }) as { eligible: boolean; tag: boolean; short: boolean; host: string | null };
}

async function status(client: string, brand: string, days = 30) {
  const [inf, st, dom, stats] = await Promise.all([
    info(client, brand),
    admin.from("fma_link_settings").select("tag_urls,short_enabled").eq("client_id", client).eq("brand", brand).maybeSingle(),
    admin.from("fma_link_domains").select("hostname,status,note,home_url,created_at,verified_at").eq("client_id", client).eq("brand", brand).maybeSingle(),
    admin.rpc("fma_link_stats", { p_client: client, p_brand: brand, p_days: days }),
  ]);
  const s: any = st.data || {};
  return {
    ok: true, eligible: inf.eligible,
    settings: { tag_urls: s.tag_urls !== false, short_enabled: s.short_enabled === true },
    active: { tag: inf.tag, short: inf.short, host: inf.host },
    domain: dom.data || null, dnsTarget: CNAME_TARGET, domainsReady: !!VT,
    stats: stats.data || { total: 0, links: 0, top: [], byNetwork: {}, byCampaign: {} },
  };
}

async function act(u: { uid: string; client: string | null; brands: Set<string> }, client: string, body: any) {
  const action = clean(body.action, 30);
  const brand = clean(body.brand, 120);
  if (!brand || !u.brands.has(brand)) return { ok: false, error: "Pick one of your brands." };
  if (action === "status") return await status(client, brand, Math.max(1, Math.min(365, Number(body.days) || 30)));

  if (action === "save") {
    const cur = (await status(client, brand)).settings;
    const data = {
      client_id: client, brand,
      tag_urls: typeof body.tag_urls === "boolean" ? body.tag_urls : cur.tag_urls,
      short_enabled: typeof body.short_enabled === "boolean" ? body.short_enabled : cur.short_enabled,
      updated_at: new Date().toISOString(),
    };
    if (!(await info(client, brand)).eligible && (data.tag_urls !== cur.tag_urls || data.short_enabled !== cur.short_enabled))
      return { ok: false, error: "Tracking links are on paid plans. Upgrade to turn them on.", upgrade: true };
    await admin.from("fma_link_settings").upsert(data, { onConflict: "client_id,brand" });
    return await status(client, brand);
  }

  if (action === "add_domain") {
    if (!(await info(client, brand)).eligible) return { ok: false, error: "Short links on your own domain are on paid plans.", upgrade: true };
    if (!VT) return { ok: false, error: "Own-domain short links are not switched on yet. We will let you know when they are." };
    const host = cleanHost(body.hostname);
    if (!host) return { ok: false, error: "Use a subdomain you own, like go.yourbrand.com (not your main domain)." };
    const { data: mine } = await admin.from("fma_link_domains").select("hostname").eq("client_id", client).eq("brand", brand).maybeSingle();
    if (mine && (mine as any).hostname !== host) return { ok: false, error: "This brand already has a domain. Remove it first." };
    const { data: taken } = await admin.from("fma_link_domains").select("client_id,brand,status").eq("hostname", host).maybeSingle();
    if (taken && ((taken as any).client_id !== client || (taken as any).brand !== brand)) {
      if ((taken as any).status === "active") return { ok: false, error: "That domain is already in use. Pick another." };
      await admin.from("fma_link_domains").delete().eq("hostname", host);   // an unfinished claim by someone else does not hold the name
    }
    const { data: brandRow } = await admin.from("cc_brands").select("default_wheel_url").eq("client_id", client).eq("name", brand).maybeSingle();
    const home = originOf(String((brandRow as any)?.default_wheel_url || ""));
    const add = await vercel("POST", `/v10/projects/${encodeURIComponent(VP)}/domains`, { name: host });
    const already = add.status === 409 && /already.*(this project|added)/i.test(String(add.json?.error?.message || ""));
    if (!add.ok && !already) {
      console.error("links-api vercel add", add.status, JSON.stringify(add.json).slice(0, 300));
      return { ok: false, error: "We could not attach that domain. Check the spelling, and that it is not used elsewhere." };
    }
    await admin.from("fma_link_domains").upsert({ hostname: host, client_id: client, brand, status: "pending", note: null, home_url: home || null }, { onConflict: "hostname" });
    return await status(client, brand);
  }

  if (action === "check_domain") {
    const { data: d } = await admin.from("fma_link_domains").select("hostname,status").eq("client_id", client).eq("brand", brand).maybeSingle();
    if (!d) return { ok: false, error: "Add a domain first." };
    const host = (d as any).hostname as string;
    const [dom, cfg] = await Promise.all([vercel("GET", `/v9/projects/${encodeURIComponent(VP)}/domains/${encodeURIComponent(host)}`), vercel("GET", `/v6/domains/${encodeURIComponent(host)}/config`)]);
    if (!dom.ok && !cfg.ok && !VT) return { ok: false, error: "Own-domain short links are not switched on yet." };
    const verified = dom.ok && dom.json?.verified === true;
    const misconfigured = cfg.ok ? cfg.json?.misconfigured !== false : true;
    const live = verified && !misconfigured;
    await admin.from("fma_link_domains").update({
      status: live ? "active" : "pending",
      note: live ? null : misconfigured ? `Waiting for your DNS record: CNAME ${host} → ${CNAME_TARGET}. It can take up to a few hours to show up.` : "Waiting for verification.",
      verified_at: live ? new Date().toISOString() : null,
    }).eq("hostname", host);
    return await status(client, brand);
  }

  if (action === "remove_domain") {
    const { data: d } = await admin.from("fma_link_domains").select("hostname").eq("client_id", client).eq("brand", brand).maybeSingle();
    if (d) {
      const host = (d as any).hostname as string;
      if (VT) await vercel("DELETE", `/v9/projects/${encodeURIComponent(VP)}/domains/${encodeURIComponent(host)}`);
      await admin.from("fma_links").delete().eq("client_id", client).eq("brand", brand).eq("host", host);
      await admin.from("fma_link_domains").delete().eq("hostname", host);
    }
    await admin.from("fma_link_settings").upsert({ client_id: client, brand, short_enabled: false, updated_at: new Date().toISOString() }, { onConflict: "client_id,brand", ignoreDuplicates: false });
    return await status(client, brand);
  }

  if (action === "ensure") {
    const inf = await info(client, brand);
    if (!inf.short) return { ok: true, map: {} };
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 300);
    const map: Record<string, string> = {};
    for (const it of items) {
      const target = clean(it.url, 2000);
      if (!/^https:\/\//i.test(target)) continue;
      const ref = clean(it.ref, 80), network = clean(it.network, 20);
      const { data } = await admin.rpc("fma_make_link", { p_client: client, p_brand: brand, p_kind: "content", p_ref: ref, p_network: network, p_campaign: clean(it.campaign, 80), p_target: target });
      if (data) map[ref + "|" + network + "|" + target] = String(data);
    }
    return { ok: true, map };
  }
  return { ok: false, error: "Unknown action" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: any = {}; try { const raw = await req.text(); if (raw.length > 400_000) return J({ ok: false, error: "Too large" }, 413); body = raw ? JSON.parse(raw) : {}; } catch { return J({ ok: false, error: "Bad JSON" }, 400); }
  try {
    const u = await userCtx(req);
    if (!u) return J({ ok: false, error: "Sign in again" }, 401);
    if (!u.client) return J({ ok: false, error: "No brand on this account yet" }, 403);
    return J(await act(u, u.client, body));
  } catch (e) {
    console.error("links-api", e);
    return J({ ok: false, error: "Something went wrong" }, 500);
  }
});

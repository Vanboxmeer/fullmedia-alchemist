// content-agent — lets a user's OWN Claude schedule their APPROVED Content posts in their own Metricool, then report back.
// MCP over HTTP for the agent (key cak_… via ?key= / x-content-key / Bearer); user JWT for the in-app screen.
// Deploy with verify_jwt=false (auth is done in here). No new tables: queue lives in ar_kv (coll content_queue),
// settings in ar_settings (key content_automation), keys in ar_agent_keys (prefix cak_), activity in ar_agent_log.
// HARD RULES enforced here, not just asked of the agent:
//  - only posts the user APPROVED and then pressed "Send to Claude" on are ever handed out
//  - captions, networks and times are exactly what the app computed; images come from the post row itself
//  - nothing goes to a social network directly: the agent only uses the user's Metricool connector (schedule, never publish now)
//  - a switch (on/off) and a daily cap; a post that failed or needs the user is held until the user retries it
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-content-key, mcp-session-id, mcp-protocol-version",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function newKey() {
  const a = crypto.getRandomValues(new Uint8Array(32));
  let s = ""; a.forEach((x) => (s += String.fromCharCode(x)));
  return "cak_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const COLL = "content_queue";
const CLAIM_MS = 30 * 60 * 1000;
// networks Metricool takes for image posts (YouTube needs video; Pinterest needs a board so it is only sent when one is saved)
const NETS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X (Twitter)", linkedin: "LinkedIn", tiktok: "TikTok", pinterest: "Pinterest" };

const MCP_INSTRUCTIONS =
  "You schedule the user's OWN approved Alchemist posts in the user's Metricool account, using the Metricool connector in this same chat. " +
  "Loop: call content_get_next_post. If status is off, empty or daily_cap, stop. Otherwise do exactly that one post, then call content_report_result. " +
  "HOW: use the Metricool connector (call get_brands first and pick the brand named in metricoolBrand). For EACH entry in groups, create ONE scheduled post in Metricool with exactly that text, " +
  "only those networks, the images in the order given (they are public links, pass them as given), at publishAt in the given timezone (asDraft true means save it as a draft instead). " +
  "RULES: never change the wording, hashtags or links; never publish immediately; never open a social network site or post by browser; never invent a link or id. " +
  "If Metricool cannot do it (brand or network not connected, plan post limit reached, a tool error), do not retry more than once: call content_report_result with outcome needs_user and the plain reason. " +
  "After Metricool confirms, call content_report_result with outcome scheduled, the networks that were scheduled, and the link or post id Metricool returned as proof.";

const TOOLS = [
  { name: "content_get_next_post", description: "Get the next approved post to schedule in Metricool (or a status saying why there is none).", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "content_report_result", description: "Report what happened with a post you were given.", inputSchema: { type: "object", properties: {
    sku: { type: "string", description: "The sku of the post you were given." },
    outcome: { type: "string", enum: ["scheduled", "failed", "needs_user"] },
    networks: { type: "array", items: { type: "string" }, description: "Networks that were scheduled." },
    link: { type: "string", description: "Link to the post in Metricool, or its post id." },
    reason: { type: "string", description: "For failed / needs_user: the plain reason." },
  }, required: ["sku", "outcome"], additionalProperties: false } },
  { name: "content_flag_for_user", description: "Hand a post back to the user (same as outcome needs_user).", inputSchema: { type: "object", properties: { sku: { type: "string" }, reason: { type: "string" } }, required: ["sku", "reason"], additionalProperties: false } },
];

type Scope = { keyId: string; client: string };
async function keyScope(req: Request): Promise<Scope | null> {
  const u = new URL(req.url);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const k = req.headers.get("x-content-key") || (bearer.startsWith("cak_") ? bearer : "") || u.searchParams.get("key") || "";
  if (!k.startsWith("cak_") || k.length < 30 || k.length > 90) return null;
  const { data } = await admin.from("ar_agent_keys").select("id,client_id,revoked_at").eq("key_hash", await sha256(k)).maybeSingle();
  if (!data || (data as any).revoked_at) return null;
  admin.from("ar_agent_keys").update({ last_used_at: new Date().toISOString() }).eq("id", (data as any).id).then(() => {});
  return { keyId: (data as any).id, client: (data as any).client_id };
}

async function getSettings(client: string) {
  const { data } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "content_automation").maybeSingle();
  const d: any = (data as any)?.data || {};
  return { on: d.on === true, dailyCap: Math.max(1, Math.min(30, Number(d.dailyCap) || 10)), asDraft: d.asDraft === true, mcBrands: (d.mcBrands && typeof d.mcBrands === "object") ? d.mcBrands : {}, pinterestBoard: clean(d.pinterestBoard, 80) };
}
async function queueDocs(client: string): Promise<{ id: string; d: any }[]> {
  const { data } = await admin.from("ar_kv").select("doc_id,data").eq("client_id", client).eq("coll", COLL).limit(1000);
  return ((data as any[]) || []).map((r) => ({ id: r.doc_id, d: r.data || {} }));
}
async function putDoc(client: string, sku: string, d: any) {
  d.updatedAt = Date.now();
  await admin.from("ar_kv").upsert({ client_id: client, coll: COLL, doc_id: sku, data: d, updated_at: new Date().toISOString() }, { onConflict: "client_id,coll,doc_id" });
}
async function logIt(client: string, key: string | null, action: string, outcome: string, detail: string) {
  await admin.from("ar_agent_log").insert({ client_id: client, brand_id: null, deal_id: null, key_id: key, action: "content_" + action, outcome, detail: clean(detail, 400) });
}
const doneToday = (docs: { d: any }[], today: string) => docs.filter((x) => x.d.state === "scheduled" && x.d.doneDay === today).length;
const eligible = (d: any) => d.state === "queued" || (d.state === "claimed" && Date.now() - (d.claimedAt || 0) > CLAIM_MS && (d.attempts || 0) < 2);

// ---------- agent side ----------
async function agentNext(sc: Scope) {
  const st = await getSettings(sc.client);
  if (!st.on) return { status: "off", message: "Auto-schedule is switched off in Alchemist. Nothing to do." };
  const docs = await queueDocs(sc.client);
  const today = iso(new Date());
  if (doneToday(docs, today) >= st.dailyCap) return { status: "daily_cap", message: "Today's limit is reached. Try again tomorrow." };
  const next = docs.filter((x) => eligible(x.d)).sort((a, b) => String(a.d.at).localeCompare(String(b.d.at)))[0];
  if (!next) return { status: "empty", message: "No approved posts are waiting." };
  const d = next.d;
  d.state = "claimed"; d.claimedAt = Date.now(); d.attempts = (d.attempts || 0) + 1; delete d.reason;
  await putDoc(sc.client, next.id, d);
  await logIt(sc.client, sc.keyId, "get_next", "claimed", d.sku + " " + d.brand);
  return {
    status: "task", sku: d.sku, brand: d.brand, metricoolBrand: st.mcBrands[d.brand] || d.brand, title: d.title || "",
    publishAt: d.at, timezone: d.tz || "UTC", asDraft: st.asDraft, groups: d.groups, images: d.images,
    firstComment: d.firstComment || undefined, link: d.link || undefined, location: d.location || undefined,
    pinterestBoard: d.groups.some((g: any) => (g.networks || []).includes("pinterest")) ? st.pinterestBoard : undefined,
    instructions: "Schedule this exact post in the user's Metricool using the Metricool connector, one scheduled post per entry in groups. Do not change any wording. Then call content_report_result.",
  };
}

const SCHED_COL = new Set(Object.keys(NETS));
async function agentResult(sc: Scope, a: any) {
  const sku = clean(a.sku, 40), outcome = String(a.outcome || "");
  const docs = await queueDocs(sc.client);
  const doc = docs.find((x) => x.id === sku);
  if (!doc) return { ok: false, error: "That post is not in the queue." };
  const d = doc.d;
  if (d.state === "scheduled") return { ok: true, note: "Already recorded as scheduled." };
  if (outcome === "scheduled") {
    const link = clean(a.link, 400);
    if (link.length < 6) return { ok: false, error: "Scheduled needs proof: pass the link or post id Metricool returned." };
    const all = [...new Set((d.groups || []).flatMap((g: any) => g.networks || []))] as string[];
    const got = (Array.isArray(a.networks) && a.networks.length ? a.networks.map((n: string) => String(n).toLowerCase().replace(/[^a-z]/g, "")) : all)
      .map((n: string) => (n === "twitter" || n === "xtwitter" ? "x" : n)).filter((n: string) => SCHED_COL.has(n) && all.includes(n));
    // mark each network "scheduled" the same way the app's own export does, so the app asks later whether it went out
    const { data: row } = await admin.from("content_calendar").select("*").eq("sku", sku).eq("brand", d.brand).is("deleted_at", null).maybeSingle();
    if (row) {
      const patch: Record<string, unknown> = {};
      for (const n of got) if (!(row as any)[n + "_posted_at"] && !(row as any)[n + "_post_link"]) patch[n + "_scheduled"] = "export|metricool|" + d.at;
      if (Object.keys(patch).length) await admin.from("content_calendar").update(patch).eq("id", (row as any).id);
    }
    d.state = "scheduled"; d.doneDay = iso(new Date()); d.doneAt = Date.now(); d.result = { networks: got, link }; delete d.reason;
    await putDoc(sc.client, sku, d);
    await logIt(sc.client, sc.keyId, "report", "scheduled", sku + " " + got.join(",") + " " + link);
    return { ok: true, recorded: "scheduled", networks: got };
  }
  const reason = clean(a.reason, 300) || "No reason given";
  d.state = outcome === "needs_user" ? "needs_user" : "failed"; d.reason = reason;
  await putDoc(sc.client, sku, d);
  await logIt(sc.client, sc.keyId, "report", d.state, sku + " " + reason);
  return { ok: true, recorded: d.state };
}

async function mcp(req: Request, body: any) {
  const sc = await keyScope(req);
  if (!sc) return J({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32001, message: "Key not recognised or revoked. Make a new one in Alchemist → Auto-schedule." } }, 401);
  const id = body.id, m = String(body.method || "");
  const ok = (result: unknown) => J({ jsonrpc: "2.0", id, result });
  if (m.startsWith("notifications/")) return new Response(null, { status: 202, headers: CORS });
  if (m === "initialize") return ok({ protocolVersion: String(body.params?.protocolVersion || "2025-03-26"), capabilities: { tools: {} }, serverInfo: { name: "alchemist-content", version: "1.0.0" }, instructions: MCP_INSTRUCTIONS });
  if (m === "ping") return ok({});
  if (m === "tools/list") return ok({ tools: TOOLS });
  if (m === "tools/call") {
    const name = String(body.params?.name || ""), a = body.params?.arguments || {};
    let out: any;
    if (name === "content_get_next_post") out = await agentNext(sc);
    else if (name === "content_report_result") out = await agentResult(sc, a);
    else if (name === "content_flag_for_user") out = await agentResult(sc, { sku: a.sku, outcome: "needs_user", reason: a.reason });
    else return J({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
    return ok({ content: [{ type: "text", text: JSON.stringify(out) }], isError: out?.ok === false });
  }
  return J({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

// ---------- app side (signed-in user) ----------
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

async function appStatus(client: string, brands: Set<string>) {
  const st = await getSettings(client);
  const docs = await queueDocs(client);
  const today = iso(new Date());
  const { data: keys } = await admin.from("ar_agent_keys").select("id,label,key_prefix,created_at,last_used_at").eq("client_id", client).is("revoked_at", null).like("key_prefix", "cak_%").order("created_at", { ascending: false });
  const { data: log } = await admin.from("ar_agent_log").select("action,outcome,detail,created_at").eq("client_id", client).like("action", "content_%").order("created_at", { ascending: false }).limit(12);
  const pub = (x: { id: string; d: any }) => {
    const d = x.d, stale = d.state === "claimed" && Date.now() - (d.claimedAt || 0) > CLAIM_MS;
    return { sku: x.id, brand: d.brand, title: d.title, at: d.at, state: stale ? "queued" : d.state, reason: d.reason || "", networks: [...new Set((d.groups || []).flatMap((g: any) => g.networks || []))], link: d.result?.link || "", doneAt: d.doneAt || null };
  };
  const items = docs.filter((x) => brands.has(x.d.brand)).sort((a, b) => (b.d.updatedAt || 0) - (a.d.updatedAt || 0)).slice(0, 80).map(pub);
  return { ok: true, settings: st, brands: [...brands], today, doneToday: doneToday(docs, today), items, keys: keys || [], log: log || [] };
}

async function appAction(u: any, client: string, body: any) {
  const action = String(body.action || "");
  if (action === "status") return appStatus(client, u.brands);
  if (action === "save_settings") {
    const mc: Record<string, string> = {};
    Object.keys(body.mcBrands || {}).forEach((k) => { if (u.brands.has(k)) { const v = clean(body.mcBrands[k], 80); if (v) mc[k] = v; } });
    const data = { on: body.on === true, dailyCap: Math.max(1, Math.min(30, Number(body.dailyCap) || 10)), asDraft: body.asDraft === true, mcBrands: mc, pinterestBoard: clean(body.pinterestBoard, 80) };
    const { error } = await admin.from("ar_settings").upsert({ client_id: client, key: "content_automation", data, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
    return { ok: !error, settings: data, error: error ? "Couldn't save" : undefined };
  }
  if (action === "queue") {
    const st = await getSettings(client);
    const items: any[] = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
    const docs = new Map((await queueDocs(client)).map((x) => [x.id, x.d]));
    const skipped: { sku: string; why: string }[] = []; let queued = 0;
    const now = new Date().toISOString().slice(0, 16);
    for (const it of items) {
      const sku = clean(it.sku, 40);
      const { data: row } = await admin.from("content_calendar").select("*").eq("sku", sku).is("deleted_at", null).maybeSingle();
      if (!row || !u.brands.has(String((row as any).brand))) { skipped.push({ sku, why: "Not found" }); continue; }
      const r: any = row;
      if (String(r.approval_status || "").toLowerCase() !== "approved") { skipped.push({ sku, why: "Not approved yet" }); continue; }
      const imgs = (Array.isArray(r.media_urls) ? r.media_urls : []).map((x: unknown) => String(x || "").split("?")[0]).filter((x: string) => /^https:\/\//i.test(x)).slice(0, 10);
      if (!imgs.length) { skipped.push({ sku, why: "No image yet" }); continue; }
      const at = String(it.at || "");
      if (!AT.test(at)) { skipped.push({ sku, why: "No valid date and time" }); continue; }
      if (at < now) { skipped.push({ sku, why: "Its date has passed" }); continue; }
      const prev = docs.get(sku);
      if (prev && (prev.state === "scheduled" || (prev.state === "claimed" && Date.now() - (prev.claimedAt || 0) < CLAIM_MS))) { skipped.push({ sku, why: prev.state === "scheduled" ? "Already scheduled" : "Claude is on it" }); continue; }
      const groups: { networks: string[]; text: string }[] = [];
      for (const g of Array.isArray(it.groups) ? it.groups : []) {
        const nets = (Array.isArray(g.networks) ? g.networks : []).map((n: unknown) => String(n).toLowerCase())
          .filter((n: string) => NETS[n] && !r[n + "_posted_at"] && !r[n + "_post_link"] && (n !== "pinterest" || !!st.pinterestBoard));
        const text = clean(g.text, 5000);
        if (nets.length && text) groups.push({ networks: [...new Set(nets)] as string[], text });
      }
      if (!groups.length) { skipped.push({ sku, why: "No account left to post to" }); continue; }
      await putDoc(client, sku, {
        state: "queued", sku, brand: r.brand, title: clean(r.post_idea, 120), at, tz: clean(it.tz, 60) || "UTC", groups, images: imgs,
        firstComment: clean(it.firstComment, 2000), link: clean(r.content_link, 300), location: clean(it.location, 120), queuedAt: Date.now(), attempts: 0,
      });
      queued++;
    }
    await logIt(client, null, "queue", "ok", queued + " queued, " + skipped.length + " skipped");
    return { ok: true, queued, skipped };
  }
  if (action === "retry" || action === "remove") {
    const sku = clean(body.sku, 40);
    const doc = (await queueDocs(client)).find((x) => x.id === sku);
    if (!doc || !u.brands.has(doc.d.brand)) return { ok: false, error: "Not found" };
    if (action === "remove") {
      if (doc.d.state === "claimed" && Date.now() - (doc.d.claimedAt || 0) < CLAIM_MS) return { ok: false, error: "Claude is working on it right now." };
      await admin.from("ar_kv").delete().eq("client_id", client).eq("coll", COLL).eq("doc_id", sku); return { ok: true };
    }
    const d = doc.d; if (d.state === "scheduled") return { ok: false, error: "Already scheduled." };
    d.state = "queued"; d.attempts = 0; delete d.reason; delete d.claimedAt; await putDoc(client, sku, d); return { ok: true };
  }
  if (action === "create_key") {
    const { count } = await admin.from("ar_agent_keys").select("id", { count: "exact", head: true }).eq("client_id", client).is("revoked_at", null).like("key_prefix", "cak_%");
    if ((count || 0) >= 5) return { ok: false, error: "Too many active links. Remove one first." };
    const key = newKey();
    const { data, error } = await admin.from("ar_agent_keys").insert({ client_id: client, brand_id: null, label: clean(body.label, 60) || "Claude (Content)", key_hash: await sha256(key), key_prefix: key.slice(0, 8), created_by: u.uid }).select("id").single();
    if (error) return { ok: false, error: "Could not create the link" };
    return { ok: true, id: (data as any).id, key, url: URL_ + "/functions/v1/content-agent?key=" + key };
  }
  if (action === "revoke_key") {
    const { error } = await admin.from("ar_agent_keys").update({ revoked_at: new Date().toISOString() }).eq("id", String(body.id || "")).eq("client_id", client).like("key_prefix", "cak_%");
    return { ok: !error };
  }
  return { ok: false, error: "Unknown action" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return new Response("Alchemist Content agent connector. POST only.", { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const raw = await req.text();
  if (raw.length > 400_000) return J({ ok: false, error: "Too large" }, 413);
  let body: any = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { return J({ ok: false, error: "Bad JSON" }, 400); }
  try {
    if (body && body.jsonrpc === "2.0") return await mcp(req, body);
    const u = await userCtx(req);
    if (!u) return J({ ok: false, error: "Sign in again" }, 401);
    if (!u.client) return J({ ok: false, error: "No brand on this account yet" }, 403);
    return J(await appAction(u, u.client, body));
  } catch (e) {
    console.error("content-agent", e);
    return J({ ok: false, error: "Something went wrong" }, 500);
  }
});

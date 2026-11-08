// reach-agent: bounce handling, account check, clean email links (auto-deployed from GitHub)
// reach-agent — lets a user's OWN agent (Claude Cowork, another desktop agent) work the Reach rows the user has
// APPROVED for automation: send the email, submit the web form, send the follow-up, then report back.
// Deploy with verify_jwt=false. Auth: x-reach-key / Bearer rak_… / ?key=rak_… for the agent (MCP over HTTP),
// user JWT for the in-app screens (settings, approvals, keys).
// HARD RULES enforced here, not just asked of the agent:
//  - nothing is queued unless the user switched Automation on for that brand AND approved that row
//  - strict sites (social networks, communities, forums, DMs) are never queued: the user does those by hand
//  - daily cap + minimum gap between sends; a row that failed or needs the user is held until the user clears it
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-reach-key, mcp-session-id, mcp-protocol-version",
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
  return "rak_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const FU1_DAYS = 4, FU2_DAYS = 10, MAX_FOLLOWUPS = 2;

// ---- places we never automate: the user does these by hand ----
const STRICT_HOST = /(^|\.)(linkedin|instagram|facebook|fb|tiktok|reddit|redd|discord|discordapp|twitter|x|t|telegram|whatsapp|wa|snapchat|threads|twitch|youtube|youtu|pinterest|slack|medium|quora|substack|patreon|tumblr|mastodon|bsky|bluesky)\.(com|gg|me|tv|be|net|social|app|co)$/i;
const STRICT_WORDS = /\b(linkedin|instagram|facebook|tiktok|reddit|subreddit|discord|twitter|telegram|whatsapp|snapchat|threads|twitch|youtube|pinterest|slack|quora|forum|forums|community|communities|guest ?post|write for us|dm|direct message)\b/i;

function hostOf(u: string) { try { return new URL(/^https?:/i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function firstEmail(e: unknown) { return String(e || "").split(/[;, ]/)[0].trim(); }

function phaseOf(r: any): string {
  const s = r.deal_stage || "", o = r.outreach_status || "", lead = r.deal_type === "lead";
  if (lead) {
    if (s === "Won - Client") return "won"; if (s === "Lost") return "closed"; if (s === "On Hold") return "hold";
    if (s === "Negotiating") return "deal";
    if (s === "In Conversation" || s === "Intro / Proposal Sent") return "replied";
    if (s === "Contacted") return r.replied_date ? "replied" : "sent";
    if (s === "Ready to Reach Out") return "ready";
    return "research";
  }
  if (s === "Closed - Won") return "won";
  if (s === "Closed - Lost" || s === "Do Not Pursue") return "closed";
  if (/^do not send/i.test(o)) return "dnc";
  if (o === "Declined" || o === "Bounced" || o === "Completed") return "closed";
  if (s === "Negotiating") return "deal";
  if (o === "Replied / In Discussion") return "replied";
  if (r.replied_date && (o === "Sent - Awaiting Reply" || o === "Other Outreach (DM/Self-Post)")) return "replied";
  if (o === "Sent - Awaiting Reply" || o === "Other Outreach (DM/Self-Post)") return "sent";
  if (o.toLowerCase() === "ready to send") return "ready";
  return "research";
}

// ---- shared bad-contacts list (any bounce, any user, blocks everyone) + quick "does this domain exist" check ----
const BAD = new Set<string>();
async function loadBad(vals: string[]) {
  const set = new Set<string>();
  vals.forEach((v) => { const e = String(v || "").trim().toLowerCase(); if (!e) return; set.add(e); if (e.includes("@")) set.add(e.split("@")[1]); });
  const list = [...set].filter((v) => !BAD.has(v));
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await admin.from("ar_bad_contacts").select("value").in("value", list.slice(i, i + 200));
    (data || []).forEach((b: any) => BAD.add(b.value));
  }
}
function isBad(email: string) { const e = String(email || "").trim().toLowerCase(); return !!e && (BAD.has(e) || BAD.has(e.split("@")[1] || "~")); }
async function addBad(value: string, kind: "email" | "domain", reason: string, client: string) {
  const v = value.trim().toLowerCase(); if (!v) return; BAD.add(v);
  const { data } = await admin.from("ar_bad_contacts").select("hits").eq("value", v).maybeSingle();
  if (data) await admin.from("ar_bad_contacts").update({ hits: ((data as any).hits || 1) + 1, updated_at: new Date().toISOString() }).eq("value", v);
  else await admin.from("ar_bad_contacts").insert({ value: v, kind, reason: clean(reason, 200), first_client: client });
}
const DOMAIN_OK = new Map<string, { ok: boolean; at: number }>();
// false only when DNS clearly says the domain doesn't exist or can't receive mail; any lookup trouble counts as "fine"
async function domainReceivesMail(domain: string): Promise<boolean> {
  const d = domain.toLowerCase(); const hit = DOMAIN_OK.get(d); if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.ok;
  const q = async (type: string) => { const r = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(d) + "&type=" + type, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) }); return await r.json(); };
  let ok = true;
  try {
    const mx = await q("MX");
    if (mx.Status === 3) ok = false;
    else if (!(mx.Answer || []).some((a: any) => a.type === 15)) { const a = await q("A"); ok = a.Status === 3 ? false : (a.Answer || []).some((x: any) => x.type === 1 || x.type === 28); }
  } catch { ok = true; }
  DOMAIN_OK.set(d, { ok, at: Date.now() });
  return ok;
}

type Route = { route: "email" | "form" | "manual"; reason: string; to: string; link: string };
function routeOf(row: any, t: any, brand: any): Route {
  const name = clean(t?.name || row.target_name, 120);
  const dnc = String(brand?.data?.doNotContact || "").toLowerCase();
  if (dnc && name.length > 2 && dnc.includes(name.toLowerCase())) return { route: "manual", reason: "On this brand's do-not-contact list.", to: "", link: "" };
  if (t?.data?.orderVia && !row.data?.useEmail) return { route: "manual", reason: "Ordered through the agency, not pitched.", to: "", link: "" };
  const how = String(t?.data?.howToPost || "");
  const paid = t?.data?.cost === "paid" || t?.data?.paid === true || ((/\b(fee|paid|payment|sponsored)\b|[$\u20ac\u00a3]\s?\d/i.test(how)) && !/\b(no|zero|without)\s+(listing\s+)?(fee|cost)|\bfree\b/i.test(how));
  if (paid) return { route: "manual", reason: "Paid listing \u2014 skipped (free options only).", to: "", link: "" };
  const to = firstEmail(t?.contact_email || row.contact_email || row.data?.contactEmail);
  if (EMAIL.test(to) && isBad(to)) return { route: "manual", reason: "This email address bounced before, so it is blocked for everyone. Find another way to reach them.", to: "", link: "" };
  if (EMAIL.test(to)) return { route: "email", reason: "", to: to.toLowerCase(), link: "" };
  const link = clean(t?.contact_link || row.contact_link || row.data?.contactLink, 400);
  const hay = [t?.platform, t?.type, t?.data?.howToPost].filter(Boolean).join(" ");
  if (STRICT_WORDS.test(hay) || (link && STRICT_HOST.test(hostOf(link))))
    return { route: "manual", reason: "Strict site (social network, community or forum). Accounts get banned for automated messages, and each place has its own rules — do this one yourself.", to: "", link };
  if (link && /^https?:\/\//i.test(link)) return { route: "form", reason: "", to: "", link };
  return { route: "manual", reason: "No email or web form on file yet.", to: "", link: "" };
}

async function sigOf(client: string) {
  const { data } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "workspace").maybeSingle();
  return clean((data as any)?.data?.signature, 600);
}
async function getSettings(client: string) {
  const { data } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "automation").maybeSingle();
  const d: any = (data as any)?.data || {};
  const brands: Record<string, boolean> = {}; Object.keys(d.brands || {}).forEach((k) => { if (d.brands[k] === true) brands[k] = true; });
  return { on: d.on === true, autoReady: d.autoReady === true, autoFu: d.autoFu === true, brands, dailyCap: Math.max(1, Math.min(40, Number(d.dailyCap) || 15)), gapSec: Math.max(30, Math.min(900, Number(d.gapSec) || 120)), sendFrom: EMAIL.test(String(d.sendFrom || "").trim()) ? String(d.sendFrom).trim().toLowerCase() : "", preflight: d.preflight === true };
}

async function loadRows(client: string, brandOnly: string | null) {
  let bq = admin.from("ar_brands").select("id,name,data,archived_at").eq("client_id", client).is("archived_at", null);
  if (brandOnly) bq = bq.eq("id", brandOnly);
  const { data: brands } = await bq;
  const bmap = new Map<string, any>(); (brands || []).forEach((b: any) => bmap.set(b.id, b));
  if (!bmap.size) return { bmap, rows: [] as any[], tmap: new Map<string, any>() };
  const { data: rows } = await admin.from("ar_deals").select("id,brand_id,target_id,deal_type,deal_stage,outreach_status,target_name,contact_email,contact_link,data").in("brand_id", [...bmap.keys()]).limit(3000);
  const ids = [...new Set((rows || []).map((r: any) => r.target_id).filter(Boolean))];
  const tmap = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: ts } = await admin.from("ar_targets").select("id,name,platform,type,contact_email,contact_link,data").in("id", ids.slice(i, i + 150));
    (ts || []).forEach((t: any) => tmap.set(t.id, t));
  }
  const emails: string[] = [];
  (rows || []).forEach((r: any) => { emails.push(r.contact_email, r.data?.contactEmail); });
  tmap.forEach((t: any) => emails.push(t.contact_email));
  await loadBad(emails.map((e) => firstEmail(e)).filter(Boolean));
  return { bmap, rows: rows || [], tmap };
}
// merge column + data like the app does
function flat(r: any) {
  const d = r.data || {};
  return Object.assign({}, r, {
    deal_stage: d.dealStage ?? r.deal_stage, outreach_status: d.outreachStatus ?? r.outreach_status, deal_type: d.dealType ?? r.deal_type,
    replied_date: d.repliedDate || "",
  });
}

type Item = { id: string; brandId: string; brand: string; name: string; kind: "first" | "followup" | "manual" | "blocked"; route: Route; subject: string; hasDraft: boolean; approved: boolean; flag: any; dueDate: string; followUps: number; ph: string; reason: string; sent: string; lastSent: string; via: string; notes: string; sentSubject: string };

function classify(raw: any, tmap: Map<string, any>, bmap: Map<string, any>, today: string): Item | null {
  const r = flat(raw), d = r.data || {}, ph = phaseOf(r);
  const t = tmap.get(r.target_id) || {}, b = bmap.get(r.brand_id) || {};
  const draft = clean(d.draft, 8000);
  const base = { id: r.id, brandId: r.brand_id, brand: clean(b.name, 80), name: clean(t.name || r.target_name, 120), subject: clean(d.subject, 200), hasDraft: !!draft, approved: !!d.autoOk, flag: d.agentFlag || null, followUps: Number(d.followUps) || 0, ph, dueDate: clean(d.followUpDue, 10), sent: clean(d.sentDate, 10), lastSent: clean(d.lastSentDate, 10), via: clean(d.sentVia, 10), sentSubject: clean(d.sentSubject, 200), notes: ((Array.isArray(b.draftNotes) ? b.draftNotes : Array.isArray(b.data?.draftNotes) ? b.data.draftNotes : []) as any[]).filter((n) => n && n.on !== false && String(n.text || "").trim() && (!n.waves || !n.waves.length || n.waves.includes(d.waveId))).map((n) => "- " + clean(n.text, 300)).join("\n").slice(0, 1500) };
  const route = routeOf(r, t, b);
  const snoozed = d.stallSnooze && String(d.stallSnooze).slice(0, 10) > today;
  if (ph === "ready") {
    // never send a first message to a row that already shows it was contacted
    if (base.sent || base.lastSent) return { ...base, kind: "blocked", route, reason: "Already has a sent date (" + (base.sent || base.lastSent) + "). Check it before anything is sent." };
    if (route.route === "manual") return { ...base, kind: "manual", route, reason: route.reason };
    if (!draft) return { ...base, kind: "blocked", route, reason: "No message written yet." };
    if (route.route === "email" && !base.subject) return { ...base, kind: "blocked", route, reason: "No subject line yet." };
    return { ...base, kind: "first", route, reason: "" };
  }
  if (ph === "sent" && !snoozed) {
    if (route.route !== "email") return null; // forms/posts have no follow-ups
    if (base.via && base.via !== "email") return null; // first message went by DM/form: never email a follow-up
    if (base.lastSent && (Date.parse(today) - Date.parse(base.lastSent)) / 86400000 < 3) return null; // contacted in the last 3 days
    if (base.followUps >= MAX_FOLLOWUPS) return null;
    if (!base.dueDate || base.dueDate > today) return null;
    return { ...base, kind: "followup", route, reason: "" };
  }
  return null;
}

// Auto-approve: a first message the user marked Ready to send (and, if chosen, due follow-ups) counts as approved,
// unless the user took it back on that row (autoHold).
function applyAuto(it: Item | null, st: { autoReady: boolean; autoFu: boolean }, raw: any) {
  if (!it || it.approved || (raw?.data || {}).autoHold) return;
  if ((it.kind === "first" && st.autoReady) || (it.kind === "followup" && st.autoFu)) it.approved = true;
}

const FOLLOWUP_RULES = "Follow-up text (you write it): 2–4 plain sentences, same thread (reply to the original message so the subject starts with Re:), friendly and low-pressure, no flattery, no guilt, no new claims, no prices or budget talk, no signature beyond the one provided. Follow-up 1 is a short bump; follow-up 2 is one last light check-in that says you will close it out if you don't hear back.";

// The Gmail connector turns bare domains in a plain body into ugly google.com/url?q=... text. Send HTML with real anchors instead.
function toHtml(text: string, trk: Record<string, { href: string; text?: string }> = {}) {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const link = (m: string) => {
    const tail = (m.match(/[.,;:!?)]+$/) || [""])[0]; const u = tail ? m.slice(0, -tail.length) : m;
    let href = /^https?:\/\//i.test(u) ? u : "https://" + u;
    // links to our own site carry a source tag, so the admin stats can show how many visits and sign-ups outreach brings
    try { const U = new URL(href); if (/(^|\.)fullmediaalchemist\.com$/i.test(U.hostname) && !U.searchParams.has("utm_source")) { U.searchParams.set("utm_source", "reach"); U.searchParams.set("utm_medium", "email"); U.searchParams.set("utm_campaign", "outreach"); href = U.toString(); } } catch (_e) { /* keep as is */ }
    // the brand's own tracked link (tagged and/or short, set by the user in Brand settings), prepared before this runs
    const t = trk[u] || trk[href];
    if (t) return '<a href="' + t.href + '">' + (t.text || u.replace(/^https?:\/\//i, "")) + "</a>" + tail;
    return '<a href="' + href + '">' + u.replace(/^https?:\/\//i, "") + "</a>" + tail;
  };
  const re = /(?<![@\w.\/-])((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ai|app|media|uk|ca|dev|me|us)(?:\/[^\s<]*)?)/gi;
  return '<div dir="auto">' + esc(text).replace(re, link).replace(/\r?\n/g, "<br>") + "</div>";
}
const LINKS = " Send it with the htmlBody field ONLY (do not fill body), exactly as given, so links stay clean. Never paste a bare web address into a plain body: the mail connector rewrites it into an ugly google.com redirect.";

function taskOf(it: Item, r: any, t: any, sig: string, today: string, sendFrom: string, trk: Record<string, { href: string; text?: string }> = {}) {
  const d = r.data || {};
  const body = clean(d.draft, 8000) + (sig ? "\n\n" + sig : "");
  const common = { id: it.id, brand: it.brand, target: it.name, route: it.route.route, today, sendFrom: it.route.route === "email" ? sendFrom : undefined };
  const ACCT = " Send ONLY if the mail account you are signed into is exactly " + sendFrom + ". If it is a different account or you cannot tell, do NOT send: call reach_flag_for_user with kind wrong_account and stop the whole run.";
  if (it.kind === "first") {
    return it.route.route === "email"
      ? { ...common, action: "send_email", to: it.route.to, subject: it.subject, htmlBody: toHtml(body, trk), body, instructions: "Send exactly this message from the user's own mail account. Do not change the wording." + LINKS + ACCT + " Then call reach_report_result with outcome \"sent\" and the subject line as evidence. Then, about a minute later, check the inbox for a bounce (see checkBounces)." }
      : { ...common, action: "submit_web_form", url: it.route.link, message: body, subject: it.subject || undefined, notes: clean(t?.data?.howToPost, 300) || undefined, instructions: "Open the page, fill the form using only this message and the brand details the user's Reach profile gives (never invent details). If the form needs a CAPTCHA, a login, a payment, or fields you cannot fill from this information, STOP and call reach_flag_for_user. After submitting, call reach_report_result with outcome \"submitted\" and the confirmation text on the page as evidence." };
  }
  const n = it.followUps + 1;
  return { ...common, action: "send_followup", to: it.route.to, followUpNumber: n, originalSubject: it.sentSubject || it.subject, ownerDraftingNotes: it.notes || undefined, firstSentOn: clean(d.sentDate, 10), gmailThread: clean(d.gmailThread, 200) || undefined, instructions: "First open the original thread. When you write the follow-up, obey every line of ownerDraftingNotes (if present); they override your default style. If the person has replied, do NOT send anything: call reach_report_result with outcome \"replied_seen\" and a short quote. Otherwise write and send follow-up " + n + " in the same thread. " + FOLLOWUP_RULES + " Pass the text you sent as 'message' in reach_report_result (outcome \"sent\")." + LINKS.replace("exactly as given", "with real <a href> anchors for any links") + ACCT };
}

async function todayCount(client: string) {
  const start = iso(new Date()) + "T00:00:00Z";
  const { count } = await admin.from("ar_agent_log").select("id", { count: "exact", head: true }).eq("client_id", client).in("outcome", ["sent", "submitted"]).gte("created_at", start);
  return count || 0;
}
async function lastSendAt(client: string): Promise<number> {
  const { data } = await admin.from("ar_agent_log").select("created_at").eq("client_id", client).in("outcome", ["sent", "submitted"]).order("created_at", { ascending: false }).limit(1);
  return data && data[0] ? new Date((data[0] as any).created_at).getTime() : 0;
}

// Tracking links for the brand's OWN site in outreach (paid plans, set per brand in Content > Brand settings).
// Tags the link (utm_*) and, if the user connected their own domain, swaps in a short link on it. Never touches other sites.
const URL_RE = /(?<![@\w.\/-])((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ai|app|media|uk|ca|dev|me|us)(?:\/[^\s<]*)?)/gi;
async function trackLinks(client: string, brandName: string, dealId: string, text: string) {
  const out: Record<string, { href: string; text?: string }> = {};
  try {
    const { data: inf } = await admin.rpc("fma_track_info", { p_client: client, p_brand: brandName });
    if (!inf || !inf.eligible || (!inf.tag && !inf.short)) return out;
    const { data: cb } = await admin.from("cc_brands").select("default_wheel_url").eq("client_id", client).eq("name", brandName).maybeSingle();
    let own = ""; try { own = new URL(String((cb as any)?.default_wheel_url || "")).hostname.toLowerCase().replace(/^www\./, ""); } catch (_e) {}
    if (!own) return out;
    const slug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "brand";
    for (const m of (text.match(URL_RE) || []).slice(0, 8)) {
      const tail = (m.match(/[.,;:!?)]+$/) || [""])[0]; const u = tail ? m.slice(0, -tail.length) : m;
      let U: URL; try { U = new URL(/^https?:\/\//i.test(u) ? u : "https://" + u); } catch (_e) { continue; }
      const h = U.hostname.toLowerCase().replace(/^www\./, "");
      if (h !== own && !h.endsWith("." + own)) continue;
      if (inf.tag && !U.searchParams.has("utm_source")) { U.searchParams.set("utm_source", "reach"); U.searchParams.set("utm_medium", "email"); U.searchParams.set("utm_campaign", slug); U.searchParams.set("utm_content", "deal-" + dealId.slice(0, 8)); }
      const tagged = U.toString();
      let href = tagged, shown: string | undefined;
      if (inf.short) {
        const { data: sl } = await admin.rpc("fma_make_link", { p_client: client, p_brand: brandName, p_kind: "reach", p_ref: dealId, p_network: "email", p_campaign: slug, p_target: tagged });
        if (sl) { href = String(sl); shown = String(sl).replace(/^https?:\/\//, ""); }
      }
      out[u] = { href, text: shown };
    }
  } catch (e) { console.error("trackLinks", e); }
  return out;
}

// ================= agent side =================
type Scope = { keyId: string; client: string; brand: string | null };
async function keyScope(req: Request): Promise<Scope | null> {
  const u = new URL(req.url);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const k = req.headers.get("x-reach-key") || (bearer.startsWith("rak_") ? bearer : "") || u.searchParams.get("key") || "";
  if (!k.startsWith("rak_") || k.length < 30 || k.length > 90) return null;
  const { data } = await admin.from("ar_agent_keys").select("id,client_id,brand_id,revoked_at").eq("key_hash", await sha256(k)).maybeSingle();
  if (!data || (data as any).revoked_at) return null;
  admin.from("ar_agent_keys").update({ last_used_at: new Date().toISOString() }).eq("id", (data as any).id).then(() => {});
  return { keyId: (data as any).id, client: (data as any).client_id, brand: (data as any).brand_id };
}

async function agentQueue(sc: Scope) {
  const today = iso(new Date());
  const st = await getSettings(sc.client);
  if (!st.on) return { ok: true, tasks: [], status: "off", message: "Automation is switched off in Alchemist Reach. Nothing to do." };
  if (!st.sendFrom || !st.preflight) return { ok: true, tasks: [], status: "setup", message: "Stop. The user has not confirmed which mail account to send from. Tell them to open Alchemist Reach \u2192 Automation \u2192 \"Check first\", enter the address they send from, tick the boxes and confirm. Nothing will be sent until they do." };
  const { bmap, rows, tmap } = await loadRows(sc.client, sc.brand);
  // everything approved and due, so we can tell the user how many are lined up (tasks are still handed out one at a time)
  const eligible: { r: any; it: Item }[] = []; let heldAlready = 0;
  for (const r of rows) {
    if (!st.brands[r.brand_id]) continue;
    const it = classify(r, tmap, bmap, today);
    applyAuto(it, st, r);
    if (!it || !it.approved || it.flag) continue;
    if (it.kind !== "first" && it.kind !== "followup") continue;
    const claim = (r.data || {}).agentClaim;
    if (claim && claim.at) {
      if (Date.now() - Number(claim.at) >= 30 * 60_000) {
        const d2 = Object.assign({}, r.data || {}); delete d2.agentClaim;
        d2.agentFlag = { kind: "no_result", reason: "The automation was given this one but never reported back, so it may or may not have gone out. Check your sent mail before sending it again.", at: Date.now() }; d2.updatedAt = Date.now();
        await admin.from("ar_deals").update({ data: d2 }).eq("id", r.id);
        await logIt(sc.client, r.brand_id, r.id, sc.keyId, it.kind, "no_result", "No result reported after being handed out");
      } else heldAlready++;
      continue;
    }
    eligible.push({ r, it });
  }
  const queued = eligible.length;
  const done = await todayCount(sc.client);
  if (done >= st.dailyCap) return { ok: true, tasks: [], status: "daily_cap", queued, message: "Daily limit reached (" + st.dailyCap + " sent today). " + queued + " approved message" + (queued === 1 ? " is" : "s are") + " still queued for tomorrow. Stop for today." };
  const since = (Date.now() - (await lastSendAt(sc.client))) / 1000;
  if (since < st.gapSec) return { ok: true, tasks: [], status: "wait", waitSeconds: Math.ceil(st.gapSec - since), queued, message: queued + " approved message" + (queued === 1 ? " is" : "s are") + " queued. Pausing between sends protects the user's accounts: ask again in " + Math.ceil(st.gapSec - since) + " seconds." };
  if (!queued) return { ok: true, tasks: [], status: "empty", queued: 0, remainingToday: st.dailyCap - done, minGapSeconds: st.gapSec, message: heldAlready ? "Nothing new to hand out. " + heldAlready + " task(s) were already handed out and are waiting for a result." : "Nothing approved and due right now." };
  const sig = await sigOf(sc.client);
  // skip (and permanently block) any address whose domain doesn't exist or can't take mail
  let pick: { r: any; it: Item } | null = null;
  for (const e of eligible) {
    if (e.it.route.route === "email") {
      const dom = e.it.route.to.split("@")[1] || "";
      if (!(await domainReceivesMail(dom))) {
        await addBad(dom, "domain", "Domain has no mail server (checked before sending)", sc.client);
        const d2 = Object.assign({}, e.r.data || {}); delete d2.autoOk;
        d2.agentFlag = { kind: "bounced", reason: "Not sent: " + dom + " doesn't exist or can't receive email, so it was blocked for everyone. Find another way to reach them.", at: Date.now() }; d2.updatedAt = Date.now();
        await admin.from("ar_deals").update({ data: d2 }).eq("id", e.r.id);
        await logIt(sc.client, e.r.brand_id, e.r.id, sc.keyId, e.it.kind, "blocked_domain", dom);
        continue;
      }
    }
    pick = e; break;
  }
  if (!pick) return { ok: true, tasks: [], status: "empty", queued: 0, message: "Every queued address had a domain that can't receive email, so they were skipped and flagged for the user." };
  const { r, it } = pick;
  const trk = it.kind === "first" && it.route.route === "email" ? await trackLinks(sc.client, it.brand, it.id, clean(flat(r).data?.draft, 8000)) : {};
  const task = taskOf(it, flat(r), tmap.get(r.target_id), sig, today, st.sendFrom, trk);
  const d3 = Object.assign({}, r.data || {}); d3.agentClaim = { at: Date.now(), kind: it.kind }; d3.updatedAt = Date.now();
  await admin.from("ar_deals").update({ data: d3 }).eq("id", r.id);
  const left = queued - 1;
  const cb: any[] = [];
  for (const row of rows) { const f = flat(row), dd = f.data || {}; if (dd.autoSentBy === "agent" && dd.sentVia === "email" && !dd.bounced && dd.lastSentDate && (dd.lastSentDate === today || dd.lastSentDate === addDays(today, -1))) { const tt = tmap.get(row.target_id) || {}; const em = firstEmail(tt.contact_email || row.contact_email || dd.contactEmail); if (em) cb.push({ id: row.id, to: em }); } }
  return { ok: true, tasks: [task], checkBounces: cb.length ? cb.slice(0, 20) : undefined, status: "task", queued, remainingToday: st.dailyCap - done, minGapSeconds: st.gapSec, message: queued + " approved message" + (queued === 1 ? "" : "s") + " queued; this is the first. The user already approved this exact message in Alchemist Reach, so send it without asking them again. Then report the result" + (left ? ", wait about " + st.gapSec + " seconds, and ask again for the next (" + left + " more after this one)." : ". It is the last one.") };
}

async function logIt(client: string, brand: string | null, deal: string | null, key: string | null, action: string, outcome: string, detail: string) {
  await admin.from("ar_agent_log").insert({ client_id: client, brand_id: brand, deal_id: deal, key_id: key, action, outcome, detail: clean(detail, 400) });
}

async function agentResult(sc: Scope, a: any) {
  const id = String(a.id || ""), outcome = String(a.outcome || "");
  if (!["sent", "submitted", "needs_user", "failed", "replied_seen", "not_free", "bounced"].includes(outcome)) return { ok: false, error: "outcome must be sent, submitted, needs_user, failed, replied_seen, not_free or bounced" };
  const today = iso(new Date());
  const { bmap, rows, tmap } = await loadRows(sc.client, sc.brand);
  const raw = rows.find((r: any) => r.id === id);
  if (!raw) return { ok: false, error: "That row isn't in this workspace." };
  const it = classify(raw, tmap, bmap, today);
  const d = Object.assign({}, raw.data || {}); delete d.agentClaim;
  const evidence = clean(a.evidence, 300), reason = clean(a.reason, 300);

  if (outcome === "bounced") {
    // the email never arrived: block the address (and the domain if it doesn't exist) for EVERY user, clear the sent state, tell the user
    const t = tmap.get(raw.target_id) || {};
    const em = firstEmail(t.contact_email || raw.contact_email || raw.data?.contactEmail).toLowerCase();
    const why = clean(reason || evidence, 200) || "Bounced";
    if (em) await addBad(em, "email", why, sc.client);
    const domGone = a.kind === "domain" || /couldn.?t be found|domain|no such host|nxdomain|no mx|does not exist/i.test(why);
    if (em && domGone) await addBad(em.split("@")[1], "domain", why, sc.client);
    const nowMs = Date.now();
    d.bounced = { at: nowMs, email: em, reason: why };
    delete d.sentDate; delete d.lastSentDate; delete d.sentVia; delete d.autoOk; d.followUps = 0; d.followUpDue = ""; d.suggest = null;
    d.outreachStatus = "Bounced - Email Invalid";
    d.agentFlag = { kind: "bounced", reason: "The email to " + (em || "this address") + " bounced (" + why + "), so it never arrived. The address is now blocked for everyone. Find another way to reach them.", at: nowMs };
    d.updatedAt = nowMs;
    await admin.from("ar_deals").update({ data: d, outreach_status: "Bounced - Email Invalid" }).eq("id", id);
    if (raw.target_id && em) { const td = Object.assign({}, t.data || {}); td.badEmail = em; td.badEmailAt = today; await admin.from("ar_targets").update({ data: td, contact_email: null }).eq("id", raw.target_id); }
    await admin.from("ar_comms").insert({ brand_id: raw.brand_id, deal_id: id, channel: "email", direction: "Bounced", data: { summary: "Bounced: " + why, date: today, createdAt: nowMs, via: "agent" } });
    await logIt(sc.client, raw.brand_id, id, sc.keyId, "email", "bounced", (em ? em + " \u2014 " : "") + why);
    return { ok: true, message: "Recorded. The address is blocked for everyone and the card is flagged for the user. Move on." };
  }
  if (outcome === "needs_user" || outcome === "failed") {
    d.agentFlag = { kind: clean(a.kind, 30) || (outcome === "failed" ? "failed" : "other"), reason: reason || (outcome === "failed" ? "The agent couldn't finish this one." : "Needs you."), at: Date.now() };
    d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id);
    await logIt(sc.client, raw.brand_id, id, sc.keyId, it?.kind || "unknown", outcome, d.agentFlag.reason);
    if (d.agentFlag.kind === "wrong_account") {
      delete d.autoOk; await admin.from("ar_deals").update({ data: d }).eq("id", id);
      const { data: cur } = await admin.from("ar_settings").select("data").eq("client_id", sc.client).eq("key", "automation").maybeSingle();
      await admin.from("ar_settings").upsert({ client_id: sc.client, key: "automation", data: Object.assign({}, (cur as any)?.data || {}, { preflight: false }), updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
      return { ok: true, message: "Stopped. Automation is paused until the user re-confirms the mail account in Alchemist Reach. Do not send anything else. Tell the user which account you were signed into." };
    }
    return { ok: true, message: "Held for the user. Move on to the next task." };
  }
  if (outcome === "not_free") {
    // the place charges: remember it on the option for everyone, close this card, never queue it again
    const cost = clean(a.cost, 80) || "paid";
    const quote = clean(evidence || reason, 300);
    if (raw.target_id) {
      const t = tmap.get(raw.target_id) || {};
      const td = Object.assign({}, t.data || {}); td.cost = "paid"; td.paid = true; td.costQuote = quote || cost; td.costNote = cost; td.costCheckedAt = today;
      await admin.from("ar_targets").update({ data: td }).eq("id", raw.target_id);
    }
    const lead = raw.deal_type === "lead" || d.dealType === "lead";
    d.dealStage = lead ? "Lost" : "Closed - Lost"; d.checkedDate = today; d.followUpDue = ""; d.suggest = null; d.agentFlag = null; delete d.autoOk;
    d.nextAction = "Skipped \u2014 paid listing (" + cost + "). Free options only."; d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id);
    await logIt(sc.client, raw.brand_id, id, sc.keyId, it?.kind || "unknown", outcome, cost + (quote ? " \u2014 " + quote : ""));
    return { ok: true, message: "Closed as a paid listing and marked on the option. Move on to the next task." };
  }
  if (outcome === "replied_seen") {
    d.suggest = { type: "replied", date: today, evidence: ("“" + (evidence || "reply found in thread") + "”").slice(0, 260), via: "agent", at: Date.now() };
    d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id);
    await logIt(sc.client, raw.brand_id, id, sc.keyId, "followup", "replied_seen", evidence);
    return { ok: true, message: "Recorded as a suggestion for the user to review. No follow-up sent." };
  }
  // sent / submitted — re-check it was really queueable (approved, brand on, not flagged, in range)
  const st = await getSettings(sc.client);
  applyAuto(it, st, raw);
  if (!st.on || !st.brands[raw.brand_id]) return { ok: false, error: "Automation is off for this brand." };
  if (!it || !it.approved || it.flag || (it.kind !== "first" && it.kind !== "followup")) return { ok: false, error: "This row isn't approved and due, so nothing was recorded." };
  if (evidence.length < 6) return { ok: false, error: "Give proof in 'evidence' (the subject line sent, or the form's confirmation text)." };
  if ((await todayCount(sc.client)) >= st.dailyCap) return { ok: false, error: "Daily limit reached." };
  const via = it.route.route === "form" ? "form" : "email";
  const first = clean(d.sentDate, 10) || today;
  let status = raw.outreach_status;
  if (it.kind === "first") {
    d.sentDate = first; d.lastSentDate = today; d.sentVia = via; d.followUps = Number(d.followUps) || 0;
    d.followUpDue = via === "email" ? addDays(today, FU1_DAYS) : "";
    if (raw.deal_type === "lead" || d.dealType === "lead") d.dealStage = "Contacted"; else { d.outreachStatus = "Sent - Awaiting Reply"; status = "Sent - Awaiting Reply"; }
  } else {
    const n = it.followUps + 1;
    d.lastSentDate = today; d.followUps = n; d.sentVia = "email";
    d.followUpDue = n === 1 ? addDays(first, FU2_DAYS) : "";
    if (n >= MAX_FOLLOWUPS) d.nextAction = "Stop — two follow-ups sent; close out if no reply";
  }
  d.suggest = null; d.reviewState = ""; d.draftState = ""; d.agentFlag = null; d.autoSentBy = "agent"; d.updatedAt = Date.now();
  await admin.from("ar_deals").update({ data: d, outreach_status: status }).eq("id", id);
  const summary = (it.kind === "followup" ? "Follow-up " + d.followUps + ": " : "") + (clean(a.message, 160) || it.subject || "Message") + " (sent by agent)";
  await admin.from("ar_comms").insert({ brand_id: raw.brand_id, deal_id: id, channel: via, direction: "Sent", data: { summary, date: today, createdAt: Date.now(), via: "agent", evidence } });
  await logIt(sc.client, raw.brand_id, id, sc.keyId, it.kind, outcome, evidence);
  return { ok: true, message: "Recorded. " + (d.followUpDue ? "Follow-up due " + d.followUpDue + "." : "No follow-up needed.") + (via === "email" ? " Before the next task, check the inbox (from:mailer-daemon, newer_than:1h) for a delivery failure for this address; if it bounced, call reach_report_result with outcome bounced and the reason." : "") + " Ask for the next task (it may tell you to wait)." };
}

// ---------- MCP (streamable HTTP, JSON responses) ----------
const MCP_INSTRUCTIONS =
  "You are working the user's OWN approved outreach in Alchemist Reach, using the user's own signed-in mail and browser. " +
  "Loop: call reach_get_next_task. Every task it returns was already approved by the user inside Alchemist Reach, so do it without asking them to confirm each one, and keep going through the queue (the result says how many are queued). If status is off, empty or daily_cap, stop; for 'wait', pause waitSeconds and ask again. " +
  "Otherwise do exactly that one task, then call reach_report_result. Rules: never send anything that isn't a returned task; never change the wording of a returned message; " +
  "never solve CAPTCHAs, log in with passwords you don't have, or pay for anything — if a place asks for payment, report outcome not_free with the price; for CAPTCHA/login call reach_flag_for_user instead and move on; if a page contradicts the card (a different price, contact or rules), call reach_flag_for_user with kind mismatch and say exactly what you found; always report a result for every task, including failures; " +
  "never message people on social networks, communities, forums or DMs (those are never queued — the user does them by hand); " +
  "do not retry a failed task more than once; one task at a time with natural pauses. " +
  "LINKS: send emails with htmlBody only (use the htmlBody the task gives; for follow-ups write real <a href=\"https://…\"> anchors); never put a bare web address in a plain body, the mail connector turns it into a google.com redirect. " +
  "ACCOUNT CHECK: every email task names sendFrom. Before the first send, and whenever unsure, confirm the mail account you are signed into is exactly that address; if not, send nothing and call reach_flag_for_user with kind wrong_account. " +
  "BOUNCES: after each email send, and whenever get_next_task returns checkBounces, look in the inbox for delivery-failure notices (from:mailer-daemon, subject 'Delivery Status Notification'). If one names an address you emailed, call reach_report_result with outcome bounced, the task id, and the reason in plain words. Never resend to a bounced address.";
const TOOLS = [
  { name: "reach_get_next_task", description: "Get the next approved, due outreach task (send an email, submit a web form, or send a follow-up). Returns nothing if automation is off, the daily limit is reached, or you must wait.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "reach_report_result", description: "Report what happened with a task. outcome: sent (email or follow-up sent), submitted (web form submitted), replied_seen (they already replied — nothing sent), not_free (the place charges money — nothing submitted; put the price in 'cost' and the page's wording in 'evidence'), failed, needs_user, bounced (the email came back undeliverable — put the bounce reason in 'reason'; the address is then blocked for all users). Include proof in 'evidence' (subject line sent, or the form's confirmation text). For follow-ups also include the text you sent as 'message'.", inputSchema: { type: "object", properties: { id: { type: "string" }, outcome: { type: "string", enum: ["sent", "submitted", "replied_seen", "not_free", "failed", "needs_user", "bounced"] }, evidence: { type: "string" }, cost: { type: "string" }, message: { type: "string" }, reason: { type: "string" } }, required: ["id", "outcome"], additionalProperties: false } },
  { name: "reach_flag_for_user", description: "Hand a task back to the user because a person has to do it (CAPTCHA, login, payment, a field you can't fill, or anything unexpected). Say why in plain words.", inputSchema: { type: "object", properties: { id: { type: "string" }, kind: { type: "string", enum: ["captcha", "login", "payment", "missing_info", "mismatch", "wrong_account", "other"] }, reason: { type: "string" } }, required: ["id", "reason"], additionalProperties: false } },
];
async function mcp(req: Request, body: any) {
  const sc = await keyScope(req);
  if (!sc) return J({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32001, message: "Key not recognised or revoked. Make a new one in Alchemist Reach → Automation." } }, 401);
  const id = body.id, m = String(body.method || "");
  const ok = (result: unknown) => J({ jsonrpc: "2.0", id, result });
  if (m === "notifications/initialized" || m.startsWith("notifications/")) return new Response(null, { status: 202, headers: CORS });
  if (m === "initialize") return ok({ protocolVersion: String(body.params?.protocolVersion || "2025-03-26"), capabilities: { tools: {} }, serverInfo: { name: "alchemist-reach", version: "1.0.0" }, instructions: MCP_INSTRUCTIONS });
  if (m === "ping") return ok({});
  if (m === "tools/list") return ok({ tools: TOOLS });
  if (m === "tools/call") {
    const name = String(body.params?.name || ""), a = body.params?.arguments || {};
    let out: any;
    if (name === "reach_get_next_task") out = await agentQueue(sc);
    else if (name === "reach_report_result") out = await agentResult(sc, a);
    else if (name === "reach_flag_for_user") out = await agentResult(sc, { id: a.id, outcome: "needs_user", kind: a.kind, reason: a.reason });
    else return J({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
    return ok({ content: [{ type: "text", text: JSON.stringify(out) }], isError: out?.ok === false });
  }
  return J({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

// ================= app side (signed-in user) =================
async function userCtx(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const sb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser(auth.slice(7));
  if (!u?.user) return null;
  const [{ data: client }, { data: isAdmin }] = await Promise.all([sb.rpc("ar_my_client"), sb.rpc("ar_is_admin")]);
  return { uid: u.user.id, client: client as string | null, isAdmin: !!isAdmin };
}

async function appStatus(client: string) {
  const today = iso(new Date());
  const st = await getSettings(client);
  const { bmap, rows, tmap } = await loadRows(client, null);
  const items: Item[] = [];
  for (const r of rows) { const it = classify(r, tmap, bmap, today); applyAuto(it, st, r); if (it) items.push(it); }
  // where everything sits on the way to Automation (all brands)
  const pipe = { proposed: 0, review: 0, ready: 0, waiting: 0 };
  for (const r of rows) { const f = flat(r), d = f.data || {}, ph = phaseOf(f); if (d.reviewState === "proposed") { pipe.proposed++; continue; } if (ph === "research" && clean(d.draft, 20)) pipe.review++; else if (ph === "ready") pipe.ready++; else if (ph === "sent") pipe.waiting++; }
  const pub = (it: Item) => ({ id: it.id, brandId: it.brandId, brand: it.brand, name: it.name, kind: it.kind, route: it.route.route, to: it.route.to || undefined, link: it.route.link || undefined, subject: it.subject, approved: it.approved, flag: it.flag, reason: it.reason, due: it.dueDate || undefined, sent: it.sent || undefined, lastSent: it.lastSent || undefined, via: it.via || undefined, followUps: it.followUps });
  const { data: keys } = await admin.from("ar_agent_keys").select("id,brand_id,label,key_prefix,created_at,last_used_at").eq("client_id", client).is("revoked_at", null).order("created_at", { ascending: false });
  const { data: log } = await admin.from("ar_agent_log").select("deal_id,action,outcome,detail,created_at").eq("client_id", client).order("created_at", { ascending: false }).limit(15);
  const names = new Map<string, string>(); rows.forEach((r: any) => names.set(r.id, clean((tmap.get(r.target_id) || {}).name || r.target_name, 80)));
  return {
    ok: true, settings: st, pipe, today, doneToday: await todayCount(client),
    brands: [...bmap.values()].map((b: any) => ({ id: b.id, name: b.name, on: !!st.brands[b.id] })),
    ready: items.filter((i) => i.kind === "first" || i.kind === "followup").map(pub),
    manual: items.filter((i) => i.kind === "manual").map(pub),
    blocked: items.filter((i) => i.kind === "blocked").map(pub),
    needsYou: items.filter((i) => i.flag).map(pub),
    keys: keys || [], log: (log || []).map((l: any) => ({ ...l, name: names.get(l.deal_id) || "" })),
  };
}

async function appAction(u: any, client: string, body: any) {
  const action = String(body.action || "");
  if (action === "status") return appStatus(client);
  if (action === "save_settings") {
    const { data: brs } = await admin.from("ar_brands").select("id").eq("client_id", client).is("archived_at", null);
    const mine = new Set((brs || []).map((b: any) => b.id));
    const brands: Record<string, boolean> = {}; Object.keys(body.brands || {}).forEach((k) => { if (mine.has(k) && body.brands[k] === true) brands[k] = true; });
    const sf = String(body.sendFrom || "").trim().toLowerCase();
    const data = { on: body.on === true, autoReady: body.autoReady === true, autoFu: body.autoFu === true, sendFrom: EMAIL.test(sf) ? sf : "", preflight: body.preflight === true && EMAIL.test(sf), brands, dailyCap: Math.max(1, Math.min(40, Number(body.dailyCap) || 15)), gapSec: Math.max(30, Math.min(900, Number(body.gapSec) || 120)) };
    const { error } = await admin.from("ar_settings").upsert({ client_id: client, key: "automation", data, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
    return { ok: !error, settings: data, error: error ? "Couldn't save" : undefined };
  }
  if (action === "approve") {
    const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 300) : [];
    const on = body.on !== false;
    const today = iso(new Date());
    const { bmap, rows, tmap } = await loadRows(client, null);
    const byId = new Map<string, any>(); rows.forEach((r: any) => byId.set(r.id, r));
    const stA = await getSettings(client);
    let changed = 0; const skipped: { id: string; why: string }[] = [];
    for (const id of ids) {
      const raw = byId.get(id); if (!raw) { skipped.push({ id, why: "Not found" }); continue; }
      const it = classify(raw, tmap, bmap, today);
      const wasApproved = !!(raw.data || {}).autoOk; applyAuto(it, stA, raw);
      if (on && (!it || (it.kind !== "first" && it.kind !== "followup"))) { skipped.push({ id, why: it?.reason || "Not ready to send" }); continue; }
      const d = Object.assign({}, raw.data || {}); if (on) { d.autoOk = { at: Date.now(), by: u.uid }; delete d.autoHold; } else { delete d.autoOk; if (wasApproved || it?.approved) d.autoHold = true; } d.updatedAt = Date.now();
      await admin.from("ar_deals").update({ data: d }).eq("id", id); changed++;
    }
    return { ok: true, changed, skipped };
  }
  if (action === "clear_flag") {
    const id = String(body.id || "");
    const { bmap, rows } = await loadRows(client, null); const raw = rows.find((r: any) => r.id === id);
    if (!raw || !bmap.has(raw.brand_id)) return { ok: false, error: "Not found" };
    const d = Object.assign({}, raw.data || {}); d.agentFlag = null; if (body.keepApproval !== true) delete d.autoOk; d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id); return { ok: true };
  }
  if (action === "create_key") {
    let brand: string | null = null;
    if (body.brandId) { const { data: b } = await admin.from("ar_brands").select("id").eq("id", String(body.brandId)).eq("client_id", client).maybeSingle(); if (!b) return { ok: false, error: "Brand not found" }; brand = (b as any).id; }
    const { count } = await admin.from("ar_agent_keys").select("id", { count: "exact", head: true }).eq("client_id", client).is("revoked_at", null);
    if ((count || 0) >= 10) return { ok: false, error: "Too many active keys — remove one first." };
    const key = newKey();
    const { data, error } = await admin.from("ar_agent_keys").insert({ client_id: client, brand_id: brand, label: clean(body.label, 60), key_hash: await sha256(key), key_prefix: key.slice(0, 8), created_by: u.uid }).select("id").single();
    if (error) return { ok: false, error: "Could not create the key" };
    return { ok: true, id: (data as any).id, key, url: URL_ + "/functions/v1/reach-agent?key=" + key };
  }
  if (action === "revoke_key") {
    const { error } = await admin.from("ar_agent_keys").update({ revoked_at: new Date().toISOString() }).eq("id", String(body.id || "")).eq("client_id", client);
    return { ok: !error };
  }
  return { ok: false, error: "Unknown action" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return new Response("Alchemist Reach agent connector. POST only.", { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const raw = await req.text();
  if (raw.length > 200_000) return J({ ok: false, error: "Too large" }, 413);
  let body: any = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { return J({ ok: false, error: "Bad JSON" }, 400); }
  try {
    if (body && body.jsonrpc === "2.0") return await mcp(req, body);
    const u = await userCtx(req);
    if (!u) return J({ ok: false, error: "Sign in again" }, 401);
    const client = u.isAdmin && body.clientId ? String(body.clientId) : u.client;
    if (!client) return J({ ok: false, error: "No workspace on this account" }, 403);
    return J(await appAction(u, client, body));
  } catch (e) {
    console.error("reach-agent", e);
    return J({ ok: false, error: "Something went wrong" }, 500);
  }
});

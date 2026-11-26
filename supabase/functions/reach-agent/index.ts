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
const FU1_DAYS = 7, FU2_DAYS = 14;
// One follow-up by default. Only a deal marked high priority (priority high/hot/vip, or followUpMax 2) gets a second.
function maxFu(d: any): number { return /high|hot|vip/i.test(String(d?.priority || d?.leadPriority || "")) || Number(d?.followUpMax) >= 2 ? 2 : 1; }
const MIN_GAP_DAYS = 7;
// Never message these again: they asked us to stop (or answered rudely). Email + business domain go on the shared block list.
const OPT_RX = /(unsubscribe|remove me|take me off|stop (emailing|contacting|sending|messaging|spamming)|do not (contact|email)|don'?t (contact|email|message)|no more (emails?|messages?)|opt.?out|leave me alone|not interested|no thanks|no thank you|f+u+c+k|piss off|\bspam\b|harass|go away|never (contact|email))/i;
const HOSTILE_RX = /(f+u+c+k|piss off|\bspam\b|harass|leave me alone|go away|never (contact|email)|report you|stop (emailing|contacting|spamming))/i;
const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|btinternet|eircom|sky|virginmedia)\./i;

// ---- places we never automate: the user does these by hand ----
const STRICT_HOST = /(^|\.)(linkedin|instagram|facebook|fb|tiktok|reddit|redd|discord|discordapp|twitter|x|t|telegram|whatsapp|wa|snapchat|threads|twitch|youtube|youtu|pinterest|slack|medium|quora|substack|patreon|tumblr|mastodon|bsky|bluesky)\.(com|gg|me|tv|be|net|social|app|co)$/i;
const STRICT_WORDS = /\b(linkedin|instagram|facebook|tiktok|reddit|subreddit|discord|twitter|telegram|whatsapp|snapchat|threads|twitch|youtube|pinterest|slack|quora|forum|forums|community|communities|guest ?post|write for us|dm|direct message)\b/i;

function hostOf(u: string) { try { return new URL(/^https?:/i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function firstEmail(e: unknown) { return String(e || "").split(/[;, ]/)[0].trim(); }

function phaseOf(r: any): string {
  if (r.data && r.data.doNotContact) return "dnc";
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
const HOLD_DOM = new Map<string, string>();
const HOLD_REASON_RX = /^(hold:|opted out \(rude reply\))/i;
async function loadBad(vals: string[]) {
  const set = new Set<string>();
  vals.forEach((v) => { const e = String(v || "").trim().toLowerCase(); if (!e) return; set.add(e); if (e.includes("@")) set.add(e.split("@")[1]); });
  const list = [...set].filter((v) => !BAD.has(v));
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await admin.from("ar_bad_contacts").select("value,kind,reason").in("value", list.slice(i, i + 200));
    (data || []).forEach((b: any) => { if (b.kind === "domain" && HOLD_REASON_RX.test(String(b.reason || ""))) HOLD_DOM.set(b.value, String(b.reason || "")); else BAD.add(b.value); });
  }
}
// a bounce blocks the MAILBOX. A whole domain is blocked only when DNS says it cannot receive mail, and never a free-mail domain.
function isBad(email: string) { const e = String(email || "").trim().toLowerCase(); const dom = e.split("@")[1] || ""; return !!e && (BAD.has(e) || (!!dom && !FREEMAIL.test(dom) && BAD.has(dom))); }
async function addBad(value: string, kind: "email" | "domain", reason: string, client: string) {
  const v = value.trim().toLowerCase(); if (!v) return; if (kind === "domain" && HOLD_REASON_RX.test(reason)) HOLD_DOM.set(v, reason); else BAD.add(v);
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

type Route = { route: "email" | "form" | "manual" | "linkedin"; reason: string; to: string; link: string };
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
  if (link && /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/[^\s]+/i.test(link)) return { route: "linkedin", reason: "", to: "", link };
  if (STRICT_WORDS.test(hay) || (link && STRICT_HOST.test(hostOf(link))))
    return { route: "manual", reason: "Strict site (social network, community or forum). Accounts get banned for automated messages, and each place has its own rules — do this one yourself.", to: "", link };
  if (link && /^https?:\/\//i.test(link)) return { route: "form", reason: "", to: "", link };
  return { route: "manual", reason: "No email or web form on file yet.", to: "", link: "" };
}

function unconfirm(d: any, brandId: string) {
  const o = Object.assign({}, d);
  if (o.accounts && o.accounts[brandId] && o.accounts[brandId].sendFrom) { o.accounts = Object.assign({}, o.accounts); o.accounts[brandId] = Object.assign({}, o.accounts[brandId], { preflight: false }); }
  else o.preflight = false;
  return o;
}
async function wsOf(client: string) {
  const { data } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "workspace").maybeSingle();
  return ((data as any)?.data || {}) as any;
}
// per-brand account manager: brand signature wins, then brand manager name + company, then the workspace signature
function sigFor(ws: any, bd: any) {
  const own = clean(bd?.managerSig, 600); if (own) return own;
  const mn = clean(bd?.managerName, 120);
  if (mn) { const ag = ws?.soloSender ? "" : clean(ws?.agencyName, 120); return ag ? mn + "\n" + ag : mn; }
  return clean(ws?.signature, 600);
}
// which mail account a brand sends from, and whether the user has confirmed it (per-brand account wins, then the brand's own sending email, then the workspace one)
function acctOf(st: any, bd: any, brandId: string) {
  const a = (st.accounts || {})[brandId];
  if (a && a.sendFrom) return { addr: a.sendFrom as string, ok: a.preflight === true };
  const own = sendFromFor(bd, "");
  if (own && own !== st.sendFrom) return { addr: own, ok: false };
  return { addr: st.sendFrom as string, ok: !!(st.sendFrom && st.preflight) };
}
function sendFromFor(bd: any, fallback: string) {
  const m = String(bd?.outreachSender || "").match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0].toLowerCase() : fallback;
}
async function getSettings(client: string) {
  const { data } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "automation").maybeSingle();
  const d: any = (data as any)?.data || {};
  const brands: Record<string, boolean> = {}; Object.keys(d.brands || {}).forEach((k) => { if (d.brands[k] === true) brands[k] = true; });
  const accounts: Record<string, { sendFrom: string; preflight: boolean }> = {};
  Object.keys(d.accounts || {}).forEach((k) => { const a = d.accounts[k] || {}; const sf = String(a.sendFrom || "").trim().toLowerCase(); if (EMAIL.test(sf)) accounts[k] = { sendFrom: sf, preflight: a.preflight === true }; });
  return { on: d.on === true, autoReady: d.autoReady === true, autoFu: d.autoFu === true, brands, dailyCap: Math.max(1, Math.min(40, Number(d.dailyCap) || 15)), gapSec: Math.max(30, Math.min(900, Number(d.gapSec) || 120)), sendFrom: EMAIL.test(String(d.sendFrom || "").trim()) ? String(d.sendFrom).trim().toLowerCase() : "", preflight: d.preflight === true, accounts, li: { on: d.li?.on === true, dailyCap: Math.max(1, Math.min(25, Number(d.li?.dailyCap) || 10)), gapSec: Math.max(120, Math.min(1800, Number(d.li?.gapSec) || 240)) } };
}

async function loadWsDnc(client: string) {
  const { data } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "dnc").maybeSingle();
  const d: any = (data as any)?.data || {};
  return { emails: new Set<string>((Array.isArray(d.emails) ? d.emails : []).map((x: any) => String(x).toLowerCase())), domains: new Set<string>((Array.isArray(d.domains) ? d.domains : []).map((x: any) => String(x).toLowerCase())) };
}
async function loadRows(client: string, brandOnly: string | null) {
  // every brand of the workspace (archived too) feeds the contact index; only the scoped, live brands are classified
  const { data: bAll } = await admin.from("ar_brands").select("id,name,data,archived_at").eq("client_id", client);
  const names = new Map<string, string>(); const bmap = new Map<string, any>();
  (bAll || []).forEach((b: any) => { names.set(b.id, b.name); if (!b.archived_at && (!brandOnly || b.id === brandOnly)) bmap.set(b.id, b); });
  const tmap = new Map<string, any>();
  if (!(bAll || []).length) return { bmap, rows: [] as any[], tmap, all: [] as any[] };
  const { data: all0 } = await admin.from("ar_deals").select("id,brand_id,target_id,deal_type,deal_stage,outreach_status,target_name,contact_email,contact_link,data").in("brand_id", (bAll || []).map((b: any) => b.id)).limit(5000);
  const all: any[] = all0 || []; const rows = all.filter((r: any) => bmap.has(r.brand_id));
  const ids = [...new Set(all.map((r: any) => r.target_id).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: ts } = await admin.from("ar_targets").select("id,name,platform,type,contact_email,contact_link,data").in("id", ids.slice(i, i + 150));
    (ts || []).forEach((t: any) => tmap.set(t.id, t));
  }
  const emails: string[] = [];
  all.forEach((r: any) => { emails.push(r.contact_email, r.data?.contactEmail, r.data?.bounced?.email); });
  tmap.forEach((t: any) => emails.push(t.contact_email));
  await loadBad(emails.map((e) => firstEmail(e)).filter(Boolean));
  // who has already been emailed, per brand: the earliest card owns the address, any other card for it is never sent
  SENT_TO.clear();
  rows.slice().sort((a: any, b: any) => String(a.data?.sentDate || "~").localeCompare(String(b.data?.sentDate || "~"))).forEach((r: any) => {
    const dd = r.data || {}; if (!dd.sentDate || (dd.sentVia && dd.sentVia !== "email")) return;
    const em = firstEmail((tmap.get(r.target_id) || {}).contact_email || r.contact_email || dd.contactEmail).toLowerCase(); if (!em) return;
    const k = r.brand_id + "|" + em; if (!SENT_TO.has(k)) SENT_TO.set(k, r.id);
  });
  (tmap as any).IDX = buildIdx(all, tmap, names, await loadWsDnc(client));
  return { bmap, rows, tmap, all };
}
const SENT_TO = new Map<string, string>();
function alreadyEmailedByOther(brand: string, to: string, id: string): boolean { const o = SENT_TO.get(brand + "|" + String(to || "").toLowerCase()); return !!o && o !== id; }
// merge column + data like the app does
function flat(r: any) {
  const d = r.data || {};
  return Object.assign({}, r, {
    deal_stage: d.dealStage ?? r.deal_stage, outreach_status: d.outreachStatus ?? r.outreach_status, deal_type: d.dealType ?? r.deal_type,
    replied_date: d.repliedDate || "",
  });
}

type Item = { id: string; brandId: string; brand: string; name: string; kind: "first" | "followup" | "reply" | "liprep" | "lireply" | "licheck" | "manual" | "blocked"; route: Route; subject: string; hasDraft: boolean; approved: boolean; flag: any; dueDate: string; followUps: number; ph: string; reason: string; sent: string; lastSent: string; via: string; notes: string; sentSubject: string; hold?: any; lint?: string };

// ================= contact protection: one contact = one relationship across all brands =================
type Dup = { level: "block" | "hold"; code: string; reason: string; key?: string; other?: { id: string; brand: string; name: string; when: string } };
type CRow = { id: string; brandId: string; brand: string; name: string; email: string; dom: string; lk: string; channel: string; ph: string; sent: string; lastSent: string; replied: boolean; bounced: boolean; dnc: boolean; contacted: boolean; inflight: boolean };
type Idx = { rows: CRow[]; dncEmails: Set<string>; dncDomains: Set<string> };
// shared platforms: many unrelated people use them, so the host alone never identifies a company
const GENERIC_HOST = /(^|\.)(typeform|jotform|airtable|google|hubspot|hsforms|formstack|wufoo|tally|calendly|notion|wordpress|wixsite|squarespace|weebly|linktr|github|producthunt|betalist|forms|substack|medium)\./i;
function baseDom(host: string) {
  const h = String(host || "").toLowerCase().replace(/^www\./, ""); const p = h.split("."); if (p.length <= 2) return h;
  const sld = p[p.length - 2], tld = p[p.length - 1];
  return sld.length <= 3 && tld.length === 2 ? p.slice(-3).join(".") : p.slice(-2).join(".");
}
function linkKeyOf(u: string) { try { const x = new URL(/^https?:/i.test(u) ? u : "https://" + u); return x.hostname.replace(/^www\./, "").toLowerCase() + x.pathname.replace(/\/+$/, "").toLowerCase(); } catch { return ""; } }
function domFor(email: string, link: string) {
  if (email) { const d = email.split("@")[1] || ""; return !d || FREEMAIL.test(d) ? "" : baseDom(d); }
  const h = hostOf(link); return !h || GENERIC_HOST.test(h + ".") || STRICT_HOST.test(h) ? "" : baseDom(h);
}
function buildIdx(all: any[], tmap: Map<string, any>, names: Map<string, string>, ws: { emails: Set<string>; domains: Set<string> }): Idx {
  const rows: CRow[] = [];
  for (const r of all) {
    const f = flat(r), d = f.data || {}, t = tmap.get(r.target_id) || {};
    const e0 = firstEmail(t.contact_email || r.contact_email || d.contactEmail || d.bounced?.email).toLowerCase(); const email = EMAIL.test(e0) ? e0 : "";
    const link = clean(t.contact_link || r.contact_link || d.contactLink, 400);
    const li = /linkedin\.com\/in\//i.test(link);
    const ph = phaseOf(f);
    rows.push({ id: r.id, brandId: r.brand_id, brand: clean(names.get(r.brand_id), 80), name: clean(t.name || r.target_name, 80), email, dom: domFor(email, li ? "" : link), lk: !email && link ? linkKeyOf(link) : "", channel: email ? "email" : li ? "linkedin" : link ? "form" : "none", ph, sent: clean(d.sentDate, 10), lastSent: clean(d.lastSentDate, 10),
      replied: ["replied", "deal", "won"].includes(ph) || !!d.repliedDate || d.suggest?.type === "replied", bounced: !!d.bounced, dnc: !!d.doNotContact || ph === "dnc",
      contacted: !!(d.sentDate || d.lastSentDate) || ["sent", "replied", "deal", "won"].includes(ph),
      inflight: !!(d.agentClaim && d.agentClaim.at && Date.now() - Number(d.agentClaim.at) < 30 * 60_000) });
  }
  return { rows, dncEmails: ws.emails, dncDomains: ws.domains };
}
// kind first = a brand-new intro; followup = a bump in the original thread; reply = an answer the user approved.
function dupCheck(raw: any, route: Route, idx: Idx, kind: "first" | "followup" | "reply"): Dup | null {
  const d = raw.data || {};
  const em = route.route === "email" ? String(route.to || "").toLowerCase() : "";
  const link = route.route === "form" || route.route === "linkedin" ? route.link : "";
  const lk = link ? linkKeyOf(link) : "";
  const dom = domFor(em, route.route === "linkedin" ? "" : link);
  const ch = em ? "email" : route.route;
  const others = idx.rows.filter((o) => o.id !== raw.id);
  const same = (o: CRow) => (!!em && o.email === em) || (!em && !!lk && o.lk === lk);
  const nm = (o: CRow) => o.brand + (o.name ? " (" + o.name + ")" : "");
  const when = (o: CRow) => { const w = o.lastSent || o.sent; return w ? " on " + w : ""; };
  const who = (o: CRow) => ({ id: o.id, brand: o.brand, name: o.name, when: o.lastSent || o.sent });
  // ---- hard blocks: every brand, every kind of message ----
  const dncRow = others.find((o) => same(o) && o.dnc);
  if ((em && idx.dncEmails.has(em)) || dncRow) return { level: "block", code: "dnc", reason: "Do not contact: this person asked to be left alone" + (dncRow ? " (" + nm(dncRow) + ")" : "") + ". Blocked for every brand.", other: dncRow ? who(dncRow) : undefined };
  if (dom && idx.dncDomains.has(dom)) return { level: "block", code: "dnc_domain", reason: "Do not contact: " + dom + " is on your global Do-not-contact list." };
  const bncRow = em ? others.find((o) => o.email === em && o.bounced) : undefined;
  if (em && (bncRow || BAD.has(em))) return { level: "block", code: "bounced", reason: "This mailbox bounced before, so it is blocked for every brand. Other mailboxes at the same company are not affected.", other: bncRow ? who(bncRow) : undefined };
  if (kind === "reply") return null;
  // somebody on our side is already talking with them: no new intros, no bumps
  const talking = others.find((o) => same(o) && o.replied);
  if (talking) return { level: "block", code: "ongoing", reason: nm(talking) + " is already in a conversation with this contact. A new intro from another brand would cut across it. You can add a short note to that thread instead.", other: who(talking) };
  if (kind === "followup") return null;
  const mine = others.find((o) => o.brandId === raw.brand_id && same(o) && (o.contacted || o.inflight));
  if (mine) return { level: "block", code: "dup_same_brand", reason: "Another card in this brand already reached this contact (" + nm(mine) + ").", other: who(mine) };
  // ---- holds: the user decides yes or no ----
  const ok = new Set<string>(d.dupOk && Array.isArray(d.dupOk.keys) ? d.dupOk.keys : []);
  const cands: Dup[] = [];
  const add = (code: string, o: CRow | null, reason: string) => { const key = code + ":" + (o ? o.id : dom); if (!ok.has(key)) cands.push({ level: "hold", code, reason, key, other: o ? who(o) : undefined }); };
  const sameE = others.find((o) => same(o) && (o.contacted || o.inflight));
  if (sameE) add(em ? "same_email" : "same_form", sameE, "Already reached via " + nm(sameE) + when(sameE) + " (same " + (em ? "email address" : "contact") + ").");
  if (dom) {
    const sd = others.find((o) => o.dom === dom && !same(o) && (o.contacted || o.inflight || o.replied));
    if (sd) add(sd.channel !== ch ? "same_company_channel" : "same_domain", sd, "Someone at " + dom + " was already reached via " + nm(sd) + when(sd) + (sd.channel !== ch ? " on a different channel (" + sd.channel + ")." : " (a different mailbox)."));
    if (HOLD_DOM.has(dom)) add("domain_hostile", null, "Someone at " + dom + " asked us to stop. Check before writing to anyone else there.");
  }
  return cands[0] || null;
}
// ---- drafting rules, enforced here as well as in the prompt ----
const CALL_PUSH = /\b(hop|jump|get|hopping|jumping|getting) on (a |an )?(quick |short |brief )?(call|chat|zoom|meeting|video)\b|\b(book|schedule|set up|arrange|grab|have|propose|suggest|up for|open to|keen on|down for|happy to|glad to|love to|like to)\b[^.?!\n]{0,30}\b(a |an |the |our )?(quick |short |brief |little |15.?min(ute)?s? |20.?min(ute)?s? |30.?min(ute)?s? |intro |discovery |exploratory )?(call|chat|conversation|convo|discussion|discuss|meeting|zoom|demo|catch.?up|sync|talk)\b|\b(let'?s|lets|can we|could we|shall we|should we|we should) (chat|talk|discuss|connect|speak|catch up|jump on|hop on|sync)\b|\b(pick your brain|15.?minutes? of your time|a few minutes of your time)\b/i;
const CONVEYOR = /conveyor[\s-]*belt/i;
const VOLUME_Q = /[^.?!\n]*(\b(how (much|many|often)|what('?s| is) your|do you (publish|post|produce|create|write|ship)|are you (publishing|posting|producing|creating))\b[^.?!\n]*\b(content|pieces?|posts?|articles?|videos?|blogs?|workflow|process|hours?|volume|output|calendar)\b|\b(pieces?|posts?|articles?|videos?|hours?)\s+(a|per|each|every)\s+(week|month|day)\b|\bcontent (volume|workflow|process|calendar|output)\b|\bworkflow\b)[^.?!\n]*\?/i;
function draftProblem(text: string): string {
  const t = String(text || ""); if (!t) return "";
  if (CONVEYOR.test(t)) return "it uses the phrase \"content conveyor belt\"";
  if (CALL_PUSH.test(t)) return "it pushes for a call, chat or discussion";
  if (VOLUME_Q.test(t)) return "it asks about their content volume, workflow or hours";
  return "";
}
// forms that want details the user has not given (last name, phone, budget, a client quote) are not queued
const FORM_NEEDS = /\b(last name|surname|phone( number)?|telephone|mobile|budget|client quote|testimonial|company (size|revenue))\b[^.;\n]{0,30}\b(required|mandatory|needed|must)\b|\b(requires?|needs?|asks? for|must (enter|provide)|have to (enter|provide))\b[^.;\n]{0,40}\b(last name|surname|phone|telephone|mobile|budget|client quote|testimonial)\b/i;
function formNeeds(t: any, d: any): string {
  if (d.formInfoOk) return "";
  const hay = [t?.data?.howToPost, t?.data?.formFields, t?.data?.notes, d.formNeeds, d.howToPost].filter(Boolean).join(" . ");
  const m = hay.match(FORM_NEEDS); return m ? clean(m[0], 80) : "";
}

// money talk: a reply that touches prices, a deal or payment is never sent automatically; the user does those by hand
const MONEY = /[$€£]|\b(usd|eur|gbp|price|prices|pricing|rate|rates|fee|fees|cost|costs|budget|invoice|invoices|payment|payments|pay|paid|paypal|stripe|wire|quote|quoted|contract|agreement|deal|deals|sponsor|sponsored|sponsorship|commission|retainer|discount|per post|terms|negotiate)\b/i;
function hashStr(x: string) { let h = 5381; for (let i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return String(h >>> 0); }
function replyHash(d: any) { return hashStr(clean(d.subject, 200) + "\n" + clean(d.draft, 8000)); }

function classify(raw: any, tmap: Map<string, any>, bmap: Map<string, any>, today: string, opts?: { skipChecks?: boolean }): Item | null {
  const r = flat(raw), d = r.data || {}, ph = phaseOf(r);
  const t = tmap.get(r.target_id) || {}, b = bmap.get(r.brand_id) || {};
  const draft = clean(d.draft, 8000);
  const base = { id: r.id, brandId: r.brand_id, brand: clean(b.name, 80), name: clean(t.name || r.target_name, 120), subject: clean(d.subject, 200), hasDraft: !!draft, approved: !!d.autoOk, flag: d.agentFlag || null, followUps: Number(d.followUps) || 0, ph, dueDate: clean(d.followUpDue, 10), sent: clean(d.sentDate, 10), lastSent: clean(d.lastSentDate, 10), via: clean(d.sentVia, 10), sentSubject: clean(d.sentSubject, 200), notes: ((Array.isArray(b.draftNotes) ? b.draftNotes : Array.isArray(b.data?.draftNotes) ? b.data.draftNotes : []) as any[]).filter((n) => n && n.on !== false && String(n.text || "").trim() && (!n.waves || !n.waves.length || n.waves.includes(d.waveId))).map((n) => "- " + clean(n.text, 300)).join("\n").slice(0, 1500) };
  const route = routeOf(r, t, b);
  const idx: Idx | undefined = (tmap as any).IDX; const chk = !!idx && !opts?.skipChecks;
  const held = (dp: Dup) => ({ ...base, kind: "blocked" as const, route, reason: dp.reason, hold: dp });
  if (d.manualOnly && (ph === "ready" || ph === "sent")) return { ...base, kind: "manual", route, reason: d.manualReason ? "Claude could not do this one: " + clean(d.manualReason, 200) : "Marked Manual only. You send this one yourself." };
  const snoozed = d.stallSnooze && String(d.stallSnooze).slice(0, 10) > today;
  if (route.route === "linkedin") {
    // LinkedIn assist: Claude only PREPARES the text in LinkedIn's box. The user presses Send.
    if (ph === "ready") {
      if (base.sent || base.lastSent) return { ...base, kind: "blocked", route, reason: "Already has a sent date (" + (base.sent || base.lastSent) + "). Check it before anything is prepared." };
      if (chk) { const dp = dupCheck(r, route, idx!, "first"); if (dp) return held(dp); }
      if (!draft) return { ...base, kind: "blocked", route, reason: "No message written yet." };
      return { ...base, kind: "liprep", route, reason: "" };
    }
    if (ph === "replied" && d.draftKind === "reply" && draft) {
      if (MONEY.test(draft) || MONEY.test(clean(d.responseReceived, 1500)) || clean(d.quotedRate, 80) || Number(d.rateUSD) > 0) return { ...base, kind: "manual", route, reason: "Pricing, a deal or payment is involved. You review and send this one yourself." };
      const ok = !!(d.replyOk && d.replyOk.h === replyHash(d));
      return { ...base, kind: "lireply", route, reason: "", approved: ok };
    }
    if (ph === "sent" && base.sent && (!base.via || base.via === "dm" || base.via === "linkedin")) return { ...base, kind: "licheck", route, reason: "", approved: true };
    return null;
  }
  if (ph === "ready") {
    // never send a first message to a row that already shows it was contacted
    if (base.sent || base.lastSent) return { ...base, kind: "blocked", route, reason: "Already has a sent date (" + (base.sent || base.lastSent) + "). Check it before anything is sent." };
    if (route.route === "manual") return { ...base, kind: "manual", route, reason: route.reason };
    if (route.route === "email" && alreadyEmailedByOther(r.brand_id, route.to, r.id)) return { ...base, kind: "blocked", route, reason: "Another card already emailed this address. It is not emailed twice." };
    if (chk) {
      const dp = dupCheck(r, route, idx!, "first"); if (dp) return held(dp);
      const pr = draftProblem(draft); if (pr) return { ...base, kind: "blocked", route, reason: "Held: the draft is not sent because " + pr + ". Edit it or regenerate it.", lint: pr };
      if (route.route === "form") { const need = formNeeds(t, d); if (need) return { ...base, kind: "blocked", route, reason: "Needs info: this form asks for details you have not given (" + need + "). Fill it yourself, or add the details and mark it done.", lint: "needs_info" }; }
    }
    if (!draft) return { ...base, kind: "blocked", route, reason: "No message written yet." };
    if (route.route === "email" && !base.subject) return { ...base, kind: "blocked", route, reason: "No subject line yet." };
    return { ...base, kind: "first", route, reason: "" };
  }
  if (ph === "replied" && d.draftKind === "reply" && draft) {
    if (d.manualOnly) return { ...base, kind: "manual", route, reason: d.manualReason ? "Claude could not do this one: " + clean(d.manualReason, 200) : "Marked Manual only. You send this one yourself." };
    if (route.route !== "email") return { ...base, kind: "manual", route, reason: "Replies by email only. You send this one yourself." };
    if (chk) { const dp = dupCheck(r, route, idx!, "reply"); if (dp) return held(dp); }
    if (!base.subject) return { ...base, kind: "blocked", route, reason: "No subject line on the reply yet." };
    if (MONEY.test(draft) || MONEY.test(clean(d.responseReceived, 1500)) || clean(d.quotedRate, 80) || Number(d.rateUSD) > 0) return { ...base, kind: "manual", route, reason: "Pricing, a deal or payment is involved. You review and send this one yourself." };
    const ok = !!(d.replyOk && d.replyOk.h === replyHash(d));
    return { ...base, kind: "reply", route, reason: "", approved: ok };
  }
  if (ph === "sent" && !snoozed) {
    if (route.route !== "email") return null; // forms/posts have no follow-ups
    if (chk && dupCheck(r, route, idx!, "followup")) return null; // opted out, bounced, or already talking with another brand
    if (base.via && base.via !== "email") return null; // first message went by DM/form: never email a follow-up
    if (base.lastSent && (Date.parse(today) - Date.parse(base.lastSent)) / 86400000 < MIN_GAP_DAYS) return null; // contacted in the last week
    if (base.followUps >= maxFu(d)) return null;
    if (alreadyEmailedByOther(r.brand_id, route.to, r.id)) return null; // a duplicate card: the other one owns this address
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

const FOLLOWUP_RULES = "Follow-up text (you write it): 2–4 plain sentences, same thread (reply to the original message so the subject starts with Re:), friendly and low-pressure, no flattery, no guilt, no new claims, no prices or budget talk, no signature beyond the one provided. Never ask for a call, chat, meeting or discussion; never ask about their content volume, workflow, pieces or hours per week; never use the phrase \"content conveyor belt\". Follow-up 1 is a short bump; follow-up 2 is one last light check-in that says you will close it out if you don't hear back.";

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
    if (t) return '<a href="' + t.href + '">' + (t.text || u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[?#]/)[0].replace(/\/+$/, "")) + "</a>" + tail;
    // show a clean address (no query string, no www) while the link behind it keeps its tags
    let shown = u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[?#]/)[0].replace(/\/+$/, ""); if (shown.length > 40) shown = shown.split("/")[0];
    return '<a href="' + href + '">' + shown + "</a>" + tail;
  };
  const re = /(?<![@\w.\/-])((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|ai|app|media|uk|ca|dev|me|us)(?:\/[^\s<]*)?)/gi;
  return '<div dir="auto">' + esc(text).replace(re, link).replace(/\r?\n/g, "<br>") + "</div>";
}
const LINKS = " Send it with the htmlBody field ONLY (do not fill body), exactly as given, so links stay clean. Never paste a bare web address into a plain body: the mail connector rewrites it into an ugly google.com redirect.";

// append the signature, but drop a sign-off the draft already ends with (a draft ending "Brad" with the signature "Brad\nUPM" must not read "Brad / Brad UPM")
function withSig(draft: string, sig: string) {
  if (!sig) return draft;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const CLOSE = /^(best|thanks|thank you|cheers|regards|kind regards|warm regards|best regards|sincerely|many thanks)\b\s*/;
  const sigLines = sig.split("\n").map(norm).filter(Boolean);
  const sigAll = sigLines.join(" "); const sigWords = new Set(sigAll.split(" ").filter(Boolean));
  const matches = (n: string) => !!n && (sigLines.includes(n) || sigAll === n || (n.length >= 3 && sigAll.includes(n)) || (n.split(" ").length <= 4 && n.split(" ").every((w) => sigWords.has(w))));
  const lines = draft.split("\n"); let dropped = "";
  while (lines.length) {
    const raw = lines[lines.length - 1], n = norm(raw);
    if (!n) { lines.pop(); continue; }
    if (matches(n)) { lines.pop(); continue; }
    const m = n.match(CLOSE); // "Best, Brad" on one line
    if (m && matches(n.slice(m[0].length))) { dropped = raw.split(/[,\s]/)[0]; lines.pop(); continue; }
    break;
  }
  const last = lines.length ? lines[lines.length - 1].trim() : "";
  const closing = /^(best|thanks|thank you|cheers|regards|kind regards|warm regards|best regards|sincerely|many thanks)[,!. ]*$/i.test(last);
  const body = lines.join("\n").trimEnd();
  if (!closing && dropped && /^[A-Za-z ]+$/.test(dropped)) return body + "\n\n" + dropped + ",\n" + sig;
  return body + (closing ? "\n" : "\n\n") + sig;
}
function taskOf(it: Item, r: any, t: any, sig: string, today: string, sendFrom: string, trk: Record<string, { href: string; text?: string }> = {}) {
  const d = r.data || {};
  const body = withSig(clean(d.draft, 8000), sig);
  const common = { id: it.id, brand: it.brand, target: it.name, route: it.route.route, today, sendFrom: it.route.route === "email" ? sendFrom : undefined };
  const ACCT = " Send ONLY if the mail account you are signed into is exactly " + sendFrom + ". If it is a different account or you cannot tell, do NOT send: call reach_flag_for_user with kind wrong_account and stop the whole run.";
  if (it.kind === "first") {
    return it.route.route === "email"
      ? { ...common, action: "send_email", to: it.route.to, subject: it.subject, htmlBody: toHtml(body, trk), body, instructions: "Send exactly this message from the user's own mail account. Do not change the wording." + LINKS + ACCT + " Then call reach_report_result with outcome \"sent\" and the subject line as evidence. Then, about a minute later, check the inbox for a bounce (see checkBounces)." }
      : { ...common, action: "submit_web_form", url: it.route.link, message: body, subject: it.subject || undefined, notes: clean(t?.data?.howToPost, 300) || undefined, instructions: "Open the page, fill the form using only this message and the brand details the user's Reach profile gives (never invent details). If the form needs a CAPTCHA, a login, a payment, or fields you cannot fill from this information, STOP and call reach_flag_for_user. After submitting, call reach_report_result with outcome \"submitted\" and the confirmation text on the page as evidence." };
  }
  if (it.kind === "reply") {
    return { ...common, action: "send_reply", to: it.route.to, subject: it.subject, htmlBody: toHtml(body, trk), body, originalSubject: it.sentSubject || it.subject, gmailThread: clean(d.gmailThread, 200) || undefined, theirLastMessage: clean(d.responseReceived, 600) || undefined, instructions: "The user read and approved THIS exact reply. First open the existing thread with this person (search the mail for their address and originalSubject) and read their newest message. If their newest message is not the one in theirLastMessage, or it raises prices, budget, a deal, terms, a contract, payment or an invoice, or asks something this reply does not answer, do NOT send: call reach_flag_for_user with kind conversation_changed and say what they wrote. Otherwise send exactly this text as a REPLY inside that thread (use the mail connector's reply, not a new message). Do not change the wording." + LINKS + ACCT + " Then call reach_report_result with outcome \"sent\", the subject line as evidence, and the text you sent as 'message'." };
  }
  const n = it.followUps + 1;
  return { ...common, action: "send_followup", to: it.route.to, followUpNumber: n, originalSubject: it.sentSubject || it.subject, ownerDraftingNotes: it.notes || undefined, firstSentOn: clean(d.sentDate, 10), gmailThread: clean(d.gmailThread, 200) || undefined, instructions: "First open the original thread. When you write the follow-up, obey every line of ownerDraftingNotes (if present); they override your default style. If the person has replied, do NOT send anything: call reach_report_result with outcome \"replied_seen\" and a short quote (use outcome \"opted_out\" with their words if they asked us to stop, said not interested, or were rude). Otherwise write and send follow-up " + n + " in the same thread. " + FOLLOWUP_RULES + " Pass the text you sent as 'message' in reach_report_result (outcome \"sent\")." + LINKS.replace("exactly as given", "with real <a href> anchors for any links") + ACCT };
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

// LinkedIn contact import: the user asks in Reach, Claude reads (read only) and hands back a list, the user accepts or declines each person in Reach.
async function getImport(client: string): Promise<any> {
  const { data } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "li_import").maybeSingle();
  return (data as any)?.data || null;
}
async function putImport(client: string, d: any) {
  await admin.from("ar_settings").upsert({ client_id: client, key: "li_import", data: d, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
}
async function liOff(client: string) {
  const { data: cur } = await admin.from("ar_settings").select("data").eq("client_id", client).eq("key", "automation").maybeSingle();
  const cd: any = Object.assign({}, (cur as any)?.data || {}); cd.li = Object.assign({}, cd.li || {}, { on: false });
  await admin.from("ar_settings").upsert({ client_id: client, key: "automation", data: cd, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
}
async function addLinkedinContacts(sc: Scope, a: any) {
  const imp = await getImport(sc.client);
  if (!imp || imp.status !== "requested") return { ok: false, error: "No LinkedIn import is waiting. Nothing was recorded." };
  const problem = clean(a.problem, 300), kind = clean(a.kind, 30);
  if (problem) {
    await putImport(sc.client, { ...imp, status: "problem", problem, problemKind: kind, doneAt: Date.now(), contacts: [] });
    if (kind === "li_identity" || kind === "li_restricted") await liOff(sc.client);
    return { ok: true, message: "Recorded. The user will see why in Alchemist Reach. Stop LinkedIn work." };
  }
  const out: any[] = []; const seen = new Set<string>();
  for (const c of (Array.isArray(a.contacts) ? a.contacts : []).slice(0, Math.max(1, Math.min(30, Number(imp.limit) || 20)))) {
    const url = clean(c?.profileUrl, 300).split("?")[0].replace(/\/+$/, "");
    const m = url.match(/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/([^\/\s]+)/i);
    const name = clean(c?.name, 120);
    if (!m || !name) continue;
    const slug = m[2].toLowerCase(); if (seen.has(slug)) continue; seen.add(slug);
    const last = c?.lastMessage && typeof c.lastMessage === "object" ? { from: clean(c.lastMessage.from, 6) === "them" ? "them" : "me", text: clean(c.lastMessage.text, 400), date: clean(c.lastMessage.date, 30) } : null;
    out.push({ name, profileUrl: "https://www.linkedin.com/in/" + m[2], slug, headline: clean(c?.headline, 220), company: clean(c?.company, 120), location: clean(c?.location, 80), about: clean(c?.about, 500), connected: c?.connected !== false, lastMessage: last && last.text ? last : null });
  }
  await putImport(sc.client, { ...imp, status: "ready", problem: "", contacts: out, doneAt: Date.now() });
  return { ok: true, message: "Recorded " + out.length + " contact(s). The user now accepts or declines each one in Alchemist Reach. Nothing was messaged. LinkedIn work for this task is finished." };
}

// ---------- LinkedIn assist: Claude only PREPARES text in LinkedIn's box; the user presses Send ----------
function liProfileOf(bd: any, ws: any) { const u = clean(bd?.linkedinUrl, 300) || clean(ws?.linkedinUrl, 300); return /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/[^\s]+/i.test(u) ? u : ""; }
function liSenderName(bd: any, ws: any) { return clean(bd?.managerName, 120) || clean(ws?.senderName, 120); }
async function liCount(client: string, since: string, actions: string[], outcomes: string[]) {
  const { count } = await admin.from("ar_agent_log").select("id", { count: "exact", head: true }).eq("client_id", client).in("action", actions).in("outcome", outcomes).gte("created_at", since);
  return count || 0;
}
async function liLast(client: string): Promise<number> {
  const { data } = await admin.from("ar_agent_log").select("created_at").eq("client_id", client).in("action", ["li_prepare", "li_reply", "li_check"]).order("created_at", { ascending: false }).limit(1);
  return data && data[0] ? new Date((data[0] as any).created_at).getTime() : 0;
}
const LI_COMMON = " LinkedIn rules: work in the user's own signed-in LinkedIn tab only, one profile at a time, at a calm human pace (pause a few seconds between steps, type the text in at normal speed, no rapid clicking). Visit nothing except what this task names. NEVER click Send, Send now, Post, or the final Connect/Send-invitation button: the user presses Send themselves. If LinkedIn shows a warning, a verification step, a CAPTCHA, a login page or any 'restricted' notice, stop everything and call reach_flag_for_user with kind li_restricted. IDENTITY CHECK FIRST: confirm the LinkedIn account you are signed into is yourProfile (compare the name and profile address under Me, or open linkedin.com/in/me/). If you cannot tell or it is a different person, do nothing and call reach_flag_for_user with kind li_identity.";
function liTask(it: Item, r: any, today: string, profile: string, sender: string) {
  const d = r.data || {};
  const common = { id: it.id, brand: it.brand, target: it.name, route: "linkedin", today, profileUrl: it.route.link, yourProfile: profile, yourName: sender || undefined };
  if (it.kind === "liprep") return { ...common, action: "linkedin_prepare", text: clean(d.draft, 3000), connectNoteLimit: 200, instructions: "Open profileUrl. If a Message button is there (you are connected), open the message box and type exactly the text, then stop with it unsent. If only Connect is available, click Connect, choose Add a note and type exactly the text ONLY if it fits the note limit shown (200 characters, or 300 if the counter allows); if it is too long or there is no note option, do not shorten it: call reach_flag_for_user with kind li_too_long. Never send an invitation without the note. Never change the wording." + LI_COMMON + " Then call reach_report_result with outcome \"prepared\" and evidence saying which box you filled and that nothing was sent." };
  if (it.kind === "lireply") return { ...common, action: "linkedin_reply_prepare", text: clean(d.draft, 3000), theirLastMessage: clean(d.responseReceived, 600) || undefined, instructions: "The user read and approved THIS reply. Open the existing conversation with this person in LinkedIn Messaging and read their newest message. If it is not the one in theirLastMessage, or it raises prices, a deal, terms, a contract or payment, do NOT prepare anything: call reach_flag_for_user with kind conversation_changed and say what they wrote. Otherwise type exactly the text into the reply box and stop with it unsent. Never change the wording." + LI_COMMON + " Then call reach_report_result with outcome \"prepared\" and evidence saying the reply box is filled and nothing was sent." };
  return { ...common, action: "linkedin_check_reply", firstSentOn: clean(d.sentDate, 10), instructions: "Read only. Open the existing LinkedIn conversation with this person (Messaging, search their name) and look for any message from THEM after " + clean(d.sentDate, 10) + ". Do not type or send anything. If they replied, call reach_report_result with outcome \"replied_seen\" and put their newest message word for word (up to 250 characters) in evidence. If there is no reply, call reach_report_result with outcome \"checked\" and evidence \"no reply yet\"." + LI_COMMON };
}
async function liQueue(sc: Scope): Promise<any | null> {
  const st = await getSettings(sc.client);
  if (!st.li.on) return null;
  const today = iso(new Date());
  const { bmap, rows, tmap } = await loadRows(sc.client, sc.brand);
  const ws = await wsOf(sc.client);
  const start = today + "T00:00:00Z";
  // a pending "import my contacts" request goes first (read only)
  { const imp = await getImport(sc.client);
    if (imp && imp.status === "requested" && st.brands[imp.brandId]) {
      const bd0 = (bmap.get(imp.brandId) || {}).data || {}; const prof0 = liProfileOf(bd0, ws);
      if (!prof0) { await putImport(sc.client, { ...imp, status: "problem", problem: "This brand has no LinkedIn profile saved yet.", doneAt: Date.now(), contacts: [] }); }
      else if (!imp.handedAt || Date.now() - Number(imp.handedAt) > 30 * 60_000) {
        await putImport(sc.client, { ...imp, handedAt: Date.now() });
        const sc0 = imp.scope || {};
        const where: string[] = []; if (sc0.threads !== false) where.push("the most recent conversations in LinkedIn Messaging"); if (sc0.connections) where.push("the most recently added connections (My Network, Connections, sorted by recently added)");
        return { ok: true, status: "task", queued: 1, minGapSeconds: 0, tasks: [{ id: "import", brand: (bmap.get(imp.brandId) || {}).name, route: "linkedin", action: "linkedin_import", yourProfile: prof0, yourName: liSenderName(bd0, ws) || undefined, limit: Math.max(1, Math.min(30, Number(imp.limit) || 20)), instructions: "READ ONLY. Collect up to limit people the user already knows on LinkedIn from: " + (where.join(" and ") || "recent conversations") + ". For each, open their profile at a calm human pace (a pause of 20 to 40 seconds between profiles; never more than limit profiles; visit nothing else) and read: full name, headline, current company, location, the first 400 characters of About, and whether you are connected. For people from Messaging also read the newest message in that conversation: who wrote it (me or them), the text (up to 300 characters, word for word) and its date. Do not type, send, accept, follow, endorse, export or download anything, and do not open conversations beyond the ones you list." + LI_COMMON + " Then call reach_add_linkedin_contacts once with every person you read (contacts: [{name, profileUrl, headline, company, location, about, connected, lastMessage: {from, text, date}}]). If you cannot confirm the account, or LinkedIn warns you, call it with problem and kind (li_identity or li_restricted) instead and an empty list." }], message: "Import task: read only. Finish it, then call reach_add_linkedin_contacts." };
      }
    } }
  const eligible: { r: any; it: Item; profile: string }[] = []; const needProfile = new Set<string>(); let queued = 0;
  for (const r of rows) {
    if (!st.brands[r.brand_id]) continue;
    const it = classify(r, tmap, bmap, today);
    if (!it || it.flag || !["liprep", "lireply", "licheck"].includes(it.kind)) continue;
    const bd = (bmap.get(r.brand_id) || {}).data || {};
    const d = r.data || {};
    if (it.kind !== "licheck" && !it.approved) continue;
    const profile = liProfileOf(bd, ws);
    if (!profile) { if (it.kind !== "licheck") needProfile.add(String((bmap.get(r.brand_id) || {}).name || "a brand")); continue; }
    if (it.kind !== "licheck" && d.liPrepared && d.liPrepared.h === replyHash(d)) continue;
    if (it.kind === "licheck" && d.liCheckedAt && Date.now() - Number(d.liCheckedAt) < 12 * 3600_000) continue;
    const claim = d.agentClaim;
    if (claim && claim.at) {
      if (Date.now() - Number(claim.at) >= 30 * 60_000) {
        const d2 = Object.assign({}, d); delete d2.agentClaim; delete d2.replyOk;
        d2.agentFlag = { kind: "no_result", reason: "The automation was given this LinkedIn task but never reported back. Check LinkedIn before doing it yourself.", at: Date.now() }; d2.updatedAt = Date.now();
        await admin.from("ar_deals").update({ data: d2 }).eq("id", r.id);
        await logIt(sc.client, r.brand_id, r.id, sc.keyId, "li_" + it.kind.slice(2), "no_result", "No result reported after being handed out");
      }
      continue;
    }
    queued++; eligible.push({ r, it, profile });
  }
  if (!eligible.length) return { ok: true, tasks: [], status: "empty", queued: 0, needProfile: [...needProfile], message: needProfile.size ? "LinkedIn is on but these brands have no LinkedIn profile saved: " + [...needProfile].join(", ") + ". Tell the user to add it in Alchemist Reach → Brand → Sender & signature." : "No LinkedIn tasks right now." };
  const prepDone = await liCount(sc.client, start, ["li_prepare", "li_reply"], ["prepared"]);
  const checkDone = await liCount(sc.client, start, ["li_check"], ["checked", "replied_seen"]);
  const since = (Date.now() - (await liLast(sc.client))) / 1000;
  // a small, steady jitter so the pace is not a perfect metronome
  const gap = Math.round(st.li.gapSec * (0.8 + ((Math.floor(Date.now() / 60000) % 9) / 9) * 0.5));
  if (since < gap) return { ok: true, tasks: [], status: "wait", waitSeconds: Math.ceil(gap - since), queued, message: queued + " LinkedIn task(s) queued. Pace yourself: ask again in " + Math.ceil(gap - since) + " seconds." };
  // prepares first (they need a human anyway), then read-only reply checks
  const preps = eligible.filter((e) => e.it.kind !== "licheck"), checks = eligible.filter((e) => e.it.kind === "licheck");
  let pick: { r: any; it: Item; profile: string } | null = null;
  if (preps.length && prepDone < st.li.dailyCap) pick = preps[0];
  else if (checks.length && checkDone < 15) pick = checks[0];
  if (!pick) return { ok: true, tasks: [], status: "daily_cap", queued, message: "LinkedIn daily limit reached (" + st.li.dailyCap + " prepared today). Stop LinkedIn work for today." };
  const { r, it, profile } = pick;
  const bd = (bmap.get(it.brandId) || {}).data || {};
  const task = liTask(it, flat(r), today, profile, liSenderName(bd, ws));
  const d3 = Object.assign({}, r.data || {}); d3.agentClaim = { at: Date.now(), kind: it.kind }; d3.updatedAt = Date.now();
  await admin.from("ar_deals").update({ data: d3 }).eq("id", r.id);
  return { ok: true, tasks: [task], status: "task", queued, remainingToday: st.li.dailyCap - prepDone, minGapSeconds: gap, message: queued + " LinkedIn task(s) queued; this is the first. The user approved it, and you only PREPARE the text: never press Send. Report the result, then ask for the next task." };
}

// an approved card that turned out to be a duplicate / protected contact: take the approval back and say why
async function holdIt(sc: Scope, r: any, it: Item) {
  const d2 = Object.assign({}, r.data || {}); delete d2.autoOk; delete d2.agentClaim;
  d2.agentFlag = { kind: "held_duplicate", reason: it.reason, at: Date.now() }; d2.dupHold = { code: it.hold?.code, level: it.hold?.level, otherId: it.hold?.other?.id, at: Date.now() }; d2.updatedAt = Date.now();
  await admin.from("ar_deals").update({ data: d2 }).eq("id", r.id);
  await logIt(sc.client, r.brand_id, r.id, sc.keyId, "first", "held_duplicate", it.reason);
}
async function agentQueue(sc: Scope) {
  const today = iso(new Date());
  const st = await getSettings(sc.client);
  if (!st.on) return { ok: true, tasks: [], status: "off", message: "Automation is switched off in Alchemist Reach. Nothing to do." };
  const anyAcct = !!(st.sendFrom && st.preflight) || Object.keys(st.accounts || {}).some((k) => st.accounts[k].preflight);
  if (!anyAcct) return { ok: true, tasks: [], status: "setup", message: "Stop. The user has not confirmed which mail account to send from. Tell them to open Alchemist Reach \u2192 Automation \u2192 \"Check first\", enter the address they send from, tick the boxes and confirm. Nothing will be sent until they do." };
  const { bmap, rows, tmap } = await loadRows(sc.client, sc.brand);
  // everything approved and due, so we can tell the user how many are lined up (tasks are still handed out one at a time)
  const eligible: { r: any; it: Item }[] = []; let heldAlready = 0; const needAcct = new Set<string>();
  for (const r of rows) {
    if (!st.brands[r.brand_id]) continue;
    const it = classify(r, tmap, bmap, today);
    applyAuto(it, st, r);
    if (it && it.hold && (r.data || {}).autoOk) { await holdIt(sc, r, it); continue; }
    if (it && it.flag && it.flag.kind === "held_duplicate" && !it.hold && it.kind !== "blocked") { const d9 = Object.assign({}, r.data || {}); d9.agentFlag = null; d9.dupHold = null; d9.updatedAt = Date.now(); await admin.from("ar_deals").update({ data: d9 }).eq("id", r.id); it.flag = null; }
    if (!it || !it.approved || it.flag) continue;
    if (it.kind !== "first" && it.kind !== "followup" && it.kind !== "reply") continue;
    if (!acctOf(st, (bmap.get(r.brand_id) || {}).data || {}, r.brand_id).ok) { needAcct.add(String((bmap.get(r.brand_id) || {}).name || "a brand")); continue; }
    const claim = (r.data || {}).agentClaim;
    if (claim && claim.at) {
      if (Date.now() - Number(claim.at) >= 30 * 60_000) {
        const d2 = Object.assign({}, r.data || {}); delete d2.agentClaim; delete d2.replyOk;
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
  if (!queued && needAcct.size) return { ok: true, tasks: [], status: "setup", message: "Stop. These brands have no confirmed mail account yet: " + [...needAcct].join(", ") + ". Tell the user to confirm each one in Alchemist Reach \u2192 Automation \u2192 Right accounts. Nothing will be sent for them until they do." };
  if (!queued) return { ok: true, tasks: [], status: "empty", queued: 0, remainingToday: st.dailyCap - done, minGapSeconds: st.gapSec, message: heldAlready ? "Nothing new to hand out. " + heldAlready + " task(s) were already handed out and are waiting for a result." : "Nothing approved and due right now." };
  const ws = await wsOf(sc.client);
  // skip (and permanently block) any address whose domain doesn't exist or can't take mail
  let pick: { r: any; it: Item; tm?: Map<string, any> } | null = null;
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
    // last look, right before handing it out: a duplicate created since approval is caught here
    const fresh = await loadRows(sc.client, null);
    const fr = fresh.rows.find((x: any) => x.id === e.r.id);
    const it2 = fr ? classify(fr, fresh.tmap, fresh.bmap, today) : null;
    if (it2) applyAuto(it2, st, fr);
    if (!fr || !it2 || !it2.approved || it2.flag || (it2.kind !== "first" && it2.kind !== "followup" && it2.kind !== "reply")) { if (fr && it2 && it2.hold) await holdIt(sc, fr, it2); continue; }
    pick = { r: fr, it: it2, tm: fresh.tmap }; break;
  }
  if (!pick) return { ok: true, tasks: [], status: "empty", queued: 0, message: "Every queued address had a domain that can't receive email, so they were skipped and flagged for the user." };
  const { r, it } = pick;
  const trk = it.kind === "first" && it.route.route === "email" ? await trackLinks(sc.client, it.brand, it.id, clean(flat(r).data?.draft, 8000)) : {};
  const bd = (bmap.get(it.brandId) || {}).data || {};
  const task = taskOf(it, flat(r), (pick.tm || tmap).get(r.target_id), sigFor(ws, bd), today, acctOf(st, bd, it.brandId).addr, trk);
  const d3 = Object.assign({}, r.data || {}); d3.agentClaim = { at: Date.now(), kind: it.kind }; d3.updatedAt = Date.now();
  await admin.from("ar_deals").update({ data: d3 }).eq("id", r.id);
  const left = queued - 1;
  const cb: any[] = [];
  for (const row of rows) { const f = flat(row), dd = f.data || {}; if (dd.autoSentBy === "agent" && dd.sentVia === "email" && !dd.bounced && dd.lastSentDate && (dd.lastSentDate === today || dd.lastSentDate === addDays(today, -1))) { const tt = tmap.get(row.target_id) || {}; const em = firstEmail(tt.contact_email || row.contact_email || dd.contactEmail); if (em) cb.push({ id: row.id, to: em }); } }
  return { ok: true, tasks: [task], checkBounces: cb.length ? cb.slice(0, 20) : undefined, status: "task", queued, remainingToday: st.dailyCap - done, minGapSeconds: st.gapSec, message: queued + " approved message" + (queued === 1 ? "" : "s") + " queued; this is the first. The user already approved this exact message in Alchemist Reach, so send it without asking them again. Then report the result" + (left ? ", wait about " + st.gapSec + " seconds, and ask again for the next (" + left + " more after this one)." : ". It is the last one.") };
}

function d0reason(raw: any) { return !!(raw.data && raw.data.doNotContact); }
async function applyOptOut(client: string, rows: any[], tmap: Map<string, any>, raw: any, quote: string, by: string) {
  const d0 = raw.data || {};
  const em = firstEmail((tmap.get(raw.target_id) || {}).contact_email || raw.contact_email || d0.contactEmail).toLowerCase();
  const hostile = HOSTILE_RX.test(quote);
  const stamp = { at: Date.now(), by, reason: clean(quote || "Asked not to be contacted", 260), email: em || undefined };
  const targets = rows.filter((r: any) => r.id === raw.id || (em && firstEmail((tmap.get(r.target_id) || {}).contact_email || r.contact_email || r.data?.contactEmail).toLowerCase() === em));
  for (const r of targets) {
    const d = Object.assign({}, r.data || {});
    d.doNotContact = stamp; d.followUpDue = ""; d.draft = ""; d.draftKind = ""; d.draftState = ""; d.suggest = null; d.agentFlag = null;
    delete d.autoOk; delete d.replyOk; delete d.agentClaim;
    d.nextAction = "Do not send. They asked us to stop."; d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", r.id);
  }
  if (em) {
    // blocked for every brand of this workspace. A real opt-out reply (not the user's own switch) also joins the shared list.
    const cur = await loadWsDnc(client); cur.emails.add(em);
    await admin.from("ar_settings").upsert({ client_id: client, key: "dnc", data: { emails: [...cur.emails], domains: [...cur.domains], updatedAt: Date.now() }, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
    if (by === "agent") await addBad(em, "email", "Opted out: " + clean(quote, 150), client);
    const dom = em.split("@")[1] || "";
    // a rude reply puts a HOLD on the company (anyone else there needs your yes); it does not block them
    if (hostile && by === "agent" && dom && !FREEMAIL.test(dom)) await addBad(dom, "domain", "Opted out (rude reply): " + clean(quote, 130), client);
  }
  return { em, hostile, cards: targets.length };
}

async function logIt(client: string, brand: string | null, deal: string | null, key: string | null, action: string, outcome: string, detail: string) {
  await admin.from("ar_agent_log").insert({ client_id: client, brand_id: brand, deal_id: deal, key_id: key, action, outcome, detail: clean(detail, 400) });
}

async function agentResult(sc: Scope, a: any) {
  const id = String(a.id || ""), outcome = String(a.outcome || "");
  if (id === "import") return await addLinkedinContacts(sc, { problem: clean(a.reason, 300) || "Claude could not finish the import.", kind: clean(a.kind, 30) });
  if (!["sent", "submitted", "needs_user", "failed", "replied_seen", "not_free", "bounced", "prepared", "checked", "opted_out"].includes(outcome)) return { ok: false, error: "outcome must be sent, submitted, prepared, checked, needs_user, failed, replied_seen, not_free, bounced or opted_out" };
  const today = iso(new Date());
  const { bmap, rows, tmap, all } = await loadRows(sc.client, sc.brand);
  const raw = rows.find((r: any) => r.id === id);
  if (!raw) return { ok: false, error: "That row isn't in this workspace." };
  const it = classify(raw, tmap, bmap, today, { skipChecks: true }); // it was already checked when it was handed out
  const d = Object.assign({}, raw.data || {}); delete d.agentClaim;
  const evidence = clean(a.evidence, 300), reason = clean(a.reason, 300);

  if (outcome === "bounced") {
    // the email never arrived: block the address (and the domain if it doesn't exist) for EVERY user, clear the sent state, tell the user
    const t = tmap.get(raw.target_id) || {};
    const em = firstEmail(t.contact_email || raw.contact_email || raw.data?.contactEmail).toLowerCase();
    const why = clean(reason || evidence, 200) || "Bounced";
    if (em) await addBad(em, "email", why, sc.client);
    const domGone = a.kind === "domain" || /domain\b[^.]{0,60}(couldn.?t be found|not found|does not exist|doesn'?t exist)|dns (error|failure)|no such host|nxdomain|no mx/i.test(why);
    // the whole domain is blocked only when DNS agrees it cannot receive mail (never a free-mail domain); otherwise just this mailbox
    if (em && domGone) { const dom0 = em.split("@")[1]; if (dom0 && !FREEMAIL.test(dom0) && !(await domainReceivesMail(dom0))) await addBad(dom0, "domain", why, sc.client); }
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
  if (outcome === "prepared" || outcome === "checked") {
    const liK = it?.kind;
    if (!it || !["liprep", "lireply", "licheck"].includes(liK as string)) return { ok: false, error: "This row isn't a LinkedIn task, so nothing was recorded." };
    if (outcome === "prepared") {
      if (liK === "licheck" || !it.approved) return { ok: false, error: "This LinkedIn message isn't approved, so nothing was recorded." };
      if (evidence.length < 6) return { ok: false, error: "Give a short note in 'evidence' saying which box was filled and that nothing was sent." };
      d.liPrepared = { at: Date.now(), h: replyHash(d), kind: liK }; d.agentFlag = null; d.updatedAt = Date.now();
      d.nextAction = "Your text is in the LinkedIn box. Press Send there, then mark Sent here.";
      await admin.from("ar_deals").update({ data: d }).eq("id", id);
      await logIt(sc.client, raw.brand_id, id, sc.keyId, liK === "lireply" ? "li_reply" : "li_prepare", "prepared", evidence);
      return { ok: true, message: "Recorded as prepared. The user presses Send. Wait for the pause, then ask for the next task." };
    }
    if (liK !== "licheck") return { ok: false, error: "'checked' is only for reply checks." };
    d.liCheckedAt = Date.now(); d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id);
    await logIt(sc.client, raw.brand_id, id, sc.keyId, "li_check", "checked", evidence || "no reply yet");
    return { ok: true, message: "Recorded. Ask for the next task." };
  }
  if (outcome === "needs_user" || outcome === "failed") {
    if (it?.kind === "reply" || it?.kind === "lireply") delete d.replyOk;
    if (it && ["liprep", "lireply", "licheck"].includes(it.kind) && ["li_restricted", "li_identity"].includes(clean(a.kind, 30))) {
      const { data: cur } = await admin.from("ar_settings").select("data").eq("client_id", sc.client).eq("key", "automation").maybeSingle();
      const cd: any = Object.assign({}, (cur as any)?.data || {}); cd.li = Object.assign({}, cd.li || {}, { on: false });
      await admin.from("ar_settings").upsert({ client_id: sc.client, key: "automation", data: cd, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
    }
    d.agentFlag = { kind: clean(a.kind, 30) || (outcome === "failed" ? "failed" : "other"), reason: reason || (outcome === "failed" ? "The agent couldn't finish this one." : "Needs you."), at: Date.now() };
    d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id);
    await logIt(sc.client, raw.brand_id, id, sc.keyId, it?.kind || "unknown", outcome, d.agentFlag.reason);
    if (d.agentFlag.kind === "wrong_account") {
      delete d.autoOk; delete d.replyOk; await admin.from("ar_deals").update({ data: d }).eq("id", id);
      const { data: cur } = await admin.from("ar_settings").select("data").eq("client_id", sc.client).eq("key", "automation").maybeSingle();
      await admin.from("ar_settings").upsert({ client_id: sc.client, key: "automation", data: unconfirm((cur as any)?.data || {}, raw.brand_id), updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
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
  if (outcome === "opted_out" || (outcome === "replied_seen" && OPT_RX.test(String(evidence || "") + " " + String(a.reason || "")))) {
    const q = clean(evidence || a.reason || "Asked not to be contacted", 260);
    const r2 = await applyOptOut(sc.client, all, tmap, raw, q, "agent");
    await logIt(sc.client, raw.brand_id, id, sc.keyId, "optout", "opted_out", q);
    return { ok: true, message: "Recorded as Do not send" + (r2.cards > 1 ? " on " + r2.cards + " cards" : "") + ". That address is blocked for every brand" + (r2.hostile ? " and the company is on hold for a yes" : "") + ". Send nothing more to them and do NOT reply. Move on to the next task." };
  }
  if (outcome === "replied_seen") {
    d.suggest = { type: "replied", date: today, evidence: ("“" + (evidence || "reply found in thread") + "”").slice(0, 260), via: "agent", at: Date.now() };
    if (it?.kind === "licheck") d.liCheckedAt = Date.now();
    d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id);
    await logIt(sc.client, raw.brand_id, id, sc.keyId, it?.kind === "licheck" ? "li_check" : "followup", "replied_seen", evidence);
    return { ok: true, message: "Recorded as a suggestion for the user to review. No follow-up sent." };
  }
  // sent / submitted — re-check it was really queueable (approved, brand on, not flagged, in range)
  const st = await getSettings(sc.client);
  applyAuto(it, st, raw);
  if (!st.on || !st.brands[raw.brand_id]) return { ok: false, error: "Automation is off for this brand." };
  if (!it || !it.approved || it.flag || (it.kind !== "first" && it.kind !== "followup" && it.kind !== "reply")) return { ok: false, error: "This row isn't approved and due, so nothing was recorded." };
  if (evidence.length < 6) return { ok: false, error: "Give proof in 'evidence' (the subject line sent, or the form's confirmation text)." };
  if ((await todayCount(sc.client)) >= st.dailyCap) return { ok: false, error: "Daily limit reached." };
  const via = it.route.route === "form" ? "form" : "email";
  const first = clean(d.sentDate, 10) || today;
  let status = raw.outreach_status;
  if (it.kind === "first") {
    d.sentDate = first; d.lastSentDate = today; d.sentVia = via; d.followUps = Number(d.followUps) || 0;
    d.followUpDue = via === "email" ? addDays(today, FU1_DAYS) : "";
    if (raw.deal_type === "lead" || d.dealType === "lead") d.dealStage = "Contacted"; else { d.outreachStatus = "Sent - Awaiting Reply"; status = "Sent - Awaiting Reply"; }
  } else if (it.kind === "reply") {
    const sentBody = clean(d.draft, 8000);
    if (sentBody) { const log = (Array.isArray(d.sentLog) ? d.sentLog : []).slice(); log.push({ date: today, subject: clean(d.subject, 200), body: sentBody, kind: "reply" }); d.sentLog = log.slice(-6); }
    d.lastSentDate = today; d.sentVia = "email"; d.draft = ""; d.draftKind = ""; d.draftState = ""; d.fuv = 1; delete d.replyOk;
    d.nextAction = "Reply sent. Waiting for their answer.";
  } else {
    const n = it.followUps + 1;
    d.lastSentDate = today; d.followUps = n; d.sentVia = "email";
    d.followUpDue = n < maxFu(d) ? addDays(today, FU2_DAYS - FU1_DAYS) : "";
    if (n >= maxFu(d)) d.nextAction = "Stop — follow-up sent; close out if no reply";
  }
  d.suggest = null; d.reviewState = ""; d.draftState = ""; d.agentFlag = null; d.autoSentBy = "agent"; d.updatedAt = Date.now();
  await admin.from("ar_deals").update({ data: d, outreach_status: status }).eq("id", id);
  const summary = (it.kind === "followup" ? "Follow-up " + d.followUps + ": " : it.kind === "reply" ? "Reply: " : "") + (clean(a.message, 160) || it.subject || "Message") + " (sent by agent)";
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
  "never message people on social networks, communities, forums or DMs yourself: the only exception is a LinkedIn task (linkedin_prepare, linkedin_reply_prepare, linkedin_check_reply), where you may only PREPARE text in LinkedIn's box or READ a conversation, never press Send, and must first confirm you are signed into the LinkedIn account named in yourProfile; everything else social is never queued — the user does it by hand; " +
  "REPLIES: a send_reply task is a reply the user read and approved. Send it as a reply inside the existing thread, only after checking their newest message as the task says. Never write or edit a reply yourself, and never answer anything about prices, a deal, terms, a contract or payment: flag those with reach_flag_for_user kind conversation_changed. " +
  "do not retry a failed task more than once; one task at a time with natural pauses. " +
  "LINKS: send emails with htmlBody only (use the htmlBody the task gives; for follow-ups write real <a href=\"https://…\"> anchors); never put a bare web address in a plain body, the mail connector turns it into a google.com redirect. " +
  "ACCOUNT CHECK: every email task names sendFrom. Before the first send, and whenever unsure, confirm the mail account you are signed into is exactly that address; if not, send nothing and call reach_flag_for_user with kind wrong_account. " +
  "BOUNCES: after each email send, and whenever get_next_task returns checkBounces, look in the inbox for delivery-failure notices (from:mailer-daemon, subject 'Delivery Status Notification'). If one names an address you emailed, call reach_report_result with outcome bounced, the task id, and the reason in plain words. Never resend to a bounced address. OPT-OUTS: in the same inbox check, also look for REAL replies (not out-of-office or auto-replies) from the addresses you emailed. If a person asks to stop, unsubscribe, be removed, says they are not interested, or answers rudely, call reach_report_result with outcome opted_out, the task id, and their exact words in evidence. Never reply to them and never write to them again.";
const TOOLS = [
  { name: "reach_get_next_task", description: "Get the next approved, due outreach task (send an email, submit a web form, send a follow-up, or send an approved reply, or prepare / check a LinkedIn message). Returns nothing if automation is off, the daily limit is reached, or you must wait.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "reach_report_result", description: "Report what happened with a task. outcome: sent (email, follow-up or reply sent), prepared (LinkedIn text is in the box, NOT sent), checked (LinkedIn: no reply yet), submitted (web form submitted), replied_seen (they already replied — nothing sent), not_free (the place charges money — nothing submitted; put the price in 'cost' and the page's wording in 'evidence'), failed, needs_user, opted_out (they asked us to stop, said not interested, or replied rudely: put their exact words in evidence; they are never contacted again and nothing is sent back), bounced (the email came back undeliverable — put the bounce reason in 'reason'; the address is then blocked for all users). Include proof in 'evidence' (subject line sent, or the form's confirmation text). For follow-ups also include the text you sent as 'message'.", inputSchema: { type: "object", properties: { id: { type: "string" }, outcome: { type: "string", enum: ["sent", "submitted", "replied_seen", "not_free", "failed", "needs_user", "bounced", "opted_out"] }, evidence: { type: "string" }, cost: { type: "string" }, message: { type: "string" }, reason: { type: "string" } }, required: ["id", "outcome"], additionalProperties: false } },
  { name: "reach_add_linkedin_contacts", description: "Finish a linkedin_import task (read only). Pass contacts: the people you read, each with name, profileUrl (linkedin.com/in/...), headline, company, location, about, connected (true/false) and, if you read a conversation, lastMessage {from: me|them, text, date}. If you could not confirm the LinkedIn account or LinkedIn warned you, pass problem (plain words) and kind (li_identity or li_restricted) with an empty list. Nothing is messaged: the user accepts or declines each person in Alchemist Reach.", inputSchema: { type: "object", properties: { contacts: { type: "array", items: { type: "object" } }, problem: { type: "string" }, kind: { type: "string" } }, additionalProperties: false } },
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
    if (name === "reach_get_next_task") {
      const li = await liQueue(sc);
      if (li && li.tasks.length) out = li;
      else { out = await agentQueue(sc); if (li && li.status === "wait" && (!out.tasks || !out.tasks.length) && out.status === "empty") out = li; }
    }
    else if (name === "reach_report_result") out = await agentResult(sc, a);
    else if (name === "reach_add_linkedin_contacts") out = await addLinkedinContacts(sc, a);
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
  const wsA = await wsOf(client);
  const liNeed = new Set<string>();
  for (const r of rows) {
    const it = classify(r, tmap, bmap, today); applyAuto(it, st, r);
    if (!it) continue;
    if (it.kind === "licheck") continue;
    if (it.kind === "liprep" || it.kind === "lireply") {
      if (!st.li.on) { it.kind = "manual"; it.reason = "LinkedIn assist is off. You do this one yourself."; }
      else if (!liProfileOf((bmap.get(r.brand_id) || {}).data || {}, wsA)) liNeed.add(it.id);
    }
    items.push(it);
  }
  // where everything sits on the way to Automation (all brands)
  const pipe = { proposed: 0, review: 0, ready: 0, waiting: 0 };
  for (const r of rows) { const f = flat(r), d = f.data || {}, ph = phaseOf(f); if (d.reviewState === "proposed") { pipe.proposed++; continue; } if (ph === "research" && clean(d.draft, 20)) pipe.review++; else if (ph === "ready") pipe.ready++; else if (ph === "sent") pipe.waiting++; }
  const rowsById = new Map<string, any>(); rows.forEach((r: any) => rowsById.set(r.id, r));
  const pub = (it: Item) => ({ id: it.id, brandId: it.brandId, brand: it.brand, name: it.name, kind: it.kind, route: it.route.route, to: it.route.to || undefined, link: it.route.link || undefined, subject: it.subject, approved: it.approved, flag: it.flag, reason: it.reason, hold: it.hold || undefined, lint: it.lint || undefined, due: it.dueDate || undefined, sent: it.sent || undefined, lastSent: it.lastSent || undefined, via: it.via || undefined, followUps: it.followUps, draft: (it.kind === "reply" || it.kind === "lireply" || it.kind === "liprep") ? clean((rowsById.get(it.id) || {}).data?.draft, 1500) : undefined, theirs: (it.kind === "reply" || it.kind === "lireply") ? clean((rowsById.get(it.id) || {}).data?.responseReceived, 500) : undefined, needProfile: liNeed.has(it.id) || undefined, prepared: (it.kind === "liprep" || it.kind === "lireply") && (rowsById.get(it.id) || {}).data?.liPrepared?.h === replyHash((rowsById.get(it.id) || {}).data || {}) ? true : undefined });
  const { data: keys } = await admin.from("ar_agent_keys").select("id,brand_id,label,key_prefix,created_at,last_used_at").eq("client_id", client).is("revoked_at", null).order("created_at", { ascending: false });
  const { data: log } = await admin.from("ar_agent_log").select("deal_id,action,outcome,detail,created_at").eq("client_id", client).order("created_at", { ascending: false }).limit(15);
  const names = new Map<string, string>(); rows.forEach((r: any) => names.set(r.id, clean((tmap.get(r.target_id) || {}).name || r.target_name, 80)));
  return {
    ok: true, settings: st, pipe, today, doneToday: await todayCount(client), liImport: await getImport(client),
    brands: [...bmap.values()].map((b: any) => ({ id: b.id, name: b.name, on: !!st.brands[b.id], li: liProfileOf(b.data || {}, wsA) || undefined })),
    ready: items.filter((i) => !i.flag && (i.kind === "first" || i.kind === "followup" || i.kind === "reply" || i.kind === "liprep" || i.kind === "lireply")).map(pub),
    manual: items.filter((i) => i.kind === "manual").map(pub),
    blocked: items.filter((i) => i.kind === "blocked" && !i.hold).map(pub),
    held: items.filter((i) => i.hold).map(pub),
    needsYou: items.filter((i) => i.flag && !i.hold).map(pub),
    dnc: await (async () => { const w = await loadWsDnc(client); return { emails: [...w.emails].slice(0, 200), domains: [...w.domains].slice(0, 200) }; })(),
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
    const accounts: Record<string, { sendFrom: string; preflight: boolean }> = {};
    Object.keys(body.accounts || {}).forEach((k) => { if (!mine.has(k)) return; const a = body.accounts[k] || {}; const f = String(a.sendFrom || "").trim().toLowerCase(); if (EMAIL.test(f)) accounts[k] = { sendFrom: f, preflight: a.preflight === true }; });
    const data = { on: body.on === true, autoReady: body.autoReady === true, autoFu: body.autoFu === true, sendFrom: EMAIL.test(sf) ? sf : "", preflight: body.preflight === true && EMAIL.test(sf), brands, accounts, dailyCap: Math.max(1, Math.min(40, Number(body.dailyCap) || 15)), gapSec: Math.max(30, Math.min(900, Number(body.gapSec) || 120)), li: { on: body.li && body.li.on === true, dailyCap: Math.max(1, Math.min(25, Number(body.li && body.li.dailyCap) || 10)), gapSec: Math.max(120, Math.min(1800, Number(body.li && body.li.gapSec) || 240)) } };
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
      if (on && (!it || !["first", "followup", "reply", "liprep", "lireply"].includes(it.kind))) { skipped.push({ id, why: it?.reason || "Not ready to send" }); continue; }
      const d = Object.assign({}, raw.data || {});
      if (on && it && (it.kind === "liprep" || it.kind === "lireply")) { if (!stA.li.on) { skipped.push({ id, why: "LinkedIn assist is off." }); continue; } if (!liProfileOf((bmap.get(raw.brand_id) || {}).data || {}, await wsOf(client))) { skipped.push({ id, why: "Add this brand's LinkedIn profile first." }); continue; } }
      if (it?.kind === "lireply") { if (on) { d.replyOk = { h: replyHash(d), at: Date.now(), by: u.uid }; delete d.autoHold; } else delete d.replyOk; d.updatedAt = Date.now(); await admin.from("ar_deals").update({ data: d }).eq("id", id); changed++; continue; }
      if (it?.kind === "reply") { if (on) { d.replyOk = { h: replyHash(d), at: Date.now(), by: u.uid }; delete d.autoHold; } else delete d.replyOk; d.updatedAt = Date.now(); await admin.from("ar_deals").update({ data: d }).eq("id", id); changed++; continue; }
      if (on) { d.autoOk = { at: Date.now(), by: u.uid }; delete d.autoHold; } else { delete d.autoOk; if (wasApproved || it?.approved) d.autoHold = true; } d.updatedAt = Date.now();
      await admin.from("ar_deals").update({ data: d }).eq("id", id); changed++;
    }
    return { ok: true, changed, skipped };
  }
  if (action === "li_import_request") {
    const st = await getSettings(client);
    const brandId = String(body.brandId || "");
    const { bmap } = await loadRows(client, null); const bd = (bmap.get(brandId) || {}).data;
    if (!bd) return { ok: false, error: "Brand not found." };
    if (!st.li.on) return { ok: false, error: "Turn LinkedIn assist on first." };
    if (!st.brands[brandId]) return { ok: false, error: "Tick this brand under Brands and limits first." };
    if (!liProfileOf(bd, await wsOf(client))) return { ok: false, error: "Add this brand's LinkedIn profile first (Brand, Sender & signature)." };
    const scope = { threads: body.threads !== false, connections: body.connections === true };
    if (!scope.threads && !scope.connections) return { ok: false, error: "Pick conversations, connections, or both." };
    await putImport(client, { status: "requested", brandId, scope, limit: Math.max(5, Math.min(30, Number(body.limit) || 20)), requestedAt: Date.now(), contacts: [], problem: "" });
    return { ok: true };
  }
  if (action === "li_import_clear") { await admin.from("ar_settings").delete().eq("client_id", client).eq("key", "li_import"); return { ok: true }; }
  if (action === "opt_out") {
    const id = String(body.id || "");
    const { bmap, rows, tmap } = await loadRows(client, null); const raw = rows.find((r: any) => r.id === id);
    if (!raw || !bmap.has(raw.brand_id)) return { ok: false, error: "Not found" };
    if (body.on === false) {
      const d = Object.assign({}, raw.data || {}); const em = String(d.doNotContact?.email || "").toLowerCase(); d.doNotContact = null; d.updatedAt = Date.now();
      await admin.from("ar_deals").update({ data: d }).eq("id", id);
      if (em && d0reason(raw)) { await admin.from("ar_bad_contacts").delete().eq("value", em).like("reason", "Opted out%"); }
      if (em) { const cur = await loadWsDnc(client); cur.emails.delete(em); await admin.from("ar_settings").upsert({ client_id: client, key: "dnc", data: { emails: [...cur.emails], domains: [...cur.domains], updatedAt: Date.now() }, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" }); }
      return { ok: true };
    }
    const r2 = await applyOptOut(client, rows, tmap, raw, clean(body.reason, 260) || "Marked Do not send by you", "user");
    return { ok: true, cards: r2.cards };
  }
  if (action === "clear_flag") {
    const id = String(body.id || "");
    const { bmap, rows } = await loadRows(client, null); const raw = rows.find((r: any) => r.id === id);
    if (!raw || !bmap.has(raw.brand_id)) return { ok: false, error: "Not found" };
    const d = Object.assign({}, raw.data || {}); d.agentFlag = null; if (body.keepApproval !== true) delete d.autoOk; d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id); return { ok: true };
  }
  if (action === "contact_history") {
    const L = await loadRows(client, null); const idx: Idx = (L.tmap as any).IDX;
    let em = String(body.email || "").trim().toLowerCase(), lk = "", dom = "";
    if (!em && body.id) { const me = idx.rows.find((x) => x.id === String(body.id)); if (me) { em = me.email; lk = me.lk; dom = me.dom; } }
    else if (em) dom = domFor(em, "");
    if (!em && !lk) return { ok: false, error: "No contact to look up." };
    const mine = idx.rows.filter((o) => (em && o.email === em) || (lk && o.lk === lk));
    const company = dom ? idx.rows.filter((o) => o.dom === dom && !mine.includes(o)) : [];
    const pr = (o: CRow) => ({ id: o.id, brandId: o.brandId, brand: o.brand, name: o.name, email: o.email, channel: o.channel, phase: o.ph, sent: o.sent || undefined, lastSent: o.lastSent || undefined, replied: o.replied, bounced: o.bounced, dnc: o.dnc });
    return { ok: true, email: em, domain: dom || undefined, dnc: { email: !!em && idx.dncEmails.has(em), domain: !!dom && idx.dncDomains.has(dom) }, bounced: !!em && (isBad(em) || mine.some((o) => o.bounced)), rows: mine.map(pr), company: company.map(pr) };
  }
  if (action === "dnc_set") {
    const value = String(body.value || "").trim().toLowerCase(), kind = body.kind === "domain" ? "domain" : "email", on = body.on !== false;
    if (kind === "email" && !EMAIL.test(value)) return { ok: false, error: "That is not an email address." };
    if (kind === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return { ok: false, error: "That is not a domain." };
    if (kind === "domain" && FREEMAIL.test(value)) return { ok: false, error: "A free-mail domain (like gmail.com) can't be blocked as a whole. Block the address instead." };
    const cur = await loadWsDnc(client); const set = kind === "email" ? cur.emails : cur.domains; if (on) set.add(value); else set.delete(value);
    await admin.from("ar_settings").upsert({ client_id: client, key: "dnc", data: { emails: [...cur.emails], domains: [...cur.domains], updatedAt: Date.now() }, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
    let cards = 0;
    if (kind === "email") {
      const L = await loadRows(client, null);
      const em = (r: any) => firstEmail((L.tmap.get(r.target_id) || {}).contact_email || r.contact_email || r.data?.contactEmail || r.data?.bounced?.email).toLowerCase();
      if (on) { const raw = L.all.find((r: any) => em(r) === value); if (raw) cards = (await applyOptOut(client, L.all, L.tmap, raw, clean(body.reason, 260) || "Marked Do not contact by you", "user")).cards; }
      else for (const r of L.all) { if (em(r) === value && r.data?.doNotContact && r.data.doNotContact.by === "user") { const d = Object.assign({}, r.data); d.doNotContact = null; d.updatedAt = Date.now(); await admin.from("ar_deals").update({ data: d }).eq("id", r.id); cards++; } }
    }
    return { ok: true, cards };
  }
  if (action === "form_info_ok") {
    const id = String(body.id || ""); const L = await loadRows(client, null); const raw = L.rows.find((r: any) => r.id === id);
    if (!raw) return { ok: false, error: "Not found" };
    const d = Object.assign({}, raw.data || {}); d.formInfoOk = { at: Date.now(), by: u.uid }; d.updatedAt = Date.now();
    await admin.from("ar_deals").update({ data: d }).eq("id", id); return { ok: true };
  }
  if (action === "dup_release") {
    const id = String(body.id || ""), decision = String(body.decision || "");
    const L = await loadRows(client, null); const raw = L.all.find((r: any) => r.id === id);
    if (!raw) return { ok: false, error: "Not found" };
    const idx: Idx = (L.tmap as any).IDX; const t = L.tmap.get(raw.target_id) || {};
    const dup = dupCheck(flat(raw), routeOf(raw, t, L.bmap.get(raw.brand_id) || {}), idx, "first");
    const d = Object.assign({}, raw.data || {});
    if (decision === "no") {
      const lead = raw.deal_type === "lead" || d.dealType === "lead";
      d.dealStage = lead ? "Lost" : "Do Not Pursue"; d.followUpDue = ""; d.agentFlag = null; delete d.autoOk;
      d.dupSkip = { at: Date.now(), by: u.uid, reason: dup?.reason || "" }; d.nextAction = "Skipped" + (dup?.other ? " \u2014 already reached via " + dup.other.brand : "") + "."; d.updatedAt = Date.now();
      await admin.from("ar_deals").update({ data: d }).eq("id", id); return { ok: true, patch: { dealStage: d.dealStage, followUpDue: "", agentFlag: null, autoOk: false, dupSkip: d.dupSkip, nextAction: d.nextAction } };
    }
    if (!dup) { d.agentFlag = null; d.dupHold = null; d.updatedAt = Date.now(); await admin.from("ar_deals").update({ data: d }).eq("id", id); return { ok: true, message: "Nothing is holding this card any more." }; }
    if (decision === "yes") {
      if (dup.level === "block") return { ok: false, error: dup.code === "ongoing" ? "That person is already in a conversation. Use \"Add as a note\" instead." : "This contact is blocked and can't be released." };
      const keys = (d.dupOk && Array.isArray(d.dupOk.keys) ? d.dupOk.keys : []).concat(dup.key ? [dup.key] : []);
      d.dupOk = { keys, at: Date.now(), by: u.uid }; d.agentFlag = null; d.dupHold = null; d.updatedAt = Date.now();
      await admin.from("ar_deals").update({ data: d }).eq("id", id); return { ok: true, patch: { dupOk: d.dupOk, agentFlag: null, dupHold: null } };
    }
    if (decision === "note") {
      if (dup.code !== "ongoing" || !dup.other) return { ok: false, error: "A note can only be added to a conversation that is already going." };
      const other = L.all.find((r: any) => r.id === dup.other!.id); if (!other) return { ok: false, error: "The original conversation was not found." };
      const bn = clean(idx.rows.find((x) => x.id === id)?.brand, 80) || "my other brand";
      const od = Object.assign({}, other.data || {});
      od.draft = "One more thing, unrelated to the above: I also look after " + bn + ". If it could ever be useful to you I'm glad to send a link. No need to reply."; od.draftKind = "reply"; od.draftState = ""; delete od.replyOk;
      if (!od.subject) od.subject = od.sentSubject ? (/^re:/i.test(od.sentSubject) ? od.sentSubject : "Re: " + od.sentSubject) : "";
      od.nextAction = "Review the short note about " + bn + " and approve it."; od.updatedAt = Date.now();
      await admin.from("ar_deals").update({ data: od }).eq("id", other.id);
      const lead = raw.deal_type === "lead" || d.dealType === "lead";
      d.dealStage = lead ? "Lost" : "Do Not Pursue"; d.agentFlag = null; delete d.autoOk; d.dupSkip = { at: Date.now(), by: u.uid, reason: "Merged into the existing conversation" }; d.nextAction = "Handled as a note in the existing conversation with " + dup.other.brand + "."; d.updatedAt = Date.now();
      await admin.from("ar_deals").update({ data: d }).eq("id", id);
      return { ok: true, message: "A short note is ready to review in the existing conversation.", patch: { dealStage: d.dealStage, agentFlag: null, autoOk: false, dupSkip: d.dupSkip, nextAction: d.nextAction }, other: { id: other.id, patch: { draft: od.draft, draftKind: "reply", draftState: "", subject: od.subject, replyOk: null, nextAction: od.nextAction } } };
    }
    return { ok: false, error: "Choose yes, no or note." };
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

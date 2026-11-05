// reach-inbox — lets a user's OWN mailbox script (Google Apps Script) report replies / sends / bounces to Alchemist Reach.
// Deploy with verify_jwt=false: auth is done inside (user JWT for key management, x-reach-key for the script).
// The script only ever sends what it found for the contacts we listed for it; Reach never gets mailbox access.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-reach-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function newKey() {
  const a = crypto.getRandomValues(new Uint8Array(32));
  let s = ""; a.forEach((x) => (s += String.fromCharCode(x)));
  return "rik_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

// mirrors phaseOf() in reach/index.html (coverage + lead pipelines)
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
  if (o === "Do Not Send / Merged") return "dnc";
  if (o === "Declined" || o === "Bounced" || o === "Completed") return "closed";
  if (s === "Negotiating") return "deal";
  if (o === "Replied / In Discussion") return "replied";
  if (r.replied_date && (o === "Sent - Awaiting Reply" || o === "Other Outreach (DM/Self-Post)")) return "replied";
  if (o === "Sent - Awaiting Reply" || o === "Other Outreach (DM/Self-Post)") return "sent";
  if (o.toLowerCase() === "ready to send") return "ready";
  return "research";
}
function firstEmail(e: string | null) { return String(e || "").split(/[;, ]/)[0].trim(); }

type Scope = { keyId: string; client: string; brand: string | null };

async function keyScope(req: Request): Promise<Scope | null> {
  const k = req.headers.get("x-reach-key") || "";
  if (!k.startsWith("rik_") || k.length < 30 || k.length > 80) return null;
  const { data } = await admin.from("ar_inbox_keys").select("id,client_id,brand_id,revoked_at").eq("key_hash", await sha256(k)).maybeSingle();
  if (!data || data.revoked_at) return null;
  return { keyId: data.id, client: data.client_id, brand: data.brand_id };
}

async function userCtx(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const sb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser(auth.slice(7));
  if (!u?.user) return null;
  const [{ data: client }, { data: isAdmin }] = await Promise.all([sb.rpc("ar_my_client"), sb.rpc("ar_is_admin")]);
  return { uid: u.user.id, client: client as string | null, isAdmin: !!isAdmin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const raw = await req.text();
  if (raw.length > 900_000) return J({ ok: false, error: "Too large" }, 413);
  let body: any = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { return J({ ok: false, error: "Bad JSON" }, 400); }
  const action = String(body.action || "");

  // ---------- script side (x-reach-key) ----------
  if (action === "targets" || action === "ingest" || action === "ping") {
    const sc = await keyScope(req);
    if (!sc) return J({ ok: false, error: "Key not recognised or revoked. Make a new one in Reach → Connections." }, 401);
    const { data: rows, error } = await admin.rpc("ar_inbox_targets", { p_client: sc.client, p_brand: sc.brand });
    if (error) return J({ ok: false, error: "Could not read your rows" }, 500);
    const today = iso(new Date());

    if (action === "ping") {
      await admin.from("ar_inbox_keys").update({ last_sync_at: new Date().toISOString() }).eq("id", sc.keyId);
      return J({ ok: true });
    }

    if (action === "targets") {
      const list: any[] = [];
      for (const r of rows as any[]) {
        const ph = phaseOf(r); if (!(ph === "sent" || ph === "ready" || ph === "replied")) continue;
        if (r.order_via) continue;
        const em = firstEmail(r.email); if (!EMAIL.test(em)) continue;
        list.push({ id: r.id, email: em.toLowerCase(), name: clean(r.name, 80), phase: ph, sent: r.last_sent_date || r.sent_date || "", replied: r.replied_date || "" });
      }
      // look back from the oldest send among open rows, never more than 60 days
      const oldest = list.map((x) => x.sent).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort()[0] || addDays(today, -14);
      const floor = addDays(today, -60);
      let since = addDays(oldest, -3); if (since < floor) since = floor;
      return J({ ok: true, today, since, targets: list });
    }

    // ingest
    const byId = new Map<string, any>(); (rows as any[]).forEach((r) => byId.set(r.id, r));
    const findings: any[] = Array.isArray(body.findings) ? body.findings.slice(0, 250) : [];
    const since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since || "")) ? String(body.since) : addDays(today, -60);
    const stats = { replied: 0, sent: 0, bounced: 0, skipped: 0, rejected: 0, checked: Math.max(0, Math.min(100000, Number(body.checked) || 0)) };
    for (const f of findings) {
      const r = byId.get(String(f?.id || ""));
      const type = String(f?.type || ""); const date = String(f?.date || "");
      if (!r || !["sent", "replied", "bounced"].includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < addDays(since, -2)) { stats.rejected++; continue; }
      const quote = clean(f.quote, 160);
      if (quote.length < 10) { stats.rejected++; continue; }
      const ph = phaseOf(r);
      if (type === "sent" && !(ph === "ready" || ph === "research")) { stats.skipped++; continue; }
      if (type === "replied") {
        const lastOut = r.last_sent_date || r.sent_date || "";
        if (!(ph === "sent" || (ph === "replied" && date > (r.replied_date || "")))) { stats.skipped++; continue; }
        if (lastOut && date < lastOut) { stats.skipped++; continue; }
      }
      if (type === "bounced" && !(ph === "sent" || ph === "ready")) { stats.skipped++; continue; }
      if (r.sug_type === type && r.sug_date === date) { stats.skipped++; continue; }
      const subj = clean(f.subject, 120);
      const replyText = type === "replied" ? clean(f.replyText, 1200) : "";
      const context = type === "replied" && Array.isArray(f.context)
        ? f.context.slice(-4).map((c: any) => ({ who: c?.who === "us" ? "us" : "them", date: /^\d{4}-\d{2}-\d{2}$/.test(String(c?.date || "")) ? String(c.date) : "", text: clean(c?.text, 500) })).filter((c: any) => c.text.length >= 5)
        : [];
      const suggest = {
        type, date,
        evidence: ((subj ? "“" + subj + "” — " : "") + quote).slice(0, 260),
        replyText: replyText.length >= 10 ? replyText : "",
        threadId: clean(f.threadId, 60),
        via: "inbox-script", at: Date.now(),
        ...(context.length ? { context } : {}),
      };
      const { data: ok } = await admin.rpc("ar_inbox_apply", { p_deal: r.id, p_client: sc.client, p_brand: sc.brand, p_suggest: suggest });
      if (ok) (stats as any)[type]++; else stats.rejected++;
    }
    await admin.from("ar_inbox_keys").update({ last_sync_at: new Date().toISOString(), last_stats: stats }).eq("id", sc.keyId);
    return J({ ok: true, stats });
  }

  // ---------- browser side (signed-in user) ----------
  const u = await userCtx(req);
  if (!u) return J({ ok: false, error: "Sign in again" }, 401);
  const client = u.isAdmin && body.clientId ? String(body.clientId) : u.client;
  if (!client) return J({ ok: false, error: "No workspace on this account" }, 403);

  if (action === "status") {
    const { data } = await admin.from("ar_inbox_keys").select("id,brand_id,label,key_prefix,created_at,last_sync_at,last_stats").eq("client_id", client).is("revoked_at", null).order("created_at", { ascending: false });
    return J({ ok: true, keys: data || [] });
  }
  if (action === "create_key") {
    let brand: string | null = null;
    if (body.brandId) {
      const { data: b } = await admin.from("ar_brands").select("id").eq("id", String(body.brandId)).eq("client_id", client).maybeSingle();
      if (!b) return J({ ok: false, error: "Brand not found" }, 404);
      brand = b.id;
    }
    const { count } = await admin.from("ar_inbox_keys").select("id", { count: "exact", head: true }).eq("client_id", client).is("revoked_at", null);
    if ((count || 0) >= 25) return J({ ok: false, error: "Too many active keys — remove one first." }, 400);
    const key = newKey();
    const { data, error } = await admin.from("ar_inbox_keys").insert({ client_id: client, brand_id: brand, label: clean(body.label, 60), key_hash: await sha256(key), key_prefix: key.slice(0, 8), created_by: u.uid }).select("id").single();
    if (error) return J({ ok: false, error: "Could not create the key" }, 500);
    return J({ ok: true, id: data.id, key }); // shown once; only a hash is stored
  }
  if (action === "revoke_key") {
    const { error } = await admin.from("ar_inbox_keys").update({ revoked_at: new Date().toISOString() }).eq("id", String(body.id || "")).eq("client_id", client);
    return J({ ok: !error });
  }
  return J({ ok: false, error: "Unknown action" }, 400);
});

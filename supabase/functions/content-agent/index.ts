// content-agent — lets a user's OWN Claude post their APPROVED Content posts (in their own signed-in browser, like posting by hand,
// or by scheduling them in their own Metricool), then report back with the live link.
// MCP over HTTP for the agent (key cak_… via ?key= / x-content-key / Bearer); user JWT for the in-app screen.
// Deploy with verify_jwt=false (auth is done in here). No new tables: queue lives in ar_settings (one row per post, key cq:<sku>; ar_kv only allows share/access/feedback),
// settings in ar_settings (key content_automation), keys in ar_agent_keys (prefix cak_), activity in ar_agent_log.
// HARD RULES enforced here, not just asked of the agent:
//  - only posts the user APPROVED and then pressed "Send to Claude" on are ever handed out
//  - captions, networks and times are exactly what the app computed; images come from the post row itself
//  - browser mode posts only on networks where the user saved the expected account for that brand; wrong account = stop and pause
//  - Metricool mode only schedules through the user's Metricool connector
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
const KP = "cq:";
const CLAIM_MS = 30 * 60 * 1000;
// networks Metricool takes for image posts (YouTube needs video; Pinterest needs a board so it is only sent when one is saved)
const NETS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X (Twitter)", linkedin: "LinkedIn", tiktok: "TikTok", pinterest: "Pinterest" };
// networks Claude can post to from a normal signed-in browser (TikTok photo posts and Pinterest boards are left to the user)
const BROWSER_NETS: Record<string, { label: string; url: string }> = {
  instagram: { label: "Instagram", url: "https://www.instagram.com/ (use Create → Post)" },
  facebook: { label: "Facebook", url: "https://www.facebook.com/ (the page or profile named in expectAccount)" },
  x: { label: "X (Twitter)", url: "https://x.com/compose/post" },
  linkedin: { label: "LinkedIn", url: "https://www.linkedin.com/feed/ (Start a post)" },
  tiktok: { label: "TikTok", url: "https://www.tiktok.com/tiktokstudio/upload (photo post)" },
  pinterest: { label: "Pinterest", url: "https://www.pinterest.com/pin-creation-tool/ (use the board named in note)" },
  reddit: { label: "Reddit", url: "https://www.reddit.com/submit (post to the profile or subreddit named in expectAccount)" },
};

const MCP_INSTRUCTIONS =
  "You post the user's OWN approved Alchemist posts. Loop: call content_get_next_post. If status is off, empty, not_due or daily_cap, stop; if wait, pause waitSeconds then continue. " +
  "Otherwise do exactly that one post the way its instructions say, then call content_report_result. Never change the wording, hashtags or links. Never invent a link. " +
  "Never log in, type passwords or codes, solve CAPTCHAs or pay: hand the post back with outcome needs_user (or wrong_account) and the plain reason. Do not retry a failing step more than once.";

const TOOLS = [
  { name: "content_get_next_post", description: "Get the next approved post to schedule in Metricool (or a status saying why there is none).", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "content_report_result", description: "Report what happened with a post you were given.", inputSchema: { type: "object", properties: {
    sku: { type: "string", description: "The sku of the post you were given." },
    results: { type: "array", description: "Browser mode: one entry per network you handled.", items: { type: "object", properties: {
      network: { type: "string" }, outcome: { type: "string", enum: ["posted", "failed", "needs_user", "wrong_account"] },
      link: { type: "string", description: "The live post URL (proof)." }, reason: { type: "string" } }, required: ["network", "outcome"] } },
    outcome: { type: "string", enum: ["scheduled", "failed", "needs_user"], description: "Metricool mode only." },
    networks: { type: "array", items: { type: "string" }, description: "Metricool mode: networks that were scheduled." },
    link: { type: "string", description: "Metricool mode: link to the post in Metricool, or its post id." },
    reason: { type: "string", description: "For failed / needs_user: the plain reason." },
  }, required: ["sku"], additionalProperties: false } },
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
  return {
    on: d.on === true, mode: d.mode === "metricool" ? "metricool" : "browser",
    dailyCap: Math.max(1, Math.min(30, Number(d.dailyCap) || 5)), gapSec: Math.max(30, Math.min(900, Number(d.gapSec) || 120)),
    asDraft: d.asDraft === true, mcBrands: (d.mcBrands && typeof d.mcBrands === "object") ? d.mcBrands : {}, pinterestBoard: clean(d.pinterestBoard, 80),
    pinterestBoards: (d.pinterestBoards && typeof d.pinterestBoards === "object") ? d.pinterestBoards : {},   // { brand: "Board name" }; pinterestBoard is the old single value, still used as a fallback
    brandsOff: (d.brandsOff && typeof d.brandsOff === "object") ? d.brandsOff : {},   // { brand: true } = this brand is paused
    accounts: (d.accounts && typeof d.accounts === "object") ? d.accounts : {},   // { brand: { instagram: "@handle", ... } } = the accounts Claude may post to
  };
}
async function queueDocs(client: string): Promise<{ id: string; d: any }[]> {
  const { data } = await admin.from("ar_settings").select("key,data").eq("client_id", client).like("key", KP + "%").limit(1000);
  return ((data as any[]) || []).map((r) => ({ id: String(r.key).slice(KP.length), d: r.data || {} }));
}
async function putDoc(client: string, sku: string, d: any) {
  d.updatedAt = Date.now();
  const { error } = await admin.from("ar_settings").upsert({ client_id: client, key: KP + sku, data: d, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
  if (error) { console.error("putDoc", error.message); throw new Error("Could not save the queue"); }
}
async function logIt(client: string, key: string | null, action: string, outcome: string, detail: string) {
  await admin.from("ar_agent_log").insert({ client_id: client, brand_id: null, deal_id: null, key_id: key, action: "content_" + action, outcome, detail: clean(detail, 400) });
}
const FINISHED = (st: string) => st === "scheduled" || st === "posted";
const doneToday = (docs: { d: any }[], today: string) => docs.filter((x) => FINISHED(x.d.state) && x.d.doneDay === today).length;
const lastDoneAt = (docs: { d: any }[]) => docs.reduce((m, x) => Math.max(m, FINISHED(x.d.state) || x.d.done ? (x.d.doneAt || 0) : 0), 0);
const netsOf = (d: any): string[] => [...new Set((d.groups || []).flatMap((g: any) => g.networks || []))] as string[];
// "now" as local clock time (YYYY-MM-DDTHH:mm) in the post's own time zone, to compare with the post's local date and time
function nowIn(tz: string) { try { return new Date().toLocaleString("sv-SE", { timeZone: tz || "UTC" }).replace(" ", "T").slice(0, 16); } catch { return new Date().toISOString().slice(0, 16); } }
const hoursBetween = (a: string, b: string) => (Date.parse(b + ":00Z") - Date.parse(a + ":00Z")) / 3600000;
const LATE_HOURS = 48;
const eligible = (d: any) => d.state === "queued" || (d.state === "claimed" && Date.now() - (d.claimedAt || 0) > CLAIM_MS && (d.attempts || 0) < 2);

// ---------- agent side ----------
async function agentNext(sc: Scope) {
  const st = await getSettings(sc.client);
  if (!st.on) return { status: "off", message: "Auto-post is switched off in Alchemist. Nothing to do." };
  const docs = await queueDocs(sc.client);
  const today = iso(new Date());
  if (doneToday(docs, today) >= st.dailyCap) return { status: "daily_cap", message: "Today's limit is reached. Try again tomorrow." };
  if (st.mode === "browser") {
    const wait = Math.ceil((lastDoneAt(docs) + st.gapSec * 1000 - Date.now()) / 1000);
    if (wait > 0) return { status: "wait", waitSeconds: wait, message: "Pausing between posts so it looks natural." };
  }
  const list = docs.filter((x) => eligible(x.d) && !(st.brandsOff || {})[x.d.brand]).sort((a, b) => String(a.d.at).localeCompare(String(b.d.at)));
  const notDue: string[] = [];
  for (const next of list) {
    const d = next.d;
    // The queued copy is a snapshot: re-read the post so a changed date or time, or a post that is no longer approved, is honoured
    const { data: pr } = await admin.from("content_calendar").select("scheduled_date,scheduled_time,approval_status").eq("sku", d.sku).eq("brand", d.brand).is("deleted_at", null).maybeSingle();
    if (!pr || String((pr as any).approval_status || "").toLowerCase() !== "approved") {
      d.state = "needs_user"; d.reason = "This post is no longer approved (or was removed), so it was not posted."; await putDoc(sc.client, next.id, d); continue;
    }
    if (!d.asap) {
      const nd = String((pr as any).scheduled_date || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(nd)) {
        const tm = /^\d{2}:\d{2}/.test(String((pr as any).scheduled_time || "")) ? String((pr as any).scheduled_time).slice(0, 5) : String(d.at).slice(11, 16);
        const na = nd + "T" + tm;
        if (na !== d.at) { d.at = na; await putDoc(sc.client, next.id, d); }
      }
    }
    if (!d.asap) {
      const nowL = nowIn(d.tz || "UTC");
      if (d.at > nowL) { notDue.push(d.at); continue; }
      if (hoursBetween(d.at, nowL) > LATE_HOURS) {
        d.state = "needs_user"; d.reason = "Its date passed more than 2 days ago. Change the date, or choose Post now, then Retry."; await putDoc(sc.client, next.id, d); continue;
      }
    }
    if (st.mode === "metricool") {
      d.state = "claimed"; d.claimedAt = Date.now(); d.attempts = (d.attempts || 0) + 1; delete d.reason;
      await putDoc(sc.client, next.id, d);
      await logIt(sc.client, sc.keyId, "get_next", "claimed", d.sku + " " + d.brand);
      return {
        status: "task", mode: "metricool", sku: d.sku, brand: d.brand, metricoolBrand: st.mcBrands[d.brand] || d.brand, title: d.title || "",
        publishAt: d.at, timezone: d.tz || "UTC", asDraft: st.asDraft, groups: d.groups, images: d.images,
        firstComment: d.firstComment || undefined, link: d.link || undefined, location: d.location || undefined,
        pinterestBoard: d.groups.some((g: any) => (g.networks || []).includes("pinterest")) ? boardOf(st, d.brand) : undefined,
        instructions: "Use the user's Metricool connector (get_brands first, pick metricoolBrand). Create ONE scheduled post per entry in groups with exactly that text, only those networks, the images in order (public links), at publishAt in the timezone (asDraft true = save as draft). Never publish immediately and never open a social site. Then call content_report_result with outcome scheduled, the networks scheduled and the Metricool link or id as proof; if Metricool cannot do it, outcome needs_user with the reason.",
      };
    }
    // browser mode: only networks the user saved an expected account for (for this brand), not already posted
    const acc = (st.accounts && st.accounts[d.brand]) || {};
    const done = d.done || {};
    const posts: any[] = [], missing: string[] = [];
    for (const g of d.groups || []) for (const n of g.networks || []) {
      if (done[n] || !BROWSER_NETS[n]) continue;
      const who = clean(acc[n], 160);
      if (!who) { missing.push(BROWSER_NETS[n].label); continue; }
      posts.push({ network: n, label: BROWSER_NETS[n].label, openAt: BROWSER_NETS[n].url, expectAccount: who, text: g.text, ...(n === "pinterest" ? { note: "Pin to the board named: " + (boardOf(st, d.brand)) } : {}) });
    }
    if (!posts.length) {
      d.state = "needs_user"; d.reason = missing.length ? "Add the account for " + [...new Set(missing)].join(", ") + " in Auto-post, then Retry." : "Nothing left Claude can post here (TikTok and Pinterest are done by hand).";
      await putDoc(sc.client, next.id, d); continue;
    }
    d.state = "claimed"; d.claimedAt = Date.now(); d.attempts = (d.attempts || 0) + 1; delete d.reason;
    await putDoc(sc.client, next.id, d);
    await logIt(sc.client, sc.keyId, "get_next", "claimed", d.sku + " " + d.brand + " " + posts.map((p) => p.network).join(","));
    return {
      status: "task", mode: "browser", sku: d.sku, brand: d.brand, title: d.title || "", images: d.images, posts,
      instructions:
        "Post this on the user's own accounts using Claude in Chrome (the user's own signed-in browser), one network at a time, like the user would by hand, with a natural pause of 30 to 90 seconds between networks. " +
        "FOR EACH entry in posts: (1) open a new tab at openAt; (2) CHECK the signed-in account really is expectAccount (expectAccount is the account's profile address or handle; open it or look at the profile name or handle shown in the page and compare). If it is a different account or you cannot tell, do NOT post: call content_report_result with results [{network, outcome: wrong_account, reason}] for it and stop the whole run; " +
        "(3) if the site asks you to log in, enter a password or code, or shows a CAPTCHA, do not continue: outcome needs_user for that network and move on; " +
        "(4) before posting, look at the account's most recent posts; if one already starts with the same first line, do not post again, report posted with that post's link; " +
        "(5) the images are the user's own public image links listed in images. The composer needs them as files: the user has approved downloading exactly these image files for this post, so save each one to a temporary folder first, then attach them in the order given (carousel / multiple images where the network allows it); " +
        "(6) paste the text exactly as given (do not edit, shorten or add anything), post it, then open the new post and copy its live address; " +
        "(7) report with content_report_result results [{network, outcome: posted, link: the live post URL}]. A posted result without a real link is rejected. " +
        "Report each network as soon as it is done, not all at the end. If a step fails twice, report failed or needs_user with the plain reason and go on to the next network.",
    };
  }
  if (notDue.length) { const nx = notDue.sort()[0]; return { status: "not_due", nextAt: nx, message: "Nothing is due yet. The next post is due " + nx.replace("T", " ") + " (the user's local time). Stop now; the user can ask again later, or choose Post now in Alchemist." }; }
  return { status: "empty", message: "No approved posts are waiting." };
}

const SCHED_COL = new Set(Object.keys(NETS));
async function agentResult(sc: Scope, a: any) {
  const sku = clean(a.sku, 40), outcome = String(a.outcome || "");
  const docs = await queueDocs(sc.client);
  const doc = docs.find((x) => x.id === sku);
  if (!doc) return { ok: false, error: "That post is not in the queue." };
  const d = doc.d;
  if (FINISHED(d.state)) return { ok: true, note: "Already recorded as done." };
  if (Array.isArray(a.results)) {
    const done = d.done || (d.done = {});
    const all = netsOf(d);
    const { data: row } = await admin.from("content_calendar").select("*").eq("sku", sku).eq("brand", d.brand).is("deleted_at", null).maybeSingle();
    const patch: Record<string, unknown> = {}; const bad: string[] = []; let wrong = false; const okNets: string[] = [];
    for (const r of a.results.slice(0, 8)) {
      const n = String(r.network || "").toLowerCase().replace(/[^a-z]/g, "").replace(/^(twitter|xtwitter)$/, "x");
      if (!BROWSER_NETS[n] || !all.includes(n)) continue;
      const o = String(r.outcome || "");
      if (o === "posted") {
        const link = clean(r.link, 400);
        if (!/^https:\/\//i.test(link)) { bad.push(BROWSER_NETS[n].label + ": a posted result needs the live post link (https://…)"); continue; }
        done[n] = { link, at: Date.now() }; okNets.push(n);
        if (row && !(row as any)[n + "_posted_at"] && !(row as any)[n + "_post_link"]) { patch[n + "_post_link"] = link; patch[n + "_posted_at"] = new Date().toISOString(); }
      } else if (o === "wrong_account") { wrong = true; bad.push(BROWSER_NETS[n].label + ": signed in to the wrong account. " + clean(r.reason, 160)); }
      else bad.push(BROWSER_NETS[n].label + ": " + (clean(r.reason, 200) || (o === "needs_user" ? "needs you" : "failed")));
    }
    if (row && Object.keys(patch).length) await admin.from("content_calendar").update(patch).eq("id", (row as any).id);
    const left = all.filter((n) => BROWSER_NETS[n] && !done[n]);
    if (!left.length) { d.state = "posted"; d.doneDay = iso(new Date()); delete d.reason; }
    else if (bad.length) { d.state = wrong || bad.some((b) => /needs you|log in|captcha/i.test(b)) ? "needs_user" : "failed"; d.reason = bad.join(" · ").slice(0, 300); }
    else d.state = "claimed";   // still has networks to do
    d.doneAt = Date.now(); if (d.state === "posted" || d.state === "needs_user" || d.state === "failed") delete d.claimedAt;
    await putDoc(sc.client, sku, d);
    if (wrong) await admin.from("ar_settings").upsert({ client_id: sc.client, key: "content_automation", data: Object.assign({}, await getSettings(sc.client), { on: false }), updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
    await logIt(sc.client, sc.keyId, "report", wrong ? "wrong_account" : d.state, sku + " " + okNets.join(",") + " " + bad.join(" | "));
    return { ok: true, recorded: d.state, posted: okNets, problems: bad, ...(wrong ? { paused: "Auto-post was switched off because a wrong account was found. Tell the user." } : {}) };
  }
  if (outcome === "scheduled") {
    const link = clean(a.link, 400);
    if (link.length < 6) return { ok: false, error: "Scheduled needs proof: pass the link or post id Metricool returned." };
    const all = netsOf(d);
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

function boardOf(st: any, brand: string) { return clean((st.pinterestBoards || {})[brand], 80) || st.pinterestBoard || ""; }

async function appStatus(client: string, brands: Set<string>) {
  const st = await getSettings(client);
  const docs = await queueDocs(client);
  const today = iso(new Date());
  const { data: keys } = await admin.from("ar_agent_keys").select("id,label,key_prefix,created_at,last_used_at").eq("client_id", client).is("revoked_at", null).like("key_prefix", "cak_%").order("created_at", { ascending: false });
  const { data: log } = await admin.from("ar_agent_log").select("action,outcome,detail,created_at").eq("client_id", client).like("action", "content_%").order("created_at", { ascending: false }).limit(12);
  const pub = (x: { id: string; d: any }) => {
    const d = x.d, stale = d.state === "claimed" && Date.now() - (d.claimedAt || 0) > CLAIM_MS;
    return { sku: x.id, brand: d.brand, title: d.title, at: d.at, state: stale ? "queued" : d.state, reason: d.reason || "", networks: netsOf(d), posted: Object.keys(d.done || {}), links: Object.values(d.done || {}).map((x: any) => x.link), link: d.result?.link || "", doneAt: d.doneAt || null, sig: d.sig || "", asap: !!d.asap };
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
    const cur = await getSettings(client);
    const accounts: Record<string, Record<string, string>> = {};
    Object.keys(cur.accounts || {}).forEach((b) => { if (u.brands.has(b)) accounts[b] = cur.accounts[b]; });
    Object.keys(body.accounts || {}).forEach((b) => { if (!u.brands.has(b)) return; const o: Record<string, string> = {}; Object.keys(BROWSER_NETS).forEach((n) => { const v = clean((body.accounts[b] || {})[n], 160); if (v) o[n] = v; }); accounts[b] = o; });
    const boards: Record<string, string> = {};
    Object.keys(cur.pinterestBoards || {}).forEach((b) => { if (u.brands.has(b)) { const v = clean(cur.pinterestBoards[b], 80); if (v) boards[b] = v; } });
    if (body.pinterestBoards && typeof body.pinterestBoards === "object") Object.keys(body.pinterestBoards).forEach((b) => { if (!u.brands.has(b)) return; const v = clean(body.pinterestBoards[b], 80); if (v) boards[b] = v; else delete boards[b]; });
    const off: Record<string, boolean> = {};
    const offSrc: Record<string, unknown> = body.brandsOff && typeof body.brandsOff === "object" ? body.brandsOff : (cur.brandsOff || {});
    Object.keys(offSrc).forEach((b) => { if (u.brands.has(b) && offSrc[b] === true) off[b] = true; });
    const data = { on: body.on === true, mode: body.mode === "metricool" ? "metricool" : "browser", dailyCap: Math.max(1, Math.min(30, Number(body.dailyCap) || 5)), gapSec: Math.max(30, Math.min(900, Number(body.gapSec) || cur.gapSec)), asDraft: body.asDraft === true, mcBrands: mc, pinterestBoard: clean(body.pinterestBoard, 80) || (Object.keys(boards).length ? "" : cur.pinterestBoard), pinterestBoards: boards, brandsOff: off, accounts };
    const { error } = await admin.from("ar_settings").upsert({ client_id: client, key: "content_automation", data, updated_at: new Date().toISOString() }, { onConflict: "client_id,key" });
    return { ok: !error, settings: data, error: error ? "Couldn't save" : undefined };
  }
  if (action === "queue") {
    const st = await getSettings(client);
    const items: any[] = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
    const docs = new Map((await queueDocs(client)).map((x) => [x.id, x.d]));
    const skipped: { sku: string; why: string }[] = []; let queued = 0;
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
      const asap = it.asap === true || body.asap === true;
      const nowL = nowIn(clean(it.tz, 60) || "UTC");
      if (!asap && at < nowL && hoursBetween(at, nowL) > LATE_HOURS) { skipped.push({ sku, why: "More than 2 days past its date. Change the date, or choose Post now" }); continue; }
      const prev = docs.get(sku);
      if (prev && (FINISHED(prev.state) || (prev.state === "claimed" && Date.now() - (prev.claimedAt || 0) < CLAIM_MS))) { skipped.push({ sku, why: FINISHED(prev.state) ? "Already done" : "Claude is on it" }); continue; }
      const groups: { networks: string[]; text: string }[] = [];
      for (const g of Array.isArray(it.groups) ? it.groups : []) {
        const nets = (Array.isArray(g.networks) ? g.networks : []).map((n: unknown) => String(n).toLowerCase())
          .filter((n: string) => (st.mode === "browser" ? !!BROWSER_NETS[n] : !!NETS[n]) && !r[n + "_posted_at"] && !r[n + "_post_link"] && (n !== "pinterest" || !!boardOf(st, String(r.brand))));
        const text = clean(g.text, 5000);
        if (nets.length && text) groups.push({ networks: [...new Set(nets)] as string[], text });
      }
      if (!groups.length) { skipped.push({ sku, why: "No account left to post to" }); continue; }
      try { await putDoc(client, sku, {
        state: "queued", sku, brand: r.brand, title: clean(r.post_idea, 120), at, tz: clean(it.tz, 60) || "UTC", groups, images: imgs,
        firstComment: clean(it.firstComment, 2000), link: clean(r.content_link, 300), location: clean(it.location, 120), queuedAt: Date.now(), attempts: 0, done: prev?.done || undefined, asap, sig: clean(it.sig, 40),
      }); } catch (_e) { skipped.push({ sku, why: "Could not save it. Try again" }); continue; }
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
      await admin.from("ar_settings").delete().eq("client_id", client).eq("key", KP + sku); return { ok: true };
    }
    const d = doc.d; if (FINISHED(d.state)) return { ok: false, error: "Already done." };
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

// reach-team: lets a workspace owner add account managers (teammates) and choose which brands each one works on.
// Brand-level access is enforced by the database (ar_members role 'agent' per brand + ar_can_brand), seat limits by the
// ar_enforce_seats trigger. This function only writes those rows, after checking the caller owns the workspace.
// Auth: the signed-in user's JWT. Actions: list, invite, set_brands, remove, claim.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function who(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const sb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser(auth.slice(7));
  if (!u?.user) return null;
  const [{ data: client }, { data: isAdmin }, { data: home }] = await Promise.all([sb.rpc("ar_my_client"), sb.rpc("ar_is_admin"), sb.rpc("ar_admin_home")]);
  return { uid: u.user.id, email: String(u.user.email || "").toLowerCase(), client: client as string | null, isAdmin: !!isAdmin, home: home as string | null };
}

async function isTeammate(client: string, uid: string) {
  const { data } = await admin.from("ar_kv").select("doc_id").eq("client_id", client).eq("coll", "team").eq("doc_id", uid).maybeSingle();
  return !!data;
}

async function brandsOf(client: string) {
  const { data } = await admin.from("ar_brands").select("id,name").eq("client_id", client).is("archived_at", null).order("created_at");
  return (data || []) as { id: string; name: string }[];
}

async function findUserByEmail(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = (data?.users || []).find((x: any) => String(x.email || "").toLowerCase() === email);
    if (hit) return hit as any;
    if (!data?.users || data.users.length < 200) return null;
  }
  return null;
}

// make the brand list for one teammate exactly `ids` (inside this workspace)
async function setMemberBrands(client: string, uid: string, ids: string[]) {
  const mine = (await brandsOf(client)).map((b) => b.id);
  const want = ids.filter((i) => mine.includes(i));
  const { data: cur } = await admin.from("ar_members").select("brand_id").eq("user_id", uid).eq("role", "agent").in("brand_id", mine.length ? mine : ["00000000-0000-0000-0000-000000000000"]);
  const have = (cur || []).map((r: any) => r.brand_id as string);
  const add = want.filter((i) => !have.includes(i));
  const del = have.filter((i) => !want.includes(i));
  if (add.length) {
    const { error } = await admin.from("ar_members").insert(add.map((b) => ({ brand_id: b, user_id: uid, role: "agent" })));
    if (error) return { ok: false, error: String(error.message || "").startsWith("seat_limit") || String(error.message || "").includes("seat_limit") ? String(error.message).replace(/^.*seat_limit:\s*/, "") : "Couldn't save the brands" };
  }
  if (del.length) await admin.from("ar_members").delete().eq("user_id", uid).eq("role", "agent").in("brand_id", del);
  return { ok: true, brandIds: want };
}

async function ownerCtx(u: { uid: string; client: string | null; isAdmin: boolean; home: string | null }, body: any) {
  const client = u.isAdmin ? (body.clientId ? String(body.clientId) : u.home) : u.client;
  if (!client) return { err: "No workspace on this account" };
  if (!u.isAdmin) {
    // owner = this person has their own workspace account row for this workspace and is not a recorded teammate
    const { data: acct } = await admin.from("ar_accounts").select("client_id").eq("user_id", u.uid).maybeSingle();
    if (!acct || acct.client_id !== client || await isTeammate(client, u.uid)) return { err: "Only the workspace owner can manage the team." };
  }
  return { client };
}

async function actionList(client: string) {
  const brands = await brandsOf(client);
  const { data: team } = await admin.from("ar_kv").select("doc_id,data").eq("client_id", client).eq("coll", "team");
  const { data: pend } = await admin.from("ar_kv").select("doc_id,data").eq("client_id", client).eq("coll", "team_invites");
  const ids = brands.map((b) => b.id);
  const { data: mem } = await admin.from("ar_members").select("user_id,brand_id").eq("role", "agent").in("brand_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const limits: any = (await admin.rpc("ar_plan_limits", { p_client: client })).data || {};
  const used = (await admin.rpc("ar_seats_used", { p_client: client })).data ?? null;
  return {
    ok: true, brands, seats: { limit: limits.seats ?? null, used, plan: limits.plan_name || null },
    team: (team || []).map((t: any) => ({ userId: t.doc_id, email: t.data?.email || "", brandIds: (mem || []).filter((m: any) => m.user_id === t.doc_id).map((m: any) => m.brand_id) })),
    pending: (pend || []).map((p: any) => ({ email: p.data?.email || p.doc_id, brandIds: (p.data?.brandIds || []).filter((i: string) => ids.includes(i)), error: p.data?.error || undefined })),
  };
}

async function actionInvite(u: any, client: string, body: any) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address." };
  const mine = (await brandsOf(client)).map((b) => b.id);
  const brandIds: string[] = (Array.isArray(body.brandIds) ? body.brandIds.map(String) : []).filter((i: string) => UUID.test(i) && mine.includes(i));
  if (!brandIds.length) return { ok: false, error: "Pick at least one brand for this person." };
  if (email === u.email) return { ok: false, error: "That is your own email." };
  const found = await findUserByEmail(email);
  if (!found) {
    await admin.from("ar_kv").upsert({ client_id: client, coll: "team_invites", doc_id: email, data: { email, brandIds, by: u.uid, at: Date.now() } }, { onConflict: "client_id,coll,doc_id" });
    return { ok: true, status: "pending", message: "Saved. They get access the first time they sign in to Alchemist Reach with " + email + "." };
  }
  return await attach(client, found.id, email, brandIds, u.uid);
}

async function attach(client: string, uid: string, email: string, brandIds: string[], by: string) {
  const { data: acct } = await admin.from("ar_accounts").select("client_id").eq("user_id", uid).maybeSingle();
  if (acct && acct.client_id !== client) return { ok: false, error: email + " already has their own Reach workspace. Ask them to sign in with a different email, or contact support." };
  const was = !!acct;
  if (!acct) {
    const { error } = await admin.from("ar_accounts").insert({ user_id: uid, client_id: client });
    if (error) return { ok: false, error: "Couldn't add this person." };
  }
  await admin.from("ar_kv").upsert({ client_id: client, coll: "team", doc_id: uid, data: { email, by, at: Date.now() } }, { onConflict: "client_id,coll,doc_id" });
  const r = await setMemberBrands(client, uid, brandIds);
  if (!r.ok) {
    if (!was) { await admin.from("ar_accounts").delete().eq("user_id", uid); await admin.from("ar_kv").delete().eq("client_id", client).eq("coll", "team").eq("doc_id", uid); }
    return r;
  }
  await admin.from("ar_kv").delete().eq("client_id", client).eq("coll", "team_invites").eq("doc_id", email);
  return { ok: true, status: "added", userId: uid, brandIds: r.brandIds };
}

async function actionRemove(client: string, body: any) {
  const email = String(body.email || "").trim().toLowerCase();
  const uid = String(body.userId || "");
  if (email && !uid) { await admin.from("ar_kv").delete().eq("client_id", client).eq("coll", "team_invites").eq("doc_id", email); return { ok: true }; }
  if (!UUID.test(uid) || !(await isTeammate(client, uid))) return { ok: false, error: "That person is not on your team." };
  const mine = (await brandsOf(client)).map((b) => b.id);
  if (mine.length) await admin.from("ar_members").delete().eq("user_id", uid).eq("role", "agent").in("brand_id", mine);
  await admin.from("ar_kv").delete().eq("client_id", client).eq("coll", "team").eq("doc_id", uid);
  await admin.from("ar_accounts").delete().eq("user_id", uid).eq("client_id", client);
  return { ok: true };
}

// called by the app right after sign-in, BEFORE a personal workspace is created: turns a pending invite into access
async function actionClaim(u: any) {
  if (!u.email || u.isAdmin) return { ok: true, claimed: 0 };
  const { data: acct } = await admin.from("ar_accounts").select("client_id").eq("user_id", u.uid).maybeSingle();
  const { data: inv } = await admin.from("ar_kv").select("client_id,data").eq("coll", "team_invites").eq("doc_id", u.email).limit(5);
  if (!inv || !inv.length) return { ok: true, claimed: 0 };
  if (acct) return { ok: true, claimed: 0, note: "already has a workspace" };
  const first: any = inv[0];
  const r: any = await attach(first.client_id, u.uid, u.email, first.data?.brandIds || [], first.data?.by || "");
  if (!r.ok) {
    await admin.from("ar_kv").update({ data: Object.assign({}, first.data || {}, { error: r.error }) }).eq("client_id", first.client_id).eq("coll", "team_invites").eq("doc_id", u.email);
    return { ok: true, claimed: 0, error: r.error };
  }
  return { ok: true, claimed: 1 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: any = {}; try { body = JSON.parse((await req.text()) || "{}"); } catch { return J({ ok: false, error: "Bad JSON" }, 400); }
  try {
    const u = await who(req);
    if (!u) return J({ ok: false, error: "Sign in again" }, 401);
    const action = String(body.action || "");
    if (action === "claim") return J(await actionClaim(u));
    const o: any = await ownerCtx(u, body);
    if (o.err) return J({ ok: false, error: o.err }, 403);
    if (action === "list") return J(await actionList(o.client));
    if (action === "invite") return J(await actionInvite(u, o.client, body));
    if (action === "set_brands") {
      const uid = String(body.userId || "");
      if (!UUID.test(uid) || !(await isTeammate(o.client, uid))) return J({ ok: false, error: "That person is not on your team." });
      const ids = (Array.isArray(body.brandIds) ? body.brandIds.map(String) : []).filter((i: string) => UUID.test(i));
      if (!ids.length) return J({ ok: false, error: "Pick at least one brand, or remove the person." });
      return J(await setMemberBrands(o.client, uid, ids));
    }
    if (action === "remove") return J(await actionRemove(o.client, body));
    return J({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    console.error("reach-team", e);
    return J({ ok: false, error: "Something went wrong" }, 500);
  }
});

// brand-bridge — lets a user bring a brand's brief from one Alchemist module into the other.
//   content_brands : Content brands the signed-in user can access, mapped to Reach brand fields
//   reach_brands   : Reach brands the signed-in user can access, mapped to Content brief fields
//   link           : after a Content brand is imported into Reach, remember the link (ar_brands.cc_brand_id)
// verify_jwt=false: the user's JWT is checked inside. It only ever COPIES text fields the user can already see.
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
const s = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const hex = (v: unknown) => (/^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v) : "");

async function ctx(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const sb = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser(auth.slice(7));
  if (!u?.user) return null;
  const [{ data: client }, { data: isAdmin }] = await Promise.all([sb.rpc("ar_my_client"), sb.rpc("ar_is_admin")]);
  return { uid: u.user.id, client: (client as string | null) || null, isAdmin: !!isAdmin };
}

// names of the Content brands this user may use
async function contentNames(c: { uid: string; isAdmin: boolean }): Promise<string[] | "all"> {
  if (c.isAdmin) return "all";
  const { data } = await admin.from("cc_user_brands").select("brand").eq("user_id", c.uid);
  return (data || []).map((r: any) => String(r.brand));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const c = await ctx(req);
  if (!c) return J({ ok: false, error: "Sign in again" }, 401);
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || "");

  if (action === "content_brands") {
    const names = await contentNames(c);
    let q = admin.from("cc_brands").select("id,name,logo_url,primary_color,default_wheel_url,content_niches,brand_mission,target_audience,content_goals,brand_tone,proof_points,content_exclusions").order("name").limit(300);
    if (names !== "all") { if (!names.length) return J({ ok: true, brands: [] }); q = q.in("name", names); }
    const { data: rows, error } = await q;
    if (error) return J({ ok: false, error: "Could not read your Content brands" }, 500);
    let linked = new Set<string>();
    if (c.client || c.isAdmin) {
      let lq = admin.from("ar_brands").select("cc_brand_id").not("cc_brand_id", "is", null).is("archived_at", null);
      if (!c.isAdmin) lq = lq.eq("client_id", c.client!);
      const { data: l } = await lq; linked = new Set((l || []).map((x: any) => x.cc_brand_id));
    }
    const brands = (rows || []).map((b: any) => {
      const niches = Array.isArray(b.content_niches) ? b.content_niches.join(", ") : "";
      return {
        id: b.id, name: b.name, logo: b.logo_url || "", site: b.default_wheel_url || "", imported: linked.has(b.id),
        reach: {
          name: s(b.name, 80), officialSite: s(b.default_wheel_url, 300), color: hex(b.primary_color),
          whatItIs: s(niches || b.brand_mission, 400), mission: s(b.brand_mission, 1200), targetAudience: s(b.target_audience, 1200),
          brandTone: s(b.brand_tone, 300), proofPoints: s(b.proof_points, 1500), keyMessages: s(b.content_goals, 1200), blockWords: s(b.content_exclusions, 1000),
        },
      };
    });
    return J({ ok: true, brands });
  }

  if (action === "reach_brands") {
    if (!c.client && !c.isAdmin) return J({ ok: true, brands: [] });
    let q = admin.from("ar_brands").select("id,client_id,cc_brand_id,name,official_site,data").is("archived_at", null).order("name").limit(300);
    if (!c.isAdmin) q = q.eq("client_id", c.client!);
    const { data: rows, error } = await q;
    if (error) return J({ ok: false, error: "Could not read your Reach brands" }, 500);
    const brands = (rows || []).map((b: any) => {
      const d = b.data || {};
      return {
        id: b.id, name: b.name, site: b.official_site || d.officialSite || "", imported: !!b.cc_brand_id,
        content: {
          brand_name: s(b.name, 80), site: s(b.official_site || d.officialSite, 300),
          brand_mission: s(d.mission || d.whatItIs, 1200), target_audience: s(d.targetAudience, 1200), brand_tone: s(d.brandTone, 300),
          proof_points: s(d.proofPoints, 1500), content_goals: s(d.keyMessages, 1200), content_exclusions: s(d.blockWords, 1000),
        },
      };
    });
    return J({ ok: true, brands });
  }

  if (action === "link") {
    const legacyId = s(body.legacyId, 80), ccId = s(body.ccBrandId, 60);
    if (!legacyId || !/^[0-9a-f-]{36}$/i.test(ccId)) return J({ ok: false, error: "Bad request" }, 400);
    const { data: cb } = await admin.from("cc_brands").select("id,name").eq("id", ccId).maybeSingle();
    if (!cb) return J({ ok: false, error: "Brand not found" }, 404);
    const names = await contentNames(c);
    if (names !== "all" && !names.includes(String(cb.name))) return J({ ok: false, error: "No access to that brand" }, 403);
    let uq = admin.from("ar_brands").update({ cc_brand_id: ccId }).eq("legacy_id", legacyId).is("cc_brand_id", null);
    if (!c.isAdmin) uq = uq.eq("client_id", c.client!);
    const { error } = await uq;
    return J({ ok: !error });
  }
  return J({ ok: false, error: "Unknown action" }, 400);
});

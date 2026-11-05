import { createClient } from 'jsr:@supabase/supabase-js@2';

// Lets a signed-in client edit their own brand's content settings -- not
// the brand name, which is a denormalized text key used across
// cc_user_brands/content_calendar, so a self-serve rename would need a
// coordinated update across those tables. That stays an admin action.
//
// 2026-09-09: real server-side plan-tier gating on the Canva/Adobe design
// hand-off fields -- Growth/Agency only, once a brand has an active or
// trialing subscription. Early-access brands with no cc_subscriptions row
// keep today's behavior.
// 2026-09-10: the isAdmin bypass every other brand-scoped function has.
// 2026-09-11: the Design & Character fields (character_asset_url,
// character_description, character_adaptable, default_motif).
// 2026-09-12: closing_template_url for the slide-3 closing card.
//
// 2026-09-25: the brand brief the Alchemist writes from -- mission,
// audience, goals, tone, proof points. Two things to know:
//   - proof_points is the only place a brand states specifics the writer is
//     allowed to cite, which is what stops it inventing them.
//   - content_agent_instructions is now DERIVED in the database
//     (trg_cc_brands_compose_brief) from those fields plus the owner's own
//     free text. So the request field `contentAgentInstructions` -- kept
//     under its old name so existing callers don't break -- now lands in
//     content_agent_notes. Writing the derived column directly would be
//     silently discarded by the trigger.
//
// 2026-10-14: visual-element brand defaults -- defaultIncludeCharacter,
// defaultIncludeQr, pictures. These let the brand owner toggle whether new
// campaigns include QR codes, the mascot character, and AI-generated
// pictures by default.
const ADMIN_EMAILS = ['spinquest.app@gmail.com', 'watchcrypto.media@gmail.com', 'brad@unitedpress.media'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'X', 'LinkedIn', 'Facebook', 'Pinterest', 'YouTube', 'Evrylife'];
const POST_TYPE_OPTIONS = ['image', 'carousel', 'video'];
const DESIGN_TOOLS_MIN_PLANS = ['growth', 'agency'];
const MOTIF_OPTIONS = ['candlestick', 'circuit', 'racetrack', 'bookstack', 'spiral', 'protocol-nodes', 'bonfire', 'harvestfair', 'arctic'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'not signed in' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user?.id || !userData.user.email) return json({ error: 'not signed in' }, 401);
  const userId = userData.user.id;
  const isAdmin = ADMIN_EMAILS.includes(userData.user.email);

  const body = await req.json().catch(() => ({}));
  const brand = (body.brand || '').trim();
  if (!brand) return json({ error: 'Brand is required.' }, 400);

  if (!isAdmin) {
    const { data: grant } = await supabase.from('cc_user_brands').select('brand').eq('user_id', userId).eq('brand', brand).maybeSingle();
    if (!grant) return json({ error: 'You do not have access to this brand.' }, 403);
  }

  const update: Record<string, unknown> = {};
  if (typeof body.niches === 'string') {
    update.content_niches = body.niches.trim() ? body.niches.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
  }
  if (typeof body.geoScope === 'string') {
    update.content_geo_scope = body.geoScope.trim().slice(0, 200) || null;
  }
  if (typeof body.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.primaryColor)) {
    update.primary_color = body.primaryColor;
  }
  if (typeof body.secondaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.secondaryColor)) {
    update.secondary_color = body.secondaryColor;
  }
  if (typeof body.accentColor === 'string') {
    const v = body.accentColor.trim();
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) return json({ error: 'Accent color should be a hex value like #6d5ef0.' }, 400);
    update.accent_color = v || null;
  }
  if (typeof body.logoUrl === 'string') {
    const v = body.logoUrl.trim();
    if (v && !/^https?:\/\//i.test(v)) return json({ error: 'Logo URL should start with http:// or https://' }, 400);
    update.logo_url = v.slice(0, 500) || null;
  }
  if (typeof body.defaultWheelUrl === 'string') {
    const v = body.defaultWheelUrl.trim();
    if (v && !/^https?:\/\//i.test(v)) return json({ error: 'Default link should start with http:// or https://' }, 400);
    update.default_wheel_url = v.slice(0, 500) || null;
  }
  if (typeof body.postingCadence === 'string') {
    update.posting_cadence = body.postingCadence.trim().slice(0, 60) || null;
  }
  if (Array.isArray(body.defaultPlatforms)) {
    update.default_platforms = body.defaultPlatforms.filter((p: unknown) => typeof p === 'string' && PLATFORM_OPTIONS.includes(p));
  }
  if (Array.isArray(body.defaultPostTypes)) {
    update.default_post_types = body.defaultPostTypes.filter((t: unknown) => typeof t === 'string' && POST_TYPE_OPTIONS.includes(t));
  }
  // Old request field name, new destination -- see the header note.
  if (typeof body.contentAgentInstructions === 'string') {
    update.content_agent_notes = body.contentAgentInstructions.trim().slice(0, 2000) || null;
  }
  if (typeof body.contentAgentNotes === 'string') {
    update.content_agent_notes = body.contentAgentNotes.trim().slice(0, 2000) || null;
  }
  if (typeof body.contentExclusions === 'string') {
    update.content_exclusions = body.contentExclusions.trim().slice(0, 1000) || null;
  }

  // -- The brand brief: what the Alchemist knows before he writes --------
  if (typeof body.brandMission === 'string') {
    update.brand_mission = body.brandMission.trim().slice(0, 1200) || null;
  }
  if (typeof body.targetAudience === 'string') {
    update.target_audience = body.targetAudience.trim().slice(0, 1200) || null;
  }
  if (typeof body.contentGoals === 'string') {
    update.content_goals = body.contentGoals.trim().slice(0, 1200) || null;
  }
  if (typeof body.brandTone === 'string') {
    update.brand_tone = body.brandTone.trim().slice(0, 300) || null;
  }
  if (typeof body.proofPoints === 'string') {
    update.proof_points = body.proofPoints.trim().slice(0, 1500) || null;
  }

  // -- Design & Character: brand-asset adaptability ----------------------
  if (typeof body.characterAssetUrl === 'string') {
    const v = body.characterAssetUrl.trim();
    if (v && !/^https?:\/\//i.test(v)) return json({ error: 'Character/mascot image URL should start with http:// or https://' }, 400);
    update.character_asset_url = v.slice(0, 500) || null;
  }
  if (typeof body.characterDescription === 'string') {
    update.character_description = body.characterDescription.trim().slice(0, 1500) || null;
  }
  if (typeof body.characterAdaptable === 'boolean') {
    update.character_adaptable = body.characterAdaptable;
  }
  if (typeof body.defaultMotif === 'string') {
    const v = body.defaultMotif.trim();
    if (v && !MOTIF_OPTIONS.includes(v)) return json({ error: `Unknown scene style "${v}".` }, 400);
    update.default_motif = v || null;
  }
  if (typeof body.closingTemplateUrl === 'string') {
    const v = body.closingTemplateUrl.trim();
    if (v && !/^https?:\/\//i.test(v)) return json({ error: 'Closing template image URL should start with http:// or https://' }, 400);
    update.closing_template_url = v.slice(0, 500) || null;
  }

  // -- Visual-element defaults (2026-10-14) ------------------------------
  if (typeof body.defaultIncludeCharacter === 'boolean') {
    update.default_include_character = body.defaultIncludeCharacter;
  }
  if (typeof body.defaultIncludeQr === 'boolean') {
    update.default_include_qr = body.defaultIncludeQr;
  }
  // pictures lives in design_system jsonb, but this is a brand-level
  // default the owner sets. We handle it as a top-level flag here and
  // merge it into design_system server-side.
  if (typeof body.pictures === 'string' && ['on', 'off'].includes(body.pictures)) {
    // We need to read the current design_system, patch it, and write back.
    // Flag it for the post-update merge below.
    (update as any)._pictures = body.pictures;
  }

  // Handle the pictures merge into design_system if requested
  const picturesVal = (update as any)._pictures;
  delete (update as any)._pictures;
  if (picturesVal) {
    const { data: cur } = await supabase.from('cc_brands').select('design_system').eq('name', brand).maybeSingle();
    const ds = (cur?.design_system || {}) as Record<string, unknown>;
    if (picturesVal === 'off') ds.pictures = 'off';
    else delete ds.pictures; // 'on' = remove the 'off' flag
    update.design_system = ds;
  }

  const wantsDesignTools = typeof body.canvaBrandKitId === 'string' || typeof body.adobeBrandId === 'string';
  if (wantsDesignTools) {
    const { data: brandRow } = await supabase.from('cc_brands').select('id, client_id').eq('name', brand).maybeSingle();
    let planLocked = false;
    if (brandRow?.client_id) {
      const { data: subRow } = await supabase
        .from('cc_subscriptions')
        .select('status, cc_plans(key)')
        .eq('client_id', brandRow.client_id)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subRow) {
        const planKey = (subRow.cc_plans as Record<string, unknown> | null)?.key as string | undefined;
        planLocked = !planKey || !DESIGN_TOOLS_MIN_PLANS.includes(planKey);
      }
    }
    if (planLocked) {
      return json({ error: 'Design tools (Canva/Adobe hand-off) are available on the Growth plan and up. Upgrade this brand\'s plan to unlock them.' }, 403);
    }
    if (typeof body.canvaBrandKitId === 'string') {
      update.canva_brand_kit_id = body.canvaBrandKitId.trim().slice(0, 200) || null;
    }
    if (typeof body.adobeBrandId === 'string') {
      update.adobe_brand_id = body.adobeBrandId.trim().slice(0, 200) || null;
    }
  }

  if (!Object.keys(update).length) return json({ error: 'Nothing to update.' }, 400);
  update.updated_at = new Date().toISOString();

  const { data: updated, error: updateErr } = await supabase
    .from('cc_brands')
    .update(update)
    .eq('name', brand)
    .select('name, content_niches, content_geo_scope, primary_color, secondary_color, accent_color, logo_url, default_wheel_url, posting_cadence, default_platforms, default_post_types, content_agent_instructions, content_agent_notes, content_exclusions, brand_mission, target_audience, content_goals, brand_tone, proof_points, canva_brand_kit_id, adobe_brand_id, character_asset_url, character_description, character_adaptable, default_motif, closing_template_url, default_include_character, default_include_qr')
    .maybeSingle();

  if (updateErr || !updated) return json({ error: updateErr?.message || 'Could not save changes.' }, 500);
  return json({ ok: true, brand: updated });
});

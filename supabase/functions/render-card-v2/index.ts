import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { Buffer } from 'node:buffer';
import satori from 'npm:satori@0.12.2';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';
import * as fontkit from 'npm:fontkit@2.0.4';
import QRCode from 'npm:qrcode@1.5.3';
import { decode as decodePng } from 'npm:fast-png@6.2.0';
import { buildCard, requiredFonts, FONT_LIBRARY, PRESETS, nearestWeight, mix, isDark, contrast, optimizeSvg } from './engine.js';

// render-card-v2 -- the Alchemist card engine.
//
// Every brand gets its own look from cc_brands.design_system (preset,
// palette roles, real typefaces, logo/mascot/photo treatments), and every
// card picks an archetype that fits its content and avoids the brand's
// last few. Layout is satori (flexbox + real font metrics), raster is resvg.
//
// Upload contract is the same as render-content-card: the PNG goes to
// wheel-assets/content-calendar/{sku}/card_{n}.png, media_urls is merged by
// path and sorted by slide, and the optional thumb fills thumb_data_uri*.
//
// Auth: x-cc-key for server callers (render). A signed-in user with a grant
// on the brand may call {preview:true}, which renders and returns the PNG
// without writing anything.
// Server key comes from the CC_KEY Edge secret (never written in code).
const CC_KEY = (Deno.env.get('CC_KEY') || '').trim();
const ADMIN_EMAILS = ['spinquest.app@gmail.com', 'watchcrypto.media@gmail.com', 'brad@unitedpress.media', 'vanboxmeer.bradley@gmail.com'];
const W = 1080, H = 1350;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-cc-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

let wasmReady: Promise<void> | null = null;
function ensureWasm() {
  if (!wasmReady) {
    wasmReady = fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm')
      .then((r) => { if (!r.ok) throw new Error('resvg wasm ' + r.status); return r.arrayBuffer(); })
      .then((buf) => initWasm(buf))
      .catch((e) => { wasmReady = null; throw e; });
  }
  return wasmReady;
}

// ── Fonts (fontsource woff via jsdelivr, cached per instance) ─────────────
type LoadedFont = { family: string; weight: number; data: ArrayBuffer; fk: any };
const fontCache = new Map<string, Promise<LoadedFont>>();
function loadFont(family: string, weight: number): Promise<LoadedFont> {
  const key = `${family}|${weight}`;
  let p = fontCache.get(key);
  if (!p) {
    const lib = (FONT_LIBRARY as Record<string, { id: string }>)[family];
    if (!lib) return Promise.reject(new Error('unknown font ' + family));
    const url = `https://cdn.jsdelivr.net/npm/@fontsource/${lib.id}@5.3.0/files/${lib.id}-latin-${weight}-normal.woff`;
    p = fetchWithTimeout(url, 10000)
      .then((r) => { if (!r.ok) throw new Error(`font ${family} ${weight}: ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => ({ family, weight, data: ab, fk: (fontkit as any).create(Buffer.from(ab)) }))
      .catch((e) => { fontCache.delete(key); throw e; });
    fontCache.set(key, p);
  }
  return p;
}
function measureWith(loaded: LoadedFont[]) {
  return (text: string, family: string, weight: number, size: number, ls = 0) => {
    let f = loaded.find((x) => x.family === family && x.weight === weight) || loaded.find((x) => x.family === family);
    if (!f) f = loaded[0];
    const t = String(text);
    let adv: number;
    try { adv = f.fk.layout(t).advanceWidth; }
    catch {
      try { adv = f.fk.glyphsForString(t).reduce((a: number, g: any) => a + (g.advanceWidth || 0), 0); }
      catch { adv = t.length * f.fk.unitsPerEm * 0.62; }
    }
    return (adv / f.fk.unitsPerEm) * size * 1.015 + ls * Math.max(0, t.length - 1);
  };
}

// ── Assets ────────────────────────────────────────────────────────────────
function fetchWithTimeout(url: string, ms: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal, redirect: 'follow' }).finally(() => clearTimeout(t));
}
// Only https, never an IP literal or a local name. Images named in the
// request body must live in our own storage; URLs from the brand's own
// saved settings may be on the brand's site.
function safeUrl(u: unknown, fromBody: boolean): string | null {
  if (typeof u !== 'string' || !u) return null;
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const h = url.hostname.toLowerCase();
  if (/^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (fromBody && !u.startsWith(STORAGE_PREFIX)) return null;
  return url.toString();
}
const assetCache = new Map<string, Promise<string | null>>();
function toDataUri(u: string | null): Promise<string | null> {
  if (!u) return Promise.resolve(null);
  let p = assetCache.get(u);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetchWithTimeout(u, 8000);
        if (!r.ok) return null;
        const len = Number(r.headers.get('content-length') || 0);
        if (len > 6_000_000) return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.length > 6_000_000 || buf.length < 24) return null;
        let type = '';
        if (buf[0] === 0x89 && buf[1] === 0x50) type = 'image/png';
        else if (buf[0] === 0xff && buf[1] === 0xd8) type = 'image/jpeg';
        else {
          const head = new TextDecoder().decode(buf.slice(0, 400)).trim().toLowerCase();
          if (head.startsWith('<svg') || head.startsWith('<?xml')) type = 'image/svg+xml';
        }
        if (!type) return null; // webp/gif/other: not drawable by the rasterizer
        // Decoding a huge image costs more than the whole render budget; the
        // brand-look save scales images down, so anything this big was not
        // saved through it and is left off the card rather than failing it.
        // Our own storage holds images we drew or normalised (scenes, poses,
        // brand kits), so those may be larger.
        const cap = type === 'image/svg+xml' ? 600_000 : (u.startsWith(STORAGE_PREFIX) ? 3_000_000 : 1_200_000);
        if (buf.length > cap) { console.warn('render-card-v2: asset too large, skipped', u, buf.length); return null; }
        return `data:${type};base64,${encodeBase64(buf)}`;
      } catch { return null; }
    })();
    assetCache.set(u, p);
    if (assetCache.size > 60) assetCache.delete(assetCache.keys().next().value!);
  }
  return p;
}

// ── Logo tone (2026-10-12) ───────────────────────────────────────────────
// Brad: "just keeps making our logo a white blotch" (SpinQuest). A logo the
// brand kit marked "for light grounds" was turned into a one-colour white
// silhouette on dark cards; a full-colour logo (a wheel, filled lettering)
// becomes a solid white shape that way. The logo's own pixels now decide:
// a colourful or opaque logo is always drawn as it is. Only a plain
// one-colour mark (black or white type) is ever tinted.
const toneCache = new Map<string, 'any' | 'light' | 'dark' | null>();
function logoToneOf(dataUri: string | null): 'any' | 'light' | 'dark' | null {
  if (!dataUri) return null;
  const key = dataUri.length + ':' + dataUri.slice(-64);
  if (toneCache.has(key)) return toneCache.get(key)!;
  let tone: 'any' | 'light' | 'dark' | null = null;
  if (dataUri.startsWith('data:image/jpeg')) tone = 'any';            // opaque: carries its own background
  else if (dataUri.startsWith('data:image/png') || dataUri.startsWith('data:image/svg+xml')) {
    try {
      // 2026-10-14: an SVG logo is drawn small first and read the same way.
      // SpiceBook's round badge (an SVG) was being tinted into a plain dot.
      const raw = Uint8Array.from(atob(dataUri.split(',')[1]), (c) => c.charCodeAt(0));
      const pngBytes = dataUri.startsWith('data:image/svg+xml')
        ? new Resvg(new TextDecoder().decode(raw), { fitTo: { mode: 'width', value: 160 } }).render().asPng()
        : raw;
      const png = decodePng(pngBytes);
      const ch = png.channels, d = png.data as Uint8Array | Uint16Array, max = png.depth === 16 ? 65535 : 255;
      const total = png.width * png.height;
      const step = Math.max(1, Math.floor(total / 20000));
      let n = 0, lum = 0, seen = 0, vivid = 0, light = 0, dark = 0;
      const hues = new Array(12).fill(0);
      for (let p = 0; p < total; p += step) {
        seen++;
        const o = p * ch;
        const a = ch === 4 ? d[o + 3] / max : ch === 2 ? d[o + 1] / max : 1;
        if (a < 0.5) continue;
        const r = d[o] / max, g = ch >= 3 ? d[o + 1] / max : r, b = ch >= 3 ? d[o + 2] / max : r;
        const hi = Math.max(r, g, b), lo = Math.min(r, g, b), c = hi - lo;
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        lum += l; n++;
        if (l > 0.7) light++; else if (l < 0.3) dark++;
        if (c > 0.25) {
          vivid++;
          let h = hi === r ? ((g - b) / c) % 6 : hi === g ? (b - r) / c + 2 : (r - g) / c + 4;
          if (h < 0) h += 6;
          hues[Math.min(11, Math.floor(h * 2))]++;
        }
      }
      if (n) {
        lum /= n;
        const hueCount = hues.filter((x) => x >= vivid * 0.08).length;
        // Drawn as it is when tinting would destroy it: opaque (a photo or a
        // logo on its own panel), several colours, or light parts drawn on
        // dark parts (outlined lettering). A one-colour mark can be tinted.
        if (n / seen > 0.97 || (vivid / n > 0.12 && hueCount >= 2) || (light / n > 0.12 && dark / n > 0.12)) tone = 'any';
        else tone = lum > 0.62 ? 'light' : lum < 0.38 ? 'dark' : 'any';
      }
    } catch { tone = null; }
  }
  toneCache.set(key, tone);
  if (toneCache.size > 60) toneCache.delete(toneCache.keys().next().value!);
  return tone;
}

// ── Image details inside the PNG (2026-10-11) ───────────────────────────
// Brad: content should have SEO-friendly titles and metadata, with the slide
// order. Each card carries iTXt text chunks (UTF-8): Title (with the slide
// number), Description, Author (the brand), Copyright, Source, Software.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function withPngText(png: Uint8Array, entries: [string, string][]): Uint8Array {
  if (png.length < 33 || png[12] !== 0x49 || png[13] !== 0x48) return png;      // IHDR must follow the signature
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [k, v] of entries) {
    const text = String(v || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ').trim().slice(0, 600);
    if (!text) continue;
    const data = new Uint8Array([...enc.encode(k.slice(0, 79)), 0, 0, 0, 0, 0, ...enc.encode(text)]);   // keyword, no compression, no language
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(enc.encode('iTXt'), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    chunks.push(out);
  }
  const extra = chunks.reduce((a, c) => a + c.length, 0);
  const res = new Uint8Array(png.length + extra);
  res.set(png.subarray(0, 33), 0);
  let o = 33; for (const c of chunks) { res.set(c, o); o += c.length; }
  res.set(png.subarray(33), o);
  return res;
}
function cardDetails(content: Record<string, any>, brandName: string, slide: number, subjectUrl: string | null, body: Record<string, any>): [string, string][] {
  const head = String(body.seo_title || content.headline || content.quote || '').trim();
  const total = Number(body.slides_total) || 0;
  const order = total > 1 ? `Slide ${slide} of ${total}` : slide > 1 ? `Slide ${slide}` : '';
  const title = [head, order, brandName].filter(Boolean).join(' – ');
  const desc = [content.sub, content.cta].filter(Boolean).join(' ').trim() || head;
  return [['Title', title], ['Description', desc], ['Author', brandName], ['Copyright', `© ${new Date().getUTCFullYear()} ${brandName}`], ['Source', subjectUrl || ''], ['Software', 'Fullmedia Alchemist']];
}

// ── Brand look ────────────────────────────────────────────────────────────
const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : null);
function hashStr(s: string) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

// Before a brand has been scanned, its look is derived from the colours and
// tone it already has, so two brands never fall back to the same template.
function presetFromTone(row: Record<string, unknown>): string {
  const t = [row.brand_tone, row.brand_mission, row.target_audience, row.notes, row.content_niches].map((x) => (typeof x === 'string' ? x : JSON.stringify(x || ''))).join(' ').toLowerCase();
  const rules: [RegExp, string][] = [
    [/\b(crypto|trading|bitcoin|defi|stocks?)\b/, 'terminal'],
    [/\b(protocol|open[- ]source|decentrali[sz]ed|developers?|infrastructure)\b/, 'blueprint'],
    [/\b(night ?life|nightclubs?|clubbing|dj|concerts?)\b/, 'club'],
    [/\b(luxury|luxe|salon|boutique|elegant)\b/, 'luxe'],
    [/\b(gym|fitness|sports?|athletes?|workouts?)\b/, 'sport'],
    [/\b(bakery|food|organic|farm|coffee|cafe|restaurant)\b/, 'organic'],
    [/\b(kids|toys?|children|school|reading|books?)\b/, 'playful'],
    [/\b(playful|games?|casual|app)\b/, 'gradient'],
    [/\b(agency|studio|consultancy)\b/, 'swiss'],
  ];
  for (const [re, p] of rules) if (re.test(t)) return p;
  const pool = ['editorial', 'bold', 'swiss', 'pop', 'gradient'];
  return pool[hashStr(String(row.name || '')) % pool.length];
}
function designFor(row: Record<string, unknown>): Record<string, any> {
  const ds = (row.design_system && typeof row.design_system === 'object' ? row.design_system : {}) as Record<string, any>;
  const preset = ds.preset && (PRESETS as Record<string, unknown>)[ds.preset] ? ds.preset : presetFromTone(row);
  const primary = hex(row.primary_color), secondary = hex(row.secondary_color), accentCol = hex(row.accent_color);
  const cols = [primary, secondary, accentCol].filter(Boolean) as string[];
  const darkest = cols.filter((c) => isDark(c)).sort((a, b) => contrast(b, '#ffffff') - contrast(a, '#ffffff'))[0] || '#121417';
  const vivid = cols.filter((c) => !isDark(c) || contrast(c, '#000000') > 2.2);
  const accent = vivid[0] || accentCol || secondary || primary || '#ff5a36';
  const second = vivid[1] || (vivid[0] === secondary ? primary : secondary) || mix(accent, '#2b59ff', 0.5);
  const pal = ds.palette || {};
  const light = hex(row.card_paper) || mix(accent, '#ffffff', 0.9);
  const groundFor = (g: string) => (g === 'paper' || g === 'bands' ? light : g === 'block' ? accent : darkest);
  const palette = {
    ground: hex(pal.ground) || hex(row.card_bg) || groundFor(String((ds.style && ds.style.ground) || (PRESETS as any)[preset].ground)),
    ink: hex(pal.ink) || darkest,
    paper: hex(pal.paper) || hex(row.card_paper) || mix(accent, '#ffffff', 0.92),
    accent: hex(pal.accent) || accent,
    second: hex(pal.second) || second || accent,
  };
  const okFont = (f: unknown) => (typeof f === 'string' && (FONT_LIBRARY as Record<string, unknown>)[f] ? f : undefined);
  const fonts: Record<string, unknown> = {};
  const f = ds.fonts || {};
  if (okFont(f.display)) fonts.display = f.display;
  if (okFont(f.body)) fonts.body = f.body;
  if (okFont(f.mono)) fonts.mono = f.mono;
  if (okFont(f.hand)) fonts.hand = f.hand;
  if (Number.isFinite(f.displayWeight)) fonts.displayWeight = f.displayWeight;
  const style: Record<string, unknown> = {};
  const st = ds.style || {};
  for (const k of ['ground', 'ornament', 'rule', 'labelStyle', 'cta', 'displayCase', 'density']) if (typeof st[k] === 'string') style[k] = st[k];
  if (Array.isArray(st.lean)) style.lean = st.lean.filter((x: unknown) => typeof x === 'string');
  return {
    name: row.name, preset, palette, fonts, style,
    logo: { onDark: !!(ds.logo && ds.logo.onDark) },
    words: ['full', 'minimal', 'none', 'mix'].includes(ds.words) ? ds.words : 'full',
  };
}

// ── Content: the writer's fields, or the legacy render-content-card ones ──
function ds0(row: any): Record<string, any> { return (row && row.design_system && typeof row.design_system === 'object') ? row.design_system : {}; }
function hostOf(u: unknown) { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return ''; } }
function contentFrom(body: Record<string, any>, slide: number) {
  const s = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => s(x, 140)).filter(Boolean).slice(0, 6) : []);
  const subjectUrl = body.subject_url || body.wheel_url;
  if (body.content && typeof body.content === 'object') {
    const c = body.content;
    const ev = c.event && typeof c.event === 'object' ? {
      day: s(c.event.day, 4), month: s(c.event.month, 12), weekday: s(c.event.weekday, 12), time: s(c.event.time, 40), place: s(c.event.place, 80),
    } : undefined;
    return {
      label: s(c.label, 40), headline: s(c.headline, 140), sub: s(c.sub, 220), items: arr(c.items),
      number: s(c.number, 12), numberCaption: s(c.numberCaption, 80), quote: s(c.quote, 220), quoteBy: s(c.quoteBy, 60),
      event: ev && ev.day && ev.month ? ev : undefined, cta: s(c.cta, 40), footer: s(c.footer, 48) || hostOf(subjectUrl),
    };
  }
  const lines = arr(body.headline_lines);
  const facts = arr(body.fact_lines);
  let headline = lines.join(' ') || s(body.detail_name || body.quest_name, 140);
  if (slide > 1 && (body.detail_name || body.quest_name)) headline = s(body.detail_name || body.quest_name, 140);
  const C: Record<string, unknown> = {
    label: s(slide > 1 ? (body.detail_label || body.location) : (body.location || body.subject_name || body.wheel_name), 40),
    // Slide 1's facts support the hook; later slides ARE their facts.
    headline, sub: facts.join(' ').slice(0, 220), items: slide > 1 && facts.length >= 2 ? facts : [],
    cta: s(body.cta_text || body.footer_cta, 40), footer: hostOf(subjectUrl),
  };
  // A headline that leads with a figure can be set as a numeral card.
  const m = headline.match(/^(\d[\d,.]*\+?%?|\$\d[\d,.]*[kKmM]?)\s+(.{3,80})$/);
  if (m) { C.number = m[1]; C.numberCaption = m[2]; }
  return C;
}

async function userCanUseBrand(req: Request, supabase: any, brand: string) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data } = await supabase.auth.getUser(jwt);
  const u = data?.user;
  if (!u?.id) return false;
  if (u.email && ADMIN_EMAILS.includes(u.email)) return true;
  const { data: grant } = await supabase.from('cc_user_brands').select('brand').eq('user_id', u.id).eq('brand', brand).maybeSingle();
  return !!grant;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const brand = typeof body.brand === 'string' ? body.brand.trim() : '';
    const serverCall = !!CC_KEY && req.headers.get('x-cc-key') === CC_KEY;
    const preview = body.preview === true;
    if (!serverCall) {
      if (!preview || !brand || !(await userCanUseBrand(req, supabase, brand))) return json({ error: 'unauthorized' }, 401);
    }

    const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
    const slide = Math.max(1, Math.min(10, Number(body.slide) || 1));
    if (!preview && !/^[A-Za-z0-9_-]{3,40}$/.test(sku)) return json({ error: 'sku is required' }, 400);

    const { data: row } = brand
      ? await supabase.from('cc_brands').select('id, name, primary_color, secondary_color, accent_color, card_bg, card_paper, logo_url, character_asset_url, default_include_qr, default_include_character, brand_tone, brand_mission, target_audience, notes, content_niches, design_system, default_wheel_url').eq('name', brand).maybeSingle()
      : { data: null };
    // 2026-10-11 (v14): the homepage sample (site-preview, a server call) has
    // no brand row. It passes the site's name, colours and a short
    // description, so the look is derived the same way as an unscanned brand.
    const sample = serverCall && preview && !brand && typeof body.brand_name === 'string';
    const sampleRow = sample ? {
      name: String(body.brand_name).trim().slice(0, 60) || 'Brand',
      primary_color: hex(body.brand_colors?.primary), secondary_color: hex(body.brand_colors?.secondary), accent_color: hex(body.brand_colors?.accent),
      notes: typeof body.brand_hint === 'string' ? body.brand_hint.slice(0, 400) : '',
    } : null;
    const design = designFor(row || sampleRow || { name: brand || 'Brand' });
    if (sample && ['any', 'light', 'dark'].includes(body.logo_tone)) design.logo = body.logo_tone === 'any' ? { any: true } : { onDark: body.logo_tone === 'light' };
    if (sample && typeof body.design_font === 'string' && (FONT_LIBRARY as Record<string, unknown>)[body.design_font]) design.fonts = { ...design.fonts, display: body.design_font };
    // A design passed for a preview (the Brand look editor) overrides the saved one.
    if (preview && body.design && typeof body.design === 'object') {
      Object.assign(design, designFor({ ...(row || {}), name: brand, design_system: { ...((row?.design_system as object) || {}), ...body.design } }));
    }
    const ds = ((row?.design_system as Record<string, any>) || {});
    // A brand that chose the classic cards keeps them: the caller
    // (render-content-card) draws it the old way.
    if (ds.engine === 'classic' && !preview) return json({ ok: false, use_classic: true });

    // Assets: logo and character from the brand's saved settings; photos
    // from the brand kit or a storage URL in the request.
    const logoUrl = safeUrl(ds.logo_url || row?.logo_url, false);
    const includeMascot = body.include_character ?? ds.include_character ?? row?.default_include_character ?? true;
    const mascotUrl = safeUrl(body.mascot_url, true) || (includeMascot ? safeUrl(ds.mascot_url || row?.character_asset_url, false) : null);
    const photos = (Array.isArray(ds.photos) ? ds.photos.map((p: unknown) => safeUrl(p, false)).filter(Boolean) : []) as string[];
    const photoUrl = safeUrl(body.photo_url, true) || (photos.length && body.use_photo !== false ? photos[hashStr(sku + slide) % photos.length] : null);
    const includeQr = body.include_qr ?? ds.include_qr ?? row?.default_include_qr ?? true;
    const subjectUrl = safeUrl(body.subject_url || body.wheel_url, false);
    const content = contentFrom(body, slide);
    // 2026-10-12: Brad: "not put a link text ever on the image, unless its
    // the brands itself ... not other sites ever". The web address under the
    // button is only drawn for the brand's own site.
    if (!sample && typeof content.footer === 'string' && content.footer) {
      const own = new Set<string>([hostOf(row?.default_wheel_url), hostOf(ds0(row).source), hostOf(ds0(row).website)].filter(Boolean));
      const f = String(content.footer).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const looksLikeSite = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(f);
      if (looksLikeSite && own.size && ![...own].some((h) => f === h || f.endsWith('.' + h) || h.endsWith('.' + f))) content.footer = '';
    }

    // Variety: avoid the archetypes this brand used on its last posts and on
    // the other slides of this post.
    const avoid = new Set<string>(Array.isArray(body.avoid) ? body.avoid.filter((x: unknown) => typeof x === 'string') : []);
    let existingKinds: (string | null)[] = [];
    // 2026-10-14: backdrops this brand used lately (and on this post's other
    // slides), so the next card doesn't repeat them.
    const avoidLooks: string[] = [];
    if (!preview || brand) {
      const [{ data: same }, { data: recent }] = await Promise.all([
        sku ? supabase.from('content_calendar').select('card_kinds, card_looks').eq('sku', sku).maybeSingle() : Promise.resolve({ data: null }),
        brand ? supabase.from('content_calendar').select('card_kinds, card_looks').eq('brand', brand).neq('sku', sku || '-').not('card_kinds', 'is', null).order('created_at', { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
      ]);
      if (!preview) {
        existingKinds = Array.isArray(same?.card_kinds) ? same!.card_kinds as (string | null)[] : [];
        existingKinds.forEach((k, i) => { if (k && i !== slide - 1) avoid.add(k); });
        for (const r of ((recent || []) as { card_kinds: (string | null)[] }[]).slice(0, 3)) { const k = (r.card_kinds || [])[0]; if (k) avoid.add(k); }
      }
      const sameLooks = Array.isArray(same?.card_looks) ? same!.card_looks as (string | null)[] : [];
      sameLooks.forEach((l, i) => { if (l && i !== slide - 1) avoidLooks.push(l); });
      for (const r of (recent || []) as { card_looks: (string | null)[] | null }[]) for (const l of (r.card_looks || [])) if (l) avoidLooks.push(l);
    }

    const wordsSetting = typeof body.words === 'string' ? body.words : design.words;
    const seed = String(body.seed || `${sku}-${slide}`);
    // "mix" lets some posts go wordless, but never one that carries a date,
    // a figure or a list -- those facts are the point of the card.
    const factual = !!(content.event || content.number || (Array.isArray(content.items) && content.items.length));
    // A picture drawn for this post carries the headline: "mix" never makes it wordless.
    const drawnForPost = body.prefer_photo === true || body.prefer_mascot === true;
    // 2026-10-12: what a redo note asked for, read by submit-client-feedback
    // and passed by a server call: show the logo as it is, leave it off, or
    // make it bigger or smaller.
    // 2026-10-13: also on a signed-in preview (the image editor shows the change before saving).
    const logoDirective = (serverCall || preview) && ['as_is', 'hide'].includes(body.logo_mode) ? body.logo_mode as string : null;
    const logoScale = (serverCall || preview) && ['bigger', 'smaller'].includes(body.logo_size) ? body.logo_size as string : undefined;
    const logoSide = ['left', 'right', 'center'].includes(body.logo_side) ? body.logo_side as string : undefined;
    const qrSide = ['left', 'right'].includes(body.qr_side) ? body.qr_side as string : undefined;
    const swapColors = body.swap_colors === true;
    let words = wordsSetting === 'mix' ? (!factual && !drawnForPost && hashStr(seed) % 4 === 0 ? 'none' : 'full') : wordsSetting;
    // A wordless card is the logo itself; with the logo left off it needs words.
    if (logoDirective === 'hide' && words === 'none') words = 'full';
    if (logoDirective === 'hide') avoid.add('mark');

    const logoWhiteUrl = logoUrl ? safeUrl(ds.logo_white_url, false) : null;
    const [qr, logo, mascot, photo, logoWhite] = await Promise.all([
      includeQr && subjectUrl && words !== 'none' ? QRCode.toString(subjectUrl, { type: 'svg', margin: 0, color: { dark: '#111111', light: '#ffffff' } }) : Promise.resolve(null),
      toDataUri(logoUrl), toDataUri(mascotUrl), toDataUri(photoUrl), toDataUri(logoWhiteUrl), ensureWasm(),
    ]);
    // Sample only: images the caller already fetched and checked (PNG, JPEG
    // or SVG data, size-capped). Nobody else can pass image data.
    const DATA_IMG = /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+\/]+=*$/;
    const given = (v: unknown) => (sample && typeof v === 'string' && v.length < 1_700_000 && DATA_IMG.test(v) ? v : null);
    const ad = (body.asset_data && typeof body.asset_data === 'object') ? body.asset_data : {};
    const logoA = given(ad.logo) || logo, mascotA = given(ad.mascot) || mascot, photoA = given(ad.photo) || photo;
    // The logo's own colours decide how it is drawn (see logoToneOf). A
    // brand that marked its logo as made for dark grounds keeps that, unless
    // the note asked for the logo as it is.
    const logoTone = logoA ? logoToneOf(logoA) : null;
    if (!sample && logoA && (logoDirective === 'as_is' || (logoTone === 'any' && !(ds.logo && ds.logo.onDark === true)))) design.logo = { any: true };
    const logoWhiteA = design.logo && (design.logo as Record<string, unknown>).any === true ? null : logoWhite;
    const loaded = await Promise.all(requiredFonts(design).map((f: { family: string; weight: number }) => loadFont(f.family, nearestWeight(f.family, f.weight))));
    const input = {
      design, content,
      assets: { logo: logoDirective === 'hide' ? null : logoA, logoWhite: logoDirective === 'hide' ? null : logoWhiteA, mascot: mascotA, photo: photoA, qrSvg: qr },
      opts: { width: W, height: H, seed, words, avoid: [...avoid], photoFit: sample && body.photo_fit === 'contain' ? 'contain' : undefined, kind: typeof body.kind === 'string' && body.prefer_photo !== true ? body.kind : (body.prefer_photo === true || body.prefer_mascot === true ? undefined : (content.items && content.items.length > 0 ? 'list' : (content.headline ? 'statement' : undefined))), preferPhoto: body.prefer_photo === true && !!photoA, preferMascot: body.prefer_mascot === true && !!mascotA, vary: !(typeof body.template_url === 'string' && body.template_url) && ds.lock_look !== true, look: typeof body.look === 'string' ? body.look : undefined, avoidLooks: avoidLooks.slice(0, 18), hideLogo: logoDirective === 'hide', showLogo: logoDirective === 'as_is' || !!logoScale || !!logoSide, logoScale, logoSide, qrSide, swapColors },
    };
    const card = buildCard(input, measureWith(loaded));
    // optimizeSvg drops satori's no-op masks and clips, which otherwise cost
    // the rasterizer a full offscreen layer each (about 3x the raster time).
    const svg = optimizeSvg(await satori(card.tree, {
      width: W, height: H,
      fonts: loaded.map((f) => ({ name: f.family, data: f.data, weight: f.weight as any, style: 'normal' as const })),
    }));
    const meta = { engine: 'v2', kind: card.kind, preset: design.preset, logoMode: card.logoMode, look: card.look || null, logoTone, logoAsIs: !!(design.logo && (design.logo as Record<string, unknown>).any), seed, mascotMode: card.mascotMode || null, words, fonts: [design.fonts.display || (PRESETS as any)[design.preset].fonts[0], design.fonts.body || (PRESETS as any)[design.preset].fonts[1]], assets: { logo: !!logoA, mascot: !!mascotA, photo: !!photoA, qr: !!qr }, avoided: [...avoid], ms: Date.now() - t0 };

    if (preview) {
      const small = withPngText(new Resvg(svg, { fitTo: { mode: 'width', value: Math.min(1080, Math.max(240, Number(body.preview_width) || 540)) } }).render().asPng(), cardDetails(content, String(design.name || brand || ''), slide, subjectUrl, body));
      return json({ ok: true, preview: true, png: `data:image/png;base64,${encodeBase64(small)}`, ...meta, ms: Date.now() - t0 });
    }
    const pngBuffer = withPngText(new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng(), cardDetails(content, String(design.name || brand || ''), slide, subjectUrl, body));

    const destPath = `content-calendar/${sku}/card_${slide}.png`;
    const { error: upErr } = await supabase.storage.from('wheel-assets').upload(destPath, pngBuffer, { contentType: 'image/png', upsert: true });
    if (upErr) return json({ error: `storage upload failed: ${upErr.message}` }, 500);
    const { data: pub } = supabase.storage.from('wheel-assets').getPublicUrl(destPath);
    const baseUrl = pub.publicUrl;
    const publicUrl = `${baseUrl}?v=${Date.now()}`;

    let thumbDataUri: string | null = null;
    // The base64 thumb only feeds the legacy SpinQuest artifact; the
    // dashboard reads media_urls. It costs a second raster pass, so it is
    // drawn only when asked for or for SpinQuest.
    const wantThumb = body.thumbs === true || (body.thumbs !== false && /^spinquest$/i.test(brand));
    if (wantThumb && slide <= 3) {
      const thumbBuf = new Resvg(svg, { fitTo: { mode: 'width', value: 240 } }).render().asPng();
      thumbDataUri = `data:image/png;base64,${encodeBase64(thumbBuf)}`;
    }
    const basePathOf = (u: string) => String(u).split('?')[0];
    const slideNumOf = (u: string) => { const m = basePathOf(u).match(/card_(\d+)\.png$/); return m ? parseInt(m[1], 10) : 99; };
    const { data: existing } = await supabase.from('content_calendar').select('media_urls, card_kinds, card_seeds, card_looks').eq('sku', sku).maybeSingle();
    if (!existing) return json({ error: 'no content_calendar row for that sku', url: publicUrl }, 404);
    const kept = ((existing.media_urls as string[]) || []).filter((u: string) => basePathOf(u) !== baseUrl);
    const merged = [...kept, publicUrl].sort((a, b) => slideNumOf(a) - slideNumOf(b));
    const kinds = Array.isArray(existing.card_kinds) ? [...existing.card_kinds] : [];
    while (kinds.length < slide) kinds.push(null);
    kinds[slide - 1] = card.kind;
    // 2026-10-13: the seed too, so an edit can redraw this exact image.
    const seeds = Array.isArray(existing.card_seeds) ? [...existing.card_seeds] : [];
    while (seeds.length < slide) seeds.push(null);
    seeds[slide - 1] = seed;
    const looks = Array.isArray(existing.card_looks) ? [...existing.card_looks] : [];
    while (looks.length < slide) looks.push(null);
    looks[slide - 1] = card.look || null;
    const patch: Record<string, unknown> = { media_urls: merged, card_kinds: kinds, card_seeds: seeds, card_looks: looks };
    if (thumbDataUri !== null) patch[slide === 1 ? 'thumb_data_uri' : slide === 2 ? 'thumb_data_uri_2' : 'thumb_data_uri_3'] = thumbDataUri;
    const { error: dbErr } = await supabase.from('content_calendar').update(patch).eq('sku', sku);
    if (dbErr) return json({ error: `db update failed: ${dbErr.message}` }, 500);

    return json({ ok: true, sku, slide, url: publicUrl, bytes: pngBuffer.length, thumb: thumbDataUri !== null, layout: card.kind, ...meta });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

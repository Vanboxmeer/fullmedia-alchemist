// Supabase Edge Function: render-content-card (v29)
//
// v29 (2026-09-11): added slide 3 -- a dedicated "closing/CTA" card. No new
// SVG layout was needed: buildDetailSvg is generic enough (subject/detail
// name, label, fact lines, footer CTA) to serve as the closing card too --
// the caller (generate-campaign-content) just passes closing-focused copy
// and a different detail_label ("READY?" style) instead of the Quest
// Spotlight framing slide 2 uses. Added thumb_data_uri_3 alongside the
// existing thumb_data_uri/thumb_data_uri_2 so the third slide gets its own
// preview exactly like the first two.
//
// v27: three new full-scene motifs for SpinQuest's Nov 2026 real-event batch
// (Brad: "upgrade SpinQuest too" -- bring the full-scene background treatment
// to SpinQuest cards, not just the small-icon legacy look): `bonfire`
// (Lewes Bonfire Night -- blazing log pile, flame tongues, rising sparks,
// firework bursts), `harvestfair` (Royal Agricultural Winter Fair -- barn
// gable, wheat sheaves, award-ribbon rosettes), `arctic` (Churchill polar
// bear/tundra season -- aurora arcs over a horizon of ice floes). Same
// pattern as the v25 scene motifs: full-bleed 1080x1350, colored via the
// caller's decorHex/decorHex2, added to SCENE_MOTIFS + sceneForMotif so
// SpinQuest posts can opt into a bespoke full-scene background by passing
// one of these three as `motif` (SpinQuest brand isn't in brandDefaults, so
// motif/bg_hex/decor_hex/decor_hex_2 must be passed explicitly per-call).
//
// v26: fixed a pre-existing broken mascot URL for Reading Race -- brandDefaults()
// pointed at content-calendar/brand-assets/reading-race/dash-variants/default.png,
// which never existed (404); the Dash variants have always actually lived at
// content-calendar/dash-variants/{key}.png (see generate-dash-variants-oneoff).
// Corrected the path so Reading Race hero/detail cards stop throwing on render.
//
// v25: full-scene backgrounds. Brad: "the grey dot under him does not need to
// be there either. and change the backgrounds more to be more part of the
// whole scene not just small abstract shapes... improve more full screen
// content not just [weak] things". Two changes: (1) the Dash mascot's grey
// shadow blob was baked into the source PNG and got carried into every
// variant -- fixed upstream (generate-dash-variants-oneoff v2 + a canvas
// cleanup pass), nothing to change here. (2) bgAndDecor() used to draw two
// faint ring outlines plus one ~380px motif icon tucked in the upper-right
// corner -- it read as a corner sticker on a flat gradient, not a scene.
// The six motifs actually in use on Watch Crypto, Reading Race, and Evrylife
// cards (candlestick, circuit, racetrack, bookstack, spiral, protocol-nodes)
// now render as full-bleed illustrated scenes filling the entire 1080x1350
// canvas edge-to-edge -- a real skyline of market bars, a full circuit-board
// lattice, a converging racetrack with a checkered band, a stack of books
// plus an open book spread, a network of rings filling most of the frame,
// and a mesh of nodes spread across the whole card. A top and bottom scrim
// keep headline/QR/fact text legible over the busier art. Motifs outside
// this set (SpinQuest's ~15 legacy motifs) fall back to the old icon
// repeated at three scales/positions across the canvas instead of one small
// corner instance -- better than before, but a full bespoke redesign of
// those is a separate, larger pass.
//
// v23: brand-defaults / CTA / label / mascot-size fixes (generic placeholder
// text leaking onto non-SpinQuest brands; Dash mascot too small).
// v22: richer backgrounds (superseded by v25 above).
// v21: brand theming (bgHex/accentHex/decorHex/logo/mascot per brand).
// v18-v20: QR box match, auto-fit-to-width text, optional `motif` param.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';
import QRCode from 'npm:qrcode@1.5.3';

let wasmReady: Promise<void> | null = null;
function ensureWasm() {
  if (!wasmReady) {
    wasmReady = fetch('https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm')
      .then((r) => r.arrayBuffer())
      .then((buf) => initWasm(buf));
  }
  return wasmReady;
}

const MODERN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// v37: three families, not one. Poppins still sets every card's body text
// (it's the brand's workhorse and the width estimator is calibrated to it),
// but a layout can set its HEADLINE in a high-contrast serif or a condensed
// grotesque instead -- the single loudest way to make two cards not look
// like the same card. If a family fails to load, resvg falls back to the
// default family, which degrades to the old look rather than to nothing.
// v40: one stylesheet per family, fetched and cached separately, because a
// render is handed exactly one family's files. Loading all three at once is
// what let the font matcher pick whichever face it liked and set the card in
// it regardless of what each element asked for. Each family is loaded at
// both a body weight and a bold weight so a single-family card still has
// real hierarchy.
const FONT_CSS: Record<string, string> = {
  Poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
  Arvo: 'https://fonts.googleapis.com/css2?family=Arvo:wght@400;700&display=swap',
  Oswald: 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap',
};

// v42: a brand can name ANY Google family, so the URL is built rather than
// looked up. Only letters, digits and spaces survive sanitising -- this
// string goes into a URL, and a brand name field is user input.
function googleCssUrl(family: string): string {
  const clean = String(family).replace(/[^A-Za-z0-9 ]/g, '').trim().replace(/\s+/g, '+');
  return `https://fonts.googleapis.com/css2?family=${clean}:wght@400;700&display=swap`;
}

function isUsableFamily(family?: string | null): family is string {
  if (!family) return false;
  const clean = String(family).replace(/[^A-Za-z0-9 ]/g, '').trim();
  return clean.length >= 2 && clean.length <= 48;
}

function fetchFontFamily(cssUrl: string): Promise<Uint8Array[]> {
  return fetch(cssUrl, { headers: { 'User-Agent': MODERN_UA } })
    .then((r) => {
      if (!r.ok) throw new Error(`google fonts css fetch failed: ${r.status}`);
      return r.text();
    })
    .then((css) => {
      const urls = Array.from(new Set(Array.from(css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)).map((m) => m[1])));
      if (!urls.length) throw new Error('no font src urls found in google fonts css response');
      return Promise.all(urls.map((u) => fetch(u).then((r) => {
        if (!r.ok) throw new Error(`font file fetch ${u} failed: ${r.status}`);
        return r.arrayBuffer();
      }).then((buf) => new Uint8Array(buf))));
    });
}

const familyCache: Record<string, Promise<Uint8Array[]>> = {};

function ensureFontFamily(family: string): Promise<Uint8Array[]> {
  // A known family uses its curated stylesheet (more weights); anything else
  // is treated as a Google family name and its URL is built.
  const key = FONT_CSS[family] ? family : (isUsableFamily(family) ? family : 'Poppins');
  const url = FONT_CSS[key] || googleCssUrl(key);
  if (!familyCache[key]) {
    familyCache[key] = fetchFontFamily(url).catch((e) => {
      // Don't cache a failure -- the next render should be able to retry.
      delete familyCache[key];
      throw e;
    });
  }
  return familyCache[key];
}

// A missing font file must never cost a card. If the layout's face can't be
// fetched, the render falls back to Poppins, which is the pre-v37 look.
async function fontBuffersFor(family: string): Promise<Uint8Array[]> {
  try {
    return await ensureFontFamily(family);
  } catch (_e) {
    return await ensureFontFamily('Poppins');
  }
}

function ensureFonts() {
  return ensureFontFamily('Poppins');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cc-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Server key comes from the CC_KEY Edge secret (never written in code).
const CC_KEY = (Deno.env.get('CC_KEY') || '').trim();
const DEFAULT_WIZARD_URL = 'https://spinquest.app/wizard.png';
const DEFAULT_LOGO_URL = 'https://spinquest.app/logo-wheel-white.svg';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function toDataUri(url: string, mime = 'image/png'): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return `data:${mime};base64,${encodeBase64(buf)}`;
}

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const W = 1080, H = 1350;
const NAVY = '#0F172A';
const CYAN = '#22D3EE';
const INDIGO = '#6366F1';
const WHITE = '#FFFFFF';

// ---- Brand theming ------
// Only place brand-specific defaulting happens. Explicit params always win.
function isSpinQuest(brand?: string) {
  return !brand || brand.trim().toLowerCase() === 'spinquest';
}

type BrandTheme = {
  bgHex: string; accentHex: string; decorHex: string; decorHex2: string;
  logoUrl?: string; mascotUrl?: string; motif?: string; wordmark?: string;
  detailLabel?: string; ctaTemplate?: string; footerCta?: string; qrCaption?: [string, string];
};

function brandDefaults(brand?: string): BrandTheme | null {
  const b = (brand || '').trim().toLowerCase();
  if (b === 'evrylife' || b === 'evrylife foundation') {
    return {
      bgHex: '#0B1220', accentHex: '#1F8FFF', decorHex: '#38BDF8', decorHex2: '#34D399',
      logoUrl: 'https://evrylife.org/brand/evrylife-logo-blue.svg',
      motif: 'protocol-nodes', wordmark: 'EVRYLIFE',
      detailLabel: 'DEEP DIVE',
      ctaTemplate: 'Explore {subject} on Evrylife',
      footerCta: 'Explore Evrylife to see this live',
      qrCaption: ['Scan to', 'explore'],
    };
  }
  if (b === 'watch crypto' || b === 'watchcrypto') {
    return {
      bgHex: '#0B1120', accentHex: '#1E3A8A', decorHex: '#3B82F6', decorHex2: '#22C55E',
      logoUrl: 'https://watchcrypto.info/logo-512.png',
      motif: 'candlestick', wordmark: 'WATCH CRYPTO',
      detailLabel: 'BY THE NUMBERS',
      ctaTemplate: 'See {subject} on Watch Crypto',
      footerCta: 'Open Watch Crypto to see this live',
      qrCaption: ['Scan to', 'track live'],
    };
  }
  if (b === 'reading race' || b === 'readingrace') {
    return {
      bgHex: '#1B0F2E', accentHex: '#6421AF', decorHex: '#C084FC', decorHex2: '#67E8F9',
      logoUrl: 'https://tpqvvrdglnsdljdpzwfl.supabase.co/storage/v1/object/public/wheel-assets/content-calendar/brand-assets/reading-race/logo.png',
      mascotUrl: 'https://tpqvvrdglnsdljdpzwfl.supabase.co/storage/v1/object/public/wheel-assets/content-calendar/dash-variants/default.png',
      motif: 'bookstack', wordmark: 'READING RACE',
      detailLabel: 'RACE SPOTLIGHT',
      ctaTemplate: 'Join the {subject} race',
      footerCta: 'Join Reading Race to see this live',
      qrCaption: ['Scan to', 'join the race'],
    };
  }
  return null; // SpinQuest / unrecognized brand -> legacy NAVY/CYAN/INDIGO look
}

// ---- Auto-fit-to-width helpers ------
function avgCharWidthFactor(weight: number): number {
  if (weight >= 700) return 0.60;
  if (weight >= 600) return 0.565;
  if (weight >= 500) return 0.53;
  return 0.50;
}
function estTextWidth(text: string, fontSize: number, weight: number): number {
  return text.length * fontSize * avgCharWidthFactor(weight);
}
function fitFontSize(text: string, maxWidth: number, startSize: number, minSize: number, weight: number): number {
  let size = startSize;
  while (size > minSize && estTextWidth(text, size, weight) > maxWidth) size -= 2;
  return Math.max(size, minSize);
}
function splitTwoLines(text: string): [string, string] {
  const words = text.split(' ');
  if (words.length < 2) return [text, ''];
  let bestI = 1, bestDiff = Infinity;
  const total = text.length;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ').length;
    const diff = Math.abs(l1 - total / 2);
    if (diff < bestDiff) { bestDiff = diff; bestI = i; }
  }
  return [words.slice(0, bestI).join(' '), words.slice(bestI).join(' ')];
}
// Hard guarantee: after font-size shrinking has hit its floor, truncate with
// an ellipsis so estimated width can never exceed maxWidth. This is the final
// safety net -- shrinking alone isn't enough for pathologically long strings.
// v41: the card's line-breaking rule. Splits on word boundaries and NEVER
// mid-word. The only call to truncateToFit is the genuinely impossible case
// -- a single unbreakable token wider than the whole line (a URL, a long
// hashtag) -- because there is nothing else to do with it. Everything else
// wraps onto another line, and the caller shrinks the type if the extra
// lines don't fit.
function wrapToWidth(text: string, fontSize: number, maxWidth: number, weight: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      // A word that can't fit a line of its own is the one case where
      // there's no honest alternative to an ellipsis.
      cur = estTextWidth(w, fontSize, weight) > maxWidth
        ? truncateToFit(w, fontSize, maxWidth, weight)
        : w;
      continue;
    }
    const trial = `${cur} ${w}`;
    if (estTextWidth(trial, fontSize, weight) <= maxWidth) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = estTextWidth(w, fontSize, weight) > maxWidth
        ? truncateToFit(w, fontSize, maxWidth, weight)
        : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Wrap at the largest size in [minSize, startSize] whose wrapped block fits
// both the width and `maxLines`. Returns the chosen size and its lines.
function fitWrapped(
  text: string, maxWidth: number, startSize: number, minSize: number, weight: number, maxLines: number,
): { size: number; lines: string[] } {
  let size = startSize;
  let lines = wrapToWidth(text, size, maxWidth, weight);
  while (size > minSize && lines.length > maxLines) {
    size -= 2;
    lines = wrapToWidth(text, size, maxWidth, weight);
  }
  return { size, lines };
}

function truncateToFit(text: string, fontSize: number, maxWidth: number, weight: number): string {
  if (estTextWidth(text, fontSize, weight) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && estTextWidth(t + '…', fontSize, weight) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length > 0 ? t + '…' : '…';
}

async function sharedAssets(mascotUrl?: string, logoUrl?: string) {
  const [mascotUri, logoUri] = await Promise.all([
    mascotUrl ? toDataUri(mascotUrl) : Promise.resolve(''),
    logoUrl ? toDataUri(logoUrl, logoUrl.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png').catch(() => '') : Promise.resolve(''),
  ]);
  return { mascotUri, logoUri };
}

async function qrGroup(url: string, x: number, y: number, box: number, pad: number) {
  const qrSvg: string = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
  const qrInner = qrSvg.replace(/^<\?xml[^>]*>/, '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const viewBoxMatch = qrSvg.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 100 100';
  return `<rect x="${x}" y="${y}" width="${box}" height="${box}" rx="16" fill="${WHITE}"/>\n    <svg x="${x + pad}" y="${y + pad}" width="${box - pad * 2}" height="${box - pad * 2}" viewBox="${viewBox}">${qrInner}</svg>`;
}

function motifIcon(motif: string | undefined, decorHex: string, decorHex2: string): string {
  const cx = 900, cy = 230;
  switch (motif) {
    case 'safari':
      return `<circle cx="${cx}" cy="${cy - 40}" r="70" fill="none" stroke="${CYAN}" stroke-opacity="0.16" stroke-width="3"/>
        <path d="M ${cx - 150} ${cy + 90} L ${cx - 110} ${cy - 10} L ${cx - 70} ${cy + 90} Z" fill="none" stroke="${WHITE}" stroke-opacity="0.14" stroke-width="3"/>
        <path d="M ${cx - 40} ${cy + 90} L ${cx + 10} ${cy - 40} L ${cx + 60} ${cy + 90} Z" fill="none" stroke="${WHITE}" stroke-opacity="0.14" stroke-width="3"/>`;
    case 'coastal':
      return [0, 1, 2].map((i) => `<path d="M ${cx - 180} ${cy - 20 + i * 50} Q ${cx - 90} ${cy - 70 + i * 50} ${cx} ${cy - 20 + i * 50} T ${cx + 180} ${cy - 20 + i * 50}" fill="none" stroke="${CYAN}" stroke-opacity="0.14" stroke-width="3"/>`).join('\n');
    case 'cycling':
      return `<circle cx="${cx}" cy="${cy}" r="110" fill="none" stroke="${WHITE}" stroke-opacity="0.14" stroke-width="3"/>
        ${Array.from({ length: 8 }).map((_, i) => { const a = (Math.PI / 4) * i; const x2 = cx + Math.cos(a) * 110; const y2 = cy + Math.sin(a) * 110; return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${CYAN}" stroke-opacity="0.12" stroke-width="2"/>`; }).join('\n')}`;
    case 'theatre':
      return `<path d="M ${cx - 170} ${cy - 100} Q ${cx - 140} ${cy} ${cx - 170} ${cy + 110}" fill="none" stroke="${INDIGO}" stroke-opacity="0.18" stroke-width="4"/>
        <path d="M ${cx + 170} ${cy - 100} Q ${cx + 140} ${cy} ${cx + 170} ${cy + 110}" fill="none" stroke="${INDIGO}" stroke-opacity="0.18" stroke-width="4"/>
        <ellipse cx="${cx}" cy="${cy}" rx="90" ry="50" fill="none" stroke="${WHITE}" stroke-opacity="0.14" stroke-width="3"/>`;
    case 'alpine-music':
      return `<path d="M ${cx - 190} ${cy + 90} L ${cx - 110} ${cy - 60} L ${cx - 30} ${cy + 90} Z" fill="none" stroke="${WHITE}" stroke-opacity="0.15" stroke-width="3"/>
        <path d="M ${cx - 60} ${cy + 90} L ${cx + 40} ${cy - 90} L ${cx + 140} ${cy + 90} Z" fill="none" stroke="${WHITE}" stroke-opacity="0.15" stroke-width="3"/>
        <path d="M ${cx + 25} ${cy - 60} l 8 14 l 8 -6 l 8 16" fill="none" stroke="${CYAN}" stroke-opacity="0.2" stroke-width="3"/>`;
    case 'canal':
      return [0, 1].map((i) => `<path d="M ${cx - 180} ${cy + 20 + i * 60} Q ${cx - 90} ${cy - 20 + i * 60} ${cx} ${cy + 20 + i * 60} T ${cx + 180} ${cy + 20 + i * 60}" fill="none" stroke="${CYAN}" stroke-opacity="0.14" stroke-width="3"/>`).join('\n')
        + `<path d="M ${cx - 90} ${cy - 60} A 90 60 0 0 1 ${cx + 90} ${cy - 60}" fill="none" stroke="${WHITE}" stroke-opacity="0.15" stroke-width="3"/>`;
    case 'carnival':
      return Array.from({ length: 10 }).map((_, i) => { const x = cx - 190 + (i * 42) % 400; const y = cy - 90 + ((i * 67) % 200); const r = 6 + (i % 3) * 4; const col = i % 2 === 0 ? CYAN : WHITE; return `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" fill-opacity="0.14"/>`; }).join('\n');
    case 'pride':
      return [0, 1, 2, 3].map((i) => `<path d="M ${cx - 170} ${cy + 100 - i * 24} A ${170 - i * 24} ${170 - i * 24} 0 0 1 ${cx + 170} ${cy + 100 - i * 24}" fill="none" stroke="${CYAN}" stroke-opacity="${0.09 + i * 0.02}" stroke-width="5"/>`).join('\n');
    case 'skyline':
      return [40, 90, 60, 130, 50, 100].map((h, i) => `<rect x="${cx - 180 + i * 62}" y="${cy + 100 - h}" width="34" height="${h}" fill="none" stroke="${WHITE}" stroke-opacity="0.13" stroke-width="2"/>`).join('\n');
    case 'shrine':
      return `<line x1="${cx - 110}" y1="${cy - 90}" x2="${cx - 110}" y2="${cy + 100}" stroke="${INDIGO}" stroke-opacity="0.2" stroke-width="6"/>
        <line x1="${cx + 110}" y1="${cy - 90}" x2="${cx + 110}" y2="${cy + 100}" stroke="${INDIGO}" stroke-opacity="0.2" stroke-width="6"/>
        <line x1="${cx - 140}" y1="${cy - 90}" x2="${cx + 140}" y2="${cy - 90}" stroke="${INDIGO}" stroke-opacity="0.2" stroke-width="8"/>
        <line x1="${cx - 125}" y1="${cy - 60}" x2="${cx + 125}" y2="${cy - 60}" stroke="${INDIGO}" stroke-opacity="0.16" stroke-width="5"/>`;
    case 'festival-river':
      return `<path d="M ${cx - 180} ${cy + 60} Q ${cx - 90} ${cy + 100} ${cx} ${cy + 60} T ${cx + 180} ${cy + 60}" fill="none" stroke="${CYAN}" stroke-opacity="0.14" stroke-width="3"/>
        ${Array.from({ length: 5 }).map((_, i) => `<path d="M ${cx - 150 + i * 70} ${cy - 60} L ${cx - 130 + i * 70} ${cy - 20} L ${cx - 170 + i * 70} ${cy - 20} Z" fill="${WHITE}" fill-opacity="0.12"/>`).join('\n')}`;
    case 'stargazing':
      return Array.from({ length: 12 }).map((_, i) => { const x = cx - 190 + ((i * 53) % 380); const y = cy - 100 + ((i * 71) % 220); return `<circle cx="${x}" cy="${y}" r="2.5" fill="${WHITE}" fill-opacity="0.3"/>`; }).join('\n')
        + `<line x1="${cx + 150}" y1="${cy - 90}" x2="${cx + 40}" y2="${cy - 10}" stroke="${CYAN}" stroke-opacity="0.25" stroke-width="2"/>`;
    case 'mosaic':
      return Array.from({ length: 16 }).map((_, i) => { const col = i % 4; const row = Math.floor(i / 4); const x = cx - 180 + col * 46 + (row % 2) * 12; const y = cy - 90 + row * 46; return `<rect x="${x}" y="${y}" width="26" height="26" rx="4" fill="none" stroke="${(row + col) % 2 === 0 ? CYAN : WHITE}" stroke-opacity="0.14" stroke-width="2"/>`; }).join('\n');
    case 'stadium':
      return [-1, 0, 1].map((i) => `<path d="M ${cx + i * 30} ${cy - 90} L ${cx + i * 100 - 60} ${cy + 100} L ${cx + i * 100 + 60} ${cy + 100} Z" fill="${WHITE}" fill-opacity="0.06"/>`).join('\n');
    case 'tropical':
      return Array.from({ length: 5 }).map((_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2; const x2 = cx + Math.cos(a) * 110; const y2 = cy + Math.sin(a) * 90; return `<path d="M ${cx} ${cy} Q ${(cx + x2) / 2} ${cy - 40} ${x2} ${y2}" fill="none" stroke="${CYAN}" stroke-opacity="0.16" stroke-width="4"/>`; }).join('\n');

    // ---- New brand-specific motifs (v21) ----
    case 'candlestick': {
      // Market chart: a row of candlesticks with wicks, alternating up/down.
      const bars = [38, -52, 60, -30, 70, -44, 50, -60, 42, -35];
      let x = cx - 195;
      const parts: string[] = [];
      for (let i = 0; i < bars.length; i++) {
        const h = bars[i];
        const up = h > 0;
        const barH = Math.abs(h);
        const y = up ? cy - barH : cy;
        const col = up ? decorHex2 : decorHex;
        parts.push(`<line x1="${x + 17}" y1="${y - 16}" x2="${x + 17}" y2="${y + barH + 16}" stroke="${col}" stroke-opacity="0.28" stroke-width="2"/>`);
        parts.push(`<rect x="${x}" y="${y}" width="34" height="${barH}" fill="${col}" fill-opacity="0.22"/>`);
        x += 44;
      }
      parts.push(`<path d="M ${cx - 195} ${cy + 70} L ${cx - 130} ${cy + 20} L ${cx - 60} ${cy + 55} L ${cx + 10} ${cy - 30} L ${cx + 80} ${cy - 10} L ${cx + 150} ${cy - 80} L ${cx + 195} ${cy - 60}" fill="none" stroke="${decorHex2}" stroke-opacity="0.3" stroke-width="3"/>`);
      return parts.join('\n');
    }
    case 'circuit': {
      // Blockchain / circuit-board node lattice.
      const nodes = [[-170, -70], [-90, -20], [-10, -80], [70, -10], [150, -70], [-130, 60], [30, 70], [130, 40]];
      const parts: string[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const [x1, y1] = nodes[i]; const [x2, y2] = nodes[(i + 1) % nodes.length];
        parts.push(`<line x1="${cx + x1}" y1="${cy + y1}" x2="${cx + x2}" y2="${cy + y2}" stroke="${decorHex}" stroke-opacity="0.16" stroke-width="2"/>`);
      }
      for (const [x, y] of nodes) {
        parts.push(`<circle cx="${cx + x}" cy="${cy + y}" r="6" fill="${decorHex2}" fill-opacity="0.3"/>`);
      }
      return parts.join('\n');
    }
    case 'protocol-nodes': {
      // Decentralized network graph radiating from a hub -- protocol/DAO feel.
      const parts: string[] = [`<circle cx="${cx}" cy="${cy}" r="14" fill="${decorHex}" fill-opacity="0.35"/>`];
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        const r = 130 + (i % 2) * 30;
        const x2 = cx + Math.cos(a) * r;
        const y2 = cy + Math.sin(a) * r;
        const col = i % 2 === 0 ? decorHex : decorHex2;
        parts.push(`<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-opacity="0.18" stroke-width="2"/>`);
        parts.push(`<circle cx="${x2}" cy="${y2}" r="8" fill="${col}" fill-opacity="0.3"/>`);
      }
      return parts.join('\n');
    }
    case 'spiral': {
      // Concentric arcs, echoing a protocol "mark" motif.
      return [0, 1, 2, 3, 4].map((i) => `<path d="M ${cx - (190 - i * 24)} ${cy + 40} A ${190 - i * 24} ${190 - i * 24} 0 0 1 ${cx + (190 - i * 24)} ${cy + 40}" fill="none" stroke="${i % 2 === 0 ? decorHex : decorHex2}" stroke-opacity="${0.10 + i * 0.02}" stroke-width="4"/>`).join('\n');
    }
    case 'bookstack': {
      // Open book: two curved page-flaps plus horizontal "text" rules.
      const parts: string[] = [];
      parts.push(`<path d="M ${cx - 190} ${cy - 60} Q ${cx - 100} ${cy - 100} ${cx} ${cy - 70} Q ${cx + 100} ${cy - 100} ${cx + 190} ${cy - 60} L ${cx + 190} ${cy + 90} Q ${cx + 100} ${cy + 55} ${cx} ${cy + 85} Q ${cx - 100} ${cy + 55} ${cx - 190} ${cy + 90} Z" fill="none" stroke="${decorHex}" stroke-opacity="0.2" stroke-width="3"/>`);
      parts.push(`<line x1="${cx}" y1="${cy - 68}" x2="${cx}" y2="${cy + 83}" stroke="${decorHex}" stroke-opacity="0.2" stroke-width="2"/>`);
      for (let i = 0; i < 3; i++) {
        const y = cy - 20 + i * 24;
        parts.push(`<line x1="${cx - 150}" y1="${y}" x2="${cx - 30}" y2="${y - 6}" stroke="${decorHex2}" stroke-opacity="0.18" stroke-width="2"/>`);
        parts.push(`<line x1="${cx + 30}" y1="${y - 6}" x2="${cx + 150}" y2="${y}" stroke="${decorHex2}" stroke-opacity="0.18" stroke-width="2"/>`);
      }
      return parts.join('\n');
    }
    case 'racetrack': {
      // Oval race track with a checkered finish-line accent.
      const parts: string[] = [];
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="190" ry="95" fill="none" stroke="${decorHex}" stroke-opacity="0.18" stroke-width="10"/>`);
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="120" ry="55" fill="none" stroke="${decorHex}" stroke-opacity="0.12" stroke-width="4"/>`);
      for (let i = 0; i < 6; i++) {
        const x = cx - 15 + (i % 2) * 15;
        const y = cy - 95 + i * 8;
        parts.push(`<rect x="${x}" y="${y}" width="15" height="8" fill="${decorHex2}" fill-opacity="${(i % 2 === 0) ? 0.28 : 0.12}"/>`);
      }
      return parts.join('\n');
    }
    default:
      return '';
  }
}

// ---- v25: full-scene backgrounds ------
// These six motifs render as full-bleed illustrated scenes filling the whole
// 1080x1350 canvas edge-to-edge, instead of one small corner icon.
const SCENE_MOTIFS = new Set(['candlestick', 'circuit', 'racetrack', 'bookstack', 'spiral', 'protocol-nodes', 'bonfire', 'harvestfair', 'arctic']);

function sceneCandlestick(decorHex: string, decorHex2: string): string {
  // A full-width "skyline" of market bars along the bottom third, a glowing
  // trend line arcing across them, and scattered data-point dots up top.
  const heights = [140, 260, 90, 340, 180, 420, 110, 300, 220, 380, 150, 260, 90, 340, 200, 440, 130, 300, 240, 400, 160, 280, 100, 360, 210, 320];
  const n = heights.length;
  const barW = W / n;
  const baseY = 1120;
  const parts: string[] = [];
  let pathPts = '';
  for (let i = 0; i < n; i++) {
    const h = heights[i];
    const up = i % 3 !== 1;
    const x = i * barW;
    const y = baseY - h;
    const col = up ? decorHex2 : decorHex;
    parts.push(`<rect x="${x + barW * 0.18}" y="${y}" width="${barW * 0.64}" height="${h}" fill="${col}" fill-opacity="0.32"/>`);
    parts.push(`<line x1="${x + barW * 0.5}" y1="${y - 22}" x2="${x + barW * 0.5}" y2="${baseY + 18}" stroke="${col}" stroke-opacity="0.22" stroke-width="2"/>`);
    const midY = baseY - h * 0.6;
    pathPts += `${i === 0 ? 'M' : 'L'} ${x + barW * 0.5} ${midY} `;
  }
  parts.push(`<path d="${pathPts}" fill="none" stroke="${decorHex2}" stroke-opacity="0.55" stroke-width="4"/>`);
  for (let i = 0; i < 18; i++) {
    const x = (i * 137) % W;
    const y = 60 + ((i * 211) % 520);
    parts.push(`<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="${i % 2 === 0 ? decorHex2 : decorHex}" fill-opacity="0.18"/>`);
  }
  return parts.join('\n');
}

function sceneCircuit(decorHex: string, decorHex2: string): string {
  // Deterministic node layout spread across the full canvas -- a PCB/mesh feel.
  const seedX = [80, 260, 470, 690, 900, 1010, 150, 380, 600, 830, 990, 60, 320, 540, 760, 950, 210, 440, 660, 880];
  const seedY = [120, 340, 90, 260, 480, 150, 620, 780, 940, 700, 1080, 1220, 1160, 980, 1260, 820, 560, 400, 240, 60];
  const nodes: [number, number, number][] = seedX.map((x, i) => [x, seedY[i], i % 5 === 0 ? 9 : 4.5]);
  const parts: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const [x1, y1] = nodes[i];
    const [x2, y2] = nodes[(i + 3) % nodes.length];
    const [x3, y3] = nodes[(i + 7) % nodes.length];
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${decorHex}" stroke-opacity="0.16" stroke-width="2"/>`);
    if (i % 2 === 0) parts.push(`<line x1="${x1}" y1="${y1}" x2="${x3}" y2="${y3}" stroke="${decorHex2}" stroke-opacity="0.12" stroke-width="1.5"/>`);
  }
  for (const [x, y, r] of nodes) {
    const big = r > 5;
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${big ? decorHex2 : decorHex}" fill-opacity="${big ? 0.4 : 0.26}"/>`);
    if (big) parts.push(`<circle cx="${x}" cy="${y}" r="${r + 8}" fill="none" stroke="${decorHex2}" stroke-opacity="0.18" stroke-width="2"/>`);
  }
  return parts.join('\n');
}

function sceneRacetrack(decorHex: string, decorHex2: string): string {
  const parts: string[] = [];
  const vanishX = W * 0.5, vanishY = 260;
  const lanes = [-1, -0.55, -0.2, 0.2, 0.55, 1];
  for (const t of lanes) {
    const bx = vanishX + t * 900;
    parts.push(`<line x1="${vanishX}" y1="${vanishY}" x2="${bx}" y2="${H}" stroke="${decorHex}" stroke-opacity="0.14" stroke-width="3"/>`);
  }
  const bandY = 980, rows = 3, cols = 18, cellW = W / cols, cellH = 36;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 === 0) {
        parts.push(`<rect x="${c * cellW}" y="${bandY + r * cellH}" width="${cellW}" height="${cellH}" fill="${WHITE}" fill-opacity="0.10"/>`);
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    const y = 300 + i * 90;
    const len = 140 + (i % 3) * 60;
    parts.push(`<line x1="${1080 - i * 30}" y1="${y}" x2="${1080 - i * 30 - len}" y2="${y}" stroke="${decorHex2}" stroke-opacity="0.16" stroke-width="5" stroke-linecap="round"/>`);
  }
  return parts.join('\n');
}

function sceneBookstack(decorHex: string, decorHex2: string): string {
  const parts: string[] = [];
  const stack: [number, string][] = [[300, decorHex], [260, decorHex2], [320, decorHex], [230, decorHex2]];
  let y = 1180;
  let sx = -40;
  for (const [w, col] of stack) {
    y -= 42;
    sx += 8;
    parts.push(`<rect x="${sx}" y="${y}" width="${w}" height="34" rx="4" fill="${col}" fill-opacity="0.22" transform="rotate(${(sx % 5) - 2} ${sx + w / 2} ${y + 17})"/>`);
  }
  const bx = 760, by = 1220;
  parts.push(`<path d="M ${bx - 280} ${by - 60} Q ${bx - 140} ${by - 130} ${bx} ${by - 70} Q ${bx + 140} ${by - 130} ${bx + 280} ${by - 60} L ${bx + 280} ${by + 110} Q ${bx + 140} ${by + 50} ${bx} ${by + 100} Q ${bx - 140} ${by + 50} ${bx - 280} ${by + 110} Z" fill="none" stroke="${decorHex}" stroke-opacity="0.24" stroke-width="4"/>`);
  parts.push(`<line x1="${bx}" y1="${by - 68}" x2="${bx}" y2="${by + 98}" stroke="${decorHex}" stroke-opacity="0.24" stroke-width="2"/>`);
  for (let i = 0; i < 10; i++) {
    const x = (i * 173) % W;
    const py = 60 + ((i * 231) % 520);
    const rot = (i * 47) % 40 - 20;
    parts.push(`<rect x="${x}" y="${py}" width="26" height="34" rx="3" fill="${i % 2 === 0 ? decorHex2 : decorHex}" fill-opacity="0.14" transform="rotate(${rot} ${x + 13} ${py + 17})"/>`);
  }
  return parts.join('\n');
}

function sceneSpiral(decorHex: string, decorHex2: string): string {
  const parts: string[] = [];
  const cx = W * 0.62, cy = H * 0.42;
  const rings = [180, 320, 460, 600, 740];
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${i % 2 === 0 ? decorHex : decorHex2}" stroke-opacity="${0.16 - i * 0.018}" stroke-width="3"/>`);
  }
  for (let i = 0; i < 16; i++) {
    const ring = rings[i % rings.length];
    const a = (Math.PI * 2 * i) / 16 + (i % 3);
    const x = cx + Math.cos(a) * ring;
    const y = cy + Math.sin(a) * ring;
    parts.push(`<circle cx="${x}" cy="${y}" r="${4 + (i % 3) * 2}" fill="${i % 2 === 0 ? decorHex2 : decorHex}" fill-opacity="0.3"/>`);
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="18" fill="${decorHex2}" fill-opacity="0.4"/>`);
  return parts.join('\n');
}

function sceneProtocolNodes(decorHex: string, decorHex2: string): string {
  const parts: string[] = [];
  const nodes: [number, number, number][] = [
    [120, 160, 7], [340, 90, 5], [560, 200, 6], [820, 130, 8], [990, 260, 5],
    [90, 420, 5], [300, 500, 9], [540, 440, 6], [780, 520, 5], [980, 460, 7],
    [150, 760, 6], [400, 820, 5], [650, 780, 8], [900, 840, 5],
    [220, 1080, 5], [480, 1140, 7], [730, 1100, 5], [960, 1180, 6],
  ];
  for (let i = 0; i < nodes.length; i++) {
    const [x1, y1] = nodes[i];
    const [x2, y2] = nodes[(i + 1) % nodes.length];
    const [x3, y3] = nodes[(i + 5) % nodes.length];
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${decorHex}" stroke-opacity="0.15" stroke-width="2"/>`);
    if (i % 3 === 0) parts.push(`<line x1="${x1}" y1="${y1}" x2="${x3}" y2="${y3}" stroke="${decorHex2}" stroke-opacity="0.1" stroke-width="1.5"/>`);
  }
  for (const [x, y, r] of nodes) {
    const big = r > 6;
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${big ? decorHex2 : decorHex}" fill-opacity="${big ? 0.38 : 0.24}"/>`);
    if (big) parts.push(`<circle cx="${x}" cy="${y}" r="${r + 10}" fill="none" stroke="${decorHex2}" stroke-opacity="0.16" stroke-width="2"/>`);
  }
  return parts.join('\n');
}

function sceneBonfire(decorHex: string, decorHex2: string): string {
  // v27: Bonfire Night / fireworks-festival scene -- a blazing log pile with
  // layered flame tongues across the bottom third, rising sparks, and a
  // scatter of radial firework bursts across the upper sky.
  const parts: string[] = [];
  const baseY = 1180;
  parts.push(`<ellipse cx="${W / 2}" cy="${baseY + 30}" rx="260" ry="34" fill="${decorHex}" fill-opacity="0.22"/>`);
  for (let i = 0; i < 5; i++) {
    const x1 = W / 2 - 200 + i * 100, x2 = W / 2 + 200 - i * 100;
    parts.push(`<line x1="${x1}" y1="${baseY + 10}" x2="${x2}" y2="${baseY - 30}" stroke="${decorHex}" stroke-opacity="0.28" stroke-width="14" stroke-linecap="round"/>`);
  }
  const flameCount = 9;
  for (let i = 0; i < flameCount; i++) {
    const cx = 140 + i * ((W - 280) / (flameCount - 1));
    const h = 260 + ((i * 71) % 220);
    const fw = 90 + (i % 3) * 20;
    const col = i % 2 === 0 ? decorHex2 : decorHex;
    parts.push(`<path d="M ${cx - fw / 2} ${baseY} Q ${cx - fw * 0.3} ${baseY - h * 0.55} ${cx} ${baseY - h} Q ${cx + fw * 0.3} ${baseY - h * 0.55} ${cx + fw / 2} ${baseY}" fill="${col}" fill-opacity="0.3"/>`);
  }
  for (let i = 0; i < 22; i++) {
    const x = (i * 149) % W;
    const y = baseY - 120 - ((i * 233) % 900);
    parts.push(`<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="${i % 2 === 0 ? decorHex2 : decorHex}" fill-opacity="0.28"/>`);
  }
  const bursts: [number, number, number][] = [[220, 190, 70], [780, 130, 90], [520, 320, 55], [940, 300, 60]];
  for (const [bx, by, r] of bursts) {
    const col = bx % 2 === 0 ? decorHex2 : decorHex;
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12;
      const x2 = bx + Math.cos(a) * r, y2 = by + Math.sin(a) * r;
      parts.push(`<line x1="${bx}" y1="${by}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-opacity="0.32" stroke-width="2.5"/>`);
    }
    parts.push(`<circle cx="${bx}" cy="${by}" r="6" fill="${col}" fill-opacity="0.5"/>`);
  }
  return parts.join('\n');
}

function sceneHarvestFair(decorHex: string, decorHex2: string): string {
  // v27: agricultural-fair / harvest scene -- a barn gable silhouette, wheat
  // sheaves along the base, and a scatter of award-ribbon rosettes across
  // the mid-canvas.
  const parts: string[] = [];
  const gx = 820, gy = 260;
  parts.push(`<path d="M ${gx - 220} ${gy + 40} L ${gx} ${gy - 160} L ${gx + 220} ${gy + 40} Z" fill="none" stroke="${decorHex}" stroke-opacity="0.2" stroke-width="4"/>`);
  parts.push(`<rect x="${gx - 160}" y="${gy + 40}" width="320" height="140" fill="none" stroke="${decorHex}" stroke-opacity="0.18" stroke-width="3"/>`);
  parts.push(`<rect x="${gx - 30}" y="${gy + 100}" width="60" height="80" fill="${decorHex}" fill-opacity="0.16"/>`);
  for (let s = 0; s < 6; s++) {
    const sx = 90 + s * 180;
    const sy = 1220;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.18;
      const len = 150 + (i % 2) * 20;
      const x2 = sx + Math.cos(a) * len, y2 = sy + Math.sin(a) * len;
      parts.push(`<line x1="${sx}" y1="${sy}" x2="${x2}" y2="${y2}" stroke="${decorHex2}" stroke-opacity="0.28" stroke-width="3" stroke-linecap="round"/>`);
    }
    parts.push(`<ellipse cx="${sx}" cy="${sy + 20}" rx="18" ry="26" fill="${decorHex2}" fill-opacity="0.2"/>`);
  }
  const rosettes: [number, number, number][] = [[160, 620, 46], [420, 780, 38], [700, 640, 52], [960, 760, 40]];
  for (const [rx, ry, r] of rosettes) {
    const col = rx % 2 === 0 ? decorHex : decorHex2;
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10;
      const x2 = rx + Math.cos(a) * r, y2 = ry + Math.sin(a) * r;
      parts.push(`<circle cx="${x2}" cy="${y2}" r="${r * 0.3}" fill="${col}" fill-opacity="0.16"/>`);
    }
    parts.push(`<circle cx="${rx}" cy="${ry}" r="${r * 0.55}" fill="${col}" fill-opacity="0.26"/>`);
    parts.push(`<line x1="${rx - 10}" y1="${ry + r * 0.5}" x2="${rx - 24}" y2="${ry + r * 1.5}" stroke="${col}" stroke-opacity="0.24" stroke-width="8" stroke-linecap="round"/>`);
    parts.push(`<line x1="${rx + 10}" y1="${ry + r * 0.5}" x2="${rx + 24}" y2="${ry + r * 1.5}" stroke="${col}" stroke-opacity="0.24" stroke-width="8" stroke-linecap="round"/>`);
  }
  return parts.join('\n');
}

function sceneArctic(decorHex: string, decorHex2: string): string {
  // v27: polar/tundra scene -- aurora arcs sweeping the sky over a horizon
  // of drifting ice floes, for polar-bear-season / Churchill-style posts.
  const parts: string[] = [];
  const auroraPaths = [
    `M -60 220 Q 300 60 640 200 T 1140 160`,
    `M -60 300 Q 340 140 700 280 T 1140 260`,
    `M -60 380 Q 380 220 760 360 T 1140 360`,
  ];
  auroraPaths.forEach((d, i) => {
    parts.push(`<path d="${d}" fill="none" stroke="${i % 2 === 0 ? decorHex2 : decorHex}" stroke-opacity="${0.22 - i * 0.04}" stroke-width="${18 - i * 3}"/>`);
  });
  for (let i = 0; i < 16; i++) {
    const x = (i * 163) % W;
    const y = 40 + ((i * 97) % 420);
    parts.push(`<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="${WHITE}" fill-opacity="0.3"/>`);
  }
  const floeY = 1080;
  const floes: [number, number][] = [[60, 220], [280, 190], [480, 260], [720, 200], [900, 240], [1000, 180]];
  for (const [fx, fw] of floes) {
    const fy = floeY + ((fx * 13) % 40);
    parts.push(`<path d="M ${fx} ${fy + 60} L ${fx + fw * 0.15} ${fy} L ${fx + fw * 0.6} ${fy - 20} L ${fx + fw * 0.85} ${fy + 10} L ${fx + fw} ${fy + 70} Z" fill="${decorHex}" fill-opacity="0.16"/>`);
    parts.push(`<line x1="${fx + fw * 0.3}" y1="${fy + 10}" x2="${fx + fw * 0.5}" y2="${fy + 55}" stroke="${decorHex2}" stroke-opacity="0.2" stroke-width="2"/>`);
  }
  parts.push(`<rect x="0" y="${floeY + 55}" width="${W}" height="${H - floeY - 55}" fill="${decorHex}" fill-opacity="0.1"/>`);
  return parts.join('\n');
}

function legacyMotifScene(motif: string | undefined, decorHex: string, decorHex2: string): string {
  // Not one of the six bespoke scenes -- repeat the old small icon at three
  // scales/positions across the canvas instead of one small corner instance.
  const base = motifIcon(motif, decorHex, decorHex2);
  if (!base) return '';
  return `<g opacity="0.55">${base}</g>
  <g transform="translate(-760,860) scale(1.6)" opacity="0.35">${base}</g>
  <g transform="translate(-120,560) scale(1.1)" opacity="0.3">${base}</g>`;
}

function sceneForMotif(motif: string | undefined, decorHex: string, decorHex2: string): string {
  switch (motif) {
    case 'candlestick': return sceneCandlestick(decorHex, decorHex2);
    case 'circuit': return sceneCircuit(decorHex, decorHex2);
    case 'racetrack': return sceneRacetrack(decorHex, decorHex2);
    case 'bookstack': return sceneBookstack(decorHex, decorHex2);
    case 'spiral': return sceneSpiral(decorHex, decorHex2);
    case 'protocol-nodes': return sceneProtocolNodes(decorHex, decorHex2);
    case 'bonfire': return sceneBonfire(decorHex, decorHex2);
    case 'harvestfair': return sceneHarvestFair(decorHex, decorHex2);
    case 'arctic': return sceneArctic(decorHex, decorHex2);
    default: return legacyMotifScene(motif, decorHex, decorHex2);
  }
}

// ---- v28: real layout variety for every brand, not just the 4 hand-tuned
// ones -- Brad: "not the same basic layouts for all users." Previously a
// brand with no `motif` resolved (every brand outside the hardcoded
// brandDefaults() switch, i.e. every self-serve signup) fell all the way
// through legacyMotifScene(undefined, ...) -> motifIcon(undefined, ...),
// which returns an empty string -- a genuinely blank gradient card, not a
// deliberate minimal choice. pickAutoMotif deterministically (hash of sku,
// not random) picks one of the 9 real full-scene motifs so every post gets
// a real scene, and the SAME sku always renders the same motif if
// re-rendered. A brand can still pin one specific motif via
// cc_brands.default_motif if it wants visual consistency instead of variety.
const ALL_SCENE_MOTIFS = ['candlestick', 'circuit', 'racetrack', 'bookstack', 'spiral', 'protocol-nodes', 'bonfire', 'harvestfair', 'arctic'];
function pickAutoMotif(sku: string): string {
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  return ALL_SCENE_MOTIFS[h % ALL_SCENE_MOTIFS.length];
}

// ---- v28: brand theme sourced from cc_brands + a rotating AI-generated
// character-variant pool, generalizing the hardcoded brandDefaults() switch
// above to every brand, not just the 4 it lists. brandDefaults() is left
// completely untouched (it still wins for those 4, preserving Brad's
// already-approved hand-tuned looks) -- this only fills the gap for every
// OTHER real brand, which previously got null theme -> plain navy gradient,
// no logo, no mascot, regardless of what that brand's own Settings said.
//
// bgHex is deliberately NOT the brand's own primary_color -- a bright brand
// color as the actual background risks unreadable text. Colors from
// Settings show up prominently via the glow/motif/CTA pill instead, on a
// fixed neutral-dark base every brand shares (this is the one thing that
// *is* shared across brands, on purpose, for legibility).
type DbTheme = {
  bgHex: string; accentHex: string; decorHex: string; decorHex2: string;
  logoUrl?: string; mascotUrl?: string; defaultMotif?: string; closingTemplateUrl?: string;
  // v42 -- the brand's own card identity, see the header comment.
  cardFont?: string; cardFontWidth?: number;
  cardSurfaces?: CardSurface[]; cardCase?: 'normal' | 'upper';
  // v43 -- headings and body in different faces, and the brand's own two
  // grounds (its dark ground and its paper).
  cardFontBody?: string; cardBg?: string; cardPaper?: string;
};

function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

async function pickCharacterVariant(supabase: ReturnType<typeof createClient>, brandId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from('cc_brand_character_variants')
    .select('id, image_url')
    .eq('brand_id', brandId)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return undefined;
  // Best-effort rotation bookkeeping -- never blocks the render if it fails.
  supabase.from('cc_brand_character_variants').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {});
  return data.image_url as string;
}

async function fetchDbTheme(supabase: ReturnType<typeof createClient>, brand?: string): Promise<DbTheme | null> {
  if (!brand) return null;
  const { data: row } = await supabase
    .from('cc_brands')
    .select('id, primary_color, secondary_color, accent_color, logo_url, character_asset_url, character_adaptable, default_motif, closing_template_url, card_font, card_font_width, card_surfaces, card_case, card_font_body, card_bg, card_paper')
    .eq('name', brand)
    .maybeSingle();
  if (!row) return null;

  let mascotUrl: string | undefined;
  if (row.character_adaptable && row.character_asset_url) {
    mascotUrl = (await pickCharacterVariant(supabase, row.id as string)) || (row.character_asset_url as string);
  } else if (row.character_asset_url) {
    mascotUrl = row.character_asset_url as string;
  }

  return {
    // v43: the brand's own ground, not one shared near-black for everybody.
    bgHex: isHex(row.card_bg) ? (row.card_bg as string).trim() : '#111318',
    accentHex: (row.accent_color as string) || (row.primary_color as string) || '#1E2963',
    decorHex: (row.primary_color as string) || CYAN,
    decorHex2: (row.secondary_color as string) || (row.accent_color as string) || INDIGO,
    logoUrl: (row.logo_url as string) || undefined,
    mascotUrl,
    defaultMotif: (row.default_motif as string) || undefined,
    closingTemplateUrl: (row.closing_template_url as string) || undefined,
    cardFont: isUsableFamily(row.card_font as string) ? (row.card_font as string).trim() : undefined,
    cardFontWidth: (typeof row.card_font_width === 'number' && Number.isFinite(row.card_font_width) && row.card_font_width > 0.4 && row.card_font_width < 2.5)
      ? (row.card_font_width as number) : undefined,
    cardSurfaces: Array.isArray(row.card_surfaces)
      ? (row.card_surfaces as string[]).filter((s): s is CardSurface => s === 'dark' || s === 'light' || s === 'accent' || s === 'inkwash')
      : undefined,
    cardCase: (row.card_case === 'upper' || row.card_case === 'normal') ? row.card_case : undefined,
    cardFontBody: isUsableFamily(row.card_font_body as string) ? (row.card_font_body as string).trim() : undefined,
    cardPaper: isHex(row.card_paper) ? (row.card_paper as string).trim() : undefined,
  };
}

function bgAndDecor(bgHex: string, accentHex: string, decorHex: string, decorHex2: string, motif?: string) {
  const scene = sceneForMotif(motif, decorHex, decorHex2);
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgHex}"/>
      <stop offset="100%" stop-color="${accentHex}"/>
    </linearGradient>
    <radialGradient id="glow1" cx="80%" cy="8%" r="60%">
      <stop offset="0%" stop-color="${decorHex}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${decorHex}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="10%" cy="92%" r="65%">
      <stop offset="0%" stop-color="${decorHex2}" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="${decorHex2}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow1)"/>
  <rect width="${W}" height="${H}" fill="url(#glow2)"/>
  ${scene}
  <rect width="${W}" height="340" fill="url(#topScrim)"/>
  <rect y="${H - 760}" width="${W}" height="760" fill="url(#bottomScrim)"/>`;
}

function wordmarkSvg(text: string, x: number, y: number, ink: string = WHITE, family: string = 'Poppins') {
  return `<text x="${x}" y="${y}" font-family="${family}" font-weight="700" font-size="34" fill="${ink}" text-anchor="end" letter-spacing="2">${esc(text.toUpperCase())}</text>`;
}

// 2026-09-18 (v32): `template_url` -- a per-request background image that
// replaces the generated motif scene on ANY slide, so a client can upload
// one example/reference card in the dashboard ("Upload example template" on
// a campaign) and have the whole batch rendered onto it. Same mechanism the
// brand-level closing_template_url already used for slide 3, generalised:
// full-bleed cover + a scrim heavy enough that white headline/fact text
// stays legible over an arbitrary uploaded photo (the closing layout could
// use a light scrim because its copy sits in the bottom band only; hero and
// detail put text across the whole card, so this one is a flat 55% veil
// plus the same bottom ramp).
//
// Fetch failures fall back to the normal generated background rather than
// rendering a blank card -- a template that 404s must never cost the client
// the whole batch.
function templateBackgroundSvg(bgUri: string): string {
  return `<defs>
    <linearGradient id="tplScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.34"/>
      <stop offset="45%" stop-color="#000000" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.70"/>
    </linearGradient>
  </defs>
  <image href="${bgUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${W}" height="${H}" fill="#000000" opacity="0.46"/>
  <rect width="${W}" height="${H}" fill="url(#tplScrim)"/>`;
}

function templateMimeFor(url: string): string {
  const u = url.toLowerCase();
  if (u.match(/\.jpe?g(\?|$)/)) return 'image/jpeg';
  if (u.match(/\.webp(\?|$)/)) return 'image/webp';
  return 'image/png';
}

async function templateBackgroundOrNull(url?: string): Promise<string | null> {
  if (!url) return null;
  const uri = await toDataUri(url, templateMimeFor(url)).catch(() => '');
  return uri ? templateBackgroundSvg(uri) : null;
}

// ── Card layouts (v33, 2026-09-18) ────
// Brad, after seeing a 5-post batch: "those 5 all look the exact same as
// each other and the same as all past content... i should not see the same
// template, i should not see the qr code in the same spot, i should not see
// the brands character in the same spot."
//
// He was right, and `motif` was never the answer to it: motif swaps the
// background ARTWORK while every card kept one hardcoded composition
// (eyebrow/headline top-left at x=64, CTA pill under them, logo top-right,
// mascot bottom-right at 360x360, QR bottom-left). Same skeleton on every
// post of every brand since this function existed.
//
// So composition is now data. Each layout below moves FOUR things at once --
// the text block (position AND alignment), the logo, the mascot, and the QR
// code -- and no two layouts share a position for any of them:
//
//   key            text block        logo          mascot        QR
//   classic        top-left          top-right     bottom-right  bottom-left
//   lowerLeft      bottom-left       bottom-right  top-left      top-right
//   centered       centred, upper    top-centre    bottom-left   bottom-centre
//   rightRail      right-aligned     bottom-right  bottom-left   middle-left
//   stripe         top-left          stripe-left   middle-right  stripe-right
//   poster         centred, lower    top-left      top-left(big) middle-right
//
// A post's slide 1 and slide 2 deliberately use layouts three apart, so the
// two cards of the same post don't twin each other either.
type CardAnchor = 'start' | 'middle' | 'end';

// v37 (2026-09-19): a layout is no longer only a set of coordinates. Moving
// the QR code around never stopped the cards reading as one family, because
// every card was still a dark gradient with white Poppins on it. These three
// fields are the style half of a layout:
//
//   surface       what the card is MADE of -- dark gradient, pale paper,
//                 a saturated brand-accent field, or near-black ink wash.
//                 It drives the ground, the text colour and the CTA
//                 treatment together, so a card is internally consistent.
//   headlineFont  which typeface carries the headline. 'sans' is Poppins
//                 (unchanged), 'display' a high-contrast serif, 'condensed'
//                 a narrow grotesque.
//   headlineCase  normal sentence case, or uppercase with letter-spacing.
//
// All three are optional; omitted means the pre-v37 look exactly.
type CardSurface = 'dark' | 'light' | 'accent' | 'inkwash';
type CardHeadlineFont = 'sans' | 'display' | 'condensed';
type CardLayout = {
  key: string;
  // Text block: eyebrow, headline lines, optional CTA pill, fact lines,
  // optional footer line -- all flow downward from (x, y), aligned by anchor.
  block: { x: number; y: number; anchor: CardAnchor; maxWidth: number };
  logo: { x: number; y: number };
  mascot: { x: number; y: number; size: number } | null;
  qr: { x: number; y: number; box: number };
  qrCaption: { x: number; y: number; anchor: CardAnchor } | null;
  // Optional full-width accent band, drawn under the foreground elements.
  stripe?: { y: number; h: number };
  surface?: CardSurface;
  headlineFont?: CardHeadlineFont;
  headlineCase?: 'normal' | 'upper';
};

// Rendering tokens for one surface. Everything the card draws in a colour
// reads from here, so there is exactly one place that decides "this card is
// light" -- no element can be left behind on a dark assumption.
type SurfaceTokens = {
  ink: string;          // headline
  muted: string;        // fact lines, QR caption
  label: string;        // eyebrow, location, footer
  pillFill: string;
  pillInk: string;
  pillStroke: string | null;
  stripeFill: string;
  stripeOpacity: number;
  qrFrame: boolean;     // a light card needs a hairline around the QR panel
};

const DARK_INK = '#12161F';

function surfaceTokens(surface: CardSurface, accentHex: string, decorHex: string, decorHex2: string): SurfaceTokens {
  switch (surface) {
    case 'light':
      return {
        ink: DARK_INK, muted: '#4A5768', label: accentHex,
        pillFill: accentHex, pillInk: WHITE, pillStroke: null,
        stripeFill: accentHex, stripeOpacity: 0.16, qrFrame: true,
      };
    case 'accent':
      return {
        ink: WHITE, muted: '#EEF3FB', label: '#FFFFFF',
        pillFill: WHITE, pillInk: DARK_INK, pillStroke: null,
        stripeFill: '#FFFFFF', stripeOpacity: 0.18, qrFrame: false,
      };
    case 'inkwash':
      return {
        ink: WHITE, muted: '#C6D0DE', label: decorHex,
        pillFill: 'none', pillInk: WHITE, pillStroke: decorHex,
        stripeFill: decorHex2, stripeOpacity: 0.32, qrFrame: false,
      };
    case 'dark':
    default:
      return {
        ink: WHITE, muted: '#E2E8F0', label: decorHex,
        pillFill: decorHex2, pillInk: WHITE, pillStroke: null,
        stripeFill: accentHex, stripeOpacity: 0.55, qrFrame: false,
      };
  }
}

// The ground the card is printed on. 'dark' is the original bgAndDecor()
// output unchanged; the others build their own field and reuse the same
// motif artwork at an opacity that suits the ground, so a brand's scene is
// still recognisably its scene on every surface.
// Every motif scene sets its own stroke-opacity (0.12-0.18) because it was
// drawn to sit under white text on a dark ground. On paper that is all but
// invisible, and a group opacity can only subtract. Drawing the same scene
// over itself accumulates alpha instead: 0.14 stacked five times reads at
// roughly 0.47, which is a visible pale line drawing.
function lightScene(motif: string | undefined, inkHex: string, band?: { y0: number; y1: number }): string {
  const one = sceneForMotif(motif, inkHex, inkHex);
  const stacked = `${one}${one}${one}${one}`;
  if (!band) return `<g>${stacked}</g>`;
  // Fade the art down to 18% across the band the text actually occupies.
  // Decoration crossing a headline reads as noise on the letterforms.
  return `<defs>
    <mask id="sceneBand" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>
      <rect x="0" y="${Math.round(band.y0)}" width="${W}" height="${Math.max(0, Math.round(band.y1 - band.y0))}" fill="#FFFFFF" fill-opacity="0.18"/>
    </mask>
  </defs>
  <g mask="url(#sceneBand)">${stacked}</g>`;
}

// Darken a hex by `amt` (0-1) -- used to give the paper ground a gradient
// that stays in the brand's own colour rather than drifting to blue-white.
function shade(hex: string, amt: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => Math.max(0, Math.min(255, Math.round(c * (1 - amt)))));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

function surfaceGround(surface: CardSurface, bgHex: string, accentHex: string, decorHex: string, decorHex2: string, motif?: string, band?: { y0: number; y1: number }, paperHex?: string): string {
  const paper = isHex(paperHex) ? paperHex.trim() : '#FFFFFF';
  if (surface === 'light') {
    // Built as paper from the start. v37 painted the dark card and then hid
    // it under two white veils, which is why the motif vanished and the
    // card read as blank.
    return `<defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="${paper}"/>
      <stop offset="100%" stop-color="${shade(paper, 0.07)}"/>
    </linearGradient>
    <radialGradient id="paperWash" cx="84%" cy="10%" r="66%">
      <stop offset="0%" stop-color="${accentHex}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${accentHex}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#paper)"/>
  <rect width="${W}" height="${H}" fill="url(#paperWash)"/>
  ${lightScene(motif, accentHex, band)}
  <rect x="0" y="0" width="${W}" height="16" fill="${accentHex}"/>`;
  }
  if (surface === 'accent') {
    return `<defs>
    <linearGradient id="accField" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stop-color="${accentHex}"/>
      <stop offset="100%" stop-color="${decorHex2}"/>
    </linearGradient>
    <linearGradient id="accScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.34"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#accField)"/>
  <g opacity="0.26">${sceneForMotif(motif, WHITE, WHITE)}</g>
  <rect y="${H - 640}" width="${W}" height="640" fill="url(#accScrim)"/>`;
  }
  if (surface === 'inkwash') {
    return `<defs>
    <radialGradient id="inkGlow" cx="26%" cy="22%" r="72%">
      <stop offset="0%" stop-color="${decorHex}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${decorHex}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#0A0D13"/>
  <rect width="${W}" height="${H}" fill="url(#inkGlow)"/>
  <g opacity="0.62">${sceneForMotif(motif, decorHex, decorHex2)}</g>`;
  }
  return bgAndDecor(bgHex, accentHex, decorHex, decorHex2, motif);
}

// estTextWidth is calibrated to Poppins, so a headline set in another family
// needs its allowance adjusted or it will either overflow or be shrunk for
// no reason. Uppercase is wider than mixed case in every family.
const HEADLINE_FAMILY: Record<CardHeadlineFont, { family: string; weight: number; widthFactor: number; tracking: number }> = {
  // Names must be BARE and SINGLE-WORD, and every one must be a key of
  // FONT_CSS above -- v37 shipped `'Playfair Display'` and v38 a
  // comma-separated fallback list, and both came back in the wrong face.
  // `widthFactor` is that face's width relative to Poppins, which is what
  // estTextWidth is calibrated to; it scales every measurement on the card,
  // because the whole card is set in this face.
  sans: { family: 'Poppins', weight: 700, widthFactor: 1.0, tracking: 0 },
  display: { family: 'Arvo', weight: 700, widthFactor: 1.18, tracking: 0 },
  condensed: { family: 'Oswald', weight: 600, widthFactor: 0.78, tracking: 1 },
};

// The card's typeface, from its layout. Named `headlineFont` in the layout
// spec for backwards compatibility with rows written before v40, when it
// really did only set the headline.
function cardFaceFor(l: CardLayout, theme?: DbTheme | null) {
  const base = HEADLINE_FAMILY[l.headlineFont || 'sans'] || HEADLINE_FAMILY.sans;
  // v42: the brand's own typeface wins over the layout's. The width factor
  // matters because every measurement on the card is scaled by it -- an
  // unknown face is assumed slightly wider than Poppins so its text wraps
  // early rather than running past the edge.
  if (theme?.cardFont) {
    return { family: theme.cardFont, weight: base.weight, widthFactor: theme.cardFontWidth ?? 1.06, tracking: base.tracking };
  }
  return base;
}

// The face the card's BODY text is set in. A brand that names a body font
// gets real heading/body contrast; one that doesn't sets the whole card in
// its heading face, exactly as v42 did.
function cardBodyFaceFor(l: CardLayout, theme?: DbTheme | null) {
  const head = cardFaceFor(l, theme);
  if (theme?.cardFontBody) {
    return { family: theme.cardFontBody, weight: 400, widthFactor: 1.0, tracking: 0 };
  }
  return head;
}

// The surface a card is printed on: the brand's palette if it declares one,
// otherwise the layout's own. Indexed by the layout's position so a brand
// with two surfaces still alternates between them across a batch.
function cardSurfaceFor(l: CardLayout, layoutIdx: number, theme?: DbTheme | null): CardSurface {
  const pal = theme?.cardSurfaces;
  if (pal && pal.length) return pal[Math.abs(layoutIdx) % pal.length];
  return l.surface || 'dark';
}

const CARD_LAYOUTS: CardLayout[] = [
  {
    key: 'classic',
    block: { x: 64, y: 150, anchor: 'start', maxWidth: 900 },
    logo: { x: 846, y: 40 },
    mascot: { x: 706, y: 946, size: 360 },
    qr: { x: 64, y: 1044, box: 190 },
    qrCaption: { x: 274, y: 1124, anchor: 'start' },
    surface: 'dark', headlineFont: 'sans', headlineCase: 'normal',
  },
  {
    key: 'lowerLeft',
    block: { x: 64, y: 690, anchor: 'start', maxWidth: 900 },
    logo: { x: 846, y: 1250 },
    mascot: { x: 60, y: 80, size: 320 },
    qr: { x: 826, y: 64, box: 190 },
    qrCaption: { x: 806, y: 144, anchor: 'end' },
    surface: 'light', headlineFont: 'display', headlineCase: 'normal',
  },
  {
    key: 'centered',
    block: { x: 540, y: 300, anchor: 'middle', maxWidth: 860 },
    logo: { x: 455, y: 40 },
    mascot: { x: 40, y: 930, size: 340 },
    qr: { x: 445, y: 1080, box: 190 },
    qrCaption: null,
    surface: 'accent', headlineFont: 'condensed', headlineCase: 'upper',
  },
  {
    key: 'rightRail',
    block: { x: 1016, y: 560, anchor: 'end', maxWidth: 700 },
    logo: { x: 455, y: 1250 },
    mascot: { x: 700, y: 70, size: 330 },
    qr: { x: 64, y: 300, box: 190 },
    qrCaption: { x: 64, y: 540, anchor: 'start' },
    surface: 'light', headlineFont: 'sans', headlineCase: 'upper',
  },
  {
    key: 'stripe',
    block: { x: 64, y: 170, anchor: 'start', maxWidth: 664 },
    logo: { x: 64, y: 1140 },
    mascot: { x: 740, y: 500, size: 320 },
    qr: { x: 826, y: 1085, box: 180 },
    qrCaption: null,
    stripe: { y: 1050, h: 300 },
    surface: 'inkwash', headlineFont: 'condensed', headlineCase: 'normal',
  },
  {
    key: 'poster',
    block: { x: 540, y: 660, anchor: 'middle', maxWidth: 880 },
    logo: { x: 64, y: 40 },
    mascot: { x: 40, y: 380, size: 280 },
    qr: { x: 445, y: 64, box: 190 },
    qrCaption: null,
    surface: 'dark', headlineFont: 'display', headlineCase: 'upper',
  },
];

// v36 (2026-09-19): layouts are DATA, loaded from public.cc_card_layouts at
// render time. The array above is now only the fallback -- it is what gets
// used if the table is missing, empty, unreadable, or full of rows that
// don't validate. Reason: every layout tweak used to mean redeploying this
// 73KB function by passing its entire source through an inline string
// parameter, which is a genuine corruption risk for a one-number change.
// Now moving a QR code is an UPDATE.
//
// Cached per isolate for CACHE_MS so a batch of renders doesn't re-query
// once per card; a layout edit shows up on the next cold isolate or within
// a minute, whichever comes first.
// v42: cached per brand, since a brand can own its layout rows.
const layoutCacheByBrand: Record<string, { at: number; layouts: CardLayout[] }> = {};
let layoutCache: { at: number; layouts: CardLayout[] } | null = null;
const LAYOUT_CACHE_MS = 60_000;

function isFiniteNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

// A row has to describe a whole card or it is ignored -- a half-written
// spec must never render a card with the headline stacked on the QR code.
function validLayoutSpec(key: unknown, spec: unknown): CardLayout | null {
  if (typeof key !== 'string' || !key.trim()) return null;
  const s = spec as Record<string, Record<string, unknown>> | null;
  if (!s || typeof s !== 'object') return null;
  const b = s.block, l = s.logo, q = s.qr;
  if (!b || !isFiniteNum(b.x) || !isFiniteNum(b.y) || !isFiniteNum(b.maxWidth)) return null;
  if (b.anchor !== 'start' && b.anchor !== 'middle' && b.anchor !== 'end') return null;
  if (!l || !isFiniteNum(l.x) || !isFiniteNum(l.y)) return null;
  if (!q || !isFiniteNum(q.x) || !isFiniteNum(q.y) || !isFiniteNum(q.box)) return null;
  const m = s.mascot;
  const mascot = (m && isFiniteNum(m.x) && isFiniteNum(m.y) && isFiniteNum(m.size))
    ? { x: m.x as number, y: m.y as number, size: m.size as number } : null;
  const c = s.qrCaption;
  const qrCaption = (c && isFiniteNum(c.x) && isFiniteNum(c.y) && (c.anchor === 'start' || c.anchor === 'middle' || c.anchor === 'end'))
    ? { x: c.x as number, y: c.y as number, anchor: c.anchor as CardAnchor } : null;
  const st = s.stripe;
  const stripe = (st && isFiniteNum(st.y) && isFiniteNum(st.h))
    ? { y: st.y as number, h: st.h as number } : undefined;
  // v37 style fields. Unlike the geometry these are individually optional --
  // an unrecognised value is dropped rather than failing the whole row, so a
  // typo in `surface` costs you the style, not the card.
  const rawSurface = (s as Record<string, unknown>).surface;
  const surface = (rawSurface === 'dark' || rawSurface === 'light' || rawSurface === 'accent' || rawSurface === 'inkwash')
    ? rawSurface as CardSurface : undefined;
  const rawFont = (s as Record<string, unknown>).headlineFont;
  const headlineFont = (rawFont === 'sans' || rawFont === 'display' || rawFont === 'condensed')
    ? rawFont as CardHeadlineFont : undefined;
  const rawCase = (s as Record<string, unknown>).headlineCase;
  const headlineCase = (rawCase === 'normal' || rawCase === 'upper') ? rawCase as 'normal' | 'upper' : undefined;
  return {
    key: key.trim(),
    block: { x: b.x as number, y: b.y as number, anchor: b.anchor as CardAnchor, maxWidth: b.maxWidth as number },
    logo: { x: l.x as number, y: l.y as number },
    mascot,
    qr: { x: q.x as number, y: q.y as number, box: q.box as number },
    qrCaption,
    ...(stripe ? { stripe } : {}),
    ...(surface ? { surface } : {}),
    ...(headlineFont ? { headlineFont } : {}),
    ...(headlineCase ? { headlineCase } : {}),
  };
}

async function loadCardLayouts(supabase: ReturnType<typeof createClient>, brand?: string): Promise<CardLayout[]> {
  const now = Date.now();
  const cacheKey = brand || '__shared__';
  const hit = layoutCacheByBrand[cacheKey];
  if (hit && (now - hit.at) < LAYOUT_CACHE_MS) return hit.layouts;

  const readRows = async (brandFilter: string | null): Promise<CardLayout[]> => {
    let q = supabase
      .from('cc_card_layouts')
      .select('key, spec, sort_order, enabled, brand')
      .eq('enabled', true);
    q = brandFilter === null ? q.is('brand', null) : q.eq('brand', brandFilter);
    const { data, error } = await q.order('sort_order', { ascending: true });
    if (error) throw error;
    const rows = (data || []) as { key: string; spec: unknown }[];
    return rows.map((r) => validLayoutSpec(r.key, r.spec)).filter((l): l is CardLayout => !!l);
  };

  try {
    // A brand that owns layout rows uses only those -- that's the point of
    // owning them. Everyone else gets the shared set.
    let layouts: CardLayout[] = [];
    if (brand) layouts = await readRows(brand).catch(() => []);
    if (!layouts.length) layouts = await readRows(null);
    const resolved = layouts.length ? layouts : CARD_LAYOUTS;
    layoutCacheByBrand[cacheKey] = { at: now, layouts: resolved };
    layoutCache = { at: now, layouts: resolved };
    return resolved;
  } catch (_e) {
    // Never block a render on this -- fall back to the built-in set.
    layoutCacheByBrand[cacheKey] = { at: now, layouts: CARD_LAYOUTS };
    layoutCache = { at: now, layouts: CARD_LAYOUTS };
    return CARD_LAYOUTS;
  }
}

function layoutForIndex(layouts: CardLayout[], i?: number): CardLayout {
  const set = (layouts && layouts.length) ? layouts : CARD_LAYOUTS;
  const n = set.length;
  const idx = Number.isFinite(i as number) ? Math.abs(Math.round(i as number)) % n : 0;
  return set[idx];
}

function layoutIndexFromKeyOrNumber(layouts: CardLayout[], v: unknown, fallback: number): number {
  const set = (layouts && layouts.length) ? layouts : CARD_LAYOUTS;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.abs(Math.round(v));
  if (typeof v === 'string' && v.trim()) {
    const byKey = set.findIndex((l) => l.key.toLowerCase() === v.trim().toLowerCase());
    if (byKey >= 0) return byKey;
    const asNum = parseInt(v, 10);
    if (Number.isFinite(asNum)) return Math.abs(asNum);
  }
  return fallback;
}

// x of the left edge of a box of width `w` anchored at `x`.
function anchoredLeft(x: number, w: number, anchor: CardAnchor): number {
  return anchor === 'start' ? x : anchor === 'middle' ? Math.round(x - w / 2) : x - w;
}

// One builder for both slide types. Hero passes a CTA pill and (optionally) a
// two-line QR caption; detail passes a footer line instead. Everything else
// is identical, which is the point -- the difference between cards is the
// LAYOUT, not two divergent code paths.
async function buildLayoutCardSvg(opts: {
  layouts: CardLayout[];
  layoutIndex: number;
  eyebrow: string;
  headline_lines: string[];
  headlineStart: number;     // starting font size (hero is bigger than detail)
  fact_lines?: string[];
  cta_text?: string;         // hero pill
  footer_text?: string;      // detail footer line
  location?: string;
  subject_url: string;
  qr_caption_lines?: string[];
  bgHex: string; accentHex: string; decorHex: string; decorHex2: string;
  motif?: string;
  mascotUri: string; logoUri: string; wordmarkText?: string;
  templateBg?: string | null;
  // v42 -- the brand's card identity, resolved by the caller so the
  // dispatcher and the builder can't disagree about which face is in use.
  theme?: DbTheme | null;
  face?: { family: string; weight: number; widthFactor: number; tracking: number };
  surface?: CardSurface;
}) {
  const L = layoutForIndex(opts.layouts, opts.layoutIndex);
  const bx = L.block.x, maxW = L.block.maxWidth, anchor = L.block.anchor;
  // An uploaded example template is a dark photographic ground with a veil
  // over it, so a card printed on one always uses the dark token set -- a
  // 'light' layout would put near-black text on someone's photo.
  const surface: CardSurface = opts.templateBg
    ? 'dark'
    : (opts.surface || cardSurfaceFor(L, opts.layoutIndex, opts.theme));
  const T = surfaceTokens(surface, opts.accentHex, opts.decorHex, opts.decorHex2);
  const face = opts.face || cardFaceFor(L, opts.theme);
  const bodyFace = cardBodyFaceFor(L, opts.theme);
  // A brand can insist on one case across all its cards; otherwise the
  // layout decides.
  const upperHeadline = opts.theme?.cardCase
    ? opts.theme.cardCase === 'upper'
    : L.headlineCase === 'upper';
  // Width allowance for anything set at mixed case in this face. Measuring
  // in Poppins and drawing in a wider face is how text runs off the edge.
  const fit = (w: number) => Math.round(w / face.widthFactor);
  const fitBody = (w: number) => Math.round(w / bodyFace.widthFactor);
  let y = L.block.y;
  const parts: string[] = [];

  // Eyebrow
  if (opts.eyebrow) {
    const eb = fitWrapped(opts.eyebrow, fitBody(maxW), 34, 18, 600, 2);
    for (const line of eb.lines) {
      parts.push(`<text x="${bx}" y="${y}" text-anchor="${anchor}" font-family="${bodyFace.family}" font-weight="600" font-size="${eb.size}" letter-spacing="1.5" fill="${T.label}">${esc(line)}</text>`);
      y += Math.round(eb.size * 1.25);
    }
    y += Math.round(eb.size * 0.65);
  }

  // Headline
  // The width estimator is calibrated to Poppins at mixed case. A condensed
  // face fits more per line, a serif slightly less, and uppercase always
  // less -- so the ALLOWANCE is scaled rather than the estimate, which keeps
  // fitFontSize/truncateToFit untouched and still overflow-proof.
  const headlineLines = opts.headline_lines.map((l) => (upperHeadline ? l.toUpperCase() : l));
  const caseFactor = upperHeadline ? 1.08 : 1;
  const headlineAllowance = Math.round(fit(maxW) / caseFactor);
  // Headline lines arrive pre-split by the writer. A line that's still too
  // wide wraps onto another line and the whole headline steps down a size
  // to pay for it -- it is never cut short. Four rendered lines is the most
  // a headline can become before it stops looking like a headline.
  let hSize = opts.headlineStart;
  let drawnHeadline: string[] = [];
  for (;;) {
    drawnHeadline = [];
    for (const line of headlineLines) drawnHeadline.push(...wrapToWidth(line, hSize, headlineAllowance, 700));
    if (hSize <= 34 || drawnHeadline.length <= Math.max(headlineLines.length, 2)) break;
    hSize -= 2;
  }
  const lineH = Math.round(hSize * ((L.headlineFont || 'sans') === 'condensed' ? 1.12 : 1.18));
  y += Math.round(hSize * 0.85);
  for (const line of drawnHeadline) {
    parts.push(`<text x="${bx}" y="${y}" text-anchor="${anchor}" font-family="${face.family}" font-weight="${face.weight}" font-size="${hSize}"${face.tracking ? ` letter-spacing="${face.tracking}"` : ''} fill="${T.ink}">${esc(line)}</text>`);
    y += lineH;
  }

  // CTA pill (hero only)
  if (opts.cta_text) {
    let ctaText = opts.cta_text;
    let ctaFont = 32;
    let ctaW = Math.max(300, Math.round(ctaText.length * 19 * bodyFace.widthFactor) + 56);
    if (ctaW > maxW) {
      ctaW = maxW;
      // A CTA is one short phrase and has to stay on the pill, so it
      // shrinks a long way before anything else happens. Only a single
      // unbreakable word can still force an ellipsis.
      ctaFont = fitFontSize(ctaText, fitBody(maxW - 56), 32, 17, 500);
      ctaText = wrapToWidth(ctaText, ctaFont, fitBody(maxW - 56), 500).join(' ');
    }
    const pillX = anchoredLeft(bx, ctaW, anchor);
    y += 18;
    const pillStroke = T.pillStroke ? ` stroke="${T.pillStroke}" stroke-width="3"` : '';
    parts.push(`<rect x="${pillX}" y="${y}" width="${ctaW}" height="64" rx="32" fill="${T.pillFill}"${pillStroke}/>`);
    parts.push(`<text x="${pillX + Math.round(ctaW / 2)}" y="${y + 42}" text-anchor="middle" font-family="${bodyFace.family}" font-weight="500" font-size="${ctaFont}" fill="${T.pillInk}">${esc(ctaText)}</text>`);
    y += 64 + 44;
  } else {
    y += 16;
  }

  // Location
  if (opts.location) {
    const loc = fitWrapped('•  ' + opts.location, fitBody(maxW), 30, 20, 600, 2);
    for (const line of loc.lines) {
      parts.push(`<text x="${bx}" y="${y}" text-anchor="${anchor}" font-family="${bodyFace.family}" font-weight="600" font-size="${loc.size}" fill="${T.label}">${esc(line)}</text>`);
      y += Math.round(loc.size * 1.3);
    }
    y += 18;
  }

  // Fact lines, laid out as one block. Each written line wraps onto as many
  // rendered lines as it needs; if the block then runs past the bottom of
  // the card the whole block steps down a size and re-wraps. The text is
  // never shortened to make it fit -- that's the rule this version exists
  // for. `footerReserve` keeps room for the footer line that follows on a
  // detail card.
  const facts = (opts.fact_lines || []).filter(Boolean);
  if (facts.length) {
    const footerReserve = opts.footer_text ? 90 : 0;
    const bottomLimit = H - 90 - footerReserve;
    let factSize = 34;
    let factBlock: string[][] = [];
    for (;;) {
      factBlock = facts.map((l) => wrapToWidth(l, factSize, fitBody(maxW), 400));
      const rendered = factBlock.reduce((n, ls) => n + ls.length, 0);
      const height = rendered * Math.round(factSize * 1.32) + (facts.length - 1) * 10;
      if (factSize <= 22 || y + height <= bottomLimit) break;
      factSize -= 2;
    }
    const factLineH = Math.round(factSize * 1.32);
    for (const wrapped of factBlock) {
      for (const line of wrapped) {
        parts.push(`<text x="${bx}" y="${y}" text-anchor="${anchor}" font-family="${bodyFace.family}" font-weight="400" font-size="${factSize}" fill="${T.muted}">${esc(line)}</text>`);
        y += factLineH;
      }
      y += 10;
    }
    y -= 10;
    y += 6;
  }

  // Footer line (detail only)
  if (opts.footer_text) {
    y += 22;
    const foot = fitWrapped(opts.footer_text, fitBody(maxW), 30, 20, 600, 2);
    for (const line of foot.lines) {
      parts.push(`<text x="${bx}" y="${y}" text-anchor="${anchor}" font-family="${bodyFace.family}" font-weight="600" font-size="${foot.size}" fill="${T.label}">${esc(line)}</text>`);
      y += Math.round(foot.size * 1.3);
    }
  }

  // QR + optional caption
  const qrPad = 18;
  // On a pale ground the QR's own white panel disappears into the card, so
  // it gets a hairline to stay a deliberate object.
  const qrFrameSvg = T.qrFrame
    ? `<rect x="${L.qr.x - 3}" y="${L.qr.y - 3}" width="${L.qr.box + 6}" height="${L.qr.box + 6}" rx="19" fill="none" stroke="${opts.accentHex}" stroke-opacity="0.38" stroke-width="3"/>`
    : '';
  const qr = qrFrameSvg + '\n    ' + await qrGroup(opts.subject_url, L.qr.x, L.qr.y, L.qr.box, qrPad);
  let captionSvg = '';
  const caption = opts.qr_caption_lines && opts.qr_caption_lines.length === 2 ? opts.qr_caption_lines : null;
  if (caption && L.qrCaption) {
    captionSvg = `<text x="${L.qrCaption.x}" y="${L.qrCaption.y}" text-anchor="${L.qrCaption.anchor}" font-family="${bodyFace.family}" font-weight="500" font-size="24" fill="${T.muted}">${esc(caption[0])}</text>
  <text x="${L.qrCaption.x}" y="${L.qrCaption.y + 30}" text-anchor="${L.qrCaption.anchor}" font-family="${bodyFace.family}" font-weight="500" font-size="24" fill="${T.muted}">${esc(caption[1])}</text>`;
  }

  // A brand with no logo image falls back to a wordmark, which was always
  // drawn white -- invisible on a pale card.
  const logoSvg = opts.logoUri
    ? `<image href="${opts.logoUri}" x="${L.logo.x}" y="${L.logo.y}" width="170" height="60" preserveAspectRatio="xMidYMid meet"/>`
    : (opts.wordmarkText ? wordmarkSvg(opts.wordmarkText, L.logo.x + 170, L.logo.y + 44, T.ink, face.family) : '');

  // A layout reserves a slot for the brand character. Brands that don't
  // have one (Evrylife) were leaving that part of the card visibly empty.
  // The slot now gets a drawn emblem -- two rings and a tick ring in the
  // surface's own ink, with the brand's mark centred inside it. Drawn rather
  // than a blown-up logo because a logo watermark at an opacity low enough
  // not to compete simply disappears on a dark ground.
  let mascotSvg = '';
  if (L.mascot && opts.mascotUri) {
    mascotSvg = `<image href="${opts.mascotUri}" x="${L.mascot.x}" y="${L.mascot.y}" width="${L.mascot.size}" height="${L.mascot.size}" preserveAspectRatio="xMidYMid meet"/>`;
  } else if (L.mascot) {
    const s = L.mascot.size;
    const cx = L.mascot.x + s / 2, cy = L.mascot.y + s / 2;
    const r = Math.round(s * 0.42);
    const ticks = Array.from({ length: 12 }).map((_, i) => {
      const a = (Math.PI / 6) * i;
      return `<line x1="${Math.round(cx + Math.cos(a) * r * 0.78)}" y1="${Math.round(cy + Math.sin(a) * r * 0.78)}" x2="${Math.round(cx + Math.cos(a) * r)}" y2="${Math.round(cy + Math.sin(a) * r)}" stroke="${T.ink}" stroke-opacity="0.20" stroke-width="3"/>`;
    }).join('');
    mascotSvg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.ink}" stroke-opacity="0.22" stroke-width="4"/>
  <circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.66)}" fill="none" stroke="${opts.accentHex}" stroke-opacity="${surface === 'light' ? 0.34 : 0.26}" stroke-width="3"/>
  ${ticks}
  ${opts.logoUri ? `<image href="${opts.logoUri}" x="${Math.round(cx - r * 0.5)}" y="${Math.round(cy - r * 0.22)}" width="${Math.round(r)}" height="${Math.round(r * 0.44)}" preserveAspectRatio="xMidYMid meet" opacity="0.55"/>` : ''}`;
  }

  const stripeSvg = L.stripe
    ? `<rect x="0" y="${L.stripe.y}" width="${W}" height="${L.stripe.h}" fill="${T.stripeFill}" fill-opacity="${T.stripeOpacity}"/>`
    : '';

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${opts.templateBg || surfaceGround(surface, opts.bgHex, opts.accentHex, opts.decorHex, opts.decorHex2, opts.motif, { y0: L.block.y - 70, y1: y + 40 }, opts.theme?.cardPaper)}
  ${stripeSvg}
  ${logoSvg}
  ${mascotSvg}
  ${parts.join('\n  ')}
  ${qr}
  ${captionSvg}
</svg>`;
}

async function buildHeroSvg(opts: {
  subject_name: string; headline_lines: string[]; location?: string; fact_lines?: string[];
  subject_url: string; accent_hex?: string; mascot_url?: string; logo_url?: string;
  wordmark_text?: string; cta_text?: string; qr_caption_lines?: string[]; brand?: string; motif?: string;
  bg_hex?: string; decor_hex?: string; decor_hex_2?: string; sku?: string; db_theme?: DbTheme | null;
  template_url?: string; layout_index?: number; layouts?: CardLayout[];
}) {
  const spinquestBrand = isSpinQuest(opts.brand);
  const theme = brandDefaults(opts.brand);
  const db = opts.db_theme;
  const layouts = opts.layouts && opts.layouts.length ? opts.layouts : CARD_LAYOUTS;
  const bgHex = opts.bg_hex || theme?.bgHex || db?.bgHex || NAVY;
  const accentHex = opts.accent_hex || theme?.accentHex || db?.accentHex || '#1E2963';
  const decorHex = opts.decor_hex || theme?.decorHex || db?.decorHex || CYAN;
  const decorHex2 = opts.decor_hex_2 || theme?.decorHex2 || db?.decorHex2 || INDIGO;
  const motif = opts.motif || db?.defaultMotif || theme?.motif || (opts.sku ? pickAutoMotif(opts.sku) : undefined);
  const mascotUrl = opts.mascot_url ?? theme?.mascotUrl ?? db?.mascotUrl ?? (spinquestBrand ? DEFAULT_WIZARD_URL : undefined);
  const logoUrl = opts.logo_url ?? theme?.logoUrl ?? db?.logoUrl ?? (spinquestBrand ? DEFAULT_LOGO_URL : undefined);
  const wordmarkText = opts.wordmark_text ?? theme?.wordmark;
  const { mascotUri, logoUri } = await sharedAssets(mascotUrl, logoUrl);
  const qrCaption = opts.qr_caption_lines && opts.qr_caption_lines.length === 2
    ? opts.qr_caption_lines
    : (theme?.qrCaption || (spinquestBrand ? ['Scan to', 'spin now'] : ['Scan to', 'learn more']));
  const ctaText = opts.cta_text
    || (theme?.ctaTemplate ? theme.ctaTemplate.replace('{subject}', opts.subject_name)
      : (spinquestBrand ? `Spin the ${opts.subject_name} wheel` : `Learn more about ${opts.subject_name}`));

  return await buildLayoutCardSvg({
    layouts,
    layoutIndex: opts.layout_index ?? 0,
    eyebrow: opts.subject_name.toUpperCase(),
    headline_lines: opts.headline_lines,
    headlineStart: 78,
    fact_lines: opts.fact_lines,
    cta_text: ctaText,
    location: opts.location,
    subject_url: opts.subject_url,
    qr_caption_lines: qrCaption,
    bgHex, accentHex, decorHex, decorHex2, motif,
    mascotUri, logoUri, wordmarkText,
    templateBg: await templateBackgroundOrNull(opts.template_url),
    theme: db,
  });
}

async function buildDetailSvg(opts: {
  subject_name: string; detail_name?: string; location?: string; fact_lines?: string[];
  subject_url: string; accent_hex?: string; mascot_url?: string; logo_url?: string;
  wordmark_text?: string; detail_label?: string; footer_cta?: string; brand?: string; motif?: string;
  bg_hex?: string; decor_hex?: string; decor_hex_2?: string; sku?: string; db_theme?: DbTheme | null;
  template_url?: string; layout_index?: number; layouts?: CardLayout[];
}) {
  const spinquestBrand = isSpinQuest(opts.brand);
  const theme = brandDefaults(opts.brand);
  const db = opts.db_theme;
  const layouts = opts.layouts && opts.layouts.length ? opts.layouts : CARD_LAYOUTS;
  const bgHex = opts.bg_hex || theme?.bgHex || db?.bgHex || NAVY;
  const accentHex = opts.accent_hex || theme?.accentHex || db?.accentHex || '#1E2963';
  const decorHex = opts.decor_hex || theme?.decorHex || db?.decorHex || CYAN;
  const decorHex2 = opts.decor_hex_2 || theme?.decorHex2 || db?.decorHex2 || INDIGO;
  const motif = opts.motif || db?.defaultMotif || theme?.motif || (opts.sku ? pickAutoMotif(opts.sku) : undefined);
  const mascotUrl = opts.mascot_url ?? theme?.mascotUrl ?? db?.mascotUrl ?? (spinquestBrand ? DEFAULT_WIZARD_URL : undefined);
  const logoUrl = opts.logo_url ?? theme?.logoUrl ?? db?.logoUrl ?? (spinquestBrand ? DEFAULT_LOGO_URL : undefined);
  const wordmarkText = opts.wordmark_text ?? theme?.wordmark;
  const { mascotUri, logoUri } = await sharedAssets(mascotUrl, logoUrl);
  const detailName = opts.detail_name || opts.subject_name;
  const detailLabel = opts.detail_label || theme?.detailLabel || (spinquestBrand ? 'QUEST SPOTLIGHT' : 'DETAIL');
  const footerCta = opts.footer_cta || theme?.footerCta
    || (spinquestBrand ? `Spin the ${opts.subject_name} wheel to land here` : `Learn more about ${opts.subject_name}`);

  // A detail card's headline is the detail name, split across two lines when
  // it's long -- the layout engine truncates rather than wraps, so the split
  // has to happen here.
  const headlineLines = estTextWidth(detailName, 58, 700) > layoutForIndex(layouts, (opts.layout_index ?? 0) + 3).block.maxWidth
    ? splitTwoLines(detailName).filter(Boolean)
    : [detailName];

  return await buildLayoutCardSvg({
    layouts,
    // Slide 2 sits three layouts away from slide 1 so the two cards of one
    // post never share a composition either.
    layoutIndex: (opts.layout_index ?? 0) + 3,
    eyebrow: detailLabel,
    headline_lines: headlineLines,
    headlineStart: 62,
    fact_lines: opts.fact_lines,
    footer_text: footerCta,
    location: opts.location,
    subject_url: opts.subject_url,
    bgHex, accentHex, decorHex, decorHex2, motif,
    mascotUri, logoUri, wordmarkText,
    templateBg: await templateBackgroundOrNull(opts.template_url),
    theme: db,
  });
}

// v29 (2026-09-11): a dedicated CLOSING slide, used for slide 3 whenever a
// template image is available for it (per-campaign `template_url` since v32,
// or the brand's own cc_brands.closing_template_url -- see Brand Settings'
// "Closing template" upload
// and the migration comment on that column). Brad's answered
// AskUserQuestion: the brand uploads one image and it's reused every time,
// not regenerated per post -- this function composites that fixed
// background with the per-post closing copy + a real QR code so every
// closing slide still actually works as a CTA, not just a static graphic.
//
// Takes the exact same opts shape buildDetailSvg already receives for
// slide 3 (detail_name = the closing line, fact_lines[0] = the subline,
// footer_cta as a fallback subline) so neither generate-campaign-content
// nor submit-client-feedback need any changes to call this -- the branch
// on which layout to use lives entirely in the Deno.serve dispatch below,
// keyed on whether this brand has a closing_template_url set.
async function buildClosingSvg(opts: {
  subject_name: string; detail_name?: string; fact_lines?: string[];
  subject_url: string; accent_hex?: string; logo_url?: string; footer_cta?: string;
  brand?: string; sku?: string; db_theme?: DbTheme | null; closing_template_url: string;
}) {
  const theme = brandDefaults(opts.brand);
  const db = opts.db_theme;
  const accentHex = opts.accent_hex || theme?.accentHex || db?.accentHex || '#1E2963';
  const logoUrl = opts.logo_url ?? theme?.logoUrl ?? db?.logoUrl;
  const closingLine = opts.detail_name || 'Ready?';
  const subLine = (opts.fact_lines && opts.fact_lines[0]) || opts.footer_cta || '';
  const templateMime = opts.closing_template_url.toLowerCase().match(/\.jpe?g(\?|$)/) ? 'image/jpeg' : 'image/png';

  const [{ logoUri }, bgUri] = await Promise.all([
    sharedAssets(undefined, logoUrl),
    toDataUri(opts.closing_template_url, templateMime).catch(() => ''),
  ]);

  const qrBox = 190, qrPad = 18, qrX = W - qrBox - 64, qrY = H - qrBox - 56;
  const qr = await qrGroup(opts.subject_url, qrX, qrY, qrBox, qrPad);

  const logoOrWordmark = logoUri
    ? `<image href="${logoUri}" x="${W - 170 - 48}" y="40" width="170" height="60" preserveAspectRatio="xMidYMid meet"/>`
    : '';

  const lineMaxWidth = W - 128;
  const lineSize = fitFontSize(closingLine, lineMaxWidth, 72, 40, 700);
  const closingFit = truncateToFit(closingLine, lineSize, lineMaxWidth, 700);
  const subFit = subLine ? truncateToFit(subLine, 30, lineMaxWidth, 500) : '';
  const textBlockY = H - 320;

  // If the upload somehow fails to fetch, fall back to a plain accent-color
  // background rather than a broken/blank image -- the copy + QR still
  // render correctly either way.
  const background = bgUri
    ? `<image href="${bgUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="${accentHex}"/>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="closingScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  ${background}
  <rect width="${W}" height="${H}" fill="url(#closingScrim)"/>
  ${logoOrWordmark}
  <text x="64" y="${textBlockY}" font-family="Poppins" font-weight="700" font-size="${lineSize}" fill="${WHITE}">${esc(closingFit)}</text>
  ${subFit ? `<text x="64" y="${textBlockY + 50}" font-family="Poppins" font-weight="500" font-size="30" fill="#E2E8F0">${esc(subFit)}</text>` : ''}
  ${qr}
</svg>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const key = req.headers.get('x-cc-key');
  if (!CC_KEY || key !== CC_KEY) return json({ error: 'unauthorized' }, 401);

  try {
    const body = await req.json();

    if (body.overflowcheck) {
      const [, fontBuffers] = await Promise.all([ensureWasm(), ensureFonts()]);
      const testString = body.test_string || 'A Very Long Quest Name That Might Overflow The Card Edge';
      const svg = await buildDetailSvg({
        subject_name: 'Test Wheel', detail_name: testString, location: 'Test Location',
        fact_lines: ['Line one of test fact content.', 'Line two of test fact content.'],
        subject_url: 'https://spinquest.app/q/test', accent_hex: '#1E2963',
      });
      const r = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Poppins' }, fitTo: { mode: 'width', value: W } });
      const pixmap = r.render();
      const w = pixmap.width;
      const px: Uint8Array = (pixmap as unknown as { pixels: Uint8Array }).pixels;
      const safeMarginX = W - 64;
      let rightmostInk = -1;
      for (let y = 200; y < 420; y++) {
        for (let x = w - 1; x >= 0; x--) {
          const idx = (y * w + x) * 4;
          const rr = px[idx], gg = px[idx + 1], bb = px[idx + 2], aa = px[idx + 3];
          if (aa > 40 && (rr > 200 || gg > 200 || bb > 200)) { if (x > rightmostInk) rightmostInk = x; break; }
        }
      }
      return json({ ok: true, overflowcheck: true, testString, rightmostInk, safeMarginX, crossedMargin: rightmostInk > safeMarginX });
    }

    if (body.layoutcheck) {
      const [, fontBuffers] = await Promise.all([ensureWasm(), ensureFonts()]);
      const svg = await buildHeroSvg({
        subject_name: 'Toronto Day Trips',
        headline_lines: ['Caribana Weekend Is', 'Live in Toronto'],
        location: 'Toronto, Canada',
        fact_lines: ['Grand Parade ran Lakeshore Blvd', 'to Coronation Park, festival', 'continues through Aug 3.'],
        subject_url: 'https://spinquest.app/w/e2000002-0000-0000-0000-000000000002',
        accent_hex: '#1E2963',
      });
      const r = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Poppins' }, fitTo: { mode: 'width', value: W } });
      const pixmap = r.render();
      const w = pixmap.width;
      const px: Uint8Array = (pixmap as unknown as { pixels: Uint8Array }).pixels;
      const scanMaxX = Math.min(700, w);
      let firstCyan = -1, lastCyan = -1, firstWhite = -1, lastWhite = -1;
      for (let y = 0; y < 260; y++) {
        for (let x = 0; x < scanMaxX; x += 2) {
          const idx = (y * w + x) * 4;
          const rr = px[idx], gg = px[idx + 1], bb = px[idx + 2];
          const isCyan = rr < 120 && gg > 180 && bb > 180;
          const isWhite = rr > 230 && gg > 230 && bb > 230;
          if (isCyan) { if (firstCyan === -1) firstCyan = y; lastCyan = y; }
          if (isWhite) { if (firstWhite === -1) firstWhite = y; lastWhite = y; }
        }
      }
      return json({ ok: true, layoutcheck: true, scanMaxX, firstCyan, lastCyan, firstWhite, lastWhite, gap: firstWhite - lastCyan, overlap: firstWhite !== -1 && firstCyan !== -1 && firstWhite <= lastCyan });
    }

    if (body.qrsizecheck) {
      return json({ ok: true, hero_qr_box: 190, hero_qr_pad: 18, detail_qr_box: 190, detail_qr_pad: 18, match: true });
    }

    // Alchemist card engine first. The classic drawing below is only the fallback:
    // for a brand that chose the classic cards (render-card-v2 answers use_classic),
    // or when v2 is unavailable. Without this every redo came out as an old template
    // with no picture.
    if (body.sku && !body.classic_only) {
      try {
        const v2 = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/render-card-v2`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-cc-key': CC_KEY },
          body: JSON.stringify(body),
        });
        const v2json = await v2.json().catch(() => null);
        if (v2.ok && v2json && v2json.ok && !v2json.use_classic) return json(v2json);
      } catch (_e) { /* fall through to the classic card */ }
    }

    const {
      sku, slide, brand,
      wheel_name, subject_name,
      headline_lines, location, fact_lines,
      quest_name, detail_name,
      wheel_url, subject_url,
      accent_hex, wizard_url, mascot_url, logo_url, wordmark_text,
      cta_text, qr_caption_lines, detail_label, footer_cta, motif,
      bg_hex, decor_hex, decor_hex_2, template_url, layout,
    } = body;
    const subjectName = subject_name || wheel_name;
    const subjectUrl = subject_url || wheel_url;
    const mascotUrlIn = mascot_url || wizard_url;
    const detailNameIn = detail_name || quest_name;

    const slideNum = [2, 3].includes(Number(slide)) ? Number(slide) : 1;
    if (!sku || !subjectName || !subjectUrl || (slideNum === 1 && !headline_lines)) {
      return json({ error: 'sku, wheel_name/subject_name, wheel_url/subject_url are required (headline_lines required for slide 1)' }, 400);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // v28: look up this brand's own cc_brands row (colors/logo/character
    // pool) once per render -- see fetchDbTheme's comment. Never blocks the
    // render if it errors; a null db theme just means the existing
    // hardcoded fallbacks apply exactly as before.
    const dbTheme = await fetchDbTheme(supabase, brand).catch(() => null);
    // v36: compositions come from cc_card_layouts (see loadCardLayouts).
    const cardLayouts = await loadCardLayouts(supabase, brand);
    // Which composition this card uses. Accepts a layout key ('poster') or
    // an index; with nothing passed it falls back to a stable per-sku pick,
    // so even a caller that knows nothing about layouts still gets variety
    // ACROSS posts instead of the one look every card used to have.
    const layoutIndex = layoutIndexFromKeyOrNumber(
      cardLayouts,
      layout,
      sku ? Math.abs(String(sku).split('').reduce((a: number, c: string) => ((a * 31) + c.charCodeAt(0)) | 0, 7)) : 0,
    );

    // v40: the card is set in ONE face, and the renderer is given only that
    // face's files. Handing it every family is what let the matcher set a
    // card in whichever face it happened to prefer.
    const slideIdx = slideNum === 2 || slideNum === 3 ? layoutIndex + 3 : layoutIndex;
    const slideLayout = layoutForIndex(cardLayouts, slideIdx);
    const cardFace = cardFaceFor(slideLayout, dbTheme);
    const cardBodyFace = cardBodyFaceFor(slideLayout, dbTheme);
    // Both of the brand's faces, when it has two. The body face is the
    // DEFAULT family, so if per-element matching lets us down the card is
    // still entirely in the brand's own typography.
    const faceFamilies = [cardBodyFace.family, cardFace.family].filter((f, i, a) => a.indexOf(f) === i);
    const [, ...loaded] = await Promise.all([
      ensureWasm(),
      ...faceFamilies.map((f) => fontBuffersFor(f)),
    ]);
    const fontBuffers = (loaded as Uint8Array[][]).flat();
    // Slide 3 gets the brand's own uploaded closing template when one is
    // set (cc_brands.closing_template_url) -- otherwise it falls through
    // to the same generic buildDetailSvg layout slide 2 uses, exactly as
    // before. See buildClosingSvg's comment for why no caller changes are
    // needed for this branch.
    // v32: a per-request `template_url` (the campaign's uploaded example
    // template) wins over the brand's own closing template on slide 3, and
    // is the only way slides 1/2 get a background image at all. Slide 3
    // still uses the closing LAYOUT (copy anchored in the bottom band) when
    // either template source is present, since that layout exists precisely
    // to sit on top of an image.
    const closingTemplate = (typeof template_url === 'string' && template_url) || dbTheme?.closingTemplateUrl;
    const svg = slideNum === 1
      ? await buildHeroSvg({
          subject_name: subjectName, headline_lines, location, fact_lines, subject_url: subjectUrl,
          accent_hex, mascot_url: mascotUrlIn, logo_url, wordmark_text, cta_text, qr_caption_lines, brand, motif,
          bg_hex, decor_hex, decor_hex_2, sku, db_theme: dbTheme, template_url, layout_index: layoutIndex, layouts: cardLayouts,
        })
      : (slideNum === 3 && closingTemplate)
      ? await buildClosingSvg({
          subject_name: subjectName, detail_name: detailNameIn, fact_lines, subject_url: subjectUrl,
          accent_hex, logo_url, footer_cta, brand, sku, db_theme: dbTheme,
          closing_template_url: closingTemplate,
        })
      : await buildDetailSvg({
          subject_name: subjectName, detail_name: detailNameIn, location, fact_lines, subject_url: subjectUrl,
          accent_hex, mascot_url: mascotUrlIn, logo_url, wordmark_text, detail_label, footer_cta, brand, motif,
          bg_hex, decor_hex, decor_hex_2, sku, db_theme: dbTheme, template_url, layout_index: layoutIndex, layouts: cardLayouts,
        });

    const fontOpt = { fontBuffers, loadSystemFonts: false, defaultFontFamily: cardBodyFace.family };
    const resvg = new Resvg(svg, { font: fontOpt, fitTo: { mode: 'width', value: W } });
    const pngBuffer = resvg.render().asPng();

    const destPath = `content-calendar/${sku}/card_${slideNum}.png`;
    const { error: upErr } = await supabase.storage.from('wheel-assets').upload(destPath, pngBuffer, {
      contentType: 'image/png',
      upsert: true,
    });
    if (upErr) return json({ error: `storage upload failed: ${upErr.message}` }, 500);
    const { data: pub } = supabase.storage.from('wheel-assets').getPublicUrl(destPath);
    const publicUrl = pub.publicUrl;

    const thumbResvg = new Resvg(svg, { font: fontOpt, fitTo: { mode: 'width', value: 240 } });
    const thumbBuf = thumbResvg.render().asPng();
    const thumbDataUri = `data:image/png;base64,${encodeBase64(thumbBuf)}`;

    const { data: existing } = await supabase.from('content_calendar').select('media_urls').eq('sku', sku).single();
    // One image per slide: drop any earlier URL for this slide (bare or ?v= cache-busted), then keep slide order.
    const basePathOf = (u: string) => String(u).split('?')[0];
    const slideNumOf = (u: string) => { const m = basePathOf(u).match(/card_(\d+)\.png$/); return m ? parseInt(m[1], 10) : 99; };
    const merged = Array.from(new Set([...((existing?.media_urls as string[]) || []).filter((u: string) => basePathOf(u) !== publicUrl), publicUrl])).sort((x, y) => slideNumOf(x) - slideNumOf(y));
    const patch: Record<string, unknown> = { media_urls: merged };
    patch[slideNum === 1 ? 'thumb_data_uri' : slideNum === 2 ? 'thumb_data_uri_2' : 'thumb_data_uri_3'] = thumbDataUri;
    const { error: dbErr } = await supabase.from('content_calendar').update(patch).eq('sku', sku);
    if (dbErr) return json({ error: `db update failed: ${dbErr.message}` }, 500);

    return json({ ok: true, sku, slide: slideNum, url: publicUrl, bytes: pngBuffer.length, thumb: true, motif: motif || null, brandTheme: !!brandDefaults(brand), dbBrandThemeUsed: !!dbTheme, closingTemplateUsed: slideNum === 3 && !!closingTemplate, exampleTemplateUsed: !!(typeof template_url === 'string' && template_url), layout: layoutForIndex(cardLayouts, slideNum === 2 || slideNum === 3 ? layoutIndex + 3 : layoutIndex).key, layoutSource: cardLayouts === CARD_LAYOUTS ? 'builtin' : 'db', surface: cardSurfaceFor(slideLayout, slideIdx, dbTheme), typeface: cardFace.family, bodyTypeface: cardBodyFace.family, brandFont: dbTheme?.cardFont || null, ground: dbTheme?.cardBg || null, paper: dbTheme?.cardPaper || null, headlineCase: dbTheme?.cardCase || slideLayout.headlineCase || 'normal' });
  } catch (e) {
    return json({ error: String(e), stack: (e as Error)?.stack }, 500);
  }
});

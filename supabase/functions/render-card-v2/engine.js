// alchemy-engine -- the Alchemist's card designer (2026-10-08).
//
// Brad: "all the content for multiple brands all looks similar. the text is
// in the same spot, the logos are in the same spots, there is clear
// templates." and "HUGE UPGRADE for the content creator".
//
// Pure ESM, no Node or Deno APIs, so the exact same file runs in the local
// test harness and inside the Supabase edge function. It builds a satori
// element tree; the caller turns it into SVG (satori) and PNG (resvg).
//
// A card = brand DESIGN (palette, fonts, preset grammar, logo, mascot,
// photos) x ARCHETYPE (statement, numeral, list, quote, event, photo, split,
// typewall, mascot, mark, photo-only, index, sticker, cover) x a SEED
// (sku + slide) that varies alignment, ornament placement, logo treatment
// and mascot pose. Two brands never share a look; one brand never repeats
// the same composition twice in a row.
//
// Text never overflows: every block is fitted with real font metrics (the
// caller passes a measure() backed by the actual font files) and laid out
// with explicit line breaks, so what is measured is exactly what is drawn.

// ── Font library (fontsource ids, all v5.3.0 on npm / jsdelivr) ─────────
export const FONT_LIBRARY = {
  'Fraunces': { id: 'fraunces', w: [400, 600, 700, 900], it: true, cat: 'serif' },
  'Playfair Display': { id: 'playfair-display', w: [400, 700, 900], it: true, cat: 'serif' },
  'DM Serif Display': { id: 'dm-serif-display', w: [400], it: true, cat: 'serif' },
  'Instrument Serif': { id: 'instrument-serif', w: [400], it: true, cat: 'serif' },
  'Cormorant Garamond': { id: 'cormorant-garamond', w: [400, 600, 700], it: true, cat: 'serif' },
  'Inter': { id: 'inter', w: [400, 600, 800, 900], it: false, cat: 'sans' },
  'Space Grotesk': { id: 'space-grotesk', w: [400, 500, 700], it: false, cat: 'sans' },
  'Archivo': { id: 'archivo', w: [400, 600, 800, 900], it: false, cat: 'sans' },
  'Archivo Black': { id: 'archivo-black', w: [400], it: false, cat: 'sans' },
  'Sora': { id: 'sora', w: [400, 600, 800], it: false, cat: 'sans' },
  'Manrope': { id: 'manrope', w: [400, 600, 800], it: false, cat: 'sans' },
  'Poppins': { id: 'poppins', w: [400, 600, 800, 900], it: false, cat: 'sans' },
  'Fredoka': { id: 'fredoka', w: [400, 600, 700], it: false, cat: 'rounded' },
  'Nunito': { id: 'nunito', w: [400, 700, 900], it: false, cat: 'rounded' },
  'Bebas Neue': { id: 'bebas-neue', w: [400], it: false, cat: 'condensed' },
  'Anton': { id: 'anton', w: [400], it: false, cat: 'condensed' },
  'Oswald': { id: 'oswald', w: [400, 600, 700], it: false, cat: 'condensed' },
  'Barlow Condensed': { id: 'barlow-condensed', w: [400, 600, 800, 900], it: true, cat: 'condensed' },
  'IBM Plex Mono': { id: 'ibm-plex-mono', w: [400, 600, 700], it: false, cat: 'mono' },
  'Space Mono': { id: 'space-mono', w: [400, 700], it: false, cat: 'mono' },
  'Caveat': { id: 'caveat', w: [400, 700], it: false, cat: 'hand' },
  'Permanent Marker': { id: 'permanent-marker', w: [400], it: false, cat: 'hand' },
  'DM Sans': { id: 'dm-sans', w: [400, 700, 900], it: false, cat: 'sans' },
  'Syne': { id: 'syne', w: [400, 700, 800], it: false, cat: 'display' },
  'Unbounded': { id: 'unbounded', w: [400, 700, 900], it: false, cat: 'display' },
  'Rubik': { id: 'rubik', w: [400, 700, 900], it: false, cat: 'rounded' },
  'Outfit': { id: 'outfit', w: [400, 700, 900], it: false, cat: 'sans' },
};

export function nearestWeight(family, want) {
  const f = FONT_LIBRARY[family];
  const ws = f ? f.w : [400, 700];
  return ws.reduce((b, w) => (Math.abs(w - want) < Math.abs(b - want) ? w : b), ws[0]);
}

// ── Presets: the compositional grammar a brand is expressed through ──────
// Each one changes the GROUND, the ORNAMENT, rules, corners, case, density
// and which archetypes it leans on -- so an archetype drawn in two presets
// shares a data shape and nothing visual.
export const PRESETS = {
  editorial: {
    label: 'Editorial almanac', ground: 'paper', ornament: 'rings', rule: 'hairline', corner: 0,
    displayCase: 'normal', displayWeight: 600, bodyWeight: 400, density: 'airy', labelStyle: 'smallcaps',
    cta: 'underline', fonts: ['Fraunces', 'Inter'], lean: ['statement', 'quote', 'cover', 'index', 'numeral', 'list'],
  },
  bold: {
    label: 'Bold blocks', ground: 'block', ornament: 'diagonal', rule: 'heavy', corner: 10,
    displayCase: 'upper', displayWeight: 900, bodyWeight: 600, density: 'tight', labelStyle: 'tag',
    cta: 'pill', fonts: ['Archivo', 'Archivo'], lean: ['typewall', 'statement', 'numeral', 'sticker', 'split', 'event'],
  },
  club: {
    label: 'Night flyer', ground: 'ink', ornament: 'glow', rule: 'none', corner: 0,
    displayCase: 'upper', displayWeight: 400, bodyWeight: 600, density: 'tight', labelStyle: 'outline',
    cta: 'outline', fonts: ['Bebas Neue', 'Barlow Condensed'], lean: ['typewall', 'event', 'photo', 'statement', 'numeral'],
  },
  blueprint: {
    label: 'Blueprint spec', ground: 'ink', ornament: 'grid', rule: 'hairline', corner: 2,
    displayCase: 'normal', displayWeight: 700, bodyWeight: 400, density: 'balanced', labelStyle: 'mono',
    cta: 'bracket', fonts: ['Space Grotesk', 'IBM Plex Mono'], lean: ['index', 'numeral', 'statement', 'list', 'split'],
  },
  playful: {
    label: 'Playful bands', ground: 'bands', ornament: 'blobs', rule: 'none', corner: 36,
    displayCase: 'normal', displayWeight: 700, bodyWeight: 600, density: 'balanced', labelStyle: 'chip',
    cta: 'pill', fonts: ['Fredoka', 'Nunito'], lean: ['sticker', 'mascot', 'statement', 'list', 'event', 'photo'],
  },
  terminal: {
    label: 'Trading terminal', ground: 'ink', ornament: 'ticker', rule: 'hairline', corner: 4,
    displayCase: 'normal', displayWeight: 700, bodyWeight: 400, density: 'dense', labelStyle: 'mono',
    cta: 'bracket', fonts: ['IBM Plex Mono', 'Inter'], lean: ['numeral', 'index', 'list', 'statement'],
  },
  luxe: {
    label: 'Luxe evening', ground: 'ink', ornament: 'frame', rule: 'hairline', corner: 0,
    displayCase: 'normal', displayWeight: 400, bodyWeight: 400, density: 'airy', labelStyle: 'spaced',
    cta: 'underline', fonts: ['Cormorant Garamond', 'Manrope'], lean: ['quote', 'photo', 'statement', 'cover', 'mark'],
  },
  sport: {
    label: 'Sport energy', ground: 'block', ornament: 'stripes', rule: 'heavy', corner: 0,
    displayCase: 'upper', displayWeight: 900, bodyWeight: 600, density: 'tight', labelStyle: 'tag',
    cta: 'pill', fonts: ['Barlow Condensed', 'Inter'], lean: ['typewall', 'numeral', 'photo', 'event', 'split'],
  },
  organic: {
    label: 'Organic market', ground: 'paper', ornament: 'waves', rule: 'none', corner: 24,
    displayCase: 'normal', displayWeight: 700, bodyWeight: 400, density: 'airy', labelStyle: 'hand',
    cta: 'pill', fonts: ['DM Serif Display', 'DM Sans'], lean: ['photo', 'split', 'statement', 'list', 'quote'],
  },
  gradient: {
    label: 'Glow gradient', ground: 'mesh', ornament: 'sparkle', rule: 'none', corner: 28,
    displayCase: 'normal', displayWeight: 800, bodyWeight: 400, density: 'balanced', labelStyle: 'glass',
    cta: 'pill', fonts: ['Sora', 'Inter'], lean: ['statement', 'numeral', 'mascot', 'event', 'list', 'sticker'],
  },
  swiss: {
    label: 'Swiss grid', ground: 'paper', ornament: 'none', rule: 'heavy', corner: 0,
    displayCase: 'normal', displayWeight: 800, bodyWeight: 400, density: 'balanced', labelStyle: 'plain',
    cta: 'arrow', fonts: ['Inter', 'Inter'], lean: ['statement', 'index', 'numeral', 'list', 'split', 'cover'],
  },
  pop: {
    label: 'Pop poster', ground: 'block', ornament: 'halftone', rule: 'heavy', corner: 20,
    displayCase: 'upper', displayWeight: 900, bodyWeight: 700, density: 'tight', labelStyle: 'tag',
    cta: 'pill', fonts: ['Unbounded', 'Rubik'], lean: ['sticker', 'typewall', 'mascot', 'numeral', 'statement', 'event'],
  },
};

export const ARCHETYPES = ['statement', 'numeral', 'list', 'quote', 'event', 'photo', 'split', 'typewall', 'mascot', 'mark', 'photoonly', 'index', 'sticker', 'cover'];

// ── Small utilities ───────────────────────────────────────────────────────
export function rng(seedStr) {
  let h = 1779033703 ^ String(seedStr || 'seed').length;
  for (const c of String(seedStr || 'seed')) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p, range: (a1, b1) => a1 + next() * (b1 - a1) };
}

function clampHex(h, fallback) {
  const s = String(h || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return fallback;
}
function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hex([r, g, b]) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
export function mix(a, b, t) { const A = rgb(a), B = rgb(b); return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
function lum(h) { const c = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
export function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export function isDark(h) { return lum(h) < 0.22; }
function rgba(h, a) { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; }
function best(bg, cands) { return cands.reduce((b, c) => (contrast(bg, c) > contrast(bg, b) ? c : b), cands[0]); }

// Resolve a brand palette into the roles the archetypes ask for, with every
// text colour checked for contrast against the surface it sits on.
export function resolvePalette(p = {}) {
  const ink0 = clampHex(p.ink, '#141414');
  const paper0 = clampHex(p.paper, '#f6f2ea');
  const accent = clampHex(p.accent, '#ff5a36');
  const second = clampHex(p.second, mix(accent, '#2b59ff', 0.6));
  const ground = clampHex(p.ground, ink0);
  const dark = isDark(ground);
  const ink = dark ? best(ground, [paper0, '#ffffff']) : best(ground, [ink0, '#111111']);
  const paper = dark ? paper0 : ground;
  const muted = mix(ink, ground, 0.42);
  const onAccent = best(accent, [ink0, paper0, '#ffffff', '#111111']);
  const onSecond = best(second, [ink0, paper0, '#ffffff', '#111111']);
  // An accent that disappears on the ground is swapped for one that reads.
  const accentOnGround = contrast(accent, ground) >= 2.2 ? accent : (contrast(second, ground) >= 2.2 ? second : ink);
  return { ground, ink, paper, ink0, paper0, accent, second, muted, onAccent, onSecond, accentOnGround, dark };
}

// ── Text fitting with real metrics ────────────────────────────────────────
// measure(text, family, weight, size, letterSpacingPx) -> width in px.
function wrapWords(measure, words, family, weight, size, ls, maxW) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? cur + ' ' + w : w;
    if (measure(tryLine, family, weight, size, ls) <= maxW) cur = tryLine;
    else {
      if (!cur) return null; // one word wider than the box at this size
      lines.push(cur);
      if (measure(w, family, weight, size, ls) > maxW) return null;
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
// Balance: after greedy wrap, try to even the last line out.
function balanceLines(measure, lines, family, weight, size, ls, maxW) {
  if (lines.length < 2) return lines;
  const words = lines.join(' ').split(' ');
  let lo = maxW * 0.5, hi = maxW, bestL = lines;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const l = wrapWords(measure, words, family, weight, size, ls, mid);
    if (l && l.length <= lines.length) { bestL = l; hi = mid; } else lo = mid;
  }
  return bestL;
}
export function fitText(measure, text, o) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { size: 0, lines: [], height: 0 };
  const t = o.upper ? raw.toUpperCase() : raw;
  const words = t.split(' ');
  const lh = o.lh || 1.08;
  let lo = o.min || 14, hi = o.max || 160, bestFit = null;
  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2);
    const ls = (o.tracking || 0) * size;
    const lines = wrapWords(measure, words, o.family, o.weight, size, ls, o.maxW);
    const ok = lines && lines.length * size * lh <= o.maxH && (!o.maxLines || lines.length <= o.maxLines);
    if (ok) { bestFit = { size, lines }; lo = size + 1; } else hi = size - 1;
  }
  if (!bestFit) {
    // Even the minimum overflows: hard-truncate words so it can never spill.
    const size = o.min || 14, ls = (o.tracking || 0) * size;
    let ws = words.slice();
    let lines = null;
    while (ws.length > 1) {
      lines = wrapWords(measure, ws.concat('…'), o.family, o.weight, size, ls, o.maxW);
      if (lines && lines.length * size * lh <= o.maxH) break;
      ws = ws.slice(0, -1);
    }
    bestFit = { size, lines: lines || [ws[0]] };
  }
  const ls = (o.tracking || 0) * bestFit.size;
  const lines = o.balance === false ? bestFit.lines : balanceLines(measure, bestFit.lines, o.family, o.weight, bestFit.size, ls, o.maxW);
  return { size: bestFit.size, lines, height: lines.length * bestFit.size * lh, ls, lh };
}

// ── Element helpers (satori takes React-element-shaped objects) ──────────
export function el(type, style = {}, children = [], extra = {}) {
  const kids = Array.isArray(children) ? children.filter((c) => c !== null && c !== undefined && c !== false) : children;
  const st = type === 'img' ? { ...style } : { display: 'flex', ...style };
  for (const k of Object.keys(st)) if (st[k] === undefined || st[k] === null) delete st[k];
  const props = { style: st, ...extra };
  if (type !== 'img') props.children = kids;
  return { type, props };
}
const div = (style, children, extra) => el('div', style, children, extra);
const img = (src, style) => el('img', style, [], { src });
function textBlock(fit, style) {
  return div({ flexDirection: 'column', ...style }, fit.lines.map((l) => div({
    fontSize: fit.size, lineHeight: `${fit.size * fit.lh}px`, letterSpacing: fit.ls ? `${fit.ls}px` : undefined, whiteSpace: 'pre',
  }, [l])));
}
// 2026-10-11 (v13): height estimate for a laid-out tree. Every text block
// here is fitted, so its line heights are known; columns add up, rows take
// the tallest child. Used to keep the footer (QR + CTA) clear of the words.
function pxv(v) { if (typeof v === 'number') return v; if (typeof v === 'string') { const m = v.match(/^(-?[\d.]+)px$/); if (m) return +m[1]; } return 0; }
function boxY(st) {
  let t = 0;
  if (st.padding !== undefined) {
    if (typeof st.padding === 'number') t += 2 * st.padding;
    else { const p = String(st.padding).trim().split(/\s+/).map(pxv); t += p.length === 1 ? 2 * p[0] : p[0] + (p.length >= 3 ? p[2] : p[0]); }
  }
  t += pxv(st.paddingTop) + pxv(st.paddingBottom);
  const bw = (x) => { const m = typeof x === 'string' && x.match(/^([\d.]+)px/); return m ? +m[1] : 0; };
  if (st.border) t += 2 * bw(st.border);
  return t + bw(st.borderTop) + bw(st.borderBottom);
}
export function estH(n, root = false) {
  if (!n || typeof n !== 'object') return 0;
  const st = (n.props && n.props.style) || {};
  if (!root && st.position === 'absolute') return 0;
  const mY = pxv(st.marginTop) + pxv(st.marginBottom);
  if (typeof st.height === 'number') return st.height + mY;
  const raw = n.props ? n.props.children : null;
  const kids = (Array.isArray(raw) ? raw : [raw]).filter((c) => c !== null && c !== undefined && c !== false);
  const objs = kids.filter((c) => typeof c === 'object');
  let inner;
  if (!objs.length) inner = kids.length ? (pxv(st.lineHeight) || (pxv(st.fontSize) || 24) * 1.2) : 0;
  else if ((st.flexDirection || 'row').startsWith('column')) {
    const hs = objs.map((c) => estH(c)).filter((h, i) => h > 0 || (objs[i].props && objs[i].props.style && objs[i].props.style.position !== 'absolute'));
    inner = hs.reduce((a, b) => a + b, 0) + pxv(st.rowGap !== undefined ? st.rowGap : st.gap) * Math.max(0, hs.length - 1);
  } else inner = Math.max(0, ...objs.map((c) => estH(c)));
  return Math.max(inner + boxY(st), pxv(st.minHeight)) + mY;
}
function qrOuter(size, style) {
  const pad = Math.round(size * 0.08) + 6;
  if (style === 'frame') return size + 2 * (pad - 2) + 12;
  if (style === 'label') return size + pad + Math.round(pad * 0.6) + 6 + Math.round(Math.max(16, Math.round(size * 0.1)) * 1.2);
  return size + 2 * pad;
}

const svgUri = (svg) => 'data:image/svg+xml;base64,' + b64(svg);
function b64(s) {
  if (typeof btoa === 'function') { const bytes = new TextEncoder().encode(s); let bin = ''; for (const x of bytes) bin += String.fromCharCode(x); return btoa(bin); }
  return Buffer.from(s, 'utf8').toString('base64');
}

// ── Ornaments: drawn structures, never logo watermarks ───────────────────
export function ornamentSvg(kind, W, H, c, r, P, avoid = []) {
  const s = (inner, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${extra}>${inner}</svg>`;
  const op = (o) => `stroke-opacity="${o}" fill-opacity="${o}"`;
  switch (kind) {
    case 'rings': {
      const cx = r.pick([W * 0.9, W * 0.1, W * 0.85]), cy = r.pick([H * 0.12, H * 0.88, H * 0.2]);
      let g = '';
      for (let i = 1; i <= 9; i++) g += `<circle cx="${cx}" cy="${cy}" r="${i * 70}" fill="none" stroke="${c}" stroke-width="${i % 3 === 0 ? 2.5 : 1.2}" ${op(0.35)}/>`;
      g += `<line x1="${cx - 700}" y1="${cy}" x2="${cx + 700}" y2="${cy}" stroke="${c}" stroke-width="1.2" stroke-opacity="0.3"/>`;
      g += `<line x1="${cx}" y1="${cy - 700}" x2="${cx}" y2="${cy + 700}" stroke="${c}" stroke-width="1.2" stroke-opacity="0.3"/>`;
      return s(g);
    }
    case 'grid': {
      let g = '';
      const step = r.pick([54, 60, 72]);
      for (let x = 0; x <= W; x += step) g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c}" stroke-width="${x % (step * 4) === 0 ? 1.6 : 0.7}" stroke-opacity="0.22"/>`;
      for (let y = 0; y <= H; y += step) g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-width="${y % (step * 4) === 0 ? 1.6 : 0.7}" stroke-opacity="0.22"/>`;
      const cx = r.range(W * 0.55, W * 0.85), cy = r.range(H * 0.1, H * 0.3);
      g += `<circle cx="${cx}" cy="${cy}" r="120" fill="none" stroke="${c}" stroke-width="1.5" stroke-opacity="0.5" stroke-dasharray="6 8"/>`;
      g += `<line x1="${cx - 160}" y1="${cy}" x2="${cx + 160}" y2="${cy}" stroke="${c}" stroke-opacity="0.5"/><line x1="${cx}" y1="${cy - 160}" x2="${cx}" y2="${cy + 160}" stroke="${c}" stroke-opacity="0.5"/>`;
      return s(g);
    }
    case 'diagonal': {
      const a = r.pick([P.accent, P.second]);
      const flip = r.chance(0.5);
      const pts = flip ? `0,${H * 0.62} ${W},${H * 0.38} ${W},${H} 0,${H}` : `0,${H * 0.36} ${W},${H * 0.64} ${W},${H} 0,${H}`;
      return s(`<polygon points="${pts}" fill="${a}"/><polygon points="${flip ? `0,${H * 0.62} ${W},${H * 0.38} ${W},${H * 0.42} 0,${H * 0.66}` : `0,${H * 0.36} ${W},${H * 0.64} ${W},${H * 0.68} 0,${H * 0.40}`}" fill="${c}" fill-opacity="0.9"/>`);
    }
    case 'glow': {
      const a = P.accent, b = P.second;
      const x1 = r.range(0.1, 0.4) * W, y1 = r.range(0.05, 0.3) * H, x2 = r.range(0.6, 0.95) * W, y2 = r.range(0.6, 0.95) * H;
      return s(`<defs><radialGradient id="g1"><stop offset="0" stop-color="${a}" stop-opacity="0.75"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient><radialGradient id="g2"><stop offset="0" stop-color="${b}" stop-opacity="0.65"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient></defs><circle cx="${x1}" cy="${y1}" r="${W * 0.6}" fill="url(#g1)"/><circle cx="${x2}" cy="${y2}" r="${W * 0.65}" fill="url(#g2)"/>`);
    }
    case 'blobs': {
      let g = '';
      const cols = [P.accent, P.second, mix(P.accent, P.paper0, 0.5)];
      for (let i = 0; i < 3; i++) {
        const cx = r.range(-0.1, 1.1) * W, cy = r.pick([r.range(-0.05, 0.2), r.range(0.8, 1.05)]) * H, rr = r.range(150, 300);
        let d = '';
        const n = 7;
        for (let k = 0; k <= n; k++) {
          const ang = (k / n) * Math.PI * 2, rad = rr * (0.75 + r.next() * 0.5);
          const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
          d += (k === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
        }
        g += `<path d="${d}Z" fill="${cols[i % 3]}" fill-opacity="0.9" stroke-linejoin="round" stroke="${cols[i % 3]}" stroke-width="60"/>`;
      }
      return s(g);
    }
    case 'ticker': {
      // The chart line stays in the lower band, under the copy and above the footer.
      let pts = '', y = H * r.range(0.8, 0.86);
      for (let x = 0; x <= W; x += 24) { y += r.range(-16, 14); y = Math.max(H * 0.76, Math.min(H * 0.89, y)); pts += `${x},${y.toFixed(1)} `; }
      let grid = '';
      for (let gy = 0; gy < H; gy += 90) grid += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="${c}" stroke-opacity="0.12"/>`;
      return s(`${grid}<polyline points="${pts}" fill="none" stroke="${P.accent}" stroke-width="4" stroke-opacity="0.6"/><polyline points="${pts} ${W},${H} 0,${H}" fill="${P.accent}" fill-opacity="0.08" stroke="none"/>`);
    }
    case 'frame': {
      const m = 34;
      return s(`<rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}" fill="none" stroke="${c}" stroke-opacity="0.55" stroke-width="1.5"/><rect x="${m + 12}" y="${m + 12}" width="${W - 2 * m - 24}" height="${H - 2 * m - 24}" fill="none" stroke="${c}" stroke-opacity="0.3" stroke-width="1"/>`);
    }
    case 'stripes': {
      let g = '';
      const wdt = r.pick([18, 26, 34]), ang = r.pick([-24, 24, -60]);
      for (let x = -H; x < W + H; x += wdt * 3) g += `<rect x="${x}" y="-200" width="${wdt}" height="${H + 400}" fill="${c}" fill-opacity="0.12" transform="rotate(${ang} ${W / 2} ${H / 2})"/>`;
      return s(g);
    }
    case 'waves': {
      let g = '';
      for (let i = 0; i < 6; i++) {
        const y0 = H * (0.72 + i * 0.05), amp = r.range(14, 30);
        let d = `M0 ${y0}`;
        for (let x = 0; x <= W; x += 60) d += ` Q ${x + 30} ${y0 + (i % 2 ? amp : -amp)} ${x + 60} ${y0}`;
        g += `<path d="${d}" fill="none" stroke="${i % 2 ? P.accent : c}" stroke-width="3" stroke-opacity="${0.5 - i * 0.05}"/>`;
      }
      return s(g);
    }
    case 'sparkle': {
      let g = '';
      // 2026-10-12: sparkles keep clear of the words, logo and footer (one sat
      // behind a headline letter). Up to 14 tries each; skipped if no room.
      const clear = (x, y, z) => !avoid.some(([x0, y0, x1, y1]) => x > x0 - z - 10 && x < x1 + z + 10 && y > y0 - z - 10 && y < y1 + z + 10);
      for (let i = 0; i < 7; i++) {
        let x = 0, y = 0, z = r.range(10, 30), ok = false;
        for (let t = 0; t < 14 && !ok; t++) { x = r.range(0.05, 0.95) * W; y = r.pick([r.range(0.03, 0.25), r.range(0.75, 0.97), r.range(0.25, 0.75)]) * H; ok = clear(x, y, z); }
        if (!ok) continue;
        avoid = avoid.concat([[x - z, y - z, x + z, y + z]]);   // and clear of each other
        g += `<path d="M${x} ${y - z} Q${x} ${y} ${x + z} ${y} Q${x} ${y} ${x} ${y + z} Q${x} ${y} ${x - z} ${y} Q${x} ${y} ${x} ${y - z}Z" fill="${c}" fill-opacity="0.85"/>`;
      }
      return s(g);
    }
    case 'halftone': {
      let g = '';
      const cx = r.pick([0, W]), cy = r.pick([0, H]);
      for (let y = 0; y < H; y += 26) for (let x = 0; x < W; x += 26) {
        const d = Math.hypot(x - cx, y - cy) / Math.hypot(W, H);
        const rad = Math.max(0, 10 * (1 - d * 1.6));
        if (rad > 0.6) g += `<circle cx="${x}" cy="${y}" r="${rad.toFixed(1)}" fill="${c}" fill-opacity="0.5"/>`;
      }
      return s(g);
    }
    default: return null;
  }
}

// ── Pieces shared by every archetype ─────────────────────────────────────
// 2026-10-11 (v12): Brad: "QR codes are always the same size and always in
// the same spot ... variety! not templates." Size, frame and side now vary
// per card (seeded). The code always keeps a white quiet zone so it scans.
function qrBlock(qrSvg, size, P, style = 'card', ctx = null) {
  if (!qrSvg) return null;
  const code = img(svgUri(qrSvg), { width: size, height: size });
  const pad = Math.round(size * 0.08) + 6;
  switch (style) {
    case 'square': return div({ width: size + pad * 2, height: size + pad * 2, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }, [code]);
    case 'frame': return div({ padding: pad - 2, backgroundColor: '#ffffff', border: `6px solid ${P.accent}`, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, [code]);
    case 'label': return div({ flexDirection: 'column', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 16, padding: `${pad}px ${pad}px ${Math.round(pad * 0.6)}px` }, [code,
      div({ marginTop: 6, fontFamily: ctx ? ctx.F.body : 'sans-serif', fontWeight: 700, fontSize: Math.max(16, Math.round(size * 0.1)), letterSpacing: '3px', color: '#111111' }, ['SCAN'])]);
    default: return div({ width: size + pad * 2, height: size + pad * 2, backgroundColor: '#ffffff', borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, [code]);
  }
}

// 2026-11-02: a button, tag or line in the same colour as the card behind it
// vanishes (pink button on a pink card). These pick a colour that reads on the
// ground actually drawn (ctx.groundBg), else a plain ink/paper one.
function readsOn(c, g, min) { return !g || !c || contrast(c, g) >= min; }
function fillOn(ctx, order) {
  const { P } = ctx, g = ctx.groundBg;
  const bg = order.find((c) => readsOn(c, g, 2.2)) || (g && isDark(g) ? (P.paper0 || '#ffffff') : (P.ink0 || '#111111'));
  const fg = contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111';
  return { bg, fg };
}
function accOn(ctx, fallback) {
  const { P } = ctx, g = ctx.groundBg;
  if (!g) return P.accentOnGround;
  return [P.accent, P.second].find((c) => contrast(c, g) >= 2.4) || fallback || (isDark(g) ? '#ffffff' : '#111111');
}

function labelEl(text, ctx, onColor) {
  if (!text) return null;
  const { S, F, P } = ctx;
  const t = String(text).slice(0, 48);
  const base = { fontFamily: F.body, fontWeight: 700, fontSize: 24, letterSpacing: '3px', textTransform: 'uppercase', color: onColor || accOn(ctx) };
  switch (S.labelStyle) {
    case 'tag': { const f = fillOn(ctx, [P.accent, P.second]); return div({ ...base, color: f.fg, backgroundColor: f.bg, padding: '8px 16px', borderRadius: Math.min(S.corner, 8), alignSelf: 'flex-start' }, [t]); }
    case 'chip': { const f = fillOn(ctx, [P.second, P.accent]); return div({ ...base, letterSpacing: '1px', textTransform: 'none', color: f.fg, backgroundColor: f.bg, padding: '10px 22px', borderRadius: 999, alignSelf: 'flex-start' }, [t]); }
    case 'outline': return div({ ...base, color: onColor || P.ink, border: `2px solid ${accOn(ctx, onColor)}`, padding: '6px 14px', alignSelf: 'flex-start' }, [t]);
    case 'mono': return div({ ...base, fontFamily: F.mono, letterSpacing: '2px', fontWeight: 600 }, ['// ' + t]);
    case 'glass': return div({ ...base, color: onColor || P.ink, backgroundColor: rgba(P.paper0, 0.16), border: `1px solid ${rgba(P.paper0, 0.35)}`, padding: '10px 20px', borderRadius: 999, alignSelf: 'flex-start', letterSpacing: '2px' }, [t]);
    case 'spaced': return div({ ...base, fontWeight: 400, letterSpacing: '9px', fontSize: 22 }, [t]);
    case 'hand': return div({ ...base, fontFamily: F.hand, textTransform: 'none', letterSpacing: '0px', fontSize: 40, fontWeight: 700 }, [t]);
    case 'smallcaps': return div({ ...base, fontWeight: 600, letterSpacing: '5px', fontSize: 21 }, [t]);
    default: return div(base, [t]);
  }
}

function ctaEl(text, ctx, onColor, align = 'flex-start') {
  if (!text) return null;
  const { S, F, P } = ctx;
  const t = String(text).slice(0, 26);
  const base = { fontFamily: F.body, fontWeight: 700, fontSize: 32, alignSelf: align };
  switch (S.cta) {
    case 'pill': {
      // 2026-10-12: a button the same colour as the card vanishes (SpinQuest's
      // purple on purple). Fall back to the second colour, else the text colour.
      const pf = fillOn(ctx, [P.accent, P.second]);
      const bg = pf.bg, fg = pf.fg;
      return div({ ...base, backgroundColor: bg, color: fg, padding: '20px 36px', borderRadius: Math.max(S.corner, 999 * (S.corner > 12 ? 1 : 0)) || 10 }, [t]);
    }
    case 'outline': return div({ ...base, color: onColor || P.ink, border: `3px solid ${accOn(ctx, onColor)}`, padding: '16px 30px', textTransform: 'uppercase', letterSpacing: '3px', fontSize: 28 }, [t]);
    case 'bracket': return div({ ...base, fontFamily: F.mono, color: accOn(ctx, onColor), fontSize: 30 }, [`[ ${t} ]`]);
    case 'arrow': return div({ ...base, color: onColor || P.ink, fontSize: 34, borderBottom: `6px solid ${accOn(ctx, onColor)}`, paddingBottom: 6 }, [`${t}  »`]);
    default: return div({ ...base, color: onColor || P.ink, borderBottom: `2px solid ${accOn(ctx, onColor)}`, paddingBottom: 6, fontWeight: 600 }, [t]);
  }
}

function logoEl(ctx, mode, onDark) {
  const { A, P, D, W, H, r } = ctx;
  if (!A.logo) return brandWordmark(ctx, onDark);
  // D.logo.any: a colourful logo that reads on any ground is drawn as it is.
  const needsBadge = D.logo && D.logo.any === true ? false : D.logo && typeof D.logo.onDark === 'boolean' ? (onDark ? !D.logo.onDark : D.logo.onDark) : onDark;
  const h = mode === 'big' ? 120 : 64;
  const im = img(A.logo, { height: h, maxWidth: mode === 'big' ? 520 : 300, objectFit: 'contain' });
  // Abstract logo marks: a one-colour silhouette of the brand's own logo,
  // never a redraw -- the file is used as-is, only tinted by a filter.
  const silhouette = onDark ? 'brightness(0) invert(1)' : 'brightness(0)';
  if (mode === 'watermark') {
    // Uses the white silhouette the brand kit made from the logo when it was
    // saved (a live tint filter cost the rasterizer over a second), drawn
    // with fast scaling -- it is a soft emboss at 10% opacity anyway.
    if (!A.logoWhite) return null;
    const z = W * r.pick([0.85, 1.0, 1.2]);
    const corner = r.pick([[-0.22, -0.08], [-0.3, 0.45], [0.5, -0.1]]);
    const left = W - W * corner[0] - z, top = H - H * corner[1] - z;
    const wm = `<svg data-inline="1" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image x="${left}" y="${top}" width="${z}" height="${z}" href="${A.logoWhite}" preserveAspectRatio="xMidYMid meet" image-rendering="optimizeSpeed" transform="rotate(${r.pick([-14, -6, 9, 18])} ${left + z / 2} ${top + z / 2})"/></svg>`;
    return img(svgUri(wm), { position: 'absolute', left: 0, top: 0, width: W, height: H, opacity: 0.1 });
  }
  if (mode === 'tile') {
    // One copy of the logo, repeated by reference: embedding it per cell
    // made a multi-megabyte card. The silhouette tint is a colour matrix.
    const step = r.pick([170, 210, 250]);
    const z = step * 0.62;
    const v = onDark ? 1 : 0;
    let uses = '';
    for (let y = -40; y < H + step; y += step) for (let x = ((y / step) % 2 ? -step / 2 : 0); x < W + step; x += step) {
      uses += `<use href="#lg" x="${x}" y="${y}" transform="rotate(${r.pick([-18, 0, 12])} ${x + z / 2} ${y + z / 2})"/>`;
    }
    // data-inline: a picture inside a picture is not drawn by the
    // rasterizer, so optimizeSvg lifts this one into the card itself.
    const tile = `<svg data-inline="1" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="sil" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feColorMatrix type="matrix" values="0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 1 0"/></filter><image id="lg" width="${z}" height="${z}" href="${A.logo}" preserveAspectRatio="xMidYMid meet"/></defs><g filter="url(#sil)">${uses}</g></svg>`;
    return img(svgUri(tile), { position: 'absolute', left: 0, top: 0, width: W, height: H, opacity: onDark ? 0.07 : 0.06 });
  }
  // 2026-10-11 (v12): Brad: "brands logos in little white outlined circles..
  // repetitive, too small, and ugly." No more small white pill. The logo is
  // drawn bigger (size varies per card) and as-is when it reads on the
  // ground; when it wouldn't (dark logo on a dark card, light on light) it
  // becomes a one-colour silhouette of the brand's own file; only with no
  // silhouette possible does it sit on a plain panel, never a circle.
  const lh = mode === 'big' ? (ctx.logoScale === 'bigger' ? 160 : ctx.logoScale === 'smaller' ? 110 : 140) : (ctx.logoH || 92);
  const sized = (src) => img(src, { height: lh, maxWidth: Math.round(lh * 4.2), objectFit: 'contain' });
  if (!needsBadge) return div({ alignItems: 'center' }, [sized(A.logo)]);
  if (onDark && A.logoWhite) return div({ alignItems: 'center' }, [sized(A.logoWhite)]);
  // One-colour silhouette (white on dark cards, near-black on light ones):
  // one colour-matrix pass over the brand's own file, lifted into the card
  // like the tile. The logo's shape is untouched; only its colour changes.
  const w = Math.round(lh * 4.2);
  const v = onDark ? 1 : 0.07;
  const sil = `<svg data-inline="1" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${lh}" viewBox="0 0 ${w} ${lh}"><defs><filter id="lsil" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${lh}"><feColorMatrix type="matrix" values="0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 0 ${v} 0 0 0 1 0"/></filter></defs><image width="${w}" height="${lh}" href="${A.logo}" preserveAspectRatio="xMinYMid meet" filter="url(#lsil)"/></svg>`;
  return div({ alignItems: 'center' }, [img(svgUri(sil), { width: w, height: lh })]);
}
function brandWordmark(ctx, onDark) {
  const { F, D, P } = ctx;
  return div({ fontFamily: F.display, fontWeight: ctx.weights.display, fontSize: 34, color: onDark ? P.paper0 : P.ink0, letterSpacing: '1px' }, [String(D.name || '').slice(0, 30)]);
}

function mascotEl(ctx, mode, box) {
  const { A, W, H, r } = ctx;
  if (!A.mascot) return null;
  const flip = r.chance(0.4) ? ' scaleX(-1)' : '';
  switch (mode) {
    case 'peek': return div({ position: 'absolute', right: -W * 0.16, bottom: H * 0.18, width: W * 0.62, height: W * 0.62, transform: `rotate(${r.pick([-14, -8, 10])}deg)${flip}` }, [img(A.mascot, { width: W * 0.62, height: W * 0.62, objectFit: 'contain' })]);
    case 'sticker': return div({ position: 'absolute', right: box?.right ?? 40, top: box?.top ?? Math.round(H * 0.42), width: 250, height: 250, transform: `rotate(${r.pick([-10, 8, 12])}deg)${flip}`, filter: 'drop-shadow(0 0 0 #fff) drop-shadow(6px 6px 0 rgba(0,0,0,0.25))' }, [img(A.mascot, { width: 250, height: 250, objectFit: 'contain' })]);
    case 'hero': return div({ position: 'absolute', right: -40, bottom: -30, width: W * 0.78, height: H * 0.62, transform: flip ? 'scaleX(-1)' : undefined }, [img(A.mascot, { width: W * 0.78, height: H * 0.62, objectFit: 'contain', objectPosition: 'bottom' })]);
    default: return div({ position: 'absolute', right: 40, bottom: 40, width: 220, height: 220 }, [img(A.mascot, { width: 220, height: 220, objectFit: 'contain' })]);
  }
}

// Ground layer for a preset, drawn edge to edge.
function groundEl(ctx, override) {
  const { S, P, W, H, r } = ctx;
  const g = override || S.ground;
  const layers = [];
  let bg = P.ground;
  let meshSvg = '';
  if (g === 'paper') bg = P.dark ? P.paper0 : P.ground;
  if (g === 'block') bg = r.pick([P.accent, P.ground, P.second]);
  if (g === 'ink') bg = P.dark ? P.ground : P.ink0;
  if (g === 'mesh') {
    // Drawn as plain SVG radial gradients: CSS gradients become full-card
    // patterns in the rasterizer, which cost seconds per card.
    const x1 = r.range(0.1, 0.4) * W, y1 = r.range(0.05, 0.35) * H, x2 = r.range(0.6, 0.95) * W, y2 = r.range(0.6, 0.95) * H;
    meshSvg = `<defs><radialGradient id="m1" cx="${x1}" cy="${y1}" r="${W * 0.75}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${P.accent}"/><stop offset="1" stop-color="${P.accent}" stop-opacity="0"/></radialGradient><radialGradient id="m2" cx="${x2}" cy="${y2}" r="${W * 0.8}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${P.second}"/><stop offset="1" stop-color="${P.second}" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#m1)"/><rect width="${W}" height="${H}" fill="url(#m2)"/>`;
    bg = P.dark ? P.ground : mix(P.ink0, P.accent, 0.25);
  }
  if (g === 'bands') {
    const h1 = H * r.range(0.24, 0.34);
    layers.push(div({ position: 'absolute', left: 0, top: 0, width: W, height: h1, backgroundColor: P.accent }));
    layers.push(div({ position: 'absolute', left: 0, top: h1, width: W, height: 26, backgroundColor: P.second }));
    bg = P.dark ? P.paper0 : P.ground;
  }
  // The mesh is handed back as SVG markup so it can share one picture with
  // the ornament: each separate full-card picture costs a raster pass.
  ctx.groundBg = bg;
  return { bg, layers, svg: meshSvg };
}

// Which colours to write with on whatever ground was chosen.
function inksFor(bg, P) {
  const dark = isDark(bg);
  const text = dark ? best(bg, [P.paper0, '#ffffff']) : best(bg, [P.ink0, '#111111']);
  let accent = [P.accent, P.second].find((c) => contrast(c, bg) >= 2.4) || text;
  if (accent.toLowerCase() === bg.toLowerCase()) accent = text;
  return { dark, text, accent, muted: mix(text, bg, 0.35) };
}

// ── Archetypes ────────────────────────────────────────────────────────────
// Each returns { bgOverride?, children } for the content layer, laid out
// in absolute frames that never overlap (fitted text has a known height).

function A_statement(ctx) {
  const { W, H, C, F, M, S, r, measure } = ctx;
  const G = groundEl(ctx);
  const I = inksFor(G.bg, ctx.P);
  const center = r.chance(S.density === 'airy' ? 0.35 : 0.2);
  const top = r.chance(0.5);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const head = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW, maxH: H * 0.44, min: 44, max: S.displayCase === 'upper' ? 150 : 140, lh: S.displayCase === 'upper' ? 0.95 : 1.04, upper: S.displayCase === 'upper', tracking: S.displayCase === 'upper' ? 0.005 : -0.015 });
  const sub = C.sub ? fitText(measure, C.sub, { family: F.body, weight: ctx.weights.body, maxW: Math.min(maxW, 820), maxH: 160, min: 24, max: 38, lh: 1.32 }) : null;
  const block = div({ flexDirection: 'column', gap: 28, alignItems: center ? 'center' : 'flex-start', textAlign: center ? 'center' : 'left' }, [
    labelEl(C.label, ctx, I.text),
    textBlock(head, { fontFamily: F.display, fontWeight: ctx.weights.display, color: I.text, alignItems: center ? 'center' : 'flex-start' }),
    S.rule !== 'none' ? div({ width: center ? 120 : 160, height: S.rule === 'heavy' ? 10 : 2, backgroundColor: I.accent }) : null,
    sub ? textBlock(sub, { fontFamily: F.body, fontWeight: ctx.weights.body, color: I.muted, alignItems: center ? 'center' : 'flex-start' }) : null,
  ]);
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: top ? M + 110 : undefined, bottom: top ? undefined : M + 170, width: maxW, flexDirection: 'column', alignItems: center ? 'center' : 'flex-start' }, [block]),
    footer: true,
  };
}

function A_numeral(ctx) {
  const { W, H, C, F, M, S, measure } = ctx;
  const G = groundEl(ctx);
  const I = inksFor(G.bg, ctx.P);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const num = fitText(measure, C.number, { family: F.display, weight: ctx.weights.displayHeavy, maxW, maxH: H * 0.36, min: 120, max: 420, lh: 0.92, balance: false, tracking: -0.03 });
  const cap = fitText(measure, C.numberCaption || C.headline, { family: F.display, weight: ctx.weights.display, maxW, maxH: H * 0.22, min: 36, max: 76, lh: 1.08, upper: S.displayCase === 'upper' });
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: M + 120, width: maxW, flexDirection: 'column', gap: 18 }, [
      labelEl(C.label, ctx, I.text),
      textBlock(num, { fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, color: I.accent }),
      textBlock(cap, { fontFamily: F.display, fontWeight: ctx.weights.display, color: I.text }),
      C.sub ? textBlock(fitText(measure, C.sub, { family: F.body, weight: ctx.weights.body, maxW: Math.min(820, maxW), maxH: 120, min: 22, max: 34, lh: 1.3 }), { fontFamily: F.body, color: I.muted }) : null,
    ]),
    footer: true,
  };
}

function A_list(ctx) {
  const { W, H, C, F, M, S, measure, P } = ctx;
  const G = groundEl(ctx, S.ground === 'block' ? 'paper' : undefined);
  const I = inksFor(G.bg, P);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const items = (C.items || []).filter(Boolean).slice(0, 4);
  const head = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW, maxH: H * 0.22, min: 40, max: 92, lh: 1.04, upper: S.displayCase === 'upper' });
  const rowH = Math.min(150, (H * 0.5) / Math.max(1, items.length));
  const rows = items.map((t, i) => {
    const f = fitText(measure, t, { family: F.body, weight: 600, maxW: maxW - 130, maxH: rowH - 30, min: 24, max: 40, lh: 1.2 });
    return div({ flexDirection: 'row', alignItems: 'center', gap: 28, borderTop: S.rule === 'none' ? undefined : `${S.rule === 'heavy' ? 4 : 1.5}px solid ${rgba(I.text, 0.35)}`, paddingTop: 18, paddingBottom: 18, minHeight: rowH }, [
      div({ width: 92, height: 92, borderRadius: S.corner > 16 ? 999 : S.corner, backgroundColor: i % 2 ? P.second : P.accent, color: i % 2 ? P.onSecond : P.onAccent, fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, fontSize: 46, alignItems: 'center', justifyContent: 'center' }, [String(i + 1)]),
      textBlock(f, { fontFamily: F.body, fontWeight: 600, color: I.text, flex: 1 }),
    ]);
  });
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: M + 110, width: maxW, flexDirection: 'column', gap: 30 }, [
      labelEl(C.label, ctx, I.text),
      textBlock(head, { fontFamily: F.display, fontWeight: ctx.weights.display, color: I.text }),
      div({ flexDirection: 'column' }, rows),
    ]),
    footer: true,
  };
}

function A_quote(ctx) {
  const { W, H, C, F, M, measure, P, r } = ctx;
  const G = groundEl(ctx, r.pick(['ink', 'paper']));
  const I = inksFor(G.bg, P);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const q = fitText(measure, C.quote || C.headline, { family: F.display, weight: ctx.weights.displayLight, maxW, maxH: H * 0.48, min: 40, max: 96, lh: 1.14 });
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: M + 70, width: maxW, flexDirection: 'column', gap: 10 }, [
      div({ fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, fontSize: 300, lineHeight: '230px', color: I.accent, height: 210 }, ['“']),
      textBlock(q, { fontFamily: F.display, fontWeight: ctx.weights.displayLight, color: I.text }),
      C.quoteBy ? div({ marginTop: 26, fontFamily: F.body, fontWeight: 700, fontSize: 28, color: I.accent, letterSpacing: '2px', textTransform: 'uppercase' }, ['— ' + String(C.quoteBy).slice(0, 60)]) : null,
    ]),
    footer: true,
  };
}

function A_event(ctx) {
  const { W, H, C, F, M, S, measure, P, r } = ctx;
  const G = groundEl(ctx);
  const I = inksFor(G.bg, P);
  const ev = C.event || {};
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const stubBg = r.pick([P.accent, P.paper0, P.second]);
  const SI = inksFor(stubBg, P);
  const title = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW: maxW - 80, maxH: H * 0.26, min: 40, max: 104, lh: 1.02, upper: S.displayCase === 'upper' });
  const dots = [];
  for (let i = 0; i < 22; i++) dots.push(div({ width: 14, height: 14, borderRadius: 999, backgroundColor: G.bg }));
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: M + 100, width: maxW, flexDirection: 'column', gap: 0 }, [
      div({ flexDirection: 'row', backgroundColor: stubBg, borderRadius: Math.min(S.corner, 24), overflow: 'hidden' }, [
        div({ width: 250, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '34px 0', borderRight: `4px dashed ${rgba(SI.text, 0.35)}` }, [
          div({ fontFamily: F.body, fontWeight: 700, fontSize: 30, letterSpacing: '5px', color: SI.accent === stubBg ? SI.text : SI.accent }, [String(ev.month || '').toUpperCase().slice(0, 4)]),
          div({ fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, fontSize: 150, lineHeight: '150px', color: SI.text }, [String(ev.day || '').slice(0, 2)]),
          div({ fontFamily: F.body, fontWeight: 600, fontSize: 26, color: SI.muted, letterSpacing: '3px' }, [String(ev.weekday || '').toUpperCase().slice(0, 3)]),
        ]),
        div({ flex: 1, flexDirection: 'column', justifyContent: 'center', padding: '30px 34px', gap: 14 }, [
          ev.time ? div({ fontFamily: F.body, fontWeight: 700, fontSize: 30, color: SI.text }, [String(ev.time).slice(0, 24)]) : null,
          ev.place ? div({ fontFamily: F.body, fontWeight: 400, fontSize: 28, color: SI.muted }, [String(ev.place).slice(0, 44)]) : null,
        ]),
      ]),
      div({ marginTop: 56, flexDirection: 'column', gap: 26 }, [
        labelEl(C.label, ctx, I.text),
        textBlock(title, { fontFamily: F.display, fontWeight: ctx.weights.display, color: I.text }),
        C.sub ? textBlock(fitText(measure, C.sub, { family: F.body, weight: ctx.weights.body, maxW: Math.min(860, maxW), maxH: 120, min: 24, max: 34, lh: 1.3 }), { fontFamily: F.body, color: I.muted }) : null,
      ]),
    ]),
    footer: true,
  };
}

function A_photo(ctx) {
  const { W, H, C, F, M, S, measure, P, A, r } = ctx;
  // 2026-10-14: the shade behind the words is a deep version of the brand
  // colour, not the bright colour itself -- a bright red or pink washed the
  // whole picture out (SpiceBook test).
  const bg = mix(P.dark ? P.ground : P.ink0, '#000000', 0.55);
  const I = { dark: true, text: '#ffffff', accent: contrast(P.accent, '#111111') > 3 ? P.accent : P.second, muted: 'rgba(255,255,255,0.82)' };
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const head = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW, maxH: H * 0.3, min: 44, max: 128, lh: 1.0, upper: S.displayCase === 'upper' });
  const scrimFromTop = r.chance(0.25);
  return {
    G: { bg, layers: [
      img(A.photo, { position: 'absolute', left: 0, top: 0, width: W, height: H, objectFit: 'cover' }),
      div({ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundImage: scrimFromTop ? `linear-gradient(180deg, ${rgba(bg, 0.92)} 0%, ${rgba(bg, 0.5)} 40%, ${rgba(bg, 0)} 70%)` : `linear-gradient(0deg, ${rgba(bg, 0.95)} 0%, ${rgba(bg, 0.7)} 38%, ${rgba(bg, 0)} 68%)` }),
    ] },
    I, noOrnament: true,
    body: div({ position: 'absolute', left: M, top: scrimFromTop ? M + 110 : undefined, bottom: scrimFromTop ? undefined : M + 160, width: maxW, flexDirection: 'column', gap: 24 }, [
      labelEl(C.label, ctx, '#ffffff'),
      textBlock(head, { fontFamily: F.display, fontWeight: ctx.weights.display, color: '#ffffff', textShadow: '0 2px 4px rgba(0,0,0,0.45)' }),
      C.sub ? textBlock(fitText(measure, C.sub, { family: F.body, weight: ctx.weights.body, maxW: Math.min(860, maxW), maxH: 110, min: 24, max: 34, lh: 1.3 }), { fontFamily: F.body, color: 'rgba(255,255,255,0.88)' }) : null,
    ]),
    footer: true, footerOnDark: true,
  };
}

function A_split(ctx) {
  const { W, H, C, F, M, S, measure, P, A, r } = ctx;
  const G = groundEl(ctx, S.ground === 'mesh' ? 'ink' : undefined);
  const I = inksFor(G.bg, P);
  const ph = Math.round(H * r.range(0.46, 0.54));
  // A whole picture (a site's share graphic) always sits on top, with
  // nothing drawn over it: its own words and logo stay readable.
  const whole = ctx.photoFit === 'contain';
  const imgTop = whole ? true : r.chance(0.6);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const head = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW, maxH: (H - ph) * 0.48, min: 36, max: 96, lh: 1.03, upper: S.displayCase === 'upper' });
  const radius = S.corner;
  return {
    G: { bg: G.bg, layers: [
      div({ position: 'absolute', left: radius ? M / 2 : 0, top: imgTop ? (radius ? M / 2 : 0) : H - ph - (radius ? M / 2 : 0), width: radius ? W - M : W, height: ph, borderRadius: radius, overflow: 'hidden' }, [
        img(A.photo, { width: radius ? W - M : W, height: ph, objectFit: ctx.photoFit || 'cover' }),
      ]),
    ] },
    I, noOrnament: true,
    body: div({ position: 'absolute', left: M, top: imgTop ? ph + 54 : M + 90, width: maxW, flexDirection: 'column', gap: 20 }, [
      labelEl(C.label, ctx, I.text),
      textBlock(head, { fontFamily: F.display, fontWeight: ctx.weights.display, color: I.text }),
    ]),
    footer: true, compactFooter: true, logoTop: !imgTop, noLogoTop: whole || undefined,
  };
}

function A_typewall(ctx) {
  const { W, H, C, F, M, measure, P, r } = ctx;
  const G = groundEl(ctx, r.pick(['ink', 'block']));
  const I = inksFor(G.bg, P);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const words = String(C.headline || '').toUpperCase().replace(/[^\p{L}\p{N}'&!?$%.,\- ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 7);
  const lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length <= 11 || !cur) cur = (cur + ' ' + w).trim(); else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  const availH = H * 0.6;
  const rows = lines.slice(0, 5).map((l, i) => {
    let size = 300;
    while (size > 40 && measure(l, F.display, ctx.weights.displayHeavy, size, 0) > maxW) size -= 4;
    return { l, size: Math.min(size, availH / Math.max(1, lines.length) / 0.9), i };
  });
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: M + 100, width: maxW, flexDirection: 'column', gap: 0 }, [
      labelEl(C.label, ctx, I.text),
      div({ flexDirection: 'column', marginTop: 20 }, rows.map((x) => div({ fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, fontSize: x.size, lineHeight: `${x.size * 0.9}px`, color: x.i % 2 ? I.accent : I.text, whiteSpace: 'pre' }, [x.l]))),
    ]),
    footer: true,
  };
}

function A_mascot(ctx) {
  const { W, H, C, F, M, S, measure, P, r } = ctx;
  const G = groundEl(ctx);
  const I = inksFor(G.bg, P);
  const bubbleBg = P.paper0;
  const BI = inksFor(bubbleBg, P);
  const bw = W - 2 * M - 40;
  const head = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW: bw - 80, maxH: H * 0.24, min: 34, max: 84, lh: 1.05, upper: S.displayCase === 'upper' });
  return {
    G, I, mascotMode: 'hero',
    body: div({ position: 'absolute', left: M, top: M + 100, width: bw, flexDirection: 'column' }, [
      div({ backgroundColor: bubbleBg, borderRadius: Math.max(28, S.corner), padding: '36px 40px', flexDirection: 'column', gap: 16, boxShadow: '8px 10px 0 rgba(0,0,0,0.16)' }, [
        C.label ? div({ fontFamily: F.body, fontWeight: 700, fontSize: 22, letterSpacing: '3px', textTransform: 'uppercase', color: BI.accent }, [String(C.label).slice(0, 40)]) : null,
        textBlock(head, { fontFamily: F.display, fontWeight: ctx.weights.display, color: BI.text }),
      ]),
      // The tail is a drawn triangle: the rasterizer can't do CSS border triangles (it drew a square).
      img(svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="68" height="46" viewBox="0 0 68 46"><path d="M0 0 L68 0 L${r.pick([18, 34, 50])} 46 Z" fill="${bubbleBg}"/></svg>`), { marginLeft: r.pick([90, bw - 190]), width: 68, height: 46, marginTop: -1 }),
    ]),
    footer: true, footerLeftOnly: true,
  };
}

function A_mark(ctx) {
  const { W, H, A, P, r, D, F } = ctx;
  const G = groundEl(ctx, r.pick(['ink', 'block', 'paper']));
  const I = inksFor(G.bg, P);
  const dark = isDark(G.bg);
  const size = W * r.range(0.46, 0.58);
  // Concentric rings around the mark -- the brand's own logo, used as-is.
  let rings = '';
  for (let i = 1; i <= 7; i++) rings += `<circle cx="${W / 2}" cy="${H / 2}" r="${size * 0.55 + i * 46}" fill="none" stroke="${I.accent}" stroke-width="${i % 2 ? 2 : 1}" stroke-opacity="${0.5 - i * 0.05}"/>`;
  const ringsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rings}</svg>`;
  const initials = String(D.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  // The logo always sits on the background it was made for: a light disc,
  // or a dark one when the brand says its logo is for dark grounds.
  const discBg = D.logo && D.logo.onDark ? (dark ? 'rgba(0,0,0,0.25)' : P.ink) : (dark ? '#ffffff' : P.paper);
  // v12: no outlined disc -- the mark sits big on its own, on a soft panel
  // only when it needs its own background to read.
  // 2026-10-12: a colourful logo (D.logo.any) is drawn as it is -- a white
  // silhouette of a full-colour logo is a white blotch (SpinQuest).
  const needsGround = D.logo && D.logo.any === true ? false : D.logo && typeof D.logo.onDark === 'boolean' ? (dark ? !D.logo.onDark : D.logo.onDark) : dark;
  const content = A.logo
    ? (needsGround && dark && A.logoWhite
      ? img(A.logoWhite, { width: size * 1.05, height: size * 1.05, objectFit: 'contain' })
      : needsGround
        ? div({ backgroundColor: discBg, borderRadius: 28, width: size * 1.15, height: size * 1.15, alignItems: 'center', justifyContent: 'center' }, [img(A.logo, { width: size * 0.86, height: size * 0.86, objectFit: 'contain' })])
        : img(A.logo, { width: size * 1.05, height: size * 1.05, objectFit: 'contain' }))
    : div({ width: size, height: size, borderRadius: 999, border: `6px solid ${I.accent}`, alignItems: 'center', justifyContent: 'center', fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, fontSize: size * 0.42, color: I.text }, [initials || '•']);
  return {
    G: { bg: G.bg, layers: [...(G.layers || []), img(svgUri(ringsSvg), { position: 'absolute', left: 0, top: 0, width: W, height: H })] },
    I, wordless: true, noOrnament: true, forceLogoMode: A.logoWhite && dark && r.chance(0.5) ? 'watermark' : null,
    body: div({ position: 'absolute', left: 0, top: 0, width: W, height: H, alignItems: 'center', justifyContent: 'center' }, [content]),
    footer: false,
  };
}

function A_photoonly(ctx) {
  const { W, H, A } = ctx;
  return {
    G: { bg: '#111111', layers: [img(A.photo, { position: 'absolute', left: 0, top: 0, width: W, height: H, objectFit: 'cover' })] },
    I: { dark: true, text: '#ffffff', accent: '#ffffff', muted: '#ffffff' },
    noOrnament: true, wordless: true,
    body: null, footer: false, logoCorner: true,
  };
}

function A_index(ctx) {
  const { W, H, C, F, M, S, measure, P } = ctx;
  const G = groundEl(ctx, S.ground === 'block' ? 'paper' : undefined);
  const I = inksFor(G.bg, P);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const pairs = (C.items || []).slice(0, 5).map((t, i) => {
    const m = String(t).match(/^([^:]{2,18}):\s*(.+)$/) || String(t).match(/^(.{2,18}?)\s+[–—]\s+(.+)$/);
    return m ? [m[1].trim(), m[2].trim()] : [String(i + 1).padStart(2, '0'), String(t)];
  });
  const head = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW, maxH: H * 0.24, min: 40, max: 96, lh: 1.04, upper: S.displayCase === 'upper' });
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: M + 110, width: maxW, flexDirection: 'column', gap: 34 }, [
      labelEl(C.label, ctx, I.text),
      textBlock(head, { fontFamily: F.display, fontWeight: ctx.weights.display, color: I.text }),
      div({ flexDirection: 'column', borderTop: `3px solid ${I.text}` }, pairs.map(([k, v]) => div({ flexDirection: 'row', borderBottom: `1.5px solid ${rgba(I.text, 0.3)}`, padding: '20px 0', gap: 24 }, [
        div({ width: 230, fontFamily: F.mono || F.body, fontWeight: 600, fontSize: 24, letterSpacing: '2px', textTransform: 'uppercase', color: I.accent }, [k.slice(0, 16)]),
        textBlock(fitText(measure, v, { family: F.body, weight: 500, maxW: maxW - 254, maxH: 96, min: 22, max: 34, lh: 1.25 }), { fontFamily: F.body, fontWeight: 500, color: I.text, flex: 1 }),
      ]))),
    ]),
    footer: true,
  };
}

function A_sticker(ctx) {
  const { W, H, C, F, M, S, measure, P, r } = ctx;
  const G = groundEl(ctx, r.pick(['block', 'bands', 'paper']));
  const I = inksFor(G.bg, P);
  const words = String(C.headline || '').split(/\s+/).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length <= 14 || !cur) cur = (cur + ' ' + w).trim(); else { chunks.push(cur); cur = w; } }
  if (cur) chunks.push(cur);
  const cols = [P.paper0, P.accent, P.second, '#ffffff'];
  const stickers = chunks.slice(0, 4).map((t, i) => {
    const bg = cols[(i + (r.chance(0.5) ? 1 : 0)) % cols.length] === G.bg ? '#ffffff' : cols[(i + 1) % cols.length];
    const si = inksFor(bg, P);
    let size = 120;
    while (size > 34 && measure(S.displayCase === 'upper' ? t.toUpperCase() : t, F.display, ctx.weights.displayHeavy, size, 0) > W - 2 * M - 80) size -= 4;
    return div({ backgroundColor: bg, color: si.text, fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, fontSize: size, lineHeight: `${size * 1.05}px`, padding: '10px 30px', borderRadius: Math.max(14, S.corner), alignSelf: i % 2 ? 'flex-end' : 'flex-start', transform: `rotate(${r.pick([-4, -2.5, 2, 3.5])}deg)`, boxShadow: '6px 8px 0 rgba(0,0,0,0.22)', textTransform: S.displayCase === 'upper' ? 'uppercase' : 'none', whiteSpace: 'pre' }, [t]);
  });
  return {
    G, I,
    body: div({ position: 'absolute', left: M, top: M + 150, width: W - 2 * M, flexDirection: 'column', gap: 30 }, stickers),
    footer: true,
  };
}

function A_cover(ctx) {
  const { W, H, C, F, M, S, measure, P, D } = ctx;
  const G = groundEl(ctx, 'paper');
  const I = inksFor(G.bg, P);
  const maxW = W - 2 * M - (ctx.reserve || 0);
  const mast = fitText(measure, String(D.name || ''), { family: F.display, weight: ctx.weights.displayHeavy, maxW, maxH: 220, min: 60, max: 230, lh: 0.95, balance: false, maxLines: 1, upper: S.displayCase === 'upper', tracking: -0.02 });
  const head = fitText(measure, C.headline, { family: F.display, weight: ctx.weights.display, maxW: maxW * 0.86, maxH: H * 0.3, min: 40, max: 100, lh: 1.04 });
  return {
    G, I, noOrnament: false,
    body: div({ position: 'absolute', left: M, top: M - 10, width: maxW, height: H - 2 * M, flexDirection: 'column', justifyContent: 'space-between' }, [
      // 2026-10-12: a brand with a logo gets its real logo as the masthead,
      // never its name typed out (a typed name reads as a made-up logo). The
      // label sits below it with its own gap (it overlapped the name's descenders).
      div({ flexDirection: 'column', gap: 14, borderBottom: `${S.rule === 'heavy' ? 8 : 3}px solid ${I.text}`, paddingBottom: 14 }, [
        ctx.A.logo && !ctx.hideLogo ? div({ flexDirection: 'row' }, [logoEl(ctx, 'big', isDark(G.bg))]) : textBlock(mast, { fontFamily: F.display, fontWeight: ctx.weights.displayHeavy, color: I.text }),
        div({ flexDirection: 'row', justifyContent: 'space-between', fontFamily: F.body, fontWeight: 600, fontSize: 22, letterSpacing: '3px', color: I.muted, textTransform: 'uppercase' }, [String(C.label || ctx.D.tagline || '').slice(0, 40), String(C.issue || '').slice(0, 24)]),
      ]),
      div({ flexDirection: 'column', gap: 20, marginBottom: 150 }, [
        div({ width: 80, height: 80, borderRadius: 999, backgroundColor: I.accent }),
        textBlock(head, { fontFamily: F.display, fontWeight: ctx.weights.display, color: I.text }),
      ]),
    ]),
    footer: true, noLogoTop: true,
  };
}

const BUILDERS = { statement: A_statement, numeral: A_numeral, list: A_list, quote: A_quote, event: A_event, photo: A_photo, split: A_split, typewall: A_typewall, mascot: A_mascot, mark: A_mark, photoonly: A_photoonly, index: A_index, sticker: A_sticker, cover: A_cover };

// Which archetypes this content can honestly fill.
export function possibleKinds(C, A, opts = {}) {
  const k = new Set();
  const words = opts.words || 'full';
  if (words !== 'none') {
    if (C.headline) { k.add('statement'); k.add('cover'); }
    if (C.headline && C.headline.split(/\s+/).length <= 7) k.add('typewall');
    if (C.headline && C.headline.split(/\s+/).length <= 9) k.add('sticker');
    if (C.number) k.add('numeral');
    if ((C.items || []).filter(Boolean).length >= 2) { k.add('list'); k.add('index'); }
    if (C.quote) { k.clear(); k.add('quote'); return k; }
    if (C.event && C.event.day && C.event.month) k.add('event');
    if (A.photo && C.headline) { k.add('photo'); k.add('split'); }
    if (A.mascot && C.headline) k.add('mascot');
  }
  if (words !== 'full') { if (A.photo) k.add('photoonly'); k.add('mark'); }
  return k;
}

export function chooseKind(C, A, S, r, opts = {}) {
  if (opts.kind && BUILDERS[opts.kind] && possibleKinds(C, A, opts).has(opts.kind)) return opts.kind;
  const can = possibleKinds(C, A, opts);
  if (!can.size) return A.photo ? 'photoonly' : 'mark';
  const avoid = new Set(opts.avoid || []);
  // A dated event is always a ticket and a quote is always a quote: the
  // date or the words are the point of the post, so variety never drops them.
  if (can.has('event')) return 'event';
  if (can.has('quote')) return 'quote';
  // A picture drawn for this post (the brand's character in a scene, or in a
  // new pose) is the star of the card.
  if (opts.preferPhoto && A.photo) {
    if (opts.words === 'none') return 'photoonly';
    return r.pick(['photo', 'photo', 'split']);
  }
  // A pose drawn for this post always gets the character's own card.
  if (opts.preferMascot && A.mascot && can.has('mascot')) return 'mascot';
  if (can.has('numeral') && (!avoid.has('numeral') || r.chance(0.5)) && r.chance(0.8)) return 'numeral';
  // A list of points needs a card that shows the points.
  const listy = ['list', 'index'].filter((k) => can.has(k) && !avoid.has(k));
  if (listy.length && (C.items || []).filter(Boolean).length >= 3) {
    const lean = listy.filter((k) => S.lean.includes(k));
    return r.pick(lean.length ? lean : listy);
  }
  if (can.has('photo') && !avoid.has('photo') && r.chance(0.45)) return r.chance(0.6) ? 'photo' : 'split';
  // A preset only uses the archetypes it leans on, so a brand keeps a
  // recognisable family of compositions; anything else is a last resort.
  const weighted = [];
  for (const k of can) {
    if (avoid.has(k)) continue;
    const lean = S.lean.indexOf(k);
    if (lean === -1) continue;
    const w = (S.lean.length - lean) + 2;
    for (let i = 0; i < w; i++) weighted.push(k);
  }
  if (!weighted.length) for (const k of can) if (!avoid.has(k)) weighted.push(k);
  return weighted.length ? r.pick(weighted) : [...can][0];
}

// Card fonts carry Latin glyphs only: emoji and symbols that would draw as
// empty boxes are removed, and arrows become guillemets.
export function cleanText(t) {
  return String(t ?? '')
    .replace(ARROWS, '»')
    .replace(NOT_LATIN, '')
    .replace(/\s+/g, ' ').trim();
}
// Built from char codes so the source carries no escape sequences that a
// deploy pipeline could rewrite.
const ch = (n) => String.fromCharCode(n);
const ARROWS = new RegExp('[' + ch(0x2190) + '-' + ch(0x21FF) + ']', 'g');
const NOT_LATIN = new RegExp('[^' + ch(0x20) + '-' + ch(0x7E) + ch(0xA0) + '-' + ch(0x24F) + ch(0x2000) + '-' + ch(0x206F) + ch(0x20AC) + ch(0x2122) + ']', 'g');
function cleanContent(C) {
  const o = {};
  for (const [k, v] of Object.entries(C)) {
    if (typeof v === 'string') o[k] = cleanText(v);
    else if (Array.isArray(v)) o[k] = v.map((x) => cleanText(x)).filter(Boolean);
    else if (v && typeof v === 'object') { o[k] = {}; for (const [k2, v2] of Object.entries(v)) o[k][k2] = typeof v2 === 'string' ? cleanText(v2) : v2; }
    else o[k] = v;
  }
  return o;
}

// satori embeds every SVG picture (ornaments, grounds, QR codes) as a nested
// SVG image, and the rasterizer renders each of those as a separate full
// document -- about half a second apiece at card size. Inlining them as
// nested <svg> elements draws the same pixels in a fraction of the time.
function unb64(b) {
  if (typeof atob === 'function') { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
  return Buffer.from(b, 'base64').toString('utf8');
}
const attrOf = (a, n) => { const m = a.match(new RegExp('(?:^|\\s)' + n + '="([^"]*)"')); return m ? m[1] : null; };
// Then: drop clip-paths that only restate an image's own box (an SVG image
// is clipped to its box anyway), each of which costs a full offscreen layer.
export function optimizeSvg(svg) {
  const clips = new Map();
  for (const m of svg.matchAll(/<clipPath id="([^"]+)"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"\/><\/clipPath>/g)) clips.set(m[1], [m[2], m[3], m[4], m[5]].map(Number));
  // Masks that are one white rectangle over the whole canvas change nothing.
  const vw = Number((svg.match(/^<svg[^>]*\swidth="([\d.]+)"/) || [])[1] || 0), vh = Number((svg.match(/^<svg[^>]*\sheight="([\d.]+)"/) || [])[1] || 0);
  const noop = new Set();
  for (const m of svg.matchAll(/<mask id="([^"]+)"><rect x="0" y="0" width="([\d.]+)" height="([\d.]+)" fill="#fff"\/><\/mask>/g)) if (Number(m[2]) >= vw && Number(m[3]) >= vh) noop.add(m[1]);
  svg = svg.replace(/\smask="url\(#([^)]+)\)"/g, (m, id) => (noop.has(id) ? '' : m));
  const rectMasks = new Map();
  for (const m of svg.matchAll(/<mask id="([^"]+)"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" fill="#fff"(?: mask="url\(#([^)]+)\)")?\/><\/mask>/g)) {
    if (!m[6] || noop.has(m[6])) rectMasks.set(m[1], [m[2], m[3], m[4], m[5]].map(Number));
  }
  const out = svg.replace(/<image\b[^>]*\/>/g, (tag0) => {
    let tag = tag0;
    const mm = tag.match(/\smask="url\(#([^)]+)\)"/);
    if (mm && rectMasks.has(mm[1]) && !/\stransform="/.test(tag)) {
      const c = rectMasks.get(mm[1]);
      const box = ['x', 'y', 'width', 'height'].map((k) => Number(attrOf(tag, k) || 0));
      if (box.every((v, i) => Math.abs(v - c[i]) < 0.6)) tag = tag.replace(mm[0], '');
    }
    const cm = tag.match(/\sclip-path="url\(#([^)]+)\)"/);
    if (!cm || !clips.has(cm[1])) return tag;
    const c = clips.get(cm[1]);
    const box = ['x', 'y', 'width', 'height'].map((k) => Number(attrOf(tag, k) || 0));
    if (box.every((v, i) => Math.abs(v - c[i]) < 0.6)) return tag.replace(cm[0], '');
    return tag;
  });
  return inlineSvgImages(out, true);
}
export function inlineSvgImages(svg, markedOnly = false) {
  let n = 0;
  return svg.replace(/<image\b([^>]*?)\shref="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"([^>]*?)\/>/g, (m, pre, b64s, post) => {
    const a = pre + ' ' + post;
    let inner;
    try { inner = unb64(b64s); } catch { return m; }
    const open = inner.match(/<svg\b[^>]*>/);
    if (!open || /<script|<foreignObject/i.test(inner)) return m;
    const marked = /\sdata-inline="1"/.test(open[0]);
    if (markedOnly ? !marked : /<image\b/.test(inner)) return m;
    const id = `i${n++}_`;
    const body = inner.slice(open.index + open[0].length).replace(/<\/svg>\s*$/, '')
      .replace(/\bid="([^"]+)"/g, `id="${id}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${id}$1)`).replace(/href="#([^"]+)"/g, `href="#${id}$1"`);
    const vb = attrOf(open[0], 'viewBox') || `0 0 ${attrOf(open[0], 'width') || attrOf(a, 'width')} ${attrOf(open[0], 'height') || attrOf(a, 'height')}`;
    const g = ['transform', 'clip-path', 'mask', 'style', 'opacity'].map((k) => attrOf(a, k) != null ? `${k}="${attrOf(a, k)}"` : '').filter(Boolean).join(' ');
    const par = attrOf(a, 'preserveAspectRatio') || 'none';
    return `<g ${g}><svg x="${attrOf(a, 'x') || 0}" y="${attrOf(a, 'y') || 0}" width="${attrOf(a, 'width')}" height="${attrOf(a, 'height')}" viewBox="${vb}" preserveAspectRatio="${par}" overflow="hidden">${body}</svg></g>`;
  });
}

// ── The card ──────────────────────────────────────────────────────────────
// design: { name, preset, palette{ground,ink,paper,accent,second},
//           fonts{display,body,mono?,hand?,displayWeight?}, logo{onDark?},
//           style overrides (any PRESETS key), tagline }
// content: { label, headline, sub, items[], number, numberCaption, quote,
//            quoteBy, event{day,month,weekday,time,place}, cta, footer, slide }
// assets: { logo?, logoWhite?, mascot?, photo?, qrSvg? } -- data URIs, already fetched
//   (logoWhite: a white silhouette of the logo, made by the brand kit)
// opts: { width, height, seed, kind?, avoid?[], words: full|minimal|none,
//         logoMode?, mascotMode? }
export function requiredFonts(design) {
  const S = { ...PRESETS[design.preset] || PRESETS.editorial, ...(design.style || {}) };
  const display = (design.fonts && design.fonts.display) || S.fonts[0];
  const body = (design.fonts && design.fonts.body) || S.fonts[1];
  const mono = (design.fonts && design.fonts.mono) || 'IBM Plex Mono';
  const hand = (design.fonts && design.fonts.hand) || 'Caveat';
  const dw = design.fonts && design.fonts.displayWeight ? design.fonts.displayWeight : S.displayWeight;
  const list = [
    [display, nearestWeight(display, dw)], [display, nearestWeight(display, 900)], [display, nearestWeight(display, 400)],
    [body, nearestWeight(body, S.bodyWeight)], [body, nearestWeight(body, 600)], [body, nearestWeight(body, 700)], [body, nearestWeight(body, 500)],
    [mono, nearestWeight(mono, 600)], [hand, nearestWeight(hand, 700)],
  ];
  const seen = new Set();
  return list.filter(([f, w]) => { const k = f + w; if (seen.has(k)) return false; seen.add(k); return true; }).map(([family, weight]) => ({ family, weight }));
}

export function buildCard({ design, content, assets, opts = {} }, measure) {
  const W = opts.width || 1080, H = opts.height || 1350;
  const D = design || {};
  const S = { ...(PRESETS[D.preset] || PRESETS.editorial), ...(D.style || {}) };
  // 2026-10-13: an edit can swap the brand's main and second colour.
  const P = resolvePalette(opts.swapColors && D.palette ? { ...D.palette, accent: D.palette.second || D.palette.accent, second: D.palette.accent || D.palette.second } : (D.palette || {}));
  const display = (D.fonts && D.fonts.display) || S.fonts[0];
  const body = (D.fonts && D.fonts.body) || S.fonts[1];
  const F = { display, body, mono: (D.fonts && D.fonts.mono) || 'IBM Plex Mono', hand: (D.fonts && D.fonts.hand) || 'Caveat' };
  const dw = D.fonts && D.fonts.displayWeight ? D.fonts.displayWeight : S.displayWeight;
  const weights = {
    display: nearestWeight(display, dw), displayHeavy: nearestWeight(display, 900), displayLight: nearestWeight(display, 400),
    body: nearestWeight(body, S.bodyWeight),
  };
  const r = rng(opts.seed || 'x');
  // 2026-10-14: Brad: "it keeps using the same designs across brands for the
  // backgrounds and placements ... content needs to be unique per post,
  // unless the user builds their own template". The brand's preset used to
  // fix the backdrop (blueprint = a grid on every card). Now each post draws
  // its own backdrop, ornament, label, button and corners from its own seed
  // (a separate random stream, so the seed still redraws the same card) and
  // skips combinations the brand used recently. The brand stays recognisable
  // through its colours, typefaces and logo. A brand or campaign with its
  // own template keeps one look (opts.vary === false).
  let look = null;
  if (opts.vary !== false) {
    const rv = rng((opts.seed || 'x') + '|look');
    // 2026-11-05: Brad banned the abstract backdrops (grid, rings, waves, stripes, mesh, bands, glow,
    // blobs, halftone, sparkle, diagonal) -- never use them again. Only plain grounds remain.
    const GROUNDS = ['paper', 'block', 'ink'];
    const ORNS = ['frame', 'none', 'none', 'none'];
    // Label, button, corners and rules first: a fixed number of draws, so the
    // same seed always gives the same ones.
    const labelPick = rv.chance(0.55) ? rv.pick(['tag', 'chip', 'outline', 'plain', 'smallcaps', 'spaced', 'glass']) : null;
    const ctaPick = rv.chance(0.45) ? rv.pick(['pill', 'outline', 'underline', 'arrow']) : null;
    const cornerPick = rv.pick([0, 6, 14, 24, 36]);
    const rulePick = rv.chance(0.3) ? rv.pick(['none', 'hairline', 'heavy']) : null;
    let g = S.ground, o = S.ornament;
    const forced = typeof opts.look === 'string' && /^[a-z]+\|[a-z]+$/.test(opts.look) ? opts.look.split('|') : null;
    if (forced && GROUNDS.includes(forced[0]) && (ORNS.includes(forced[1]) || forced[1] === 'none')) { g = forced[0]; o = forced[1]; }
    else {
      const avoidL = new Set(opts.avoidLooks || []);
      const avoidG = new Set([...avoidL].slice(0, 2).map((x) => String(x).split('|')[0]));
      for (let t = 0; t < 16; t++) {
        g = rv.pick(GROUNDS); o = rv.pick(ORNS);
        if (!avoidL.has(g + '|' + o) && (t > 8 || !avoidG.has(g))) break;
      }
    }
    S.ground = g; S.ornament = o;
    if (labelPick) S.labelStyle = labelPick;
    if (ctaPick) S.cta = ctaPick;
    S.corner = cornerPick;
    if (rulePick) S.rule = rulePick;
    look = g + '|' + o;
  }
  if (['mesh', 'bands'].includes(S.ground)) S.ground = 'block';
  if (S.ornament && !['frame', 'none'].includes(S.ornament)) S.ornament = 'none';
  if (look) look = S.ground + '|' + S.ornament;
  const M = S.density === 'airy' ? 96 : S.density === 'tight' ? 64 : 80;
  const A = assets || {};
  const C = cleanContent(content || {});
  // photoFit 'contain': show the whole picture (a site's share graphic carries its own words and logo).
  const ctx = { W, H, D, S, P, F, M, r, A, C, measure, weights, photoFit: opts.photoFit === 'contain' ? 'contain' : 'cover', hideLogo: !!opts.hideLogo };
  const kind = chooseKind(C, A, S, r, opts);
  // The brand's character joins text cards in different poses, and the text
  // column is narrowed so it never sits under the character.
  const MASCOT_KINDS = ['statement', 'numeral', 'list', 'quote', 'event', 'index', 'cover'];
  const extraMascot = A.mascot && opts.words !== 'none' && MASCOT_KINDS.includes(kind)
    ? (opts.mascotMode !== undefined ? opts.mascotMode : r.pick(opts.preferMascot ? ['peek', 'sticker'] : ['peek', 'sticker', 'peek', null]))
    : null;
  ctx.reserve = extraMascot === 'peek' ? Math.round(W * 0.3) : extraMascot === 'sticker' ? Math.round(W * 0.22) : 0;
  const out = BUILDERS[kind](ctx);
  const G = out.G;
  ctx.groundBg = G.bg;
  const I = out.I;
  const onDark = isDark(G.bg);

  // Ornament (preset-driven, seeded placement), under the content.
  // Keep-out boxes for scattered ornaments: the words, the logo row, the footer.
  const keepOut = [[M - 10, M - 24, W - M + 10, M + 130], [M - 10, H - M - 330, W - M + 10, H]];
  { const bs = out.body && out.body.props ? out.body.props.style : null;
    if (bs && bs.position === 'absolute') {
      const bh = typeof bs.height === 'number' ? bs.height : estH(out.body, true);
      const bw = typeof bs.width === 'number' ? bs.width : W - 2 * M;
      const left = typeof bs.left === 'number' ? bs.left : M;
      const top = typeof bs.top === 'number' ? bs.top : (typeof bs.bottom === 'number' ? H - bs.bottom - bh : null);
      if (top != null) keepOut.push([left, top, left + bw, top + bh]);
    } }
  const orn = !out.noOrnament && S.ornament !== 'none' ? ornamentSvg(S.ornament === 'diagonal' && G.bg !== P.ground ? 'stripes' : S.ornament, W, H, onDark ? mix(I.text, G.bg, 0.2) : mix(I.text, G.bg, 0.15), r, P, keepOut) : null;

  // Logo treatment varies per card.
  // Silhouette marks read as an emboss on dark grounds and as a smudge on
  // light ones, so light cards keep the logo itself. ('tile' still exists
  // for an explicit opts.logoMode, but repeating a raster logo thirty times
  // costs seconds, so it is never picked at random.)
  const logoMode = opts.logoMode || out.forceLogoMode || (out.logoCorner ? 'badge' : r.pick(onDark && A.logoWhite ? ['corner', 'corner', 'badge', 'watermark'] : ['corner', 'corner', 'badge']));
  const mascotMode = out.mascotMode || extraMascot;

  // v12: logo size, side and presence vary per card; QR size, frame and side too.
  // A redo note can ask for a bigger or smaller logo (bigger = the largest
  // size that still clears the words).
  ctx.logoScale = opts.logoScale;
  ctx.logoH = r.pick(opts.logoScale === 'bigger' ? [116, 120] : opts.logoScale === 'smaller' ? [60, 68] : [80, 92, 106, 120]);
  // An edit can place the logo; the random pick still runs so the rest of the card stays the same.
  const SIDE = { left: 'flex-start', right: 'flex-end', center: 'center' };
  const logoSide = logoMode === 'watermark' ? 'flex-start' : ((pick) => SIDE[opts.logoSide] || pick)(r.pick(['flex-start', 'flex-start', 'flex-end', 'center']));
  // A redo that asked about the logo always shows it.
  const hideTop = !out.noLogoTop && logoMode !== 'watermark' && !!C.footer && r.chance(0.15) && !opts.showLogo;
  const top = out.noLogoTop || hideTop || opts.hideLogo ? null : div({ position: 'absolute', left: ctx.M, top: ctx.M - 14, right: ctx.M, flexDirection: 'row', justifyContent: logoSide, alignItems: 'center' }, [
    logoMode === 'watermark' || logoMode === 'tile' ? logoEl(ctx, 'corner', onDark) : logoEl(ctx, logoMode, onDark),
  ]);
  let qrSize = r.pick([150, 170, 190, 215, 240]);
  let qrStyle = r.pick(['card', 'square', 'frame', 'label']);
  const qrLeft = ((pick) => (opts.qrSide === 'left' ? true : opts.qrSide === 'right' ? false : pick))(r.chance(0.4));
  const showQr = !!A.qrSvg && opts.words !== 'none' && !out.wordless;
  const makeFooterLeft = () => div({ flexDirection: 'column', gap: 14, maxWidth: W - 2 * M - (showQr ? qrSize + Math.round(qrSize * 0.16) + 12 + 48 : 0), alignItems: showQr && qrLeft && !out.footerLeftOnly ? 'flex-end' : 'flex-start' }, [
    ctaEl(C.cta, ctx, I.text, showQr && qrLeft && !out.footerLeftOnly ? 'flex-end' : 'flex-start'),
    C.footer ? div({ fontFamily: F.body, fontWeight: 600, fontSize: 24, color: out.footerOnDark ? 'rgba(255,255,255,0.85)' : I.muted }, [String(C.footer).slice(0, 48)]) : null,
  ]);
  // v13: the footer never sits on the words. A card with a sub-line put the
  // QR straight over it (statement cards only kept 170px clear, the biggest
  // QR is ~300px). Bottom-anchored words move up; top-anchored words keep
  // their place and the QR steps down a size until it fits.
  const bst = out.body && out.body.props ? out.body.props.style : null;
  if (out.footer && bst && bst.position === 'absolute') {
    const GAP = 28, footBottom = M - 10;
    const bh = estH(out.body, true);
    const leftH = estH(makeFooterLeft());
    const qrH = () => (showQr && !out.footerLeftOnly ? qrOuter(qrSize, qrStyle) : 0);
    const SZ = [240, 215, 190, 170, 150, 130, 116];
    if (typeof bst.height === 'number' && typeof bst.top === 'number') {
      // Full-height layouts (cover): lift the bottom group with its margin.
      const raw = out.body.props.children;
      const kids = (Array.isArray(raw) ? raw : [raw]).filter((c) => c && typeof c === 'object');
      const last = kids[kids.length - 1];
      const ls = last && last.props ? last.props.style : null;
      if (ls) {
        const edge = H - (bst.top + bst.height);
        const free = bst.height - kids.reduce((a, c) => a + estH(c), 0);
        const need = () => footBottom + Math.max(leftH, qrH()) + GAP - edge;
        const cur = pxv(ls.marginBottom);
        while (showQr && !out.footerLeftOnly && need() - cur > free && qrSize > 116) qrSize = SZ.find((x) => x < qrSize) || 116;
        if (showQr && !out.footerLeftOnly && need() - cur > free) qrStyle = 'square';
        if (need() > cur) ls.marginBottom = Math.min(need(), cur + Math.max(0, free));
      }
    } else if (typeof bst.bottom === 'number' && bst.top === undefined) {
      const need = () => footBottom + Math.max(leftH, qrH()) + GAP;
      const SIZES = [240, 215, 190, 170, 150, 130, 116];
      // Move the words up, but not into the logo row; shrink the QR if needed.
      while (H - need() - bh < M + 100 && qrSize > 116) qrSize = SIZES.find((x) => x < qrSize) || 116;
      if (bst.bottom < need()) bst.bottom = need();
    } else if (typeof bst.top === 'number') {
      const room = () => H - footBottom - GAP - (bst.top + bh);
      const SIZES = [240, 215, 190, 170, 150, 130, 116];
      while (showQr && !out.footerLeftOnly && qrH() > room() && qrSize > 116) qrSize = SIZES.find((x) => x < qrSize) || 116;
      if (showQr && !out.footerLeftOnly && qrH() > room()) qrStyle = 'square';
    }
  }
  const footerLeft = makeFooterLeft();
  const footer = out.footer ? div({ position: 'absolute', left: M, right: M, bottom: M - 10, flexDirection: showQr && qrLeft && !out.footerLeftOnly ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, [
    footerLeft,
    showQr && !out.footerLeftOnly ? qrBlock(A.qrSvg, qrSize, P, qrStyle, ctx) : null,
  ]) : null;
  const wordlessLogo = out.logoCorner && !opts.hideLogo ? div({ position: 'absolute', left: M, bottom: M, flexDirection: 'row' }, [logoEl(ctx, 'badge', true)]) : null;

  // No overflow:hidden on the card itself: the canvas already clips, and
  // satori turns it into a mask on every element, which doubles raster time.
  const tree = div({ width: W, height: H, position: 'relative', backgroundColor: G.bg, fontFamily: F.body }, [
    ...(G.layers || []),
    (orn || G.svg) ? img(svgUri(orn ? (G.svg ? orn.replace(/(<svg\b[^>]*>)/, `$1${G.svg}`) : orn) : `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${G.svg}</svg>`), { position: 'absolute', left: 0, top: 0, width: W, height: H }) : null,
    (logoMode === 'watermark' || logoMode === 'tile') && A.logo && !opts.hideLogo && (!out.wordless || out.forceLogoMode) ? logoEl(ctx, logoMode, onDark) : null,
    mascotMode ? mascotEl(ctx, mascotMode) : null,
    out.body,
    out.wordless ? null : top,
    footer,
    wordlessLogo,
  ]);
  return { tree, kind, look, fonts: requiredFonts(D), logoMode, mascotMode, preset: D.preset || 'editorial', parts: { body: out.body, footer, qrSize, qrStyle } };
}

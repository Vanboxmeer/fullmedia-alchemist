// Hashtag picking (2026-10-13).
// Brad: "the hashtags it chooses for each post are very important ... it
// should be choosing hashtags that have some traffic/trending that are
// rankable.. not the hardest to get, and not ones that have no one looking."
//
// The writer proposes 8-12 candidates per post, each with a size tier
// (its estimate) and where it fits. Code then decides:
//   - never the giant catch-all tags (#love, #fyp, #viral, #explore, ...):
//     millions of posts an hour, nobody ranks there;
//   - never tags the writer glued together that nobody uses
//     (#ReadingSpeedVisuals), unless it is the brand's own or required;
//   - real interest where it can be measured for free: a tag about a named
//     topic (a book, an event, a place, a team) is checked against
//     Wikipedia's daily page views for that topic -- rising interest is
//     "trending", almost no views is "no one looking";
//   - the brand's own results: tags on its posts that did better than its
//     usual are preferred, ones that did worse are dropped;
//   - the mix: mostly mid-size tags (busy but rankable) and active niche
//     tags, at most one large tag, at most one brand tag.
// Lookups are cached in cc_hashtag_stats for 3 days. Read-only otherwise.

export type TagCand = { tag: string; tier?: string; platform?: string; topic?: string | null };
export type TagNote = { tier: string; trend?: 'rising' | 'steady' | 'quiet'; views?: number; brandScore?: 'better' | 'worse' };

// Catch-all tags with so many posts that a new post vanishes in seconds,
// plus engagement-bait tags. Lower-case, no '#'.
export const MEGA = new Set([
  'love', 'instagood', 'photooftheday', 'fashion', 'beautiful', 'happy', 'cute', 'tbt', 'like4like', 'likeforlike', 'followme', 'follow',
  'follow4follow', 'followforfollow', 'picoftheday', 'selfie', 'summer', 'art', 'instadaily', 'friends', 'repost', 'nature', 'girl', 'fun',
  'style', 'smile', 'food', 'instalike', 'family', 'travel', 'fitness', 'igers', 'tagsforlikes', 'nofilter', 'life', 'beauty', 'amazing',
  'instagram', 'photography', 'photo', 'music', 'beach', 'sunset', 'motivation', 'instamood', 'fyp', 'foryou', 'foryoupage', 'fy', 'fypシ',
  'viral', 'viralvideo', 'viralpost', 'trending', 'trend', 'explore', 'explorepage', 'reels', 'reelsinstagram', 'reel', 'tiktok', 'tiktokviral',
  'xyzbca', 'blessed', 'goals', 'inspiration', 'love❤️', 'instacool', 'bestoftheday', 'happiness', 'memes', 'funny', 'comedy', 'model',
  'business', 'marketing', 'socialmedia', 'entrepreneur', 'success', 'new', 'news', 'post', 'video', 'videos', 'share', 'sharing', 'today',
]);
// Huge community tags: real, but a new post is buried within minutes. At
// most one, whatever tier the writer gave it.
const GENERIC_BROAD = new Set(['books', 'reading', 'book', 'gaming', 'games', 'game', 'sports', 'party', 'events', 'event', 'app', 'apps', 'tech', 'technology',
  'booktok', 'bookstagram', 'booklover', 'booklovers', 'bookworm', 'bookish', 'foodie', 'travelgram', 'wanderlust', 'instatravel', 'fitfam',
  'gym', 'workout', 'gamer', 'makeup', 'ootd', 'skincare', 'dance', 'pets', 'dogsofinstagram', 'catsofinstagram', 'nightlife', 'smallbusiness',
  'contentcreator', 'digitalmarketing', 'ai', 'artificialintelligence', 'crypto', 'nft', 'web3', 'startup', 'design', 'fantasy', 'romance', 'nyc', 'london']);

export function tagBody(t: unknown): string {
  return String(t || '').trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
}

// A tag the writer made up by gluing words: long, or three-plus words in
// CamelCase, and not a phrase the brand, the brief or the request uses.
export function looksInvented(body: string, allowedText: string): boolean {
  const lowAllowed = allowedText.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (lowAllowed.includes(body.toLowerCase())) return false;
  const parts = body.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) || [];
  if (body.length > 22) return true;
  if (parts.length >= 3 && body.length > 14) return true;
  return false;
}

// A topic for a tag the writer gave none: Wikipedia's own search for the
// tag (split at capitals: #SarahJMaas -> "Sarah J Maas"). Free; cached with
// the views.
// deno-lint-ignore no-explicit-any
async function guessTopic(supabase: any, tag: string): Promise<string | null> {
  const { data: c } = await supabase.from('cc_hashtag_stats').select('topic, checked_at').eq('tag', tag.toLowerCase()).maybeSingle();
  if (c && c.topic && Date.now() - Date.parse(c.checked_at) < 3 * 864e5) return c.topic;
  const q = tag.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=1&namespace=0&search=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'FullmediaAlchemist/1.0 (https://www.fullmediaalchemist.com; brad@unitedpress.media)' }, signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const j = await r.json();
    const title = Array.isArray(j) && Array.isArray(j[1]) ? String(j[1][0] || '') : '';
    return title || null;
  } catch { return null; }
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '') + '00';

// Wikipedia daily page views for a topic: average of the last 7 days and of
// the 60 days before. Free and public; cached.
// deno-lint-ignore no-explicit-any
async function topicInterest(supabase: any, tag: string, topic: string): Promise<{ views: number; ratio: number } | null> {
  const key = tag.toLowerCase();
  const { data: c } = await supabase.from('cc_hashtag_stats').select('avg_daily, ratio, checked_at').eq('tag', key).maybeSingle();
  if (c && Date.now() - Date.parse(c.checked_at) < 3 * 864e5) return c.avg_daily == null ? null : { views: c.avg_daily, ratio: Number(c.ratio) || 1 };
  const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 68 * 864e5);
  const title = encodeURIComponent(topic.trim().replace(/\s+/g, '_')).slice(0, 300);
  let out: { views: number; ratio: number } | null = null;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${title}/daily/${dayStr(start)}/${dayStr(end)}`, {
      headers: { 'User-Agent': 'FullmediaAlchemist/1.0 (https://www.fullmediaalchemist.com; brad@unitedpress.media)' }, signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    if (r.ok) {
      const j = await r.json();
      const v: number[] = (j.items || []).map((x: { views: number }) => Number(x.views) || 0);
      if (v.length >= 14) {
        const last = v.slice(-7), prev = v.slice(0, -7);
        const a = last.reduce((s, x) => s + x, 0) / last.length, b = prev.reduce((s, x) => s + x, 0) / Math.max(1, prev.length);
        out = { views: Math.round(a), ratio: b > 0 ? Math.round((a / b) * 100) / 100 : 1 };
      }
    }
  } catch { out = null; }
  await supabase.from('cc_hashtag_stats').upsert({ tag: key, topic: topic.slice(0, 200), avg_daily: out ? out.views : null, ratio: out ? out.ratio : null, checked_at: new Date().toISOString() });
  return out;
}

export type PickInput = {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  posts: { cands: TagCand[]; fallback: string[] }[];
  required: string[];
  brandName: string;
  allowedText: string;             // brand profile + briefs + request: phrases that are real here
  brandScores: Map<string, number>; // tag -> score vs the brand's usual (1 = usual)
};
export type Picked = { general: string[]; instagram: string[]; tiktok: string[]; notes: Record<string, TagNote> };

const TIER_RANK: Record<string, number> = { mid: 0, niche: 1, brand: 2, broad: 3, tiny: 4 };

export async function pickHashtags(inp: PickInput): Promise<Picked[]> {
  const req = inp.required.map(tagBody).filter(Boolean);
  const reqLow = new Set(req.map((x) => x.toLowerCase()));
  const brandLow = inp.brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Interest lookups: topic tags across the batch, at most 8.
  const topicTags = new Map<string, string>();
  for (const p of inp.posts) for (const c of p.cands) {
    const b = tagBody(c.tag); if (!b || !c.topic || topicTags.size >= 8) continue;
    if (!topicTags.has(b.toLowerCase())) topicTags.set(b.toLowerCase(), String(c.topic));
  }
  // Tags without a topic (and not giant or the brand's own): look one up.
  const brandKey = inp.brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const noTopic: string[] = [];
  for (const p of inp.posts) for (const c of [...p.cands, ...p.fallback.map((t) => ({ tag: t } as TagCand))]) {
    const b = tagBody(c.tag); const low = b.toLowerCase();
    if (!b || topicTags.has(low) || noTopic.includes(b) || MEGA.has(low) || GENERIC_BROAD.has(low) || low.includes(brandKey)) continue;
    if (noTopic.length < 10) noTopic.push(b);
  }
  const guessed = new Set<string>();
  await Promise.all(noTopic.map(async (b) => { const t = await guessTopic(inp.supabase, b).catch(() => null); if (t && topicTags.size < 14) { topicTags.set(b.toLowerCase(), t); guessed.add(b.toLowerCase()); } }));
  const interest = new Map<string, { views: number; ratio: number } | null>();
  await Promise.all([...topicTags].map(async ([k, topic]) => { interest.set(k, await topicInterest(inp.supabase, k, topic).catch(() => null)); }));

  return inp.posts.map((p) => {
    const notes: Record<string, TagNote> = {};
    const seen = new Set<string>();
    type C = { body: string; tier: string; plat: string; score: number };
    const pool: C[] = [];
    const consider = (raw: TagCand, fromFallback = false) => {
      const body = tagBody(raw.tag); const low = body.toLowerCase();
      if (!body || body.length < 3 || /^\p{N}+$/u.test(body) || seen.has(low)) return;
      const isReq = reqLow.has(low);
      const isBrand = low === brandLow || (brandLow.length > 3 && low.includes(brandLow));
      let tier = isBrand ? 'brand' : String(raw.tier || (fromFallback ? 'mid' : 'mid')).toLowerCase();
      if (!TIER_RANK.hasOwnProperty(tier)) tier = 'mid';
      if (!isReq && MEGA.has(low)) return;                              // too big to rank
      if (!isReq && !isBrand && looksInvented(body, inp.allowedText)) return; // nobody uses it
      if (!isReq && GENERIC_BROAD.has(low)) tier = 'broad';
      if (tier === 'tiny' && !isReq && !isBrand) return;
      const it = interest.get(low);
      // No one looking (only when the writer named the topic; a guessed one is just a hint).
      if (it && it.views < 30 && !guessed.has(low) && !isReq && !isBrand) return;
      const bs = inp.brandScores.get(low);
      if (bs != null && bs < 0.6 && !isReq) return;                       // did worse for this brand, more than once
      let score = 10 - (TIER_RANK[tier] ?? 3) * 2;
      const note: TagNote = { tier };
      if (it) {
        note.views = it.views;
        note.trend = it.ratio >= 1.5 ? 'rising' : it.views < 200 ? 'quiet' : 'steady';
        if (note.trend === 'rising') score += 4;
      }
      if (bs != null && bs > 1.2) { score += 3; note.brandScore = 'better'; }
      notes[body] = note;
      seen.add(low);
      pool.push({ body, tier, plat: String(raw.platform || 'all').toLowerCase(), score: isReq ? 100 : score });
    };
    req.forEach((r) => consider({ tag: r, tier: 'brand' }));
    p.cands.forEach((c) => consider(c));
    p.fallback.forEach((f) => consider({ tag: f }, true));

    const build = (plat: string) => {
      // A tag the writer marked for this network ranks a little higher there.
      const sc = (c: C) => c.score + (plat !== 'general' && c.plat === plat ? 2 : 0);
      const ok = pool.filter((c) => c.plat === 'all' || c.plat === plat || plat === 'general').sort((a, b) => sc(b) - sc(a));
      const out: C[] = ok.filter((c) => c.score >= 100).slice(0, 5);
      const brandTag = ok.find((c) => c.tier === 'brand' && c.score < 100);
      const room = () => 5 - out.length - (brandTag ? 1 : 0);
      // At least one active niche tag (the easiest place to rank), then the
      // strongest of the rest; at most one large tag.
      const niche = ok.find((c) => c.tier === 'niche' && !out.includes(c));
      if (niche && room() > 0) out.push(niche);
      let broad = out.filter((c) => c.tier === 'broad').length;
      for (const c of ok) {
        if (room() <= 0) break;
        if (out.includes(c) || c.tier === 'brand') continue;
        if (c.tier === 'broad') { if (broad >= 1) continue; broad++; }
        out.push(c);
      }
      if (brandTag && out.length < 5) out.push(brandTag);
      out.sort((a, b) => (b.score >= 100 ? 1 : 0) - (a.score >= 100 ? 1 : 0) || (a.tier === 'brand' ? 1 : 0) - (b.tier === 'brand' ? 1 : 0) || sc(b) - sc(a));
      // Order: required first, then the strongest rankable tags, brand tag last,
      // so networks that keep only the first 2-3 get the best ones.
      return out.map((c) => '#' + c.body);
    };
    return { general: build('general'), instagram: build('instagram'), tiktok: build('tiktok'), notes };
  });
}

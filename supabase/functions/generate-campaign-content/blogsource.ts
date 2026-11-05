// blogsource.ts (2026-11-02)
// "Make content from our recent blog posts" must be about the real, newest posts.
// This module finds them (feed, then sitemap, then the blog page itself), reads each
// one, and hands the text to the writer as facts for ONE post each.
//   - per-post links the owner gave (postBriefs[i].link): that page is read for that post
//   - links typed into the request: one post per link
//   - "recent / latest blog posts" with no links: the newest N posts, N = number of posts asked for
// Every fetch goes through ssrf.ts (public addresses only, redirects re-checked, size/time caps).
import { safeFetchRaw, htmlToText } from './ssrf.ts';

export type Brief = { brief: string; link: string | null; date: string | null; sendTo: boolean; use: string; pageText?: string; pageTitle?: string };
export type BlogResult = { used: boolean; mode: 'links' | 'recent' | ''; titles: string[]; note: string };

const TEXT_CAP = 3600;
const DEADLINE_MS = 28_000;
const BLOG_PATHS = ['/blog/', '/news/', '/journal/', '/articles/', '/stories/', '/insights/', '/posts/', '/resources/'];
const SKIP_PATH = /\/(page|tag|tags|category|categories|author|authors|feed|rss|search|wp-json|wp-content|wp-admin|cart|login|account|cdn-cgi)(\/|$)|\.(css|js|png|jpe?g|gif|svg|webp|ico|pdf|xml|json|txt|zip|mp4|woff2?)$/i;

/** The owner is asking for content built from the brand's own blog / articles. */
export function wantsRecentBlog(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (!/\b(blog|journal|articles?|news ?(page|posts?|articles?)|stories)\b/.test(t)) return false;
  if (/\b(recent|latest|newest|new|last|fresh|current|most recent)\b[^.\n]{0,40}\b(blog|journal|articles?|posts?|stories|news)/.test(t)) return true;
  return /\b(from|about|based on|using|off|promote|share|turn|repurpose|summari[sz]e)\b[^.\n]{0,40}\b(our|the|my|your|their|this)\b[^.\n]{0,25}\b(blog|journal|articles?)\b/.test(t);
}

export function urlsIn(text: string, max = 10): string[] {
  const out: string[] = [];
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s)<>"'\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    try { const x = new URL(u); x.hash = ''; const s = x.toString(); if (!out.includes(s)) out.push(s); } catch { /* skip */ }
    if (out.length >= max) break;
  }
  return out;
}

const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-').replace(/&nbsp;/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ' '; } }).replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } });
const clip = (s: string, n: number) => dec(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, n);
const noSite = (t: string) => t.replace(/\s+[·|\u2013\u2014-]\s+[^·|\u2013\u2014]{2,40}$/, '').trim() || t;
function isoDate(v: string | null | undefined): string | null {
  const s = String(v || '').trim(); if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}
function abs(href: string, base: string): URL | null {
  try { const u = new URL(dec(href), base); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; u.hash = ''; return u; } catch { return null; }
}
const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '');

type Cand = { url: string; title: string; date: string | null; desc: string };

function parseFeed(xml: string, base: string): Cand[] {
  const out: Cand[] = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = clip(htmlToText((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '')), 200);
    let link = (b.match(/<link[^>]*?href=["']([^"']+)["'][^>]*?(?:rel=["']alternate["'])?[^>]*\/?>/i)?.[1]) || (b.match(/<link[^>]*>([^<]+)<\/link>/i)?.[1]) || (b.match(/<guid[^>]*>(https?:[^<]+)<\/guid>/i)?.[1]) || '';
    link = link.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const u = abs(link, base); if (!u) continue;
    const date = isoDate(b.match(/<(pubDate|published|updated|dc:date)[^>]*>([^<]+)</i)?.[2]);
    const desc = clip(htmlToText((b.match(/<(description|summary|content:encoded|content)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || '').replace(/<!\[CDATA\[|\]\]>/g, '')), 400);
    out.push({ url: u.toString(), title, date, desc });
  }
  return out;
}

function parseIndexLinks(html: string, indexUrl: URL): Cand[] {
  const out: Cand[] = []; const seen = new Set<string>();
  const base = indexUrl.pathname.endsWith('/') ? indexUrl.pathname : indexUrl.pathname + '/';
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = abs(m[1], indexUrl.toString()); if (!u || !sameSite(u, indexUrl)) continue;
    const path = u.pathname;
    if (SKIP_PATH.test(path) || u.search && /[?&](page|paged|s|q)=/.test(u.search)) continue;
    if (!path.startsWith(base) || path.replace(/\/+$/, '') === base.replace(/\/+$/, '')) continue;
    const key = u.origin + path.replace(/\/+$/, '');
    if (seen.has(key)) continue; seen.add(key);
    const h = m[2].match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || m[2];
    const near = html.slice(Math.max(0, (m.index || 0) - 200), (m.index || 0) + m[0].length + 400);
    const date = isoDate(near.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1]);
    out.push({ url: u.toString(), title: clip(htmlToText(h), 200), date, desc: '' });
  }
  return out;
}

function parseSitemap(xml: string, indexUrl: URL): { subs: string[]; urls: Cand[] } {
  const subs: string[] = []; const urls: Cand[] = [];
  for (const m of xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)) subs.push(m[1]);
  const base = indexUrl.pathname.endsWith('/') ? indexUrl.pathname : indexUrl.pathname + '/';
  for (const m of xml.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>([\s\S]*?)<\/url>/gi)) {
    const u = abs(m[1], indexUrl.toString()); if (!u || !sameSite(u, indexUrl) || SKIP_PATH.test(u.pathname)) continue;
    if (!u.pathname.startsWith(base) || u.pathname.replace(/\/+$/, '') === base.replace(/\/+$/, '')) continue;
    urls.push({ url: u.toString(), title: '', date: isoDate(m[2].match(/<lastmod>\s*([^<\s]+)/i)?.[1]), desc: '' });
  }
  return { subs, urls };
}

type Page = { url: string; title: string; date: string | null; desc: string; text: string };
function readPage(raw: string, url: string): Page {
  const meta = (re: RegExp) => dec(raw.match(re)?.[1] || '');
  const title = noSite(clip(meta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || meta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) || htmlToText(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') || htmlToText(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), 200));
  const desc = clip(meta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || meta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i), 400);
  const date = isoDate(raw.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1]) || isoDate(meta(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)) || isoDate(meta(/<meta[^>]+(?:name|itemprop)=["'](?:date|pubdate|publishdate|datePublished)["'][^>]+content=["']([^"']+)["']/i)) || isoDate(raw.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1]);
  const body = raw.match(/<article[\s\S]*?<\/article>/i)?.[0] || raw.match(/<main[\s\S]*?<\/main>/i)?.[0] || raw.match(/<body[\s\S]*<\/body>/i)?.[0] || raw;
  const cleaned = body.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const text = htmlToText(cleaned).replace(/\n+/g, '\n').slice(0, TEXT_CAP);
  return { url, title, date, desc, text };
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function fetchPage(url: string, deadline: number): Promise<Page | null> {
  if (Date.now() > deadline) return null;
  const r = await safeFetchRaw(url, 900_000); if (!r) return null;
  const p = readPage(r.raw, r.url); return p.text.length >= 80 || p.desc ? p : null;
}

async function discover(seeds: string[], deadline: number): Promise<Cand[]> {
  const indexes: URL[] = [];
  const add = (u: URL | null) => { if (u && !indexes.some((x) => x.toString() === u.toString())) indexes.push(u); };
  for (const s of seeds) {
    const u = abs(s, s); if (!u) continue;
    const isRoot = u.pathname.replace(/\/+$/, '') === '';
    if (!isRoot) add(u);
    else { for (const p of BLOG_PATHS) add(new URL(p, u.origin)); }
  }
  for (const idx of indexes.slice(0, 8)) {
    if (Date.now() > deadline) break;
    const r = await safeFetchRaw(idx.toString(), 900_000); if (!r) continue;
    const here = new URL(r.url);
    // 1. a feed advertised by the page, then the usual feed addresses
    const feedUrls: string[] = [];
    for (const m of r.raw.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)) { const h = m[0].match(/href=["']([^"']+)["']/i)?.[1]; const u = h && abs(h, here.toString()); if (u && sameSite(u, here)) feedUrls.push(u.toString()); }
    const bp = here.pathname.endsWith('/') ? here.pathname : here.pathname + '/';
    for (const g of [bp + 'feed/', bp + 'feed.xml', bp + 'rss.xml', '/feed/', '/feed', '/rss.xml', '/feed.xml', '/atom.xml']) feedUrls.push(new URL(g, here.origin).toString());
    for (const f of [...new Set(feedUrls)].slice(0, 5)) {
      if (Date.now() > deadline) break;
      const fr = await safeFetchRaw(f, 900_000); if (!fr || !/<(rss|feed|rdf)[\s>]/i.test(fr.raw.slice(0, 2000))) continue;
      const items = parseFeed(fr.raw, fr.url).filter((c) => sameSite(new URL(c.url), here));
      if (items.length) return items;
    }
    // 2. the posts linked from the blog page (page order, newest first on most blogs)
    const links = parseIndexLinks(r.raw, here);
    if (links.length) return links;
    // 3. the sitemap
    for (const sm of ['/sitemap.xml', '/sitemap_index.xml', '/post-sitemap.xml', '/blog-sitemap.xml']) {
      if (Date.now() > deadline) break;
      const sr = await safeFetchRaw(new URL(sm, here.origin).toString(), 900_000); if (!sr || !/<(urlset|sitemapindex)/i.test(sr.raw.slice(0, 2000))) continue;
      let { subs, urls } = parseSitemap(sr.raw, here);
      if (!urls.length && subs.length) {
        for (const s of subs.filter((x) => /post|blog|news|article|journal/i.test(x)).slice(0, 3)) { const c = await safeFetchRaw(s, 900_000); if (c) urls = urls.concat(parseSitemap(c.raw, here).urls); }
      }
      if (urls.length) return urls;
    }
  }
  return [];
}

/**
 * Reads the pages the posts must be about and writes them into `briefs` (mutated):
 * adds `pageText` to briefs that have a link, and adds new briefs for typed links / recent blog posts.
 */
export async function prepareBlogSources(o: { requestText: string; briefs: Brief[]; count: number; seeds: string[]; isOwn?: (u: string) => boolean }): Promise<BlogResult> {
  const deadline = Date.now() + DEADLINE_MS;
  const titles: string[] = []; let mode: BlogResult['mode'] = ''; let note = '';
  const put = (b: Brief, p: Page) => { b.pageText = `${p.title ? 'TITLE: ' + p.title + '\n' : ''}${p.date ? 'PUBLISHED: ' + p.date + '\n' : ''}${p.text || p.desc}`.slice(0, TEXT_CAP + 300); b.pageTitle = p.title; titles.push(p.title || b.link || ''); };

  // 1. links the owner attached to each post
  const withLink = o.briefs.filter((b) => b.link);
  if (withLink.length) {
    const pages = await pool(withLink, 4, (b) => fetchPage(b.link as string, deadline));
    withLink.forEach((b, i) => { const p = pages[i]; if (p) put(b, p); });
    if (withLink.some((b) => b.pageText)) { mode = 'links'; note = `read ${withLink.filter((b) => b.pageText).length} of ${withLink.length} linked pages`; }
  }
  if (o.briefs.length) return { used: !!mode, mode, titles, note };

  // 2. links typed into the request: one post per link
  const typed = urlsIn(o.requestText, Math.min(10, o.count));
  if (typed.length) {
    const pages = await pool(typed, 4, (u) => fetchPage(u, deadline));
    typed.forEach((u, i) => { const p = pages[i]; if (!p) return; const b: Brief = { brief: `Write this post about the page "${p.title || u}".`, link: u, date: null, sendTo: o.isOwn ? !!o.isOwn(u) : false, use: '' }; put(b, p); o.briefs.push(b); });
    if (o.briefs.length) { mode = 'links'; note = `read ${o.briefs.length} of ${typed.length} links from the request`; }
  }
  if (o.briefs.length) return { used: true, mode, titles, note };

  // 3. "recent / latest blog posts": the newest N, N = posts asked for
  if (wantsRecentBlog(o.requestText) && o.seeds.length) {
    const cands = await discover(o.seeds, deadline);
    if (!cands.length) return { used: false, mode: '', titles, note: 'no blog posts could be found' };
    const dated = cands.every((c) => c.date);
    let pool0 = cands.slice(0, dated ? 60 : 14);
    const pages = new Map<string, Page>();
    if (!dated) {
      const got = await pool(pool0, 6, (c) => fetchPage(c.url, deadline));
      got.forEach((p, i) => { if (p) { pages.set(pool0[i].url, p); if (p.date) pool0[i] = { ...pool0[i], date: p.date }; if (p.title) pool0[i] = { ...pool0[i], title: p.title }; } });
    }
    // newest first; posts without a date keep their page order after the dated ones
    const order = pool0.map((c, i) => ({ c, i })).sort((a, b) => (a.c.date && b.c.date ? (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : a.i - b.i) : a.c.date ? -1 : b.c.date ? 1 : a.i - b.i)).map((x) => x.c);
    const pick = order.slice(0, Math.min(o.count, 10));
    await pool(pick, 4, async (c) => { if (!pages.has(c.url)) { const p = await fetchPage(c.url, deadline); if (p) pages.set(c.url, p); } });
    const have = pick.filter((c) => pages.has(c.url) || c.desc);
    if (!have.length) return { used: false, mode: '', titles, note: 'the blog posts could not be read' };
    for (let i = 0; i < o.count; i++) {
      const c = have[i % have.length]; const p = pages.get(c.url) || { url: c.url, title: c.title, date: c.date, desc: c.desc, text: c.desc };
      const again = i >= have.length;
      const b: Brief = { brief: `Write this post about the blog post "${p.title || c.title}"${p.date ? ` (published ${p.date})` : ''}.${again ? ' An earlier post in this batch already covers this article: take a DIFFERENT point from it.' : ''}`, link: c.url, date: null, sendTo: true, use: '' };
      put(b, p); o.briefs.push(b);
    }
    mode = 'recent'; note = `newest ${have.length} blog post${have.length === 1 ? '' : 's'}${dated ? '' : ' (dates read from the pages)'}`;
    return { used: true, mode, titles: have.map((c) => pages.get(c.url)?.title || c.title), note };
  }
  return { used: false, mode: '', titles, note };
}

// Serves the Journal: static posts (built by build_journal.py) plus posts the daily writer saves in Supabase.
// Routes (see vercel.json rewrites): /blog/ -> ?list=1, /blog/<slug>/ -> ?slug=, /sitemap-journal.xml -> ?sitemap=1
const D = require('./_journal_data.json');

const SB_URL = 'https://tpqvvrdglnsdljdpzwfl.supabase.co';
// Public anon key (read only; RLS lets it see published posts and nothing else).
const KEY = process.env.JOURNAL_SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcXZ2cmRnbG5zZGxqZHB6d2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0OTEwMTAsImV4cCI6MjA5NzA2NzAxMH0.gxr0vEWFBwPp8ErX41rHNFV0aMU_lhiceFhY64iA7Ko';
const SITE = D.site;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CAT_NAME = { features: 'New features', reach: 'Reach', playbook: 'Playbook', workshop: 'Workshop' };
const CATS = [['all', 'All'], ['features', 'New features'], ['reach', 'Reach'], ['playbook', 'Playbook'], ['workshop', 'Workshop']];
const PER_PAGE = 48;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const titleHtml = (t) => esc(t).replace(/&lt;(\/?)em&gt;/g, '<$1em>');
const plain = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const fdate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; };
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const today = () => new Date().toISOString().slice(0, 10);

async function rest(query) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(SB_URL + '/rest/v1/journal_posts?' + query, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('rest ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const PUB = () => 'status=eq.published&published_at=lte.' + today();

const thumbFor = (slug) => D.thumb_pool[hash(slug) % D.thumb_pool.length];
function dyn(r) {
  return { kind: 'd', slug: r.slug, title: r.title, dek: r.dek, tag: r.tag || 'Playbook', cat: CAT_NAME[r.cat] ? r.cat : 'playbook', date: String(r.published_at).slice(0, 10), read: r.read_label || '5 min read', og: r.cat === 'reach' ? 'reach' : 'main' };
}
function meta(p) { return '<div class="meta"><span>' + fdate(p.date) + '</span><span>·</span><span>' + esc(p.read) + '</span></div>'; }
function cardOf(p) {
  if (p.kind === 's') return p.card;
  return '<a class="card" href="/blog/' + p.slug + '/" data-cat="' + p.cat + '">' + thumbFor(p.slug) + '<div class="txt"><span class="tag">' + esc(p.tag) + '</span><h2>' + titleHtml(p.title) + '</h2><p class="dek">' + esc(p.dek) + '</p>' + meta(p) + '</div></a>';
}
function featuredOf(p) {
  if (p.kind === 's') return p.featured;
  return '<a class="featured" href="/blog/' + p.slug + '/" data-cat="' + p.cat + '">' + thumbFor(p.slug) + '<div class="txt"><span class="tag">' + esc(p.tag) + ' · New</span><h2>' + titleHtml(p.title) + '</h2><p class="dek">' + esc(p.dek) + '</p>' + meta(p) + '</div></a>';
}
const STATIC = D.static.map((p) => Object.assign({ kind: 's' }, p));
function merge(dynRows) {
  const all = STATIC.concat(dynRows);
  // newest first; on the same day database posts come first (they are the newer ones)
  return all.map((p, i) => [p, i]).sort((a, b) => (a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : (a[0].kind === b[0].kind ? a[1] - b[1] : a[0].kind === 'd' ? -1 : 1))).map((x) => x[0]);
}

function ogMeta(title, desc, url, typ, ogkey) {
  const img = SITE + (ogkey === 'reach' ? '/assets/og-reach.jpg' : '/assets/og-main.jpg');
  const alt = ogkey === 'reach' ? 'Alchemist Reach: find, rank and draft outreach' : 'Fullmedia Alchemist: the Alchemist reading beside a transmutation circle';
  return '<meta property="og:type" content="' + typ + '"><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="' + url + '">' +
    '<meta property="og:image" content="' + img + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="' + alt + '"><meta name="twitter:image" content="' + img + '">';
}
function send(res, code, body, type, cache) {
  res.statusCode = code;
  res.setHeader('Content-Type', type || 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'public, s-maxage=600, stale-while-revalidate=86400');
  res.end(body);
}
function shell(title, desc, canonical, headExtra, main, noindex) {
  return '<!doctype html>\n<html lang="en"><head>\n<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n' +
    (noindex ? '<meta name="robots" content="noindex">\n' : '') + '<link rel="canonical" href="' + canonical + '">\n' + headExtra + '\n' + D.head_tail + '\n</head>\n<body>\n' + D.header + '\n<main>\n' + main + '\n</main>\n' + D.footer;
}

async function recentDyn(n) {
  try { return (await rest('select=slug,title,dek,tag,cat,published_at,read_label&' + PUB() + '&order=published_at.desc,created_at.desc&limit=' + n)).map(dyn); } catch (e) { return []; }
}

function pageList(res, rows, page, dbOk) {
  const all = merge(rows);
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  page = Math.min(Math.max(1, page || 1), pages);
  const slice = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const cnt = { all: slice.length };
  CATS.forEach(([c]) => { if (c !== 'all') cnt[c] = slice.filter((p) => p.cat === c).length; });
  const chips = '<div class="chips" role="group" aria-label="Filter posts">' + CATS.map(([c, n]) => '<button type="button" class="chip" data-cat="' + c + '" aria-pressed="' + (c === 'all' ? 'true' : 'false') + '">' + n + '<small>' + cnt[c] + '</small></button>').join('') + '</div>';
  const first = page === 1 ? slice[0] : null;
  const rest_ = first ? slice.slice(1) : slice;
  const pager = pages > 1 ? '<nav class="pager" aria-label="Pages" style="display:flex;gap:12px;justify-content:center;align-items:center;margin:32px 0;flex-wrap:wrap">' +
    (page > 1 ? '<a class="btn btn-ghost" href="' + (page === 2 ? '/blog/' : '/blog/?page=' + (page - 1)) + '">&larr; Newer posts</a>' : '') +
    '<span>Page ' + page + ' of ' + pages + '</span>' +
    (page < pages ? '<a class="btn btn-ghost" href="/blog/?page=' + (page + 1) + '">Older posts &rarr;</a>' : '') + '</nav>' : '';
  const canonical = SITE + '/blog/' + (page > 1 ? '?page=' + page : '');
  const t = "The Alchemist's Journal · Fullmedia Alchemist" + (page > 1 ? ' (page ' + page + ')' : '');
  const desc = 'New features, playbooks and notes from the workshop: social posts from your website, Reach outreach, voice, and what we are learning.';
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'Blog', name: "The Alchemist's Journal", url: SITE + '/blog/', publisher: { '@type': 'Organization', name: 'United Press Media', url: 'https://unitedpress.media' },
    blogPost: slice.map((p) => ({ '@type': 'BlogPosting', headline: plain(p.title), url: SITE + '/blog/' + p.slug + '/', datePublished: p.date })) });
  const main = '<section class="jhero"><div class="wrap grid">\n  <div><span class="eyebrow">The Alchemist\'s Journal</span><h1>Notes from <em>the workshop</em>.</h1><p>What is new in Fullmedia Alchemist and Reach, practical playbooks for small teams, and what we are learning along the way.</p></div>\n' +
    '  <div class="circle " aria-hidden="false"><span class="glow"></span><img class="ring" src="/assets/logo-mark.svg" alt=""><img class="who" src="' + D.listing_hero + '" alt="The Alchemist sitting on a wooden chest, tracing a route on a map" width="600" height="900"></div>\n</div></section>\n' +
    '<section class="list"><div class="wrap">\n  ' + (first ? featuredOf(first) : '') + '\n  ' + chips + '\n  <p class="listnote">' + total + ' posts. New posts most days.</p>\n  <div class="cards three">' + rest_.map(cardOf).join('') + '</div>\n  ' + pager + '\n  <div class="bandcta">' + D.listing_cta + '</div>\n</div></section>';
  const html = shell(t, desc, canonical, ogMeta(t, desc, SITE + '/blog/', 'website', 'main') + '\n<script type="application/ld+json">' + ld + '</script>', main);
  send(res, 200, html, null, dbOk ? 'public, s-maxage=300, stale-while-revalidate=86400' : 'public, s-maxage=30');
}

function pageNotFound(res, code) {
  const main = '<section class="list"><div class="wrap" style="padding:80px 0;text-align:center"><h1>' + (code === 503 ? 'The Journal is catching its breath.' : 'That post is not here.') + '</h1><p>' + (code === 503 ? 'Please try again in a minute.' : 'It may have moved or never existed.') + '</p><p><a class="btn btn-gold" href="/blog/">Back to the Journal</a></p></div></section>';
  send(res, code, shell('Journal · Fullmedia Alchemist', 'The Alchemist\'s Journal', SITE + '/blog/', '', main, true), null, 'public, s-maxage=60');
}

async function pagePost(res, slug) {
  let row;
  try { row = (await rest('select=*&slug=eq.' + encodeURIComponent(slug) + '&' + PUB() + '&limit=1'))[0]; } catch (e) { return pageNotFound(res, 503); }
  if (!row) return pageNotFound(res, 404);
  const p = dyn(row);
  const recent = await recentDyn(40);
  const pool = merge(recent.filter((x) => x.slug !== p.slug)).filter((x) => x.slug !== p.slug);
  const pick = pool.filter((x) => x.cat === p.cat).slice(0, 3);
  for (const x of pool) { if (pick.length >= 3) break; if (!pick.includes(x)) pick.push(x); }
  const more = '<section class="more"><div class="wrap"><h2>More from the Journal</h2><div class="cards three">' + pick.map(cardOf).join('') + '</div></div></section>';
  const url = SITE + '/blog/' + p.slug + '/';
  const t = plain(p.title) + ' · Fullmedia Alchemist';
  const desc = plain(p.dek);
  const ld = jsonLd({ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: plain(p.title), description: desc, image: SITE + (p.og === 'reach' ? '/assets/og-reach.jpg' : '/assets/og-main.jpg'),
    datePublished: p.date, dateModified: p.date, url, mainEntityOfPage: url, articleSection: CAT_NAME[p.cat],
    author: { '@type': 'Organization', name: 'Fullmedia Alchemist' }, publisher: { '@type': 'Organization', name: 'United Press Media', url: 'https://unitedpress.media' } });
  const main = '<article>\n  <div class="narrow post-head"><a class="eyebrow" href="/blog/" style="text-decoration:none">The Alchemist\'s Journal · ' + esc(p.tag) + '</a><h1>' + titleHtml(p.title) + '</h1><p class="dek">' + esc(p.dek) + '</p>\n' +
    '    <div class="byline"><span class="av" style="background-image:url(\'https://tpqvvrdglnsdljdpzwfl.supabase.co/storage/v1/render/image/public/wheel-assets/content-calendar/platform-brand/assistant-wave.png?width=256&amp;height=384&amp;resize=contain&amp;quality=85\')"></span><span><b>The Alchemist</b><br>' + fdate(p.date) + ' · ' + esc(p.read) + '</span></div></div>\n' +
    '  <div class="cover">' + thumbFor(p.slug) + '</div>\n  <div class="narrow prose">\n' + row.body + '\n  </div>\n</article>\n' + more;
  send(res, 200, shell(t, desc, url, ogMeta(t, desc, url, 'article', p.og) + '\n<script type="application/ld+json">' + ld + '</script>', main));
}

async function pageSitemap(res) {
  let rows = [];
  try { rows = await rest('select=slug,published_at&' + PUB() + '&order=published_at.desc&limit=5000'); } catch (e) { /* empty sitemap is fine */ }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.map((r) => '  <url><loc>' + SITE + '/blog/' + r.slug + '/</loc><lastmod>' + String(r.published_at).slice(0, 10) + '</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>').join('\n') + '\n</urlset>\n';
  send(res, 200, xml, 'application/xml; charset=utf-8', 'public, s-maxage=1800, stale-while-revalidate=86400');
}

module.exports = async (req, res) => {
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (q.sitemap) return await pageSitemap(res);
    if (q.slug) {
      const slug = String(q.slug).toLowerCase();
      if (slug === 'archive') { res.statusCode = 302; res.setHeader('Location', '/blog/archive/'); return res.end(); }
      if (!/^[a-z0-9-]{1,100}$/.test(slug)) return pageNotFound(res, 404);
      return await pagePost(res, slug);
    }
    let rows = [], ok = true;
    try { rows = (await rest('select=slug,title,dek,tag,cat,published_at,read_label&' + PUB() + '&order=published_at.desc,created_at.desc&limit=400')).map(dyn); } catch (e) { ok = false; }
    return pageList(res, rows, parseInt(q.page, 10) || 1, ok);
  } catch (e) {
    res.statusCode = 302; res.setHeader('Location', '/blog/archive/'); res.setHeader('Cache-Control', 'no-store'); res.end();
  }
};

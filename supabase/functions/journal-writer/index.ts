import { createClient } from 'jsr:@supabase/supabase-js@2';
import { STATIC_POSTS } from './static_posts.ts';
import { TOPICS } from './topics.ts';

// journal-writer (2026-11-03)
// Writes ONE Journal post per call and publishes it to public.journal_posts. A cron job calls it twice a day;
// at most MAX_PER_DAY posts are written per UTC day (body {"force":true} skips the cap, {"topic":"..."} picks a topic).
// Auth: x-cc-key must equal the CC_KEY secret (same pattern as the other server-to-server functions; fails closed).
// Safety: the model's HTML is passed through an allow-list sanitiser, links are limited to the site's own pages,
// and drafts with statistics, "studies show" claims or invented-looking numbers are rejected and retried once.

const MODEL = 'claude-sonnet-5';
const MAX_PER_DAY = 2;
const CC_KEY = (Deno.env.get('CC_KEY') || '').trim();
const ANTHROPIC_KEY = (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-cc-key' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json' } });

const FACTS = `VERIFIED PRODUCT FACTS (the only things you may say about the product):
- Fullmedia Alchemist is made by United Press Media. It has two tools: Content and Reach.
- Content: you give it a brand (website link, brand facts, tone, things to never say, logo, colours). The Alchemist writes social posts from those facts and from the brand's own pages: a caption fitted to each network (X, LinkedIn, Instagram, TikTok, Facebook, Pinterest, Reddit, Threads) and a picture card in the brand's look (a headline, three short facts, an optional QR code). It can also write text posts, X threads and polls. You review, edit, approve, copy or post, and save results. A table called "What worked where" shows which networks and formats did best from the results you saved.
- Posts come from your brand facts and your own pages; the Alchemist is built not to invent facts. You can ask for posts from your latest blog posts (1 post = the newest article, 3 posts = the newest three), or paste a link for each post.
- Campaigns hold a goal and dates. Voice input and hands-free mode exist. Brand settings hold logos, characters, colours and the news or blog page.
- Free plan: 30 credits a month in Content. Reach free plan: 150 AI credits a month.
- Reach: finds creators and media, partnership and client contacts, and free communities (it reads each community's rules and drops places that ban promotion). A workbench table holds every prospect with status, a priority score and follow-up dates. Reach drafts messages from your brand facts, you edit them and send them yourself (copy, or open in your own Gmail). Nothing is ever sent for you. A Stalled tab lists quiet deals, with snooze, skip-this-step and stop-follow-ups, plus a verify checklist before money or access changes hands.
DO NOT claim: automatic posting to networks, analytics integrations, specific paid prices, customer numbers, awards, rankings, comparisons with named competitors, guaranteed results.`;

const SYSTEM = `You write one article for The Alchemist's Journal, the blog of Fullmedia Alchemist, to bring small brands, solo founders, agencies, creators and community managers to the site through search and sharing.

QUALITY RULES
- Be practical and specific: a reader should be able to act on it today. Plain words, second person ("you"), short paragraphs. No hype, no filler openers ("In today's fast-paced world"), no clickbait.
- NEVER invent statistics, percentages, studies, surveys, quotes, case studies, named customers, prices or dates. Do not write "studies show", "research shows", "according to" or "experts say". Give advice as reasoning and rules of thumb, and say plainly when something depends. Use numbers only for things you are choosing yourself (steps, lengths, counts of ideas).
- Do not state platform rules, character limits or algorithm behaviour unless it is very well established; if unsure, speak generally ("check the network's current rules").
- No legal, medical or financial advice. For anything touching law, disclosure or money, say it is general guidance and to check local rules.
- Evergreen: no "this year", no dated news.
- Include at most one short paragraph or list about how Fullmedia Alchemist helps, using ONLY the verified product facts below, and only when it truly fits the topic. The article must be useful without the product.
- Use US-neutral plain English. Do not use em dashes or en dashes; use commas, periods or colons.

${FACTS}

FORMAT of body_html (HTML only, no markdown, no <h1>, no call-to-action block; it is added for you):
- Start with <p class="lead">one or two sentences</p>.
- Then 3 to 5 sections, each an <h2> followed by <p>, <ul>/<li>, or <ol class="steps"><li>...</li></ol>.
- Optional: one table as <div class="tablewrap"><table><thead><tr><th>..</th></tr></thead><tbody><tr><td>..</td></tr></tbody></table></div>.
- Optional: one callout as <div class="callout"><b>Short label</b><p>One or two sentences.</p></div>.
- Allowed tags only: p, h2, h3, ul, ol, li, strong, em, a, br, table, thead, tbody, tr, th, td, div. Links only to the internal pages listed in the user message (exact href values).
- Length: 600 to 1000 words.`;

const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'a', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div']);
const ALLOWED_CLASS: Record<string, string[]> = { p: ['lead'], ol: ['steps'], div: ['tablewrap', 'callout'] };
const EXTRA_HREFS = ['/', '/dashboard/', '/reach/', '/reach-features/', '/blog/'];

function slugify(s: string) { return s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, ''); }
function plain(s: string) { return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim(); }
function noDashes(s: string) { return s.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ','); }

function sanitize(html: string, hrefs: Set<string>): string {
  let out = String(html || '');
  out = out.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|form|svg|img|video|audio|link|meta)[\s\S]*?(<\/\1>|$)/gi, '');
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (m, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    if (m.startsWith('</')) return `</${t}>`;
    let extra = '';
    if (t === 'a') {
      const h = (attrs.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      if (!hrefs.has(h)) return '';
      extra = ` href="${h}"`;
    } else if (ALLOWED_CLASS[t]) {
      const c = (attrs.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      const ok = c.split(/\s+/).filter((x) => ALLOWED_CLASS[t].includes(x));
      if (ok.length) extra = ` class="${ok.join(' ')}"`;
      else if (t === 'div') return '';
    }
    return `<${t}${extra}>`;
  });
  // a link that lost its opening tag leaves a stray </a>; drop unmatched closers
  let depth = 0;
  out = out.replace(/<(\/?)a(?: [^>]*)?>/g, (m, close: string) => { if (!close) { depth++; return m; } if (depth > 0) { depth--; return m; } return ''; });
  while (depth-- > 0) out += '</a>';
  // a plain div that was dropped leaves a stray </div>
  const opens = (out.match(/<div[ >]/g) || []).length, closes = (out.match(/<\/div>/g) || []).length;
  for (let i = closes; i > opens; i--) out = out.replace(/<\/div>(?![\s\S]*<\/div>)/, '');
  // the callout gets the site's mark in front, like the hand-made posts
  out = out.replace(/<div class="callout">/g, '<div class="callout"><img src="/assets/logo-mark.svg" alt="">');
  return noDashes(out).trim();
}

const BAD = [
  /\b\d{1,3}(\.\d+)?\s?%/,
  /\b(studies|research|surveys?|reports?|data)\s+(show|shows|suggest|suggests|found|finds|indicate|indicates)\b/i,
  /\baccording to\b/i,
  /\bexperts?\s+(say|agree|recommend)\b/i,
  /\b(in|by)\s+20(2[0-9]|3[0-9])\b/i,
  /\bguarantee[sd]?\b/i,
];
function problems(title: string, dek: string, body: string): string[] {
  const out: string[] = [];
  const words = plain(body).split(' ').length;
  if (words < 450) out.push(`too short (${words} words, need 600 to 1000)`);
  if (words > 1500) out.push(`too long (${words} words)`);
  if (!/<p class="lead">/.test(body)) out.push('missing <p class="lead"> opener');
  if ((body.match(/<h2>/g) || []).length < 3) out.push('needs at least 3 <h2> sections');
  const all = `${title} ${dek} ${plain(body)}`;
  for (const re of BAD) { const m = all.match(re); if (m) out.push(`contains a forbidden claim pattern: "${m[0]}" (no statistics, studies, dated claims or guarantees)`); }
  if (dek.length < 40 || dek.length > 190) out.push('dek must be 40 to 190 characters');
  return out;
}

const CTA = (cat: string) => cat === 'reach'
  ? '<div class="endcta"><div class="circle " aria-hidden="true"><span class="glow"></span><img class="ring" src="/assets/logo-mark.svg" alt=""></div><div><h3>Keep your outreach organised.</h3><p>Reach has a free plan with 150 AI credits a month. Nothing is sent without you.</p></div><a class="btn btn-gold" href="/reach/">Try Reach free</a></div>'
  : '<div class="endcta"><div class="circle " aria-hidden="true"><span class="glow"></span><img class="ring" src="/assets/logo-mark.svg" alt=""></div><div><h3>Turn your brand into a week of posts.</h3><p>The Free plan includes 30 credits a month. No card.</p></div><a class="btn btn-gold" href="/dashboard/">Start free</a></div>';

async function callClaude(user: string): Promise<{ title: string; dek: string; tag: string; cat: string; read_minutes: number; body_html: string; slug: string } | { error: string }> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 6000, system: SYSTEM, messages: [{ role: 'user', content: user }],
      tools: [{
        name: 'publish_article', description: 'Return the finished article.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The headline, 45 to 80 characters. Wrap ONE short phrase of 2 to 5 words in <em></em> for emphasis. No dashes.' },
            dek: { type: 'string', description: 'One sentence summary, 60 to 170 characters.' },
            tag: { type: 'string', enum: ['Playbook', 'Reach', 'Guide'] },
            cat: { type: 'string', enum: ['playbook', 'reach'] },
            read_minutes: { type: 'integer', minimum: 3, maximum: 8 },
            slug: { type: 'string', description: 'kebab-case, 3 to 8 words, no dates' },
            body_html: { type: 'string' },
          },
          required: ['title', 'dek', 'tag', 'cat', 'read_minutes', 'slug', 'body_html'],
        },
      }],
      tool_choice: { type: 'tool', name: 'publish_article' },
    }),
  });
  if (!r.ok) return { error: `anthropic ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const j = await r.json();
  const inp = j.content?.find((c: { type: string }) => c.type === 'tool_use')?.input;
  if (!inp || typeof inp.body_html !== 'string') return { error: 'no article returned' };
  return inp;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CC_KEY || (req.headers.get('x-cc-key') || '').trim() !== CC_KEY) return json({ error: 'unauthorized' }, 401);
  if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 500);
  const body = await req.json().catch(() => ({}));
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows, error: e0 } = await db.from('journal_posts').select('slug,title,topic_key,published_at,model');
  if (e0) return json({ error: 'journal_posts table is missing or unreadable: ' + e0.message }, 500);
  const made = (rows || []).filter((r) => r.published_at === today && r.model).length;
  if (!body.force && made >= MAX_PER_DAY) return json({ skipped: `already wrote ${made} today` });

  const used = new Set((rows || []).map((r) => r.topic_key).filter(Boolean));
  const topic = typeof body.topic === 'string' && body.topic.trim()
    ? { key: 'custom-' + slugify(body.topic).slice(0, 40), brief: body.topic.trim().slice(0, 300), cat: 'playbook' }
    : TOPICS.find((t) => !used.has(t.key)) || null;

  const links = [
    ...STATIC_POSTS.map((p) => ({ href: `/blog/${p.slug}/`, title: p.title })),
    ...(rows || []).map((p) => ({ href: `/blog/${p.slug}/`, title: String(p.title).replace(/<[^>]+>/g, '') })),
  ];
  const hrefs = new Set<string>([...links.map((l) => l.href), ...EXTRA_HREFS]);
  const existing = links.map((l) => `- ${l.title}`).join('\n');
  const linkList = links.map((l) => `${l.href}  (${l.title})`).join('\n');

  const brief = topic
    ? `TOPIC: ${topic.brief}\nSuggested category: ${topic.cat}.`
    : `Choose a NEW topic that fits small brands, agencies, creators or community managers and that is clearly different from every existing post below. Prefer a how-to or checklist that people search for.`;
  const baseUser = `${brief}\n\nEXISTING JOURNAL POSTS (do not repeat them; you may link to up to 3 of them where it helps the reader, using the exact href):\n${linkList}\n\nWrite the article now.`;

  let feedback = '';
  let art: Awaited<ReturnType<typeof callClaude>> | null = null; let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callClaude(baseUser + feedback);
    if ('error' in r) { issues = [r.error]; continue; }
    const cleaned = sanitize(r.body_html, hrefs);
    const title = noDashes(String(r.title || '')).replace(/<(?!\/?em>)[^>]*>/g, '').slice(0, 140);
    const dek = noDashes(String(r.dek || '')).replace(/<[^>]+>/g, '').trim().slice(0, 220);
    issues = problems(title, dek, cleaned);
    if (!title) issues.push('missing title');
    if (!issues.length) { art = { ...r, title, dek, body_html: cleaned }; break; }
    feedback = `\n\nYour previous draft was rejected for: ${issues.join('; ')}. Rewrite the whole article and fix every point.`;
  }
  if (!art || 'error' in art) return json({ error: 'no usable draft', issues }, 502);

  let slug = slugify(art.slug || art.title) || 'journal-post-' + today;
  const taken = new Set((rows || []).map((r) => r.slug).concat(STATIC_POSTS.map((p) => p.slug)));
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
  const cat = art.cat === 'reach' ? 'reach' : 'playbook';
  const row = {
    slug, title: art.title, dek: art.dek, tag: ['Playbook', 'Reach', 'Guide'].includes(art.tag) ? art.tag : 'Playbook', cat,
    body: art.body_html + CTA(cat), read_label: `${Math.min(8, Math.max(3, Number(art.read_minutes) || 5))} min read`,
    topic_key: topic ? topic.key : 'free-' + slug, published_at: today, status: 'published', model: MODEL,
  };
  const { error: e1 } = await db.from('journal_posts').insert(row);
  if (e1) return json({ error: 'insert failed: ' + e1.message }, 500);
  return json({ ok: true, slug, title: plain(art.title), url: `https://www.fullmediaalchemist.com/blog/${slug}/` });
});

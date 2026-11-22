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
- Free plan: 30 credits a month in Content. Reach free plan: 150 AI credits to try.
- Reach: finds creators and media, partnership and client contacts, and free communities (it reads each community's rules and drops places that ban promotion). A workbench table holds every prospect with status, a priority score and follow-up dates. Reach drafts messages from your brand facts and you review and approve them. You can send them yourself (copy, or open in your own Gmail), or let your own Claude send the ones you approved from your own mail account, one at a time. Nothing is sent that you did not approve. A Stalled tab lists quiet deals, with snooze, skip-this-step and stop-follow-ups, plus a verify checklist before money or access changes hands.
DO NOT claim: automatic posting to networks, analytics integrations, specific paid prices, customer numbers, awards, rankings, comparisons with named competitors, guaranteed results.`;

const OWN_FACTS = `OUR OWN CAMPAIGN (true, first hand; you may cite these when they genuinely fit the topic, never change the numbers, never add other numbers about us):
- In our first three weeks of outreach for Fullmedia Alchemist (October 26 to November 13) we sent 148 emails, filled in 17 contact forms and sent 15 direct messages, and got one reply and no signups.
- The one reply came from a tool directory that said we were a great fit and pointed us to its submission form.
- We caught our own mistake: a follow up template written for paid creator deals, asking for rates and lead time, was set to go to a software directory that had already replied. We rewrote the follow ups for software.
- Before we added tagged links we had no tracked links, so we could not tell what brought visitors.
Do not invent any other personal experience, customer story, anecdote or result. If you have no true first hand detail, give a concrete worked example and label it as an example.`;

const CHECKLIST = `QUALITY CHECKLIST (every point is checked by code and by an editor before anything is published; a draft that misses any point is rejected):
1. Answer first: the opening paragraph gives the main answer or takeaway in plain words, under 60 words.
2. Specific and usable: at least two concrete examples ("for example", "such as", a sample line, a sample week, a template). A reader can act on it today.
3. Human voice: varied sentence length (some under 7 words, some over 22), contractions (you're, it's, don't), direct address. No filler. Never use: "in today's", "delve", "unlock", "game changer", "game-changing", "landscape", "tapestry", "seamless", "leverage", "elevate", "robust", "it's important to note", "in conclusion", "navigate the", "in the world of", "dive into", "ever-evolving".
4. Honest: no invented statistics, studies, quotes, case studies, customers or personal anecdotes. Product claims come only from the verified facts. No guaranteed results. Say what depends and what can go wrong.
5. Useful without the product: the article stands on its own; the product appears at most once, briefly.
6. Structure: 4 to 6 sections whose headings are plain and specific (not all phrased the same way), then the Questions section.
7. Internal links: at least one link to a relevant existing Journal post, exact href, with natural anchor text.
8. Fresh angle: it must not repeat an existing post, and it should answer a question people are asking now when the current interest notes below fit.
9. No dashes of any kind as punctuation; use commas, periods or colons.`;

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
- Length: 700 to 1100 words.
- End the body (before the final closing line) with <h2>Questions we get</h2> followed by exactly 3 to 4 real questions a reader would ask, each as <p><b>The question?</b> A direct answer of one to three sentences.</p>. These become FAQ markup, so answer plainly and do not repeat the article.

${OWN_FACTS}

${CHECKLIST}`;

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
const FILLER = /\b(in today'?s|delve|unlock(?:ing)?|game[- ]?chang(?:er|ing)|landscape|tapestry|seamless(?:ly)?|leverag(?:e|ing)|elevate|robust|it'?s important to note|in conclusion|navigate the|in the world of|dive into|ever[- ]evolving)\b/i;
function qualityProblems(title: string, dek: string, body: string): string[] {
  const out: string[] = [];
  const txt = plain(body);
  const lead = (body.match(/<p class="lead">([\s\S]*?)<\/p>/) || [])[1] || '';
  if (plain(lead).split(' ').length > 60) out.push('checklist 1: the lead paragraph is over 60 words; give the answer in under 60');
  const ex = (txt.match(/\b(for example|for instance|such as|e\.g\.|sample|template)\b/gi) || []).length;
  if (ex < 2) out.push('checklist 2: needs at least two concrete examples (for example, a sample line, a sample week or a template)');
  const fm = txt.match(FILLER); if (fm) out.push(`checklist 3: contains filler or cliche "${fm[0]}"`);
  const sentences = txt.split(/(?<=[.!?])\s+/).map((x) => x.split(' ').length).filter((n) => n > 1);
  const mean = sentences.reduce((a, b) => a + b, 0) / Math.max(1, sentences.length);
  const sd = Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, sentences.length));
  if (sd < 5.5 || !sentences.some((n) => n <= 6) || !sentences.some((n) => n >= 22)) out.push('checklist 3: sentence lengths are too even; mix very short sentences (under 7 words) with longer ones (over 22 words)');
  if ((txt.match(/\b\w+['\u2019](s|t|re|ve|ll|d|m)\b/g) || []).length < 5) out.push('checklist 3: sound more human, use contractions such as you\'re, it\'s, don\'t');
  const h2 = (body.match(/<h2>/g) || []).length;
  if (h2 < 5 || h2 > 7) out.push(`checklist 6: use 4 to 6 content sections plus the Questions section (found ${h2} headings in total, need 5 to 7)`);
  if (!/<h2>Questions we get<\/h2>/.test(body) || (body.match(/<p><b>[^<]+\?<\/b>/g) || []).length < 3) out.push('checklist: needs <h2>Questions we get</h2> followed by 3 to 4 <p><b>Question?</b> Answer</p> items');
  if (!/<a href="\/blog\//.test(body)) out.push('checklist 7: link to at least one relevant existing Journal post using its exact href');
  const ht = plain(title);
  if (ht.length < 30 || ht.length > 62) out.push('title must be 30 to 62 characters so it is not cut off in search results');
  if (dek.length < 70 || dek.length > 160) out.push('dek must be 70 to 160 characters (it is the search description)');
  const firsts = sentences.length;
  void firsts;
  return out;
}
function problems(title: string, dek: string, body: string): string[] {
  const out: string[] = [];
  const words = plain(body).split(' ').length;
  if (words < 700) out.push(`too short (${words} words, need 700 to 1100)`);
  if (words > 1300) out.push(`too long (${words} words, need 700 to 1100)`);
  if (!/<p class="lead">/.test(body)) out.push('missing <p class="lead"> opener');
  if ((body.match(/<h2>/g) || []).length < 3) out.push('needs at least 3 <h2> sections');
  const all = `${title} ${dek} ${plain(body)}`;
  for (const re of BAD) { const m = all.match(re); if (m) out.push(`contains a forbidden claim pattern: "${m[0]}" (no statistics, studies, dated claims or guarantees)`); }
  out.push(...qualityProblems(title, dek, body));
  return out;
}

const UTM = (slug: string, pos: string) => `?utm_source=blog&utm_medium=${pos}&utm_campaign=${slug.slice(0, 50)}`;
const MARK = '<div class="circle " aria-hidden="true"><span class="glow"></span><img class="ring" src="/assets/logo-mark.svg" alt=""></div>';
const CTA = (cat: string, slug = 'journal') => cat === 'reach'
  ? `<div class="endcta">${MARK}<div><h3>Keep your outreach organised.</h3><p>Reach has a free plan with 150 AI credits to try. Nothing is sent without you.</p></div><a class="btn btn-gold" href="/reach/${UTM(slug, 'endcta')}">Try Reach free</a></div>`
  : `<div class="endcta">${MARK}<div><h3>Turn your brand into a week of posts.</h3><p>The Free plan includes 30 credits a month. No card.</p></div><a class="btn btn-gold" href="/dashboard/${UTM(slug, 'endcta')}">Start free</a></div>`;
// a short signup box before the third section, so readers who never reach the end still see it
const MID = (cat: string, slug: string) => cat === 'reach'
  ? `<div class="callout"><img src="/assets/logo-mark.svg" alt=""><b>Want this handled for your brands?</b><p>Reach finds the right prospects, drafts each message from your brand facts, and keeps every reply in one place. <a href="/reach/${UTM(slug, 'midcta')}">Try Reach free</a>, no card.</p></div>`
  : `<div class="callout"><img src="/assets/logo-mark.svg" alt=""><b>Want this written for your brand?</b><p>Fullmedia Alchemist drafts posts from your own website and brand facts, so nothing is made up. <a href="/dashboard/${UTM(slug, 'midcta')}">Start free</a>, no card.</p></div>`;
function withMid(body: string, cat: string, slug: string) {
  let idx = -1; for (let n = 0; n < 3; n++) { idx = body.indexOf('<h2>', idx + 1); if (idx < 0) return body; }
  return body.slice(0, idx) + MID(cat, slug) + body.slice(idx);
}

const RESEARCH_MODEL = 'claude-haiku-4-5';
const RESEARCH_PROMPT = `Do a quick web check (at most 3 searches) of what small business owners, freelancers, agencies and indie founders are asking about or discussing right now in these areas: social media content for small brands, using AI for social posts without sounding generic, cold outreach and follow ups for small software tools, getting listed in directories and roundups, and brand voice. Reply with 5 to 7 lines, each a specific topic or question that is currently being asked or discussed, in plain words. Topics and questions only: no statistics, no numbers, no quotes, no names of people, no intro or outro.`;
async function research(): Promise<string> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: RESEARCH_MODEL, max_tokens: 900, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], messages: [{ role: 'user', content: RESEARCH_PROMPT }] }),
    });
    if (!r.ok) return '';
    const j = await r.json();
    const text = (j.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n').trim();
    return text.replace(/[—–]/g, ',').slice(0, 1500);
  } catch { return ''; }
}

// A second, independent pass: an editor checks the draft against the checklist and returns pass or the failures.
async function editorReview(title: string, dek: string, body: string, existing: string): Promise<{ pass: boolean; failures: string[] }> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 900,
        system: `You are a strict editor for a small company's blog. Check the article against the checklist and the verified facts. Be skeptical. Fail the article for any of: invented statistics, studies, quotes, anecdotes or customer stories; claims about the product that are not in the verified facts; promised or guaranteed results; generic advice any competitor could have written with nothing specific or usable; padding or repetition; an obviously machine-written tone; duplicating an existing post. Pass it only if it would genuinely help a small business owner and every checklist point is met.\n\n${FACTS}\n\n${OWN_FACTS}\n\n${CHECKLIST}`,
        messages: [{ role: 'user', content: `EXISTING POST TITLES:\n${existing.slice(0, 5000)}\n\nTITLE: ${title}\nDEK: ${dek}\n\nARTICLE:\n${plain(body)}` }],
        tools: [{ name: 'verdict', description: 'Return the editor verdict.', input_schema: { type: 'object', properties: { pass: { type: 'boolean' }, failures: { type: 'array', items: { type: 'string' }, description: 'Each failed point with a specific instruction for fixing it. Empty if pass.' } }, required: ['pass', 'failures'] } }],
        tool_choice: { type: 'tool', name: 'verdict' },
      }),
    });
    if (!r.ok) return { pass: false, failures: [`editor unavailable (${r.status})`] };
    const j = await r.json();
    const v = j.content?.find((c: { type: string }) => c.type === 'tool_use')?.input;
    if (!v) return { pass: false, failures: ['editor returned nothing'] };
    return { pass: !!v.pass && !(v.failures || []).length, failures: (v.failures || []).map((x: string) => 'editor: ' + String(x)) };
  } catch { return { pass: false, failures: ['editor failed to run'] }; }
}

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
            title: { type: 'string', description: 'The headline, 30 to 62 characters. Wrap ONE short phrase of 2 to 5 words in <em></em> for emphasis. No dashes.' },
            dek: { type: 'string', description: 'One sentence summary, 70 to 160 characters; it is the search result description.' },
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

  const trend = body.noresearch ? '' : await research();
  const customTopic = typeof body.topic === 'string' && body.topic.trim();
  const trendLed = !customTopic && !!trend && (made % 2 === 1 || !topic);
  const trendBlock = trend ? `\n\nCURRENT INTEREST (a quick web check just now; use it only to pick or sharpen the angle and the questions you answer; never quote it, cite it or state any number from it):\n${trend}` : '';
  const brief = trendLed
    ? `Choose ONE topic from the CURRENT INTEREST list below that a small brand, agency or founder would search for AND that clearly fits what Fullmedia Alchemist helps with (social posts from your own brand facts, or Reach outreach). Make it clearly different from every existing post below. Prefer a how-to, checklist or decision guide.${trendBlock}`
    : topic
    ? `TOPIC: ${topic.brief}\nSuggested category: ${topic.cat}.${trendBlock}`
    : `Choose a NEW topic that fits small brands, agencies, creators or community managers and that is clearly different from every existing post below. Prefer a how-to or checklist that people search for.${trendBlock}`;
  const baseUser = `${brief}\n\nEXISTING JOURNAL POSTS (do not repeat them; you may link to up to 3 of them where it helps the reader, using the exact href):\n${linkList}\n\nWrite the article now.`;

  let feedback = '';
  let art: Awaited<ReturnType<typeof callClaude>> | null = null; let issues: string[] = [];
  let lastDraft: Awaited<ReturnType<typeof callClaude>> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await callClaude(baseUser + feedback);
    if ('error' in r) { issues = [r.error]; continue; }
    const cleaned = sanitize(r.body_html, hrefs);
    const title = noDashes(String(r.title || '')).replace(/<(?!\/?em>)[^>]*>/g, '').slice(0, 140);
    const dek = noDashes(String(r.dek || '')).replace(/<[^>]+>/g, '').trim().slice(0, 220);
    issues = problems(title, dek, cleaned);
    if (!title) issues.push('missing title');
    if (!issues.length) {
      const review = await editorReview(title, dek, cleaned, existing);
      if (review.pass) { art = { ...r, title, dek, body_html: cleaned }; break; }
      issues = review.failures;
    }
    lastDraft = { ...r, title, dek, body_html: cleaned };
    feedback = `\n\nYour previous draft was rejected for: ${issues.join('; ')}. Rewrite the whole article and fix every point.`;
  }
  if (!art || 'error' in art) {
    // Never publish a draft that missed the checklist: keep the last one as a draft for a person to look at.
    if (lastDraft && !('error' in lastDraft)) {
      const dslug = (slugify(lastDraft.slug || lastDraft.title) || 'draft-' + today) + '-draft';
      const dcat = lastDraft.cat === 'reach' ? 'reach' : 'playbook';
      await db.from('journal_posts').insert({ slug: dslug, title: lastDraft.title, dek: lastDraft.dek, tag: 'Playbook', cat: dcat, body: withMid(lastDraft.body_html, dcat, dslug) + CTA(dcat, dslug), read_label: '5 min read', topic_key: 'draft-' + dslug, published_at: today, status: 'draft', model: MODEL });
    }
    return json({ error: 'no draft passed the quality checklist; nothing was published', issues }, 502);
  }

  let slug = slugify(art.slug || art.title) || 'journal-post-' + today;
  const taken = new Set((rows || []).map((r) => r.slug).concat(STATIC_POSTS.map((p) => p.slug)));
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
  const cat = art.cat === 'reach' ? 'reach' : 'playbook';
  const row = {
    slug, title: art.title, dek: art.dek, tag: ['Playbook', 'Reach', 'Guide'].includes(art.tag) ? art.tag : 'Playbook', cat,
    body: withMid(art.body_html, cat, slug) + CTA(cat, slug), read_label: `${Math.min(8, Math.max(3, Number(art.read_minutes) || 5))} min read`,
    topic_key: trendLed ? 'trend-' + slug : topic ? topic.key : 'free-' + slug, published_at: today, status: 'published', model: MODEL,
  };
  const { error: e1 } = await db.from('journal_posts').insert(row);
  if (e1) return json({ error: 'insert failed: ' + e1.message }, 500);
  return json({ ok: true, trendLed, researched: !!trend, slug, title: plain(art.title), url: `https://www.fullmediaalchemist.com/blog/${slug}/` });
});

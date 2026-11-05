// Sensitive-topic rules (2026-11-01). Brad: "for any sensitive topics make sure the content and hashtags
// are appropriate for each platform. Cannabis can only be educational ... similar with other sensitive topics."
//
// What this does for every batch the writer makes:
//   1. detectSensitive: looks at the brand profile, campaign and briefs and names the sensitive topics.
//   2. rulesBlock: puts the rules for those topics (and for the platforms being posted to) into the writer's prompt.
//   3. checkCompliance: after writing, finds posts that break them (selling words, medical claims, pictures of use,
//      risky hashtags). The writer is asked to rewrite those posts.
//   4. applyCompliance: last guard. Removes risky hashtags, drops any sentence that still breaks a rule, and adds the
//      short age or advice line the topic needs.
// The rules are written for the strictest common ground across platforms and are a safety net, not legal advice.
// Platform policies change: RULES_DATE says when they were last reviewed.
export const RULES_DATE = '2026-11-01';

type Cat = {
  label: string;
  find: RegExp;
  core: string[];
  plat: Record<string, string>;
  promo?: RegExp;      // words a post must not use
  scene?: RegExp;      // things a picture idea must not show
  tag?: RegExp;        // hashtags to remove
  disclaimer?: string; // short line added to the caption
  disclaimerSeen?: RegExp;
};

const SELL = /\b(shop now|buy now|order (now|online|today)|buy (our|your|some|it)|on sale|for sale|sale ends|\d+ ?% off|discount|promo code|coupon|free (gram|sample|shipping)|delivery|pick-?up|menu|now available|in stock|restock|stock up|get (yours|it) (now|today))\b/i;
const MEDICAL = /\b(cures?|miracle cure|heals?|reverses?|treats? (anxiety|depression|cancer|diabetes|pain|insomnia|ptsd|epilepsy|adhd|covid|disease|illness)|relieves? (pain|anxiety)|prevents? (cancer|disease|covid|diabetes)|guaranteed results?|lose \d+ ?(lbs|pounds|kg)|burns? fat|detox(es|ify)?)\b/i;
const USE_SCENE = /\b(smok\w*|vap(e|es|ed|ing)|puff\w*|exhal\w*|inhal\w*|joint|blunt|bong|pipe|lighter|toking|dab\w*|rolling|gumm(y|ies)|brownie|edible\w*|stoned|lit up|cloud of smoke|hookah|child\w*|kid|kids|teen\w*|minor\w*)\b/i;

const CATS: Record<string, Cat> = {
  cannabis: {
    label: 'cannabis, CBD or hemp',
    find: /\b(cannabis|marijuana|cannabinoids?|thc|cbd|cbn|cbg|hemp|dispensar(y|ies)|ganja|pre-?rolls?|kush|sativa|indica)\b/i,
    core: [
      'EDUCATIONAL OR NEWS ONLY. Teach, explain, report or discuss policy, science, history, culture or safety. Never sell or promote.',
      'Never: prices, deals, discounts, menus, delivery, "shop", "order", "buy", "available at", promo codes, where to get it, or any call to action to buy.',
      'Never show or encourage using it: no smoking, vaping, eating, "getting high", paraphernalia, or glamour of use. No slang for use (420, stoner, blaze, dab).',
      'Nothing that could appeal to children or teens: no cartoon or candy-like treatment of the product, no kids, no school settings. A mascot character may appear but must never use or hold the product.',
      'No medical claims: never say it treats, cures, relieves or prevents anything. Say "research suggests" only for something the brief states, and never give medical advice.',
      'Do not say it is legal "everywhere". Laws differ by place; say "where legal" when needed.',
    ],
    plat: {
      instagram: 'Instagram: educational, news and advocacy posts are fine. Posts that promote sale or use, show prices, or tell people to buy get removed.',
      facebook: 'Facebook: educational and news content, legalization and policy talk are fine. Direct promotion or sale of cannabis products is not allowed.',
      tiktok: 'TikTok: education only. No promoting or glorifying drug use, no paraphernalia, no explicit references to using it, and no unpaid product promotion.',
      x: 'X: informational only. Do not promote or encourage use, and do not sell.',
      youtube: 'YouTube: educational, documentary and scientific context is allowed. Never promote buying, never link to places that sell it, never show use as appealing.',
      linkedin: 'LinkedIn: industry news, research and policy only, written professionally. No promotion of sale or use.',
      pinterest: 'Pinterest: informational content only. No product sales, no therapeutic claims.',
      reddit: 'Reddit: no promotion or sales; share information the way a knowledgeable member would.',
    },
    promo: new RegExp(SELL.source + '|\\b(dispensary near|(new )?strain drop|limited drop)\\b|\\b(get high|getting high|stay high|stoned|blaze( it)?|smoke (weed|up|a)|toke|puffs?|dabs?|bong|420|stoner|munchies|light up|spark up)\\b|' + MEDICAL.source, 'i'),
    scene: USE_SCENE,
    tag: /(420|weed|stoner|stoned|kush|ganja|dank|blaze|dispens|shop|buy|sale|deal|discount|coupon|bong|dab|joint|spliff|blunt|pothead|highlife|munchies|edible|smoke|toke|puff|vapelife|delivery)/i,
    disclaimer: 'For adults 21+ where legal. Educational only, not medical advice.',
    disclaimerSeen: /21\+|educational only|not medical advice/i,
  },
  vape: {
    label: 'vaping, nicotine or tobacco',
    find: /\b(vape|vapes|vaping|vaporizers?|e-?cig(arette)?s?|e-?liquids?|e-?juice|nicotine|tobacco|cigar(s|ette)?s?|hookah|juul)\b/i,
    core: [
      'Adults only. Do not promote buying or using nicotine, tobacco or vapes. Education, safety, news and product-care information only.',
      'Never: prices, deals, discounts, "shop", "order", "buy", flavours as a selling point, or any call to action to buy.',
      'Never show or glamorise use. Nothing that appeals to minors: no cartoon styling, no kids, no school settings.',
      'No health claims such as "safer", "healthier" or "helps you quit" unless a brief states it and says where it comes from.',
    ],
    plat: {
      instagram: 'Instagram and Facebook: promotion of vapes and tobacco is not allowed. Keep it informational.',
      facebook: 'Facebook: promotion of vapes and tobacco is not allowed. Keep it informational.',
      tiktok: 'TikTok: do not promote or show use of nicotine or vape products. Education only.',
      x: 'X: informational only, no promotion or sale.',
      youtube: 'YouTube: content promoting a product with nicotine is not allowed. Education and review of facts only.',
      linkedin: 'LinkedIn: industry and regulation news only, no promotion.',
      pinterest: 'Pinterest: no promotion of tobacco or vape products.',
    },
    promo: new RegExp(SELL.source + '|\\b(cloud ?chas\\w*|nic hit|vape life|sweet flavou?rs?)\\b', 'i'),
    scene: USE_SCENE,
    tag: /(vapelife|vapecommunity|vapefam|vapeshop|vapestagram|cloudchas|ejuice|eliquid|juul|puffbar|shop|buy|sale|deal|discount|coupon|delivery)/i,
    disclaimer: 'For adults 21+ only.',
    disclaimerSeen: /21\+|adults only|18\+/i,
  },
  alcohol: {
    label: 'alcohol or nightlife',
    find: /\b(alcohol(ic)?|beer|wine(ry|ries|s)?|whisk(e)?y|vodka|tequila|bourbon|cocktails?|brewery|distillery|liquor|hard seltzer|nightlife|nightclubs?)\b/i,
    core: [
      'Adults 21+ only. Nothing that appeals to minors, and no minors anywhere in the content.',
      'Never encourage heavy or fast drinking, getting drunk, drinking and driving, or drinking to cope, win or perform. No health or wellness claims about alcohol.',
      'Keep it about the place, the craft, the people or the event, with a responsible tone.',
    ],
    plat: {
      instagram: 'Instagram and Facebook: alcohol content must be aimed at adults of legal drinking age and must not suggest heavy drinking.',
      facebook: 'Facebook: alcohol content must be aimed at adults of legal drinking age and must not suggest heavy drinking.',
      tiktok: 'TikTok: no promotion that targets minors; keep to responsible, age-appropriate content and do not show excessive drinking.',
      x: 'X: adults only, responsible tone.',
      youtube: 'YouTube: no content showing minors with alcohol or promoting irresponsible drinking.',
      linkedin: 'LinkedIn: professional tone, trade or event focus.',
    },
    promo: /\b(get (drunk|wasted|hammered|smashed|plastered)|chug\w*|binge\w*|pound(ing)? (shots|drinks)|drink (up|all night)|hangover cure|drink and drive|liquid courage)\b/i,
    scene: /\b(child\w*|kid|kids|teen\w*|minor\w*|driving|behind the wheel|passed out)\b/i,
    tag: /(drunk|wasted|hammered|alcoholic|boozing|blackout|getlit)/i,
    disclaimer: 'Please drink responsibly. 21+.',
    disclaimerSeen: /responsibl|21\+|legal drinking age/i,
  },
  gambling: {
    label: 'gambling or betting',
    find: /\b(gambl\w*|casinos?|sportsbooks?|betting|poker|slots|lottery|sweepstakes|wager\w*|parlay)\b/i,
    core: [
      'Adults only (18+ or 21+ depending on place). No guaranteed wins, no "easy money", no "risk-free", no claims that skill or a system beats the house.',
      'Never target minors or people in financial trouble. Gambling is entertainment, never a way to make money or fix debts.',
      'Do not promise bonuses or odds the brief does not state exactly.',
    ],
    plat: {
      instagram: 'Instagram and Facebook: gambling promotion needs the right licences and age targeting; keep claims modest and adult-only.',
      facebook: 'Facebook: gambling promotion needs the right licences and age targeting; keep claims modest and adult-only.',
      tiktok: 'TikTok: promoting gambling is restricted. Keep it to entertainment and information, never encouragement to bet.',
      x: 'X: adults only, no guarantees, follow local licensing.',
      youtube: 'YouTube: gambling content cannot send people to unlicensed sites or promise winnings.',
    },
    promo: /\b(guaranteed|sure (thing|bet|win)|can'?t lose|risk-?free|easy money|get rich|free money|never lose|win big every)\b/i,
    tag: /(sureshot|guaranteed|easymoney|getrich|winbig|fixedmatch|lockoftheday)/i,
    disclaimer: '21+. Please gamble responsibly.',
    disclaimerSeen: /gambl\w* responsibl|21\+|18\+|responsible gambling/i,
  },
  crypto: {
    label: 'crypto, trading or investing',
    find: /\b(crypto\w*|bitcoin|ethereum|altcoins?|memecoins?|defi|nfts?|web3|forex|day trad\w*|airdrops?|investing|investments?|trading signals?)\b/i,
    core: [
      'Information and education only. Never promise or imply returns. No "guaranteed", "100x", "get rich", "risk-free" or "can\'t lose".',
      'Never tell people to buy, sell or hold a named asset, and never create pressure or fear of missing out.',
      'Say plainly that prices can fall and that this is not financial advice.',
    ],
    plat: {
      instagram: 'Instagram and Facebook: crypto and financial promotions are restricted and need approval; keep it educational with no return claims.',
      facebook: 'Facebook: crypto and financial promotions are restricted and need approval; keep it educational with no return claims.',
      tiktok: 'TikTok: no financial advice and no promotion of returns or specific assets.',
      x: 'X: no misleading claims of returns, no pump-style language.',
      linkedin: 'LinkedIn: professional, factual, no promises of returns.',
      youtube: 'YouTube: no promises of returns; label opinions as opinions.',
    },
    promo: /\b(guaranteed|100x|1000x|10x your|get rich|risk-?free|can'?t lose|to the moon|moon ?shot|don'?t miss (out|this)|last chance to buy|buy now|passive income guaranteed|double your|triple your)\b/i,
    tag: /(100x|1000x|moonshot|tothemoon|getrich|pumpit|shill|hiddengem|passiveincome|financialfreedom)/i,
    disclaimer: 'Not financial advice.',
    disclaimerSeen: /not financial advice|educational/i,
  },
  health: {
    label: 'supplements, weight loss or medical products',
    find: /\b(supplements?|weight[- ]loss|diet pills?|detox|nutraceuticals?|prescriptions?|fat burn\w*|testosterone|peptides?|biohack\w*)\b/i,
    core: [
      'Never say a product cures, treats, prevents or reverses any disease or condition. Never promise results or weight loss amounts.',
      'No before-and-after claims, no body shaming, no "miracle" language. Use only benefits a brief states, worded as general wellness support.',
      'Say it is not medical advice and suggest asking a doctor where it fits.',
    ],
    plat: {
      instagram: 'Instagram and Facebook: no before-and-after weight loss, no unrealistic results, no health claims that cannot be backed up.',
      facebook: 'Facebook: no before-and-after weight loss, no unrealistic results, no health claims that cannot be backed up.',
      tiktok: 'TikTok: no medical or weight loss claims, no promotion of unproven remedies.',
      x: 'X: no false or misleading health claims.',
      youtube: 'YouTube: no medical misinformation; keep claims general and sourced.',
    },
    promo: MEDICAL,
    tag: /(miracle|detox|fatburn|burnfat|cleanse|cureall)/i,
    disclaimer: 'Not medical advice.',
    disclaimerSeen: /not medical advice|consult/i,
  },
  weapons: {
    label: 'firearms or weapons',
    find: /\b(firearms?|ammunition|ammo|rifles?|pistols?|handguns?|suppressors?)\b/i,
    core: [
      'Safety, law, sport and education only. Never sell, trade or arrange sales, and never glamorise violence or threaten anyone.',
      'No "no background check", "untraceable" or similar. No minors handling weapons.',
    ],
    plat: {
      instagram: 'Instagram and Facebook: sale of firearms and ammunition through posts is not allowed.',
      facebook: 'Facebook: sale of firearms and ammunition through posts is not allowed.',
      tiktok: 'TikTok: no promotion or sale of weapons.',
      youtube: 'YouTube: no content that shows how to make weapons or sells them.',
    },
    promo: new RegExp(SELL.source + '|\\b(no background check|untraceable|ghost gun)\\b', 'i'),
    scene: /\b(child\w*|kid|kids|teen\w*|minor\w*|aiming at (a )?(person|people|crowd))\b/i,
    tag: /(nobackground|untraceable|ghostgun|shop|buy|sale|deal)/i,
  },
  adult: {
    label: 'adult products or entertainment',
    find: /\b(adult (content|toys|entertainment)|sex toys?|lingerie|onlyfans|escorts?|strip club|erotic|nsfw|xxx)\b/i,
    core: [
      'Keep everything non-explicit: no nudity, no sexual acts, no sexualised poses, and nothing that could involve a minor.',
      'Adults 18+ only. Focus on products, wellbeing, humour or information.',
    ],
    plat: {
      instagram: 'Instagram and Facebook: no nudity or sexual content; suggestive promotion of adult products is restricted.',
      facebook: 'Facebook: no nudity or sexual content; suggestive promotion of adult products is restricted.',
      tiktok: 'TikTok: no sexual content or nudity; very strict, keep it clean.',
      x: 'X: mark sensitive media where needed and keep it non-explicit.',
      youtube: 'YouTube: no sexually explicit content.',
      linkedin: 'LinkedIn: not suited to this topic; keep it professional or skip.',
    },
    promo: /\b(nude|naked|explicit|xxx|nsfw|porn\w*|hookup|escort)\b/i,
    scene: /\b(nude|naked|topless|child\w*|kid|kids|teen\w*|minor\w*)\b/i,
    tag: /(nsfw|xxx|nude|porn|hookup|onlyfans)/i,
    disclaimer: '18+ only.',
    disclaimerSeen: /18\+|21\+/i,
  },
};

const PLAT_KEYS: [string, RegExp][] = [
  ['instagram', /instagram/i], ['facebook', /facebook/i], ['tiktok', /tiktok/i], ['x', /^(x|twitter|x \(twitter\))$/i],
  ['youtube', /youtube/i], ['linkedin', /linkedin/i], ['pinterest', /pinterest/i], ['reddit', /reddit/i],
];
const platKeys = (platforms: string[]) => {
  const out: string[] = [];
  for (const p of platforms || []) for (const [k, re] of PLAT_KEYS) if (re.test(String(p).trim()) && !out.includes(k)) out.push(k);
  return out;
};

// Names the sensitive topics found in the brand, the campaign and the briefs.
export function detectSensitive(parts: unknown[]): string[] {
  const text = parts.map((x) => (x == null ? '' : typeof x === 'string' ? x : Array.isArray(x) ? x.join(' ') : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' \n ').slice(0, 60000);
  const found: string[] = [];
  for (const [k, c] of Object.entries(CATS)) if (c.find.test(text)) found.push(k);
  if (/vap(e|or)/i.test(String(parts[0] || '')) && !found.includes('vape')) found.push('vape');
  return found;
}

export function rulesBlock(cats: string[], platforms: string[]): string {
  if (!cats.length) return '';
  const pk = platKeys(platforms);
  const lines: string[] = [
    `SENSITIVE-TOPIC RULES (reviewed ${RULES_DATE}). These topics apply to this batch: ${cats.map((c) => CATS[c].label).join('; ')}.`,
    'These rules come first. They win over the tone, the owner\'s wishes, the briefs and anything else above. If a brief asks for something here, write the compliant version and say nothing about it. Write every post so it is safe on ALL the target platforms, then apply the platform notes.',
  ];
  for (const c of cats) {
    lines.push(`${CATS[c].label.toUpperCase()}:`);
    CATS[c].core.forEach((r) => lines.push(`- ${r}`));
    const pl = (pk.length ? pk : Object.keys(CATS[c].plat)).filter((k) => CATS[c].plat[k]);
    pl.forEach((k) => lines.push(`- ${CATS[c].plat[k]}`));
  }
  lines.push('HASHTAGS for these topics: choose educational, informational, news or community-safe tags (for example about education, science, policy, safety or the place). Never use slang for use, promotional tags (shop, buy, sale, deal), risky-return tags, or tags that platforms restrict or hide. Fewer, safer tags beat many risky ones.');
  lines.push('PICTURES for these topics: no one using, holding or lighting the product, no minors, no glamour of use, no explicit or violent scenes, no cash, winnings or before-and-after bodies. Show the place, the idea, a diagram, or the mascot doing something harmless.');
  return lines.join('\n');
}

const textFields = ['post_copy', 'cta_text', 'closing_footer', 'headline_lines', 'fact_lines', 'detail_headline_lines', 'detail_fact_lines', 'more_fact_lines', 'more_label', 'detail_label', 'angle', 'post_idea'];
const sceneFields = ['character_action', 'detail_scene_action', 'more_scene_action', 'closing_scene_action', 'picture_subject', 'detail_picture_subject', 'more_picture_subject', 'closing_picture_subject'];
const asText = (v: unknown) => (Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v));
const tagsOf = (s: unknown) => String(s || '').split(/[\s,]+/).filter((x) => x.startsWith('#'));

// Problems found in a draft batch. Each line starts with [compliance ...] so the writer can be asked to fix it.
export function checkCompliance(posts: any[], cats: string[], platforms: string[]): string[] {
  const out: string[] = [];
  if (!cats.length || !Array.isArray(posts)) return out;
  posts.forEach((p, i) => {
    for (const c of cats) {
      const d = CATS[c];
      if (d.promo) {
        for (const f of textFields) { const m = asText(p?.[f]).match(d.promo); if (m) out.push(`post ${i + 1} [compliance: ${c}] ${f} says "${m[0]}", which is selling, a claim or a use reference. Rewrite it as plain education or information.`); }
      }
      if (d.scene) {
        for (const f of sceneFields) { const m = asText(p?.[f]).match(d.scene); if (m) out.push(`post ${i + 1} [compliance: ${c}] ${f} shows "${m[0]}". Pictures must not show use, minors or anything the rules forbid. Choose a harmless scene.`); }
      }
      if (d.tag) {
        const bad = [...tagsOf(p?.general_hashtags), ...tagsOf(p?.ig_hashtags), ...tagsOf(p?.tiktok_hashtags)].filter((t) => d.tag!.test(t));
        if (bad.length) out.push(`post ${i + 1} [compliance: ${c}] hashtags ${[...new Set(bad)].slice(0, 4).join(' ')} are promotional or restricted. Use educational, safe tags.`);
      }
    }
  });
  return out;
}

// Last guard. Always runs on the final posts.
export function applyCompliance(posts: any[], cats: string[]): any[] {
  if (!cats.length || !Array.isArray(posts)) return posts;
  const tagBad = (t: string) => cats.some((c) => CATS[c].tag && CATS[c].tag!.test(t));
  const hit = (s: string) => cats.some((c) => CATS[c].promo && CATS[c].promo!.test(s));
  const disclaimers: string[] = [];
  for (const c of cats) { const d = CATS[c].disclaimer; if (d && !disclaimers.includes(d)) disclaimers.push(d); }
  posts.forEach((p) => {
    if (!p || typeof p !== 'object') return;
    for (const k of ['general_hashtags', 'ig_hashtags', 'tiktok_hashtags']) if (typeof p[k] === 'string') p[k] = tagsOf(p[k]).filter((t) => !tagBad(t)).join(' ');
    if (Array.isArray(p.hashtag_candidates)) p.hashtag_candidates = p.hashtag_candidates.filter((h: any) => !tagBad(String(h?.tag ?? h ?? '')));
    if (typeof p.post_copy === 'string') {
      const sentences = p.post_copy.split(/(?<=[.!?])\s+/);
      const kept = sentences.filter((s: string) => !hit(s));
      if (kept.length && kept.length < sentences.length && kept.join(" ").length >= 15) p.post_copy = kept.join(' ');
      const add = disclaimers.filter((d) => !cats.some((c) => CATS[c].disclaimer === d && CATS[c].disclaimerSeen && CATS[c].disclaimerSeen!.test(p.post_copy)));
      if (add.length) p.post_copy = `${p.post_copy.trim()} ${add.join(' ')}`;
    }
  });
  return posts;
}

export function complianceNote(cats: string[], platforms: string[]): string {
  if (!cats.length) return '';
  const pk = platKeys(platforms);
  return `Sensitive topic: ${cats.map((c) => CATS[c].label).join('; ')}. Written to the rules reviewed ${RULES_DATE}${pk.length ? ` for ${pk.join(', ')}` : ''}: no selling, no medical or return claims, no use shown, safer hashtags, age or advice line added. Platform rules change, so check each platform's current rules before posting.`;
}

// Cleans one piece of text (a text post, a thread post, a poll lead-in) the same way as applyCompliance, and keeps it within `max` characters.
export function cleanText(text: string, cats: string[], opt: { disclaimer?: boolean; max?: number } = {}): string {
  let t = String(text ?? '');
  if (!cats.length) return t;
  const tagBad = (x: string) => cats.some((c) => CATS[c].tag && CATS[c].tag!.test(x));
  const hit = (x: string) => cats.some((c) => CATS[c].promo && CATS[c].promo!.test(x));
  t = t.replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, (m, sp, tag) => (tagBad(tag) ? sp : m)).replace(/[ \t]+\n/g, '\n').trim();
  let body = t.split(/(?<=[.!?])\s+/);
  const kept = body.filter((s) => !hit(s));
  if (kept.length && kept.length < body.length && kept.join(' ').length >= 15) body = kept;
  const add: string[] = [];
  if (opt.disclaimer) {
    for (const c of cats) {
      const d = CATS[c].disclaimer;
      if (d && !add.includes(d) && !(CATS[c].disclaimerSeen && CATS[c].disclaimerSeen!.test(body.join(' ')))) add.push(d);
    }
  }
  const tail = add.length ? ' ' + add.join(' ') : '';
  const max = opt.max && opt.max > 0 ? opt.max : 100000;
  while ((body.join(' ') + tail).length > max && body.length > 1) body.pop();
  let out = body.join(' ') + tail;
  if (out.length > max) out = body.join(' ').slice(0, Math.max(0, max - tail.length)).trim() + tail;
  return out.slice(0, max);
}

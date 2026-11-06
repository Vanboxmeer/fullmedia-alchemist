// Short-link redirect for brands' OWN domains (e.g. go.theirbrand.com/ab3k9xz).
// Routed by vercel.json: any host that is not ours -> /api/l?code=<code>. Counts one visit per human click
// (a daily total, not a row per click), never counts bots or link-preview fetches, stops counting past the plan's monthly cap
// (still redirects, from the CDN cache), and always redirects.
const SB_URL = 'https://tpqvvrdglnsdljdpzwfl.supabase.co';
// Public anon key: it can only call fma_link_resolve, which returns a destination and bumps a counter.
const KEY = process.env.JOURNAL_SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcXZ2cmRnbG5zZGxqZHB6d2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0OTEwMTAsImV4cCI6MjA5NzA2NzAxMH0.gxr0vEWFBwPp8ErX41rHNFV0aMU_lhiceFhY64iA7Ko';
const BOT = /bot|crawl|spider|preview|facebookexternalhit|slurp|embedly|whatsapp|telegram|discord|skype|pinterest|headless|curl\/|wget|python|axios|go-http|java\/|monitor|uptime|scan/i;

function page(res, code, text) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + text + '</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:90vh;color:#444"><p>' + text + '</p>');
}

module.exports = async (req, res) => {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  const code = String((req.query && req.query.code) || '').trim();
  if (!host || !/^[a-z0-9_-]{0,40}$/i.test(code)) return page(res, 404, 'This link does not exist.');
  const bot = req.method === 'HEAD' || BOT.test(String(req.headers['user-agent'] || ''));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(SB_URL + '/rest/v1/rpc/fma_link_resolve', {
      method: 'POST', signal: ctl.signal,
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_host: host, p_code: code, p_bot: bot }),
    });
    const out = r.ok ? await r.json() : null;
    const target = out && out.url;
    if (typeof target === 'string' && /^https?:\/\//i.test(target)) {
      res.statusCode = 302;
      res.setHeader('Location', target);
      // counted visits are never cached; everything else (bots, past the monthly cap) can be, so a viral link costs almost nothing
      res.setHeader('Cache-Control', out.counted ? 'no-store' : 'public, s-maxage=3600, stale-while-revalidate=86400');
      res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
      return res.end();
    }
    return page(res, 404, 'This link does not exist.');
  } catch (_e) {
    return page(res, 503, 'This link is busy. Try again in a moment.');
  } finally { clearTimeout(t); }
};

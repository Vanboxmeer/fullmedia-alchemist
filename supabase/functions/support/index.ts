import { createClient } from 'jsr:@supabase/supabase-js@2';

// ── support (2026-10-09; reply + Claude hand-off 2026-10-31) ─────────────
// Problem reports land in cc_support_tickets and are emailed to the team.
// Actions:
//   create         signed-in user files a report (rate limited: 10 a day)
//   mine           the caller's own reports, status and our reply
//   admin_list     admins: reports, newest first
//   admin_update   admins: status, private note, reply to the reporter, Claude hand-off state
//   admin_chats    admins: saved Alchemist chats (for reviewing reports)
//   message        signed-in user adds a message to one of THEIR reports (reopens it, emails the team)
//   notify         server only (x-cc-key): email the team about a ticket
//   ticket_update  server only (x-cc-key): same as admin_update (used when Claude closes a report)
// Emails to the team go only to the fixed address below. Emails to a reporter go only to the
// address stored on THEIR ticket, never to an address taken from the request.
const ADMIN_EMAILS = ['brad@unitedpress.media'];
// Admin = the admin email, or an account whose verified Google identity is the admin email (Brad signs in with Google).
// deno-lint-ignore no-explicit-any
function isAdminUser(user: any): boolean {
  if (ADMIN_EMAILS.includes(String(user?.email || '').toLowerCase())) return true;
  // deno-lint-ignore no-explicit-any
  return (user?.identities || []).some((i: any) => i?.provider === 'google' && i?.identity_data?.email_verified === true && ADMIN_EMAILS.includes(String(i?.identity_data?.email || '').toLowerCase()));
}
const TEAM_INBOX = 'brad@unitedpress.media';
const CC_KEY = (Deno.env.get('CC_KEY') || '').trim();
const KINDS = ['bug', 'billing', 'feature', 'question', 'content', 'other'];
const KIND_LABEL: Record<string, string> = { bug: 'Something broken', billing: 'Billing or credits', feature: 'Idea or request', question: 'Question', content: 'Post or content issue', other: 'Other' };
const STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix'];
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'We are working on it', resolved: 'Resolved', wont_fix: 'Closed' };
const CLAUDE_STATES = ['', 'queued', 'working', 'done'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-cc-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const HIDDEN = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(9) + String.fromCharCode(11) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + String.fromCharCode(0x200B) + '-' + String.fromCharCode(0x200F) + String.fromCharCode(0x202A) + '-' + String.fromCharCode(0x202E) + String.fromCharCode(0x2066) + '-' + String.fromCharCode(0x2069) + String.fromCharCode(0xFEFF) + ']', 'g');
const clean = (v: unknown, cap: number) => (typeof v === 'string' ? v.replace(HIDDEN, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, cap) : '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendMail(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const alKey = (Deno.env.get('ALCHEMIST_RESEND_API_KEY') || '').trim();
  const sqKey = (Deno.env.get('RESEND_API_KEY') || '').trim();
  const from = (Deno.env.get('MAIL_FROM') || '').trim() || 'Fullmedia Alchemist <hello@fullmediaalchemist.com>';
  if (!alKey && !sqKey) { console.error('support: no Resend key'); return false; }
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1c2018;white-space:pre-wrap">${esc(text)}</div>`;
  const payload = { to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) };
  const post = (key: string, sender: string) => fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, from: sender }),
  });
  let res = alKey ? await post(alKey, from) : null;
  if (!res || !res.ok) {
    if (res) console.error('support: Alchemist sender failed', res.status, (await res.text()).slice(0, 300));
    if (!sqKey) return false;
    res = await post(sqKey, 'Fullmedia Alchemist <support@spinquest.app>');
  }
  if (!res.ok) { console.error('support: email failed', res.status, (await res.text()).slice(0, 300)); return false; }
  return true;
}

// deno-lint-ignore no-explicit-any
async function notifyTeam(supabase: any, ticketId: string) {
  const { data: t } = await supabase.from('cc_support_tickets').select('*').eq('id', ticketId).maybeSingle();
  if (!t || t.notified) return { ok: true, skipped: true };
  const ctx = t.context && typeof t.context === 'object' ? t.context : {};
  const lines = [
    `Problem #${t.ticket_no} — ${KIND_LABEL[t.kind] || t.kind}`,
    `From: ${t.email || 'unknown'}${t.brand ? ` · Brand: ${t.brand}` : ''} · Via: ${t.source === 'chat' ? 'Alchemist chat' : 'Report a problem form'}`,
    '',
    `Summary: ${t.summary}`,
    t.details ? `\nDetails:\n${t.details}` : '',
    Object.keys(ctx).length ? `\nWhere: ${Object.entries(ctx).map(([k, v]) => `${k}=${String(v).slice(0, 120)}`).join(' · ')}` : '',
    '\nOpen the Admin page to reply, hand it to Claude, or mark it resolved: https://www.fullmediaalchemist.com/admin/',
  ].join('\n');
  const ok = await sendMail(TEAM_INBOX, `[Alchemist] Problem #${t.ticket_no}: ${String(t.summary).replace(/[\r\n]+/g, ' ').slice(0, 90)}`, lines, t.email || undefined);
  if (!ok) return { ok: false };
  await supabase.from('cc_support_tickets').update({ notified: true }).eq('id', ticketId);
  return { ok: true };
}

// One update path for admins and for the server key. Mails the reporter when the status moves or a new reply is written.
// deno-lint-ignore no-explicit-any
async function applyUpdate(supabase: any, body: any) {
  const id = clean(body.id || body.ticket_id, 40);
  const { data: before } = await supabase.from('cc_support_tickets').select('ticket_no, email, summary, status, reply').eq('id', id).maybeSingle();
  if (!before) return { code: 404, error: 'Report not found.' };
  const now = new Date().toISOString();
  const upd: Record<string, unknown> = { updated_at: now };
  if (STATUSES.includes(body.status)) upd.status = body.status;
  if (body.admin_note !== undefined) upd.admin_note = clean(body.admin_note, 2000) || null;
  if (body.reply !== undefined) {
    const r = clean(String(body.reply).replace(/\r/g, ''), 3000) || null;
    upd.reply = r;
    if (r && r !== before.reply) {
      upd.replied_at = now;
      await supabase.from('cc_support_messages').insert({ ticket_id: id, role: body.role === 'claude' ? 'claude' : 'team', body: r });
    }
  }
  if (typeof body.claude === 'string' && CLAUDE_STATES.includes(body.claude)) { upd.claude_state = body.claude; upd.claude_at = now; }
  if (body.claude_note !== undefined) upd.claude_note = clean(String(body.claude_note).replace(/\r/g, ''), 3000) || null;
  const { error } = await supabase.from('cc_support_tickets').update(upd).eq('id', id);
  if (error) return { code: 500, error: 'Could not update that report.' };
  const statusMoved = typeof upd.status === 'string' && upd.status !== before.status && upd.status !== 'open';
  const newReply = !!upd.replied_at;
  let emailed = false;
  if (before.email && body.notify_user !== false && (statusMoved || newReply)) {
    const st = (upd.status as string) || before.status;
    const text = [
      'Hi,', '',
      `An update on your report #${before.ticket_no}: "${String(before.summary).slice(0, 140)}"`,
      `Status: ${STATUS_LABEL[st] || st}`,
      newReply ? `\n${upd.reply}` : '',
      '\nYou can see all your reports any time: open the account menu in Fullmedia Alchemist and choose Report a problem.',
      '', 'Fullmedia Alchemist',
    ].join('\n');
    emailed = await sendMail(before.email, `Update on your problem #${before.ticket_no}`, text);
  }
  return { ok: true, emailed };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 20) || 'create';

    if (CC_KEY && req.headers.get('x-cc-key') === CC_KEY) {
      if (action === 'notify') return json(await notifyTeam(supabase, clean(body.ticket_id, 40)));
      if (action === 'ticket_update') { const r = await applyUpdate(supabase, body); return json(r, r.code || 200); }
      return json({ error: 'unknown server action' }, 400);
    }

    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'not signed in' }, 401);
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user?.email) return json({ error: 'not signed in' }, 401);
    const userId = userData.user.id, email = userData.user.email;
    const isAdmin = isAdminUser(userData.user);

    if (action === 'create') {
      const summary = clean(body.summary, 300);
      if (summary.length < 3) return json({ error: 'Tell us in a few words what went wrong.' }, 400);
      const { data: okQuota, error: qErr } = await supabase.rpc('consume_api_quota', { p_user_id: userId, p_fn: 'support-report', p_daily_limit: 10 });
      if (qErr) return json({ error: 'Could not send that right now. Please try again shortly.' }, 503);
      if (okQuota !== true) return json({ error: 'You’ve sent 10 reports today. We’ll get through them — try again tomorrow.' }, 429);
      const brand = clean(body.brand, 120) || null;
      if (brand && !isAdmin) {
        const { data: grant } = await supabase.from('cc_user_brands').select('brand').eq('user_id', userId).eq('brand', brand).maybeSingle();
        if (!grant) return json({ error: 'You do not have access to this brand.' }, 403);
      }
      const ctxIn = body.context && typeof body.context === 'object' ? body.context as Record<string, unknown> : {};
      const context: Record<string, string> = {};
      for (const k of ['view', 'campaign', 'sku', 'url', 'ua', 'screen', 'plan', 'module']) { const v = clean(ctxIn[k], 300); if (v) context[k] = v; }
      const { data: t, error } = await supabase.from('cc_support_tickets').insert({
        user_id: userId, email, brand, kind: KINDS.includes(body.kind) ? body.kind : 'bug', summary,
        details: clean(String(body.details || '').replace(/\r/g, ''), 5000) || null, context, source: 'form',
      }).select('id, ticket_no').maybeSingle();
      if (error || !t) return json({ error: 'Could not send that report. Please try again.' }, 500);
      await notifyTeam(supabase, t.id).catch(() => {});
      return json({ ok: true, ticket_no: t.ticket_no });
    }

    if (action === 'mine') {
      const { data } = await supabase.from('cc_support_tickets').select('id, ticket_no, created_at, kind, summary, status, brand, reply, replied_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(30);
      const ids = (data || []).map((t: { id?: string }) => t.id).filter(Boolean);
      const { data: msgs } = ids.length ? await supabase.from('cc_support_messages').select('ticket_id, role, body, created_at').in('ticket_id', ids).order('created_at', { ascending: true }) : { data: [] };
      const by: Record<string, unknown[]> = {};
      (msgs || []).forEach((m: { ticket_id: string }) => { (by[m.ticket_id] = by[m.ticket_id] || []).push(m); });
      return json({ ok: true, tickets: (data || []).map((t: { id: string }) => ({ ...t, id: undefined, messages: by[t.id] || [] })) });
    }

    if (action === 'message') {
      const no = Number(body.ticket_no), text = clean(String(body.body || '').replace(/\r/g, ''), 2000);
      if (!Number.isInteger(no) || text.length < 2) return json({ error: 'Write a message first.' }, 400);
      const { data: t } = await supabase.from('cc_support_tickets').select('id, ticket_no, summary, status').eq('user_id', userId).eq('ticket_no', no).maybeSingle();
      if (!t) return json({ error: 'Report not found.' }, 404);
      const { data: okQuota, error: qErr } = await supabase.rpc('consume_api_quota', { p_user_id: userId, p_fn: 'support-message', p_daily_limit: 30 });
      if (qErr) return json({ error: 'Could not send that right now. Please try again shortly.' }, 503);
      if (okQuota !== true) return json({ error: 'That’s a lot of messages today. We’ll reply as soon as we can.' }, 429);
      await supabase.from('cc_support_messages').insert({ ticket_id: t.id, role: 'user', body: text });
      await supabase.from('cc_support_tickets').update({ status: t.status === 'in_progress' ? 'in_progress' : 'open', updated_at: new Date().toISOString() }).eq('id', t.id);
      await sendMail(TEAM_INBOX, `[Alchemist] New message on problem #${t.ticket_no}`, `From: ${email}\nProblem #${t.ticket_no}: ${t.summary}\n\n${text}\n\nReply here: https://www.fullmediaalchemist.com/admin/`, email).catch(() => {});
      return json({ ok: true });
    }

    if (!isAdmin) return json({ error: 'Admins only.' }, 403);

    if (action === 'admin_list') {
      let q = supabase.from('cc_support_tickets').select('id, ticket_no, created_at, updated_at, email, brand, kind, summary, details, context, source, status, admin_note, reply, replied_at, claude_state, claude_note, claude_at').order('created_at', { ascending: false }).limit(200);
      if (STATUSES.includes(body.status)) q = q.eq('status', body.status);
      const { data } = await q;
      const lids = (data || []).map((t: { id: string }) => t.id);
      const { data: tm } = lids.length ? await supabase.from('cc_support_messages').select('ticket_id, role, body, created_at').in('ticket_id', lids).order('created_at', { ascending: true }) : { data: [] };
      const tby: Record<string, unknown[]> = {};
      (tm || []).forEach((m: { ticket_id: string }) => { (tby[m.ticket_id] = tby[m.ticket_id] || []).push(m); });
      (data || []).forEach((t: Record<string, unknown>) => { t.messages = tby[t.id as string] || []; });
      const { count: open } = await supabase.from('cc_support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']);
      return json({ ok: true, tickets: data || [], open: open || 0 });
    }
    if (action === 'admin_update') { const r = await applyUpdate(supabase, body); return json(r, r.code || 200); }
    if (action === 'admin_chats') {
      let q = supabase.from('cc_assist_chats').select('created_at, email, brand, session_id, role, content, ticket_id').order('created_at', { ascending: false }).limit(400);
      if (body.email) q = q.eq('email', clean(body.email, 200));
      if (body.ticket_id) q = q.eq('ticket_id', clean(body.ticket_id, 40));
      const { data } = await q;
      return json({ ok: true, messages: data || [] });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('support error', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});

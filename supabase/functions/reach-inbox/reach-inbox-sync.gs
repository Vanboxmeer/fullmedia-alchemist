/**
 * Reach Inbox Sync (read-only) — runs in YOUR Google account, reads YOUR Gmail, and tells Alchemist Reach
 * only what it found for the contacts you are tracking (who replied, which sends went out, which bounced).
 * Reach never gets access to your mailbox. This script can only READ mail: it asks Google for the read-only Gmail
 * permission, so it cannot send, delete, label, draft or change anything in your mailbox.
 *
 * What leaves your mailbox, per contact: the date, the subject, a short quote (up to 160 characters)
 * and, for replies only, the reply's own text (up to 1,200 characters, earlier quoted messages removed) plus
 * the last few messages before it in that thread (up to 500 characters each) so replies can be answered in context.
 * To stop it at any time: remove the key in Reach → Connections, or delete this script's trigger.
 *
 * Setup: (1) paste this whole file into a new project at script.google.com; (2) in Project Settings tick
 * "Show appsscript.json manifest file in editor", open appsscript.json and paste the manifest Reach shows you
 * (it limits the script to read-only Gmail); (3) press Run on "setup" and approve the permission once.
 * It then checks every hour.
 */
var REACH_URL = "__ENDPOINT__";
var REACH_KEY = "__KEY__";          // keep private — anyone with it can report to your Reach workspace
var BUDGET_MS = 4.5 * 60 * 1000;     // stay under Google's 6-minute limit; the next run continues where this one stopped
var GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me/";

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncReach") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncReach").timeBased().everyHours(1).create();
  PropertiesService.getScriptProperties().deleteProperty("cursor");
  syncReach();
}

function stop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncReach") ScriptApp.deleteTrigger(t);
  });
}

function post_(payload) {
  var res = UrlFetchApp.fetch(REACH_URL, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { "x-reach-key": REACH_KEY }, payload: JSON.stringify(payload)
  });
  var code = res.getResponseCode(), out = {};
  try { out = JSON.parse(res.getContentText()); } catch (e) {}
  if (code !== 200 || !out.ok) throw new Error("Reach said: " + (out.error || ("HTTP " + code)));
  return out;
}

// ---- Gmail, read-only, through Google's Gmail API with this script's own read-only token ----
function gmail_(path, params) {
  var qs = "";
  if (params) qs = "?" + Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
  var res = UrlFetchApp.fetch(GMAIL_API + path + qs, { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error("Gmail said HTTP " + code);
  return JSON.parse(res.getContentText());
}

function b64_(s) {
  try { return Utilities.newBlob(Utilities.base64DecodeWebSafe(String(s || ""))).getDataAsString("UTF-8"); } catch (e) { return ""; }
}
function header_(msg, name) {
  var hs = (msg.payload && msg.payload.headers) || [];
  for (var i = 0; i < hs.length; i++) if (String(hs[i].name).toLowerCase() === name) return String(hs[i].value || "");
  return "";
}
function partText_(part, mime) {
  if (!part) return "";
  if (part.mimeType === mime && part.body && part.body.data) return b64_(part.body.data);
  var ps = part.parts || [];
  for (var i = 0; i < ps.length; i++) { var t = partText_(ps[i], mime); if (t) return t; }
  return "";
}
function plainBody_(msg) {
  var t = partText_(msg.payload, "text/plain");
  if (t) return t;
  var h = partText_(msg.payload, "text/html");
  return h ? h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "";
}
// a Gmail API message -> the small shape the matching code below uses
function norm_(msg) {
  return { id: msg.id, dt: new Date(Number(msg.internalDate || 0)), from: header_(msg, "from"), to: header_(msg, "to"), cc: header_(msg, "cc"), subject: header_(msg, "subject"), body: plainBody_(msg) };
}

function day_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd"); }

function mine_() {
  var set = {};
  try { set[String(gmail_("profile").emailAddress || "").toLowerCase()] = 1; } catch (e) {}
  try { (gmail_("settings/sendAs").sendAs || []).forEach(function (a) { if (a.sendAsEmail) set[String(a.sendAsEmail).toLowerCase()] = 1; }); } catch (e) {}
  return set;
}
function addrs_(s) { return (String(s || "").toLowerCase().match(/[a-z0-9._%+\-']+@[a-z0-9.\-]+\.[a-z]{2,}/g)) || []; }

// our own words only: drop quoted earlier messages and signatures-of-quotes
function ownText_(body) {
  var t = String(body || "").replace(/\r/g, "");
  var cut = t.search(/\n\s*(On .{5,200} wrote:|-{2,}\s*Original Message|From:\s.+\n\s*Sent:)/i);
  if (cut > 0) t = t.slice(0, cut);
  t = t.split("\n").filter(function (l) { return !/^\s*>/.test(l); }).join("\n");
  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function threadsFor_(email, since) {
  var q = "(to:" + email + " OR from:" + email + ") after:" + since.replace(/-/g, "/");
  var list = gmail_("threads", { q: q, maxResults: 4 }).threads || [];
  return list.map(function (th) {
    var full = gmail_("threads/" + th.id, { format: "full" });
    return { id: th.id, msgs: (full.messages || []).map(norm_) };
  });
}

function findFor_(t, since, me, threads) {
  threads = threads || threadsFor_(t.email, since);
  var rep = null, bounce = null, sent = null;
  threads.forEach(function (th) {
    th.msgs.forEach(function (m) {
      var ds = day_(m.dt);
      if (ds < since) return;
      var from = addrs_(m.from);
      var subj = m.subject || "";
      var raw = from.join(" ");
      var fromThem = from.indexOf(t.email) >= 0;
      var isBounce = /mailer-daemon|postmaster/.test(raw);
      var fromMe = from.some(function (a) { return me[a]; });
      if (fromThem && !fromMe) {
        if (/auto(matic)?[\s\-]?reply|out of office|autoreply|undeliverable/i.test(subj)) return;
        if (!rep || m.dt > rep.dt) rep = { dt: m.dt, date: ds, subject: subj, text: ownText_(m.body), thread: th.id, th: th, id: m.id };
      } else if (isBounce) {
        if (String(m.body || "").toLowerCase().indexOf(t.email) >= 0)
          if (!bounce || m.dt > bounce.dt) bounce = { dt: m.dt, date: ds, subject: subj, text: ownText_(m.body), thread: th.id, th: th, id: m.id };
      } else if (fromMe) {
        var to = addrs_(m.to + " " + m.cc);
        if (to.indexOf(t.email) >= 0)
          if (!sent || m.dt > sent.dt) sent = { dt: m.dt, date: ds, subject: subj, text: ownText_(m.body), thread: th.id, th: th, id: m.id };
      }
    });
  });
  var pick = null, type = "";
  if (rep && rep.text.length >= 10) { pick = rep; type = "replied"; }
  else if (bounce) { pick = bounce; type = "bounced"; }
  else if (sent && t.phase === "ready") { pick = sent; type = "sent"; }
  if (!pick) return null;
  var quote = (type === "bounced" ? "Delivery failed for " + t.email : pick.text).replace(/\s+/g, " ").slice(0, 150);
  if (quote.length < 10) quote = ("Message " + (type === "sent" ? "sent to " : "from ") + t.email + " on " + pick.date).slice(0, 150);
  var context = [];
  if (type === "replied") {
    try {
      pick.th.msgs.forEach(function (mm) {
        if (mm.id === pick.id || mm.dt > pick.dt) return;
        var fm = addrs_(mm.from).some(function (a) { return me[a]; });
        var tx = ownText_(mm.body).slice(0, 500);
        if (tx.length >= 5) context.push({ who: fm ? "us" : "them", date: day_(mm.dt), text: tx });
      });
    } catch (e) {}
    context = context.slice(-4);   // the last few messages before their reply, so Reach can answer in context
  }
  return { id: t.id, type: type, date: pick.date, subject: pick.subject.slice(0, 120), quote: quote, replyText: type === "replied" ? pick.text.slice(0, 1200) : "", context: context, threadId: String(pick.thread).slice(0, 60) };
}

function syncReach() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var info = post_({ action: "targets" });
  var targets = info.targets, since = info.since, me = mine_();
  var i = Number(props.getProperty("cursor") || 0);
  if (i >= targets.length) i = 0;
  var findings = [], checked = 0, errs = 0, lastErr = "", total = 0;
  function flush() {
    if (!findings.length && !checked) return;
    post_({ action: "ingest", findings: findings, since: since, checked: checked });
    findings = []; checked = 0;
  }
  for (; i < targets.length; i++) {
    if (Date.now() - started > BUDGET_MS) { flush(); props.setProperty("cursor", String(i)); return; }
    var f = null, failed = false;
    try { f = findFor_(targets[i], since, me); } catch (e) { failed = true; errs++; lastErr = String(e && e.message || e); }  // one bad search never stops the run
    total++;
    if (!failed) checked++;
    if (f) findings.push(f);
    if (findings.length >= 40) flush();
  }
  flush();
  props.deleteProperty("cursor");
  // every contact failed (usually a missing permission): say so instead of reporting a quiet success
  if (total > 0 && errs === total) throw new Error("Could not read Gmail: " + lastErr + ". Check the appsscript.json permissions, then run setup again.");
}

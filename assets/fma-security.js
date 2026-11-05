/* Fullmedia Alchemist: account security, one file for Content, Reach and Admin.
   1. Two-step sign-in gate. If the signed-in person has turned on an authenticator app and this session has not
      passed the code check yet, a full-screen code prompt blocks the page until it does.
   2. "Password & security" sheet (opened from the account menu via window.fmSecurityOpen):
      set or change password, turn two-step sign-in on or off, download my data, sign out everywhere, request deletion.
   3. Password-reset landing: a reset email returns to the dashboard with type=recovery in the link; a tiny script in the
      page head notes that in sessionStorage ("fma_recovery"), and this file then asks for the new password.
   Honest limit: the code check is enforced in the browser. Server functions do not yet require the code-checked level,
   so this protects the screen and the normal use of the app, not a determined person who already holds a stolen session. */
(function () {
  "use strict";
  if (window.__fmSec) return; window.__fmSec = 1;
  var SB = "https://tpqvvrdglnsdljdpzwfl.supabase.co";
  var KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcXZ2cmRnbG5zZGxqZHB6d2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0OTEwMTAsImV4cCI6MjA5NzA2NzAxMH0.gxr0vEWFBwPp8ErX41rHNFV0aMU_lhiceFhY64iA7Ko";
  var MIN_PW = 10;

  function jwt(t) { try { var b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(b + "===".slice((b.length + 3) % 4))); } catch (e) { return null; } }
  function sess() { try { return JSON.parse(localStorage.getItem("ccb-session") || "null"); } catch (e) { return null; } }
  function tok() { var o = sess(), p = o && o.access_token && jwt(o.access_token); return p && p.exp * 1000 > Date.now() + 5000 ? o.access_token : null; }
  function saveSession(j) {
    var o = sess() || {};
    var next = Object.assign({}, o, { access_token: j.access_token, refresh_token: j.refresh_token || o.refresh_token, expires_at: (j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600)) * 1000, email: (j.user && j.user.email) || o.email || "" });
    try { localStorage.setItem("ccb-session", JSON.stringify(next)); } catch (e) {}
  }
  function api(path, opt) {
    opt = opt || {}; var t = opt.token || tok();
    if (!t) return Promise.resolve({ ok: false, status: 401, j: { msg: "Please sign in again." } });
    return fetch(SB + path, { method: opt.method || "GET", headers: { apikey: KEY, Authorization: "Bearer " + t, "content-type": "application/json" }, body: opt.body ? JSON.stringify(opt.body) : undefined })
      .then(function (r) { return r.text().then(function (txt) { var j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (e) {} return { ok: r.ok, status: r.status, j: j, raw: txt }; }); })
      .catch(function () { return { ok: false, status: 0, j: { msg: "Could not reach the server. Check your connection and try again." } }; });
  }
  function why(r, fallback) { var j = r.j || {}; return j.msg || j.message || j.error_description || (typeof j.error === "string" ? j.error : "") || fallback || "That did not work. Please try again."; }
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function isDark() {
    try { var c = (getComputedStyle(document.body).backgroundColor || "").match(/[\d.]+/g); if (c && c.length >= 3 && !(c.length > 3 && +c[3] === 0)) return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 128; } catch (e) {}
    return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }

  var PAL = {
    dark: { panel: "#1c2318", ink: "#ece6d6", muted: "#9aa394", line: "#2e3629", field: "#12170f", gold: "#e8a33d", goldInk: "#241a06", red: "#ff8a7a", ok: "#4fc79a", shade: "rgba(8,10,6,.82)" },
    light: { panel: "#fffaf0", ink: "#231f1a", muted: "#6b6256", line: "#e3dbcb", field: "#ffffff", gold: "#b87408", goldInk: "#fffaf0", red: "#b3261e", ok: "#1d7a52", shade: "rgba(20,17,13,.7)" }
  };
  function css() {
    if (document.getElementById("fsCss")) return;
    var s = document.createElement("style"); s.id = "fsCss";
    s.textContent =
      ".fs-ov{position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:var(--fs-shade);padding:max(16px,env(safe-area-inset-top,0px)) 16px 24px;font:14px/1.45 'IBM Plex Sans',-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}" +
      ".fs-ov *{box-sizing:border-box}" +
      ".fs-box{position:relative;width:100%;max-width:480px;margin:clamp(8px,6vh,56px) auto;background:var(--fs-panel);color:var(--fs-ink);border:1px solid var(--fs-line);border-radius:16px;padding:24px 22px;box-shadow:0 24px 70px rgba(0,0,0,.45)}" +
      ".fs-box h2{margin:0 0 4px;font:600 22px/1.2 Fraunces,Georgia,serif;padding-right:28px}" +
      ".fs-box h3{margin:0 0 4px;font:600 15px/1.3 'IBM Plex Sans',system-ui,sans-serif}" +
      ".fs-box p{margin:0 0 12px;color:var(--fs-muted)}" +
      ".fs-x{position:absolute;top:10px;right:12px;width:36px;height:36px;border:0;background:none;color:var(--fs-muted);font-size:26px;line-height:1;cursor:pointer;border-radius:8px}.fs-x:hover{color:var(--fs-ink)}" +
      ".fs-sec{padding:16px 0;border-top:1px solid var(--fs-line)}.fs-sec:first-of-type{border-top:0}" +
      ".fs-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}" +
      ".fs-in{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--fs-line);border-radius:10px;background:var(--fs-field);color:var(--fs-ink);font:inherit;margin:0 0 8px}.fs-in:focus{outline:2px solid var(--fs-gold);outline-offset:1px;border-color:var(--fs-gold)}" +
      ".fs-code{text-align:center;font:600 26px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.35em;padding-left:.35em}" +
      ".fs-b{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:9px 16px;border-radius:10px;border:1px solid var(--fs-line);background:transparent;color:var(--fs-ink);font:600 14px/1.2 'IBM Plex Sans',system-ui,sans-serif;cursor:pointer;text-decoration:none}" +
      ".fs-b:hover{border-color:var(--fs-muted)}.fs-b:focus-visible{outline:2px solid var(--fs-gold);outline-offset:2px}.fs-b[disabled]{opacity:.55;cursor:default}" +
      ".fs-b.pri{background:var(--fs-gold);border-color:var(--fs-gold);color:var(--fs-goldInk)}.fs-b.bad{color:var(--fs-red);border-color:var(--fs-red)}" +
      ".fs-l{background:none;border:0;padding:6px 2px;color:var(--fs-muted);font:inherit;text-decoration:underline;cursor:pointer}.fs-l:hover{color:var(--fs-ink)}" +
      ".fs-msg{min-height:20px;margin-top:8px;font-size:13px;color:var(--fs-red)}.fs-msg.ok{color:var(--fs-ok)}" +
      ".fs-pill{display:inline-block;padding:2px 9px;border-radius:99px;font:600 11px/1.6 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--fs-line);color:var(--fs-muted);vertical-align:middle;margin-left:8px}.fs-pill.on{color:var(--fs-ok);border-color:var(--fs-ok)}" +
      ".fs-qr{display:grid;place-items:center;margin:8px 0}.fs-qr img{width:176px;height:176px;background:#fff;border-radius:10px;padding:8px}" +
      ".fs-sk{font:600 13px/1.4 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;background:var(--fs-field);border:1px solid var(--fs-line);border-radius:8px;padding:8px 10px;margin:0 0 10px;color:var(--fs-ink);user-select:all}" +
      ".fs-box details summary{cursor:pointer;font-weight:600;list-style:none}.fs-box details summary::-webkit-details-marker{display:none}.fs-box details[open] summary{margin-bottom:8px}" +
      "@media (prefers-reduced-motion:no-preference){.fs-box{animation:fsIn .18s ease-out}@keyframes fsIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}";
    document.head.appendChild(s);
  }

  var current = null;
  function closeOv() { if (current) { current.remove(); current = null; document.removeEventListener("keydown", onKey, true); } }
  function onKey(e) { if (e.key === "Escape" && current && current.getAttribute("data-block") !== "1") { e.stopPropagation(); closeOv(); } }
  function overlay(html, o) {
    o = o || {}; css(); closeOv();
    var ov = document.createElement("div"); ov.className = "fs-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("data-block", o.block ? "1" : "0");
    var pal = PAL[isDark() ? "dark" : "light"]; Object.keys(pal).forEach(function (k) { ov.style.setProperty("--fs-" + k, pal[k]); });
    ov.innerHTML = '<div class="fs-box">' + (o.block ? "" : '<button type="button" class="fs-x" aria-label="Close">×</button>') + html + "</div>";
    document.body.appendChild(ov); current = ov;
    var x = ov.querySelector(".fs-x"); if (x) x.addEventListener("click", closeOv);
    if (!o.block) ov.addEventListener("mousedown", function (e) { if (e.target === ov) closeOv(); });
    document.addEventListener("keydown", onKey, true);
    var f = ov.querySelector("input"); if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 60);
    return ov;
  }
  function $(sel, root) { return (root || current || document).querySelector(sel); }
  function say(root, text, ok) { var m = $(".fs-msg", root); if (m) { m.textContent = text || ""; m.className = "fs-msg" + (ok ? " ok" : ""); } }

  function totpFactors(u) { return ((u && u.factors) || []).filter(function (f) { return f.factor_type === "totp" && f.status === "verified"; }); }

  /* ---- code check (challenge + verify) --------------------------------------------------------------------------- */
  function checkCode(factorId, code) {
    return api("/auth/v1/factors/" + encodeURIComponent(factorId) + "/challenge", { method: "POST", body: {} }).then(function (c) {
      if (!c.ok || !c.j.id) return { ok: false, msg: why(c, "Could not start the code check. Try again.") };
      return api("/auth/v1/factors/" + encodeURIComponent(factorId) + "/verify", { method: "POST", body: { challenge_id: c.j.id, code: code } }).then(function (v) {
        if (!v.ok || !v.j.access_token) return { ok: false, msg: /invalid|expired/i.test(why(v)) ? "That code did not match. Wait for the next one and try again." : why(v, "That code did not work.") };
        saveSession(v.j); return { ok: true };
      });
    });
  }

  /* ---- 1. The gate ------------------------------------------------------------------------------------------------ */
  function showGate(factorId) {
    var email = (sess() || {}).email || "";
    var ov = overlay('<h2>Two-step sign-in</h2><p>Open your authenticator app and enter the 6-digit code for Fullmedia Alchemist' + (email ? " (" + esc(email) + ")" : "") + '.</p>' +
      '<form id="fsGate" novalidate><input class="fs-in fs-code" id="fsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" aria-label="6-digit code" placeholder="000000">' +
      '<div class="fs-row"><button class="fs-b pri" type="submit" id="fsGo">Verify</button><button class="fs-l" type="button" id="fsOut">Sign out</button></div><div class="fs-msg" role="status"></div></form>', { block: true });
    var inp = $("#fsCode", ov), go = $("#fsGo", ov), busy = false;
    function run() {
      var code = inp.value.replace(/\D/g, ""); if (code.length !== 6) { say(ov, "Enter the 6 digits from your app."); return; }
      if (busy) return; busy = true; go.disabled = true; say(ov, "Checking…", true);
      checkCode(factorId, code).then(function (r) {
        if (r.ok) { say(ov, "Verified.", true); location.reload(); return; }
        busy = false; go.disabled = false; inp.value = ""; inp.focus(); say(ov, r.msg);
      });
    }
    $("#fsGate", ov).addEventListener("submit", function (e) { e.preventDefault(); run(); });
    inp.addEventListener("input", function () { inp.value = inp.value.replace(/\D/g, "").slice(0, 6); if (inp.value.length === 6) run(); });
    $("#fsOut", ov).addEventListener("click", function () { signOutLocal(true); });
  }
  function signOutLocal(everywhere) {
    var t = tok();
    if (t && everywhere) { try { fetch(SB + "/auth/v1/logout?scope=global", { method: "POST", keepalive: true, headers: { apikey: KEY, Authorization: "Bearer " + t } }).catch(function () {}); } catch (e) {} }
    try { Object.keys(localStorage).forEach(function (k) { if (k === "ccb-session" || /^sb-.*-auth-token/.test(k) || k === "fa_login_pending") localStorage.removeItem(k); }); } catch (e) {}
    location.replace("/login/");
  }

  var gateDone = false;
  function gate(tries) {
    if (gateDone) return;
    var t = tok();
    if (!t) { if (tries < 6) setTimeout(function () { gate(tries + 1); }, 1500); return; }
    gateDone = true;
    var p = jwt(t);
    if (p && p.aal === "aal2") { recoveryCheck(); return; }
    api("/auth/v1/user").then(function (r) {
      if (!r.ok) { recoveryCheck(); return; }
      var f = totpFactors(r.j)[0];
      if (f) showGate(f.id); else recoveryCheck();
    });
  }

  /* ---- 3. Password-reset landing ------------------------------------------------------------------------------------ */
  function recoveryCheck() {
    var on = false; try { on = sessionStorage.getItem("fma_recovery") === "1"; } catch (e) {}
    if (on) openSetPassword({ recovery: true });
  }
  function clearRecovery() { try { sessionStorage.removeItem("fma_recovery"); } catch (e) {} }

  function pwForm(id) {
    return '<form id="' + id + '" novalidate><label for="' + id + 'a" style="display:block;font-weight:600;margin:0 0 4px">New password</label>' +
      '<input class="fs-in" id="' + id + 'a" type="password" autocomplete="new-password" minlength="' + MIN_PW + '" placeholder="At least ' + MIN_PW + ' characters">' +
      '<label for="' + id + 'b" style="display:block;font-weight:600;margin:0 0 4px">Type it again</label>' +
      '<input class="fs-in" id="' + id + 'b" type="password" autocomplete="new-password" placeholder="Same password">' +
      '<div class="fs-row"><button class="fs-b pri" type="submit">Save password</button><span class="fs-slot"></span></div><div class="fs-msg" role="status"></div></form>';
  }
  function wirePw(formEl, root, done) {
    var a = formEl.querySelector('input[autocomplete="new-password"]'), b = formEl.querySelectorAll('input[autocomplete="new-password"]')[1], btn = formEl.querySelector("button[type=submit]");
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      if (a.value.length < MIN_PW) { say(root, "Use at least " + MIN_PW + " characters. A few words in a row works well."); return; }
      if (a.value !== b.value) { say(root, "The two passwords do not match."); return; }
      btn.disabled = true; say(root, "Saving…", true);
      api("/auth/v1/user", { method: "PUT", body: { password: a.value } }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          var m = why(r);
          if (/reauth/i.test(JSON.stringify(r.j))) m = "For safety, sign out and back in, then try again. Or use the email reset link below.";
          else if (/pwned|leak|breach|weak/i.test(m + JSON.stringify(r.j))) m = "That password has shown up in a known data leak, or is too easy to guess. Pick a different one.";
          say(root, m); return;
        }
        a.value = b.value = ""; say(root, "Password saved. You can now sign in with it. The email link still works too.", true); if (done) done();
      });
    });
  }
  function openSetPassword(o) {
    o = o || {};
    var ov = overlay('<h2>Choose a new password</h2><p>' + (o.recovery ? "You followed a reset link, so you are signed in. Pick the password you want to use from now on." : "") + '</p>' + pwForm("fsPw") +
      (o.recovery ? '<div class="fs-row" style="margin-top:6px"><button type="button" class="fs-l" id="fsSkip">Skip for now</button></div>' : ""), { block: !!o.recovery });
    var skip = $("#fsSkip", ov); if (skip) skip.addEventListener("click", function () { clearRecovery(); closeOv(); });
    wirePw($("#fsPw", ov), ov, function () { clearRecovery(); setTimeout(closeOv, 1400); });
  }

  /* ---- 2. Password & security sheet ---------------------------------------------------------------------------------- */
  function resetLink(email, root) {
    if (!email) { say(root, "No email on this session. Sign in again first."); return; }
    say(root, "Sending…", true);
    fetch(SB + "/auth/v1/recover?redirect_to=" + encodeURIComponent(location.origin + "/dashboard/"), { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: email }) })
      .then(function (r) { say(root, r.ok ? "Done. Check " + email + " for the reset link." : "Could not send that right now. Try again in a minute.", r.ok); })
      .catch(function () { say(root, "Could not reach the server."); });
  }

  function openSecurity() {
    var tk = tok();
    if (!tk) { location.href = "/login/"; return; }
    var claims = jwt(tk) || {};
    var ov = overlay('<h2>Password &amp; security</h2><p id="fsWho">Loading your account…</p><div id="fsBody"></div>');
    api("/auth/v1/user").then(function (r) {
      if (!current || current !== ov) return;
      if (!r.ok) { $("#fsWho", ov).textContent = why(r, "Could not load your account."); return; }
      render(ov, r.j, claims);
    });
  }

  function render(ov, u, claims) {
    var email = u.email || "";
    var methods = (u.app_metadata && u.app_metadata.providers) || [];
    var who = $("#fsWho", ov); who.textContent = "Signed in as " + email + (methods.length ? " (" + methods.map(function (m) { return m === "email" ? "email" : m; }).join(", ") + ")" : "") + ".";
    var on = totpFactors(u).length > 0;
    var body = $("#fsBody", ov);
    body.innerHTML =
      '<section class="fs-sec" id="fsPass"><h3>Password</h3><p>Optional. You can always sign in with an emailed link or Google. A password adds one more way in.</p>' + pwForm("fsPw2") +
      '<div style="margin-top:6px"><button type="button" class="fs-l" id="fsReset">Email me a reset link instead</button></div></section>' +
      '<section class="fs-sec" id="fsMfa"></section>' +
      '<section class="fs-sec"><h3>Your data</h3><p>Download everything we hold for your account as one file.</p><div class="fs-row"><button type="button" class="fs-b" id="fsExp">Download my data</button></div><div class="fs-msg" id="fsExpMsg" role="status"></div></section>' +
      '<section class="fs-sec"><h3>Devices</h3><p>Sign out of every phone and computer, including this one.</p><div class="fs-row"><button type="button" class="fs-b" id="fsAll">Sign out everywhere</button></div></section>' +
      '<section class="fs-sec"><details><summary>Delete my account</summary><p>This asks our team to permanently remove your account, brands and content. We email you to confirm before anything is deleted. If you pay for a plan, cancel it first under Plans &amp; billing.</p>' +
      '<label for="fsDelEm" style="display:block;font-weight:600;margin:0 0 4px">Type your email to confirm</label><input class="fs-in" id="fsDelEm" type="email" autocomplete="off" placeholder="' + esc(email) + '">' +
      '<div class="fs-row"><button type="button" class="fs-b bad" id="fsDel">Request deletion</button></div><div class="fs-msg" id="fsDelMsg" role="status"></div></details></section>';

    var passRoot = $("#fsPass", ov);
    wirePw($("#fsPw2", ov), passRoot, null);
    $("#fsReset", ov).addEventListener("click", function () { resetLink(email, passRoot); });

    renderMfa(ov, u, claims);

    $("#fsExp", ov).addEventListener("click", function () {
      var b = this, m = $("#fsExpMsg", ov); b.disabled = true; m.className = "fs-msg ok"; m.textContent = "Gathering your data…";
      var t = tok(); if (!t) { b.disabled = false; m.className = "fs-msg"; m.textContent = "Please sign in again."; return; }
      fetch(SB + "/functions/v1/account-export", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + t, "content-type": "application/json" }, body: "{}" })
        .then(function (r) {
          if (r.status === 404) throw new Error("Data export is not switched on yet. Send a request through Report a problem and we will email it to you.");
          if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || "Could not build your export."); });
          return r.blob();
        })
        .then(function (blob) {
          var a = document.createElement("a"), d = new Date().toISOString().slice(0, 10);
          a.href = URL.createObjectURL(blob); a.download = "fullmedia-alchemist-data-" + d + ".json"; document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          b.disabled = false; m.className = "fs-msg ok"; m.textContent = "Downloaded.";
        })
        .catch(function (e) { b.disabled = false; m.className = "fs-msg"; m.textContent = e && e.message ? e.message : "Could not reach the server."; });
    });

    $("#fsAll", ov).addEventListener("click", function () { this.disabled = true; signOutLocal(true); });

    $("#fsDel", ov).addEventListener("click", function () {
      var b = this, typed = $("#fsDelEm", ov).value.trim().toLowerCase(), m = $("#fsDelMsg", ov);
      if (typed !== email.toLowerCase()) { m.className = "fs-msg"; m.textContent = "Type your account email exactly to confirm."; return; }
      b.disabled = true; m.className = "fs-msg ok"; m.textContent = "Sending…";
      var t = tok(); if (!t) { b.disabled = false; m.className = "fs-msg"; m.textContent = "Please sign in again."; return; }
      fetch(SB + "/functions/v1/support", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + t, "content-type": "application/json" },
        body: JSON.stringify({ action: "create", kind: "other", summary: "Delete my account", details: "Please permanently delete my account and all of its data. Account email: " + email + ". Sent from Password & security. Confirm with me by email before deleting.", context: { url: location.pathname, ua: navigator.userAgent.slice(0, 200), screen: innerWidth + "x" + innerHeight } }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) { b.disabled = false; m.className = "fs-msg"; m.textContent = x.j.error || "Could not send that. Please try again."; return; }
          m.className = "fs-msg ok"; m.textContent = "Request #" + x.j.ticket_no + " sent. We will email " + email + " to confirm before anything is deleted.";
        })
        .catch(function () { b.disabled = false; m.className = "fs-msg"; m.textContent = "Could not reach the server."; });
    });
  }

  function renderMfa(ov, u, claims) {
    var box = $("#fsMfa", ov), factors = totpFactors(u), on = factors.length > 0;
    box.innerHTML = '<h3>Two-step sign-in<span class="fs-pill' + (on ? " on" : "") + '">' + (on ? "On" : "Off") + "</span></h3>" +
      "<p>" + (on ? "After signing in you also enter a 6-digit code from your authenticator app." : "Add a code from an authenticator app (Google Authenticator, 1Password, Authy) so a stolen password or link is not enough to get in.") + "</p>" +
      '<div id="fsMfaBody"></div><div class="fs-msg" role="status"></div>';
    var body = $("#fsMfaBody", box);
    if (on) {
      body.innerHTML = '<div class="fs-row"><button type="button" class="fs-b bad" id="fsOff">Turn off</button></div>';
      $("#fsOff", box).addEventListener("click", function () {
        if (claims.aal !== "aal2") { say(box, "Sign out and back in with your code first, then you can turn it off."); return; }
        body.innerHTML = '<p>Turn off two-step sign-in?</p><div class="fs-row"><button type="button" class="fs-b bad" id="fsOff2">Yes, turn it off</button><button type="button" class="fs-l" id="fsKeep">Keep it on</button></div>';
        $("#fsKeep", box).addEventListener("click", function () { renderMfa(ov, u, claims); });
        $("#fsOff2", box).addEventListener("click", function () {
          this.disabled = true; say(box, "Turning off…", true);
          api("/auth/v1/factors/" + encodeURIComponent(factors[0].id), { method: "DELETE" }).then(function (r) {
            if (!r.ok) { renderMfa(ov, u, claims); say(box, why(r, "Could not turn it off.")); return; }
            api("/auth/v1/user").then(function (nr) { renderMfa(ov, nr.ok ? nr.j : Object.assign({}, u, { factors: [] }), jwt(tok() || "") || claims); say(box, "Two-step sign-in is off.", true); });
          });
        });
      });
      return;
    }
    body.innerHTML = '<div class="fs-row"><button type="button" class="fs-b pri" id="fsOn">Turn on</button></div>';
    $("#fsOn", box).addEventListener("click", function () {
      var btn = this; btn.disabled = true; say(box, "Getting your code ready…", true);
      var stale = ((u.factors || []).filter(function (f) { return f.status !== "verified"; }));
      Promise.all(stale.map(function (f) { return api("/auth/v1/factors/" + encodeURIComponent(f.id), { method: "DELETE" }); })).then(function () {
        return api("/auth/v1/factors", { method: "POST", body: { factor_type: "totp", friendly_name: "Authenticator " + Date.now().toString(36), issuer: "Fullmedia Alchemist" } });
      }).then(function (r) {
        if (!r.ok || !r.j.id || !r.j.totp) { btn.disabled = false; say(box, why(r, "Could not start setup. Two-step sign-in may not be switched on for this project yet.")); return; }
        var qr = String(r.j.totp.qr_code || ""), okQr = /^data:image\/svg\+xml/i.test(qr);
        body.innerHTML = '<ol style="margin:0 0 10px;padding-left:20px;color:var(--fs-muted)"><li>Open your authenticator app and add an account.</li><li>' + (okQr ? "Scan this picture, or type the key below." : "Type the key below.") + "</li><li>Enter the 6-digit code it shows.</li></ol>" +
          (okQr ? '<div class="fs-qr"><img alt="QR code for your authenticator app" id="fsQr"></div>' : "") + '<div class="fs-sk" id="fsSk"></div>' +
          '<form id="fsEnr" novalidate><input class="fs-in fs-code" id="fsEc" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="6-digit code" placeholder="000000"><div class="fs-row"><button class="fs-b pri" type="submit">Verify and turn on</button><button class="fs-l" type="button" id="fsCancel">Cancel</button></div></form>';
        say(box, "");
        if (okQr) $("#fsQr", box).src = qr;
        $("#fsSk", box).textContent = r.j.totp.secret || "";
        $("#fsCancel", box).addEventListener("click", function () { api("/auth/v1/factors/" + encodeURIComponent(r.j.id), { method: "DELETE" }); renderMfa(ov, u, claims); });
        var ec = $("#fsEc", box); ec.focus();
        $("#fsEnr", box).addEventListener("submit", function (e) {
          e.preventDefault(); var code = ec.value.replace(/\D/g, ""); if (code.length !== 6) { say(box, "Enter the 6 digits from your app."); return; }
          say(box, "Checking…", true);
          checkCode(r.j.id, code).then(function (v) {
            if (!v.ok) { ec.value = ""; ec.focus(); say(box, v.msg); return; }
            api("/auth/v1/user").then(function (nr) { renderMfa(ov, nr.ok ? nr.j : u, jwt(tok() || "") || claims); say($("#fsMfa", ov), "Two-step sign-in is on. You will be asked for a code each time you sign in.", true); });
          });
        });
      });
    });
  }

  window.fmSecurityOpen = openSecurity;
  window.fmSecurityState = function () { var p = jwt(tok() || ""); return { aal: p && p.aal || null }; };

  function start() { gate(0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

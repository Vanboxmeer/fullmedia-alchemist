/* Fullmedia Alchemist: module switch + cross-promotion between Content Engine (/dashboard/) and Alchemist Reach (/reach/).
   One file, loaded by both apps. It reads the signed-in session from localStorage "ccb-session" (same login as the dashboard),
   asks the database which plans this account holds (rpc ar_my_plans) and then:
     1. shows a Content | Reach switch in the header (a small tag shows the plan on each module; a module you have not subscribed to runs on its Free plan)
     2. shows a dismissible card promoting the module the account does not have, with the 10% same-tier bundle
     3. no module is ever walled off: without a subscription the module runs on Free, and the card offers the upgrade */
(function () {
  "use strict";
  if (window.__xpromo) return; window.__xpromo = 1;
  var SB = (window.REACH_CONFIG && window.REACH_CONFIG.url) || "https://tpqvvrdglnsdljdpzwfl.supabase.co";
  var KEY = (window.REACH_CONFIG && window.REACH_CONFIG.key) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcXZ2cmRnbG5zZGxqZHB6d2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0OTEwMTAsImV4cCI6MjA5NzA2NzAxMH0.gxr0vEWFBwPp8ErX41rHNFV0aMU_lhiceFhY64iA7Ko";
  var HERE = (location.pathname.indexOf("/reach") === 0 || /\/reach\/index\.html$/.test(location.pathname) || document.getElementById("topnav") || document.querySelector("meta[name=application-name][content=\"Alchemist Reach\"]")) ? "reach" : "content";
  var OTHER = HERE === "reach" ? "content" : "reach";
  var NAMES = { content: "Content", reach: "Reach" };
  var PLAN_LABEL = { free: "Free", starter: "Starter", growth: "Growth", solo: "Starter", team: "Growth", agency: "Agency" };

  function jwt(t) { try { var b = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(b + "===".slice((b.length + 3) % 4))); } catch (e) { return null; } }
  function token() {
    try { var o = JSON.parse(localStorage.getItem("ccb-session") || "null"); var p = o && jwt(o.access_token); if (p && p.exp * 1000 > Date.now() + 5000) return o.access_token; } catch (e) {}
    try { var k = Object.keys(localStorage).filter(function (x) { return /^sb-.*-auth-token/.test(x); })[0]; if (k) { var q = JSON.parse(localStorage.getItem(k) || "null"); q = q && (q.currentSession || q); var pp = q && jwt(q.access_token); if (pp && pp.exp * 1000 > Date.now() + 5000) return q.access_token; } } catch (e) {}
    return null;
  }
  function dismissed(k) { try { var t = Number(localStorage.getItem("xp_dismiss_" + k) || 0); return t && Date.now() - t < 7 * 86400000; } catch (e) { return false; } }
  function dismiss(k) { try { localStorage.setItem("xp_dismiss_" + k, String(Date.now())); } catch (e) {} }

  function css() {
    if (document.getElementById("xpCss")) return;
    var s = document.createElement("style"); s.id = "xpCss";
    s.textContent =
      ".xp-sw{display:inline-flex;align-items:center;border:1px solid var(--border,rgba(128,128,128,.35));border-radius:999px;padding:2px;margin:0 8px;gap:2px;font:600 12px/1 var(--font-body,'IBM Plex Sans',system-ui,sans-serif);white-space:nowrap}" +
      ".xp-sw a{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;color:var(--fg-dim,inherit);text-decoration:none;opacity:.8}" +
      ".xp-sw a:hover{opacity:1}.xp-sw a.on{background:var(--accent,#e0a63e);color:var(--accent-fg,#1c1410);opacity:1;cursor:default}" +
      ".xp-sw a i{font:600 9.5px/1 var(--font-body,'IBM Plex Sans',system-ui,sans-serif);font-style:normal;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:99px;background:rgba(128,128,128,.22)}" +
      ".xp-sw a.on i{background:rgba(0,0,0,.18)}.xp-sw a.free i{background:transparent;border:1px solid currentColor;opacity:.8}" +
      ".xp-pin{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-left:-2px;border:1px solid var(--border,rgba(128,128,128,.35));border-radius:50%;background:transparent;color:var(--fg-dim,inherit);cursor:pointer;font-size:14px;line-height:1;padding:0}" +
      ".xp-pin:hover{color:var(--accent,#e0a63e);border-color:var(--accent,#e0a63e)}.xp-pin.on{color:var(--accent,#e0a63e);border-color:var(--accent,#e0a63e)}" +
      ".xp-card{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:10px 16px 0;padding:10px 14px;border:1px solid var(--border,rgba(128,128,128,.35));border-left:3px solid var(--accent,#e0a63e);border-radius:10px;background:var(--surface,rgba(128,128,128,.08));color:var(--fg,inherit);font:13px/1.45 var(--font-body,'IBM Plex Sans',system-ui,sans-serif)}" +
      ".xp-card b{font-family:var(--font-display,Fraunces,Georgia,serif);font-size:14px}.xp-card .t{flex:1 1 320px;min-width:0}.xp-card .t span{opacity:.75}" +
      ".xp-card a.go{background:var(--accent,#e0a63e);color:var(--accent-fg,#1c1410);text-decoration:none;font-weight:600;padding:7px 14px;border-radius:8px;white-space:nowrap}" +
      ".xp-card button{background:none;border:0;color:inherit;opacity:.6;cursor:pointer;font-size:18px;line-height:1;padding:2px 6px}" +
      "@media (max-width:1100px){#topnav .tn-brand .name{display:none}}" +
      "@media (max-width:640px){#xpSw i{display:none!important}#xpSw a{padding:6px 12px}.xp-sw{margin:0 2px}#xpPin,#rankChip,#credits,#themeBtn{display:none!important}.topbar-in{gap:8px!important}#brandSwitch{margin-left:auto}.xp-card{margin:10px 12px 0}}" +
      "#xpGate{position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(20,17,13,.9);padding:16px;font-family:'IBM Plex Sans',system-ui,sans-serif}" +
      "#xpGate .box{background:#fffaf0;color:#231f1a;border-radius:14px;max-width:440px;width:100%;padding:26px 24px}" +
      "#xpGate h2{margin:0 0 6px;font:600 22px/1.2 Fraunces,Georgia,serif}#xpGate p{margin:0 0 14px;color:#6b6256;font-size:14px;line-height:1.5}" +
      "#xpGate .row{display:flex;gap:8px;flex-wrap:wrap}#xpGate a,#xpGate button{font:600 14px 'IBM Plex Sans',system-ui,sans-serif;border-radius:9px;padding:10px 14px;text-decoration:none;cursor:pointer;border:1px solid #9a6309}" +
      "#xpGate .pri{background:#9a6309;color:#fffaf0}#xpGate .alt{background:#fff;color:#231f1a;border-color:#e3dbcb}#xpGate .msg{margin-top:12px;font-size:13px;color:#9a6309;min-height:18px}";
    document.head.appendChild(s);
  }


  /* ---- Plans & billing: ONE screen for both products (Content + Reach) --------------------------------------------
     Pick a tier for Content, a tier for Reach, or only one. Same tier on both is the Suite (one subscription, 10% off).
     Prices, plans and what a change will do all come from the billing-manage edge function; nothing is hard-coded here. */
  function money(c) { return "$" + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)); }
  function billing(action, extra) {
    var tok = token(); if (!tok) return Promise.reject(new Error("Please sign in again."));
    return fetch(SB + "/functions/v1/billing-manage", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify(Object.assign({ action: action, returnTo: HERE }, extra || {})) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || ("Error " + r.status)); return j; }); });
  }
  function plansCss() {
    if (document.getElementById("xpPlCss")) return;
    var s = document.createElement("style"); s.id = "xpPlCss";
    s.textContent =
      "#xpPl{position:fixed;inset:0;z-index:99997;background:rgba(20,17,13,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 16px;font-family:'IBM Plex Sans',system-ui,sans-serif}" +
      "#xpPl *{box-sizing:border-box}" +
      "#xpPl .box{background:#fffaf0;color:#231f1a;border-radius:16px;max-width:900px;width:100%;padding:24px;position:relative}" +
      "#xpPl h2{margin:0 0 4px;font:600 24px/1.2 Fraunces,Georgia,serif}#xpPl .sub{margin:0 0 14px;color:#6b6256;font-size:14px;line-height:1.5}" +
      "#xpPl .x{position:absolute;top:12px;right:14px;background:none;border:0;font-size:24px;cursor:pointer;color:#6b6256}" +
      "#xpPl .tg{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}" +
      "#xpPl .seg{display:inline-flex;gap:2px;background:#fffaf0;border:1px solid #d8cdb6;border-radius:999px;padding:2px}#xpPl .seg button{border:0;background:transparent;padding:6px 14px;border-radius:999px;font:600 13px 'IBM Plex Sans',sans-serif;cursor:pointer;color:#231f1a;box-shadow:none}#xpPl .seg button.on{background:#9a6309;color:#fffaf0}" +
      "#xpPl .hint{font-size:12.5px;color:#2f7a4f;font-weight:600}" +
      "#xpPl .prod{margin:0 0 14px}#xpPl .prod h3{margin:0 0 2px;font:600 17px Fraunces,Georgia,serif;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}#xpPl .prod h3 small{font:400 12.5px 'IBM Plex Sans',sans-serif;color:#6b6256}" +
      "#xpPl .tiers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:8px}" +
      "#xpPl .tier{position:relative;text-align:left;border:1px solid #e3dbcb;border-radius:12px;padding:12px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:4px;min-width:0;font:inherit;color:inherit}" +
      "#xpPl .tier:hover{border-color:#9a6309}#xpPl .tier.sel{border-color:#9a6309;box-shadow:0 0 0 2px #9a6309}#xpPl .tier[disabled]{opacity:.55;cursor:default}" +
      "#xpPl .tier b{font:600 15px 'IBM Plex Sans',sans-serif}#xpPl .tier .pr{font:600 20px 'IBM Plex Sans',sans-serif}#xpPl .tier .pr small{font-size:11.5px;font-weight:400;color:#6b6256}" +
      "#xpPl .tier ul{margin:4px 0 0;padding-left:15px;font-size:12px;color:#4a4339;line-height:1.4}" +
      "#xpPl .tier .tag{position:absolute;top:8px;right:8px;font:600 10px 'IBM Plex Sans',sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:99px;background:#9a6309;color:#fffaf0}#xpPl .tier .tag.end{background:#b3412b}#xpPl .tier .tag.soon{background:#8a8070}" +
      "#xpPl .note{font-size:12.5px;color:#6b6256;margin:6px 0 0}" +
      "#xpPl .sum{border:1px solid #d8cdb6;border-radius:12px;padding:14px;background:#fff;margin-top:6px}#xpPl .sum h4{margin:0 0 4px;font:600 15px 'IBM Plex Sans',sans-serif}#xpPl .sum .big{font:600 22px 'IBM Plex Sans',sans-serif}#xpPl .sum .big small{font-size:12px;font-weight:400;color:#6b6256}#xpPl .sum .save{color:#2f7a4f;font-size:12.5px;font-weight:600}" +
      "#xpPl .sum ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:#4a4339;line-height:1.5}" +
      "#xpPl .go{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center}#xpPl .go button{border-radius:9px;border:1px solid #9a6309;background:#9a6309;color:#fffaf0;padding:10px 16px;font:600 14px 'IBM Plex Sans',sans-serif;cursor:pointer}#xpPl .go button[disabled]{background:#eee6d6;border-color:#e3dbcb;color:#8a8070;cursor:default}#xpPl .go button.alt{background:#fff;color:#231f1a;border-color:#d8cdb6}" +
      "#xpPl .msg{margin-top:10px;font-size:13px;color:#9a6309;min-height:18px}#xpPl .ft{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}#xpPl .ft button{background:#fff;border:1px solid #d8cdb6;border-radius:9px;padding:8px 12px;font:600 13px 'IBM Plex Sans',sans-serif;cursor:pointer;color:#231f1a}" +
      "@media (max-width:720px){#xpPl{padding:0}#xpPl .box{border-radius:0;min-height:100%;padding:18px 16px}#xpPl .tiers{grid-template-columns:repeat(2,minmax(0,1fr))}}";
    document.head.appendChild(s);
  }
  var TIER_LABEL = { free: "Free", starter: "Starter", growth: "Growth", agency: "Agency" };
  function openPlans(preset) {
    plansCss();
    var old = document.getElementById("xpPl"); if (old) old.remove();
    var el = document.createElement("div"); el.id = "xpPl"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Plans and billing");
    el.innerHTML = '<div class="box"><button class="x" type="button" aria-label="Close">&times;</button><h2>Plans &amp; billing</h2>' +
      '<p class="sub">One account, two tools. Pick a plan for Content, for Reach, or both. Put both on the same tier and the Suite takes 10% off, on one invoice.</p>' +
      '<div class="tg"><div class="seg"><button data-i="monthly" class="on" type="button">Monthly</button><button data-i="annual" type="button">Annual &middot; 2 months free</button></div><span class="hint" id="xpHint"></span></div>' +
      '<div id="xpProds">Loading&hellip;</div><div class="sum" id="xpSum" hidden></div><div class="msg" id="xpPm"></div><div class="ft" id="xpFt"></div></div>';
    document.body.appendChild(el);
    var S = { o: null, c: "free", r: "free", interval: "monthly", pv: null, busy: false, changed: false, seq: 0 };
    var msg = el.querySelector("#xpPm"), prods = el.querySelector("#xpProds"), sum = el.querySelector("#xpSum"), ft = el.querySelector("#xpFt"), hint = el.querySelector("#xpHint");
    function close() { el.remove(); if (S.changed) { try { location.reload(); } catch (e) {} } }
    el.querySelector(".x").onclick = close; el.addEventListener("click", function (e) { if (e.target === el) close(); });
    document.addEventListener("keydown", function esc(e) { if (!document.getElementById("xpPl")) { document.removeEventListener("keydown", esc); return; } if (e.key === "Escape") { document.removeEventListener("keydown", esc); close(); } });
    function endText(cur) { return cur.periodEnd ? " " + String(cur.periodEnd).slice(0, 10) : ""; }
    function tierCard(which, t) {
      var o = S.o, cur = o.current[which], pl = t[which === "c" ? "content" : "reach"], ann = S.interval === "annual";
      var b = document.createElement("button"); b.type = "button"; b.className = "tier"; b.setAttribute("data-t", t.tier);
      var sel = S[which] === t.tier; if (sel) b.classList.add("sel");
      var price = t.tier === "free" ? "$0" : (pl ? money(ann ? pl.annual : pl.monthly) : "");
      var h = "<b>" + esc(t.label) + '</b><div class="pr">' + price + (t.tier === "free" ? "" : " <small>" + (ann ? "/ year" : "/ month") + "</small>") + "</div><ul>";
      ((pl && pl.features) || []).slice(0, 3).forEach(function (f) { h += "<li>" + esc(typeof f === "string" ? f : (f.label || f.text || "")) + "</li>"; });
      h += "</ul>";
      var isCur = cur.tier === t.tier;
      if (isCur) h += '<span class="tag' + (cur.cancelPending && t.tier !== "free" ? " end" : "") + '">' + (cur.comp ? "Included" : cur.cancelPending && t.tier !== "free" ? "Ends" + endText(cur) : "Current") + "</span>";
      else if (which === "r" && t.tier !== "free" && pl && pl.onSale === false) { h += '<span class="tag soon">Soon</span>'; b.disabled = true; }
      b.innerHTML = h;
      if (cur.comp && cur.tier !== "free") b.disabled = true;
      b.onclick = function () { if (b.disabled) return; S[which] = t.tier; msg.textContent = ""; drawProds(); refreshSummary(); };
      return b;
    }
    function drawProds() {
      var o = S.o; prods.innerHTML = "";
      [["c", "Content", "Posts, carousels and a content calendar for each brand"], ["r", "Reach", "Find options, draft outreach and run deals"]].forEach(function (p) {
        var box = document.createElement("div"); box.className = "prod";
        var cur = o.current[p[0]];
        box.innerHTML = "<h3>" + p[1] + " <small>" + p[2] + "</small></h3>";
        var row = document.createElement("div"); row.className = "tiers";
        o.tiers.forEach(function (t) { row.appendChild(tierCard(p[0], t)); });
        box.appendChild(row);
        if (cur.comp && cur.tier !== "free") { var n = document.createElement("div"); n.className = "note"; n.textContent = p[1] + " is a complimentary plan from us, so there is nothing to change here."; box.appendChild(n); }
        else if (cur.cancelPending && cur.tier !== "free") { var n2 = document.createElement("div"); n2.className = "note"; n2.textContent = p[1] + " " + TIER_LABEL[cur.tier] + " is set to end" + endText(cur) + ". Pick it again to keep it."; box.appendChild(n2); }
        prods.appendChild(box);
      });
      var suite = S.c !== "free" && S.c === S.r;
      hint.textContent = suite ? "Same tier on both: 10% off." : "";
    }
    function refreshSummary() {
      var my = ++S.seq; var o = S.o, cu = o.current;
      var nothing = S.c === cu.c.tier && S.r === cu.r.tier && S.interval === o.interval && !cu.c.cancelPending && !cu.r.cancelPending;
      if (nothing) { sum.hidden = true; return; }
      sum.hidden = false; sum.innerHTML = '<h4>Checking&hellip;</h4>';
      billing("preview", { content: S.c, reach: S.r, interval: S.interval }).then(function (p) {
        if (my !== S.seq) return; S.pv = p;
        var suite = p.suite, name = suite ? TIER_LABEL[S.c] + " Suite" : [S.c !== "free" ? "Content " + TIER_LABEL[S.c] : "", S.r !== "free" ? "Reach " + TIER_LABEL[S.r] : ""].filter(Boolean).join(" + ") || "Free on both";
        var h = "<h4>" + esc(name) + "</h4>";
        if (p.totalAfter > 0) h += '<div class="big">' + money(p.totalAfter) + " <small>" + (S.interval === "annual" ? "/ year" : "/ month") + "</small></div>"; else h += '<div class="big">$0</div>';
        if (p.saved > 0) h += '<div class="save">You save ' + money(p.saved) + (S.interval === "annual" ? " a year" : " a month") + " with the Suite</div>";
        if (p.steps && p.steps.length) { h += "<ul>"; p.steps.forEach(function (x) { h += "<li>" + esc(x) + "</li>"; }); h += "</ul>"; }
        h += '<div class="go"><button type="button" id="xpGo"' + (p.noChange ? " disabled" : "") + ">" + (p.noChange ? "No change" : "Confirm") + '</button><button type="button" class="alt" id="xpReset">Reset</button></div>';
        sum.innerHTML = h;
        sum.querySelector("#xpReset").onclick = function () { S.c = cu.c.tier; S.r = cu.r.tier; S.interval = o.interval; setSeg(); drawProds(); sum.hidden = true; msg.textContent = ""; };
        var go = sum.querySelector("#xpGo");
        go.onclick = function () {
          if (S.busy) return; S.busy = true; go.disabled = true; msg.textContent = "Working…";
          billing("change", { content: S.c, reach: S.r, interval: S.interval }).then(function (j) {
            if (j.checkoutUrl) { msg.textContent = "Opening secure checkout" + (j.pendingCheckouts ? ". When you are back, choose your " + (S.r !== "free" ? "Reach" : "other") + " plan again to add it." : "…"); location.href = j.checkoutUrl; return; }
            S.changed = true; msg.textContent = "Done. Your plans are updated.";
            return load(true);
          }).catch(function (e) { msg.textContent = e.message; go.disabled = false; }).then(function () { S.busy = false; });
        };
      }).catch(function (e) { if (my !== S.seq) return; sum.innerHTML = ""; sum.hidden = true; msg.textContent = e.message; });
    }
    function setSeg() { el.querySelectorAll(".seg button").forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-i") === S.interval); }); }
    function drawFooter() {
      var o = S.o, cu = o.current; ft.innerHTML = "";
      if (o.hasCard) { var m = document.createElement("button"); m.type = "button"; m.textContent = "Card & invoices"; m.onclick = function () { billing("portal").then(function (j) { location.href = j.url; }).catch(function (e) { msg.textContent = e.message; }); }; ft.appendChild(m); }
      if (cu.c.cancelPending || cu.r.cancelPending) { var r = document.createElement("button"); r.type = "button"; r.textContent = "Keep my plans (undo cancel)"; r.onclick = function () { r.disabled = true; billing("resume").then(function () { S.changed = true; msg.textContent = "Done. Nothing will end."; return load(true); }).catch(function (e) { msg.textContent = e.message; r.disabled = false; }); }; ft.appendChild(r); }
    }
    function load(keepMsg) {
      return billing("overview").then(function (o) {
        S.o = o; S.c = o.current.c.tier; S.r = o.current.r.tier; S.interval = o.interval || "monthly"; setSeg();
        drawProds(); drawFooter(); sum.hidden = true; if (!keepMsg) msg.textContent = "";
      }).catch(function (e) { prods.textContent = ""; msg.textContent = /no billing account/i.test(String(e && e.message)) ? "One step first: add your brand (your website and a name), then open Plans & billing again to pick your plan." : e.message; });
    }
    el.querySelectorAll(".seg button").forEach(function (b) { b.onclick = function () { if (!S.o) return; S.interval = b.getAttribute("data-i"); setSeg(); drawProds(); refreshSummary(); }; });
    function applyPreset() {
      if (!preset || !S.o) return;
      var cu = S.o.current, ok = function (t) { return TIER_LABEL[t] && t !== "free"; };
      if (ok(preset.c) && !(cu.c.comp && cu.c.tier !== "free")) S.c = preset.c;
      if (ok(preset.r) && !(cu.r.comp && cu.r.tier !== "free")) S.r = preset.r;
      if (preset.interval === "annual" || preset.interval === "monthly") S.interval = preset.interval;
      setSeg(); drawProds(); refreshSummary();
      var same = S.c === cu.c.tier && S.r === cu.r.tier && S.interval === S.o.interval && !cu.c.cancelPending && !cu.r.cancelPending;
      msg.textContent = same ? "You are already on this plan." : "You picked this plan on our pricing page. Check it, then press Confirm.";
    }
    load().then(applyPreset);
  }
  window.xpOpenPlans = function () { openPlans(); };

  /* A plan chosen on the pricing page survives sign-in: /login/ stores it, and the first screen after sign-in opens Plans & billing with it picked. */
  function takeIntent() {
    var it = null; try { it = JSON.parse(localStorage.getItem("fa_plan_intent") || "null"); } catch (e) {}
    try { localStorage.removeItem("fa_plan_intent"); } catch (e) {}
    if (!it || !it.plan || Date.now() - it.t > 30 * 60000) return null;
    var m = /^(content|reach|suite)-(starter|growth|agency)$/.exec(it.plan); if (!m) return null;
    var pr = { interval: it.bill === "y" ? "annual" : "monthly" };
    if (m[1] !== "reach") pr.c = m[2]; if (m[1] !== "content") pr.r = m[2];
    return pr;
  }
  /* Crypto is not offered: hide any crypto button or option the dashboard still draws. */
  var CRYPTO_RE = /crypto|helio|bitcoin|\bbtc\b|\beth\b|usdc/i;
  function hideCrypto() {
    if (HERE !== "content") return;
    document.querySelectorAll("button,a,label,option,li,[role=button],[role=tab]").forEach(function (n) {
      if (n.closest("#xpPl,#fmMenu") || n.__noCrypto) return;
      var t = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length < 90 && CRYPTO_RE.test(t)) { n.__noCrypto = true; n.style.setProperty("display", "none", "important"); }
    });
  }

  function planOf(plans, m) { return plans && plans[m] ? plans[m] : null; }
  function tagOf(plans, m) { var p = planOf(plans, m); return plans && plans.__known ? (p ? (PLAN_LABEL[p] || p) : "Free") : ""; }
  function addSwitch() { var old = document.getElementById("xpSw"); if (old) old.remove(); }

  /* One card at a time. On a Free module: an upgrade prompt for it. Otherwise, a nudge toward the other module if that one is Free. */
  function addCard(plans) {
    var old = document.getElementById("xpCard"); if (old) old.remove();
    if (!plans || !plans.__known || plans.admin) return;
    var hereFree = !plans[HERE], otherFree = !plans[OTHER], kind, copy;
    if (hereFree) {
      kind = "up-" + HERE;
      copy = HERE === "reach"
        ? { h: "You are on Reach Free.", s: "1 brand and 10 AI drafts a month. Upgrade for more brands, seats and AI.", go: "See Reach plans", act: "plans" }
        : { h: "You are on the Content Free plan.", s: "Upgrade for more brands and monthly credits.", go: "See Content plans", act: "plans" };
    } else if (otherFree) {
      kind = OTHER;
      copy = HERE === "reach"
        ? { h: "Turn every placement into posts.", s: "The Content Engine writes and designs your social posts from the coverage you win. It starts free.", go: "Open Content", href: "/dashboard/" }
        : { h: "Find the places that will cover you.", s: "Alchemist Reach finds outlets and creators, drafts the outreach and tracks every reply. It starts free.", go: "Open Reach", href: "/reach/" };
    } else return;
    if (dismissed(kind)) return;
    var c = document.createElement("div"); c.id = "xpCard"; c.className = "xp-card";
    c.innerHTML = '<div class="t"><b></b> <span></span> <span class="b"></span></div><a class="go"></a><button type="button" aria-label="Dismiss">&times;</button>';
    c.querySelector("b").textContent = copy.h;
    c.querySelectorAll("span")[0].textContent = copy.s;
    c.querySelector(".b").textContent = (!hereFree && !otherFree) ? "" : (plans[HERE] && !plans[OTHER] ? "Have both on the same plan and save 10%." : "");
    var go = c.querySelector("a.go"); go.textContent = copy.go;
    if (copy.act === "plans") { go.href = "#"; go.addEventListener("click", function (e) { e.preventDefault(); openPlans(); }); } else go.href = copy.href;
    c.querySelector("button").addEventListener("click", function () { dismiss(kind); c.remove(); });
    var host;
    if (HERE === "reach") { host = document.getElementById("topbar"); if (host && host.parentNode) host.parentNode.insertBefore(c, host); }
    else { host = document.querySelector("header.topbar"); if (host && host.parentNode) host.parentNode.insertBefore(c, host.nextSibling); }
  }

  function checkoutNote() {
    var m = /[?&]checkout=(success|cancelled)/.exec(location.search); if (!m || HERE !== "reach") return;
    var d = document.createElement("div"); d.className = "xp-card"; d.innerHTML = '<div class="t"><b></b> <span></span></div><button type="button" aria-label="Dismiss">&times;</button>';
    d.querySelector("b").textContent = m[1] === "success" ? "Thank you — your plan is being activated." : "Checkout cancelled.";
    d.querySelectorAll("span")[0].textContent = m[1] === "success" ? "It can take a few seconds to appear. Refresh if your plan still shows Free." : "No charge was made.";
    d.querySelector("button").onclick = function () { d.remove(); };
    var h = document.getElementById("topbar"); if (h && h.parentNode) h.parentNode.insertBefore(d, h);
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }
  var state = { plans: { __known: false }, meta: null };
  function userMeta(tok) { return fetch(SB + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + tok } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) { return (u && u.user_metadata) || {}; }).catch(function () { return {}; }); }
  function saveHome(v) {
    var tok = token(); if (!tok) return Promise.reject(new Error("Please sign in again."));
    return fetch(SB + "/auth/v1/user", { method: "PUT", headers: { apikey: KEY, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ data: { fa_home: v || "" } }) })
      .then(function (r) { if (!r.ok) throw new Error("Couldn't save"); state.meta = Object.assign({}, state.meta || {}, { fa_home: v || "" }); addPin(); });
  }
  function hasBoth(p) { return !!(p && p.__known && p.content && p.reach); }
  window.xpHome = { get: function () { return (state.meta && state.meta.fa_home) || ""; }, set: saveHome, both: function () { return hasBoth(state.plans); } };
  /* After a sign-in: go to the module the person pays for; if both, to the start page they chose (else the one they asked for). */
  function pick(p, pref, asked) {
    if (p.content && p.reach) return pref === "reach" || pref === "content" ? pref : (asked || "content");
    if (p.content) return "content"; if (p.reach) return "reach";
    return pref === "reach" || pref === "content" ? pref : (asked || "content");
  }
  function addPin() {
    var old = document.getElementById("xpPin"); if (old) old.remove();
    var sw = document.getElementById("xpSw"); if (!sw || !hasBoth(state.plans)) return;
    var on = window.xpHome.get() === HERE, b = document.createElement("button");
    b.id = "xpPin"; b.type = "button"; b.className = "xp-pin" + (on ? " on" : ""); b.textContent = on ? "\u2605" : "\u2606";
    b.title = on ? "This is your start page. Click to open whichever module you used last." : "Open " + NAMES[HERE] + " first when I sign in";
    b.addEventListener("click", function () { saveHome(on ? "" : HERE).catch(function () {}); });
    sw.parentNode.insertBefore(b, sw.nextSibling);
  }
  function paint() { css(); addSwitch(state.plans); addCard(state.plans); addPin(); }
  function run() {
    css(); addSwitch(state.plans);              /* the switch always appears; plan tags and cards follow once the plan is known */
    var tok = token(); if (!tok) return;
    var pend = null; try { pend = JSON.parse(localStorage.getItem("fa_login_pending") || "null"); } catch (e) {}
    if (pend && Date.now() - pend.t > 15 * 60000) { pend = null; try { localStorage.removeItem("fa_login_pending"); } catch (e) {} }
    Promise.all([
      fetch(SB + "/rest/v1/rpc/ar_my_plans", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: "{}" }).then(function (r) { return r.ok ? r.json() : null; }),
      userMeta(tok)
    ]).then(function (res) {
        var p = res[0]; if (!p) return;
        p.__known = true; state.plans = p; state.meta = res[1] || {};
        if (pend) {
          try { localStorage.removeItem("fa_login_pending"); } catch (e) {}
          var dest = pick(p, state.meta.fa_home, pend.next);
          if (dest !== HERE) { location.replace(dest === "reach" ? "/reach/" : "/dashboard/"); return; }
        }
        paint(); paintWsAvatar(); checkoutNote(); if (HERE === "reach") loadProg();
        window.__xpromo = { plans: p };
        var want = takeIntent(); if (want) setTimeout(function () { openPlans(want); }, 400);
      }).catch(function () {});
  }


  /* ===== One account menu + one module menu, identical in Content and Reach =====
     The account menu (avatar): who you are, the Content | Reach switch, your account, theme, legal, log out.
     The module menu (sliders button): only what belongs to the module you are in.
     Content's own menu is built by the dashboard; we open it invisibly and press its buttons, so nothing there is duplicated. */
  var PAL = {
    dark:  { panel: "#181d15", line: "#2c3428", ink: "#ece6d6", muted: "#949d8d", hover: "#1f251b", gold: "#e8a33d", goldInk: "#241a06", soft: "rgba(232,163,61,.16)", red: "#e06a52" },
    light: { panel: "#fffdf8", line: "#ddd6c5", ink: "#1c2018", muted: "#666d5e", hover: "#f0ece1", gold: "#c07f17", goldInk: "#fffaf0", soft: "rgba(192,127,23,.14)", red: "#b8452f" }
  };
  function themeNow() { var a = document.documentElement.getAttribute("data-theme"); if (a === "light" || a === "dark") return a; return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
  /* The floating Alchemist helper: same avatar in Content and Reach; each person can hide it from the account menu (kept in this browser, shared by both modules). */
  function alchHidden() { try { return localStorage.getItem("fm-hide-alchemist") === "1"; } catch (e) { return false; } }
  function applyAlch() {
    try {
      document.documentElement.classList.toggle("fm-no-alch", alchHidden());
      if (!document.getElementById("fmBrandLook")) {
        var bl = document.createElement("style"); bl.id = "fmBrandLook";
        bl.textContent = "#homeLink img,#topnav .tn-brand img{width:28px!important;height:28px!important}#homeLink,#topnav .tn-brand{font-family:Fraunces,Georgia,serif;font-size:18px;font-weight:600}";
        document.head.appendChild(bl);
      }
      if (!document.getElementById("fmAlchLook")) {
        var lk = document.createElement("style"); lk.id = "fmAlchLook";
        var gold = "color-mix(in srgb,var(--gold,var(--accent)) 55%,transparent)";
        lk.textContent = "#alcBtn .alcAv{box-shadow:0 0 0 3px var(--surface),0 0 0 5px " + gold + "}" +
          "@media (min-width:701px){#alcBtn{padding:8px 18px 8px 8px!important;gap:10px!important;font-weight:700!important;font-size:15px!important;border-color:" + gold + "!important}#alcBtn .alcAv{width:44px!important;height:44px!important}}" +
          "";
        document.head.appendChild(lk);
      }
      if (!document.getElementById("fmAlchCss")) { var st = document.createElement("style"); st.id = "fmAlchCss"; st.textContent = "html.fm-no-alch #alchFab,html.fm-no-alch #alcBtn{display:none!important}"; document.head.appendChild(st); }
    } catch (e) {}
  }
  function setAlchHidden(v) { try { localStorage.setItem("fm-hide-alchemist", v ? "1" : "0"); } catch (e) {} applyAlch(); }
  function hfHidden() { try { return localStorage.getItem("fm-hide-handsfree") === "1"; } catch (e) { return false; } }
  function setHfHidden(v) { try { localStorage.setItem("fm-hide-handsfree", v ? "1" : "0"); } catch (e) {} if (window.fmHfApply) window.fmHfApply(); }
  applyAlch();
  /* ===== Info icons (2026-11-07): a small "i" next to labels that need a word of explanation, in Content and Reach.
     Each person can hide them all from Preferences (kept in this browser). Text comes from data-info="..." on an element,
     or from the list below, matched on the label's text. Nothing here changes layout when hidden. ===== */
  function infoHidden() { try { return localStorage.getItem("fm-hide-info") === "1"; } catch (e) { return false; } }
  var INFO = [
    [/^Where posts link/i, "The page your posts send people to, usually your website or a product page. It is also the page we tag and track."],
    [/^News or blog page/i, "A page the Alchemist can read for fresh news and updates to write about."],
    [/^Where the Alchemist looks for ideas/i, "Pages the Alchemist reads for ideas: your site, news and profiles. It only uses what it can verify."],
    [/^Where this brand posts/i, "Add the accounts this brand posts to, and only those. Reminders, captions and auto-post only cover these accounts."],
    [/^Logo image address/i, "A direct link to your logo image. It is placed on your cards."],
    [/^Look$/i, "The style, typefaces and colours used on every card for this brand."],
    [/^Character$/i, "A mascot or person who can appear in your images, kept looking the same."],
    [/^Show the character doing new things/i, "Lets the Alchemist draw your character in new places or poses that match each post, instead of reusing one image."],
    [/^Who it.s for/i, "Your audience. The Alchemist writes in a way that suits them."],
    [/^How it should sound/i, "The voice of your brand, in a few words: friendly, bold, calm."],
    [/^Facts it may use/i, "Real facts about your brand. The Alchemist never invents facts; it only uses these and what is on your site."],
    [/^Never do this/i, "Things the Alchemist must never write or show for this brand."],
    [/^Your own rules/i, "Your standing rules for every post, like words to avoid."],
    [/^Hashtags every post must include/i, "Hashtags that will be added to every post for this brand."],
    [/^Campaign name/i, "A name for this batch of posts. Used for tracking and for finding it later."],
    [/^How many( posts)?$/i, "How many posts to make. Each one uses credits."],
    [/^Format$/i, "Single image, carousel or a mix. Carousels use more credits."],
    [/^Caption length/i, "How long the written part of each post should be."],
    [/^QR code/i, "Adds a scannable code to the image that opens your link."],
    [/^Location tag/i, "A place name to tag on the post, shown where the network supports it."],
    [/^People and brands to tag/i, "Accounts to @mention in posts. Each network gets the right handle for it."],
    [/^Link works for/i, "Which campaigns this link is used in."],
    [/^How should I use this link/i, "Tell the Alchemist what the link is for so the posts around it make sense."],
    [/^Send people to/i, "Where the call to action in your posts points."],
    [/^Event date/i, "The date of the event. Posts are timed around it."],
    [/^Finish by/i, "The latest date you want posts for this campaign to go out."],
    [/^Look back at/i, "How far back the Alchemist looks for news and results."],
    [/^Live post link/i, "The web address of the live post. Paste it once it is posted. It proves the post went out and counts it as posted."],
    [/^Pinterest board/i, "The board your pins are saved to."],
    [/^Metricool (template|brand name)/i, "Matches the export to your Metricool setup."],
    [/^How should Claude post/i, "In your own signed-in Chrome, like you do by hand, or scheduled through your Metricool."],
    [/^Accounts for /i, "These come from your Brand settings. Tick the ones you are signed in to in this Chrome. Claude checks it is exactly that account before posting."],
    [/^Your Claude link/i, "A private link that lets your own Claude fetch the posts you sent. Keep it private. You can make a new one any time."],
    [/^Most posts per day/i, "A safety limit. Claude will not post more than this in one day."],
    [/^Pause between posts/i, "Waiting time between posts, so it looks natural and stays within network limits."],
    [/^Posts from$/i, "Which campaign's approved posts to send to Claude."],
    [/^Post at/i, "The time used when a post has no time of its own."],
    [/^Queue$/i, "Posts waiting for Claude, and what happened to the ones it has handled."],
    [/^Daily send ramp/i, "Sending many messages on day one can get your mailbox flagged. Reach warns you when a day goes above this number."],
    [/^Max sends per day/i, "The most messages Reach will send for you in one day."],
    [/^Default sender mailbox/i, "The email address Reach sends from. Claude checks it is signed in to exactly this address before sending."],
    [/^Email signature/i, "Added to the end of every message Reach sends for you."],
    [/^My name in messages/i, "The name used when a message says who it is from."],
    [/^Best send window/i, "When this contact is most likely to read a message."],
    [/^Fit score/i, "How well this target matches your brand, from 1 (poor) to 10 (excellent)."],
    [/^(Min|Max) audience/i, "Limits on the size of the audience a target should have."],
    [/^Monthly budget/i, "What you are happy to spend on placements each month."],
    [/^Budget cap per placement/i, "The most you will pay for a single placement."],
    [/^Free coverage quota/i, "How many free listings or features you want to aim for."],
    [/^Contact source/i, "Where the contact details came from, so you can trust or recheck them."],
    [/^How you verified it/i, "How you confirmed the details are correct."],
    [/^Intro type/i, "The style of the first message: a quick hello, a pitch, or a request."],
    [/^Extra criteria/i, "Anything else a target must match, in your own words."],
    [/^(Types of target|Channel types)/i, "The kinds of places to look for: blogs, newsletters, directories, creators."],
    [/^Deal history/i, "Past dealings with this contact, and any risk the relationship may not renew."],
    [/^Coverage type/i, "What you are asking for: a review, a listing, a mention, a feature."],
    [/^Confirm to send/i, "A safety step so nothing goes out by accident."],
    [/^Latest news/i, "A page Reach can read to find something recent to mention."],
    [/^Official site/i, "The brand's own website."],
    [/^Copy for the form/i, "The text Claude pastes into a website contact form."],
    [/^Note for buyers/i, "A short note shown to anyone who looks at this deal."]
  ];
  var infoPop = null, infoBtn = null;
  function infoClose() { if (infoPop) { infoPop.remove(); infoPop = null; } if (infoBtn) { infoBtn.setAttribute("aria-expanded", "false"); infoBtn = null; } }
  function infoOpen(btn, text) {
    var same = infoBtn === btn; infoClose(); if (same) return;
    var p = PAL[themeNow()] || PAL.dark, d = document.createElement("div");
    d.className = "fm-info-pop"; d.setAttribute("role", "tooltip"); d.textContent = text;
    d.style.cssText = "position:fixed;z-index:2147483000;max-width:min(300px,calc(100vw - 24px));padding:10px 12px;border-radius:10px;font:400 13px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35);background:" + p.panel + ";color:" + p.ink + ";border:1px solid " + p.line;
    document.body.appendChild(d);
    var r = btn.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
    var left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    var top = r.bottom + 8; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    d.style.left = Math.round(left) + "px"; d.style.top = Math.round(top) + "px";
    infoPop = d; infoBtn = btn; btn.setAttribute("aria-expanded", "true");
  }
  function infoCss() {
    if (document.getElementById("fmInfoCss")) return;
    var s = document.createElement("style"); s.id = "fmInfoCss";
    s.textContent = ".fm-info{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:16px;height:16px;min-width:16px;margin:0 0 0 6px;padding:0;border:1px solid currentColor;border-radius:50%;background:transparent;color:inherit;font:italic 600 10px/1 Georgia,serif;opacity:.5;cursor:pointer;vertical-align:text-bottom;text-transform:none;letter-spacing:0}" +
      ".fm-info:hover,.fm-info:focus-visible{opacity:1;outline:none}.fm-info:focus-visible{box-shadow:0 0 0 2px var(--gold,#e8a33d)}" +
      "html.fm-no-info .fm-info,html.fm-no-info .fm-info-pop{display:none!important}";
    document.head.appendChild(s);
  }
  function infoAdd(el, text) {
    if (!el || el.getAttribute("data-fm-i") || !text) return;
    el.setAttribute("data-fm-i", "1");
    var b = document.createElement("button"); b.type = "button"; b.className = "fm-info"; b.textContent = "i";
    b.setAttribute("aria-label", "More info"); b.setAttribute("aria-expanded", "false"); b.title = "More info";
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); infoOpen(b, text); });
    el.appendChild(b);
  }
  function infoScan() {
    if (infoHidden()) return;
    infoCss();
    var i, n, els = document.querySelectorAll("[data-info]:not([data-fm-i])");
    for (i = 0; i < els.length; i++) infoAdd(els[i], els[i].getAttribute("data-info"));
    els = document.querySelectorAll("label:not([data-fm-i]),.label:not([data-fm-i]),legend:not([data-fm-i])");
    for (i = 0; i < els.length; i++) {
      var el = els[i]; if (el.closest(".fm-info-pop")) continue;
      var t = (el.textContent || "").replace(/\s+/g, " ").trim(); if (t.length < 3 || t.length > 90) continue;
      for (n = 0; n < INFO.length; n++) if (INFO[n][0].test(t)) { infoAdd(el, INFO[n][1]); break; }
    }
  }
  function applyInfo() {
    document.documentElement.classList.toggle("fm-no-info", infoHidden());
    if (infoHidden()) infoClose(); else infoScan();
  }
  function setInfoHidden(v) { try { localStorage.setItem("fm-hide-info", v ? "1" : "0"); } catch (e) {} applyInfo(); }
  (function () {
    var tm = 0;
    function later() { clearTimeout(tm); tm = setTimeout(infoScan, 350); }
    function start() { applyInfo(); try { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); } catch (e) {} }
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    document.addEventListener("click", function (e) { if (infoPop && !(e.target.closest && (e.target.closest(".fm-info") || e.target.closest(".fm-info-pop")))) infoClose(); }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") infoClose(); });
    window.addEventListener("scroll", infoClose, true); window.addEventListener("resize", infoClose);
  })();
  var fmBypass = false;
  function fmCss() {
    if (document.getElementById("fmCss")) return;
    var s = document.createElement("style"); s.id = "fmCss";
    s.textContent =
      ".fm-menu{position:fixed;z-index:99990;width:min(300px,calc(100vw - 24px));max-height:calc(100vh - 84px);overflow:auto;box-sizing:border-box;background:var(--fm-panel);border:1px solid var(--fm-line);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:8px;color:var(--fm-ink);font:14px/1.3 'IBM Plex Sans',-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}" +
      ".fm-menu *{box-sizing:border-box}" +
      ".fm-head{padding:8px 10px 10px}.fm-head b{display:block;font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".fm-head span{display:block;margin-top:2px;font-size:12px;color:var(--fm-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".fm-sw{display:grid;grid-template-columns:1fr 1fr;gap:3px;margin:0 2px 8px;padding:3px;border:1px solid var(--fm-line);border-radius:999px}" +
      ".fm-sw a{display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 6px;border-radius:999px;color:var(--fm-muted);text-decoration:none;font-weight:600;font-size:13px;min-width:0;white-space:nowrap}" +
      ".fm-sw a:hover{color:var(--fm-ink)}.fm-sw a.on{background:var(--fm-gold);color:var(--fm-goldInk);cursor:default}" +
      ".fm-sw a i{font-style:normal;font-weight:600;font-size:9px;line-height:1;letter-spacing:.07em;text-transform:uppercase;padding:2px 6px;border-radius:99px;background:rgba(128,128,128,.22)}.fm-sw a.on i{background:rgba(0,0,0,.16)}" +
      ".fm-i{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:0;border-radius:9px;background:none;color:var(--fm-ink);font:inherit;font-size:14px;font-weight:500;text-align:left;cursor:pointer;text-decoration:none}" +
      ".fm-i:hover,.fm-i:focus-visible{background:var(--fm-hover);outline:none}.fm-i .mini{margin-left:auto;color:var(--fm-muted);font-size:12px}.fm-i.out{color:var(--fm-red)}" +
      ".fm-sep{height:1px;background:var(--fm-line);margin:6px 4px}" +
      ".fm-st{display:flex;align-items:center;gap:8px;padding:6px 10px;font-weight:500;white-space:nowrap}.fm-st .seg{margin-left:auto;display:flex;gap:3px}" +
      ".fm-st .seg button{border:1px solid var(--fm-line);border-radius:7px;background:none;color:var(--fm-ink);font:inherit;font-size:12px;font-weight:600;padding:4px 7px;cursor:pointer}.fm-st .seg button.on{background:var(--fm-soft);border-color:var(--fm-gold)}" +
      ".fm-legal{display:flex;gap:16px;padding:8px 10px 4px;font-size:12px}.fm-legal a{color:var(--fm-muted);text-decoration:none}.fm-legal a:hover{color:var(--fm-ink)}" +
      ".fm-sec{padding:8px 10px 2px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--fm-muted)}" +
      ".xp-hb{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:1px solid rgba(128,128,128,.28);border-radius:10px;background:transparent;color:inherit;opacity:.85;cursor:pointer;flex:0 0 auto}.xp-hb:hover{opacity:1;border-color:rgba(128,128,128,.55)}" +
      ".xp-mod{display:inline-flex;align-items:center;font:600 10.5px/1 'IBM Plex Sans',-apple-system,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--gold,var(--accent,#e8a33d));border:1px solid currentColor;border-radius:999px;padding:5px 10px;white-space:nowrap;margin:0 4px;flex:0 0 auto}" +
      ".xp-rank{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px 0 6px;border:1px solid rgba(128,128,128,.28);border-radius:999px;background:transparent;color:inherit;font:600 12.5px 'IBM Plex Sans',-apple-system,system-ui,sans-serif;cursor:pointer;white-space:nowrap;flex:0 0 auto}.xp-rank:hover{border-color:rgba(128,128,128,.55)}" +
      ".xp-rank svg{width:26px;height:26px}.xp-rank .rk{max-width:110px;overflow:hidden;text-overflow:ellipsis}" +
      "#xpDrawer{position:fixed;top:0;right:0;bottom:0;z-index:99991;width:min(440px,100vw);overflow:auto;background:var(--fm-panel);color:var(--fm-ink);border-left:1px solid var(--fm-line);box-shadow:-18px 0 50px rgba(0,0,0,.35);padding:20px 20px 40px;font:14px/1.4 'IBM Plex Sans',-apple-system,system-ui,sans-serif;box-sizing:border-box}" +
      "#xpDrawer h2{margin:0 0 2px;font:600 24px/1.2 Fraunces,Georgia,serif}#xpDrawer .x{position:absolute;top:12px;right:14px;background:none;border:0;color:var(--fm-muted);font-size:26px;cursor:pointer}" +
      "#xpDrawer .sub{color:var(--fm-muted);font-size:13px;margin:0 0 14px}#xpDrawer .bar{height:8px;border-radius:99px;background:var(--fm-hover);overflow:hidden;margin:8px 0 6px}#xpDrawer .bar i{display:block;height:100%;background:var(--fm-gold);border-radius:99px}" +
      "#xpDrawer .lock{margin:8px 0 0;padding:9px 11px;border:1px solid var(--fm-gold);border-radius:10px;background:var(--fm-soft);font-size:13px}" +
      "#xpDrawer .split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}#xpDrawer .split div{border:1px solid var(--fm-line);border-radius:12px;padding:10px 12px}#xpDrawer .split b{display:block;font-size:20px}#xpDrawer .split span{font-size:12px;color:var(--fm-muted)}" +
      "#xpDrawer h3{margin:20px 0 8px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--fm-muted)}" +
      "#xpDrawer .q{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--fm-line)}#xpDrawer .q span:last-child{margin-left:auto;color:var(--fm-muted);font-size:12px;white-space:nowrap}#xpDrawer .q.done span:first-child{text-decoration:line-through;color:var(--fm-muted)}" +
      "#xpDrawer .bg{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}#xpDrawer .b{border:1px solid var(--fm-line);border-radius:12px;padding:10px 12px;min-width:0}#xpDrawer .b.on{border-color:var(--fm-gold);background:var(--fm-soft)}#xpDrawer .b b{display:block;font-size:13px}#xpDrawer .b span{font-size:12px;color:var(--fm-muted)}#xpDrawer .b.off b{color:var(--fm-muted)}" +
      "#xpDrawer .rl{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:var(--fm-muted)}#xpDrawer .rl.on{color:var(--fm-ink);font-weight:600}" +
      "@media (max-width:700px){#xpRank,.xp-rank{display:none!important}#topnav>*{flex-shrink:0}#topnav>#bsw{flex-shrink:1;min-width:0}#bsBtn{max-width:104px}}" +
      ".fm-dt>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:10px;border-radius:9px;cursor:pointer;font-size:14px;font-weight:500}.fm-dt>summary::-webkit-details-marker{display:none}.fm-dt>summary:hover{background:var(--fm-hover)}.fm-dt>summary:after{content:'\\25B8';margin-left:auto;color:var(--fm-muted);font-size:12px}.fm-dt[open]>summary:after{content:'\\25BE'}.fm-dt>.fm-i,.fm-dt>.fm-st{margin-left:10px;width:calc(100% - 10px)}" +
      ".fm-rp{position:fixed;inset:0;z-index:99995;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.5)}.fm-rpb{position:relative;width:min(480px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--fm-panel);color:var(--fm-ink);border:1px solid var(--fm-line);border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.45);font:14px/1.5 'IBM Plex Sans',-apple-system,system-ui,sans-serif}" +
      ".fm-rpb h3{margin:0 0 4px;font:600 22px/1.2 Fraunces,Georgia,serif}.fm-rpb .fm-x{position:absolute;top:10px;right:12px;background:none;border:0;color:var(--fm-muted);font-size:26px;cursor:pointer;line-height:1}.fm-rps{margin:0 0 12px;color:var(--fm-muted);font-size:13px}" +
      ".fm-rpb label{display:block;margin:10px 0 4px;font-size:12px;color:var(--fm-muted)}.fm-rpb select,.fm-rpb input,.fm-rpb textarea{width:100%;font:inherit;color:var(--fm-ink);background:var(--fm-hover);border:1px solid var(--fm-line);border-radius:9px;padding:8px 10px}.fm-rpb textarea{resize:vertical}" +
      ".fm-rpf{display:flex;align-items:center;gap:10px;margin-top:14px}.fm-rpf span{flex:1;font-size:13px;color:var(--fm-muted)}.fm-rpf span.err{color:var(--fm-red)}.fm-rpf span.ok{color:var(--fm-ink)}.fm-rpg{border:0;border-radius:9px;background:var(--fm-gold);color:var(--fm-goldInk);font:inherit;font-weight:600;padding:9px 14px;cursor:pointer}.fm-rpg:disabled{opacity:.6;cursor:default}" +
      ".fm-rph{margin:18px 0 6px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--fm-muted)}.fm-rpt{padding:8px 0;border-top:1px solid var(--fm-line)}.fm-rpr{display:flex;gap:8px;align-items:flex-start}.fm-rpn{font-size:13px;min-width:0;overflow-wrap:anywhere}.fm-pill{flex:0 0 auto;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--fm-hover);color:var(--fm-muted)}.fm-pill.in_progress{background:var(--fm-soft);color:var(--fm-gold)}.fm-pill.resolved{background:var(--fm-gold);color:var(--fm-goldInk)}.fm-rpy{margin:6px 0 0 0;padding:8px 10px;border-radius:9px;background:var(--fm-soft);font-size:13px;white-space:pre-wrap}.fm-rpy.me{background:var(--fm-hover)}.fm-rpy b{display:block;font-size:11px;color:var(--fm-muted);font-weight:600}.fm-rpl{margin-top:6px;border:0;background:none;color:var(--fm-gold);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;padding:0}.fm-rpt textarea{margin-top:6px}.fm-rpt .fm-rpg{margin-top:6px}" +
      "#themeBtn{display:none!important}";
    document.head.appendChild(s);
  }
  function emailNow() { var t = token(), p = t && jwt(t); return (p && p.email) || ""; }

  /* Workspace avatar (2026-10-30): the account button at top right shows the WORKSPACE (agency or company), not the brand being worked on.
     Image or initials. Stored in the signed-in user's metadata (ws_avatar, ws_name) so Content and Reach show the same one. */
  function wsInitials() {
    var n = (state.meta && state.meta.ws_name) || ((window.xpHostInfo && window.xpHostInfo().workspace) || "") || emailNow().split("@")[0] || "?";
    n = String(n).replace(/\(.*?\)/g, " ").replace(/[^A-Za-z0-9À-ɏ\s._-]/g, "");
    var parts = n.split(/[\s._-]+/).filter(Boolean);
    return ((parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2)) || "?").toUpperCase();
  }
  function avCss() {
    if (document.getElementById("fmAvCss")) return;
    var s = document.createElement("style"); s.id = "fmAvCss";
    s.textContent = ".xp-av{width:28px;height:28px;border-radius:50%;object-fit:cover;display:block;flex:0 0 auto}.xp-ini{display:grid;place-items:center;font:700 12px/1 system-ui,sans-serif;letter-spacing:.02em;background:var(--accent,var(--gold,#c8923a));color:var(--bg,#111)}";
    document.head.appendChild(s);
  }
  function paintWsAvatar() {
    var a = acctEl(); if (!a) return;
    avCss();
    var url = state.meta && state.meta.ws_avatar, ini = wsInitials(), key = url ? "img:" + url : "ini:" + ini;
    if (a.getAttribute("data-xpav") === key && a.querySelector(".xp-av")) return;
    var el;
    function initialsEl() { var sp = document.createElement("span"); sp.className = "xp-av xp-ini"; sp.textContent = ini; return sp; }
    if (url && /^https:\/\//.test(url)) { el = document.createElement("img"); el.className = "xp-av"; el.alt = ""; el.src = url; el.addEventListener("error", function () { if (el.parentNode) el.parentNode.replaceChild(initialsEl(), el); }); }
    else el = initialsEl();
    a.innerHTML = ""; a.appendChild(el); a.setAttribute("data-fmicon", "1"); a.setAttribute("data-xpav", key);
    a.setAttribute("title", "Workspace: " + ((state.meta && state.meta.ws_name) || (window.xpHostInfo && window.xpHostInfo().workspace) || emailNow()));
  }
  function saveWsMeta(obj) {
    var tok = token(); if (!tok) return Promise.reject(new Error("Please sign in again."));
    return fetch(SB + "/auth/v1/user", { method: "PUT", headers: { apikey: KEY, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ data: obj }) })
      .then(function (r) { if (!r.ok) throw new Error("Couldn't save"); state.meta = Object.assign({}, state.meta || {}, obj); paintWsAvatar(); });
  }
  function squareBlob(file, size) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { var c = document.createElement("canvas"); c.width = c.height = size; var x = c.getContext("2d"), m = Math.min(im.width, im.height);
        x.drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, size, size); URL.revokeObjectURL(u);
        c.toBlob(function (b) { b ? res(b) : rej(new Error("Couldn't read that image")); }, "image/png"); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("That file isn't an image I can read.")); };
      im.src = u;
    });
  }
  function say(m) { try { if (typeof window.toast === "function") window.toast(m); else console.log(m); } catch (e) {} }
  function pickWsAvatar() {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp";
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var tok = token(), p = tok && jwt(tok); if (!p || !p.sub) { say("Please sign in again."); return; }
      say("Saving your workspace avatar…");
      squareBlob(f, 192).then(function (blob) {
        var path = p.sub + "/workspace-" + Date.now() + ".png";
        return fetch(SB + "/storage/v1/object/avatars/" + path, { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + tok, "content-type": "image/png" }, body: blob })
          .then(function (r) { if (!r.ok) throw new Error("Couldn't upload the image."); return SB + "/storage/v1/object/public/avatars/" + path; });
      }).then(function (url) { return saveWsMeta({ ws_avatar: url }); })
        .then(function () { say("Workspace avatar saved."); })
        .catch(function (e) { say((e && e.message) || "Couldn't save the avatar."); });
    };
    inp.click();
  }
  function removeWsAvatar() { saveWsMeta({ ws_avatar: "" }).then(function () { say("Workspace avatar removed."); }).catch(function (e) { say((e && e.message) || "Couldn't remove it."); }); }
  window.xpWsAvatar = { pick: pickWsAvatar, remove: removeWsAvatar, setName: function (n) { n = String(n || "").slice(0, 80); if (n === ((state.meta && state.meta.ws_name) || "")) return Promise.resolve(); return saveWsMeta({ ws_name: n }).catch(function () {}); }, url: function () { return (state.meta && state.meta.ws_avatar) || ""; } };
  function tagRegion(tries) {
    try {
      if (localStorage.getItem("fm-tz-sent") === "1") return;
      var tok = token(); if (!tok) { if ((tries || 0) < 3) setTimeout(function () { tagRegion((tries || 0) + 1); }, 6000); return; }
      var p = jwt(tok), um = (p && p.user_metadata) || {};
      if (um.tz) { localStorage.setItem("fm-tz-sent", "1"); return; }
      var tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
      if (!tz) return;
      saveWsMeta({ tz: tz, lang: String(navigator.language || "").slice(0, 12) }).then(function () { localStorage.setItem("fm-tz-sent", "1"); }).catch(function () {});
    } catch (e) {}
  }
  setTimeout(tagRegion, 4000);
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function closeFm() { var m = document.getElementById("fmMenu"); if (m) m.remove(); }
  function nativeBtns() {
    var acct = document.getElementById("acctBtn"); if (!acct) return { m: null, list: [] };
    fmBypass = true; try { acct.click(); } finally { fmBypass = false; }
    var m = document.querySelector("div.menu"); if (m) m.style.visibility = "hidden";
    return { m: m, list: m ? [].slice.call(m.querySelectorAll("button,a")) : [] };
  }
  function nativePress(re) {
    var n = nativeBtns(), b = n.list.filter(function (x) { return re.test(x.textContent.trim()); })[0];
    if (b) b.click();
    setTimeout(function () { var mm = document.querySelector("div.menu"); if (mm) mm.remove(); }, 0);
    return !!b;
  }
  function globalSignOut() {
    var tok = token();
    try { Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k) || k === "fa_login_pending") localStorage.removeItem(k); }); } catch (e) {}
    if (tok) { try { fetch(SB + "/auth/v1/logout?scope=global", { method: "POST", keepalive: true, headers: { apikey: KEY, Authorization: "Bearer " + tok } }).catch(function () {}); } catch (e) {} }
  }
  function moduleItems() {
    var items = [];
    if (HERE === "reach") return (window.xpModuleItems && window.xpModuleItems()) || [];
    return items;
  }
  var ADMIN_MAILS = ["brad@unitedpress.media"];
  var adminKnown = null;
  function checkAdmin() {
    try {
      var c = sessionStorage.getItem("fm-is-admin"); if (c === "1" || c === "0") { adminKnown = c === "1"; return; }
      var tok = token(); if (!tok) return;
      fetch(SB + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + tok } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
        if (!u) return;
        var ok = ADMIN_MAILS.indexOf(String(u.email || "").toLowerCase()) >= 0 || (u.identities || []).some(function (i) { return i && i.provider === "google" && i.identity_data && i.identity_data.email_verified === true && ADMIN_MAILS.indexOf(String(i.identity_data.email || "").toLowerCase()) >= 0; });
        adminKnown = ok; sessionStorage.setItem("fm-is-admin", ok ? "1" : "0");
      }).catch(function () {});
    } catch (e) {}
  }
  setTimeout(checkAdmin, 1500);
  /* Report a problem (2026-10-31): the same form in Content and Reach. Posts to the `support` function; shows the reporter's own reports with our status and reply. */
  function fmReport() {
    closeFm(); fmCss();
    var was = document.getElementById("fmRp"); if (was) was.remove();
    var tok = token(); if (!tok) { say("Please sign in again."); return; }
    var pal = PAL[themeNow()], o = document.createElement("div"); o.id = "fmRp"; o.className = "fm-rp";
    Object.keys(pal).forEach(function (k) { o.style.setProperty("--fm-" + k, pal[k]); });
    var KINDS = [["bug", "Something isn’t working"], ["content", "A post or result came out wrong"], ["billing", "Billing or credits"], ["feature", "An idea or request"], ["question", "A question"], ["other", "Something else"]];
    var ST = { open: "Open", in_progress: "Working on it", resolved: "Resolved", wont_fix: "Closed" };
    o.innerHTML = '<div class="fm-rpb" role="dialog" aria-modal="true" aria-label="Report a problem"><button type="button" class="fm-x" data-x aria-label="Close">×</button><h3>Report a problem</h3>' +
      '<p class="fm-rps">Goes straight to the team. We add the page and browser for you, and tell you here and by email when it changes.</p>' +
      '<label for="fmRpK">What kind of problem?</label><select id="fmRpK">' + KINDS.map(function (k) { return '<option value="' + k[0] + '">' + esc(k[1]) + "</option>"; }).join("") + "</select>" +
      '<label for="fmRpS">In a few words</label><input id="fmRpS" maxlength="300" placeholder="e.g. The download button does nothing on my phone">' +
      '<label for="fmRpD">What happened? (optional)</label><textarea id="fmRpD" maxlength="5000" rows="4" placeholder="What you did, what you expected, what you saw instead."></textarea>' +
      '<div class="fm-rpf"><span id="fmRpM"></span><button type="button" class="fm-rpg" id="fmRpG">Send to the team</button></div><div id="fmRpL"></div></div>';
    document.body.appendChild(o);
    function close() { o.remove(); document.removeEventListener("keydown", onKey, true); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey, true);
    o.addEventListener("click", function (e) { if (e.target === o || e.target.closest("[data-x]")) close(); });
    var sum = o.querySelector("#fmRpS"), msg = o.querySelector("#fmRpM"), go = o.querySelector("#fmRpG");
    setTimeout(function () { sum.focus(); }, 60);
    function call(body) { return fetch(SB + "/functions/v1/support", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + (token() || tok), "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "Couldn’t reach the team just now."); return j; }); }); }
    function mine() {
      call({ action: "mine" }).then(function (r) {
        var box = o.querySelector("#fmRpL"); box.innerHTML = ""; var t = (r.tickets || []).slice(0, 6); if (!t.length) return;
        var h = document.createElement("div"); h.className = "fm-rph"; h.textContent = "Your reports"; box.appendChild(h);
        t.forEach(function (x) {
          var row = document.createElement("div"); row.className = "fm-rpt";
          var top = document.createElement("div"); top.className = "fm-rpr";
          var pill = document.createElement("span"); pill.className = "fm-pill " + x.status; pill.textContent = ST[x.status] || "Open";
          var s = document.createElement("span"); s.className = "fm-rpn"; s.textContent = "#" + x.ticket_no + " \u00b7 " + x.summary;
          top.appendChild(pill); top.appendChild(s); row.appendChild(top);
          var th = (x.messages || []).slice();
          if (!th.length && x.reply) th.push({ role: "team", body: x.reply });
          th.forEach(function (m) { var rp = document.createElement("div"); rp.className = "fm-rpy" + (m.role === "user" ? " me" : ""); var who = document.createElement("b"); who.textContent = m.role === "user" ? "You" : "Alchemist support"; rp.appendChild(who); rp.appendChild(document.createTextNode(m.body)); row.appendChild(rp); });
          var more = document.createElement("button"); more.type = "button"; more.className = "fm-rpl"; more.textContent = "Reply";
          more.onclick = function () {
            more.remove(); var ta = document.createElement("textarea"); ta.rows = 2; ta.maxLength = 2000; ta.placeholder = "Add a message to this report"; var sb = document.createElement("button"); sb.type = "button"; sb.className = "fm-rpg"; sb.textContent = "Send";
            sb.onclick = function () { var v = ta.value.trim(); if (v.length < 2) return; sb.disabled = true; call({ action: "message", ticket_no: x.ticket_no, body: v }).then(function () { mine(); }).catch(function (e) { sb.disabled = false; msg.className = "err"; msg.textContent = e.message; }); };
            row.appendChild(ta); row.appendChild(sb); ta.focus();
          };
          row.appendChild(more);
          box.appendChild(row);
        });
      }).catch(function () {});
    }
    mine();
    go.onclick = function () {
      var summary = sum.value.trim(); if (summary.length < 3) { msg.textContent = "Tell us in a few words what went wrong."; msg.className = "err"; return; }
      var brand = ""; try { if (typeof S !== "undefined" && S && S.brand) brand = S.brand; } catch (e) {}
      go.disabled = true; msg.className = ""; msg.textContent = "Sending…";
      call({ action: "create", brand: brand, kind: o.querySelector("#fmRpK").value, summary: summary, details: o.querySelector("#fmRpD").value.trim(), context: { module: HERE, url: location.pathname, ua: navigator.userAgent.slice(0, 200), screen: innerWidth + "x" + innerHeight } })
        .then(function (r) { msg.className = "ok"; msg.textContent = "Sent — problem #" + r.ticket_no + ". We’ll update you here and by email."; sum.value = ""; o.querySelector("#fmRpD").value = ""; go.disabled = false; mine(); })
        .catch(function (e) { go.disabled = false; msg.className = "err"; msg.textContent = e.message; });
    };
  }
  window.fmReport = fmReport;
  function openMenu(kind, anchor) {
    if (window.xpCloseHostMenus) try { window.xpCloseHostMenus(); } catch (e) {}
    var was = document.getElementById("fmMenu"); if (was) { var same = was.getAttribute("data-kind") === kind; was.remove(); if (same) return; }
    fmCss();
    var pal = PAL[themeNow()], m = document.createElement("div"); m.id = "fmMenu"; m.className = "fm-menu"; m.setAttribute("data-kind", kind); m.setAttribute("role", "menu");
    Object.keys(pal).forEach(function (k) { m.style.setProperty("--fm-" + k, pal[k]); });
    var acts = [], html = "";
    function item(label, fn, o) { o = o || {}; acts.push(fn); var tag = o.href ? "a" : "button"; return "<" + tag + ' class="fm-i' + (o.cls ? " " + o.cls : "") + '" data-a="' + (acts.length - 1) + '"' + (o.href ? ' href="' + esc(o.href) + '"' + (o.blank ? ' target="_blank" rel="noopener"' : '') : ' type="button"') + ' role="menuitem">' + esc(label) + (o.mini ? '<span class="mini">' + esc(o.mini) + "</span>" : "") + "</" + tag + ">"; }
    if (kind === "account") {
      var host = (window.xpHostInfo && window.xpHostInfo()) || {}, plans = state.plans, isAd = ADMIN_MAILS.indexOf(emailNow().toLowerCase()) >= 0 || adminKnown === true || (function () { try { return sessionStorage.getItem("fm-is-admin") === "1"; } catch (e) { return false; } })();
      html += '<div class="fm-head"><b>' + esc(emailNow() || "Signed in") + "</b>" + (host.workspace ? "<span>" + esc(host.workspace) + "</span>" : "") + "</div>";
      html += '<div class="fm-sw">' + ["content", "reach"].map(function (k) {
        var t = tagOf(plans, k), on = k === HERE;
        return '<a href="' + (k === "content" ? "/dashboard/" : "/reach/") + '" class="' + (on ? "on" : "") + '"' + (on ? ' aria-current="page"' : "") + ">" + NAMES[k] + (t ? "<i>" + esc(t) + "</i>" : "") + "</a>";
      }).join("") + "</div>";
      /* One menu for Content and Reach (2026-10-31): Account, Preferences (folded), Help, Admin (admins only), then legal and log out. */
      html += item("Your Alchemist · rank & badges", function () { if (HERE === "content") nativePress(/^Your Alchemist/); else openDrawer(); });
      html += item("Plans & billing", function () { openPlans(); });
      html += item("Progress report", function () {}, { href: "/report/" });
      html += item("Password & security", function () { if (window.fmSecurityOpen) window.fmSecurityOpen(); });
      var tools = moduleItems();
      tools.forEach(function (it) { html += item(it.label, it.fn || function () {}, { href: it.href, mini: it.mini }); });
      var cr = document.getElementById("credits");
      if (HERE === "content" && cr && window.matchMedia && window.matchMedia("(max-width:640px)").matches) html += item(cr.textContent.replace(/\s+/g, " ").trim(), function () { cr.click(); });
      var pf = "";
      if (hasBoth(plans)) {
        pf += '<div class="fm-st"><span>Start page</span><span class="seg">' + [["", "Auto"], ["content", "Content"], ["reach", "Reach"]].map(function (o) { return '<button type="button" data-h="' + o[0] + '" class="' + (window.xpHome.get() === o[0] ? "on" : "") + '">' + o[1] + "</button>"; }).join("") + "</span></div>";
      }
      pf += item(themeNow() === "light" ? "Dark mode" : "Light mode", function () { if (HERE === "content") nativePress(/(Light|Dark) mode/i); else if (window.xpToggleTheme) window.xpToggleTheme(); });
      pf += item(alchHidden() ? "Show the Alchemist helper" : "Hide the Alchemist helper", function () { setAlchHidden(!alchHidden()); });
      if (window.fmHfApply) pf += item(hfHidden() ? "Show the hands-free mic button" : "Hide the hands-free mic button", function () { setHfHidden(!hfHidden()); });
      pf += item(infoHidden() ? "Show info icons" : "Hide info icons", function () { setInfoHidden(!infoHidden()); });
      html += '<details class="fm-dt"><summary>Preferences</summary>' + pf + "</details>";
      html += '<div class="fm-sep"></div>';
      var tourFn = HERE === "reach" ? window.reachStartTour : window.faStartTour;
      if (tourFn) html += item("Take the tour", function () { tourFn(true); });
      html += item("Report a problem", function () { fmReport(); });
      html += item("Help & guides", function () {}, { href: "/help/", blank: true });
      if (window.faInstall && (!window.faInstallState || !window.faInstallState().standalone)) html += item("Get the app on this device", function () { window.faInstall(); });
      html += '<details class="fm-dt"><summary>More from Fullmedia Alchemist</summary>' + [["Website home", "/"], ["Blog", "/blog/"], ["Resources", "/resources/"], ["Pricing", "/pricing/"], ["FAQ", "/pricing/#faq"]].map(function (l) { return '<a class="fm-i" role="menuitem" target="_blank" rel="noopener" href="' + l[1] + '">' + l[0] + "</a>"; }).join("") + "</details>";
      if (isAd) {
        html += '<div class="fm-sep"></div><div class="fm-sec">Admin</div>' + item("Admin dashboard · traffic & problems", function () {}, { href: "/admin/", blank: true });
      }
      html += '<div class="fm-sep"></div><div class="fm-legal"><a href="/terms/">Terms</a><a href="/privacy/">Privacy</a></div>';
      html += item("Log out", function () { globalSignOut(); if (HERE === "content") { if (!nativePress(/^Log out$/)) { try { localStorage.removeItem("ccb-session"); } catch (e) {} location.replace("/login/"); } } else if (window.xpSignOut) window.xpSignOut(); }, { cls: "out" });
    } else if (kind === "bell") {
      var bi = (window.xpBellItems && window.xpBellItems()) || [];
      html += '<div class="fm-head"><b>Waiting on you</b></div>';
      if (!bi.length) html += '<div class="fm-head"><span>You are all caught up.</span></div>';
      bi.forEach(function (it) { html += item(it.label, it.fn); });
    }
    m.innerHTML = html; document.body.appendChild(m);
    var r = anchor.getBoundingClientRect(); m.style.top = Math.round(r.bottom + 8) + "px"; m.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + "px";
    var mr = m.getBoundingClientRect(); if (mr.left < 12) m.style.right = Math.max(12, parseInt(m.style.right, 10) - (12 - mr.left)) + "px";
    m.addEventListener("click", function (e) {
      var h = e.target.closest("[data-h]"); if (h) { e.stopPropagation(); saveHome(h.getAttribute("data-h")).then(closeFm).catch(function () {}); return; }
      var a = e.target.closest("[data-a]"); if (!a) return;
      var fn = acts[Number(a.getAttribute("data-a"))]; if (a.tagName === "A") return; e.preventDefault(); closeFm(); try { fn && fn(); } catch (x) {}
    });
  }

  /* ===== Rank chip + "Your Alchemist" drawer in Reach (Content has its own native one, fed by the same alchemist-progress data) ===== */
  var prog = null;
  function loadProg() {
    var tok = token(); if (!tok) return Promise.resolve(null);
    return fetch(SB + "/functions/v1/alchemist-progress", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: "{}" })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.ok) { prog = j; paintRank(); } return j; }).catch(function () { return null; });
  }
  function ringSvg(frac) {
    var C = 2 * Math.PI * 10, d = Math.max(0, Math.min(1, frac)) * C;
    return '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="10" fill="none" stroke="rgba(128,128,128,.3)" stroke-width="3"/><circle cx="13" cy="13" r="10" fill="none" stroke="var(--gold,var(--accent,#e8a33d))" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + d.toFixed(1) + " " + C.toFixed(1) + '" transform="rotate(-90 13 13)"/><text x="13" y="16.5" text-anchor="middle" font-size="9.5" font-weight="700" fill="currentColor" font-family="IBM Plex Sans,system-ui,sans-serif">' + (prog ? prog.rank.level : "") + "</text></svg>";
  }
  function fracOf() { if (!prog) return 0; var a = prog.rank.xp, nx = prog.next; return nx ? (prog.xp - a) / Math.max(1, nx.xp - a) : 1; }
  function paintRank() {
    var b = document.getElementById("xpRank"); if (!b || !prog) return;
    b.innerHTML = ringSvg(fracOf()) + '<span class="rk">' + esc(prog.rank.name) + "</span>";
    b.title = prog.xp + " XP" + (prog.next ? " · " + prog.next.remaining + " to " + prog.next.name : "");
  }
  function openDrawer() {
    fmCss(); var old = document.getElementById("xpDrawer"); if (old) { old.remove(); return; }
    var pal = PAL[themeNow()], d = document.createElement("div"); d.id = "xpDrawer";
    Object.keys(pal).forEach(function (k) { d.style.setProperty("--fm-" + k, pal[k]); });
    function draw() {
      var p = prog; if (!p) { d.innerHTML = '<button class="x" type="button" aria-label="Close">&times;</button><h2>Your Alchemist</h2><p class="sub">Loading…</p>'; return; }
      var h = '<button class="x" type="button" aria-label="Close">&times;</button><h2>' + esc(p.rank.name) + '</h2><p class="sub">' + p.xp + " XP · one Alchemist across Content and Reach</p>";
      h += '<div class="bar"><i style="width:' + Math.round(fracOf() * 100) + '%"></i></div>';
      h += '<div class="sub" style="margin:0">' + (p.next ? p.next.remaining + " XP to " + esc(p.next.name) : "Highest rank reached") + "</div>";
      if (p.gate && p.gate.locked) h += '<div class="lock">' + esc(p.gate.message) + "</div>";
      h += '<div class="split"><div><b>' + (p.modules ? p.modules.content.xp : 0) + '</b><span>Content XP</span></div><div><b>' + (p.modules ? p.modules.reach.xp : 0) + "</b><span>Reach XP</span></div></div>";
      h += "<h3>This week</h3>" + (p.quests || []).map(function (q) { return '<div class="q' + (q.done ? " done" : "") + '"><span>' + esc(q.name) + '</span><span>' + q.have + "/" + q.need + " · +" + q.xp + " XP</span></div>"; }).join("");
      h += "<h3>Badges " + (p.badges || []).filter(function (b) { return b.earned; }).length + "/" + (p.badges || []).length + '</h3><div class="bg">' + (p.badges || []).map(function (b) { return '<div class="b ' + (b.earned ? "on" : "off") + '"><b>' + esc(b.name) + "</b><span>" + (b.earned ? "Earned · " : b.have + "/" + b.need + " · ") + esc(b.how) + "</span></div>"; }).join("") + "</div>";
      h += "<h3>Ranks</h3>" + (p.ranks || []).map(function (r) { return '<div class="rl' + (r.name === p.rank.name ? " on" : "") + '"><span>' + esc(r.name) + "</span><span>" + r.xp + " XP</span></div>"; }).join("");
      d.innerHTML = h;
    }
    draw(); document.body.appendChild(d);
    d.addEventListener("click", function (e) { if (e.target.closest(".x")) d.remove(); });
    if (!prog) loadProg().then(draw); else loadProg().then(function () { if (document.getElementById("xpDrawer")) draw(); });
  }
  window.xpOpenAlchemist = openDrawer;
  function acctEl() { return document.getElementById("acctBtn") || document.getElementById("accountBtn"); }
  /* Reach's header uses the very same bell and user icons, size and button style as Content. */
  var HB_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  var HB_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
  function unifyHeaderIcons() {
    if (HERE !== "reach") return;
    if (!document.getElementById("fmHdrCss")) {
      var st = document.createElement("style"); st.id = "fmHdrCss";
      st.textContent = "#topnav .xp-hb{width:38px;height:38px;border:1px solid transparent;border-radius:10px;opacity:1;color:var(--fg-dim,inherit);transition:background .2s,color .2s}#topnav .xp-hb:hover{background:var(--surface-2);color:var(--fg);border-color:transparent}#topnav .xp-hb:active{transform:scale(.94)}#topnav .xp-hb svg{width:20px;height:20px}";
      document.head.appendChild(st);
    }
    var b = document.getElementById("bellBtn");
    if (b && !b.getAttribute("data-fmicon")) { var bn = b.querySelector(".bn"); b.innerHTML = HB_BELL; if (bn) b.appendChild(bn); b.setAttribute("data-fmicon", "1"); }
    var u = document.getElementById("accountBtn");
    if (u && !u.getAttribute("data-fmicon")) { u.innerHTML = HB_USER; u.setAttribute("data-fmicon", "1"); }
  }
  function addHeaderBits() {
    fmCss();
    var acct = acctEl(); if (!acct) return;
    unifyHeaderIcons();
    acct.setAttribute("aria-haspopup", "true");
    paintWsAvatar();
    if (HERE === "reach" && !document.getElementById("xpRank")) {
      var rb = document.createElement("button"); rb.id = "xpRank"; rb.type = "button"; rb.className = "xp-rank"; rb.setAttribute("aria-label", "Your Alchemist rank"); rb.innerHTML = ringSvg(0) + '<span class="rk">Alchemist</span>';
      rb.addEventListener("click", openDrawer); var ref = document.getElementById("bellBtn") || acct; ref.parentNode.insertBefore(rb, ref); paintRank();
    }
    if (!document.getElementById("xpModPill")) {
      var old = document.querySelector("#topnav .mod"); if (old) old.remove();
      var anchor = HERE === "reach" ? document.querySelector("#topnav .tn-brand") : document.getElementById("homeLink");
      if (anchor && anchor.parentNode) { var p = document.createElement("span"); p.id = "xpModPill"; p.className = "xp-mod"; p.textContent = NAMES[HERE]; anchor.parentNode.insertBefore(p, anchor.nextSibling); }
    }
  }
  document.addEventListener("click", function (e) {
    if (fmBypass) return;
    var t = e.target;
    var acct = t.closest && t.closest("#acctBtn, #accountBtn"), bell = HERE === "reach" && t.closest && t.closest("#bellBtn");
    if (acct || bell) { e.preventDefault(); e.stopImmediatePropagation(); openMenu(bell ? "bell" : "account", bell || acct); return; }
    if (HERE === "content" && t.closest && t.closest("#credits")) { e.preventDefault(); e.stopImmediatePropagation(); closeFm(); openPlans(); return; }
    if (!(t.closest && t.closest("#fmMenu"))) closeFm();
  }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeFm(); var dr = document.getElementById("xpDrawer"); if (dr) dr.remove(); } });
  window.addEventListener("resize", closeFm);
  function hostReady() { return HERE === "reach" ? document.getElementById("topnav") : document.querySelector("header.topbar"); }
  function when() {
    if (!hostReady()) { setTimeout(when, 300); return; }
    run(); addHeaderBits(); hideCrypto();
    /* the dashboard re-renders its header on brand changes; put the switch back if it is wiped */
    var t = null;
    new MutationObserver(function () { if (t) return; t = setTimeout(function () { t = null; if (hostReady()) { addHeaderBits(); hideCrypto(); } }, 150); })
      .observe(document.body, { childList: true, subtree: true });
  }
  /* One sign-in page for everything: the dashboard's own login screen hands over to /login/ */
  if (HERE === "content" && location.pathname.indexOf("/login") !== 0) {
    var tries = 0, watch = setInterval(function () {
      tries++;
      if (/[#&?](access_token|code|error)=/.test(location.hash + location.search)) { clearInterval(watch); return; }   /* a sign-in link is being processed */
      if (document.querySelector("#app .login-card, #app .login")) { clearInterval(watch); location.replace("/login/?next=/dashboard/"); }
      else if (document.querySelector("header.topbar") || tries > 60) clearInterval(watch);
    }, 250);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", when); else when();
})();

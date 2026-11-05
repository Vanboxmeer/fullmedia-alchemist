/* One site header for every public page (home, pricing, help, resources, blog, legal, ...).
   Replaces whatever header the page shipped with, so there is exactly one look, one set of links and one mobile menu.
   Not used in the apps (/dashboard/, /reach/): those share their own header via xpromo.js. */
(function () {
  "use strict";
  if (window.__fmHeader) return; window.__fmHeader = 1;
  try { var an = document.createElement("script"); an.src = "/assets/fma-analytics.js"; an.defer = true; document.head.appendChild(an); } catch (e) {}   // visit counter (first-party, no cookies)
  var p = location.pathname;
  if (/^\/(dashboard|login)(\/|$)/.test(p) || /^\/reach\/?(index\.html)?$/.test(p)) return;
  if (document.getElementById("topnav") || document.querySelector("header.topbar")) return;

  var LINKS = [
    ["Content", "/#a-brands", null],
    ["Reach", "/reach-features/", /^\/reach-features/],
    ["How it works", "/#a-how", null],
    ["Pricing", "/pricing/", /^\/pricing/],
    ["Blog", "/blog/", /^\/blog/],
    ["Help", "/help/", /^\/(help|resources)/]
  ];
  function on(l) { return l[2] && l[2].test(p) ? ' class="on" aria-current="page"' : ""; }
  var links = LINKS.map(function (l) { return '<a href="' + l[1] + '"' + on(l) + ">" + l[0] + "</a>"; }).join("");
  var drawer = LINKS.map(function (l) { return '<a class="l" href="' + l[1] + '">' + l[0] + "</a>"; }).join("");

  var CSS =
    ".fmh{position:sticky;top:0;z-index:60;background:rgba(15,19,12,.9);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid #2a3126;padding-top:env(safe-area-inset-top,0px);font-family:'IBM Plex Sans',-apple-system,system-ui,sans-serif;color:#ece6d6}" +
    ".fmh *{box-sizing:border-box}" +
    ".fmh-in{max-width:1180px;margin:0 auto;padding:0 max(20px,env(safe-area-inset-right,0px)) 0 max(20px,env(safe-area-inset-left,0px));display:flex;align-items:center;gap:18px;min-height:62px}" +
    ".fmh-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#ece6d6;font:600 18px/1 Fraunces,Georgia,serif;white-space:nowrap}.fmh-brand em{color:#e8a33d;font-style:italic}.fmh-brand img{width:28px;height:28px;display:block}" +
    ".fmh-links{display:flex;gap:24px;margin-left:28px;font-size:14.5px}.fmh-links a{color:#9aa394;text-decoration:none;padding:6px 0}.fmh-links a:hover,.fmh-links a.on{color:#ece6d6}" +
    ".fmh-btns{display:flex;gap:10px;margin-left:auto}" +
    ".fmh-b{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:9px 16px;border-radius:10px;border:1px solid transparent;font:600 14.5px/1.2 'IBM Plex Sans',-apple-system,system-ui,sans-serif;text-decoration:none;white-space:nowrap;cursor:pointer}" +
    ".fmh-b.ghost{border-color:#2a3126;color:#ece6d6;background:transparent}.fmh-b.ghost:hover{border-color:#4a5544}" +
    ".fmh-b.gold{background:linear-gradient(#f0b452,#e19a2c);color:#241a06;box-shadow:inset 0 0 0 1px rgba(255,207,122,.35),0 10px 30px -10px rgba(232,163,61,.7)}" +
    ".fmh-burger{display:none;margin-left:auto;width:44px;height:44px;border-radius:10px;border:1px solid #2a3126;background:transparent;color:#ece6d6;cursor:pointer;align-items:center;justify-content:center}" +
    ".fmh-burger i,.fmh-burger i::before,.fmh-burger i::after{display:block;width:20px;height:2px;background:currentColor;border-radius:2px;position:relative;transition:transform .2s,background .2s}" +
    ".fmh-burger i::before,.fmh-burger i::after{content:'';position:absolute;left:0}.fmh-burger i::before{top:-6px}.fmh-burger i::after{top:6px}" +
    ".fmh-burger[aria-expanded=true] i{background:transparent}.fmh-burger[aria-expanded=true] i::before{transform:translateY(6px) rotate(45deg)}.fmh-burger[aria-expanded=true] i::after{transform:translateY(-6px) rotate(-45deg)}" +
    ".fmh-drawer{display:none;border-top:1px solid #2a3126;background:#10150d;padding:8px max(20px,env(safe-area-inset-left,0px)) 16px}" +
    ".fmh-drawer.open{display:block}.fmh-drawer a.l{display:block;padding:13px 2px;color:#ece6d6;text-decoration:none;font-size:16px;border-bottom:1px solid #20271c}" +
    ".fmh-drawer .row{display:flex;gap:10px;margin-top:14px}.fmh-drawer .row .fmh-b{flex:1}" +
    "@media (max-width:900px){.fmh-links,.fmh-btns{display:none}.fmh-burger{display:inline-flex}}" +
    "@media (min-width:901px){.fmh-drawer{display:none!important}}";

  var HTML =
    '<div class="fmh-in"><a class="fmh-brand" href="/"><img src="/assets/logo-mark.svg" alt="" width="28" height="28">Fullmedia <em>Alchemist</em></a>' +
    '<nav class="fmh-links" aria-label="Main">' + links + "</nav>" +
    '<div class="fmh-btns"><a class="fmh-b ghost" href="/login/" data-cta="nav-signin">Sign in</a><a class="fmh-b gold" href="/dashboard/" data-cta="nav-start">Start free</a></div>' +
    '<button class="fmh-burger" id="fmhBurger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="fmhDrawer"><i></i></button></div>' +
    '<nav class="fmh-drawer" id="fmhDrawer" aria-label="Mobile">' + drawer +
    '<div class="row"><a class="fmh-b ghost" href="/login/" data-cta="nav-signin">Sign in</a><a class="fmh-b gold" href="/dashboard/" data-cta="nav-start">Start free</a></div></nav>';

  function build() {
    if (document.getElementById("fmHeader")) return;
    var st = document.createElement("style"); st.id = "fmHeaderCss"; st.textContent = CSS; document.head.appendChild(st);
    var h = document.createElement("header"); h.id = "fmHeader"; h.className = "fmh"; h.innerHTML = HTML;
    /* remove the page's own site header(s): the first header that is not inside an app or an article */
    var olds = document.querySelectorAll("body > header, body > .top, body > div > header:first-child, #app > header");
    for (var i = 0; i < olds.length; i++) { var o = olds[i]; if (o.id === "fmHeader" || o.closest("article,main,#app")) continue; o.parentNode.removeChild(o); }
    var firstHeader = document.querySelector("body header:not(#fmHeader)");
    if (firstHeader && !firstHeader.closest("article,main,#app") && /nav|brand|logo/i.test(firstHeader.innerHTML.slice(0, 600))) firstHeader.parentNode.removeChild(firstHeader);
    document.body.insertBefore(h, document.body.firstChild);
    var b = document.getElementById("fmhBurger"), d = document.getElementById("fmhDrawer");
    b.addEventListener("click", function () { var o = d.classList.toggle("open"); b.setAttribute("aria-expanded", o ? "true" : "false"); });
    d.addEventListener("click", function (e) { if (e.target.closest("a")) { d.classList.remove("open"); b.setAttribute("aria-expanded", "false"); } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { d.classList.remove("open"); b.setAttribute("aria-expanded", "false"); } });
  }
  if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
})();

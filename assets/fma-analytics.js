/* Alchemist visit counter. First-party, no cookies, no IP address, no third party.
   Records: page, where the visit came from (referrer site / utm tags), device type, and a random id that
   lives only in this browser tab. Respects Do Not Track. Skips the owner's own browser (set by /admin/). */
(function () {
  "use strict";
  if (window.fmaSite) return;
  var URL_ = "https://tpqvvrdglnsdljdpzwfl.supabase.co/rest/v1/rpc/site_track";
  var KEY = "sb_publishable_TcW5WxZhUPuo2MhKWaBUKQ_EjkNzSJb";
  var off = false;
  try { off = navigator.doNotTrack === "1" || window.doNotTrack === "1" || localStorage.getItem("fma-no-track") === "1"; } catch (e) {}
  var h = location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || /^\/(review|admin)(\/|$)/.test(location.pathname)) off = true;
  var sid = "";
  try {
    sid = sessionStorage.getItem("fma-sid") || "";
    if (!sid) { var a = new Uint8Array(12); crypto.getRandomValues(a); sid = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); sessionStorage.setItem("fma-sid", sid); }
  } catch (e) { off = true; }
  var q = new URLSearchParams(location.search);
  var src = (q.get("utm_source") || q.get("ref") || "").toLowerCase().slice(0, 60);
  var med = (q.get("utm_medium") || "").toLowerCase().slice(0, 60);
  var camp = (q.get("utm_campaign") || "").toLowerCase().slice(0, 80);
  var refHost = "";
  try { refHost = new URL(document.referrer).hostname.replace(/^www\./, ""); } catch (e) {}
  if (refHost && /(^|\.)fullmediaalchemist\.com$/.test(refHost)) refHost = "";   // internal navigation is not a new source
  var dev = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
  var sent = {};
  function ev(name, extra) {
    if (off) return;
    if (name !== "view" && sent[name]) return;
    sent[name] = 1;
    try {
      fetch(URL_, {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: KEY, Authorization: "Bearer " + KEY },
        body: JSON.stringify({ p_sid: sid, p_event: name, p_path: location.pathname, p_ref: refHost, p_src: src, p_medium: med, p_campaign: camp, p_device: dev, p_extra: extra || null })
      }).catch(function () {});
    } catch (e) {}
  }
  window.fmaSite = { ev: ev, sid: sid };
  // the first view of a visit carries the source; later pages in the same tab carry none (they are not a new source)
  var first = true; try { first = !sessionStorage.getItem("fma-seen"); sessionStorage.setItem("fma-seen", "1"); } catch (e) {}
  if (!first) { refHost = ""; src = ""; med = ""; camp = ""; }
  ev("view");
  if (/^\/pricing(\/|$)/.test(location.pathname)) ev("pricing");
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a,button") : null;
    if (!a) return;
    var href = a.getAttribute && a.getAttribute("href") || "";
    if (a.hasAttribute("data-cta") || /^\/?(dashboard|login|app)(\/|\?|#|$)/.test(href.replace(/^https?:\/\/[^/]+/, ""))) ev("signup_click");
  }, true);
})();

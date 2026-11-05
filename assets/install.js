/* Fullmedia Alchemist: "Get the app" (2026-10-12).
   Brad: "there needs to be a download app button/link or auto detect if not
   on their device ... on homepage in footer, and in the account menu".
   The app is a web app (manifest.webmanifest, start_url /dashboard/), so
   "download" means adding it to the home screen / dock:
   - Chrome, Edge, Samsung Internet (Android, Windows, Mac, ChromeOS): the
     browser's own install prompt, one tap.
   - iPhone/iPad, Mac Safari, and anywhere the prompt isn't offered: short
     steps for that device.
   - Already running as the installed app: every install link hides.
   Any element with [data-install] becomes a "Get the app" control. */
(function () {
  'use strict';
  var deferred = null;
  var KEY_DONE = 'fa-installed';
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function standalone() {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch (e) { return false; }
  }
  function device() {
    var ua = navigator.userAgent || '';
    var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPod/.test(ua)) return 'iphone';
    if (/iPad/.test(ua) || touchMac) return 'ipad';
    if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox/.test(ua) ? 'android-firefox' : 'android';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Chrome\//.test(ua) || /CriOS/.test(ua)) return 'chrome';
    if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'mac-safari';
    return 'other';
  }
  var SHARE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  var DOTS = '<b style="letter-spacing:1px">⋮</b>';
  function steps(d) {
    switch (d) {
      case 'iphone': case 'ipad': return ['Tap the Share button ' + SHARE + ' in Safari (in Chrome it’s in the address bar).', 'Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.', 'Open <b>Fullmedia Alchemist</b> from your home screen.'];
      case 'android': return ['Tap the menu ' + DOTS + ' at the top right.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.', 'Open <b>Fullmedia Alchemist</b> from your home screen.'];
      case 'samsung': return ['Tap the menu (☰) at the bottom.', 'Tap <b>Add page to</b> → <b>Home screen</b>.', 'Open <b>Fullmedia Alchemist</b> from your home screen.'];
      case 'android-firefox': return ['Tap the menu ' + DOTS + '.', 'Tap <b>Install</b> (or <b>Add to Home screen</b>).', 'Open <b>Fullmedia Alchemist</b> from your home screen.'];
      case 'chrome': return ['Click the install icon at the right end of the address bar.', 'Or open the menu ' + DOTS + ' → <b>Cast, save and share</b> → <b>Install page as app</b>.', 'It opens in its own window and gets its own icon.'];
      case 'edge': return ['Click the <b>App available</b> icon in the address bar.', 'Or open the menu (…) → <b>Apps</b> → <b>Install this site as an app</b>.', 'It opens in its own window and gets its own icon.'];
      case 'mac-safari': return ['In the menu bar, choose <b>File</b> → <b>Add to Dock</b>.', 'Click <b>Add</b>.', 'Open <b>Fullmedia Alchemist</b> from your Dock.'];
      case 'firefox': return ['Firefox on a computer can’t install web apps.', 'Open <b>fullmediaalchemist.com/dashboard</b> in Chrome, Edge or Safari and use <b>Get the app</b> there.', 'Or keep using it right here in Firefox. Everything works the same.'];
      default: return ['Open your browser’s menu.', 'Look for <b>Install app</b>, <b>Add to Home screen</b> or <b>Add to Dock</b>.', 'Open <b>Fullmedia Alchemist</b> from your home screen.'];
    }
  }
  function css() {
    if (/^\/dashboard\/?/.test(location.pathname)) document.documentElement.classList.add('fa-in-app');
    if (document.getElementById('fa-inst-css')) return;
    var s = document.createElement('style'); s.id = 'fa-inst-css';
    s.textContent = '.fa-inst-bg{position:fixed;inset:0;z-index:9999;background:rgba(8,10,7,.72);display:flex;align-items:flex-end;justify-content:center;padding:16px;animation:faIn .2s ease}'
      + '@media(min-width:640px){.fa-inst-bg{align-items:center}}'
      // Solid colours on the website (its theme colours are see-through); the app's own theme inside the app.
      + '.fa-inst{width:100%;max-width:420px;background:#161c13;color:#f2efe6;border:1px solid #39432f;border-radius:18px;padding:20px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);font:15px/1.5 var(--body,"IBM Plex Sans",system-ui,sans-serif)}'
      + '.fa-inst h3{margin:0 0 4px;font-size:19px;line-height:1.25}.fa-inst p{margin:0 0 12px;opacity:.8;font-size:14px}'
      + '.fa-inst ol{margin:0 0 16px;padding-left:22px;display:grid;gap:8px}.fa-inst li{padding-left:2px}'
      + '.fa-inst-head{display:flex;gap:12px;align-items:center;margin-bottom:12px}.fa-inst-head img{width:48px;height:48px;border-radius:12px;flex:0 0 auto}'
      + '.fa-inst-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}'
      + '.fa-inst-row a,.fa-inst-row button{font:inherit;font-weight:600;font-size:14px;border-radius:99px;padding:9px 16px;cursor:pointer;text-decoration:none;border:1px solid var(--line,#39432f);background:transparent;color:inherit}'
      + '.fa-inst-row .go{background:var(--gold,#e8a33d);border-color:var(--gold,#e8a33d);color:#16130b}'
      + '.fa-in-app .fa-inst{background:var(--surface,#161c13);color:var(--ink,#f2efe6);border-color:var(--line,#39432f)}'
      + '@keyframes faIn{from{opacity:0}to{opacity:1}}@media(prefers-reduced-motion:reduce){.fa-inst-bg{animation:none}}';
    document.head.appendChild(s);
  }
  function showHelp() {
    css();
    var d = device();
    var bg = document.createElement('div'); bg.className = 'fa-inst-bg'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-labelledby', 'faInstT');
    var onApp = /^\/dashboard\/?/.test(location.pathname);
    bg.innerHTML = '<div class="fa-inst"><div class="fa-inst-head"><img src="/assets/app-icon-dark-180.png" alt=""><div><h3 id="faInstT">Get Fullmedia Alchemist</h3><p style="margin:0">Your posts, reminders and one-tap posting, on your home screen. Free, no app store needed.</p></div></div>'
      + '<ol>' + steps(d).map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>'
      + '<div class="fa-inst-row"><button type="button" data-x>Close</button>' + (onApp ? '' : '<a class="go" href="/dashboard/">Open the app</a>') + '</div></div>';
    function close() { bg.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); }
    bg.addEventListener('click', function (e) { if (e.target === bg || e.target.hasAttribute('data-x')) close(); });
    document.addEventListener('keydown', key);
    document.body.appendChild(bg);
    var b = bg.querySelector('[data-x]'); if (b) b.focus();
  }
  function track(ev) { try { if (window.fmaTrack) window.fmaTrack(ev); } catch (e) {} }
  async function install() {
    track('install_click');
    if (deferred) {
      var p = deferred; deferred = null; update();
      try { p.prompt(); var r = await p.userChoice; track(r && r.outcome === 'accepted' ? 'install_ok' : 'install_no'); return r && r.outcome; } catch (e) { showHelp(); return 'help'; }
    }
    showHelp(); return 'help';
  }
  function update() {
    var inApp = standalone();
    var els = document.querySelectorAll('[data-install]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.hidden = inApp;
      if (!el.dataset.instWired) { el.dataset.instWired = '1'; el.addEventListener('click', function (e) { e.preventDefault(); install(); }); }
    }
    document.documentElement.classList.toggle('fa-standalone', inApp);
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; update(); });
  window.addEventListener('appinstalled', function () { deferred = null; ls(KEY_DONE, '1'); track('install_done'); update(); });
  window.faInstall = install;
  window.faInstallState = function () { return { standalone: standalone(), canPrompt: !!deferred, device: device(), installedBefore: ls(KEY_DONE) === '1' }; };
  window.faInstallWire = update;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update); else update();
})();

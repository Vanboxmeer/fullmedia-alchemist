/* Guided tour engine (2026-11-03). window.faTour.start(steps, {key, manual, onEnd}).
   steps: [{sel: ['#a', '.b'], t: 'Title', d: 'Text'}]. A step whose element is not on screen is skipped.
   Used by Alchemist Reach. Esc or Skip closes; arrow keys work; focus stays inside; reduced motion respected. */
(function () {
  if (window.faTour) return;
  var live = null;
  var css = '.fat{position:fixed;inset:0;z-index:130}.fat-catch{position:absolute;inset:0}' +
    '.fat-ring{position:fixed;border-radius:12px;pointer-events:none;box-shadow:0 0 0 2px var(--accent,var(--gold,#e8a33d)),0 0 0 9999px rgba(6,8,5,.62);transition:left .25s ease,top .25s ease,width .25s ease,height .25s ease}' +
    '.fat-pop{position:fixed;width:min(340px,calc(100vw - 24px));background:var(--surface,#181d15);color:var(--fg,var(--ink,#ece6d6));border:1px solid var(--border,var(--line-2,#3a4434));border-radius:12px;box-shadow:var(--shadow,0 18px 50px rgba(0,0,0,.45));padding:16px 18px;outline:0;font-family:var(--font-body,var(--body,system-ui,sans-serif))}' +
    '.fat-n{font:600 11px/1 var(--font-body,var(--body,system-ui));letter-spacing:.08em;text-transform:uppercase;color:var(--fg-faint,var(--muted,#949d8d));margin-bottom:8px}' +
    '.fat-t{font-family:var(--font-display,var(--display,Georgia,serif));font-size:20px;line-height:1.15;margin:0 0 6px;font-weight:600;text-wrap:balance}' +
    '.fat-d{font-size:14px;line-height:1.5;color:var(--fg-dim,var(--ink-2,#c9c5b5));margin:0 0 14px}' +
    '.fat-btns{display:flex;align-items:center;gap:8px}.fat-sp{flex:1}' +
    '.fat-b{font:600 13px/1 var(--font-body,var(--body,system-ui));padding:10px 14px;border-radius:9px;border:1px solid var(--border,var(--line-2,#3a4434));background:transparent;color:var(--fg,var(--ink,#ece6d6));cursor:pointer;min-height:40px}' +
    '.fat-b.go{background:var(--accent,var(--gold,#e8a33d));color:var(--accent-fg,var(--gold-ink,#241a06));border-color:var(--accent,var(--gold,#e8a33d))}' +
    '.fat-b:focus-visible{outline:2px solid var(--accent,var(--gold,#e8a33d));outline-offset:2px}' +
    '@media (prefers-reduced-motion:reduce){.fat-ring{transition:none}}';
  function style() { if (document.getElementById('fat-css')) return; var s = document.createElement('style'); s.id = 'fat-css'; s.textContent = css; document.head.appendChild(s); }
  function vis(el) {
    if (!el || el.hidden) return false;
    var r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false;
    var cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  function pick(step) { for (var i = 0; i < step.sel.length; i++) { var el = document.querySelector(step.sel[i]); if (vis(el)) return el; } return null; }
  function start(defs, opts) {
    opts = opts || {};
    if (live) return false;
    var steps = defs.map(function (s) { return { s: s, el: s.center ? document.body : pick(s) }; }).filter(function (x) { return x.el; });
    if (!steps.length) return false;
    style();
    var prev = document.activeElement, i = 0;
    var root = document.createElement('div'); root.className = 'fat'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Quick tour');
    root.innerHTML = '<div class="fat-catch"></div><div class="fat-ring" aria-hidden="true"></div><div class="fat-pop" tabindex="-1"><div class="fat-n"></div><h3 class="fat-t"></h3><p class="fat-d"></p><div class="fat-btns"><button type="button" class="fat-b" data-skip>Skip tour</button><span class="fat-sp"></span><button type="button" class="fat-b" data-go hidden></button><button type="button" class="fat-b" data-back>Back</button><button type="button" class="fat-b go" data-next>Next</button></div></div>';
    document.body.appendChild(root);
    var ring = root.querySelector('.fat-ring'), pop = root.querySelector('.fat-pop'), bBack = root.querySelector('[data-back]'), bNext = root.querySelector('[data-next]'), bGo = root.querySelector('[data-go]');
    function place() {
      var cur = steps[i];
      if (cur.s.center) { ring.style.left = '-9999px'; ring.style.top = '-9999px'; ring.style.width = '0px'; ring.style.height = '0px'; var w = innerWidth, h = innerHeight, ph0 = pop.offsetHeight, pw0 = pop.offsetWidth; pop.style.right = 'auto'; pop.style.bottom = 'auto'; pop.style.width = ''; pop.style.left = Math.max(12, (w - pw0) / 2) + 'px'; pop.style.top = Math.max(12, (h - ph0) / 2) + 'px'; return; }
      var el = pick(cur.s) || cur.el; if (!vis(el)) return;
      var r = el.getBoundingClientRect(), pad = 6, vw = innerWidth, vh = innerHeight;
      ring.style.left = (r.left - pad) + 'px'; ring.style.top = (r.top - pad) + 'px'; ring.style.width = (r.width + pad * 2) + 'px'; ring.style.height = (r.height + pad * 2) + 'px';
      var ph = pop.offsetHeight, pw = pop.offsetWidth;
      if (vw < 640) {
        var low = (r.top + r.height / 2) > vh / 2;
        pop.style.left = '12px'; pop.style.right = '12px'; pop.style.width = 'auto';
        if (low) { pop.style.top = 'calc(env(safe-area-inset-top, 0px) + 66px)'; pop.style.bottom = 'auto'; } else { pop.style.top = 'auto'; pop.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 16px)'; }
      } else {
        pop.style.right = 'auto'; pop.style.bottom = 'auto'; pop.style.width = '';
        var top = r.bottom + 14; if (top + ph > vh - 12) top = r.top - ph - 14;
        if (top < 12) top = Math.min(vh - ph - 12, Math.max(12, r.top + r.height / 2 - ph / 2));
        var left = r.left + r.width / 2 - pw / 2; left = Math.max(12, Math.min(vw - pw - 12, left));
        pop.style.top = top + 'px'; pop.style.left = left + 'px';
      }
    }
    function show(n) {
      i = Math.max(0, Math.min(steps.length - 1, n));
      var cur = steps[i], el = cur.s.center ? document.body : (pick(cur.s) || cur.el);
      var pos = getComputedStyle(el).position, fixed = cur.s.center || pos === 'fixed' || pos === 'sticky' || !!el.closest('header,#topnav,.topbar,nav');
      if (!fixed) { try { el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) {} }
      root.querySelector('.fat-n').textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
      root.querySelector('.fat-t').textContent = cur.s.t; root.querySelector('.fat-d').textContent = cur.s.d;
      bBack.hidden = i === 0; bNext.textContent = i === steps.length - 1 ? 'Got it' : 'Next';
      bGo.hidden = !cur.s.go; if (cur.s.go) bGo.textContent = cur.s.go.label;
      place(); setTimeout(place, 260); setTimeout(place, 600);
      try { bNext.focus({ preventScroll: true }); } catch (e) {}
    }
    function end(done) {
      removeEventListener('resize', place); removeEventListener('scroll', place, true); document.removeEventListener('keydown', onKey, true);
      root.remove(); live = null;
      try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (e) {}
      if (opts.onEnd) { try { opts.onEnd(done); } catch (e) {} }
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); bNext.click(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (i > 0) show(i - 1); }
      else if (e.key === 'Tab') {
        var f = Array.prototype.slice.call(root.querySelectorAll('button:not([hidden])')); if (!f.length) return;
        var a = f.indexOf(document.activeElement);
        if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (a === f.length - 1 || a < 0)) { e.preventDefault(); f[0].focus(); }
      }
    }
    root.querySelector('[data-skip]').onclick = function () { end(false); };
    bBack.onclick = function () { show(i - 1); };
    bGo.onclick = function () { var g = steps[i].s.go; if (g && g.href) location.href = g.href; };
    bNext.onclick = function () { if (i >= steps.length - 1) end(true); else show(i + 1); };
    addEventListener('resize', place); addEventListener('scroll', place, true); document.addEventListener('keydown', onKey, true);
    live = { end: end }; show(0); return true;
  }
  window.faTour = { start: start, active: function () { return !!live; } };
})();

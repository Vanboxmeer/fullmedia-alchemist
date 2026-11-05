(function(){
  if(window.__homeReach)return;window.__homeReach=2;
  var IMG='https://tpqvvrdglnsdljdpzwfl.supabase.co/storage/v1/object/public/wheel-assets/content-calendar/platform-brand/alchemist-action.png';
  var PLANS=[
    {n:'Free',b:'Try Reach on one brand.',m:0,y:0,f:['1 brand','10 AI drafts / month','Public options library','Connect your own Gmail'],cta:'Start free'},
    {n:'Solo',b:'One brand or founder.',m:29,y:290,f:['1 brand','300 AI calls / month','Public options library','Gmail and web research'],cta:'Choose Solo'},
    {n:'Team',b:'A small team across a few brands.',m:79,y:790,f:['Up to 3 brands','3 seats','1,500 AI calls / month','Client review links'],cta:'Choose Team'},
    {n:'Agency',b:'Agencies and in-house teams.',m:249,y:2490,f:['Up to 10 brands','10 seats','6,000 AI calls / month','Client portals'],cta:'Choose Agency'}
  ];
  var FEATS=[
    {t:'One pipeline for every brand',d:'Every deal, reply and next step in one inbox. Filter to what needs you today.'},
    {t:'An options library with prices',d:'Creators and outlets with their rates, contacts and history. Import a deck and it fills itself.'},
    {t:'Checklists that stop mistakes',d:'NDA signed? Client approved? Set the checks per brand and Reach asks before a deal moves on.'},
    {t:'Drafts in your voice',d:'AI drafts from your brand facts. You review and send. Nothing goes out on its own.'}
  ];
  var CSS='[data-reach-home]{--rg:#e8a33d;--rg2:#ffcf7a}'+
  '[data-reach-home] .rh-top{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:40px;align-items:center;margin-bottom:34px}'+
  '[data-reach-home] .rh-art{position:relative;aspect-ratio:1/1;border-radius:24px;overflow:hidden;background:radial-gradient(circle at 50% 38%,rgba(232,163,61,.28),rgba(232,163,61,0) 68%),#161c13;border:1px solid #2a3126}'+
  '[data-reach-home] .rh-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'+
  '[data-reach-home] .rh-mark{display:inline-flex;align-items:center;gap:10px;margin-bottom:6px}[data-reach-home] .rh-mark img{width:26px;height:26px}'+
  '[data-reach-home] .rh-feats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 34px}'+
  '[data-reach-home] .rh-feat{border:1px solid #2a3126;background:#161c13;border-radius:14px;padding:18px}[data-reach-home] .rh-feat b{display:block;font:600 15px/1.3 "IBM Plex Sans",system-ui,sans-serif;color:#ece6d6;margin-bottom:6px}[data-reach-home] .rh-feat span{font:400 13.5px/1.5 "IBM Plex Sans",system-ui,sans-serif;color:#9aa394}'+
  '[data-reach-home] .plans{align-items:stretch}[data-reach-home] .plan{display:flex;flex-direction:column}[data-reach-home] .plan ul{flex:1;margin-bottom:22px}'+
  '[data-reach-home] .rh-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;border-radius:10px;padding:13px 20px;font:600 14.5px/1.2 "IBM Plex Sans",system-ui,sans-serif;text-decoration:none;cursor:pointer;border:1px solid #2a3126;color:#ece6d6;background:transparent;transition:border-color .15s,filter .15s}'+
  '[data-reach-home] .rh-btn:hover{border-color:#9aa394}'+
  '[data-reach-home] .rh-btn.gold{border-color:transparent;background:linear-gradient(#f0b452,#e19a2c);color:#241a06;box-shadow:inset 0 0 0 1px rgba(255,207,122,.35),0 10px 30px -10px rgba(232,163,61,.7)}[data-reach-home] .rh-btn.gold:hover{filter:brightness(1.07)}'+
  '[data-reach-home] .rh-more{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:center;justify-content:center;margin-top:26px}[data-reach-home] .rh-more .rh-btn{width:auto;padding:14px 26px}[data-reach-home] .rh-more p{margin:0;color:#9aa394;font:400 14px/1.5 "IBM Plex Sans",system-ui,sans-serif}'+
  '@media(max-width:1000px){[data-reach-home] .rh-feats{grid-template-columns:repeat(2,minmax(0,1fr))}}'+
  '@media(max-width:760px){[data-reach-home] .rh-top{grid-template-columns:1fr}[data-reach-home] .rh-art{max-width:260px;order:-1}[data-reach-home] .rh-feats{grid-template-columns:1fr}}';
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
  function build(afterSec){
    if(!document.getElementById('reachHomeCss')){var st=el('style');st.id='reachHomeCss';st.textContent=CSS;document.head.appendChild(st)}
    var sec=el('section');sec.id=afterSec.id==='a-pricing'?'a-reach-pricing':'reach-pricing';sec.setAttribute('data-reach-home','1');
    var wrap=el('div','wrap');
    var top=el('div','rh-top'),tx=el('div');
    var mk=el('div','rh-mark');var lg=el('img');lg.src='/assets/logo-mark.svg';lg.alt='';lg.width=26;lg.height=26;mk.appendChild(lg);mk.appendChild(el('span','eyebrow','Alchemist Reach'));tx.appendChild(mk);
    var h=el('h2');h.appendChild(document.createTextNode('Content gets you seen. '));h.appendChild(el('em','','Reach gets you covered.'));tx.appendChild(h);
    var lead=el('p','blurb','Find the outlets and creators worth pitching, draft the outreach, and track every reply. Reach is the second module of Fullmedia Alchemist: same login, its own plans.');
    lead.style.maxWidth='58ch';tx.appendChild(lead);
    var row=el('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:12px;margin-top:20px';
    var b1=el('a','rh-btn gold','Open Reach');b1.href='/reach/';b1.style.width='auto';b1.style.padding='13px 24px';
    var b2=el('a','rh-btn','See everything Reach does');b2.href='/reach-features/';b2.style.width='auto';b2.style.padding='13px 24px';
    row.appendChild(b1);row.appendChild(b2);tx.appendChild(row);top.appendChild(tx);
    var art=el('div','rh-art');var im=el('img');im.src=IMG;im.alt='The Alchemist, the Fullmedia Alchemist character';im.loading='lazy';art.appendChild(im);top.appendChild(art);
    wrap.appendChild(top);
    var fg=el('div','rh-feats');FEATS.forEach(function(f){var c=el('div','rh-feat');c.appendChild(el('b','',f.t));c.appendChild(el('span','',f.d));fg.appendChild(c)});wrap.appendChild(fg);
    var plans=el('div','plans');
    PLANS.forEach(function(p){
      var c=el('div','plan');c.appendChild(el('h3','',p.n));c.appendChild(el('p','blurb',p.b));
      var pr=el('div','price','$'+p.m);pr.appendChild(el('span','','/mo'));c.appendChild(pr);
      c.appendChild(el('div','cycle',p.m?('or $'+p.y+'/yr, 2 months free'):'free forever'));
      var ul=el('ul');p.f.forEach(function(x){ul.appendChild(el('li','',x))});c.appendChild(ul);
      var a=el('a','rh-btn'+(p.m?' gold':''),p.cta);a.href='/reach/';c.appendChild(a);
      plans.appendChild(c);
    });
    wrap.appendChild(plans);
    var more=el('div','rh-more');more.appendChild(el('p','','Run Content and Reach on the same tier and save 20% on both.'));
    var m2=el('a','rh-btn','Read the full Reach guide');m2.href='/reach-features/';more.appendChild(m2);wrap.appendChild(more);
    sec.appendChild(wrap);
    afterSec.parentNode.insertBefore(sec,afterSec.nextSibling);
  }
  function run(){
    ['a-pricing','pricing'].forEach(function(id){
      var s=document.getElementById(id);
      if(s&&!document.getElementById(id==='a-pricing'?'a-reach-pricing':'reach-pricing'))build(s);
    });
    document.querySelectorAll('nav.navlinks').forEach(function(n){
      var ex=n.querySelector('[data-reach-link]');
      if(ex){ex.setAttribute('href','/reach-features/');return}
      var a=document.createElement('a');a.href='/reach-features/';a.textContent='Reach';a.setAttribute('data-reach-link','1');
      var last=n.lastElementChild;
      if(last&&last.className)a.className=last.className.replace(/\bbtn[\w-]*\b/g,'').trim();
      var anchor=n.querySelector('a[href*="pricing"]');
      if(anchor&&anchor.parentNode===n)n.insertBefore(a,anchor.nextSibling);else n.insertBefore(a,n.firstChild);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();

/* Phone and tablet menu: below 900px the page hides its header links and has no menu button. Add one. */
(function(){
  function mk(){
    var hd=document.querySelector('header .nav');if(!hd||document.getElementById('fmBurger'))return;
    var links=hd.querySelector('.navlinks');if(!links)return;
    var css=document.createElement('style');css.textContent=
      '#fmBurger{display:none;width:44px;height:44px;border-radius:10px;border:1px solid rgba(236,230,214,.28);background:transparent;color:inherit;cursor:pointer;align-items:center;justify-content:center;flex:none;padding:0}'+
      '#fmBurger i,#fmBurger i::before,#fmBurger i::after{display:block;width:20px;height:2px;background:currentColor;border-radius:2px;position:relative;transition:transform .2s,background .2s}'+
      '#fmBurger i::before,#fmBurger i::after{content:"";position:absolute;left:0}#fmBurger i::before{top:-6px}#fmBurger i::after{top:6px}'+
      '#fmBurger[aria-expanded=true] i{background:transparent}#fmBurger[aria-expanded=true] i::before{transform:translateY(6px) rotate(45deg)}#fmBurger[aria-expanded=true] i::after{transform:translateY(-6px) rotate(-45deg)}'+
      '#fmDrawer{display:none;position:fixed;left:0;right:0;top:64px;bottom:0;z-index:9999;overflow:auto;background:#12160f;color:#ece6d6;padding:12px max(16px,env(safe-area-inset-left,0px)) 28px;border-top:1px solid #2c3428}'+
      '#fmDrawer a{display:block;padding:14px 4px;border-bottom:1px solid #2c3428;color:#ece6d6;text-decoration:none;font:500 17px/1.3 system-ui,sans-serif}'+
      '#fmDrawer .sec{font:600 11px/1 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#949d8d;padding:18px 4px 4px;border:0}'+
      '#fmDrawer a.go{margin-top:16px;border:0;border-radius:10px;background:#e8a33d;color:#241a06;text-align:center;font-weight:700}'+
      '@media (max-width:900px){#fmBurger{display:inline-flex}}@media (min-width:901px){#fmDrawer{display:none!important}}';
    document.head.appendChild(css);
    var b=document.createElement('button');b.id='fmBurger';b.type='button';b.setAttribute('aria-label','Menu');b.setAttribute('aria-expanded','false');b.setAttribute('aria-controls','fmDrawer');b.innerHTML='<i></i>';
    var btns=hd.querySelector('.navbtns');(btns||hd).appendChild(b);
    var d=document.createElement('div');d.id='fmDrawer';
    var h='<div class="sec">This page</div>';
    var seen={};links.querySelectorAll('a').forEach(function(a){var t=a.textContent.trim();if(seen[t])return;seen[t]=1;h+='<a href="'+a.getAttribute('href')+'">'+t+'</a>'});
    h+='<div class="sec">More</div><a href="/pricing/">Plans and pricing</a><a href="/resources/">Resources</a><a href="/help/">Help</a><a href="/compare/">Compare</a>';
    h+='<div class="sec">Account</div><a href="/login/">Sign in</a><a class="go" href="/dashboard/">Get started free</a>';
    d.innerHTML=h;document.body.appendChild(d);
    function set(o){d.style.display=o?'block':'none';b.setAttribute('aria-expanded',o?'true':'false');document.documentElement.style.overflow=o?'hidden':''}
    b.addEventListener('click',function(){set(d.style.display!=='block')});
    d.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('a'))set(false)});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')set(false)});
    window.addEventListener('resize',function(){if(window.innerWidth>900)set(false)});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mk);else mk();
})();

/* Homepage examples: current-engine posts (replaces the old SpinQuest / Reading Race / Bested showcase). Idempotent. */
(function(){
  var SB='https://tpqvvrdglnsdljdpzwfl.supabase.co/storage/v1/render/image/public/wheel-assets/';
  function img(p,w){return SB+p+'?width='+w+'&quality=72&resize=contain&v=3';}
  function cc(id,n){return 'content-calendar/'+id+'/card_'+n+'.png';}
  function sc(id,n){return 'content-calendar/'+id+'/scene_'+n+'.jpg';}
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  var BR=[
    {name:'Everything Nightlife',style:'Neon nightlife',look:'A pulsing nightlife hub with neon pink highlights and dark moody backgrounds, capturing the energy of club nights and live events.',sw:['#08060d','#ff2d78','#22d3ee','#f6f3fb'],fonts:['Space Grotesk','Inter'],cards:[cc('CCB00738',1),cc('CCB00738',2)],alt:'Everything Nightlife posts made by the Alchemist'},
    {name:'Evrylife',style:'Open and technical',look:'A decentralized social network with technical specs and governance-driven transparency, on dark backgrounds.',sw:['#0f1419','#0052d6','#188f00','#f3eee4'],fonts:['Space Grotesk','Inter'],cards:[cc('CCB00721',1),cc('CCB00721',2)],alt:'Evrylife posts made by the Alchemist'},
    {name:'UPM',style:'Cyan on dark',look:'A tech-forward press platform with a dark scientific backdrop, cyan accents, and precise technical typography.',sw:['#0f172a','#22d3ee','#a855f7','#ffffff'],fonts:['Fraunces','IBM Plex Mono'],cards:[cc('CCB00741',1),cc('CCB00741',2)],alt:'UPM posts made by the Alchemist'}
  ];
  var CH=[
    {orig:['brand-kits/02c310c0-4211-4744-a22d-ee1f84707e28/character-271b99e7781a.png','Watch Crypto’s dachshund','The mascot as uploaded'],
     scenes:[[sc('CCB00743',1),'Skateboard'],[sc('CCB00743',3),'Ship’s wheel'],[sc('CCB00742',1),'Gold bars']]},
    {orig:['brand-kits/eadac1ef-3145-45fc-9b10-3660657cca29/character-ff41fa9fc036.png','The Alchemist himself','The mascot as uploaded'],
     scenes:[[sc('CCB00737',1),'Market square'],[sc('CCB00737',2),'The library'],[sc('CCB00737',3),'Skate ramp']]}
  ];
  var POST={brand:'Everything Nightlife',imgs:[cc('CCB00738',1),cc('CCB00738',2)],alt:['Slide 1: New York has 1,907 events listed right now','Slide 2: Halloween week in New York'],
    cap:'New York has 1,907 events listed right now. Halloween week? Every room in the city is doing something. Club nights, concerts, comedy, theatre — all competing for your time. Pick the one that fits your night.',
    tags:['#HalloweenNYC','#LiveMusic','#NYCHalloween','#NightlifeNYC','#ClubNightNYC']};
  function q(r,s){return r.querySelector(s);}
  function run(){
    if(window.__fmEx)return; window.__fmEx=1;
    var st=document.createElement('style');
    st.textContent='.va .ch:not(.orig) img{object-fit:cover!important}';
    document.head.appendChild(st);
    /* hero statics (only if the rotation script still shows an old brand) */
    var OLD=/spinquest|reading ?race|bested|\.app$|Playful|Glow|Pop poster/i;
    [['[data-chip]','everythingnightlife.com'],['[data-st-url]','everythingnightlife.com'],['[data-st-look]','Neon on black · Space Grotesk · Inter'],['[data-bt-name]','Everything Nightlife'],['[data-bt-look]','Neon nightlife']].forEach(function(a){
      var e=document.querySelector(a[0]);if(e&&OLD.test(e.textContent))e.textContent=a[1];});
    var bn=document.querySelector('[data-bt-name]'),bs=document.querySelector('[data-bt-sw]');
    if(bn&&bs&&/^Everything Nightlife$/.test(bn.textContent)&&!bs.querySelector('i[style*="ff2d78"]')&&!bs.getAttribute('data-fm'))bs.innerHTML=BR[0].sw.map(function(x){return '<i style="background:'+x+'"></i>';}).join('');
    /* Made with the Alchemist: brand cards */
    var cards=document.querySelectorAll('#a-brands .bcard');
    for(var i=0;i<cards.length&&i<BR.length;i++){var c=cards[i],b=BR[i];
      var n=q(c,'.bhead b'),s=q(c,'.bhead span'),l=q(c,'.blook'),w=q(c,'.swatch'),f=q(c,'.faces'),p=q(c,'.pair');
      if(n)n.textContent=b.name; if(s)s.textContent=b.style; if(l)l.textContent='“'+b.look+'”';
      if(w)w.innerHTML=b.sw.map(function(x){return '<i style="background:'+x+'"></i>';}).join('');
      if(f)f.innerHTML=b.fonts.map(function(x){return '<code>'+esc(x)+'</code>';}).join('');
      if(p)p.innerHTML=b.cards.map(function(x,k){return '<img loading="lazy" src="'+img(x,420)+'" alt="'+esc(k?'':b.alt)+'">';}).join('');
    }
    /* Familiars */
    var rows=document.querySelectorAll('#a-characters .chargrid');
    for(var r=0;r<rows.length&&r<CH.length;r++){var d=CH[r],figs=rows[r].querySelectorAll('figure.ch');
      for(var k=0;k<figs.length;k++){var fg=figs[k],im=q(fg,'img'),cp=q(fg,'figcaption');
        if(k===0){im.src=img(d.orig[0],600);im.alt=d.orig[1]+' (original)';if(cp)cp.innerHTML='<b>'+esc(d.orig[1])+'</b>'+esc(d.orig[2]);}
        else if(d.scenes[k-1]){im.src=img(d.scenes[k-1][0],600);im.alt=d.orig[1]+': '+d.scenes[k-1][1];if(cp)cp.innerHTML='<b>'+esc(d.scenes[k-1][1])+'</b>';}
        im.removeAttribute('srcset');
      }
    }
    /* A real post */
    var pc=q(document,'#a-post .postcard');
    if(pc){var tp=q(pc,'.top span');if(tp)tp.textContent=POST.brand;
      var pi=pc.querySelectorAll('img');for(var m=0;m<pi.length&&m<POST.imgs.length;m++){pi[m].src=img(POST.imgs[m],600);pi[m].alt=POST.alt[m];}
      var cap=q(pc,'.cap');if(cap)cap.textContent=POST.cap;
      var tg=pc.querySelectorAll('.tags > *');for(var t=0;t<tg.length;t++){if(POST.tags[t])tg[t].textContent=POST.tags[t];}
    }
    /* Anatomy (variant B) */
    var an=document.getElementById('anatomy');
    if(an){var ai=q(an,'img');if(ai){ai.src=img(POST.imgs[0],600);ai.alt=POST.alt[0];}
      var sp=an.querySelectorAll('span');for(var u=0;u<sp.length;u++){var tx=sp[u].textContent.trim();
        if(tx==='SpinQuest')sp[u].textContent=POST.brand; else if(/^#(SpinQuest|Vail|SkiSeason|Colorado)$/.test(tx)){var ix=['#SpinQuest','#Vail','#SkiSeason','#Colorado'].indexOf(tx);sp[u].textContent=POST.tags[ix];}}
      var ps=an.querySelectorAll('p');for(var v=0;v<ps.length;v++){var pt=ps[v].textContent;
        if(/Vail Mountain/.test(pt))ps[v].textContent=POST.cap;
        else if(/November 13, 2026/.test(pt))ps[v].textContent='everythingnightlife.com. The post links to the matching page on the site.';}
      var lb=an.querySelectorAll('.lab');for(var y=0;y<lb.length;y++){if(/Event date/i.test(lb[y].textContent))lb[y].textContent='Links to';}
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();

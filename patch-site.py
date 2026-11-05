import os,shutil
def patch(path,tag,marker):
    if not os.path.exists(path):
        print('NOTE:',path,'not found here - skipped'); return
    s=open(path,encoding='utf-8').read()
    if marker in s:
        print(path,'already patched'); return
    shutil.copyfile(path,path+'.pre-reach.bak')
    s=s.replace('</body>',tag+'</body>',1) if '</body>' in s else s+tag
    open(path,'w',encoding='utf-8').write(s)
    print(path,'patched (backup',path+'.pre-reach.bak)')
patch('dashboard/index.html','<script src="/assets/xpromo.js" defer></script>','assets/xpromo.js')
patch('index.html','<script src="/assets/home-reach.js" defer></script>','assets/home-reach.js')
for f in ('reach/index.html','assets/xpromo.js','assets/home-reach.js'):
    print('OK' if os.path.exists(f) else 'MISSING',f,os.path.getsize(f) if os.path.exists(f) else '')

# Terms sheet: nobody skips it. Remove "Not now" and the close button (declining = closing the tab; Escape still signs out).
import re
def patch_terms(path='dashboard/index.html'):
    if not os.path.exists(path): print('NOTE:',path,'not found - skipped'); return
    s=open(path,encoding='utf-8').read()
    if 'tg-nodismiss' in s: print(path,'terms sheet already patched'); return
    pat=re.compile(r'<button type="button" class="btn btn-ghost" data-close>Not now</button>(\s*<button type="button" class="btn btn-gold" id="tgOk">)')
    s2,n=pat.subn(r'\1',s,count=1)
    if n!=1: print('NOTE: terms footer not found in',path,'- left unchanged'); return
    shutil.copyfile(path,path+'.pre-terms.bak')
    css='<style id="tg-nodismiss">div:has(.terms-gate) [data-close]{display:none!important}</style>'
    s2=s2.replace('</head>',css+'</head>',1)
    open(path,'w',encoding='utf-8').write(s2)
    print(path,'terms sheet patched: "Not now" removed (backup',path+'.pre-terms.bak)')
patch_terms()

# Hero showcase: swap the old SpinQuest / Reading Race / Bested rotation for current-engine brands.
def patch_hero(path='index.html'):
    if not os.path.exists(path): print('NOTE:',path,'not found - skipped'); return
    s=open(path,encoding='utf-8').read()
    if 'fm-hero-v22' in s: print(path,'hero already patched'); return
    cc=lambda i,n:'content-calendar/%s/card_%d.png'%(i,n)
    def b(name,url,look,style,sw,ids):
        return "{ name: '%s', url: '%s', look: '%s', style: '%s', sw: %s, cards: [%s] }"%(name,url,look,style,str(sw),', '.join("'%s'"%cc(ids,n) for n in (1,2,3)))
    arr='/* fm-hero-v22 */ var BRANDS = [ '+', '.join([
        b('Everything Nightlife','everythingnightlife.com','Neon on black \u00b7 Space Grotesk \u00b7 Inter','Neon nightlife',['#08060d','#ff2d78','#22d3ee','#f6f3fb'],'CCB00738'),
        b('Evrylife','evrylife.org','Open and technical \u00b7 Space Grotesk \u00b7 Inter','Open and technical',['#0f1419','#0052d6','#188f00','#f3eee4'],'CCB00721'),
        b('UPM','unitedpress.media','Cyan on dark \u00b7 Fraunces \u00b7 IBM Plex Mono','Cyan on dark',['#0f172a','#22d3ee','#a855f7','#ffffff'],'CCB00741')])+' ];'
    pat=re.compile(r'var BRANDS\s*=\s*\[\s*\{.*?\}\s*\]\s*;',re.S)
    s2,n=pat.subn(lambda m:arr,s,count=1)
    if n!=1: print('NOTE: hero BRANDS array not found in',path,'- left unchanged'); return
    # let the image helper take full storage paths as well as the old showcase file names
    s3=s2.replace("site/showcase/' + n + '","' + (n.indexOf('/') > -1 ? n : 'site/showcase/' + n) + '")
    if s3==s2: print('NOTE: hero image helper not recognised - cards may not load'); 
    # static first paint, before the rotation starts
    s3=s3.replace('>readingrace.com<','>everythingnightlife.com<').replace('>Playful bands \u00b7 Fredoka \u00b7 Dash<','>Neon on black \u00b7 Space Grotesk \u00b7 Inter<')
    shutil.copyfile(path,path+'.pre-hero.bak')
    open(path,'w',encoding='utf-8').write(s3)
    print(path,'hero showcase patched (backup',path+'.pre-hero.bak)')
patch_hero()

# Dashboard: new campaigns and "make more" start at 2 posts, and the Create posts / History panel starts collapsed
# (open only while the campaign has no posts yet). Idempotent via the fm-studio-v22 marker.
def patch_dashboard_v22(path='dashboard/index.html'):
    if not os.path.exists(path): print('NOTE:',path,'not found - skipped'); return
    s=open(path,encoding='utf-8').read()
    if 'fm-studio-v22' in s: print(path,'studio/default-2 already patched'); return
    orig=s; done=[]
    def sub(name,pat,rep,count=1,flags=0):
        nonlocal s
        s2,n=re.subn(pat,rep,s,count=count,flags=flags)
        if n: s=s2; done.append(name+'x%d'%n)
        else: print('NOTE: pattern not found:',name)
    # 1) defaults: never more than 2
    sub('more-default',r"Math\.min\(10, Math\.max\(1, \(c\.target_content_count \|\| 2\) - have\) \|\| 3\)","Math.min(2, Math.max(1, (c.target_content_count || 2) - have) || 2)",count=0)
    sub('idea-default',r"Math\.max\(1, Math\.min\(10, parseInt\(o\.posts, 10\) \|\| 4\)\)","Math.max(1, Math.min(2, parseInt(o.posts, 10) || 2))")
    # 2) collapsed panel
    sub('studio-class',r'<div class="camp-studio card" id="campStudio">','<div class="camp-studio card${(have > 0 && !S.studioOpen) ? \' cs-collapsed\' : \'\'}" id="campStudio">')
    sub('studio-toggle',r'(data-pane="history" aria-selected="\$\{tab === \'history\'\}">History</button>)(\s*)(</div>)',
        r'''\1<button type="button" class="cs-toggle" id="csToggle" aria-label="Show or hide" aria-expanded="${!(have > 0 && !S.studioOpen)}"><i></i></button>\2\3''')
    sub('tab-expands',r"(\$\$\('\.cs-tab', studio\)\.forEach\(\(tab\) => tab\.onclick = \(\) => \{)",
        r"\1 studio.classList.remove('cs-collapsed'); S.studioOpen = true; { const tg0 = $('#csToggle', studio); if (tg0) tg0.setAttribute('aria-expanded', 'true'); }")
    sub('toggle-wire',r"(function wireCampChat\(c\) \{\s*const studio = \$\('#campStudio'\);\s*if \(!studio\) return;)",
        r"\1 { const tg = $('#csToggle', studio); if (tg) tg.onclick = () => { const col = studio.classList.toggle('cs-collapsed'); S.studioOpen = !col; tg.setAttribute('aria-expanded', String(!col)); }; }")
    css=('<style id="fm-studio-v22">'
         '.camp-studio .cs-tabs{display:flex;align-items:center}'
         '.camp-studio .cs-toggle{margin-left:auto;background:none;border:0;color:inherit;cursor:pointer;padding:8px 10px;opacity:.7;border-radius:8px;line-height:0}'
         '.camp-studio .cs-toggle:hover{opacity:1}'
         '.camp-studio .cs-toggle i{display:block;width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(225deg) translate(-1px,-1px);transition:transform .15s}'
         '.camp-studio.cs-collapsed .cs-toggle i{transform:rotate(45deg) translate(-1px,-1px)}'
         '.camp-studio.cs-collapsed .cs-pane{display:none!important}'
         '</style>')
    s=s.replace('</head>',css+'</head>',1)
    if len(done)<5: print('NOTE: only',done,'applied - dashboard left UNCHANGED'); return
    shutil.copyfile(path,path+'.pre-studio.bak')
    open(path,'w',encoding='utf-8').write(s)
    print(path,'patched:',', '.join(done),'(backup',path+'.pre-studio.bak)')
patch_dashboard_v22()

# ---- v23: upgraded Terms of Service (2026-10-25) + re-acceptance via version bump ----
def patch_terms_v25():
    new_body=open('assets/terms-2026-10-25.html',encoding='utf-8').read().strip()
    p='terms/index.html'
    if os.path.exists(p):
        s=open(p,encoding='utf-8').read()
        if 'Version 2026-10-25' in s: print(p,'terms text already v2026-10-25')
        else:
            pat=re.compile(r'<div class="narrow prose legal">.*?</div>',re.S)
            if not pat.search(s): print('NOTE:',p,'prose block not found - terms text left unchanged')
            else:
                shutil.copyfile(p,p+'.pre-v25.bak')
                s=pat.sub(lambda m:new_body,s,count=1)
                s=s.replace('Last updated 10 October 2026.','Last updated 25 October 2026.')
                s=re.sub(r'("dateModified"\s*:\s*")2026-10-10',r'\g<1>2026-10-25',s)
                open(p,'w',encoding='utf-8').write(s)
                print(p,'terms text replaced with version 2026-10-25 (backup',p+'.pre-v25.bak)')
    else: print('NOTE:',p,'not found - skipped (if the site builds /terms/ with legal.py, update its text there too)')
    # Version constants: dashboard and Reach re-ask everyone to accept the new version.
    for path,pat,rep in (('dashboard/index.html',r"(const TERMS_VERSION\s*=\s*')2026-10-10(')",r"\g<1>2026-10-25\g<2>"),
                         ('reach/index.html',r'(var TERMS_VERSION\s*=\s*")2026-10-10(")',r'\g<1>2026-10-25\g<2>')):
        if not os.path.exists(path): print('NOTE:',path,'not found - skipped'); continue
        s=open(path,encoding='utf-8').read()
        s2,n=re.subn(pat,rep,s,count=1)
        if n==1:
            shutil.copyfile(path,path+'.pre-v25.bak'); open(path,'w',encoding='utf-8').write(s2); print(path,'TERMS_VERSION -> 2026-10-25')
        elif '2026-10-25' in s: print(path,'TERMS_VERSION already 2026-10-25')
        else: print('NOTE: TERMS_VERSION constant not found in',path)
patch_terms_v25()

# ---- v24: Reach brand switcher - left-aligned and wide enough to show the brand name on phones ----
def patch_reach_bsw():
    p='reach/index.html'
    if not os.path.exists(p): print('NOTE:',p,'not found - skipped'); return
    s=open(p,encoding='utf-8').read()
    if 'fm-bsw-v24' in s: print(p,'brand switcher already patched'); return
    css=('<style id="fm-bsw-v24">'
         '@media (max-width:700px){'
         '#topnav .spacer{display:none!important}'
         '#topnav>#bsw{flex:1 1 0!important;min-width:0!important;margin-left:6px!important;position:static!important}'
         '#topnav #bsBtn{max-width:none!important;width:100%;justify-content:flex-start}'
         '#topnav #bsLabel{flex:1 1 auto;min-width:0;text-align:left}'
         '#topnav #bsBtn .car{margin-left:auto}'
         '#topnav #bsMenu.bsmenu{position:absolute;left:12px!important;right:12px!important;top:100%;margin-top:4px;width:auto;min-width:0!important}'
         '}'
         '@media (min-width:701px){#bsBtn{max-width:260px!important}.bsmenu{min-width:280px}}'
         '</style>')
    if '</head>' not in s: print('NOTE: no </head> in',p); return
    shutil.copyfile(p,p+'.pre-v24.bak')
    open(p,'w',encoding='utf-8').write(s.replace('</head>',css+'</head>',1))
    print(p,'brand switcher patched (backup',p+'.pre-v24.bak)')
patch_reach_bsw()

# ---- v27: ONE Alchemist avatar for both modules: the lantern Alchemist (alchemist-action.png) that Reach always had ----
def patch_alchemist_avatar():
    OLD='platform-brand/assistant-wave.png'; NEW='platform-brand/alchemist-action.png'
    for p in ('reach/index.html','dashboard/index.html'):
        if not os.path.exists(p): print('NOTE:',p,'not found - skipped'); continue
        s=open(p,encoding='utf-8').read(); s0=s
        s=s.replace(OLD,NEW)
        s=re.sub(r'<style id="fm-alch-av">.*?</style>','',s,flags=re.S)
        if s==s0: print(p,'Alchemist avatar already the lantern one'); continue
        shutil.copyfile(p,p+'.pre-v27av.bak'); open(p,'w',encoding='utf-8').write(s); print(p,'floating Alchemist avatar -> lantern Alchemist (alchemist-action.png)')
patch_alchemist_avatar()

# ---- v26: Reach carries an inline copy of xpromo.js; refresh it so Reach gets the same header icons and the Alchemist hide switch ----
def patch_reach_xpromo():
    p='reach/index.html'
    if not os.path.exists(p) or not os.path.exists('assets/xpromo.js'): print('NOTE: reach or xpromo.js missing - skipped'); return
    s=open(p,encoding='utf-8').read(); x=open('assets/xpromo.js',encoding='utf-8').read().strip()
    if 'fmHdrCss' in s and 'fm-hide-alchemist' in s and 'fmAlchLook' in s and 'fmBrandLook' in s: print(p,'inline xpromo already current'); return
    a=s.find('/* Fullmedia Alchemist: module switch + cross-promotion')
    if a<0: print('NOTE: inline xpromo block not found in',p,'- left unchanged'); return
    b=s.rfind('<script',0,a); e=s.find('</script>',a)
    gt=s.find('>',b)
    if b<0 or e<0 or s[b:gt+1]!='<script>': print('NOTE: unexpected script wrapper - left unchanged'); return
    shutil.copyfile(p,p+'.pre-v26.bak')
    s=s[:gt+1]+x+s[e:]
    open(p,'w',encoding='utf-8').write(s)
    print(p,'inline xpromo refreshed (same bell/user icons as Content, Alchemist hide switch)')
patch_reach_xpromo()

# ---- v28: the homepage defines the image helper TWICE; the second one (the one that wins) still forced the old site/showcase/ prefix ----
def patch_hero_img_all(path='index.html'):
    if not os.path.exists(path): print('NOTE:',path,'not found - skipped'); return
    s=open(path,encoding='utf-8').read()
    old="site/showcase/' + n + '"; new="' + (n.indexOf('/') > -1 ? n : 'site/showcase/' + n) + '"
    c=s.count(old)
    if c==0: print(path,'hero image helpers already take full paths'); return
    shutil.copyfile(path,path+'.pre-v28img.bak')
    open(path,'w',encoding='utf-8').write(s.replace(old,new))
    print(path,'hero image helper fixed in',c,'place(s) - Everything Nightlife / Evrylife / UPM cards will load')
patch_hero_img_all()

# ---- v29: ONE header on every public page (home, pricing, help, resources, blog, legal ...) ----
def patch_site_header():
    tag='<script src="/assets/site-header.js" defer></script>'
    skip_top={'dashboard','reach','login','assets','dl','node_modules','.git','dealflow','_backup'}
    done=0; seen=0
    for root,dirs,files in os.walk('.'):
        rel=os.path.relpath(root,'.')
        top=rel.split(os.sep)[0] if rel!='.' else ''
        if top in skip_top: dirs[:]=[]; continue
        for f in files:
            if not f.endswith('.html'): continue
            fp=os.path.join(root,f)
            try: s=open(fp,encoding='utf-8').read()
            except Exception: continue
            seen+=1
            if 'assets/site-header.js' in s: continue
            if '<body' not in s: continue
            s=s.replace('</body>',tag+'</body>',1) if '</body>' in s else s+tag
            open(fp,'w',encoding='utf-8').write(s); done+=1
    print('site header: added to',done,'public page(s) of',seen,'(the rest already had it)')
patch_site_header()

/* Journal helpers: category filter + slider buttons. The page works without this file. */
(function(){
  document.querySelectorAll('[data-slider]').forEach(function(s){
    var tr=s.querySelector('.track'); if(!tr) return;
    s.querySelectorAll('[data-dir]').forEach(function(b){
      b.addEventListener('click',function(){
        var d=+b.getAttribute('data-dir'), w=tr.querySelector('.slide'); var step=(w?w.getBoundingClientRect().width:280)+14;
        tr.scrollBy({left:d*step,behavior:'smooth'});
      });
    });
  });
  var chips=document.querySelectorAll('.chip[data-cat]'); if(!chips.length) return;
  var cards=document.querySelectorAll('.card[data-cat]'), feat=document.querySelector('.featured[data-cat]');
  function apply(cat){
    chips.forEach(function(c){c.setAttribute('aria-pressed',c.getAttribute('data-cat')===cat?'true':'false')});
    cards.forEach(function(c){c.hidden=!(cat==='all'||c.getAttribute('data-cat')===cat)});
    if(feat) feat.hidden=!(cat==='all'||feat.getAttribute('data-cat')===cat);
    try{history.replaceState(null,'',cat==='all'?location.pathname:'#'+cat)}catch(e){}
  }
  chips.forEach(function(c){c.addEventListener('click',function(){apply(c.getAttribute('data-cat'))})});
  var h=(location.hash||'').replace('#',''); if(h&&document.querySelector('.chip[data-cat="'+h+'"]')) apply(h);
})();

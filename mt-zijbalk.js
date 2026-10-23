/* =====================================================================
   mt-zijbalk.js: de zijbalk van de nieuwe stijl (restyling fase 1, brok 2).
   De bestaande tabknoppen (.tab-btn in .tabs-wrap) worden de zijbalk: ze krijgen een lijn-icoon en een label, worden in een
   <nav class="zb-nav"> binnen .tabs-wrap gezet en alleen visueel gegroepeerd (CSS order). Er wordt niets verwijderd, hernoemd of
   verborgen dat de rol- en startlogica leest: onclick/showTab, .mt-rol-verborgen en style.display blijven van de app, zodat
   _eersteVrijeTab, deeplinks (#tab=...), "apart venster" en de rolfiltering ongewijzigd werken.
   Alleen actief als html[data-stijl="nieuw"] en het venster >= 700px breed is; anders (of na uitzetten van de stijl) wordt alles
   teruggezet en is de tool de oude bovenbalk. Geen innerHTML: alles via DOM-methoden.
   Inklappen (alleen iconen) wordt per computer onthouden (localStorage "mt-zijbalk"); onder 1100px is hij vanzelf ingeklapt.
   ===================================================================== */
(function () {
  'use strict';
  var K = 'mt-zijbalk', KM = 'mt-zijbalk-meer', MIN_BREED = 1100, MIN_ZIJBALK = 700, NS = 'http://www.w3.org/2000/svg';
  // Lijn-iconen (24x24, stroke): de eerste acht komen uit het canvas (Sidebar.dc.html), de rest in dezelfde stijl.
  // De lijn-iconen staan sinds de rust-pas in mt-iconen.js (één bron voor zijbalk en interface); dat bestand laadt eerst.
  var IC = (window.MTIconen && window.MTIconen.PAD) || {};
  // tabnaam (uit onclick="showTab('naam')") -> label, icoon, volgorde (CSS order) en of hij onder "Meer" valt
  var DEF = {
    attentie: { l: 'Vandaag', i: 'vandaag', o: 10 },
    geld: { l: 'Financiën', i: 'dash', o: 20 },
    inbox: { l: 'Inbox', i: 'inbox', o: 30 },
    projecten: { l: 'Projecten', i: 'projecten', o: 40 },
    agenda: { l: 'Planning', i: 'planning', o: 50 },
    toggl: { l: 'Uren', i: 'uren', o: 60 },
    bestelling: { l: 'Bestellijst', i: 'bestellijst', o: 70 },
    voorraad: { l: 'Voorraad', i: 'voorraad', o: 80 },
    klanten: { l: 'Klanten', i: 'klanten', o: 91, m: 1 },
    rapporten: { l: 'Rapporten', i: 'rapporten', o: 92, m: 1 },
    oplevering: { l: 'Opleveringen', i: 'oplevering', o: 93, m: 1 },
    verbeterpunten: { l: 'Verbeterpunten', i: 'verbeter', o: 94, m: 1 },
    dashboard: { l: 'Oud dashboard', i: 'oudDash', o: 95, m: 1 },
    instellingen: { l: 'Instellingen', i: 'instellingen', o: 110 },
    admin: { l: 'Admin', i: 'admin', o: 120 }
  };
  var st = { gebouwd: false, nav: null, orig: null, meer: null, tog: null, obs: null, raf: 0 };
  var mqBreed = window.matchMedia('(max-width:' + (MIN_BREED - 1) + 'px)');
  var mqZijbalk = window.matchMedia('(min-width:' + MIN_ZIJBALK + 'px)');

  function lees(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function schrijf(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
  function html() { return document.documentElement; }
  function wil() { return html().getAttribute('data-stijl') === 'nieuw' && mqZijbalk.matches; }
  function auto() { return mqBreed.matches; }
  function smal() { return auto() || lees(K) === 'smal'; }
  function tabNaam(b) { var m = /showTab\('([^']+)'/.exec(b.getAttribute('onclick') || ''); return m ? m[1] : ''; }
  function verborgen(b) { return b.style.display === 'none' || b.classList.contains('mt-rol-verborgen'); }
  function ownTekst(b) { var t = ''; for (var i = 0; i < b.childNodes.length; i++) if (b.childNodes[i].nodeType === 3) t += b.childNodes[i].nodeValue; return t.replace(/[^\wÀ-ɏ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function svg(naam) {
    var s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'zb-ic');
    p.setAttribute('d', IC[naam] || IC.meer); s.appendChild(p); return s;
  }
  function span(cls, tekst) { var e = document.createElement('span'); e.className = cls; e.textContent = tekst; return e; }

  // Eén tabknop krijgt icoon + label. De oorspronkelijke tekst blijft in de knop staan (CSS maakt hem onzichtbaar), de
  // toegankelijke naam komt uit aria-label.
  function verrijk(b) {
    var n = tabNaam(b), d = DEF[n] || { l: ownTekst(b) || n || 'Tab', i: 'meer', o: 96, m: 1 };
    b.insertBefore(span('zb-t', d.l), b.firstChild); b.insertBefore(svg(d.i), b.firstChild);
    b.setAttribute('data-zb-o', String(d.o)); if (d.m) b.setAttribute('data-zb-meer', '1');
    b.setAttribute('data-zb-label', d.l); b.setAttribute('aria-label', d.l);
  }
  function terug(b) {
    var i = b.querySelector(':scope > .zb-ic'), t = b.querySelector(':scope > .zb-t');
    if (i) b.removeChild(i); if (t) b.removeChild(t);
    ['data-zb-o', 'data-zb-meer', 'data-zb-label', 'aria-label', 'aria-current'].forEach(function (a) { b.removeAttribute(a); });
    if (b.getAttribute('data-zb-titel') === '1') { b.removeAttribute('title'); b.removeAttribute('data-zb-titel'); }
  }

  function bouw() {
    var w = document.querySelector('.tabs-wrap'); if (!w || st.gebouwd) return;
    st.orig = Array.prototype.slice.call(w.children);
    var nav = document.createElement('nav'); nav.className = 'zb-nav'; nav.setAttribute('aria-label', 'Hoofdmenu');
    var tog = document.createElement('button'); tog.type = 'button'; tog.className = 'zb-toggle';
    tog.appendChild(svg('paneel')); tog.appendChild(span('zb-t', 'Inklappen'));
    tog.addEventListener('click', wissel); nav.appendChild(tog);
    var meer = document.createElement('button'); meer.type = 'button'; meer.className = 'zb-meer'; meer.setAttribute('data-zb-o', '90');
    meer.appendChild(svg('meer')); meer.appendChild(span('zb-t', 'Meer')); meer.appendChild(svg('chevron'));
    meer.addEventListener('click', function () { schrijf(KM, nav.classList.contains('zb-meer-dicht') ? 'open' : 'dicht'); sync(); });
    nav.appendChild(meer);
    var stijl = document.createElement('button'); stijl.type = 'button'; stijl.className = 'zb-stijl'; stijl.setAttribute('data-zb-o', '125'); stijl.setAttribute('title', 'Terug naar de oude stijl'); stijl.setAttribute('aria-label', 'Oude stijl: terug naar de oude weergave');
    stijl.appendChild(svg('stijl')); stijl.appendChild(span('zb-t', 'Oude stijl'));
    stijl.addEventListener('click', function () { if (window.mtStijl) window.mtStijl.zet(false); }); nav.appendChild(stijl);   // v2.18: de nieuwe stijl is standaard; dit is de weg terug (en in de oude stijl staat "Nieuwe stijl" in de bovenbalk)
    var sp = document.createElement('div'); sp.className = 'zb-spacer'; sp.setAttribute('data-zb-o', '100'); sp.setAttribute('aria-hidden', 'true'); nav.appendChild(sp);
    st.orig.forEach(function (el) {
      if (el.classList.contains('tab-btn')) verrijk(el);
      else if (el.classList.contains('tab-help-btn')) el.setAttribute('data-zb-o', /tbOpenInNieuwVenster/.test(el.getAttribute('onclick') || '') ? '131' : '130');
      nav.appendChild(el);
    });
    w.appendChild(nav);
    st.nav = nav; st.meer = meer; st.tog = tog; st.gebouwd = true;
    st.obs = new MutationObserver(plan);   // de rol- en tablogica zet klassen/stijlen op de knoppen: label- en groepstatus volgt
    st.obs.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  }
  function afbreek() {
    if (!st.gebouwd) return;
    if (st.obs) { st.obs.disconnect(); st.obs = null; }
    var w = document.querySelector('.tabs-wrap');
    st.orig.forEach(function (el) {
      if (el.classList.contains('tab-btn')) terug(el);
      else if (el.classList.contains('tab-help-btn')) { el.removeAttribute('data-zb-o'); if (el.getAttribute('data-zb-titel') === '1') { el.removeAttribute('title'); el.removeAttribute('data-zb-titel'); } }
      if (w) w.appendChild(el);   // in de oorspronkelijke volgorde terug
    });
    if (st.nav && st.nav.parentNode) st.nav.parentNode.removeChild(st.nav);
    st.nav = st.meer = st.tog = st.orig = null; st.gebouwd = false;
    html().removeAttribute('data-zijbalk'); html().removeAttribute('data-zb-auto');
  }

  function wissel() { schrijf(K, lees(K) === 'smal' ? null : 'smal'); pas(); }
  function plan() { if (st.raf) return; st.raf = requestAnimationFrame(function () { st.raf = 0; sync(); }); }

  // Groepstatus: "Meer" alleen tonen als er iets onder zichtbaar is; open als de actieve tab eronder valt; aria-current bijwerken.
  function sync() {
    if (!st.gebouwd) return;
    var items = st.nav.querySelectorAll('.tab-btn[data-zb-meer]'), zicht = 0, actief = false;
    for (var i = 0; i < items.length; i++) if (!verborgen(items[i])) { zicht++; if (items[i].classList.contains('active')) actief = true; }
    var open = lees(KM) === 'open' || actief;
    if (st.meer.hidden !== (zicht === 0)) st.meer.hidden = zicht === 0;
    if (st.nav.classList.contains('zb-meer-dicht') === open) st.nav.classList.toggle('zb-meer-dicht', !open);
    var ae = String(open); if (st.meer.getAttribute('aria-expanded') !== ae) st.meer.setAttribute('aria-expanded', ae);
    var knoppen = st.nav.querySelectorAll('.tab-btn');
    for (var j = 0; j < knoppen.length; j++) {
      var is = knoppen[j].classList.contains('active') ? 'page' : null;
      if (knoppen[j].getAttribute('aria-current') !== is) { if (is) knoppen[j].setAttribute('aria-current', is); else knoppen[j].removeAttribute('aria-current'); }
    }
  }

  // Breed/smal toepassen: attribuut op <html> (CSS leest --zb-w daaruit), titels als tooltip bij alleen-iconen.
  function pas() {
    if (!st.gebouwd) return;
    var s = smal(), h = html();
    h.setAttribute('data-zijbalk', s ? 'smal' : 'breed');
    if (auto()) h.setAttribute('data-zb-auto', '1'); else h.removeAttribute('data-zb-auto');
    var knoppen = st.nav.querySelectorAll('.tab-btn,.tab-help-btn');
    for (var i = 0; i < knoppen.length; i++) {
      var b = knoppen[i], lab = b.getAttribute('data-zb-label');
      if (s) { if (!b.hasAttribute('title') && lab) { b.setAttribute('title', lab); b.setAttribute('data-zb-titel', '1'); } }
      else if (b.getAttribute('data-zb-titel') === '1') { b.removeAttribute('title'); b.removeAttribute('data-zb-titel'); }
    }
    st.tog.setAttribute('aria-expanded', String(!s));
    var t = st.tog.querySelector('.zb-t'); if (t) t.textContent = s ? 'Uitklappen' : 'Inklappen';
    st.tog.setAttribute('aria-label', s ? 'Zijbalk uitklappen' : 'Zijbalk inklappen');
    sync();
  }

  function kop() {   // projectkop/klantkop/lijstkaart rekenen met de hoogte van header + .tabs-wrap (die is in de zijbalk 0)
    try { if (typeof mtKopHoogte === 'function') mtKopHoogte(); } catch (e) { }
    // Een al getekende projectkop/klantkop heeft zijn top inline gekregen met de kophoogte van toen (112 met bovenbalk, 60
    // met zijbalk): opnieuw zetten, daarna de sectiebalk eronder. Zonder open project is dit een no-op.
    try {
      var wrap = document.querySelector('.tabs-wrap'), hdr = document.querySelector('header');
      var top = ((hdr && hdr.offsetHeight) || 60) + ((wrap && wrap.offsetHeight) || 0);
      var ctx = document.querySelectorAll('.proj-ctx'); for (var i = 0; i < ctx.length; i++) ctx[i].style.top = top + 'px';
      if (typeof _projSecNavTop === 'function') _projSecNavTop();
    } catch (e) { }
    try { window.dispatchEvent(new Event('resize')); } catch (e) { }
  }
  function herijk() {
    var w = wil();
    // kop() pas na pas(): pas() zet data-zijbalk, en pas dan is .tabs-wrap 0 hoog (de kophoogte die kop() leest)
    if (w && !st.gebouwd) { bouw(); pas(); kop(); }
    else if (!w && st.gebouwd) { afbreek(); kop(); }
    else if (st.gebouwd) pas();
  }
  function start() {
    herijk();
    window.addEventListener('mt-stijl', herijk);
    [mqBreed, mqZijbalk].forEach(function (q) { if (q.addEventListener) q.addEventListener('change', herijk); else if (q.addListener) q.addListener(herijk); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  
  // Eenmalige melding bij de eerste keer in de nieuwe stijl (per toestel; alleen als er geen eigen keuze is): rechtsonder, role=status, nooit een dialoog.
  (function(){
    try{ if(!window.mtStijl||mtStijl.expliciet()||localStorage.getItem('mt-stijl-gezien')) return; }catch(e){ return; }
    var tel=0, iv=setInterval(function(){
      tel++; if(tel>400||!mtStijl.aan()){ clearInterval(iv); return; }
      if(!((function(){ var a=document.getElementById('app-wrap'); return !!a&&a.style.display!=='none'; })())) return;
      clearInterval(iv); try{ localStorage.setItem('mt-stijl-gezien','1'); }catch(e){}
      var m=document.createElement('div'); m.className='stijl-melding'; m.setAttribute('role','status'); m.setAttribute('aria-live','polite');
      var t=document.createElement('span'); t.textContent='Nieuwe stijl. Liever de oude?';
      var b=document.createElement('button'); b.type='button'; b.className='stijl-melding-knop'; b.textContent='Oude stijl'; b.addEventListener('click',function(){ m.remove(); mtStijl.zet(false); });
      var x=document.createElement('button'); x.type='button'; x.className='stijl-melding-x'; x.setAttribute('aria-label','Sluiten'); x.textContent='×'; x.addEventListener('click',function(){ m.remove(); });
      m.appendChild(t); m.appendChild(b); m.appendChild(x); document.body.appendChild(m);
      window.addEventListener('mt-stijl',function(){ if(!mtStijl.aan()&&m.parentNode) m.remove(); });
    },1500);
  })();
  window.mtZijbalk = { wissel: wissel, herijk: herijk };
})();

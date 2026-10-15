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
  var IC = {
    vandaag: 'M3 10.5L12 3l9 7.5M5 9.5V20h14V9.5M10 20v-6h4v6',
    dash: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    oudDash: 'M3 3v18h18M7 14l4-4l3 3l5-6',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
    projecten: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    planning: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4',
    uren: 'M12 7v5l3 2M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    bestellijst: 'M3 4h2l2.4 11h10.2L20 8H6.2M9 20a1 1 0 1 0 0.01 0M17 20a1 1 0 1 0 0.01 0',
    voorraad: 'M21 8l-9-5l-9 5v8l9 5l9-5zM3 8l9 5l9-5M12 13v8',
    meer: 'M5 12h.01M12 12h.01M19 12h.01',
    rapporten: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
    oplevering: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0M8 12l3 3l5-6',
    klanten: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8',
    verbeter: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3',
    instellingen: 'M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3a1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
    admin: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
    paneel: 'M4 5h16v14H4zM9 5v14',
    chevron: 'M6 9l6 6 6-6'
  };
  // tabnaam (uit onclick="showTab('naam')") -> label, icoon, volgorde (CSS order) en of hij onder "Meer" valt
  var DEF = {
    attentie: { l: 'Vandaag', i: 'vandaag', o: 10 },
    geld: { l: 'Dashboard', i: 'dash', o: 20 },
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
  window.mtZijbalk = { wissel: wissel, herijk: herijk };
})();

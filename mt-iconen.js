/* mt-iconen.js — rust-pas R2 + R3 (alleen actief binnen html[data-stijl="nieuw"]; de oude stijl blijft byte voor byte gelijk).
 *
 * R2  Lijn-iconen i.p.v. emoji. Eén inline SVG-sprite met <symbol>'s (24-raster, lijn 1,8, currentColor), opgebouwd met DOM-aanroepen
 *     (nooit innerHTML met gegevens). window.mtIcoon(naam) geeft een <svg><use href="#mt-ic-naam"/></svg> terug; een onbekende naam geeft null.
 *     Bestaande emoji in de interface (aangewezen gebieden) worden bij het tekenen vervangen door hun icoon; het oorspronkelijke teken
 *     blijft in data-emoji, zodat bij terugschakelen naar de oude stijl alles weer terugkomt. Emoji die iemand zelf invoert (projectnaam,
 *     notitie, mail) blijven staan: alleen leidende tekens bij knoppen/koppen/labels/chips of een leidend teken + spatie worden vervangen.
 * R3  Statustaal: icoon + woord + kleur. window.mtStatus(soort, woord) geeft een chip (DOM). Bestaande badges en statusbalken krijgen er
 *     hetzelfde icoon bij (de tekst blijft staan), zodat status nooit alleen kleur is.
 * Tekstpas (nieuwe stijl): geen uitroeptekens in knoppen/koppen/meldingen, uren als 2:30 of 4u, datums als "wo 14 okt", bedragen zonder ,00
 *     buiten tabellen, "wk 44" als "week 44".
 *
 * De iconen zijn lijnpaden in de stijl van Lucide (ISC-licentie); de eerste negentien komen uit de zijbalk (mt-zijbalk.js leest ze hier).
 */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  // ── de iconen: naam → pad (of lijst van paden/instellingen) ──
  var PAD = {
    // zijbalk (gedeeld met mt-zijbalk.js)
    vandaag: 'M3 10.5L12 3l9 7.5M5 9.5V20h14V9.5M10 20v-6h4v6',
    dash: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    oudDash: 'M3 3v18h18M7 14l4-4l3 3l5-6',
    forecast: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M4 15h16M10 4v16M15 4v16',
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
    stijl: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2.2c-.5-1.3.3-2.8 1.8-2.8H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3M7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
    chevron: 'M6 9l6 6 6-6',
    // vervanging van emoji
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    upload: 'M12 15V3M7 8l5-5 5 5M5 21h14',
    paperclip: 'M21 11.5l-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-8',
    mapOpen: 'M5 20h13a2 2 0 0 0 2-1.7l1-6.3H8L6 19M3 19V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v2',
    grafiek: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    agenda: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    timer: 'M10 2h4M12 8v5l3 2M12 22a8 8 0 1 0 0-16a8 8 0 0 0 0 16',
    zandloper: 'M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9',
    winkelwagen: 'M3 4h2l2.4 11h10.2L20 8H6.2M9 20h.01M17 20h.01',
    lijst: 'M9 4h6v3H9zM8 5.5H6a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5a2 2 0 0 0-2-2h-2M9 12h6M9 16h6',
    glans: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
    factuur: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
    printer: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
    pakket: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
    mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6',
    vlag: 'M5 21V4M5 4h12l-2 4 2 4H5',
    sjabloon: 'M4 4h16v5H4zM4 13h7v7H4zM15 13h5v7h-5z',
    vrachtwagen: 'M2 6h11v10H2zM13 9h4l4 4v3h-8M6 19a1.5 1.5 0 1 0 .01 0M17 19a1.5 1.5 0 1 0 .01 0',
    waarschuwing: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    doel: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8M12 12h.01',
    vink: 'M5 12l5 5L20 7',
    vinkCirkel: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M8 12l3 3 5-6',
    vinkVierkant: 'M4 4h16v16H4zM8 12l3 3 5-6',
    leeg: 'M4 4h16v16H4z',
    mensen: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16 4.1a3.5 3.5 0 0 1 0 6.8',
    persoon: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
    zoek: 'M11 19a8 8 0 1 0 0-16a8 8 0 0 0 0 16M21 21l-4.3-4.3',
    prullenbak: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    ververs: 'M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5',
    wissel: 'M3 8h16M15 4l4 4-4 4M21 16H5M9 12l-4 4 4 4',
    document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
    geld: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M15 9.5a3.5 3.5 0 0 0-6 1.5v2a3.5 3.5 0 0 0 6 1.5M7.5 11h5M7.5 13h5',
    punt: 'M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11zM12 12a2 2 0 1 0 0-4a2 2 0 0 0 0 4',
    bel: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 20a2 2 0 0 0 4 0',
    potlood: 'M4 20l1-4L17 4a2.1 2.1 0 0 1 3 3L8 19zM14 7l3 3',
    camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8a4 4 0 0 0 0 8',
    opslaan: 'M5 3h12l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v6h8M8 21v-7h8v7',
    verboden: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M5.6 5.6l12.8 12.8',
    kruis: 'M6 6l12 12M18 6L6 18',
    bericht: 'M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-4.5A8 8 0 1 1 21 12z',
    liniaal: 'M3 17L17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2',
    label: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
    telefoon: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2',
    contact: 'M5 3h14v18H5zM9 9h6M9 13h6M3 7h2M3 11h2M3 15h2',
    slot: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    plus: 'M12 5v14M5 12h14',
    wolk: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.7-1.3A4.5 4.5 0 0 1 17 18z',
    wereld: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    kompas: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M15.5 8.5l-2 5-5 2 2-5z',
    duim: 'M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.2 20H7',
    oog: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6',
    bug: 'M9 7a3 3 0 0 1 6 0M7 11h10v4a5 5 0 0 1-10 0zM3 11h4M17 11h4M4 19l3-2M20 19l-3-2M12 11v9',
    lagen: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    rekenmachine: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
    druppel: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
    hekje: 'M5 9h14M5 15h14M10 3L8 21M16 3l-2 18',
    info: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M12 11v5M12 8h.01',
    speld: 'M12 17v5M8 3h8l-1 6 3 4H6l3-4z',
    handtekening: 'M3 20c3 0 4-8 7-8s1 6 4 6 3-5 7-5M4 15l10-11 3 3L8 18l-4 1z',
    pijlOmhoog: 'M12 20V5M6 11l6-6 6 6',
    // statusiconen (README): open, bezig, wacht, klaar, voorstel, gepland, probleem
    stOpen: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18',
    stBezig: ['M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18', { d: 'M12 3a9 9 0 0 1 0 18z', vul: true }],
    stWacht: [{ d: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18', streep: '3.2 3.2' }, 'M10 9v6M14 9v6'],
    stKlaar: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M8 12l3 3 5-6',
    stVoorstel: [{ d: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18', streep: '3.2 3.2' }, 'M12 8v5M12 16h.01'],
    stGepland: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18M12 7v5l3 2',
    stProbleem: 'M12 3l10 18H2zM12 10v5M12 18h.01'
  };

  // ── emoji → icoon (alleen de gangbare; wat hier niet staat blijft staan) ──
  var KAART = {};
  function reg(naam, tekens) { Array.from(tekens).forEach(function (c) { if (c.trim()) KAART[c] = naam; }); }
  reg('inbox', '📥'); reg('download', '⬇⬇️'); reg('upload', '⬆⬆️📤'); reg('paperclip', '📎');
  reg('mapOpen', '🗂📂📁'); reg('grafiek', '📊'); reg('agenda', '📅📆'); reg('link', '🔗'); reg('timer', '⏱'); reg('zandloper', '⏳');
  reg('winkelwagen', '🛒'); reg('lijst', '📋📒'); reg('glans', '✨✦'); reg('factuur', '🧾'); reg('printer', '🖨'); reg('pakket', '📦');
  reg('mail', '✉✉️📧📨📬'); reg('vlag', '🏆'); reg('sjabloon', '📐'); reg('vrachtwagen', '🚚'); reg('waarschuwing', '⚠⚠️'); reg('doel', '🎯');
  reg('vink', '✓✔✔️'); reg('vinkCirkel', '✅'); reg('vinkVierkant', '☑☑️'); reg('mensen', '👥'); reg('persoon', '👤'); reg('zoek', '🔍🔎');
  reg('prullenbak', '🗑🗑️'); reg('ververs', '↻🔄↺'); reg('wissel', '⇄↔'); reg('document', '📄📃'); reg('geld', '💰💳'); reg('punt', '📍');
  reg('speld', '📌'); reg('bel', '🔔'); reg('instellingen', '⚙⚙️🛠🛠️🔩'); reg('vandaag', '🏠'); reg('potlood', '✏✏️✎📝✍✍️'); reg('camera', '📷📸');
  reg('opslaan', '💾'); reg('verbeter', '💡'); reg('verboden', '⛔'); reg('kruis', '✕✗❌'); reg('bericht', '💬'); reg('liniaal', '📏');
  reg('label', '🏷🏷️'); reg('telefoon', '📞📱📲'); reg('contact', '📇'); reg('slot', '🔒'); reg('plus', '➕'); reg('wolk', '☁☁️');
  reg('wereld', '🌐'); reg('kompas', '🧭'); reg('duim', '👍'); reg('oog', '👁👁️'); reg('bug', '🐛'); reg('lagen', '🪵'); reg('rekenmachine', '🧮');
  reg('druppel', '🧴'); reg('hekje', '🔢'); reg('info', 'ℹℹ️');
  var KAART_RE = new RegExp('(' + Object.keys(KAART).sort(function (a, b) { return b.length - a.length; }).map(function (c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\uFE0F?', 'g');

  // ── de sprite en mtIcoon ──
  var spriteGebouwd = false;
  function el(tag, attrs) { var e = document.createElementNS(NS, tag); if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function vulSymbool(sym, def) {
    (Array.isArray(def) ? def : [def]).forEach(function (d) {
      var p = el('path', { d: typeof d === 'string' ? d : d.d });
      if (d && d.vul) { p.setAttribute('fill', 'currentColor'); p.setAttribute('fill-opacity', '.28'); }
      if (d && d.streep) p.setAttribute('stroke-dasharray', d.streep);
      sym.appendChild(p);
    });
  }
  function bouwSprite() {
    if (spriteGebouwd || !document.body) return;
    if (document.getElementById('mt-iconen-sprite')) { spriteGebouwd = true; return; }
    var s = el('svg', { id: 'mt-iconen-sprite', 'aria-hidden': 'true', focusable: 'false', width: '0', height: '0' });
    s.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    var defs = el('defs');
    Object.keys(PAD).forEach(function (n) { var sym = el('symbol', { id: 'mt-ic-' + n, viewBox: '0 0 24 24' }); vulSymbool(sym, PAD[n]); defs.appendChild(sym); });
    s.appendChild(defs); document.body.insertBefore(s, document.body.firstChild); spriteGebouwd = true;
  }
  // Een <svg class="ui-ico"> met een <use> naar het symbool; null bij een onbekende naam (nooit gegevens als naam).
  function mtIcoon(naam, opt) {
    if (!Object.prototype.hasOwnProperty.call(PAD, naam)) return null;
    bouwSprite();
    var s = el('svg', { 'class': 'ui-ico' + (opt && opt.klasse ? ' ' + opt.klasse : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    var u = el('use'); u.setAttribute('href', '#mt-ic-' + naam); s.appendChild(u); return s;
  }

  // ── R3: statuschip ──
  var STATUS = { open: ['stOpen', 'Open'], bezig: ['stBezig', 'Bezig'], wacht: ['stWacht', 'Wacht'], klaar: ['stKlaar', 'Klaar'], voorstel: ['stVoorstel', 'Voorstel'], gepland: ['stGepland', 'Gepland'], probleem: ['stProbleem', 'Probleem'] };
  function mtStatus(soort, woord) {
    var d = STATUS[soort]; if (!d) return null;
    var c = document.createElement('span'); c.className = 'ui-st ui-st--' + soort;
    var i = mtIcoon(d[0], { klasse: 'ui-ico-st' }); if (i) c.appendChild(i);
    c.appendChild(document.createTextNode(woord || d[1])); return c;
  }
  var BADGE = { 'badge-ok': 'stKlaar', 'badge-warn': 'stWacht', 'badge-danger': 'stProbleem', 'badge-info': 'stGepland', 'badge-gold': 'stVoorstel', 'badge-purple': 'stGepland' };
  var BALK = { ok: 'stKlaar', warn: 'stWacht', err: 'stProbleem' };
  var STATUSKLASSE = { telaat: 'stProbleem', bezig: 'stBezig', wacht: 'stWacht', gepland: 'stGepland', klaar: 'stKlaar', todo: 'stOpen', voorstel: 'stVoorstel' };

  // ── bereik: waar wordt vervangen (de gebieden zonder lopend werk van anderen) ──
  var TOEGESTAAN = ['#tab-attentie', '#tab-geld', '#tab-admin', '#tab-instellingen', '#tab-bestelling', '#tab-voorraad', '#tab-klanten', '#tab-rapporten',
    '#tab-oplevering', '#tab-vandaag', 'header', '.zb-lijst', '.zb-veld', '.zb-pal', '#plan-toast', 'dialog.mt-dialog'].join(',');
  var CALC = '.calc-wrap,[id^="offerte-calc-"],[id^="nacalc"],#calc-toast,#proj-sectie-inhoud[data-sectie="calculatie"]';
  var UITGESLOTEN = '#tab-inbox,#tab-toggl,#tab-projecten,#tab-agenda,#tab-timer,#tab-capture,#tab-feedback,textarea,input,select,option,script,style,[contenteditable],pre,code,svg,.ui-ico,[data-gebruikerstekst]';
  function inBereik(e) {
    if (!e || !e.closest) return false;
    if (e.closest(CALC)) return !e.closest('textarea,input,select,option,[contenteditable],pre,code,svg,[data-gebruikerstekst]');
    if (e.closest(UITGESLOTEN)) return false;
    return !!e.closest(TOEGESTAAN);
  }
  var KOP = /^(BUTTON|A|SUMMARY|LABEL|TH|H1|H2|H3|H4|H5|H6|LEGEND|DT|CAPTION)$/;
  var KLASSE = /(btn|badge|chip|tab|titel|title|kop|label|status|pill|tag|knop|melding|toast|leeg|hint)/i;
  // Mag een emoji in dit tekstknooppunt vervangen worden? Alleen waar het duidelijk interface is, niet middenin gebruikerstekst.
  function ifaceKnoop(n) {
    var p = n.parentElement; if (!p) return false;
    if (KOP.test(p.tagName) || KLASSE.test(p.className && p.className.baseVal === undefined ? String(p.className) : '')) return true;
    var v = n.nodeValue;
    if (/^\s*(\p{Extended_Pictographic}️?|[←-⇿✀-➿⬀-⯿])\s*$/u.test(v)) return true;   // het knooppunt is alleen dat teken
    return /^\s*(\p{Extended_Pictographic}|[←-⇿✀-➿⬀-⯿])/u.test(v) && /^\s*\S+\s/.test(v);
  }

  // ── tekstpas ──
  var MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'], DAG = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  function datumNl(d, m, j) { var dt = new Date(j, m - 1, d); if (dt.getFullYear() !== j || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; return DAG[dt.getDay()] + ' ' + d + ' ' + MND[m - 1] + (j !== new Date().getFullYear() ? ' ' + j : ''); }
  function urenNl(x) { var v = parseFloat(String(x).replace(',', '.')); if (!isFinite(v)) return null; var h = Math.floor(v + 1e-9), min = Math.round((v - h) * 60); if (min === 60) { h++; min = 0; } return min ? h + ':' + (min < 10 ? '0' : '') + min : h + 'u'; }
  var CHROME = 'button,label,h1,h2,h3,h4,h5,h6,summary,.empty-state,.status-bar,.mtd-body,.mtd-head,#plan-toast,#calc-toast,[class*="leeg"],[class*="melding"],[class*="hint"]';
  function tekstpas(t, n) {
    var p = n.parentElement, nw = t;
    if (/!/.test(nw) && p && p.closest(CHROME)) nw = nw.replace(/!+(?=\s|$)/g, '');
    nw = nw.replace(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/g, function (m, d, mo, j) { return datumNl(+d, +mo, +j) || m; })
      .replace(/\b(\d{4})-(\d{2})-(\d{2})\b(?![\w:-])/g, function (m, j, mo, d) { return datumNl(+d, +mo, +j) || m; })
      .replace(/\b(ma|di|wo|do|vr|za|zo)\.? (\d{1,2})-(\d{1,2})\b(?!-)/g, function (m, wd, d, mo) { return +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31 ? wd + ' ' + (+d) + ' ' + MND[+mo - 1] : m; })
      .replace(/\bwk\.? ?(\d{1,2})\b/g, 'week $1')
      .replace(/(^|[^\w:.,-])(\d+(?:[.,]\d+)?)\s?(?:uur|u)(?![\wéèëï])/g, function (m, v, x) { var r = urenNl(x); return r ? v + r : m; });
    if (!(p && p.closest('td,th'))) nw = nw.replace(/€ ?(\d{1,3}(?:\.\d{3})*|\d+),00\b(?!\d)/g, function (m, g) { return '€ ' + g; });
    return nw;
  }

  // ── verwerking van een knooppunt (en alles eronder) ──
  function maakIcoonVoor(teken) { var naam = KAART[teken.replace(/️/g, '')]; var i = naam && mtIcoon(naam); if (i) i.setAttribute('data-emoji', teken); return i; }
  function verwerkTekst(n) {
    var t = n.nodeValue; if (!t || !t.trim()) return;
    var p = n.parentElement; if (!p || !inBereik(p)) return;
    var nw = tekstpas(t, n); if (nw !== t) { n.nodeValue = nw; t = nw; }
    if (KAART_RE.test(t) && ifaceKnoop(n)) {
      KAART_RE.lastIndex = 0;
      var frag = document.createDocumentFragment(), laatst = 0, m, gevonden = false;
      while ((m = KAART_RE.exec(t))) {
        var i = maakIcoonVoor(m[1]); if (!i) continue; gevonden = true;
        if (m.index > laatst) frag.appendChild(document.createTextNode(t.slice(laatst, m.index)));
        frag.appendChild(i); laatst = m.index + m[0].length;
        // de spatie na het icoon hoort bij de afstand van het icoon (CSS), niet bij de tekst
        if (t.charAt(laatst) === ' ') laatst++;
      }
      KAART_RE.lastIndex = 0;
      if (gevonden) { if (laatst < t.length) frag.appendChild(document.createTextNode(t.slice(laatst))); n.parentNode.replaceChild(frag, n); }
    }
    KAART_RE.lastIndex = 0;
  }
  function verrijkStatus(e) {
    if (!e.classList || !inBereik(e)) return;
    var naam = null;
    if (e.classList.contains('badge')) { for (var k in BADGE) if (e.classList.contains(k)) { naam = BADGE[k]; break; } }
    else if (e.classList.contains('status-bar')) { for (var b in BALK) if (e.classList.contains(b)) { naam = BALK[b]; break; } }
    else if (e.classList.contains('vd-chip')) {   // Vandaag: statuschips van taken, leveringen en voorstellen
      var cl = String(e.className), tx = (e.textContent || '').toLowerCase(), mm = /vd-(?:chip|st)-(telaat|bezig|wacht|gepland|klaar|todo|voorstel)/.exec(cl);
      naam = mm ? STATUSKLASSE[mm[1]] : (/voorstel/.test(tx) ? 'stVoorstel' : null);
    }
    if (!naam) return;
    var f = e.firstElementChild; if (f && f.classList && f.classList.contains('ui-ico')) return;
    if (e.getAttribute('data-ic')) return;
    var i = mtIcoon(naam, { klasse: 'ui-ico-st' }); if (!i) return;
    e.setAttribute('data-ic', '1'); e.insertBefore(i, e.firstChild);
  }
  function verwerk(wortel) {
    if (!wortel) return;
    if (wortel.nodeType === 3) { verwerkTekst(wortel); return; }
    if (wortel.nodeType !== 1) return;
    if (wortel.closest && wortel.closest('svg')) return;
    verrijkStatus(wortel);
    wortel.querySelectorAll && wortel.querySelectorAll('.badge,.status-bar,.vd-chip').forEach(verrijkStatus);
    var w = document.createTreeWalker(wortel, NodeFilter.SHOW_TEXT, null), lijst = [], n;
    while ((n = w.nextNode())) lijst.push(n);
    lijst.forEach(verwerkTekst);
  }

  // ── aan/uit volgens html[data-stijl] ──
  var obs = null, attrObs = null, bezig = false;
  function aan() { return document.documentElement.getAttribute('data-stijl') === 'nieuw'; }
  function terugzetten() {
    document.querySelectorAll('svg.ui-ico[data-emoji]').forEach(function (s) { s.parentNode.replaceChild(document.createTextNode(s.getAttribute('data-emoji') + ' '), s); });
    document.querySelectorAll('[data-ic="1"]').forEach(function (e) { var f = e.firstElementChild; if (f && f.classList.contains('ui-ico-st')) e.removeChild(f); e.removeAttribute('data-ic'); });
  }
  function start() {
    if (obs || !document.body) return;
    bouwSprite();
    obs = new MutationObserver(function (lijst) {
      if (bezig) return; bezig = true;
      try {
        obs.disconnect();
        lijst.forEach(function (m) {
          if (m.type === 'characterData') { verwerkTekst(m.target); return; }
          m.addedNodes && m.addedNodes.forEach(function (n) { verwerk(n); });
        });
      } finally { bezig = false; obs.observe(document.body, { childList: true, subtree: true, characterData: true }); }
    });
    verwerk(document.body);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function stop() { if (obs) { obs.disconnect(); obs = null; } terugzetten(); }
  function wissel() { if (aan()) start(); else stop(); }
  function init() {
    wissel();
    if (!attrObs && window.MutationObserver) { attrObs = new MutationObserver(wissel); attrObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-stijl'] }); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  root.MTIconen = { PAD: PAD, KAART: KAART, verwerk: verwerk, tekstpas: tekstpas, start: start, stop: stop };
  root.mtIcoon = mtIcoon;
  root.mtStatus = mtStatus;
})(typeof window !== 'undefined' ? window : this);

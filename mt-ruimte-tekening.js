// mt-ruimte-tekening.js — lijntekeningen van een opgenomen ruimte: het wandaanzicht (telefoon en kantoor), de doorsnede van een kozijnopening en de
// kameruitslag (plattegrond met de wanden eromheen opengeklapt). Eén module voor beide pagina's, zodat de tekening op de telefoon, op kantoor en in de PDF
// precies dezelfde is. Pure functies: uit een wandaanzicht (MTRuimteDossier.wandAanzicht) komt een boom van gewone objecten { t: tag, a: attributen,
// x: tekst, k: kinderen }. Geen DOM nodig, dus in node te testen. De pagina zet de boom met T.naarDom om in echte SVG-elementen (createElementNS,
// setAttribute, textContent): er wordt nergens HTML als tekst aan elkaar geplakt, dus een naam of opmerking uit het dossier kan nooit als opmaak worden gelezen.
//
// Afspraken in de tekening (B35/B36, 18-11-2026):
// - Maten in mm. Zwart = gemeten, blauw = afgeleid (uit gemeten maten berekend), grijs cursief met ~ = geschat (camera of aangenomen), oranje = nog niet
//   bewaard, oranje ? = nog niet gemeten.
// - Een maat van het gekozen onderdeel heeft data-veld="<veldnaam>": de pagina maakt daar een tikbare maat van (tik de maat aan en vul hem in).
//   Een onderdeel heeft data-id, een vak van een raam data-vak.
// - Wandaanzicht = de wand zoals je hem vanuit de kamer ziet: links in de tekening is links als je met je gezicht naar de wand staat.
// - Kameruitslag: elke wand klapt om zijn vloerlijn naar buiten, met de binnenkant naar boven. Er wordt niets gespiegeld: links blijft links (vanuit de kamer).
//   Tekst die daardoor op zijn kop zou staan, wordt per stuk rechtgezet (leesbaar van onderen of van rechts, zoals op een bouwtekening).
//
// Tekenafspraken naar de gangbare normen (B37; de normteksten zelf zijn niet geraadpleegd, zie docs/ONTWIKKELING-RUIMTE-OPNAME.md §11):
// - Maatvoering bouwkundig (NEN-ISO 129-1): maatlijn met schuine streepjes, maatgetal boven de lijn, staande maten leesbaar van rechts, kettingmaten die sluiten.
// - Weergave (NEN-EN-ISO 7519): zichtbare contouren dik, maat- en hulplijnen dun; ramen en deuren vereenvoudigd met een draairichting-driehoek.
// - Draairichting (afspraak MT, 19-11): de punt van de driehoek wijst naar de kruk (de sluitkant), de scharnierblokjes staan aan de andere kant; bij kiep en
//   klep wijst de punt naar de scharnierkant. Getrokken = draait naar de kijker toe (de kamer in), gestreept = van de kijker af
//   (naar buiten). Omdat deze afspraak per land verschilt, staat hij altijd in de legenda van de tekening.
// - Stopcontacten en schakelaars staan als afdekplaat op schaal in het aanzicht (enkel 81 × 81 mm, dubbel 152 × 81, …), met het hart als maatpunt.
(function (root) {
  'use strict';
  const D = root.MTRuimteDossier || (typeof require === 'function' ? require('./mt-ruimte-dossier.js') : null);
  const T = {};

  T.STIJL = [
    '.mtt{display:block;width:100%;height:auto}',
    '.mtt .wandlijn{fill:none;stroke:var(--inkt,#16211a);stroke-width:var(--mtt-lijn,3)}',
    '.mtt .vloerlijn{stroke:var(--inkt,#16211a);stroke-width:calc(var(--mtt-lijn,3) * 2.3)}',
    '.mtt .plan{fill:var(--vlak,#fff);stroke:var(--inkt,#16211a);stroke-width:calc(var(--mtt-lijn,3) * 1.6)}',
    '.mtt .item{fill:rgba(28,95,196,.07);stroke:var(--zacht,#5d6b62);stroke-width:var(--mtt-lijn,3)}',
    '.mtt .item.traject{fill:rgba(168,101,4,.2)}',
    '.mtt .item.gekozen{stroke:var(--kies,#1c5fc4);stroke-width:calc(var(--mtt-lijn,3) * 2);fill:rgba(28,95,196,.14)}',
    '.mtt .item.geschat{stroke-dasharray:14 8}',
    '.mtt .binnen{fill:none;stroke:var(--zacht,#5d6b62);stroke-width:calc(var(--mtt-lijn,3) * .7);stroke-dasharray:8 6}',
    '.mtt .vak{stroke:var(--zacht,#5d6b62);stroke-width:var(--mtt-lijn,3)}',
    '.mtt .vakvlak{fill:transparent;stroke:none}',
    '.mtt .vakvlak.gekozen{fill:rgba(28,95,196,.22)}',
    '.mtt .knik{stroke:var(--rood,#c4322a);stroke-width:var(--mtt-lijn,3);stroke-dasharray:12 8}',
    '.mtt .punt{fill:var(--oranje,#a86504);stroke:var(--inkt,#16211a);stroke-width:calc(var(--mtt-lijn,3) * .7)}',
    '.mtt .punt.gekozen{stroke:var(--kies,#1c5fc4);stroke-width:calc(var(--mtt-lijn,3) * 1.7)}',
    '.mtt .raak{fill:transparent;stroke:none}',
    '.mtt .vaag{opacity:.38}',
    '.mtt .scharnier{fill:var(--inkt,#16211a);stroke:none}',
    '.mtt .teken{fill:none;stroke:var(--inkt,#16211a);stroke-width:calc(var(--mtt-lijn,3) * .5)} .mtt .teken.vol{fill:var(--inkt,#16211a)}',
    '.mtt .pijp{fill:var(--vlak,#fff);stroke:var(--inkt,#16211a);stroke-width:calc(var(--mtt-lijn,3) * 1.1)} .mtt .pijp.kw{stroke:#1c5fc4} .mtt .pijp.ww{stroke:#c4322a} .mtt .pijp.cv{stroke:#c96a00} .mtt .pijp.gas{stroke:#b59a00} .mtt .pijp.afvoer{stroke:#6b6b6b} .mtt .pijp.gekozen{stroke-width:calc(var(--mtt-lijn,3) * 2.2)}',
    '.mtt .draai{fill:none;stroke:var(--zacht,#5d6b62);stroke-width:calc(var(--mtt-lijn,3) * .7)} .mtt .draai.weg{stroke-dasharray:10 7}',
    '.mtt .plaat{fill:var(--vlak,#fff);stroke:var(--inkt,#16211a);stroke-width:calc(var(--mtt-lijn,3) * .8)} .mtt .plaat.gekozen{stroke:var(--kies,#1c5fc4);stroke-width:calc(var(--mtt-lijn,3) * 1.7)}',
    '.mtt [data-id],.mtt [data-veld],.mtt [data-vak],.mtt [data-wand]{cursor:pointer}',
    '.mtt .wandraak{fill:rgba(28,95,196,.04)} .mtt .wandraak.gekozen{fill:rgba(28,95,196,.2)}',
    '.mtt .tikvlak{fill:var(--vlak,#fff);fill-opacity:.82;stroke:var(--rand,#cfd6d0);stroke-width:1.5}',
    '.mtt .tikvlak.actief{stroke:var(--oranje,#a86504);stroke-width:5;fill-opacity:1}',
    '.mtt .maat{stroke:var(--zacht,#5d6b62);stroke-width:calc(var(--mtt-lijn,3) * .8)}',
    '.mtt text{font-family:"Segoe UI",system-ui,Roboto,Arial,sans-serif;font-weight:700}',
    '.mtt .t-gemeten{fill:var(--inkt,#16211a)} .mtt .t-geschat,.mtt .t-aangenomen,.mtt .t-onbekend{fill:var(--geschat,#7f8a83);font-style:italic}',
    '.mtt .t-afgeleid{fill:var(--kies,#1c5fc4)} .mtt .t-invoer,.mtt .t-open{fill:var(--oranje,#a86504)} .mtt .t-onzeker{fill:var(--rood,#c4322a)}',
    '.mtt .hoeklabel{fill:var(--primair,#17643f);font-weight:800}',
    '.mtt .naam{fill:var(--inkt,#16211a)} .mtt .klein{font-weight:600}',
    '.mtt .muur{fill:rgba(120,120,120,.2)} .mtt .paneel{fill:rgba(28,95,196,.4)} .mtt .kozijnlijn{stroke:var(--primair,#17643f);stroke-width:10} .mtt .kozijnlijn.dun{stroke-width:4}'
  ].join('\n');

  const getal = v => typeof v === 'number' ? String(Math.round(v * 10) / 10) : v;
  // Een element van de tekening als gewoon object. Attributen zonder waarde vallen weg; getallen worden op 0,1 afgerond.
  const el = (tag, a, tekst, kinderen) => { const at = {}; Object.keys(a || {}).forEach(k => { if (a[k] != null) at[k] = String(getal(a[k])); }); return { t: tag, a: at, x: tekst == null ? null : String(tekst), k: kinderen || [] }; };
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Boom → echte SVG-elementen in het document van de pagina.
  T.naarDom = function (doc, knoop) {
    const e = doc.createElementNS(SVGNS, knoop.t);
    Object.keys(knoop.a).forEach(k => e.setAttribute(k, knoop.a[k]));
    if (knoop.x != null) e.textContent = knoop.x;
    knoop.k.forEach(c => e.appendChild(T.naarDom(doc, c)));
    return e;
  };
  // Alle knopen van een boom (voor tests en om iets op te zoeken).
  T.knopen = function (knoop, uit) { uit = uit || []; uit.push(knoop); knoop.k.forEach(c => T.knopen(c, uit)); return uit; };
  T.maatTekst = (w, st) => { if (st === 'open' || w == null) return '?'; const t = String(Math.round(w)); return st === 'geschat' || st === 'aangenomen' || st === 'onbekend' ? '~' + t : t; };
  const hard = s => s === 'gemeten' || s === 'invoer' || s === 'afgeleid';
  T.KORT = { 'vast': 'vast', 'draai naar binnen': '↙ binnen', 'draai naar buiten': '↗ buiten', 'draai-kiep naar binnen': 'kiep', 'klep naar binnen': 'klep in', 'klep naar buiten': 'klep uit', 'schuif': 'schuif' };

  // Tekst, liggend of staand (gedraaid, leesbaar van rechts). keer = een halve slag draaien om het midden van de tekst (voor de uitslag).
  function tekst(x, y, str, klasse, fz, o) {
    o = o || {};
    const a = { x, y, 'text-anchor': o.anker || 'middle', 'class': klasse, style: 'font-size:' + fz.toFixed(1) + 'px' }, tr = [];
    if (o.keer) tr.push(o.staand ? 'rotate(180 ' + getal(x - fz * 0.35) + ' ' + getal(y) + ')' : 'rotate(180 ' + getal(x) + ' ' + getal(y - fz * 0.35) + ')');
    if (o.staand) tr.push('rotate(-90 ' + getal(x) + ' ' + getal(y) + ')');
    if (tr.length) a.transform = tr.join(' ');
    if (o.veld) a['data-veld'] = o.veld;
    if (o.id) a['data-id'] = o.id;
    return el('text', a, str);
  }

  // Draairichting van een vak (raam of deur) in het aanzicht: bij links/rechts de punt naar de kruk (tegenover het scharnier), bij onder/boven de punt naar de scharnierkant. x, y = linksonder in px (y omlaag positief),
  // b, h = breedte en hoogte in px. kant: 'links' | 'rechts' | 'onder' (kiep) | 'boven' (klep). weg = draait van de kijker af (gestreept).
  function driehoek(x, yBoven, b, h, kant, weg) {
    const P = kant === 'rechts' ? [[x + b, yBoven], [x, yBoven + h / 2], [x + b, yBoven + h]] : kant === 'links' ? [[x, yBoven], [x + b, yBoven + h / 2], [x, yBoven + h]]
      : kant === 'onder' ? [[x, yBoven], [x + b / 2, yBoven + h], [x + b, yBoven]] : [[x, yBoven + h], [x + b / 2, yBoven], [x + b, yBoven + h]];
    return el('polyline', { points: P.map(q => getal(q[0]) + ',' + getal(q[1])).join(' '), 'class': 'draai' + (weg ? ' weg' : '') });
  }
  // Twee zwarte blokjes op de scharnierkant: ook zonder de driehoek-afspraak te kennen zie je waar het raam of de deur hangt.
  function scharnieren(x, yBoven, b, h, kant) {
    const d = Math.max(2.5, Math.min(b, h) * 0.035), l = Math.max(6, Math.min(b, h) * 0.12), uit = [];
    [0.18, 0.82].forEach(f => {
      if (kant === 'links' || kant === 'rechts') uit.push(el('rect', { x: kant === 'links' ? x - d / 2 : x + b - d / 2, y: yBoven + h * f - l / 2, width: d, height: l, 'class': 'scharnier' }));
      else uit.push(el('rect', { x: x + b * f - l / 2, y: kant === 'onder' ? yBoven + h - d / 2 : yBoven - d / 2, width: l, height: d, 'class': 'scharnier' }));
    });
    return uit;
  }
  T.vakSymbolen = function (functie, scharnier, x, yBoven, b, h) {
    const uit = [], weg = /buiten/.test(functie);
    if (/^draai/.test(functie)) scharnieren(x, yBoven, b, h, scharnier).forEach(k => uit.push(k));
    else if (/^klep/.test(functie)) scharnieren(x, yBoven, b, h, 'boven').forEach(k => uit.push(k));
    if (/^draai-kiep/.test(functie)) { uit.push(driehoek(x, yBoven, b, h, scharnier, weg)); uit.push(driehoek(x, yBoven, b, h, 'onder', weg)); }
    else if (/^draai/.test(functie)) uit.push(driehoek(x, yBoven, b, h, scharnier, weg));
    else if (/^klep/.test(functie)) uit.push(driehoek(x, yBoven, b, h, 'boven', weg));
    else if (functie === 'schuif') { const ym = yBoven + h / 2, p = Math.min(b * 0.12, h * 0.12); uit.push(el('polyline', { points: [[x + b * 0.2, ym], [x + b * 0.8, ym], [x + b * 0.8 - p, ym - p], [x + b * 0.8, ym], [x + b * 0.8 - p, ym + p]].map(q => getal(q[0]) + ',' + getal(q[1])).join(' '), 'class': 'draai' })); }
    return uit;
  };

  // Wat er op een afdekplaat zit, als herkenbaar plaatje op schaal: per contact een rondje met twee gaatjes, per schakelaar een wip.
  // (De schemasymbolen van NEN 5152 horen op een plattegrond; in een aanzicht teken je wat je ziet. Zie §11 van het ontwikkeldocument.)
  function plaatTekens(it, cx, cy, pw, ph) {
    const uit = [], id = it.variant ? it.variant.id : 'enkel', staand = id === 'dubbel-staand';
    const n = { enkel: 1, dubbel: 2, drievoudig: 3, viervoudig: 4, 'dubbel-staand': 2, combinatie: 2 }[id] || 1, m = (staand ? ph : pw) / n;
    if (Math.min(pw, ph) < 9) return uit;   // te klein om iets in te tekenen
    for (let i = 0; i < n; i++) {
      const mx = staand ? cx : cx - pw / 2 + m * (i + 0.5), my = staand ? cy - ph / 2 + m * (i + 0.5) : cy, r = Math.min(m, staand ? pw : ph) * 0.3;
      const contact = it.soort === 'stopcontact' ? !(id === 'data') : (id === 'combinatie' && i === 1);
      if (it.soort === 'stopcontact' && id === 'data') uit.push(el('rect', { x: mx - r * 0.6, y: my - r * 0.45, width: r * 1.2, height: r * 0.9, 'class': 'teken' }));
      else if (contact) { uit.push(el('circle', { cx: mx, cy: my, r, 'class': 'teken' })); [-1, 1].forEach(k => uit.push(el('circle', { cx: mx + k * r * 0.42, cy: my, r: Math.max(0.7, r * 0.13), 'class': 'teken vol' }))); }
      else if (id === 'dimmer' || id === 'thermostaat') uit.push(el('circle', { cx: mx, cy: my, r: r * 0.8, 'class': 'teken' }));
      else { uit.push(el('rect', { x: mx - r, y: my - r, width: r * 2, height: r * 2, rx: r * 0.15, 'class': 'teken' })); if (id === 'dubbel') uit.push(el('line', { x1: mx, y1: my - r, x2: mx, y2: my + r, 'class': 'teken' })); }
    }
    return uit;
  }

  // Een rij maten (keten) langs een as, met de getallen om en om aan weerszijden van de lijn als ze anders over elkaar zouden vallen.
  // liggend: delen in px langs x op hoogte `vast`. staand: langs y op x = `vast`. Een deel met `veld` wordt een tikbare maat (vlakje erachter).
  function keten(out, delen, vast, fs, staand, o) {
    o = o || {};
    const tik = fs * 0.22, laan = [-Infinity, -Infinity];
    delen.filter(k => Math.abs(k.tot - k.van) > 0.5 || k.veld).sort((a, b) => Math.min(a.van, a.tot) - Math.min(b.van, b.tot)).forEach(k => {
      const a = Math.min(k.van, k.tot), b = Math.max(k.van, k.tot), m = (a + b) / 2, str = T.maatTekst(k.waarde, k.status), tw = Math.max(1.2, str.length) * fs * 0.6;
      if (staand) {
        out.push(el('line', { x1: vast, y1: a, x2: vast, y2: b, 'class': 'maat' }));
        [a, b].forEach(p => out.push(el('line', { x1: vast - tik, y1: p + tik, x2: vast + tik, y2: p - tik, 'class': 'maat' })));
      } else {
        out.push(el('line', { x1: a, y1: vast, x2: b, y2: vast, 'class': 'maat' }));
        [a, b].forEach(p => out.push(el('line', { x1: p - tik, y1: vast + tik, x2: p + tik, y2: vast - tik, 'class': 'maat' })));
      }
      const pad = k.veld ? fs * 0.5 : fs * 0.2;
      const l = m - tw / 2 > laan[0] + pad ? 0 : (m - tw / 2 > laan[1] + pad ? 1 : (laan[0] <= laan[1] ? 0 : 1));
      laan[l] = m + tw / 2;
      const af = l === 0 ? -fs * 0.3 : fs * 1.05;   // laan 0: boven (of links van) de lijn, laan 1: eronder (of rechts)
      const tx = staand ? vast + af : m, ty = staand ? m : vast + af;
      if (k.veld) {   // tikbaar: een vlakje achter het getal, ruim genoeg voor een vinger
        const bw = tw + fs * 0.5, bh = fs * 1.15, cx = staand ? tx - fs * 0.35 : tx, cy = staand ? ty : ty - fs * 0.35;
        out.push(el('rect', { x: cx - (staand ? bh : bw) / 2, y: cy - (staand ? bw : bh) / 2, width: staand ? bh : bw, height: staand ? bw : bh, rx: fs * 0.25, 'class': 'tikvlak' + (o.actief === k.veld ? ' actief' : ''), 'data-veld': k.veld }));
      }
      if (staand && str === '?') out.push(tekst(tx - fs * 0.35, ty + fs * 0.35, str, 't-' + k.status, fs, { veld: k.veld }));   // een los vraagteken staat rechtop
      else out.push(tekst(tx, ty, str, 't-' + k.status, fs, { staand, keer: o.keer, veld: k.veld }));
    });
  }
  T._keten = keten;

  // Teken de wand in eigen coördinaten: (0,0) = linkerhoek op de vloer, x naar rechts in px, y omhoog negatief. Geeft de tekst en hoeveel ruimte de maten
  // eromheen innemen (in px) zodat de aanroeper de viewBox kan bepalen.
  // o: { s (px per mm), fs, gekozen (detail-id), actief (veld), vak (gekozen vak-index), tex, texSpiegel, ketens: 'gekozen'|'alles', boven (maatrijen boven
  //      het plafond in plaats van onder de vloer), keerH/keerV (tekst een halve slag draaien: uitslag) }
  T.aanzichtInhoud = function (az, o) {
    const s = o.s, fs = o.fs, L = az.L, H = az.H, X = u => u * s, Y = v => -v * s, out = [], alles = o.ketens === 'alles';
    const kH = { keer: o.keerH }, kV = { keer: o.keerV, staand: true };
    if (o.tex) out.push(el('g', { opacity: '0.35', transform: o.texSpiegel ? 'scale(-1,1)' : null }, null, [el('image', { href: o.tex, x: o.texSpiegel ? -X(L) : 0, y: Y(H), width: X(L), height: H * s, preserveAspectRatio: 'none' })]));
    out.push(el('rect', { x: 0, y: Y(H), width: X(L), height: H * s, 'class': 'wandlijn' }));
    out.push(el('line', { x1: 0, y1: 0, x2: X(L), y2: 0, 'class': 'vloerlijn' }));
    if (!o.zonderHoeken) {
      out.push(tekst(0, Y(H) - fs * 0.45, az.links.label || '', 'hoeklabel', fs, kH));
      out.push(tekst(X(L), Y(H) - fs * 0.45, az.rechts.label || '', 'hoeklabel', fs, kH));
    }
    const gekozen = o.gekozen ? az.items.find(it => it.det.id === o.gekozen) : null;
    // eerst de vlakken (achter), dan de trajecten (vensterbank, plint) en de punten erbovenop
    const volg = { vlak: 0, traject: 1, lijn: 2, punt: 3 };
    az.items.slice().sort((a, b) => (volg[a.vorm] || 0) - (volg[b.vorm] || 0)).forEach(it => {
      const id = it.det.id, kies = !!gekozen && gekozen.det.id === id, vaag = gekozen && !kies ? ' vaag' : '';   // met een gekozen onderdeel treden de andere terug
      const lbl = it.label + (it.variant && it.vorm === 'punt' ? ' ' + it.variant.kort : '') + (it.diameter && it.diameter.waarde ? ' ø' + Math.round(it.diameter.waarde) : '') + (it.opmerking ? ' *' : '');
      const begin = out.length;
      if (it.rect) {
        const r = it.rect, vast = hard(it.status.x) && hard(it.status.w);
        out.push(el('rect', { x: X(r.x), y: Y(r.y + r.h), width: Math.max(2, r.w * s), height: Math.max(2, r.h * s), 'class': 'item ' + it.vorm + (kies ? ' gekozen' : '') + (vast ? '' : ' geschat'), 'data-id': id }));
        if (r.h * s < fs * 1.2) out.push(el('rect', { x: X(r.x), y: Y(r.y + r.h) - fs * 0.6, width: Math.max(fs, r.w * s), height: fs * 1.2 + r.h * s, 'class': 'raak', 'data-id': id }));
        const bin = it.opening && it.opening.binnen, vakR = bin || r, kader = bin && (bin.w < r.w - 0.5 || bin.h < r.h - 0.5);
        if (kader) out.push(el('rect', { x: X(bin.x), y: Y(bin.y + bin.h), width: bin.w * s, height: bin.h * s, 'class': 'binnen' }));
        if (it.raam && it.raam.vakken && it.raam.vakken.length) {
          const nv = it.raam.vakken.length, vb = vakR.w / nv, vf = Math.max(fs * 0.36, Math.min(fs * 0.72, vb * s / 5.5));
          it.raam.vakken.forEach((vk, i) => {
            if (kies) out.push(el('rect', { x: X(vakR.x + vb * i), y: Y(vakR.y + vakR.h), width: vb * s, height: vakR.h * s, 'class': 'vakvlak' + (o.vak === i ? ' gekozen' : ''), 'data-vak': i }));
            if (i) out.push(el('line', { x1: X(vakR.x + vb * i), y1: Y(vakR.y), x2: X(vakR.x + vb * i), y2: Y(vakR.y + vakR.h), 'class': 'vak' }));
            T.vakSymbolen(vk.functie, D.scharnierVan(vk, i, nv), X(vakR.x + vb * i), Y(vakR.y + vakR.h), vb * s, vakR.h * s).forEach(k => out.push(k));
            const a = tekst(X(vakR.x + vb * (i + 0.5)), Y(vakR.y + vakR.h * 0.14) + vf / 3, T.KORT[vk.functie] || vk.functie, 't-geschat', vf, kH);
            if (kies) a.a['data-vak'] = String(i);
            out.push(a);
          });
        }
        if (it.soort === 'deur' && it.variant && /^(binnen|buiten)-/.test(it.variant.id)) {
          const dk = /links$/.test(it.variant.id) ? 'links' : 'rechts';
          out.push(driehoek(X(r.x), Y(r.y + r.h), r.w * s, r.h * s, dk, /^buiten/.test(it.variant.id))); scharnieren(X(r.x), Y(r.y + r.h), r.w * s, r.h * s, dk).forEach(k => out.push(k));
        }
        const lf = fs * 0.62;
        if (it.vorm === 'traject' || r.h * s < lf * 2.4) out.push(tekst(X(r.x + r.w / 2), Y(r.y + r.h) - fs * 0.25, lbl, 'naam klein', lf, { keer: o.keerH, id }));
        else out.push(tekst(X(r.x + r.w / 2), Y(r.y + r.h) + lf * 1.2, lbl, 'naam', lf, { keer: o.keerH, id }));
      } else if (it.lijn && it.lijn.x != null) {
        out.push(el('line', { x1: X(it.lijn.x), y1: 0, x2: X(it.lijn.x), y2: Y(H), 'class': 'knik' }));
        out.push(el('rect', { x: X(it.lijn.x) - fs * 0.6, y: Y(H), width: fs * 1.2, height: H * s, 'class': 'raak', 'data-id': id }));
        out.push(tekst(X(it.lijn.x) + fs * 0.25, Y(H) + fs * 1.2, lbl, 'naam klein', fs * 0.6, { keer: o.keerH, anker: 'start', id }));
      } else if (it.punt && (it.punt.x != null || kies)) {   // nog geen plek bekend: het gekozen onderdeel staat voorlopig midden op de wand
        if (it.punt.x == null) it = Object.assign({}, it, { punt: Object.assign({}, it.punt, { x: L / 2 }) });
        const py = it.punt.y == null ? 300 : it.punt.y;
        if (it.plaat) {   // stopcontact of schakelaar: de afdekplaat op schaal, met het hart als maatpunt
          const pw = Math.max(it.plaat.w * s, fs * 0.5), ph = Math.max(it.plaat.h * s, fs * 0.5);
          out.push(el('rect', { x: X(it.punt.x) - pw / 2, y: Y(py) - ph / 2, width: pw, height: ph, rx: Math.min(pw, ph) * 0.12, 'class': 'plaat' + (kies ? ' gekozen' : '') }));
          const tk = plaatTekens(it, X(it.punt.x), Y(py), pw, ph);
          if (tk.length) tk.forEach(k => out.push(k)); else out.push(el('circle', { cx: X(it.punt.x), cy: Y(py), r: Math.max(1.5, fs * 0.09), 'class': 'punt' }));
        } else if (it.soort === 'leiding') {   // leiding: de doorsnede op schaal (buitendiameter), kleur naar het medium
          const rr = Math.max(fs * 0.2, (it.diameter && it.diameter.waarde ? it.diameter.waarde : 22) * s / 2);
          out.push(el('circle', { cx: X(it.punt.x), cy: Y(py), r: rr, 'class': 'pijp' + (it.variant ? ' ' + it.variant.id : '') + (kies ? ' gekozen' : '') }));
          out.push(el('circle', { cx: X(it.punt.x), cy: Y(py), r: Math.max(1, rr * 0.18), 'class': 'teken vol' }));
        } else out.push(el('circle', { cx: X(it.punt.x), cy: Y(py), r: fs * (kies ? 0.42 : 0.3), 'class': 'punt' + (kies ? ' gekozen' : '') }));
        out.push(el('circle', { cx: X(it.punt.x), cy: Y(py), r: fs * 1.0, 'class': 'raak', 'data-id': id }));
        const rechts = X(it.punt.x) > X(L) - fs * 5;   // dicht bij de rechterhoek: naam links van de stip
        out.push(tekst(X(it.punt.x) + (rechts ? -1 : 1) * fs * 0.55, Y(py) - fs * 0.45, lbl, 'naam klein', fs * 0.55, { keer: o.keerH, anker: rechts ? 'end' : 'start', id }));
      }
      if (vaag) for (let i = begin; i < out.length; i++) if (!/raak/.test(out[i].a['class'] || '')) out[i].a['class'] = (out[i].a['class'] || '') + vaag;
    });

    if (o.ketens === 'geen') return { knopen: out, onder: fs * 0.6, boven: fs * 0.6, links: fs * 0.6, rechts: fs * 0.6 };   // alleen de wand en zijn onderdelen (overzicht)
    // ── maten ──
    const V = it => it.velden || {}, isGek = it => !!gekozen && it === gekozen, tag = (it, rol) => isGek(it) ? V(it)[rol] || null : null;
    const rij = fs * 1.9, dir = o.boven ? -1 : 1, basisY = o.boven ? Y(H) - fs * 1.5 : fs * 0.5;
    let n = 0;
    const rijY = () => basisY + dir * (rij * (n++) + fs * 1.0);
    const px = k => ({ van: X(k.van), tot: X(k.tot), waarde: k.waarde, status: k.status, veld: k.veld });
    const kOpt = { keer: o.keerH, actief: o.actief };
    // De maatketen van één onderdeel langs de wand (richting 'x') of omhoog (richting 'y'): afstand – [paneel] – binnenwerks – [paneel] – rest. Bij een
    // kozijn met een kader op de wand staan de panelen er als eigen stukje in, zodat de gemeten binnenmaat in de keten staat en de keten toch sluit.
    const dikSt = op => !op || !op.dikte_status || op.dikte_status === 'aangenomen' ? 'geschat' : op.dikte_status;
    const stukken = (it, as, metVeld) => {
      const r = it.rect, st = it.status, bin = it.opening && it.opening.binnen, kader = bin && (bin.w < r.w - 0.5 || bin.h < r.h - 0.5), t = rol => metVeld ? V(it)[rol] || null : null;
      const a0 = as === 'x' ? r.x : r.y, a1 = as === 'x' ? r.x + r.w : r.y + r.h, b0 = kader ? (as === 'x' ? bin.x : bin.y) : a0, b1 = kader ? (as === 'x' ? bin.x + bin.w : bin.y + bin.h) : a1;
      const uit = [], dv = null;   // de paneeldikte is te klein om aan te tikken: die vul je in via de knop of de doorsnede
      if (b0 - a0 > 0.5) uit.push({ van: a0, tot: b0, waarde: b0 - a0, status: dikSt(it.opening), veld: dv });
      uit.push({ van: b0, tot: b1, waarde: b1 - b0, status: kader ? (as === 'x' ? bin.status.w : bin.status.h) : (as === 'x' ? st.w : st.h), veld: t(as === 'x' ? 'w' : 'h') });
      if (a1 - b1 > 0.5) uit.push({ van: b1, tot: a1, waarde: a1 - b1, status: dikSt(it.opening), veld: dv });
      return { a0, a1, uit };
    };
    const langs = (it, metVeld) => {
      const r = it.rect, st = it.status, vl = it.vanLinks !== false, k = stukken(it, 'x', metVeld), xv = metVeld ? V(it).x || null : null, open = st.x === 'open' || st.w === 'open';
      const rest = { status: hard(az.status.L) && hard(st.x) && hard(st.w) ? 'afgeleid' : 'geschat' }, uit = [];
      if (vl) uit.push({ van: 0, tot: k.a0, waarde: r.x, status: st.x, veld: xv }); else if (!open) uit.push({ van: 0, tot: k.a0, waarde: r.x, status: rest.status });
      k.uit.forEach(x => uit.push(x));
      if (!vl) uit.push({ van: k.a1, tot: L, waarde: L - k.a1, status: st.x, veld: xv }); else if (!open) uit.push({ van: k.a1, tot: L, waarde: L - k.a1, status: rest.status });
      return uit;
    };
    if (gekozen && !alles) {
      const r = gekozen.rect, vl = gekozen.vanLinks !== false;
      if (r) keten(out, langs(gekozen, true).map(px), rijY(), fs, false, kOpt);
      else {
        const p = gekozen.punt || gekozen.lijn, sx = p && (typeof p.status === 'string' ? p.status : p.status.x);
        if (p) {
          const x = p.x == null ? L / 2 : p.x, stx = p.x == null ? 'open' : sx;
          keten(out, [vl ? { van: X(0), tot: X(x), waarde: p.x, status: stx, veld: tag(gekozen, 'x') } : { van: X(x), tot: X(L), waarde: p.x == null ? null : L - p.x, status: stx, veld: tag(gekozen, 'x') }], rijY(), fs, false, kOpt);
        }
      }
    }
    // doorlopende ketens langs de hele wand (alleen op de afdruk): eerst de openingen (kozijnen, deuren), dan de overige onderdelen. Op de telefoon staan
    // alleen de maten van het onderdeel dat je aantikt, plus de wandlengte en de hoogte: anders loopt het op een klein scherm door elkaar (feedback 19-11).
    if (alles) [D.wandKeten(az, D.isOpening), D.wandKeten(az, it => !D.isOpening(it) && it.soort !== 'plint' && it.soort !== 'sierlijst')].forEach(wk => {
      if (wk.length > 1) keten(out, wk.map(px), rijY(), fs * (alles ? 1 : 0.8), false, { keer: o.keerH });
    });
    keten(out, [{ van: 0, tot: X(L), waarde: L, status: az.status.L }], rijY(), fs, false, { keer: o.keerH });
    const maatRuimte = fs * 0.5 + rij * n + fs * 1.4;
    // hoogte links van de wand
    if (!o.zonderHoogte) keten(out, [{ van: 0, tot: Y(H), waarde: H, status: az.status.H }], -fs * 1.3, fs, true, { keer: o.keerV });
    // staande ketens per onderdeel (bij 'gekozen' alleen het gekozen onderdeel); elke keten zoekt een vrije plek rechts van zijn onderdeel
    let rechtsNodig = 0; const bezet = [];
    const vrij = (x, ya, yb) => {
      const a = Math.min(ya, yb), b = Math.max(ya, yb);
      for (let i = 0; i < 12 && bezet.some(u => Math.abs(u.x - x) < fs * 1.7 && u.a < b && a < u.b); i++) x += fs * 1.7;
      bezet.push({ x, a, b }); rechtsNodig = Math.max(rechtsNodig, x + fs * 1.3 - X(L)); return x;
    };
    const vfs = fs * (alles ? 0.8 : 0.9);
    const vert = it => {
      const vOpt = { keer: o.keerV, actief: isGek(it) ? o.actief : null };
      if (it.rect) {
        const r = it.rect, st = it.status, opening = it.soort === 'kozijn' || it.soort === 'raam' || it.soort === 'deur' || it.soort === 'nis';
        const k = stukken(it, 'y', isGek(it)), open = st.y === 'open' || st.h === 'open';
        let kv = [{ van: 0, tot: k.a0, waarde: r.y, status: st.y, veld: tag(it, 'y') }].concat(k.uit);
        const boven = it.boven_tot_plafond != null ? { van: k.a1, tot: H, waarde: it.boven_tot_plafond, status: st.boven, veld: tag(it, 'boven') }
          : { van: k.a1, tot: H, waarde: open ? null : H - k.a1, status: open ? 'open' : (hard(az.status.H) && hard(st.y) && hard(st.h) ? 'afgeleid' : 'geschat'), veld: tag(it, 'boven') };
        if (it.soort === 'vensterbank') kv = [];                                   // alleen de bovenkant (extraV)
        else if (it.vorm === 'traject') kv = k.uit;                                // plint, sierlijst: de hoogte van het profiel
        else if (opening || it.boven_tot_plafond != null) kv.push(boven);          // kozijn, deur, nis: ook de maat tot het plafond
        if (kv.length) keten(out, kv.map(k => ({ van: Y(k.van), tot: Y(k.tot), waarde: k.waarde, status: k.status, veld: k.veld })), vrij(X(r.x + r.w) + fs * 1.5, Y(kv[0].van), Y(kv[kv.length - 1].tot)), vfs, true, vOpt);
        (it.extraV || []).forEach(k => keten(out, [{ van: Y(k.van), tot: Y(k.tot), waarde: k.waarde, status: k.status, veld: isGek(it) ? k.veld : null }], vrij(X(r.x + r.w) + fs * 1.5, Y(k.van), Y(k.tot)), vfs, true, vOpt));
      } else if (it.punt) {
        const p = it.punt, x = p.x == null ? L / 2 : p.x, y = p.y == null ? 300 : p.y;
        if (p.y != null || isGek(it)) keten(out, [{ van: 0, tot: Y(y), waarde: p.y, status: p.y == null ? 'open' : p.status.y, veld: tag(it, 'y') }], vrij(X(x) + fs * 1.5, 0, Y(y)), vfs, true, vOpt);
      }
    };
    if (alles) az.items.forEach(vert); else if (gekozen) vert(gekozen);
    return { knopen: out, onder: o.boven ? fs * 0.6 : maatRuimte, boven: o.boven ? fs * 1.5 + rij * n + fs * 0.9 : fs * 1.7, links: fs * 2.7, rechts: Math.max(fs * 1.2, rechtsNodig + fs * 0.4) };
  };

  // Eén wand als losse tekening (telefoon en wandpagina in de PDF). o.breedte = viewBox-breedte (standaard 1000).
  T.aanzicht = function (az, o) {
    o = Object.assign({ breedte: 1000, fs: 34, ketens: 'gekozen' }, o || {});
    let s = (o.breedte - o.fs * 6) / az.L, r = null;
    for (let i = 0; i < 4; i++) { r = T.aanzichtInhoud(az, Object.assign({}, o, { s })); s = (o.breedte - r.links - r.rechts) / az.L; }
    r = T.aanzichtInhoud(az, Object.assign({}, o, { s }));
    const hoogte = r.boven + az.H * s + r.onder;
    const boom = el('svg', { 'class': 'mtt aanzicht', viewBox: '0 0 ' + o.breedte + ' ' + Math.round(hoogte), role: 'img', 'aria-label': 'Wandaanzicht ' + az.wand }, null,
      [el('g', { transform: 'translate(' + getal(r.links) + ' ' + getal(r.boven + az.H * s) + ')' }, null, r.knopen)]);
    return { boom, s, hoogte, breedte: o.breedte, fs: o.fs };
  };

  // Doorsnede van een kozijnopening (van boven gezien: kamer links, de muur in naar rechts) met tikbare maten. it = onderdeel uit wandAanzicht.
  T.doorsnede = function (it, o) {
    o = Object.assign({ breedte: 1000, fs: 34 }, o || {});
    const op = it && it.opening; if (!op) return { boom: null, hoogte: 0 };
    const fs = o.fs, w = m => m && m.waarde != null ? m.waarde : null, st = m => m ? m.status : 'open';
    const t = op.type, uit = t === 'aftimmering-op-wand' ? w(op.uitsteek) : null, nd = t === 'nis-met-aftimmering' ? w(op.nis_diepte) : null, kd = w(op.kozijn_diepte), dik = op.dikte || 12;
    // posities in mm ten opzichte van het wandvlak (0); een onbekende maat krijgt een nette standaardlengte zodat hij aan te tikken is
    const voor = t === 'aftimmering-op-wand' ? -(uit == null ? 20 : uit) : (t === 'nis-met-aftimmering' ? (nd == null ? 100 : nd) : 0);
    const koz = (t === 'nis' ? 0 : voor) + (kd == null ? 150 : kd), x0 = Math.min(0, voor) - 40, x1 = Math.max(koz, 60) + 60, s = (o.breedte - fs * 2) / (x1 - x0), X = v => fs + (v - x0) * s;
    const yT = fs * 1.4, hB = fs * 3.2, yM = yT + hB + fs * 1.6, out = [];
    out.push(el('rect', { x: X(0), y: yT, width: X(x1) - X(0), height: hB, 'class': 'muur' }));
    out.push(el('line', { x1: X(0), y1: yT - fs * 0.5, x2: X(0), y2: yT + hB + fs * 0.4, 'class': 'wandlijn' }));
    out.push(tekst(X(0), yT - fs * 0.65, 'wandvlak', 'naam klein', fs * 0.6));
    out.push(tekst(X(x0) + fs * 0.2, yT + hB / 2, 'kamer', 't-geschat', fs * 0.6, { anker: 'start' }));
    if (t !== 'nis') out.push(el('rect', { x: X(voor), y: yT + hB * 0.15, width: X(koz) - X(voor), height: Math.max(5, dik * s * 0.5 + 4), 'class': 'paneel' }));
    out.push(el('line', { x1: X(koz), y1: yT, x2: X(koz), y2: yT + hB, 'class': 'kozijnlijn' }));
    out.push(tekst(X(koz), yT - fs * 0.65, 'kozijn', 'hoeklabel', fs * 0.6));
    const delen = [];
    if (t === 'aftimmering-op-wand') {
      delen.push({ van: X(voor), tot: X(0), waarde: uit, status: st(op.uitsteek), veld: 'aftimmer_uitsteek' });
      keten(out, [{ van: X(voor), tot: X(koz), waarde: kd, status: st(op.kozijn_diepte), veld: 'diepte_tot_kozijn' }], yM + fs * 2.0, fs, false, { actief: o.actief });
    } else if (t === 'nis-met-aftimmering') {
      delen.push({ van: X(0), tot: X(voor), waarde: nd, status: st(op.nis_diepte), veld: 'nis_diepte_tot_aftimmering' });
      delen.push({ van: X(voor), tot: X(koz), waarde: kd, status: st(op.kozijn_diepte), veld: 'diepte_tot_kozijn' });
    } else delen.push({ van: X(0), tot: X(koz), waarde: kd, status: st(op.kozijn_diepte), veld: 'diepte_tot_kozijn' });
    keten(out, delen, yM, fs, false, { actief: o.actief });
    const hoogte = yM + (t === 'aftimmering-op-wand' ? fs * 3.6 : fs * 1.6);
    return { boom: el('svg', { 'class': 'mtt doorsnede', viewBox: '0 0 ' + o.breedte + ' ' + Math.round(hoogte), role: 'img', 'aria-label': 'Doorsnede van de opening' }, null, out), hoogte };
  };
  // Pictogram van een soort opening (voor de keuzeknoppen): wandvlak, aftimmering (blauw) en kozijn (groen), van boven gezien.
  T.openingIcoon = function (type) {
    const out = [el('rect', { x: 34, y: 6, width: 82, height: 44, 'class': 'muur' }), el('line', { x1: 34, y1: 2, x2: 34, y2: 54, 'class': 'wandlijn' })];
    if (type === 'aftimmering-op-wand') out.push(el('rect', { x: 24, y: 14, width: 66, height: 9, 'class': 'paneel' }), el('line', { x1: 90, y1: 6, x2: 90, y2: 50, 'class': 'kozijnlijn dun' }));
    else if (type === 'nis-met-aftimmering') out.push(el('rect', { x: 62, y: 14, width: 38, height: 9, 'class': 'paneel' }), el('line', { x1: 100, y1: 6, x2: 100, y2: 50, 'class': 'kozijnlijn dun' }));
    else out.push(el('line', { x1: 80, y1: 6, x2: 80, y2: 50, 'class': 'kozijnlijn dun' }));
    return el('svg', { 'class': 'mtt icoon', viewBox: '0 0 120 56', style: '--mtt-lijn:2', 'aria-hidden': 'true' }, null, out);
  };

  // Is de kamer eenvoudig genoeg voor een uitslag (alle binnenhoeken kleiner dan 180°)? Bij een inspringende hoek vallen opengeklapte wanden over elkaar.
  T.eenvoudig = lm => (lm && lm.punten || []).every(p => p.binnenhoek_graden == null || p.binnenhoek_graden < 180);
  // Wandafwikkeling: alle wanden naast elkaar, van links naar rechts zoals je ze ziet als je in de kamer met de klok mee ronddraait. Werkt voor elke
  // kamervorm (ook L-vormen en nissen), de hoeken staan als verticale lijn met hun naam ertussen. o: { breedte, fs }
  T.afwikkeling = function (aanzichten, o) {
    o = Object.assign({ breedte: 1500, fs: 13 }, o || {});
    const azs = aanzichten.filter(Boolean); if (!azs.length) return { boom: null, hoogte: 0 };
    const volg = [azs[0]]; while (volg.length < azs.length) { const nx = azs.find(a => a.links.id === volg[volg.length - 1].rechts.id && volg.indexOf(a) < 0); if (!nx) break; volg.push(nx); }
    azs.forEach(a => { if (volg.indexOf(a) < 0) volg.push(a); });
    const fs = o.fs, totaal = volg.reduce((t, a) => t + a.L, 0), Hmax = Math.max.apply(null, volg.map(a => a.H));
    const links = fs * 3, s = (o.breedte - links - fs * 2.5) / totaal, out = [];
    let x = 0, boven = fs * 3, onder = 0;
    const delen = volg.map((a, i) => { const r = T.aanzichtInhoud(a, { s, fs, ketens: 'alles', zonderHoogte: i > 0 }); onder = Math.max(onder, r.onder); const d = { a, r, x }; x += a.L * s; return d; });
    delen.forEach(d => {
      out.push(el('g', { transform: 'translate(' + getal(links + d.x) + ' ' + getal(boven + Hmax * s) + ')', 'data-wand': d.a.wand_id }, null, d.r.knopen));
      out.push(tekst(links + d.x + d.a.L * s / 2, boven - fs * 1.5, d.a.wand, 'hoeklabel', fs * 1.2));
    });
    const hoogte = boven + Hmax * s + onder + fs;
    return { boom: el('svg', { 'class': 'mtt afwikkeling', viewBox: '0 0 ' + o.breedte + ' ' + Math.round(hoogte), style: '--mtt-lijn:' + (o.lijn || 1.4), role: 'img', 'aria-label': 'Wandafwikkeling' }, null, out), hoogte, s, volgorde: volg.map(a => a.wand) };
  };

  // Kameruitslag: de plattegrond (lijnmodel) in het midden, elke wand om zijn vloerlijn naar buiten geklapt. lm = lijnmodel (mm, kamer bij +Y),
  // aanzichten = wandAanzicht per wand. De langste kant van de kamer komt liggend op het papier.
  T.uitslag = function (lm, aanzichten, o) {
    o = Object.assign({ breedte: 1400, fs: 14 }, o || {});
    const fs = o.fs, ruw = lm.punten, n = ruw.length, Hmax = o.ketens === 'plan' ? 0 : Math.max.apply(null, aanzichten.filter(Boolean).map(a => a.H).concat([2000]));
    const bb = P => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; P.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }); return { x0, x1, y0, y1, b: x1 - x0, h: y1 - y0 }; };
    const staand = bb(ruw).h > bb(ruw).b * 1.05;   // kwartslag draaien (geen spiegeling): (x, y) → (y, −x)
    const P = ruw.map(p => staand ? { id: p.id, label: p.label, x: p.y, y: -p.x } : { id: p.id, label: p.label, x: p.x, y: p.y }), B = bb(P);
    const plan = o.ketens === 'plan', kaal = o.ketens === 'geen', vast = kaal ? fs : (plan ? fs * 4 : fs * 12);   // ruimte voor de maatrijen buiten elk aanzicht (px)
    let s = (o.breedte - 2 * vast - 2 * fs) / (B.b + 2 * Hmax);
    if (o.maxHoogte) s = Math.min(s, (o.maxHoogte - 2 * vast - 2 * fs) / (B.h + 2 * Hmax));
    const rand = Hmax * s + vast + fs, breedte = o.maxHoogte ? B.b * s + 2 * rand : o.breedte, hoogte = B.h * s + 2 * rand;
    const SX = x => rand + (x - B.x0) * s + (breedte - (B.b * s + 2 * rand)) / 2, SY = y => rand + (B.y1 - y) * s, out = [];
    out.push(el('path', { d: P.map((p, i) => (i ? 'L' : 'M') + getal(SX(p.x)) + ' ' + getal(SY(p.y))).join(' ') + ' Z', 'class': 'plan' }));
    const cx = P.reduce((t, p) => t + p.x, 0) / n, cy = P.reduce((t, p) => t + p.y, 0) / n;
    P.forEach(p => { const dx = cx - p.x, dy = cy - p.y, l = Math.hypot(dx, dy) || 1; out.push(tekst(SX(p.x) + dx / l * fs * 1.8, SY(p.y) - dy / l * fs * 1.8 + fs * 0.35, p.label || '', 'hoeklabel', fs * 1.1)); });
    if (o.titel) out.push(tekst(SX(cx), SY(cy), o.titel, 'naam', fs * 1.4));
    if (o.ondertitel) out.push(tekst(SX(cx), SY(cy) + fs * 1.8, o.ondertitel, 't-geschat', fs * 0.9));
    aanzichten.forEach(az => {
      if (!az) return;
      const A = P.find(p => p.id === az.links.id), Bp = P.find(p => p.id === az.rechts.id); if (!A || !Bp) return;
      const dl = Math.hypot(Bp.x - A.x, Bp.y - A.y) || 1, dx = (Bp.x - A.x) / dl, dy = (Bp.y - A.y) / dl, nx = -dy, ny = dx;   // naar buiten = links → rechts, kwartslag tegen de klok in
      // plaatselijk (lx, ly) = (u·s, −v·s) → svg = O + u·s·(dx, −dy) + v·s·(nx, −ny)
      const m = [dx, -dy, -nx, ny, SX(A.x), SY(A.y)];
      if (plan) {   // alleen de wandlengte buiten langs de wand, en de naam binnen
        const kn = []; keten(kn, [{ van: 0, tot: az.L * s, waarde: az.L, status: az.status.L }], -fs * 1.6, fs, false, { keer: dx < -0.02 || (Math.abs(dx) <= 0.02 && -dy > 0) });
        out.push(el('g', { transform: 'matrix(' + m.map(v => Math.round(v * 1e4) / 1e4).join(' ') + ')', 'data-wand': az.wand_id }, null, kn));
        const qx = (A.x + Bp.x) / 2 - nx * fs * 1.6 / s, qy = (A.y + Bp.y) / 2 - ny * fs * 1.6 / s;
        out.push(tekst(SX(qx), SY(qy) + fs * 0.35, az.wand, 'hoeklabel', fs * 1.1));
        return;
      }
      // leesrichting op papier: liggende tekst loopt langs (dx, −dy), staande tekst langs (nx, −ny); op zijn kop = naar links, of recht naar beneden
      const kop = (vx, vy) => vx < -0.02 || (Math.abs(vx) <= 0.02 && vy > 0);
      const r = T.aanzichtInhoud(az, { s, fs, ketens: kaal ? 'geen' : 'alles', boven: true, zonderHoeken: true, keerH: kop(dx, -dy), keerV: kop(nx, -ny), gekozen: null });
      // data-wand: de pagina kan een wand in de uitslag aantikbaar maken (het vlakje vangt ook een tik op een leeg stuk wand)
      const raak = el('rect', { x: 0, y: -az.H * s, width: az.L * s, height: az.H * s, 'class': 'raak wandraak' + (o.gekozenWand === az.wand_id ? ' gekozen' : ''), 'data-wand': az.wand_id });
      out.push(el('g', { transform: 'matrix(' + m.map(v => Math.round(v * 1e4) / 1e4).join(' ') + ')', 'data-wand': az.wand_id }, null, [raak].concat(r.knopen)));
      // naam van de wand in de kamer, net binnen de wandlijn
      const mx = (A.x + Bp.x) / 2 - nx * fs * 1.6 / s, my = (A.y + Bp.y) / 2 - ny * fs * 1.6 / s;
      out.push(tekst(SX(mx), SY(my) + fs * 0.35, az.wand, 'hoeklabel', fs * 1.1));
    });
    const boom = el('svg', { 'class': 'mtt uitslag', viewBox: '0 0 ' + Math.round(breedte) + ' ' + Math.round(hoogte), style: '--mtt-lijn:' + (o.lijn || 1.4), role: 'img', 'aria-label': 'Kameruitslag' }, null, out);
    return { boom, s, breedte, hoogte, gedraaid: staand };
  };

  // Lijst van alle onderdelen met hun maten (voor de tabellen in het rapport). Per onderdeel: wand, naam, plek, maten en opmerking.
  T.onderdeelRijen = function (aanzichten) {
    const rijen = [], mt = m => m ? T.maatTekst(m.waarde, m.status) : '—';
    aanzichten.forEach(az => {
      if (!az) return;
      az.items.forEach(it => {
        const r = it.rect, p = it.punt || it.lijn, op = it.opening, vl = it.vanLinks !== false, hoek = vl ? az.links.label : az.rechts.label;
        const rij = { id: it.det.id, wand: az.wand, variant: it.variant ? it.variant.label : '', naam: it.label, soort: it.soort, vorm: it.vorm, opmerking: it.opmerking || '', kozijn: it.soort === 'kozijn' || it.soort === 'raam' || it.soort === 'deur' };
        if (r) {
          rij.plek = T.maatTekst(vl ? r.x : az.L - r.x - r.w, it.status.x) + ' vanaf ' + hoek;
          rij.maat = T.maatTekst(r.w, it.status.w) + ' × ' + T.maatTekst(r.h, it.status.h);
          rij.hoogte = it.soort === 'vensterbank' ? 'bovenkant ' + T.maatTekst(r.y + r.h, it.status.y) : 'onderkant ' + T.maatTekst(r.y, it.status.y);
        } else if (p) {
          const sx = typeof p.status === 'string' ? p.status : p.status.x;
          rij.plek = p.x == null ? '?' : T.maatTekst(vl ? p.x : az.L - p.x, sx) + ' vanaf ' + hoek; rij.maat = '—';
          rij.hoogte = it.punt ? (p.y == null ? '?' : 'hart ' + T.maatTekst(p.y, p.status.y)) : 'hele hoogte';
        }
        if (op) {
          rij.opening = (D.OPENING_TYPES[op.type] || {}).label || op.type;
          rij.aftimmering = op.type !== 'nis' && op.zijden && op.zijden.length ? op.zijden.join(', ') + ' · ' + T.maatTekst(op.dikte, op.dikte_status === 'aangenomen' ? 'geschat' : op.dikte_status) + ' mm' : '—';
          rij.binnenwerks = op.binnen ? T.maatTekst(op.binnen.w, op.binnen.status.w) + ' × ' + T.maatTekst(op.binnen.h, op.binnen.status.h) : '—';
          rij.diepte = [op.type === 'aftimmering-op-wand' && op.uitsteek ? mt(op.uitsteek) + ' voor de muur' : null, op.type === 'nis-met-aftimmering' && op.nis_diepte ? mt(op.nis_diepte) + ' wand tot aftimmering' : null,
            op.kozijn_diepte ? mt(op.kozijn_diepte) + (op.type === 'nis' ? ' wand tot kozijn' : ' aftimmering tot kozijn') : null].filter(Boolean).join(', ') || '—';
        }
        rij.vakken = it.raam && it.raam.vakken ? it.raam.vakken.map(v => v.functie).join(' | ') : '';
        rijen.push(rij);
      });
    });
    return rijen;
  };

  // Opmaak van het rapport (tekeningen op papier: altijd licht). De pagina zet een <div id="rapport"> met de knoppenbalk klaar en hangt T.rapport erin.
  T.RAPPORT_STIJL = [
    "/* Tekeningen (kameruitslag, wandpagina's): altijd licht, ook in de donkere weergave, want het is papier */",
    "#rapport{position:fixed;inset:0;z-index:50;overflow:auto;background:#e9ece8;color:#16211a;--inkt:#16211a;--zacht:#5d6b62;--rand:#cfd6d0;--vlak:#ffffff;--bg:#ffffff;--primair:#17643f;--kies:#1c5fc4;--oranje:#a86504;--geschat:#7f8a83;--rood:#c4322a}",
    ".rp-balk{position:sticky;top:0;z-index:2;display:flex;gap:10px;align-items:center;padding:10px 16px;background:#ffffff;border-bottom:1px solid #cfd6d0}",
    ".rp-balk strong{font-size:17px} .rp-uitleg{flex:1;color:#5d6b62;font-size:13px}",
    ".rp-balk .knop{color:#16211a;background:#fff;border:1px solid #cfd6d0} .rp-balk .knop.hoofd{background:#17643f;color:#fff;border-color:#17643f}",
    ".rp-pagina{background:#fff;max-width:1180px;margin:16px auto;padding:20px 24px;border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:10px}",
    ".rp-kop{display:flex;align-items:baseline;gap:14px;border-bottom:2px solid #16211a;padding-bottom:6px}",
    ".rp-kop h2{margin:0;font-size:20px} .rp-kop span{color:#5d6b62;font-size:13px}",
    ".rp-pagina h3{margin:8px 0 0;font-size:14px}",
    ".rp-tek svg{max-height:150mm} .rp-wand svg{max-height:none;margin:0 auto}",
    ".rp-legenda{color:#5d6b62;font-size:12px;margin:0}",
    ".rp-pagina table{border-collapse:collapse;width:100%;font-size:12.5px}",
    ".rp-pagina td,.rp-pagina th{border-bottom:1px solid #cfd6d0;padding:4px 6px;text-align:left;vertical-align:top}",
    ".rp-pagina th{color:#5d6b62;font-weight:600}",
    ".rp-doorsneden{display:flex;flex-wrap:wrap;gap:12px}",
    ".rp-doorsneden figure{margin:0;width:300px} .rp-doorsneden figcaption{font-size:12px;color:#5d6b62}",
    "@media (max-width:700px){.rp-uitleg{display:none} .rp-balk{padding:8px 10px} .rp-balk strong{flex:1} .rp-pagina{padding:12px 10px;margin:8px 4px} .rp-kop{flex-direction:column;gap:2px} .rp-pagina table{font-size:11px}}",
    "@media print{",
    "  @page{size:A4 landscape;margin:9mm}",
    "  body.rapport-open > *:not(#rapport){display:none !important}",
    "  html,body.rapport-open{background:#fff !important}",
    "  #rapport{position:static;overflow:visible;background:#fff}",
    "  .rp-balk{display:none}",
    "  .rp-pagina{box-shadow:none;margin:0;padding:0;max-width:none;border-radius:0;break-after:page;page-break-after:always}",
    "  .rp-pagina:last-child{break-after:auto;page-break-after:auto}",
    "  .rp-pagina table,.rp-doorsneden figure{break-inside:avoid}",
    "}"
  ].join('\n');

  // Het rapport als DOM (geen HTML als tekst): kameruitslag of plattegrond, wandafwikkeling, per wand een pagina met onderdelen- en kozijnenlijst, en een
  // slotpagina met wandmaten en open punten. g: { dossier, lm (lijnmodel), openVragen, controlematen, datum (tekst) }. Zelfde uitvoer op telefoon en kantoor.
  T.rapport = function (doc, g) {
    const dos = g.dossier, lm = g.lm, azs = dos.wanden.map(w => D.wandAanzicht(dos, w.id, lm)), rijenAlle = T.onderdeelRijen(azs);
    const maak = (tag, tekst, klasse) => { const e = doc.createElement(tag); if (tekst != null) e.textContent = tekst; if (klasse) e.className = klasse; return e; };
    const tabel = (koppen, rijen) => { const t = maak('table'), kr = maak('tr'); koppen.forEach(k => kr.appendChild(maak('th', k))); t.appendChild(kr);
      rijen.forEach(r => { const tr = maak('tr'); r.forEach(c => tr.appendChild(maak('td', c == null || c === '' ? '—' : String(c)))); t.appendChild(tr); }); return t; };
    const uit = maak('div', null, 'rp-rapport'), naam = dos.ruimte.naam + (dos.project && (dos.project.code || dos.project.naam) ? ' · ' + (dos.project.code || dos.project.naam) : '');
    const legenda = 'Maten in mm. Zwart = gemeten · blauw = berekend uit gemeten maten · grijs ~ = geschat (camera of aanname), niet om op te bestellen · ? = nog meten. Aanzichten gezien vanuit de kamer. ' +
      'Raam of deur: de twee zwarte blokjes staan aan de scharnierkant, de punt van de driehoek wijst naar de kruk (bij kiep en klep naar het scharnier); getrokken = draait de kamer in, gestreept = draait naar buiten. ' +
      'Stopcontacten en schakelaars: afdekplaat op schaal met het aantal contacten, maat op het hart. Leiding: doorsnede op schaal met KW (koud water), WW (warm water), CV, GAS, AFV (afvoer) of E (elektra).';
    const kop = (titel, sub) => { const h = maak('header', null, 'rp-kop'); h.appendChild(maak('h2', titel)); h.appendChild(maak('span', naam + (g.datum ? ' · opname ' + g.datum : '') + (sub ? ' · ' + sub : ''))); return h; };
    const eenvoudig = T.eenvoudig(lm);
    // Een kamer met alleen uitspringende hoeken: wanden opengeklapt rond de plattegrond. Met een inspringende hoek (L-vorm, nis) zouden opengeklapte wanden
    // over elkaar vallen: dan alleen de plattegrond met de wandnamen, en de wanden staan in de afwikkeling op de volgende pagina.
    const p1 = maak('section', null, 'rp-pagina'); p1.appendChild(kop(eenvoudig ? 'Kameruitslag' : 'Plattegrond', 'lijnmodel ' + lm.status + (lm.sluitfout_mm != null ? ', sluitfout ' + lm.sluitfout_mm + ' mm' : '')));
    const u = T.uitslag(lm, azs, { titel: dos.ruimte.naam, ondertitel: lm.hoogte && lm.hoogte.waarde ? 'plafond ' + T.maatTekst(lm.hoogte.waarde, lm.hoogte.status) : '', breedte: 1500, maxHoogte: 940, ketens: eenvoudig ? 'alles' : 'plan' });
    const uv = maak('div', null, 'rp-tek'); uv.appendChild(T.naarDom(doc, u.boom)); p1.appendChild(uv);
    p1.appendChild(maak('p', legenda + (eenvoudig ? ' De wanden zijn om hun vloerlijn naar buiten geklapt; er is niets gespiegeld.' : ' Deze kamer heeft een inspringende hoek: de wanden staan naast elkaar in de wandafwikkeling.'), 'rp-legenda'));
    uit.appendChild(p1);
    // wandafwikkeling: alle wanden naast elkaar, met de klok mee (werkt voor elke kamervorm)
    const pa = maak('section', null, 'rp-pagina'); pa.appendChild(kop('Wandafwikkeling', 'alle wanden naast elkaar, met de klok mee gezien vanuit de kamer'));
    const af = T.afwikkeling(azs, { breedte: 1500, fs: 12 }), av = maak('div', null, 'rp-tek'); if (af.boom) av.appendChild(T.naarDom(doc, af.boom)); pa.appendChild(av);
    pa.appendChild(maak('p', legenda, 'rp-legenda')); uit.appendChild(pa);
    // per wand een pagina
    azs.forEach(az => {
      if (!az) return;
      const p = maak('section', null, 'rp-pagina'); p.appendChild(kop(az.wand + ' · ' + az.links.label + ' – ' + az.rechts.label, 'lengte ' + T.maatTekst(az.L, az.status.L) + ' · hoogte ' + T.maatTekst(az.H, az.status.H)));
      // 1500 tekeneenheden = de paginabreedte; een korte wand wordt smaller getekend (niet kleiner), zodat de maten overal even groot blijven
      let t = T.aanzicht(az, { ketens: 'alles', breedte: 1500, fs: 22 }); if (t.hoogte > 620) t = T.aanzicht(az, { ketens: 'alles', breedte: Math.max(560, Math.round(1500 * 620 / t.hoogte)), fs: 22 });
      const tv = maak('div', null, 'rp-tek rp-wand'), sv = T.naarDom(doc, t.boom); sv.setAttribute('style', 'width:' + (t.breedte / 15).toFixed(1) + '%'); tv.appendChild(sv); p.appendChild(tv);
      const rijen = rijenAlle.filter(x => x.wand === az.wand);
      if (rijen.length) {
        p.appendChild(tabel(['Onderdeel', 'Uitvoering', 'Plek langs de wand', 'Breedte × hoogte', 'Hoogte', 'Opmerking'], rijen.map(x => [x.naam, x.variant, x.plek, x.maat, x.hoogte, x.opmerking])));
        const koz = rijen.filter(x => x.opening);
        if (koz.length) {
          p.appendChild(maak('h3', 'Kozijnen op deze wand'));
          p.appendChild(tabel(['Kozijn', 'Soort opening', 'Binnenwerks (b × h)', 'Op de wand (b × h)', 'Aftimmering', 'De wand in', 'Vakken, van links naar rechts'], koz.map(x => [x.naam, x.opening, x.binnenwerks, x.maat, x.aftimmering, x.diepte, x.vakken])));
          const dr = maak('div', null, 'rp-doorsneden');
          koz.forEach(x => { const it = az.items.find(i => i.det.id === x.id), ds = T.doorsnede(it, { breedte: 700, fs: 26 }); if (!ds.boom) return; const f = maak('figure'); f.appendChild(T.naarDom(doc, ds.boom)); f.appendChild(maak('figcaption', x.naam + ': doorsnede van boven gezien')); dr.appendChild(f); });
          p.appendChild(dr);
        }
      } else p.appendChild(maak('p', 'Geen onderdelen op deze wand.', 'rp-legenda'));
      p.appendChild(maak('p', legenda, 'rp-legenda'));
      uit.appendChild(p);
    });
    // laatste pagina: wandmaten, controles en wat nog open staat
    const pl = maak('section', null, 'rp-pagina'); pl.appendChild(kop('Maten en open punten'));
    pl.appendChild(tabel(['Wand', 'Lengte', 'Status', 'Bron', 'Camera (ter controle)'], lm.segmenten.map(sg => [sg.label, sg.lengte.waarde, sg.lengte.status, D.BRONNEN[sg.lengte.bron] || sg.lengte.bron, sg.camera_mm])));
    (g.controlematen || []).forEach(c => pl.appendChild(maak('p', 'Controlemaat ' + c.van + '–' + c.naar + ': gemeten ' + c.gemeten + ', verwacht ' + c.verwacht + ' (' + (c.verschil > 0 ? '+' : '') + c.verschil + ' mm)')));
    const ov = g.openVragen || [];
    pl.appendChild(maak('h3', ov.length ? 'Nog open (' + ov.length + ')' : 'Geen open vragen'));
    if (ov.length) { const uo = maak('ul'); ov.forEach(v => uo.appendChild(maak('li', v.tekst))); pl.appendChild(uo); }
    const opm = dos.opmerkingen || [];
    if (opm.length) { pl.appendChild(maak('h3', 'Opmerkingen')); const ul = maak('ul'); opm.forEach(o => ul.appendChild(maak('li', o.tekst))); pl.appendChild(ul); }
    uit.appendChild(pl);
    return uit;
  };

  root.MTRuimteTekening = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);

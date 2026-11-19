// Draaien: vanuit de repo 'python3 -m http.server 8123 --bind 127.0.0.1' starten, dan: node test/ruimte-e2e.js <uitvoermap>
// Eind-tot-eind: nagebootste rondgang op de S24-pagina (zonder AR) -> details, X4- en handmaten -> panorama -> pakket -> kantoorkijker.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const UIT = process.argv[2];
const BASIS = process.env.MT_BASIS || 'http://127.0.0.1:8123/docs/';
fs.mkdirSync(UIT, { recursive: true });
const log = [];
function check(naam, ok, extra) { log.push((ok ? 'ok  - ' : 'FOUT - ') + naam + (extra ? '  ' + extra : '')); console.log(log[log.length - 1]); if (!ok) process.exitCode = 1; }

// Nagebootste kamer 4 x 3 x 2,6 m: raam met radiator ervoor en cv-leiding eronder op W3, stopcontact op W1, nis-achtig kastje (obstakel) bij W4.
const RENDER = `
window.renderKamer = function (cam, w, h, fovy) {
  var c = document.createElement('canvas'); c.width = w; c.height = h; var cx = c.getContext('2d'), img = cx.createImageData(w, h), D = img.data;
  var f = [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch)];
  var r = [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  var th = Math.tan(fovy / 2), asp = w / h, H = 2.6;
  var wanden = [{ a: [0, 0], b: [4, 0], kl: [222, 205, 180] }, { a: [4, 0], b: [4, 3], kl: [196, 214, 226] }, { a: [4, 3], b: [0, 3], kl: [206, 224, 198] }, { a: [0, 3], b: [0, 0], kl: [232, 200, 206] }];
  for (var py = 0; py < h; py++) for (var px = 0; px < w; px++) {
    var nx = (2 * (px + 0.5) / w - 1) * th * asp, ny = (1 - 2 * (py + 0.5) / h) * th;
    var d = [f[0] + r[0] * nx + u[0] * ny, f[1] + r[1] * nx + u[1] * ny, f[2] + r[2] * nx + u[2] * ny];
    var best = 1e9, kl = [0, 0, 0];
    // kastje (obstakel) als doos x 0..0.6, z 0.8..1.6, y 0..0.9
    var tmin = 0, tmax = 1e9, ok = true, o = [cam.x, cam.y, cam.z], lo = [0, 0, 0.8], hi = [0.6, 0.9, 1.6];
    for (var a = 0; a < 3 && ok; a++) { if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) ok = false; continue; } var t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a]; if (t1 > t2) { var q = t1; t1 = t2; t2 = q; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) ok = false; }
    if (ok && tmin > 0.01) { best = tmin; kl = [90, 70, 55]; }
    wanden.forEach(function (W, i) {
      var ex = W.b[0] - W.a[0], ez = W.b[1] - W.a[1], L = Math.hypot(ex, ez), nX = -ez / L, nZ = ex / L, den = d[0] * nX + d[2] * nZ; if (Math.abs(den) < 1e-9) return;
      var t = ((W.a[0] - cam.x) * nX + (W.a[1] - cam.z) * nZ) / den; if (!(t > 0.01) || t >= best) return;
      var X = cam.x + d[0] * t, Y = cam.y + d[1] * t, Z = cam.z + d[2] * t, uu = ((X - W.a[0]) * ex + (Z - W.a[1]) * ez) / L;
      if (uu < 0 || uu > L || Y < 0 || Y > H) return;
      best = t; kl = W.kl.slice();
      if ((uu % 0.5) < 0.012 || (Y % 0.5) < 0.012) kl = [kl[0] - 40, kl[1] - 40, kl[2] - 40];
      if (i === 2 && uu > 0.7 && uu < 2.2 && Y > 0.9 && Y < 2.3) kl = (uu < 0.76 || uu > 2.14 || Y < 0.96 || Y > 2.24) ? [250, 250, 250] : [140, 190, 235];
      if (i === 2 && uu > 0.8 && uu < 2.1 && Y > 0.35 && Y < 0.8) kl = ((uu * 20) % 1 < 0.25) ? [200, 200, 200] : [245, 245, 245];
      if (i === 2 && Math.abs(Y - 0.25) < 0.012 && uu > 0.5 && uu < 2.4) kl = [150, 40, 30];
      if (i === 0 && Math.abs(uu - 1.0) < 0.04 && Math.abs(Y - 0.3) < 0.04) kl = [255, 255, 255];
      if (i === 0 && Math.abs(uu - 1.0) < 0.012 && Math.abs(Y - 0.3) < 0.012) kl = [60, 60, 60];
    });
    if (d[1] < 0) { var tf = -cam.y / d[1]; if (tf < best) { best = tf; var fx = cam.x + d[0] * tf; kl = ((fx * 6) % 1 < 0.08) ? [120, 80, 45] : [170, 120, 75]; } }
    if (d[1] > 0) { var tc = (H - cam.y) / d[1]; if (tc < best) { best = tc; kl = [245, 245, 240]; } }
    var k = (py * w + px) * 4; D[k] = kl[0]; D[k + 1] = kl[1]; D[k + 2] = kl[2]; D[k + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  // pv = perspectief x kijkmatrix (kolom-volgorde), zoals WebXR ze geeft
  function mul(a, b) { var o = new Array(16); for (var cc = 0; cc < 4; cc++) for (var rr = 0; rr < 4; rr++) { var s = 0; for (var kk = 0; kk < 4; kk++) s += a[kk * 4 + rr] * b[cc * 4 + kk]; o[cc * 4 + rr] = s; } return o; }
  var t1 = 1 / th, n = 0.05, fa = 100, P = [t1 / asp, 0, 0, 0, 0, t1, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
  var z = [-f[0], -f[1], -f[2]], X = r, Yv = [z[1] * X[2] - z[2] * X[1], z[2] * X[0] - z[0] * X[2], z[0] * X[1] - z[1] * X[0]], e = [cam.x, cam.y, cam.z], dt = function (p, q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; };
  var V = [X[0], Yv[0], z[0], 0, X[1], Yv[1], z[1], 0, X[2], Yv[2], z[2], 0, -dt(X, e), -dt(Yv, e), -dt(z, e), 1];
  return new Promise(function (ok) { c.toBlob(function (b) { ok({ blob: b, pv: mul(P, V), pos: e, dir: f, w: w, h: h }); }, 'image/jpeg', 0.7); });
};`;

(async () => {
  const browser = await chromium.launch();
  // ── S24: de rondgang ──
  const tel = await browser.newContext({ viewport: { width: 384, height: 854 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await tel.newPage();
  const fouten = []; p.on('pageerror', e => fouten.push(e.message)); p.on('console', m => { if (m.type() === 'error') fouten.push(m.text()); });
  await p.goto(BASIS + 'opname-ar-proef.html');
  await p.addScriptTag({ content: RENDER });
  await p.fill('#r-project', 'TEST-003'); await p.fill('#r-ruimte', 'Proefkamer raam en radiator');
  await p.screenshot({ path: path.join(UIT, 's24-01-start.png') });
  const t0 = Date.now();
  const details = await p.evaluate(async () => {
    const R = window.renderKamer, beelden = [];
    // twee kijkpunten in de kamer, rondkijken in 8 richtingen, plus omhoog en omlaag; de derde plek ligt achter het kastje (obstakel)
    for (const st of [{ x: 1.3, z: 1.6 }, { x: 2.9, z: 1.4 }, { x: 0.9, z: 2.5 }]) for (let k = 0; k < 8; k++) for (const pitch of [-0.35, 0.1, 0.5]) {
      if (st.x === 0.9 && pitch !== 0.1) continue;
      beelden.push(await R({ x: st.x, y: 1.45, z: st.z, yaw: k * Math.PI / 4, pitch }, 300, 650, 64 * Math.PI / 180));
    }
    const foto = await R({ x: 2.5, y: 0.9, z: 2.3, yaw: Math.PI, pitch: -0.4 }, 720, 1560, 60 * Math.PI / 180);
    const foto2 = await R({ x: 3.0, y: 1.0, z: 0.8, yaw: 0, pitch: -0.3 }, 720, 1560, 60 * Math.PI / 180);
    // bij elke hoek een foto (van 1,3 m binnen de kamer op de vloerhoek gericht); de wandfoto van W3 liggend vanaf de overkant
    const echt = [[0, 0], [4, 0], [4, 3], [0, 3]], hoekBeelden = [];
    for (const [X, Z] of echt) {
      const dx = 2 - X, dz = 1.5 - Z, L = Math.hypot(dx, dz), px = X + dx / L * 1.3, pz = Z + dz / L * 1.3;
      const ux = X - px, uz = Z - pz, h = Math.hypot(ux, uz);
      hoekBeelden.push(await R({ x: px, y: 1.45, z: pz, yaw: Math.atan2(ux, -uz), pitch: Math.atan2(-1.45, h) }, 600, 1300, 60 * Math.PI / 180));
    }
    const wandBeelden = [await R({ x: 2, y: 1.3, z: 0.2, yaw: Math.PI, pitch: 0 }, 1000, 560, 64 * Math.PI / 180)];
    // H2 is 'uit de hand' 6 cm en 4 cm naast de echte hoek getikt; de foto's tonen de echte kamer
    const dets = window.arProef.proefRondgang({ punten: [{ x: 0, z: 0 }, { x: 4.06, z: 0.04 }, { x: 4, z: 3 }, { x: 0, z: 3 }], vloerY: 0, plafondY: 2.6, beelden, hoekBeelden, wandBeelden,
      details: [{ anker: { wand_nr: 2, u: 2.45, v: 0.26 }, soort: 'leiding', foto: foto.blob, pose: { pos: foto.pos, dir: foto.dir, pv: foto.pv }, w: 720, h: 1560 },
        { anker: { wand_nr: 0, u: 1.02, v: 0.29 }, soort: 'stopcontact', foto: foto2.blob, pose: { pos: foto2.pos, dir: foto2.dir, pv: foto2.pv }, w: 720, h: 1560 }] });
    return dets.map(d => d.id);
  });
  check('rondgang nagebootst: 2 details aangemaakt', details.length === 2);
  await p.waitForFunction(() => { const d = window.arProef.dossier(); return d && d.beelden.length && d.beelden.every(b => b.bewaard); }, null, { timeout: 20000 });
  const n = await p.evaluate(() => window.arProef.dossier().beelden.length);
  check('alle beelden stapsgewijs veilig bewaard', n > 50, n + ' beelden');
  // live-laag nagebootst: twee door ARCore gevonden wandvlakken, drie getikte hoeken, beelden zonder links en zonder omhoog -> plattegrondje en aanwijzing
  const live = await p.evaluate(async () => {
    document.querySelector('#ar-laag').hidden = false;
    const R = window.renderKamer, bl = [];
    for (let k = 0; k < 8; k++) { if (k === 6 || k === 7) continue; bl.push(await R({ x: 1.3, y: 1.45, z: 1.6, yaw: k * Math.PI / 4, pitch: 0 }, 60, 120, 1)); }
    bl.push(await R({ x: 1.3, y: 1.45, z: 1.6, yaw: 0, pitch: -0.7 }, 60, 120, 1));
    const vl = [{ pl: { lastChangedTime: 1 }, pts: [{ x: 0.2, y: 0, z: 0 }, { x: 3.1, y: 0, z: 0 }, { x: 3.1, y: 2.2, z: 0 }, { x: 0.2, y: 2.2, z: 0 }], as: { x: 1, z: 0 } },
      { pl: { lastChangedTime: 1 }, pts: [{ x: 4, y: 0, z: 0.4 }, { x: 4, y: 0, z: 2.5 }, { x: 4, y: 2, z: 2.5 }], as: { x: 0, z: 1 } }];
    const r = window.arProef.liveProef({ nieuw: true, vlakken: vl, punten: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }], beelden: bl, oog: { x: 1.3, y: 1.45, z: 1.6 }, rich: { x: 0, y: -0.2, z: -0.98 }, stilstaan: true });
    return r;
  });
  check('live: aanwijzing alleen bij een echte leemte', live.hint === 'Draai hier even naar links en omhoog', live.hint);
  check('live: gevonden wandvlakken als ruw scanvoorstel bewaard, naast de getikte hoeken', live.aanwijzingen && live.aanwijzingen.length === 1 && live.waarnemingen.automatisch >= 2, JSON.stringify(live.waarnemingen));
  await p.screenshot({ path: path.join(UIT, 's24-01b-live-laag.png') });
  await p.evaluate(id => window.arProef.toonDetailInAr(window.arProef.dossier().details.find(d => d.id === id)), details[1]);
  await p.screenshot({ path: path.join(UIT, 's24-01c-detail-in-ar.png') });
  await p.evaluate(() => { document.querySelector('#dp-klaar').click(); document.querySelector('#ar-laag').hidden = true; });
  // wandmaten: W2 en W4 via de X4 (snelle reeks + Enter), W1 en W3 met de hand
  for (const [i, v, snel] of [[0, '4000', false], [1, '3000', true], [2, '4000', false], [3, '3000', true]]) {
    await p.click('#hand-' + i); await p.keyboard.type(v, { delay: snel ? 15 : 220 }); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  }
  // het dossier begint met het overzicht; de rest staat in inklapbare blokken. Voor de test alles open.
  const openBlokken = () => p.evaluate(() => document.querySelectorAll('#s-dossier details.blok').forEach(x => { x.open = true; }));
  const ingeklapt = await p.evaluate(() => Array.from(document.querySelectorAll('#s-dossier details.blok')).every(x => !x.open) && document.querySelectorAll('#s-dossier details.blok').length >= 5);
  await openBlokken();
  await p.click('#d-plafond'); await p.keyboard.type('2600', { delay: 15 }); await p.keyboard.press('Enter');
  await p.click('details.later summary');   // haaksheid en diagonaal staan ingeklapt onder 'Later'
  await p.selectOption('#d-diag-van', { index: 0 }); await p.selectOption('#d-diag-naar', { index: 2 }); await p.click('#d-diag'); await p.keyboard.type('5000', { delay: 220 }); await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  // controlemaat tape tot tape: W1 1000 mm van H1 naar W3 1000 mm van H4 (tegenover elkaar), verwacht 3000
  await p.selectOption('#d-cp-wa', { index: 0 }); await p.selectOption('#d-cp-ha', { index: 0 }); await p.fill('#d-cp-aa', '1000');
  await p.selectOption('#d-cp-wb', { index: 2 }); await p.selectOption('#d-cp-hb', { index: 1 }); await p.fill('#d-cp-ab', '1000');
  await p.click('#d-cp-m'); await p.keyboard.type('3004', { delay: 15 }); await p.keyboard.press('Enter');
  const cpt = await p.textContent('#d-controle');
  check('controlemaat tape tot tape: verwacht 3000, gemeten 3004 (X4)', /W1 \(1000 van H1\) – W3 \(1000 van H4\): gemeten 3004 mm, het model verwacht 3000 mm \(\+4 mm\)/.test(cpt), cpt);
  // haaksheid met een driehoeksmeting (1000 / 1000 / 1414 = 90°)
  await p.selectOption('#d-dh-hoek', { index: 0 }); await p.fill('#d-dh-c', '1414'); await p.click('#k-dh');
  const dh = await p.textContent('#d-dh-uit');
  check('driehoeksmeting: H1 gemeten 89,98° naast het model', /H1: gemeten 89,98°/.test(dh) && /model 90°/.test(dh), dh);
  // leiding: hart, vanaf welke hoek, X4 voor hoogte, hand voor de afstand, uitsteek open
  await p.evaluate(id => window.arProef.openPaneel(window.arProef.dossier().details.find(d => d.id === id)), details[0]);
  await p.selectOption('#dp-ref', { index: 1 });
  await p.click('#dp-hoogte_hart');
  const actief = await p.evaluate(() => document.querySelector('#dp-hoogte_hart').closest('.maatrij').classList.contains('actief'));
  check('bij "hoogte hart" staat zichtbaar dat de X4-invoer daar terechtkomt', actief);
  await p.screenshot({ path: path.join(UIT, 's24-02-detail-x4-veld.png') });
  await p.keyboard.type('262', { delay: 15 }); await p.keyboard.press('Enter');
  await p.fill('#dp-afstand_hart_tot_hoek', ''); await p.keyboard.type('1550', { delay: 220 }); await p.keyboard.press('Enter');
  await p.fill('#dp-opm', 'Nieuwe vloer komt 12 mm hoger'); await p.press('#dp-opm', 'Tab');
  await p.screenshot({ path: path.join(UIT, 's24-03-detail-maten.png') });
  await p.click('#dp-klaar');
  const m = await p.evaluate(id => { const D = window.MTRuimteDossier, d = window.arProef.dossier(); return ['hoogte_hart', 'afstand_hart_tot_hoek', 'uitsteek_max'].map(f => { const x = D.huidigeMeting(d, id, f); return x ? [x.bron, x.status, x.waarde_mm] : null; }); }, details[0]);
  check('leiding: X4-maat, handmaat en open maat', m[0][0] === 'disto' && m[0][2] === 262 && m[1][0] === 'hand' && m[1][2] === 1550 && m[2] === null, JSON.stringify(m));
  // hoekfoto's, wandfoto en hoek nakijken op de foto
  const hf = await p.evaluate(() => { const d = window.arProef.dossier(); return { hoek: d.beelden.filter(b => b.soort === 'hoek' && b.hoek_id).length, per: d.hoeken.map(h => (h.foto_ids || []).length), wand: d.beelden.filter(b => b.soort === 'wand').map(b => [b.wand_id === d.wanden[2].id, b.heel_in_beeld]) }; });
  check('bij elke hoek een foto, gekoppeld aan de hoek', hf.hoek === 4 && hf.per.every(n => n === 1), JSON.stringify(hf));
  check('wandfoto herkend als W3, hele wand in beeld', hf.wand.length === 1 && hf.wand[0][0] && hf.wand[0][1], JSON.stringify(hf.wand));
  await p.click('#d-hoeken li:nth-child(2) button');
  await p.waitForFunction(() => { const im = document.querySelector('#d-paneel img'); return im && im.complete && im.naturalWidth > 0; }, null, { timeout: 10000 });
  await p.screenshot({ path: path.join(UIT, 's24-08-hoek-nakijken.png') });
  const doel = await p.evaluate(() => { const d = window.arProef.dossier(), h = d.hoeken[1], b = d.beelden.find(x => x.id === h.foto_ids[0]), q = window.arProef.AR.projecteer(b.pose.pv, 4, 0, 0), r = document.querySelector('#d-paneel img').getBoundingClientRect(); return { x: r.left + q.x * r.width, y: r.top + q.y * r.height }; });
  await p.mouse.click(doel.x, doel.y);
  await p.click('#d-paneel .knop.hoofd');
  const hc = await p.evaluate(() => { const h = window.arProef.dossier().hoeken[1]; return { st: h.status, x: h.xr.x, z: h.xr.z, mm: h.correctie && h.correctie.verschuiving_mm, ruw: h.xr_ruw }; });
  check('hoek op de foto gecorrigeerd naar de echte hoek; tik bewaard', hc.st === 'gecorrigeerd' && Math.abs(hc.x - 4) < 0.02 && Math.abs(hc.z) < 0.02 && hc.ruw.x === 4.06 && Math.abs(hc.mm - 72) < 15, JSON.stringify(hc));
  // groothoekfoto van W3 van 1,4 m afstand: vier hoeken aantikken, rechttrekken, raam op de juiste plek in het wandbeeld
  const gh = await p.evaluate(async () => {
    const R = window.renderKamer, f = await R({ x: 2, y: 1.3, z: 1.6, yaw: Math.PI, pitch: 0 }, 1000, 1000, 120 * Math.PI / 180), AR = window.arProef.AR;
    const pr = (x, y, z) => AR.projecteer(f.pv, x, y, z), vloer = [pr(4, 0, 3), pr(0, 0, 3)].sort((a, b) => a.x - b.x), plaf = [pr(4, 2.6, 3), pr(0, 2.6, 3)].sort((a, b) => a.x - b.x);
    await window.arProef.groothoekProef(2, f.blob, [vloer[0], vloer[1], plaf[1], plaf[0]]);
    await window.arProef.schrijfNu();
    const d = window.arProef.dossier(), w = d.wanden[2], p = d.panorama.find(x => x.wand_id === w.id), foto = await window.MTOpnameOpslag.leesFoto(window.arProef.rec().id + ':pano-' + w.id);
    const bm = await createImageBitmap(foto.blob), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    const links = window.arProef.wandRichting(2), px = u => Math.round((links ? u : 4 - u) / 4 * bm.width), py = v => Math.round((2.6 - v) / 2.6 * bm.height);
    const kl = (u, v) => Array.from(x.getImageData(px(u), py(v), 1, 1).data.slice(0, 3));
    return { bron: p && p.bron, w: bm.width, h: bm.height, raam: kl(1.45, 1.6), muur: kl(3.3, 1.2), radiator: kl(1.45, 0.55), links };
  });
  check('groothoekfoto: rechtgetrokken wandbeeld bewaard als bron groothoek', gh.bron === 'groothoek' && gh.w === 600 && gh.h === 390, JSON.stringify(gh));
  check('groothoekfoto: raam, radiator en muur op de goede plek', gh.raam[2] > gh.raam[0] + 50 && gh.radiator.every(c => c > 200) && gh.muur[1] > gh.muur[2], JSON.stringify(gh));
  // review 18-11 (GPT): een opgeslagen maat houdt haar eigen referentie; alleen de keuzelijst wisselen verandert niets
  const plekNu = id => p.evaluate(id => { const D = window.MTRuimteDossier, d = window.arProef.dossier(), det = d.details.find(x => x.id === id), lm = D.lijnmodel(d, window.arProef.AR), pl = D.detailPlek(d, det, lm); return { x: pl.x, y: pl.y, vanaf: pl.vanaf_hoek, n: D.historie(d, id, 'afstand_hart_tot_hoek').length, st: pl.status.langs_wand }; }, id);
  const voor = await plekNu(details[0]);
  await p.evaluate(id => window.arProef.openPaneel(window.arProef.dossier().details.find(d => d.id === id)), details[0]);
  await p.selectOption('#dp-ref', { index: 0 }); await p.click('#dp-klaar');
  const naKeuze = await plekNu(details[0]);
  check('review: alleen de referentiehoek wisselen laat plek en metingen staan', naKeuze.x === voor.x && naKeuze.y === voor.y && naKeuze.n === voor.n && naKeuze.st === 'gemeten', JSON.stringify([voor, naKeuze]));
  await p.evaluate(id => window.arProef.openPaneel(window.arProef.dossier().details.find(d => d.id === id)), details[0]);
  await p.click('#dp-afstand_hart_tot_hoek'); await p.keyboard.type('1550', { delay: 220 }); await p.keyboard.press('Enter'); await p.click('#dp-klaar');
  const naMeting = await plekNu(details[0]);
  check('review: dezelfde 1550 bewust vanaf de andere hoek meten geeft een nieuwe meting en een andere plek', naMeting.n === voor.n + 1 && naMeting.vanaf !== voor.vanaf && (naMeting.x !== voor.x || naMeting.y !== voor.y), JSON.stringify(naMeting));
  await p.waitForTimeout(700);   // zoals een gebruiker die 'Veilig bewaard' ziet en dan pas sluit
  await p.reload(); await p.waitForSelector('#r-lijst li'); await p.click('#r-lijst li button'); await openBlokken();
  const naHeropenen = await plekNu(details[0]);
  check('review: na heropenen dezelfde plek en historie', naHeropenen.x === naMeting.x && naHeropenen.n === naMeting.n && naHeropenen.vanaf === naMeting.vanaf);
  // wandaanzicht (B36): de tekening is de invoer. Kozijn toevoegen en met de X4 achter elkaar door meten: alleen getal + Enter, zonder een veld aan te tikken.
  const X4 = async val => { await p.keyboard.type(val, { delay: 15 }); await p.keyboard.press('Enter'); };
  const azTekst = () => p.evaluate(() => Array.from(document.querySelectorAll('#d-paneel .aztek svg text')).map(t => (t.getAttribute('class') || '') + ':' + t.textContent));
  const azIt = (wi) => p.evaluate(i => { const D = window.MTRuimteDossier, d = window.arProef.dossier(), az = D.wandAanzicht(d, d.wanden[i].id, window.arProef.AR); return az.items.map(x => ({ id: x.det.id, soort: x.soort, label: x.label, vorm: x.vorm, rect: x.rect || null, punt: x.punt || null, opmerking: x.opmerking, status: x.det.status })); }, wi);
  await p.evaluate(() => window.arProef.openAanzicht(window.arProef.dossier().wanden[2].id, null));
  await p.click('#az-plus-kozijn');
  check('nieuw kozijn: invoerbalk staat klaar op de eerste maat en de tekening toont vraagtekens', await p.evaluate(() => document.activeElement && document.activeElement.id === 'az-invoer' && /Vanaf de hoek/.test(document.querySelector('.azlabel').textContent) && Array.from(document.querySelectorAll('.aztek svg text')).filter(t => t.textContent === '?').length >= 3));
  await p.screenshot({ path: path.join(UIT, 's24-09a-wandaanzicht-nieuw-kozijn.png') });
  for (const val of ['700', '1500', '1400', '900', '115']) await X4(val);
  await p.waitForTimeout(300);
  const azT = await azTekst();
  await p.screenshot({ path: path.join(UIT, 's24-09-wandaanzicht-kozijn.png'), fullPage: false });
  check('wandaanzicht: kozijn 700 + 1500 + rest 1800 (afgeleid), 900 + 1400 + 300 tot plafond (afgeleid)', ['t-gemeten:700', 't-gemeten:1500', 't-afgeleid:1800', 't-gemeten:900', 't-gemeten:1400', 't-afgeleid:300'].every(x => azT.indexOf(x) >= 0), azT.join(' '));
  const azM = await p.evaluate(() => { const D = window.MTRuimteDossier, d = window.arProef.dossier(), k = d.details.find(x => x.soort === 'kozijn'); return D.metingenVan(d, k.id).map(m => m.veld + ':' + m.bron + ':' + m.waarde_mm); });
  check('wandaanzicht: vijf maten achter elkaar als X4-metingen in het dossier, in de goede velden', azM.join(' ') === 'afstand_tot_hoek:disto:700 opening_breedte:disto:1500 opening_hoogte:disto:1400 kozijn_onderkant:disto:900 diepte_tot_kozijn:disto:115', azM.join(' '));
  // een maat in de tekening aantikken en verbeteren
  await p.click('#d-paneel .aztek text[data-veld="opening_hoogte"]');
  check('maat aantikken in de tekening zet de invoerbalk op die maat, met de oude waarde', await p.evaluate(() => /Nismaat hoogte/.test(document.querySelector('.azlabel').textContent) && document.querySelector('#az-invoer').value === '1400'));
  await p.keyboard.type('1380', { delay: 220 });   /* met de hand: te langzaam voor de X4 */ await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const hist = await p.evaluate(() => { const D = window.MTRuimteDossier, d = window.arProef.dossier(), k = d.details.find(x => x.soort === 'kozijn'); return D.historie(d, k.id, 'opening_hoogte').map(m => m.waarde_mm + ':' + m.bron); });
  check('verbeterde maat: nieuwe meting (hand) erbij, de oude blijft in de historie', hist.length === 2 && hist.indexOf('1380:hand') >= 0 && hist.indexOf('1400:disto') >= 0, hist.join(' '));
  // stopcontact met opmerking, vanaf de rechterhoek
  await p.click('#az-plus-stopcontact'); await p.click('#az-hoek-rechts');
  await X4('400'); await X4('300');
  await p.fill('#az-opmerking', 'dubbel, randaarde'); await p.keyboard.press('Tab');
  // vensterbank via de lijst met alle onderdelen
  await p.selectOption('#az-meer', 'vensterbank');
  for (const val of ['650', '2250', '880']) await X4(val);
  // radiator toevoegen en weer weghalen (twee keer tikken; blijft in het archief)
  await p.click('#az-plus-radiator'); await p.click('#az-weg'); await p.click('#az-weg');
  await p.waitForTimeout(300);
  const its = await azIt(2), sc = its.find(x => x.soort === 'stopcontact'), vb = its.find(x => x.soort === 'vensterbank');
  check('stopcontact 400 van rechts op 300 hoog, met opmerking', !!sc && sc.punt.x === 3600 && sc.punt.y === 300 && sc.opmerking === 'dubbel, randaarde', JSON.stringify(sc));
  check('vensterbank van 650 tot 2250 met bovenkant 880', !!vb && vb.rect.x === 650 && vb.rect.w === 1600 && vb.rect.y + vb.rect.h === 880, JSON.stringify(vb));
  check('weggehaalde radiator staat niet meer op de wand maar wel in het dossier', !its.some(x => x.soort === 'radiator') && await p.evaluate(() => window.arProef.dossier().details.some(x => x.soort === 'radiator' && x.status === 'verwijderd' && x.verwijderd.reden)));
  // een onderdeel in de tekening aantikken
  const kozId = its.find(x => x.soort === 'kozijn').id;
  await p.click('#d-paneel .aztek rect.item[data-id="' + kozId + '"]', { position: { x: 12, y: 12 } });
  check('onderdeel aantikken in de tekening kiest het', await p.evaluate(() => /^Kozijn/.test(document.querySelector('.azlabel').textContent) && !!document.querySelector('#az-open-nis.aan')));
  await p.evaluate(() => document.querySelector('#d-paneel .azvast').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: path.join(UIT, 's24-09b-wandaanzicht-tekening.png') });
  await p.click('#az-sluit');
  // R1 uit de proef op W1: kader op de wand, 2440 × 1084 binnenwerks, 12 mm panelen, 5 mm voor de muur, 310 mm tot het kozijn, 3 vakken
  await p.evaluate(() => window.arProef.openAanzicht(window.arProef.dossier().wanden[0].id, null));
  await p.click('#az-plus-kozijn'); await p.click('#az-open-aftimmering-op-wand');
  for (const val of ['1200', '2440', '1084', '1000', '12', '5', '310']) await X4(val);
  await p.click('#az-vak-plus'); await p.click('#az-vak-plus');
  await p.click('#d-paneel .aztek text[data-vak="0"]'); await p.click('#az-functie-2');
  await p.click('#d-paneel .aztek text[data-vak="2"]'); await p.click('#az-functie-2');
  await p.click('#az-scharnier-rechts');
  await p.fill('#az-naam', 'R1'); await p.keyboard.press('Tab');
  await p.waitForTimeout(300);
  const r1 = await p.evaluate(() => ({ t: Array.from(document.querySelectorAll('#d-paneel .azvast svg text')).map(t => (t.getAttribute('class') || '') + ':' + t.textContent), ds: Array.from(document.querySelectorAll('#d-paneel .azdoorsnede svg text')).map(t => (t.getAttribute('class') || '') + ':' + t.textContent) }));
  check('R1 in het wandaanzicht: keten 1200 – 12 – 2440 – 12 – 336, binnenwerks 1084 hoog, drie vakken', ['t-gemeten:12', 't-gemeten:2440', 't-gemeten:1084', 't-gemeten:1200', 't-gemeten:1000', 'naam:R1'].every(x => r1.t.indexOf(x) >= 0) && r1.t.filter(x => /↗ buiten/.test(x)).length === 2 && r1.t.indexOf('t-afgeleid:336') >= 0 && r1.t.indexOf('t-afgeleid:492') >= 0 && r1.t.some(x => /:vast$/.test(x)), r1.t.join(' '));
  check('R1 doorsnede: 5 mm voor de muur en 310 tot het kozijn, als tikbare maten', r1.ds.indexOf('t-gemeten:5') >= 0 && r1.ds.indexOf('t-gemeten:310') >= 0 && await p.evaluate(() => document.querySelectorAll('#d-paneel .azdoorsnede [data-veld]').length >= 4), r1.ds.join(' '));
  check('R1: draairichting als driehoek, gestreept (naar buiten), punt naar de kruk', await p.evaluate(() => { const pl = Array.from(document.querySelectorAll('#d-paneel .azvast svg polyline.draai.weg')); return pl.length === 2 && pl[0].getAttribute('points') !== pl[1].getAttribute('points'); }));
  check('R1: alle verplichte maten ingevuld (geen oranje knoppen meer)', await p.evaluate(() => document.querySelectorAll('.azvelden button.open').length === 0 && document.querySelectorAll('.azvelden button').length === 8));
  await p.evaluate(() => document.querySelector('#d-paneel .azvast').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: path.join(UIT, 's24-10-kozijn-R1.png') });
  await p.evaluate(() => document.querySelector('.aztypes').scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: path.join(UIT, 's24-10b-kozijn-R1-opbouw.png') });
  await p.click('#az-sluit');
  // het overzicht: draadmodel met een rondje per wand; aantikken opent het wandaanzicht van die wand
  await p.evaluate(() => document.querySelector('#d-draad').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: path.join(UIT, 's24-10b-overzicht-draadmodel.png') });
  const w3id = await p.evaluate(() => window.arProef.dossier().wanden[2].id);
  const ovz = await p.evaluate(() => ({ bollen: document.querySelectorAll('#d-draad g.dmknop[data-wand]').length, wanden: window.arProef.dossier().wanden.length,
    knoppen: Array.from(document.querySelectorAll('#d-aanzichten button')).map(b => b.textContent).join(' | ') }));
  await p.click('#d-draad g.dmknop[data-wand="' + w3id + '"] circle.dmbol');
  const kopDm = await p.evaluate(() => document.querySelector('#d-paneel .azkop h2').textContent);
  check('overzicht: draadmodel met een rondje per wand en per wand wat open staat; aantikken opent die wand; de rest was ingeklapt', ingeklapt && ovz.bollen === ovz.wanden && /W1/.test(ovz.knoppen) && /Kamer/.test(ovz.knoppen) && /^W3 /.test(kopDm), JSON.stringify(ovz) + ' | ' + kopDm);
  await p.click('#az-sluit');
  // de kamer opengeklapt in het dossier: een wand aantikken opent die wand; in het wandscherm door naar de volgende wand
  await p.evaluate(() => document.querySelector('#d-uitslag').scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: path.join(UIT, 's24-11-kamer-opengeklapt.png') });
  const w2 = await p.evaluate(() => window.arProef.dossier().wanden[1].id);
  await p.click('#d-uitslag rect.wandraak[data-wand="' + w2 + '"]');
  const kopW2 = await p.evaluate(() => document.querySelector('#d-paneel .azkop h2').textContent);
  await p.click('#az-wand-volgende');
  const kopW3 = await p.evaluate(() => document.querySelector('#d-paneel .azkop h2').textContent);
  check('opengeklapte kamer: wand aantikken opent W2, daarna door naar W3', /^W2 /.test(kopW2) && /^W3 /.test(kopW3) && await p.evaluate(() => document.querySelectorAll('#d-uitslag [data-wand]').length >= 8), kopW2 + ' | ' + kopW3);
  await p.click('#az-sluit');
  // fase 2, snelkeuze (B37): één tik op de soort en het onderdeel staat op zijn geschatte plek in de werktekening; daarna variant kiezen in het wandscherm
  const snelId = await p.evaluate(() => { const D = window.MTRuimteDossier, d = window.arProef.dossier(), w = d.wanden[1];
    const det = D.voegDetailToe(d, { soort: 'overig', wand_id: w.id, referentie_hoek: w.van, anker: { wand_nr: 1, wand_id: w.id, u_m: 1.0, v_m: 0.3, xr: { x: 0, y: 0, z: 0 } } }); window.arProef.snelProef(det); return det.id; });
  await p.screenshot({ path: path.join(UIT, 's24-12-snelkeuze.png') });
  await p.click('#snel-stopcontact');
  await p.evaluate(() => { document.querySelector('#ar-laag').hidden = true; });
  const snel = await p.evaluate(id => { const D = window.MTRuimteDossier, d = window.arProef.dossier(), det = d.details.find(x => x.id === id), az = D.wandAanzicht(d, det.wand_id, window.arProef.AR), it = az.items.find(x => x.det.id === id);
    return { soort: det.soort, dicht: document.querySelector('#ar-detail').hidden, x: it && it.punt.x, y: it && it.punt.y, sx: it && it.punt.status.x, plaat: it && it.plaat, L: az.L }; }, snelId);
  check('snelkeuze: stopcontact staat met één tik op de wand, op de plek van de camera (geschat)', snel.soort === 'stopcontact' && snel.dicht && (snel.x === 1000 || snel.x === snel.L - 1000) && snel.y === 300 && snel.sx === 'geschat' && snel.plaat.w === 81, JSON.stringify(snel));
  await p.evaluate(id => window.arProef.openAanzicht(window.arProef.dossier().wanden[1].id, id), snelId);
  await p.click('#az-variant-dubbel'); await p.waitForTimeout(150);
  const vari = await p.evaluate(id => { const D = window.MTRuimteDossier, d = window.arProef.dossier(), det = d.details.find(x => x.id === id), it = D.wandAanzicht(d, det.wand_id, window.arProef.AR).items.find(x => x.det.id === id);
    return { variant: det.variant, plaat: it.plaat, tekst: Array.from(document.querySelectorAll('#d-paneel .aztek svg text')).map(t => t.textContent).join(' | '), archief: d.archief.filter(a => a.soort === 'detail' && a.detail.id === id).length }; }, snelId);
  check('variant: dubbel stopcontact, afdekplaat 152 × 81 op schaal, naam met 2× in de tekening; de wijziging staat in het archief', vari.variant === 'dubbel' && vari.plaat.w === 152 && /Stopcontact 2×/.test(vari.tekst) && vari.archief >= 2, JSON.stringify(vari));
  await p.screenshot({ path: path.join(UIT, 's24-13-stopcontact-variant.png') });
  await p.click('#az-sluit');
  // tekeningen en PDF rechtstreeks vanaf de telefoon (zelfde rapport als op kantoor)
  await p.click('#k-tekeningen'); await p.waitForSelector('#rapport .rp-pagina');
  const trp = await p.evaluate(() => ({ paginas: document.querySelectorAll('#rapport .rp-pagina').length, wanden: document.querySelectorAll('#rapport svg.aanzicht').length, koppen: Array.from(document.querySelectorAll('#rapport .rp-kop h2')).map(h => h.textContent).join(' | '),
    scharnier: document.querySelectorAll('#rapport svg.aanzicht rect.scharnier').length, contacten: document.querySelectorAll('#rapport svg.aanzicht circle.teken').length }));
  check('telefoon: Tekeningen / PDF toont kameruitslag, wandafwikkeling en een pagina per wand, met scharnierblokjes en stopcontact-tekens', trp.paginas === trp.wanden + 3 && /Kameruitslag \| Wandafwikkeling \| W1/.test(trp.koppen) && trp.scharnier >= 4 && trp.contacten >= 2, JSON.stringify(trp));
  await p.screenshot({ path: path.join(UIT, 's24-14-tekeningen-telefoon.png') });
  await p.pdf({ path: path.join(UIT, 's24-14-tekeningen-telefoon.pdf'), format: 'A4', landscape: true, printBackground: true });
  check('telefoon: afdrukken geeft een PDF', fs.statSync(path.join(UIT, 's24-14-tekeningen-telefoon.pdf')).size > 20000);
  await p.click('#rapport-dicht');
  // zonder gekozen onderdeel staan er geen onderdeelmaten in de wandtekening (rustig beeld); na aantikken wel
  await p.evaluate(() => window.arProef.openAanzicht(window.arProef.dossier().wanden[2].id, null));
  const rustig = await p.evaluate(() => ({ tik: document.querySelectorAll('#d-paneel .aztek [data-veld]').length, maten: Array.from(document.querySelectorAll('#d-paneel .aztek svg text')).filter(t => /^t-/.test(t.getAttribute('class') || '')).map(t => t.textContent), hint: document.querySelector('.azlabel').textContent }));
  check('wandscherm zonder keuze: alleen wandlengte en hoogte, met de aanwijzing om een onderdeel aan te tikken', rustig.tik === 0 && rustig.maten.filter(t => /^~?\d+$/.test(t)).length === 2 && /Tik een onderdeel/.test(rustig.hint), JSON.stringify(rustig));
  await p.click('#d-paneel .aztek rect.item[data-id="' + kozId + '"]', { position: { x: 12, y: 12 } });
  check('wandscherm na aantikken: de maten van dat onderdeel zijn actief, de andere onderdelen treden terug', await p.evaluate(() => document.querySelectorAll('#d-paneel .aztek [data-veld]').length >= 6 && document.querySelectorAll('#d-paneel .aztek .vaag').length >= 2));
  await p.screenshot({ path: path.join(UIT, 's24-15-wandscherm-gekozen.png') });
  await p.click('#az-sluit');
  const wm = await p.evaluate(() => { const D = window.MTRuimteDossier, d = window.arProef.dossier(); return d.wanden.map(w => D.huidigeMeting(d, w.id, 'lengte')).map(x => x && x.bron); });
  check('wandmaten: hand, X4, hand, X4 herkend', JSON.stringify(wm) === JSON.stringify(['hand', 'disto', 'hand', 'disto']), JSON.stringify(wm));
  // panorama plakken (maakt de wandbeelden en bewaart ze)
  await p.click('#k-plak');
  await p.waitForFunction(() => /bewaard/.test(document.querySelector('#pano-melding').textContent), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(UIT, 's24-04-panorama.png'), fullPage: true });
  // volle opslag nabootsen: één foto-opslag mislukt, de fout is zichtbaar, opnieuw proberen lukt zonder dubbel
  const volle = await p.evaluate(async () => {
    const O = window.MTOpnameOpslag, echt = O.zetFoto; let eenmaal = true;
    O.zetFoto = f => { if (eenmaal) { eenmaal = false; return Promise.reject(new Error('QuotaExceededError: opslag vol')); } return echt(f); };
    const d = window.arProef.dossier(), det = d.details[1];
    const c = document.createElement('canvas'); c.width = 40; c.height = 40; const blob = await new Promise(r => c.toBlob(r, 'image/jpeg'));
    const inp = document.querySelector('#d-foto'), dt = new DataTransfer(); dt.items.add(new File([blob], 'extra.jpg', { type: 'image/jpeg' })); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 400));
    const zichtbaar = !document.querySelector('#d-fout').hidden && /vol/.test(document.querySelector('#d-fout').textContent);
    document.querySelector('#k-opnieuw-bewaren').click();
    await new Promise(r => setTimeout(r, 800));
    O.zetFoto = echt;
    const fotos = await O.fotosVan(window.arProef.rec().id);
    return { zichtbaar, weg: document.querySelector('#d-fout').hidden, allesBewaard: d.beelden.every(b => b.bewaard), uniek: new Set(fotos.map(f => f.id)).size === fotos.length };
  });
  check('volle opslag: melding zichtbaar, opnieuw proberen lukt, geen dubbele foto', volle.zichtbaar && volle.weg && volle.allesBewaard && volle.uniek, JSON.stringify(volle));
  await p.click('#dp-klaar').catch(() => {});
  await p.evaluate(() => window.arProef.schrijfNu());
  await p.screenshot({ path: path.join(UIT, 's24-05-dossier.png'), fullPage: true });
  // pakket
  const pk = await p.evaluate(async () => { const x = await window.arProef.pakketMaken(); const ab = await x.blob.arrayBuffer(); return { naam: x.naam, bytes: Array.from(new Uint8Array(ab)), info: document.querySelector('#d-pakket-info').textContent }; });
  const zip = path.join(UIT, 'ruimte-proefpakket.zip'); fs.writeFileSync(zip, Buffer.from(pk.bytes));
  check('pakket gemaakt', pk.bytes.length > 100000, (pk.bytes.length / 1048576).toFixed(2) + ' MB · ' + pk.info);
  const duurRondgang = (Date.now() - t0) / 1000;
  // onderbreking: pagina opnieuw laden, de ruimte staat in de lijst en opent met alles erin
  await p.reload(); await p.waitForSelector('#r-lijst li');
  await p.screenshot({ path: path.join(UIT, 's24-06-na-herladen.png') });
  await p.click('#r-lijst li button'); await openBlokken();
  const terug = await p.evaluate(() => { const d = window.arProef.dossier(); return { hoeken: d.hoeken.length, det: d.details.length, mt: d.metingen.length, open: !document.querySelector('#s-dossier').hidden }; });
  check('na herladen: ruimte opent met hoeken, details en maten', terug.hoeken === 4 && terug.det >= 2 && terug.mt > 8 && terug.open, JSON.stringify(terug));
  // tabblad per ongeluk gesloten: na heropenen kan het plakken van de wanden opnieuw (beelden komen uit de opslag)
  await p.waitForSelector('#s-pano:not([hidden])', { timeout: 15000 });
  await p.click('#k-plak');
  await p.waitForFunction(() => /bewaard/.test(document.querySelector('#pano-melding').textContent), null, { timeout: 30000 });
  check('na heropenen: wanden opnieuw te plakken uit de bewaarde beelden', true);
  check('geen fouten in de console (S24-pagina)', fouten.length === 0, fouten.join(' | '));

  // ── kantoor-pc: de kijker ──
  const pc = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const k = await pc.newPage(); const kf = []; k.on('pageerror', e => kf.push(e.message)); k.on('console', x => { if (x.type() === 'error') kf.push(x.text()); });
  await k.goto(BASIS + 'opname-ar-kijk.html');
  const tOpen = Date.now();
  await k.setInputFiles('#bestand', zip);
  await k.waitForFunction(() => window.kijkProef.dossier() && document.querySelector('#laden').hidden, null, { timeout: 20000 });
  await k.waitForTimeout(500);
  const openSec = (Date.now() - tOpen) / 1000;
  check('kantoor: pakket opent', true, openSec.toFixed(2) + ' s');
  await k.screenshot({ path: path.join(UIT, 'pc-01-geopend.png') });
  // slepen = rondkijken, scrollen = zoom
  const yaw0 = await k.evaluate(() => window.kijkProef.cam.yaw);
  await k.mouse.move(700, 450); await k.mouse.down(); await k.mouse.move(500, 420, { steps: 8 }); await k.mouse.up();
  const yaw1 = await k.evaluate(() => window.kijkProef.cam.yaw);
  check('slepen draait de kijkrichting', Math.abs(yaw1 - yaw0) > 0.3, (yaw1 - yaw0).toFixed(2));
  await k.mouse.wheel(0, -400); await k.waitForTimeout(100);
  const zoom = await k.evaluate(() => window.kijkProef.cam.zoom);
  check('scrollen zoomt in', zoom > 1.05, zoom.toFixed(2));
  // draai naar W3 (raam, radiator, leiding) en open de leiding
  await k.evaluate(() => { const c = window.kijkProef.cam; c.zoom = 1; c.x = 2; c.z = 1.2; c.yaw = Math.PI; c.pitch = -0.25; window.kijkProef.teken(); });
  await k.waitForTimeout(200);
  await k.screenshot({ path: path.join(UIT, 'pc-02-raam-radiator.png') });
  const merk = await k.$('.merk.installatie');
  check('leiding als markering in beeld', !!merk);
  const camVoor = await k.evaluate(() => JSON.stringify([window.kijkProef.cam.yaw, window.kijkProef.cam.pitch, window.kijkProef.cam.x]));
  await k.click('button.merk.installatie >> nth=0');
  await k.waitForSelector('#paneel table');
  await k.waitForTimeout(400);
  const tekst = await k.textContent('#paneel');
  check('detailpaneel: maten met bron en status', /262 mm/.test(tekst) && /DISTO X4/.test(tekst) && /1550 mm/.test(tekst) && /Handmaat/.test(tekst) && /Open/.test(tekst), tekst.slice(0, 200));
  check('detailpaneel: opmerking en open vraag', /12 mm hoger/.test(tekst) && /uitsteek/.test(tekst));
  check('detailpaneel: plek in mm uit het lijnmodel', /Plek in de ruimte: x/.test(tekst));
  await k.screenshot({ path: path.join(UIT, 'pc-03-leiding-paneel.png') });
  await k.click('#paneel img');
  await k.waitForSelector('#foto:not([hidden])');
  await k.screenshot({ path: path.join(UIT, 'pc-04-detailfoto.png') });
  await k.click('#k-foto-dicht'); await k.click('#paneel .knop');
  const camNa = await k.evaluate(() => JSON.stringify([window.kijkProef.cam.yaw, window.kijkProef.cam.pitch, window.kijkProef.cam.x]));
  check('detail en foto openen en sluiten op dezelfde kijkrichting', camVoor === camNa);
  // ander kijkpunt: achter het obstakel
  const kp = await k.evaluate(() => window.kijkProef.kijkpunten().map(q => [q.x.toFixed(1), q.z.toFixed(1), q.n]));
  check('vier kijkpunten herkend (drie rondgang, één wandfoto)', kp.length === 4, JSON.stringify(kp));
  await k.evaluate(() => { const c = window.kijkProef.cam; c.x = 2.9; c.z = 1.4; c.yaw = -Math.PI / 2 - 0.3; c.pitch = -0.3; window.kijkProef.teken(); });
  await k.waitForTimeout(150);
  const kpKnop = await k.$('.merk.kijkpunt:not([hidden])');
  if (kpKnop) { await kpKnop.click(); await k.waitForTimeout(150); }
  const posNa = await k.evaluate(() => [window.kijkProef.cam.x, window.kijkProef.cam.z]);
  check('kijkpunt in beeld aanklikken verplaatst de kijker', !!kpKnop && Math.hypot(posNa[0] - 2.9, posNa[1] - 1.4) > 0.5, JSON.stringify(posNa));
  await k.screenshot({ path: path.join(UIT, 'pc-05-ander-kijkpunt.png') });
  await k.click('#k-dossier'); await k.waitForTimeout(200);
  const dt = await k.textContent('#paneel');
  check('dossierpaneel: lijnmodel met gemeten wanden en controlemaat', /Lijnmodel/.test(dt) && /Gemeten/.test(dt) && /Controlemaat H1–H3/.test(dt), dt.slice(0, 160));
  await k.screenshot({ path: path.join(UIT, 'pc-06-dossier.png') });
  // tekeningen op kantoor: kameruitslag, wandafwikkeling, een pagina per wand, afdrukbaar (zelfde tekenmodule als de telefoon, lijnmodel uit het pakket)
  await k.click('#k-tekening'); await k.waitForSelector('#rapport .rp-pagina');
  const rp = await k.evaluate(() => ({ paginas: document.querySelectorAll('#rapport .rp-pagina').length, koppen: Array.from(document.querySelectorAll('#rapport .rp-kop h2')).map(h => h.textContent),
    uitslagWanden: document.querySelectorAll('#rapport svg.uitslag g[data-wand]').length, afw: document.querySelectorAll('#rapport svg.afwikkeling g[data-wand]').length,
    teksten: Array.from(document.querySelectorAll('#rapport svg.aanzicht text')).map(t => t.textContent), tikbaar: document.querySelectorAll('#rapport svg.aanzicht [data-veld]').length, tabellen: document.querySelectorAll('#rapport table').length }));
  const nW = await k.evaluate(() => document.querySelectorAll('#rapport svg.aanzicht').length);
  check('kantoor: tekeningen met kameruitslag, wandafwikkeling en een pagina per wand', rp.paginas === nW + 3 && /uitslag|Plattegrond/i.test(rp.koppen[0]) && rp.koppen[1] === 'Wandafwikkeling' && rp.afw === nW && rp.tabellen >= 2 && rp.tikbaar === 0, JSON.stringify({ p: rp.paginas, k: rp.koppen, u: rp.uitslagWanden, a: rp.afw, n: nW }));
  check('kantoor: de maten uit het pakket staan in de wandtekeningen', rp.teksten.some(t => /^\d{3,4}$/.test(t)) && rp.teksten.length > 10, rp.teksten.slice(0, 30).join(' '));
  await k.screenshot({ path: path.join(UIT, 'pc-07-tekeningen.png') });
  await k.pdf({ path: path.join(UIT, 'pc-07-tekeningen.pdf'), format: 'A4', landscape: true, printBackground: true });
  check('kantoor: afdrukken geeft een PDF', fs.statSync(path.join(UIT, 'pc-07-tekeningen.pdf')).size > 20000);
  await k.click('#rapport-dicht');
  check('kantoor: tekeningen sluiten, rondkijken is terug', await k.evaluate(() => document.querySelector('#rapport').hidden && !document.body.classList.contains('rapport-open')));
  check('geen fouten in de console (kijker)', kf.length === 0, kf.join(' | '));
  // telefoon: dezelfde kijker vanaf de telefoon zelf (#ruimte=)
  const recId = await p.evaluate(() => window.arProef.rec().id);
  const kijkUrl = new URL('opname-ar-kijk.html', BASIS); kijkUrl.hash = new URLSearchParams({ ruimte: recId }).toString();
  const k2 = await tel.newPage(); await k2.goto(kijkUrl.href);
  await k2.waitForFunction(() => window.kijkProef.dossier(), null, { timeout: 15000 }); await k2.waitForTimeout(400);
  await k2.screenshot({ path: path.join(UIT, 's24-07-rondkijken-telefoon.png') });
  check('rondkijken op de telefoon zelf (zelfde opslag)', true);
  fs.writeFileSync(path.join(UIT, 'uitslag.txt'), log.join('\n') + '\n\nduur nagebootste rondgang: ' + duurRondgang.toFixed(1) + ' s\nopentijd pakket op pc: ' + openSec.toFixed(2) + ' s\npakket: ' + pk.info + '\n');
  await browser.close();
})().catch(e => { console.error(e); process.exitCode = 1; });

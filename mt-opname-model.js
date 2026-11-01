// mt-opname-model.js — het hoofdscherm van de nieuwe opname (brok 2): het super simpele 3D-draadmodel van de ruimte (eigen SVG-projectie, draaibaar met één vinger) en het
// wandscherm met de foto en de lijnenoverlay waarop de maten één voor één worden ingevuld. De actieve maatlijn is rood; invullen en op de pijl volgende gaat naar de volgende lijn.
// De wandlijnen komen uit mt-opname-geo.js (homografie van de vier getikte wandhoeken); welke maten gevraagd worden en in welke volgorde bepaalt alleen de kern (route).
// Geen automatische beeldherkenning: wat op de foto staat hebben de hoeken en tikken van de opnemer bepaald, de getallen komen uit de invoer.
(function (root) {
  'use strict';
  const M = root.MTOpname, X = M.X, K = X.K, G = X.G, h = X.h, sv = X.sv, S = X.S, COL = X.COL, lijst = X.lijst, SCHERMEN = X.schermen;
  const vragenMap = () => new Map(K.vragen(X.ruimte()).map(v => [v.pad, v]));
  const kleurVan = (staat, conflict, optioneel) => conflict ? COL.conflict : staat === 'gemeten' ? COL.donker : staat === 'later' ? COL.oranje : staat === 'nvt' ? COL.grijs : optioneel ? '#a7aca6' : COL.rood;
  const GROEPEN = { basis: 'Basis', werkzone: 'Werkzone', extra: 'Extra', optie: 'Optioneel', foto: 'Foto', rondje: 'Rondje' };

  // ── Naar een stap gaan (vanuit het model, afronden of een lijn) ──
  async function laadWandFoto(w) {
    const rec = X.wandFotoRec(w); S.wandFoto = null;
    if (!rec) return;
    const url = await X.fotoUrl(rec.id); if (!url) return;
    let pw = rec.breedte, ph = rec.hoogte;
    if (!(pw > 0 && ph > 0)) { const d = await new Promise(ok => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok({ w: 0, h: 0 }); i.src = url; }); pw = d.w; ph = d.h; }
    if (pw > 0 && ph > 0) S.wandFoto = { id: rec.id, url, w: pw, h: ph };
  }
  X.openWand = async function (w, stapId, itemId) {
    await laadWandFoto(w);
    S.kal = null; S.plaats = null; S.itemSheet = itemId || null;
    X.ga('wand', { wand: w, stapId: stapId || null, wandKlaar: false });
  };
  X.naarStap = function (st) {
    if (!st) return;
    if (st.type === 'foto') { S.fotoWand = st.wand; X.ga('fotos'); return; }
    if (st.type === 'rondje') { X.ga('rondje'); return; }
    if (st.wand) { X.openWand(st.wand, st.id); return; }
    X.ga('model', { modelStap: st.id });
  };

  // ── Het ene paneel waar een maat wordt ingevuld (wandscherm en ruimte-maten op het model) ──
  const leesMm = t => {
    let s = String(t == null ? '' : t).trim().replace(/\s|mm$/gi, '');
    if (!s) return { fout: 'Vul eerst een maat in, of kies n.v.t. of later.' };
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return { fout: 'Dit is geen getal. Vul de maat in millimeters in, bijvoorbeeld 5760.' };
    const v = parseFloat(s);
    if (!(v > 0)) return { fout: 'Een maat is groter dan 0 mm.' };          // geen vaste ondergrens: een voeg of plintdikte kan klein zijn; onwaarschijnlijke maten vraagt de kern vóór het vrijgeven te bevestigen
    if (v > 99999) return { fout: 'Deze maat is te groot voor een ruimte (maximaal 99999 mm).' };
    return { v };
  };
  X.leesMm = leesMm;
  function bewaarMaat(stap, invoer) {
    if (!X.wijzig(K.zetMaat(S.rec.opname, X.ruimte().id, stap.pad, invoer))) return false;
    const w = K.waarschuwingen(X.ruimte()).find(x => x.code === 'onwaarschijnlijk' && x.pad === stap.pad && !x.bevestigd);
    if (w) X.toast(w.tekst + ' Bevestig het bij Afronden of meet opnieuw.');
    return true;
  }

  function paneel(stap, o) {
    const r = X.ruimte(), vm = vragenMap(), vr = vm.get(stap.pad) || null, maat = vr && vr.maat;
    const p = h('div', { class: 'opn-paneel' });
    const fout = h('p', { class: 'opn-fouttekst', role: 'alert', hidden: true });
    const meld = t => { fout.textContent = t; fout.hidden = !t; };
    p.appendChild(h('div', { class: 'opn-paneel-kop' },
      h('span', { class: 'opn-stapnr', text: o.teller || stap.stap }),
      h('span', { class: 'opn-groeppil opn-groep-' + stap.groep, text: GROEPEN[stap.groep] || '' }),
      stap.staat !== 'open' ? h('span', { class: 'opn-staatpil opn-staat-' + stap.staat, text: stap.staat === 'gemeten' ? 'gemeten' : stap.staat === 'nvt' ? 'n.v.t.' : 'later' }) : null));
    p.appendChild(h('div', { class: 'opn-vraag', text: stap.vraag }));
    if (stap.definitie) p.appendChild(h('div', { class: 'opn-def', text: 'Meet de ' + (K.DEFINITIES[stap.definitie] || stap.definitie) }));
    if (stap.uitleg) p.appendChild(h('details', { class: 'opn-uitleg-d' }, h('summary', { text: 'Hoe meet ik dit?' }), h('p', { text: stap.uitleg })));
    if (vr && vr.conflict) p.appendChild(h('p', { class: 'opn-waarschuwing', text: 'Deze maat past niet bij de rest van de ruimte. Controleer hem opnieuw (zie Afronden).' }));
    // een opening heeft eerst een definitie nodig: zonder weet je niet welke maat je meet
    if (stap.soort === 'opening' && stap.object) {
      const op = lijst(r.openingen).find(x => x.id === stap.object);
      if (op && !K.DEFINITIES[op.definitie]) {
        p.appendChild(h('div', { class: 'opn-veld' }, h('div', { class: 'opn-label', text: 'Wat meet je bij ' + (op.naam || op.id) + '?' }), definitieChips(op)));
      }
    }
    // een plint die gelijk is aan de plint van de hele kamer: één tik "klopt"; afwijken per wand kan via Wijzigen
    const pl = S.rec.instellingen && S.rec.instellingen.plint, sl = String(stap.pad || '').split('.').pop();
    if (stap.soort === 'plint' && pl && !pl.geen && maat && maat.staat === 'gemeten' && S.plintWijzig !== stap.id && pl[sl] != null && (maat.keuze ? maat.keuze === pl[sl] : Number(maat.waarde) === Number(pl[sl]))) {
      p.appendChild(h('div', { class: 'opn-plint-gelijk' }, h('div', { class: 'opn-kaart-titel', text: 'Zelfde als de hele kamer: ' + (maat.keuze ? keuzeTekst(maat.keuze) : X.mm(maat.waarde) + ' mm') }), h('p', { class: 'opn-hint', text: 'Deze wand heeft dezelfde plint als de rest van de kamer. Wijkt hij hier af, pas hem dan voor alleen deze wand aan.' })));
      p.appendChild(h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-btn opn-btn-primair opn-btn-klein', text: 'Klopt, verder', onclick: () => o.volgende(stap) }),
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Wijzigen voor deze wand', onclick: () => { S.plintWijzig = stap.id; X.teken(); } })));
      return p;
    }
    // ── soort invoer ──
    if (stap.type === 'bijzonderheden') { p.appendChild(bijzonderhedenInvoer(stap, o)); return p; }
    if (stap.eenheid === 'keuze') {
      const chips = h('div', { class: 'opn-chips' });
      for (const k of lijst(stap.keuzes)) chips.appendChild(h('button', { type: 'button', class: 'opn-chip opn-chip-groot' + (maat && maat.staat === 'gemeten' && maat.keuze === k ? ' is-aan' : ''), onclick: () => { if (bewaarMaat(stap, { staat: 'gemeten', keuze: k, bron: 'hand' })) o.volgende(stap); } }, keuzeTekst(k, stap)));
      for (const k of lijst(stap.nvt_keuzes)) chips.appendChild(h('button', { type: 'button', class: 'opn-chip opn-chip-groot' + (maat && maat.staat === 'nvt' && maat.keuze === k ? ' is-aan' : ''), onclick: () => { if (bewaarMaat(stap, { staat: 'nvt', keuze: k })) o.volgende(stap); } }, keuzeTekst(k, stap)));
      p.appendChild(chips);
      p.appendChild(onderrij(stap, o, null, meld, true));
      p.appendChild(fout); return p;
    }
    // millimeters
    const huidig = maat && maat.staat === 'gemeten' && maat.waarde != null ? X.mm(maat.waarde) : '';
    if (vr && vr.voorstel && vr.voorstel.schatting_mm) { const vs = vr.voorstel, mmTxt = X.mm(vs.schatting_mm) + ' mm' + (vs.onzekerheid_mm ? ' (± ' + X.mm(vs.onzekerheid_mm) + ')' : '');
      p.appendChild(h('p', { class: 'opn-voorstel', text: (vs.bron === 'bronstandaard' ? 'Bronstandaard: ' + mmTxt + '. Een algemene startwaarde, niet uit de foto.' : vs.bron === 'foto-interpretatie' ? 'Foto-interpretatie: ongeveer ' + mmTxt + '. De voorkant van een uitsprong staat voor het wandvlak, dus de verhouding op de foto kan afwijken.' : 'Schatting uit de foto: ' + mmTxt + '.') + ' Dit is geen meting.' })); }
    const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'opn-groot-veld', placeholder: '', autocomplete: 'off', enterkeyhint: 'next', 'aria-label': stap.label + ' in millimeter', value: huidig });
    const doe = () => {
      const l = leesMm(inp.value); if (l.fout) { meld(l.fout); inp.focus(); return; }
      meld('');
      if (maat && maat.staat === 'gemeten' && Number(maat.waarde) === l.v) { o.volgende(stap); return; }          // ongewijzigd: niets opnieuw vastleggen
      if (bewaarMaat(stap, { staat: 'gemeten', waarde: l.v, bron: 'hand' })) o.volgende(stap);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doe(); } });
    inp.addEventListener('focus', () => setTimeout(() => { try { inp.scrollIntoView({ block: 'center' }); } catch (e) {} }, 80));
    p.appendChild(h('div', { class: 'opn-invoerrij' }, inp, h('span', { class: 'opn-eenheid', text: 'mm' }), h('button', { type: 'button', class: 'opn-pijlknop', 'aria-label': 'Volgende', onclick: doe }, '→')));
    p.appendChild(fout);
    p.appendChild(onderrij(stap, o, inp, meld, false));
    if (o.focus !== false && !huidig) setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
    return p;
  }
  const keuzeTekst = (k, stap) => ({ bekeken: 'Gehele wand bekeken, niets in de weg', afgedekt: 'Afgedekt', 'niet-beoordeeld': 'Niet beoordeeld', vrij: 'Vrij', beperkt: 'Beperkt', geblokkeerd: 'Geblokkeerd', blijft: 'Plint blijft', 'gaat-weg': 'Plint gaat weg' })[k] || k;
  function onderrij(stap, o, inp, meld, keuze) {
    const rij = h('div', { class: 'opn-onderrij' });
    rij.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein', disabled: !o.vorige, onclick: () => o.vorige && o.vorige(stap) }, '‹ Vorige'));
    if (!keuze) rij.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: () => { if (bewaarMaat(stap, { staat: 'nvt' })) o.volgende(stap); } }, 'Niet van toepassing'));
    rij.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: () => { if (bewaarMaat(stap, { staat: 'later', notitie: o.notitie ? o.notitie() : undefined })) o.volgende(stap); } }, 'Later meten'));
    if (stap.optioneel) rij.appendChild(h('span', { class: 'opn-hint', text: 'Optioneel' }));
    return h('div', null, rij, h('p', { class: 'opn-hint', text: 'Niet van toepassing legt vast dat deze maat voor dit project niet nodig is. Later meten wordt een nameten-taak.' }));
  }
  function definitieChips(op) {
    return h('div', { class: 'opn-chips' }, ...Object.keys(K.DEFINITIES).map(d => h('button', { type: 'button', class: 'opn-chip' + (op.definitie === d ? ' is-aan' : ''), 'aria-pressed': op.definitie === d ? 'true' : 'false', onclick: () => { if (X.wijzig(K.zetDefinitie(S.rec.opname, X.ruimte().id, op.id, d))) X.teken(); } }, K.DEFINITIES[d])));
  }
  // Bijzonderheden op een wand: de gewone uitkomst "niets bijzonders" staat bovenaan (één tik); alleen bij "er is iets" komen de soorten in beeld.
  function bijzonderhedenInvoer(stap, o) {
    const r = X.ruimte(), w = stap.wand, v = h('div', { class: 'opn-bijz' });
    const bestaand = lijst(r.bijzonderheden).filter(b => b.wand === w);
    let uit = bestaand.length > 0, gekozen = null, notitie = '';
    for (const b of bestaand) v.appendChild(h('div', { class: 'opn-lijstrij opn-lijstrij-vast' }, h('span', { text: (K.BIJZONDERHEDEN[b.soort] || b.soort) + (b.notitie ? ': ' + b.notitie : '') }),
      h('button', { type: 'button', class: 'opn-link', text: 'Weghalen', onclick: () => { if (X.wijzig(K.verwijderItem(S.rec.opname, r.id, 'bijzonderheden', b.id))) X.teken(); } })));
    const vorm = h('div', { class: 'opn-bijz-vorm' });
    const chips = h('div', { class: 'opn-chips' });
    const voegKn = h('button', { type: 'button', class: 'opn-btn opn-btn-primair', disabled: true, text: 'Noteer bijzonderheid', onclick: () => {
      const res = K.voegBijzonderheidToe(S.rec.opname, r.id, { soort: gekozen, wand: w, notitie: notitie.trim() || undefined });
      if (X.wijzig(res)) { X.zetRondje(w, 'afw', 'aanwezig'); X.toast('Bijzonderheid genoteerd. Meten mag, noemen volstaat.'); X.teken(); }
    } });
    const bouw = () => { X.leeg(chips); for (const k of Object.keys(K.BIJZONDERHEDEN)) chips.appendChild(h('button', { type: 'button', class: 'opn-chip' + (gekozen === k ? ' is-aan' : ''), 'aria-pressed': gekozen === k ? 'true' : 'false', onclick: () => { gekozen = k; bouw(); voegKn.disabled = false; } }, K.BIJZONDERHEDEN[k])); };
    const nt = h('input', { type: 'text', class: 'opn-input', placeholder: 'Wat is het, en waar op de wand?', 'aria-label': 'Omschrijving van de bijzonderheid', oninput: e => { notitie = e.target.value; } });
    bouw(); vorm.appendChild(chips); vorm.appendChild(nt); vorm.appendChild(voegKn); vorm.hidden = !uit;
    v.appendChild(h('div', { class: 'opn-onderrij' },
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', style: { flex: '1' }, text: 'Niets bijzonders', onclick: () => { if (X.zetRondje(w, 'afw', 'afwezig')) o.volgende(stap); } }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot', style: { flex: '1' }, 'aria-expanded': uit ? 'true' : 'false', text: 'Er zit iets', onclick: ev => { vorm.hidden = !vorm.hidden; ev.currentTarget.setAttribute('aria-expanded', vorm.hidden ? 'false' : 'true'); } })));
    v.appendChild(vorm);
    v.appendChild(h('div', { class: 'opn-onderrij' },
      h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Later bekijken', onclick: () => { if (X.zetRondje(w, 'afw', 'later')) o.volgende(stap); } }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-klein', disabled: !o.vorige, onclick: () => o.vorige && o.vorige(stap) }, '\u2039 Vorige')));
    if (bestaand.length && stap.staat !== 'open') v.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Klaar met deze wand', onclick: () => o.volgende(stap) }));
    return v;
  }

  // ── Plint: één keer voor de hele kamer (alleen op de werkzone-wanden), per wand afwijken via Wijzigen ──
  function plintSheet() {
    const r = X.ruimte(), cur = (S.rec.instellingen && S.rec.instellingen.plint) || {}, waarden = { hoogte: cur.hoogte ? String(cur.hoogte) : '', dikte: cur.dikte ? String(cur.dikte) : '', keuze: cur.keuze || null };
    const fout = h('p', { class: 'opn-fouttekst', role: 'alert', hidden: true });
    const chips = h('div', { class: 'opn-chips' });
    const bouw = () => { X.leeg(chips); for (const k of ['blijft', 'gaat-weg']) chips.appendChild(h('button', { type: 'button', class: 'opn-chip' + (waarden.keuze === k ? ' is-aan' : ''), onclick: () => { waarden.keuze = waarden.keuze === k ? null : k; bouw(); } }, keuzeTekst(k))); };
    bouw();
    const veld = (naam, sleutel) => h('div', { class: 'opn-veld' }, h('label', { class: 'opn-label', text: naam }), h('input', { type: 'text', inputmode: 'decimal', class: 'opn-input', placeholder: 'mm', value: waarden[sleutel], oninput: e => { waarden[sleutel] = e.target.value; } }));
    X.blad('Plint in de hele kamer', [
      h('p', { class: 'opn-hint', text: 'Meestal is de plint overal in de kamer gelijk. Vul het één keer in; het geldt voor alle werkzone-wanden. Wijkt één wand af, dan pas je die aan bij die wand (Wijzigen).' }),
      veld('Plinthoogte', 'hoogte'), veld('Plintdikte (hoever steekt hij uit?)', 'dikte'),
      h('div', { class: 'opn-veld' }, h('div', { class: 'opn-label', text: 'Blijft de plint zitten bij het nieuwe meubel?' }), chips), fout,
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Toepassen op de werkzone', onclick: () => {
        const hh = waarden.hoogte.trim() ? leesMm(waarden.hoogte) : null, dd = waarden.dikte.trim() ? leesMm(waarden.dikte) : null;
        if ((hh && hh.fout) || (dd && dd.fout)) { fout.textContent = (hh && hh.fout) || (dd && dd.fout); fout.hidden = false; return; }
        if (!hh) { fout.textContent = 'Vul minstens de plinthoogte in.'; fout.hidden = false; return; }
        pasPlintToe({ hoogte: hh.v, dikte: dd ? dd.v : null, keuze: waarden.keuze }); X.sluitBlad();
      } }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Er is geen plint in deze kamer', onclick: () => { S.rec.instellingen = S.rec.instellingen || {}; S.rec.instellingen.plint = { geen: true }; X.bewaar(); X.sluitBlad(); X.teken(); } })]);
  }
  function pasPlintToe(n) {
    const rid = X.ruimte().id, oud = (S.rec.instellingen && S.rec.instellingen.plint) || {};
    for (const w of K.wandIds(X.ruimte()).filter(x => lijst(X.ruimte().werkzone).includes(x))) {
      let pl = lijst(X.ruimte().objecten).find(x => x.type === 'plint' && x.wand === w);
      if (!pl) { const res = K.voegObjectToe(S.rec.opname, rid, { type: 'plint', wand: w }); if (!X.wijzig(res)) return; pl = { id: res.id }; }
      const huidig = lijst(X.ruimte().objecten).find(x => x.id === pl.id) || pl;
      const zet = (sleutel, waarde, keuze) => {
        const m = huidig.maten && huidig.maten[sleutel], gemeten = m && K.waarde(m) != null, zelfde = gemeten && (keuze ? m.keuze === oud[sleutel] : m.waarde === oud[sleutel]);
        if (waarde == null || (gemeten && !zelfde && !(m.keuze || m.waarde == null))) return;          // een wand die afwijkt blijft zoals hij is
        const pad = 'objecten.' + pl.id + '.maten.' + sleutel;
        X.wijzig(K.zetMaat(S.rec.opname, rid, pad, keuze ? { staat: 'gemeten', keuze: waarde, bron: 'hand' } : { staat: 'gemeten', waarde, bron: 'hand' }));
      };
      zet('hoogte', n.hoogte); zet('dikte', n.dikte); zet('keuze', n.keuze, true);
    }
    S.rec.instellingen = S.rec.instellingen || {}; S.rec.instellingen.plint = { hoogte: n.hoogte, dikte: n.dikte, keuze: n.keuze, tijd: X.nu() };
    X.bewaar(); X.toast('Plint ' + X.mm(n.hoogte) + ' mm ingesteld voor de werkzone.'); X.teken();
  }

  // ── Onderblad (sheet) ──
  X.sluitBlad = () => { const b = S.el && S.el.querySelector('.opn-blad-bg'); if (b) b.remove(); };
  X.blad = function (titel, kids) {
    X.sluitBlad();
    const c = S.el.querySelector('.opn-scherm');
    const bg = h('div', { class: 'opn-blad-bg', onclick: ev => { if (ev.target === bg) bg.remove(); } },
      h('div', { class: 'opn-blad', role: 'dialog', 'aria-label': titel },
        h('div', { class: 'opn-blad-kop' }, h('div', { class: 'opn-kaart-titel', text: titel }), h('button', { type: 'button', class: 'opn-sluit', 'aria-label': 'Sluiten', onclick: () => bg.remove() }, '×')),
        ...kids));
    c.appendChild(bg); return bg;
  };

  // ════════════════════════ Scherm: het draadmodel ════════════════════════
  const VB = { w: 390, h: 340 };
  // Werkzone: de wand(en) waar het meubel komt; aantikken in het model of op de plattegrond (meerdere mag)
  function zetWerkzone(w) {
    const r = X.ruimte(), nu = lijst(r.werkzone), nieuw = nu.includes(w) ? nu.filter(x => x !== w) : nu.concat([w]);
    if (X.wijzig(K.zetRuimte(S.rec.opname, r.id, { werkzone: nieuw }))) X.teken();
  }
  SCHERMEN.model = function (c) {
    const r = X.ruimte(), rt = X.route(), vg = X.voortgang(), vm = vragenMap(), kamer = G.kamer(r), lay = S.rec.layout && S.rec.layout[r.id] || {}, ids = kamer.volgorde, kiezen = !!S.werkzoneKiezen, zone = lijst(r.werkzone);
    c.appendChild(X.kop(r.naam, vg.klaar + ' van ' + vg.n + ' maten gemeten', { terugLabel: 'Naar de lijst', rechts: h('button', { type: 'button', class: 'opn-kopknop', onclick: () => X.ga('afronden') }, 'Afronden') }));
    const body = h('div', { class: 'opn-body opn-body-model' });
    body.appendChild(h('div', { class: 'opn-voortgang', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(vg.n), 'aria-valuenow': String(vg.klaar) }, h('span', { style: { width: vg.pct + '%' } })));
    const uitleg = [];
    if (kamer.vormStatus === 'inconsistent') uitleg.push('De metingen sluiten niet op elkaar (zie Afronden): de vorm blijft een schatting.');
    else if (kamer.vormBepaling === 'bepaald') uitleg.push(kamer.vormLabel + '.' + (kamer.vormVolgende ? ' ' + kamer.vormVolgende.tekst : ''));
    else if (kamer.vormBepaling === 'getekend' && kamer.vormStatus === 'onverifieerd') uitleg.push(kamer.vormLabel + ': de hoeken zijn aangenomen (90 of 270 graden) en dat bewijst een lengte of één diagonaal niet. ' + (kamer.vormVolgende ? kamer.vormVolgende.tekst : 'Bevestig de hoeken.') + ' Tot dan blijft de vorm gestippeld.');
    else if (kamer.vormGeschat) uitleg.push(ids.length === 4 ? 'Gestippeld is een schatting: de vorm klopt pas als de vier wanden en een diagonaal gemeten zijn.' : 'Gestippeld is een schatting: de vorm wordt vast naarmate je de wanden meet.');
    if (kamer.hoogteGeschat) uitleg.push('De hoogte is nog een schatting: meet het plafond.');
    if (uitleg.length) body.appendChild(h('p', { class: 'opn-schatting', text: uitleg.join(' ') }));
    const modellen = {}; for (const w of ids) modellen[w] = G.wandModel(r, w, kamer, lay[w]);
    const status = {}; for (const w of ids) { const st = rt.stappen.filter(s => s.wand === w && !s.optioneel && s.type !== 'foto' && s.type !== 'rondje'); status[w] = { n: st.length, klaar: st.filter(s => s.afgehandeld).length, open: st.filter(s => !s.afgehandeld).length, later: st.filter(s => s.staat === 'later').length }; }
    // werkzone kiezen: de uitnodiging staat bovenaan, zodat het meubel eerst een plek krijgt
    if (kiezen) body.appendChild(h('div', { class: 'opn-kaart opn-kies' }, h('div', { class: 'opn-kaart-titel', text: 'Waar komt het meubel?' }),
      h('p', { text: 'Tik de wand(en) aan waar het meubel komt, in het model of op de plattegrond. Meerdere mag. Daar vraagt de app alle maten; de andere wanden alleen het nodige voor de plattegrond.' }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', disabled: !zone.length, text: zone.length ? 'Klaar: ' + zone.map(w => K.wandNaam(w).toLowerCase()).join(', ') : 'Kies minstens één wand', onclick: () => { S.werkzoneKiezen = false; X.teken(); } })));
    const svg = sv('svg', { viewBox: '0 0 ' + VB.w + ' ' + VB.h, class: 'opn-model-svg', role: 'group', 'aria-label': 'Draadmodel van de ruimte. Sleep om te draaien, tik op een wand om ' + (kiezen ? 'de werkzone te kiezen.' : 'te meten.') });
    const teken = () => tekenModel(svg, { r, rt, vm, kamer, modellen, status, kiezen });
    teken();
    koppelDraaien(svg, teken);
    body.appendChild(h('div', { class: 'opn-model-vak' }, svg,
      h('button', { type: 'button', class: 'opn-reset', 'aria-label': 'Weer recht zetten', onclick: () => { S.cam = { yaw: -28, pitch: 30 }; teken(); } }, '↺')));
    body.appendChild(h('div', { class: 'opn-legenda' },
      leg(COL.rood, 'nog te meten'), leg(COL.donker, 'gemeten'), leg(COL.oranje, 'later'), leg(COL.accent, 'werkzone'), leg(COL.blauw, 'uitsprong of nis'), h('span', { class: 'opn-leg opn-leg-st', text: 'gestippeld = schatting' })));
    body.appendChild(X.planBlok(r, { titel: kiezen ? 'Tik de wanden voor het meubel' : 'Plattegrond', opWand: kiezen ? zetWerkzone : (w => X.openWand(w, null)), kies: kiezen }));
    if (kiezen) { c.appendChild(body); return; }
    // onderdeel: volgende, ruimte-maten, plint
    const actief = S.modelStap && lijst(rt.stappen).find(s => s.id === S.modelStap);
    if (actief) {
      const stappen = lijst(rt.stappen).filter(s => !s.wand && s.type !== 'foto' && s.type !== 'rondje' && !s.optioneel), i = stappen.findIndex(s => s.id === actief.id);
      body.appendChild(paneel(actief, {
        teller: 'ruimte-maat', focus: true,
        volgende: () => { const nieuw = X.route(), n = K.volgendeOpen(nieuw, actief.id, { wrap: true }); S.modelStap = null; if (n) X.naarStap(n); else { X.toast('Alles is gemeten of uitgesteld.'); X.teken(); } },
        vorige: i > 0 ? () => { S.modelStap = stappen[i - 1].id; X.teken(); } : null }));
      body.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Terug naar het model', onclick: () => { S.modelStap = null; X.teken(); } }));
    } else {
      const vlg = K.volgendeOpen(rt, null, { wrap: true });
      body.appendChild(h('div', { class: 'opn-kaart opn-volgende' },
        vlg ? h('div', null, h('div', { class: 'opn-label', text: 'Volgende vraag · ' + vlg.stap }), h('div', { class: 'opn-vraag', text: (vlg.wand ? X.wandNaam(vlg.wand) + ': ' : '') + vlg.label }),
          h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', onclick: () => X.naarStap(vlg) }, 'Verder meten →'))
          : h('div', null, h('div', { class: 'opn-vraag', text: 'Alles is gemeten of uitgesteld.' }), h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', onclick: () => X.ga('afronden') }, 'Naar afronden'))));
      // de werkzone
      body.appendChild(h('div', { class: 'opn-kaart opn-plintkaart' },
        h('div', null, h('div', { class: 'opn-kaart-titel', text: 'Werkzone' }), h('div', { class: 'opn-rij-sub', text: zone.length ? zone.map(w => K.wandNaam(w).toLowerCase()).join(', ') : 'Nog niet gekozen: tik de wand(en) waar het meubel komt' })),
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: zone.length ? 'Wijzigen' : 'Kiezen', onclick: () => { S.werkzoneKiezen = true; X.teken(); } })));
      // ruimte-maten
      const rm = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: 'Hele ruimte' }), h('div', { class: 'opn-chips' }));
      for (const st of lijst(rt.stappen).filter(s => !s.wand && s.type !== 'foto' && s.type !== 'rondje')) {
        const m = vm.get(st.pad), tekst = st.label + (st.staat === 'gemeten' && m && m.maat ? ' · ' + X.mm(m.maat.waarde) : st.optioneel ? ' (optioneel)' : '');
        rm.lastChild.appendChild(h('button', { type: 'button', class: 'opn-chip opn-chip-st-' + st.staat, onclick: () => { S.modelStap = st.id; X.teken(); } }, h('span', { class: 'opn-stip', style: { background: kleurVan(st.staat, st.conflict, st.optioneel) } }), tekst));
      }
      if (ids.length !== 4) rm.lastChild.appendChild(h('button', { type: 'button', class: 'opn-chip', onclick: diagonaalBlad }, '+ Diagonaal als controle'));
      body.appendChild(rm);
      // hoeken van de kamer: standaard 90 graden (een aanname)
      body.appendChild(h('details', { class: 'opn-kaart opn-hoeken', open: S.hoekenOpen ? true : null, ontoggle: ev => { S.hoekenOpen = ev.target.open; } },
        h('summary', { class: 'opn-kaart-titel', text: 'Hoeken van de kamer' }),
        h('p', { class: 'opn-hint', text: 'Standaard 90 graden, een aanname. Staat een hoek naar binnen (L-vorm) of schuin, pas hem hier aan.' }),
        ...ids.map(w => X.hoekRij(w))));
      // plint
      const pl = S.rec.instellingen && S.rec.instellingen.plint;
      body.appendChild(h('div', { class: 'opn-kaart opn-plintkaart' },
        h('div', null, h('div', { class: 'opn-kaart-titel', text: 'Plint in de kamer' }), h('div', { class: 'opn-rij-sub', text: pl ? (pl.geen ? 'Geen plint' : X.mm(pl.hoogte) + ' mm, gelijk voor de werkzone-wanden') : 'Nog niet ingevuld, één keer voor alle wanden' })),
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: pl ? 'Wijzigen' : 'Invullen', onclick: plintSheet })));
      body.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Foto\'s opnieuw bekijken of maken', onclick: () => X.ga('fotos') }));
    }
    c.appendChild(body);
  };
  // Een diagonaal als controle van de vorm (bij een andere vorm dan vier wanden is hij optioneel): kies twee hoeken
  function diagonaalBlad() {
    const r = X.ruimte(), hoeken = K.wandIds(r).map(w => K.wandHoeken(r, w)[0]), gekozen = [];
    const rij = h('div', { class: 'opn-chips' });
    const bouw = () => { X.leeg(rij); for (const hk of hoeken) rij.appendChild(h('button', { type: 'button', class: 'opn-chip' + (gekozen.includes(hk) ? ' is-aan' : ''), 'aria-pressed': gekozen.includes(hk) ? 'true' : 'false', onclick: () => { const i = gekozen.indexOf(hk); if (i >= 0) gekozen.splice(i, 1); else if (gekozen.length < 2) gekozen.push(hk); bouw(); knop.disabled = gekozen.length !== 2; } }, K.hoekTekst(hk))); };
    const knop = h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', disabled: true, text: 'Diagonaal toevoegen', onclick: () => { const res = K.voegDiagonaalToe(S.rec.opname, r.id, gekozen[0], gekozen[1]); if (X.wijzig(res)) { X.sluitBlad(); S.modelStap = 'maat:diagonalen.' + res.id + '.maten.lengte'; X.teken(); } } });
    bouw();
    X.blad('Diagonaal als controle', [h('p', { class: 'opn-hint', text: 'Meet de diagonaal tussen twee hoeken (op 1000 mm boven de vloer). Klopt hij met de vorm, dan is de plattegrond gecontroleerd. Optioneel.' }), rij, knop]);
  }
  const leg = (kl, t) => h('span', { class: 'opn-leg' }, h('span', { class: 'opn-stip', style: { background: kl } }), t);

  function tekenModel(svg, d) {
    X.leeg(svg);
    const { r, rt, vm, kamer, modellen, status, kiezen } = d, ids = kamer.volgorde, cam = G.camera(kamer, S.cam.yaw, S.cam.pitch), sc = Math.min(VB.w, VB.h) / 2.2, cx = VB.w / 2, cy = VB.h / 2 + 4;
    const P = p3 => { const q = G.projecteer(cam, p3); return [cx + q.x * sc, cy + q.y * sc, q.d]; };
    const pt = a => a.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
    const achter = G.achterwanden(kamer, cam), zone = lijst(r.werkzone), hoog = kamer.hoogte;
    const lijnL = (a, b, kl, w, dash, extra) => sv('line', Object.assign({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: kl, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-dasharray': dash || null, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }, extra || {}));
    const stat = pad => { const v = vm.get(pad); return v ? v : null; };
    const actiefPad = S.modelStap ? (lijst(rt.stappen).find(s => s.id === S.modelStap) || {}).pad : null;
    const xs = Object.keys(kamer.punten).map(k => kamer.punten[k]), mx = (Math.min.apply(null, xs.map(p => p[0])) + Math.max.apply(null, xs.map(p => p[0]))) / 2, my = (Math.min.apply(null, xs.map(p => p[1])) + Math.max.apply(null, xs.map(p => p[1]))) / 2;
    const open = (w, doe) => klik(() => { if (kiezen) zetWerkzone(w); else doe(); });
    // vlakken van de wanden (aantikbaar bij de achterwanden)
    for (const w of ids) {
      const a = kamer.wanden[w], A = P([a.a[0], a.a[1], 0]), B = P([a.b[0], a.b[1], 0]), B2 = P([a.b[0], a.b[1], hoog]), A2 = P([a.a[0], a.a[1], hoog]);
      const werk = zone.includes(w), isAchter = achter.includes(w);
      svg.appendChild(sv('polygon', { points: pt([A, B, B2, A2]), fill: werk ? 'rgba(23,100,63,0.10)' : 'rgba(0,0,0,0.001)', stroke: 'none', 'pointer-events': isAchter ? 'all' : 'none', style: isAchter ? { cursor: 'pointer' } : null, onclick: () => open(w, () => X.openWand(w, null)) }));
    }
    // hoeklijnen en plafondranden, langs de hele contour (ook de uitsprongen en nissen)
    for (const s of kamer.contour) {
      const A = P([s.van[0], s.van[1], 0]), A2 = P([s.van[0], s.van[1], hoog]), B2 = P([s.naar[0], s.naar[1], hoog]);
      svg.appendChild(lijnL(A, A2, s.soort === 'wand' ? '#9aa09a' : '#8aa0b3', 1, kamer.hoogteGeschat ? '4 3' : null));
      svg.appendChild(lijnL(A2, B2, s.soort === 'wand' ? '#7b817c' : '#8aa0b3', 1.1, kamer.vormGeschat || s.geschat ? '4 3' : null));
    }
    // de vloerrand: een stuk wand heeft de kleur van zijn wandlengte, een uitsprong of nis die van zijn maten
    for (const s of kamer.contour) {
      const A = P([s.van[0], s.van[1], 0]), B = P([s.naar[0], s.naar[1], 0]);
      let kl, dik = 2.4, dash = null;
      if (s.soort === 'wand') {
        const v = stat('wanden.' + s.wand + '.maten.lengte'), st = v ? v.staat : 'open';
        kl = kleurVan(st, v && v.conflict); if (zone.includes(s.wand) && st === 'gemeten') kl = COL.donker; dash = (s.geschat || kamer.vormGeschat) ? '5 3' : null;
      } else {
        const sts = ['breedte', 'positie', 'diepte'].map(k => { const v = stat('uitsprongen.' + s.uitsprong + '.maten.' + k); return v ? v.staat : 'open'; });
        kl = sts.includes('open') ? COL.blauw : sts.includes('later') ? COL.oranje : COL.donker; dik = 2.8; dash = s.geschat ? '4 2.5' : null;
      }
      svg.appendChild(lijnL(A, B, kl, dik, dash));
    }
    // een nog niet gesloten ronde: een lichte stippellijn terug naar de eerste hoek
    if (!kamer.rond && ids.length) { const l = kamer.wanden[ids[ids.length - 1]], f = kamer.wanden[ids[0]]; svg.appendChild(lijnL(P([l.b[0], l.b[1], 0]), P([f.a[0], f.a[1], 0]), '#c9ccc6', 1.2, '2 4')); }
    // diagonalen op de vloer
    for (const [pad, v] of vm) {
      if (pad.indexOf('diagonalen.') !== 0) continue;
      const id = pad.split('.')[1], ent = lijst(r.diagonalen).find(x => x.id === id), hk = ids.map(w => kamer.wanden[w].van);
      let van = ent && ent.van, naar = ent && ent.naar; if (!van && ids.length === 4) { van = id === 'A' ? hk[0] : hk[1]; naar = id === 'A' ? hk[2] : hk[3]; }
      if (!kamer.punten[van] || !kamer.punten[naar]) continue;
      const act = actiefPad === pad, st = v.staat;
      svg.appendChild(lijnL(P([kamer.punten[van][0], kamer.punten[van][1], 0]), P([kamer.punten[naar][0], kamer.punten[naar][1], 0]), act ? COL.rood : kleurVan(st, v.conflict, v.optioneel), act ? 3.4 : 1.2, (st === 'gemeten' || act) ? null : '2 4'));
    }
    // plafondhoogte als paal in het midden
    { const pad = 'plafondpunten.P1.maten.hoogte', v = stat(pad), act = actiefPad === pad;
      svg.appendChild(lijnL(P([mx, my, 0]), P([mx, my, hoog]), act ? COL.rood : kleurVan(v ? v.staat : 'open', false), act ? 3.4 : 1.2, '3 3')); }
    // openingen en objecten
    for (const w of ids) for (const f of modellen[w].vormen) {
      if (f.band || f.bank || f.uitsprong) continue;
      const sts = lijst(rt.stappen).filter(s => s.object === f.id && !s.optioneel), openS = sts.some(s => !s.afgehandeld), later = sts.some(s => s.staat === 'later'), kl = openS ? COL.rood : later ? COL.oranje : COL.donker;
      if (f.rect) {
        const q = [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]].map(a => P(G.wandNaar3D(kamer, w, a[0], a[1])));
        svg.appendChild(sv('polygon', { points: pt(q), fill: 'none', stroke: kl, 'stroke-width': 1.2, 'stroke-dasharray': f.geschat ? '3 2' : null, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
      } else {
        const q = P(G.wandNaar3D(kamer, w, f.x, f.y));
        svg.appendChild(sv('circle', { cx: q[0], cy: q[1], r: 3.2, fill: f.geschat ? '#fff' : kl, stroke: kl, 'stroke-width': 1.3, 'pointer-events': 'none' }));
      }
    }
    // wandlabels: de dependabele tikdoelen (44 px hoog), net buiten de vloerrand van de wand
    const mid = P([mx, my, 0]);
    for (const w of ids) {
      const a = kamer.wanden[w], mf = P(G.wandNaar3D(kamer, w, a.lengte / 2, 0)), s = status[w], werk = zone.includes(w);
      const dx = mf[0] - mid[0], dy = mf[1] - mid[1], dl = Math.hypot(dx, dy) || 1, m = [mf[0] + dx / dl * 36, mf[1] + dy / dl * 30];
      const kl = s.open ? COL.rood : s.later ? COL.oranje : COL.donker, bw = ids.length > 4 ? 74 : 84, bh = 46, x = Math.max(4, Math.min(VB.w - bw - 4, m[0] - bw / 2)), y = Math.max(4, Math.min(VB.h - bh - 4, m[1] - bh / 2));
      const ondertitel = kiezen ? (werk ? '✓ zone' : '+ zone') : s.open ? s.klaar + ' van ' + s.n : s.later ? 'later: ' + s.later : '✓ klaar';
      const g = sv('g', { class: 'opn-chip-wand', role: 'button', tabindex: '0', 'aria-label': X.wandNaam(w) + ', ' + s.klaar + ' van ' + s.n + ' klaar' + (werk ? ', werkzone' : ''), style: { cursor: 'pointer' }, onclick: () => open(w, () => X.openWand(w, null)), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (kiezen) zetWerkzone(w); else X.openWand(w, null); } } },
        sv('rect', { x, y, width: bw, height: bh, rx: 9, fill: werk && kiezen ? COL.accent : '#fff', stroke: kiezen ? (werk ? COL.accent : '#9a917f') : kl, 'stroke-width': 2 }),
        werk && !kiezen ? sv('rect', { x: x + 2, y: y + 2, width: 5, height: bh - 4, rx: 2.5, fill: COL.accent }) : null,
        sv('text', { x: x + bw / 2 + (werk && !kiezen ? 3 : 0), y: y + 19, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 600, fill: werk && kiezen ? '#fff' : werk ? COL.accent : COL.donker, text: K.wandNaam(w) }),
        sv('text', { x: x + bw / 2 + (werk && !kiezen ? 3 : 0), y: y + 37, 'text-anchor': 'middle', 'font-size': 12, fill: werk && kiezen ? '#fff' : kiezen ? COL.grijs : kl, text: ondertitel }));
      svg.appendChild(g);
    }
  }
  // een tik na het slepen telt niet als tik
  function klik(f) { if (X._sleept) return; f(); }
  function koppelDraaien(svg, teken) {
    let start = null, verplaatst = false, raf = 0;
    const beweeg = e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!verplaatst && Math.hypot(dx, dy) < 7) return;
      verplaatst = true; X._sleept = true;
      S.cam = { yaw: start.yaw + dx * 0.55, pitch: Math.max(8, Math.min(80, start.pitch + dy * 0.35)) };
      if (!raf) raf = root.requestAnimationFrame(() => { raf = 0; teken(); });
    };
    const eind = () => { root.removeEventListener('pointermove', beweeg); root.removeEventListener('pointerup', eind); root.removeEventListener('pointercancel', eind); start = null; setTimeout(() => { X._sleept = false; }, 80); };
    svg.addEventListener('pointerdown', e => { if (e.button && e.button !== 0) return; start = { x: e.clientX, y: e.clientY, yaw: S.cam.yaw, pitch: S.cam.pitch }; verplaatst = false; X._sleept = false; root.addEventListener('pointermove', beweeg); root.addEventListener('pointerup', eind); root.addEventListener('pointercancel', eind); });
  }

  // ════════════════════════ Scherm: wand met foto en lijnenoverlay ════════════════════════
  const BEELD_B = 1000;
  SCHERMEN.wand = function (c) {
    const r = X.ruimte(), w = S.wand, rt = X.route(), vm = vragenMap(), kamer = G.kamer(r), lay = X.wandLayout(w), model = G.wandModel(r, w, kamer, lay);
    const stappen = lijst(rt.stappen).filter(s => s.wand === w && s.type !== 'foto' && s.type !== 'rondje'), vlg = stappen.filter(s => !s.optioneel), werk = lijst(r.werkzone).includes(w);
    let actief = S.wandKlaar ? null : (stappen.find(s => s.id === S.stapId) || vlg.find(s => !s.afgehandeld) || vlg[0] || null);
    if (!actief && !S.wandKlaar && !vlg.length) S.wandKlaar = true;
    const idx = actief ? vlg.findIndex(s => s.id === actief.id) : -1, wandNr = rt.maten_wanden.indexOf(w) + 1;
    const klaar = vlg.filter(s => s.afgehandeld).length;
    const fotoRec = S.wandFoto && S.wandFoto.id === (X.wandFotoRec(w) || {}).id ? S.wandFoto : null;
    const onbekend = !!(fotoRec && lay.foto === fotoRec.id && lay.onbekend), foto = onbekend ? null : fotoRec, beeld = S.kal ? fotoRec : foto;          // met een onbekende hoek geen homografie: schematisch wandaanzicht
    const hoekPx = foto && lay.foto === foto.id && lay.hoeken && lay.hoeken.every(Boolean) ? lay.hoeken.map(p => [p[0] * foto.w, p[1] * foto.h]) : null;
    c.appendChild(X.kop(X.wandNaam(w), 'wand ' + wandNr + ' van ' + rt.maten_wanden.length + (werk ? ' · werkzone' : '') + ' · ' + klaar + ' van ' + vlg.length + ' klaar', { terugLabel: 'Terug naar het model' }));
    const body = h('div', { class: 'opn-body opn-body-wand' });

    // beeld: foto met overlay, of het schematische wandaanzicht
    let vb, afb, schema = false;
    if (beeld) { vb = { x: 0, y: 0, w: beeld.w, h: beeld.h }; afb = hoekPx ? G.wandAfbeelding(hoekPx) : null; }
    else { const sch = G.schemaHoeken(model.lengte, model.hoogte, BEELD_B); vb = { x: -50, y: -60, w: BEELD_B + 100, h: sch.hoogte + 120 }; afb = G.wandAfbeelding(sch.hoeken); schema = true; }
    const cssB = Math.min(root.innerWidth || 390, 560), px = vb.w / cssB;
    const svg = sv('svg', { viewBox: vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h, class: 'opn-wand-svg', preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': 'Wand met maatlijnen' });
    if (beeld) svg.appendChild(sv('image', { href: beeld.url, x: 0, y: 0, width: beeld.w, height: beeld.h, preserveAspectRatio: 'none', 'pointer-events': 'none' }));
    else svg.appendChild(sv('rect', { x: 0, y: 0, width: BEELD_B, height: vb.h - 120, fill: '#faf8f4', stroke: '#bdb4a2', 'stroke-width': 1.5 * px, 'pointer-events': 'none' }));
    const kalibreren = !!S.kal, plaatsen = !!S.plaats, knikken = !!S.knik && !!afb;
    if (afb && !kalibreren && !knikken) tekenOverlay(svg, { afb, model, px, rt, vm, actief: plaatsen ? null : actief, stappen, schema, foto, plaatsen });
    if (foto && !afb && !kalibreren) { /* eerst de hoeken aanwijzen */ }
    if (kalibreren) tekenKalibratie(svg, px, fotoRec);
    if (knikken) tekenKnik(svg, { afb, px });
    if (plaatsen && afb) svg.appendChild(sv('polygon', { points: hoekPunten(afb).map(q => q[0] + ',' + q[1]).join(' '), fill: 'none', stroke: COL.accent, 'stroke-width': 2 * px, 'stroke-dasharray': (8 * px) + ' ' + (5 * px), 'pointer-events': 'none' }));
    // tikken op het beeld: hoeken aanwijzen of onderdeel plaatsen
    svg.addEventListener('click', ev => svgTik(ev, svg, afb, px, model, vb));
    body.appendChild(h('div', { class: 'opn-wandvak' + (kalibreren || plaatsen || knikken ? ' is-tikken' : '') }, svg));

    // melding bij tikken, werkbalk
    if (kalibreren) body.appendChild(kalibratieBalk(fotoRec));
    else if (knikken) body.appendChild(knikBalk());
    else if (plaatsen) body.appendChild(plaatsBalk());
    else {
      if (foto && !afb) body.appendChild(h('div', { class: 'opn-kaart opn-uitleg' }, h('div', { class: 'opn-kaart-titel', text: 'Eerst de vier hoeken van de wand aanwijzen' }), h('p', { text: 'Tik op de foto de hoeken van de wand: links onder, rechts onder, rechts boven, links boven. Daarna staan de maatlijnen op de foto.' }), h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Hoeken aanwijzen', onclick: startKal })));
      if (onbekend) body.appendChild(h('div', { class: 'opn-kaart opn-uitleg' }, h('div', { class: 'opn-kaart-titel', text: 'Een of meer hoeken zijn onbekend' }), h('p', { text: 'Een hoek was buiten beeld of afgedekt. De maatlijnen staan daarom op een schematisch wandaanzicht, niet op de foto. Je kunt de hoeken later alsnog aanwijzen.' }), h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: () => startKal(true) }, 'Hoeken aanpassen')));
      else if (!foto) body.appendChild(h('div', { class: 'opn-hint-rij' }, h('span', { text: X.wandFotoRec(w) ? 'De foto van deze wand staat in de opname, maar het beeld is op dit toestel niet te laden. Je werkt nu op het schema.' : 'Schematisch wandaanzicht, nog geen foto van deze wand.' }),
        X.fotoKnop('Foto maken', async f => { await X.opslaanFoto(f, { wand: w }); await laadWandFoto(w); X.teken(); }, { klasse: 'opn-btn opn-btn-klein' })));
      body.appendChild(h('div', { class: 'opn-werkbalk' },
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: voegToeSheet }, '+ Toevoegen'),
        (foto && afb) || onbekend ? h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: startKnik }, 'Vorm van de wand') : null,
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: hoekSheet }, 'Hoek'),
        foto && afb ? h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: () => startKal(true) }, 'Hoeken aanpassen') : null,
        h('span', { class: 'opn-leg opn-leg-st', text: model.lengteGemeten ? '' : 'wandlengte nog niet gemeten: lijnen zijn een schatting' })));
      // paneel
      if (S.wandKlaar || !actief) body.appendChild(klaarKaart(rt, w));
      else body.appendChild(wandPaneel(actief, stappen, vlg, idx));
    }
    c.appendChild(body);
    if (S.itemSheet) { const id = S.itemSheet; S.itemSheet = null; itemSheet(id); }
    if (S.hoekSheet) { S.hoekSheet = false; hoekSheet(); }
  };
  const hoekPunten = afb => [[0, 0], [1, 0], [1, 1], [0, 1]].map(a => afb.naarBeeld(a[0], a[1]));

  function wandPaneel(actief, stappen, vlg, idx) {
    const w = S.wand;
    const volgendeNa = id => {
      const nieuw = lijst(X.route().stappen).filter(s => s.wand === w && s.type !== 'foto' && s.type !== 'rondje' && !s.optioneel), i = nieuw.findIndex(s => s.id === id);
      return nieuw.slice(i + 1).find(s => !s.afgehandeld) || nieuw.slice(0, Math.max(0, i)).find(s => !s.afgehandeld) || null;
    };
    return paneel(actief, {
      teller: 'stap ' + (idx >= 0 ? idx + 1 : '•') + ' van ' + vlg.length + ' op deze wand', focus: true,
      volgende: id0 => { const n = volgendeNa(actief.id); if (n) { S.stapId = n.id; S.wandKlaar = false; } else { S.stapId = null; S.wandKlaar = true; } X.teken(); },
      vorige: idx > 0 ? () => { S.stapId = vlg[idx - 1].id; S.wandKlaar = false; X.teken(); } : null });
  }
  function klaarKaart(rt, w) {
    const volgW = rt.maten_wanden.concat(rt.maten_wanden).slice(rt.maten_wanden.indexOf(w) + 1).slice(0, 3).find(x => lijst(rt.stappen).some(s => s.wand === x && !s.optioneel && !s.afgehandeld && s.type !== 'foto' && s.type !== 'rondje'));
    return h('div', { class: 'opn-kaart opn-klaar' }, h('div', { class: 'opn-kaart-titel', text: '✓ ' + X.wandNaam(w) + ' klaar' }),
      h('p', { text: 'Alle gevraagde maten van deze wand zijn gemeten of bewust uitgesteld. Tik op een lijn om een maat te controleren, of voeg iets toe dat je hier ziet.' }),
      h('div', { class: 'opn-knoppen' },
        volgW ? h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', onclick: () => X.openWand(volgW, null) }, 'Volgende wand: ' + K.wandNaam(volgW)) : null,
        h('button', { type: 'button', class: 'opn-btn ' + (volgW ? 'opn-btn-licht' : 'opn-btn-groot opn-btn-primair'), onclick: () => X.ga('model') }, 'Terug naar het model')));
  }

  // ── Overlay: de maatlijnen op de foto (of het schema) ──
  function tekenOverlay(svg, d) {
    const { afb, model, px, rt, vm, actief, stappen, foto } = d, plaats = !!d.plaatsen, g = sv('g', { class: 'opn-overlay' }), pillen = [];
    // omtrek van de wand
    const hk = hoekPunten(afb);
    g.appendChild(sv('polygon', { points: hk.map(q => q[0] + ',' + q[1]).join(' '), fill: 'none', stroke: COL.accent, 'stroke-width': 1.2 * px, 'stroke-dasharray': (7 * px) + ' ' + (5 * px), opacity: 0.45, 'pointer-events': 'none' }));
    const naarB = (x, y) => afb.naarBeeld(x / model.lengte, y / model.hoogte);
    // de knikken die bij de vorm van de wand zijn getikt: de stukken naar voren of naar achteren als gekleurde band op de vloerlijn
    { const we = lijst(X.ruimte().wanden).find(x => x.id === S.wand), fv = we && we.foto_vorm;
      if (fv) for (let i = 0; i < lijst(fv.tussenstukken).length; i++) { const v = fv.tussenstukken[i]; if (v === 'recht') continue; const u0 = fv.knikken[i].u, u1 = fv.knikken[i + 1].u, q = [afb.naarBeeld(u0, 0), afb.naarBeeld(u1, 0), afb.naarBeeld(u1, 0.06), afb.naarBeeld(u0, 0.06)];
        g.appendChild(sv('polygon', { points: q.map(a => a.join(',')).join(' '), fill: VORM_KLEUR[v], stroke: v === 'voor' ? COL.blauw : COL.oranje, 'stroke-width': 1.2 * px, 'pointer-events': 'none' })); } }
    // onderdelen (kozijnen, objecten): aantikbaar voor de optionele close-up en extra maten
    for (const f of model.vormen) {
      const st = lijst(rt.stappen).filter(s => s.object === f.id && !s.optioneel), open = st.some(s => !s.afgehandeld), kl = open ? '#555' : COL.donker;
      if (f.rect) {
        const q = [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]].map(a => naarB(a[0], a[1]));
        if (q.some(a => !a)) continue;
        if (f.band) { g.appendChild(sv('polygon', { points: q.map(a => a.join(',')).join(' '), fill: 'rgba(23,100,63,0.14)', stroke: COL.accent, 'stroke-width': 1 * px, 'pointer-events': 'none' })); continue; }
        g.appendChild(sv('polygon', { points: q.map(a => a.join(',')).join(' '), fill: f.uitsprong ? 'rgba(62,92,118,0.16)' : 'rgba(255,255,255,0.08)', stroke: f.uitsprong ? COL.blauw : kl, 'stroke-width': 1.3 * px, 'stroke-dasharray': f.geschat ? (5 * px) + ' ' + (3 * px) : null, style: { cursor: 'pointer' }, 'pointer-events': plaats ? 'none' : null, onclick: () => itemSheet(f.id) }));
        pillen.push([f, q[3][0] + 2 * px, q[3][1] - 15 * px]);
      } else {
        const q = naarB(f.x, f.y); if (!q) continue;
        g.appendChild(sv('circle', { cx: q[0], cy: q[1], r: 9 * px, fill: 'rgba(255,255,255,0.35)', stroke: kl, 'stroke-width': 1.5 * px, style: { cursor: 'pointer' }, 'pointer-events': plaats ? 'none' : null, onclick: () => itemSheet(f.id) }));
        pillen.push([f, q[0] + 12 * px, q[1] - 22 * px]);
      }
    }
    // maatlijnen: eerst de rustige, de actieve rode lijn bovenop
    const gesorteerd = model.lijnen.slice().sort((a, b) => (actief && a.pad === actief.pad ? 1 : 0) - (actief && b.pad === actief.pad ? 1 : 0));
    for (const l of gesorteerd) {
      const b = G.lijnNaarBeeld(afb, model, l); if (!b) continue;
      const v = vm.get(l.pad), st = v ? v.staat : 'open', stap = stappen.find(s => s.pad === l.pad) || null, act = !!actief && l.pad === actief.pad, opt = !!(v && v.optioneel);
      // meetstand: alleen de ACTIEVE lijn valt op (rood, dik, met label); alle andere lijnen zijn dun en rustig en hebben geen label of eindpunten. Tik een lijn aan om hem actief te maken en zijn maat te zien.
      const kl = act ? COL.rood : st === 'gemeten' ? '#4d524c' : st === 'later' ? '#d9a54e' : st === 'nvt' ? '#cfd2cc' : '#a9ada7';
      const dik = (act ? 4.2 : st === 'gemeten' ? 1.2 : 0.9) * px;
      g.appendChild(sv('line', { x1: b.a[0], y1: b.a[1], x2: b.b[0], y2: b.b[1], stroke: kl, 'stroke-width': dik, 'stroke-linecap': 'round', 'stroke-dasharray': st === 'gemeten' || act ? null : (st === 'nvt' ? (2 * px) + ' ' + (4 * px) : (6 * px) + ' ' + (4 * px)), 'pointer-events': 'none' }));
      if (act) for (const e of [b.a, b.b]) g.appendChild(sv('circle', { cx: e[0], cy: e[1], r: 5 * px, fill: COL.rood, stroke: kl, 'stroke-width': 1.2 * px, 'pointer-events': 'none' }));
      if (stap && !plaats) g.appendChild(sv('line', { x1: b.a[0], y1: b.a[1], x2: b.b[0], y2: b.b[1], stroke: 'rgba(0,0,0,0.001)', 'stroke-width': 30 * px, 'stroke-linecap': 'round', 'pointer-events': 'stroke', style: { cursor: 'pointer' }, 'data-pad': l.pad, onclick: () => { S.stapId = stap.id; S.wandKlaar = false; X.teken(); } }));
      // label: de actieve lijn noemt wat je meet, een gemeten lijn toont zijn maat
      const tekst = act ? (stap ? stap.label.replace(/^[A-Z]+\d* /, '') : l.label) + (v && v.maat && st === 'gemeten' ? ' · ' + X.mm(v.maat.waarde) : '') : '';
      if (tekst) {
        const mx = (b.a[0] + b.b[0]) / 2, my = (b.a[1] + b.b[1]) / 2, fs = (act ? 13 : 11) * px, bw = tekst.length * fs * 0.58 + 10 * px, bh = fs + 8 * px;
        g.appendChild(sv('rect', { x: mx - bw / 2, y: my - bh / 2, width: bw, height: bh, rx: 4 * px, fill: act ? COL.rood : 'rgba(255,255,255,0.92)', stroke: act ? 'none' : kl, 'stroke-width': 0.8 * px, 'pointer-events': 'none' }));
        g.appendChild(sv('text', { x: mx, y: my + fs * 0.36, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': act ? 700 : 500, fill: act ? '#fff' : '#111', 'pointer-events': 'none', text: tekst }));
      }
    }
    for (const a of pillen) itemPil(g, a[0], a[1], a[2], px, plaats, foto);
    if (plaats && S.plaats) for (const f of S.plaats.punten) { const q = afb.naarBeeld(f[0], f[1]); if (q) { g.appendChild(sv('circle', { cx: q[0], cy: q[1], r: 11 * px, fill: 'rgba(196,50,42,0.3)', stroke: COL.rood, 'stroke-width': 2.5 * px, 'pointer-events': 'none' })); g.appendChild(sv('line', { x1: q[0] - 18 * px, y1: q[1], x2: q[0] + 18 * px, y2: q[1], stroke: COL.rood, 'stroke-width': 2 * px, 'pointer-events': 'none' })); g.appendChild(sv('line', { x1: q[0], y1: q[1] - 18 * px, x2: q[0], y2: q[1] + 18 * px, stroke: COL.rood, 'stroke-width': 2 * px, 'pointer-events': 'none' })); } }
    svg.appendChild(g);
  }

  // Het label van een onderdeel (R1, SC1, ...) is een tikdoel (44 px): daar open je de extra maten, de definitie en de close-up. Het blijft binnen de foto.
  function itemPil(g, f, x, y, px, plaats, foto) {
    const bw = Math.max(34, 11 + String(f.id).length * 8) * px, bh = 24 * px, mx = foto ? foto.w : 1100, my = foto ? foto.h : 600;
    const X0 = Math.max(2 * px, Math.min(mx - bw - 2 * px, x)), Y0 = Math.max(2 * px, Math.min(my - bh - 2 * px, y));
    const e = sv('g', { class: 'opn-itempil', 'data-item': f.id, role: 'button', tabindex: '0', 'aria-label': f.naam + ': extra maten, foto of definitie', 'pointer-events': plaats ? 'none' : null, style: { cursor: 'pointer' }, onclick: ev => { ev.stopPropagation(); itemSheet(f.id); } },
      sv('rect', { x: X0 - 8 * px, y: Y0 - 10 * px, width: bw + 16 * px, height: bh + 20 * px, fill: 'rgba(0,0,0,0.001)' }),
      sv('rect', { x: X0, y: Y0, width: bw, height: bh, rx: 6 * px, fill: '#fff', stroke: '#111', 'stroke-width': 1.2 * px }),
      sv('text', { x: X0 + bw / 2, y: Y0 + bh * 0.7, 'text-anchor': 'middle', 'font-size': 12 * px, 'font-weight': 700, fill: '#111', text: f.id }));
    g.appendChild(e);
  }

  // ── De vorm van de wand aanwijzen: knikken op de vloerlijn, per stuk recht, naar voren (uitsprong) of naar achteren (nis) ──
  // De positie van een knik op de wand volgt uit de vier getikte wandhoeken (homografie). Dat is een schatting uit de foto: de kern slaat het op als verhouding op de wand (foto-voorstel), nooit als maat.
  const VORM_NAAM = { recht: 'Recht', voor: 'Naar voren', achter: 'Naar achteren' };
  function startKnik() {
    const foto = S.wandFoto, lay = X.wandLayout(S.wand), we = lijst(X.ruimte().wanden).find(x => x.id === S.wand);
    if (!foto || !(lay.foto === foto.id && lay.hoeken)) { X.toast('Wijs eerst de vier hoeken van de wand aan (of kies Hoek onbekend), dan kun je de knikken tikken.'); if (foto) startKal(); return; }
    const fv = we && we.foto_vorm;
    S.knik = { punten: fv ? fv.knikken.map(k => ({ x: k.x, y: k.y, u: k.u })) : [], vormen: fv ? fv.tussenstukken.slice() : [] };
    S.kal = null; S.plaats = null; X.teken();
  }
  function knikToevoegen(k) {
    const oud = S.knik.punten, oudV = S.knik.vormen, punten = oud.concat([k]).sort((a, b) => a.u - b.u);
    if (punten.some((p, i) => i && p.u - punten[i - 1].u < 0.01)) { X.toast('Die knik ligt te dicht bij een andere.'); return; }
    const vormen = [];
    for (let i = 0; i < punten.length - 1; i++) {                          // een stuk dat door een nieuwe knik in tweeën gaat, houdt zijn vorm
      const m = (punten[i].u + punten[i + 1].u) / 2; let v = 'recht';
      for (let j = 0; j < oud.length - 1; j++) if (m >= oud[j].u && m <= oud[j + 1].u) v = oudV[j] || 'recht';
      vormen.push(v);
    }
    S.knik = { punten, vormen };
  }
  const VORM_KLEUR = { recht: 'rgba(23,100,63,0.10)', voor: 'rgba(62,92,118,0.30)', achter: 'rgba(199,125,10,0.30)' };
  function tekenKnik(svg, d) {
    const { afb, px } = d, k = S.knik, g = sv('g', { class: 'opn-knik' }), hk = hoekPunten(afb);
    g.appendChild(sv('polygon', { points: hk.map(q => q[0] + ',' + q[1]).join(' '), fill: 'none', stroke: COL.accent, 'stroke-width': 1.5 * px, 'stroke-dasharray': (7 * px) + ' ' + (5 * px), opacity: 0.7, 'pointer-events': 'none' }));
    const l0 = afb.naarBeeld(0, 0), l1 = afb.naarBeeld(1, 0);
    g.appendChild(sv('line', { x1: l0[0], y1: l0[1], x2: l1[0], y2: l1[1], stroke: COL.accent, 'stroke-width': 3.2 * px, 'stroke-linecap': 'round', 'pointer-events': 'none' }));
    for (let i = 0; i < k.punten.length - 1; i++) {
      const u0 = k.punten[i].u, u1 = k.punten[i + 1].u, v = k.vormen[i] || 'recht', q = [afb.naarBeeld(u0, 0), afb.naarBeeld(u1, 0), afb.naarBeeld(u1, 0.45), afb.naarBeeld(u0, 0.45)], m = afb.naarBeeld((u0 + u1) / 2, 0.22);
      g.appendChild(sv('polygon', { points: q.map(a => a[0] + ',' + a[1]).join(' '), fill: VORM_KLEUR[v], stroke: v === 'voor' ? COL.blauw : v === 'achter' ? COL.oranje : COL.accent, 'stroke-width': 1.2 * px, 'pointer-events': 'none' }));
      g.appendChild(sv('text', { x: m[0], y: m[1], 'text-anchor': 'middle', 'font-size': 13 * px, 'font-weight': 700, fill: '#111', stroke: '#fff', 'stroke-width': 3 * px, 'paint-order': 'stroke', 'pointer-events': 'none', text: 'stuk ' + (i + 1) + (v === 'recht' ? '' : ': ' + (v === 'voor' ? 'voor' : 'achter')) }));
    }
    k.punten.forEach((p, i) => {
      const a = afb.naarBeeld(p.u, 0), b = afb.naarBeeld(p.u, 1);
      g.appendChild(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: COL.rood, 'stroke-width': 1.6 * px, 'stroke-dasharray': (6 * px) + ' ' + (4 * px), 'pointer-events': 'none' }));
      g.appendChild(sv('circle', { class: 'opn-knik-punt', cx: a[0], cy: a[1], r: 13 * px, fill: 'rgba(196,50,42,0.3)', stroke: COL.rood, 'stroke-width': 2.4 * px, 'pointer-events': 'none' }));
      g.appendChild(sv('text', { x: a[0], y: a[1] + 4.6 * px, 'text-anchor': 'middle', 'font-size': 13 * px, 'font-weight': 700, fill: '#fff', stroke: '#000', 'stroke-width': 0.5 * px, 'paint-order': 'stroke', 'pointer-events': 'none', text: String(i + 1) }));
    });
    svg.appendChild(g);
  }
  function knikBalk() {
    const kn = S.knik, n = kn.punten.length, r = X.ruimte();
    const kaart = h('div', { class: 'opn-kaart opn-kal-kaart opn-knikbalk' }, h('div', { class: 'opn-kaart-titel', text: n < 2 ? 'Tik de knikken op de vloerlijn (' + n + ' getikt)' : 'Wat is elk stuk tussen de knikken?' }));
    kaart.appendChild(h('p', { class: 'opn-hint', text: n < 2 ? 'Tik op de vloerlijn waar de wand een knik maakt: het begin en het einde van een uitstekend stuk (schoorsteen, pilaster, koker) of van een nis. Minstens twee knikken, van links naar rechts, in willekeurige volgorde. Een ruwe plek is genoeg.' : 'Elk stuk is recht, tenzij het naar voren uitsteekt (uitsprong) of naar achteren inspringt (nis). Een ruwe verhouding op de wand is genoeg: de maten meet je daarna.' }));
    for (let i = 0; i < n - 1; i++) {
      const rij = h('div', { class: 'opn-stukrij' }, h('div', { class: 'opn-label', text: 'Stuk ' + (i + 1) + ' (knik ' + (i + 1) + ' tot ' + (i + 2) + ')' }), h('div', { class: 'opn-chips' }));
      for (const v of K.TUSSENSTUK_VORMEN) rij.lastChild.appendChild(h('button', { type: 'button', class: 'opn-chip' + (kn.vormen[i] === v ? ' is-aan' : ''), 'aria-pressed': kn.vormen[i] === v ? 'true' : 'false', onclick: () => { kn.vormen[i] = v; X.teken(); } }, VORM_NAAM[v]));
      kaart.appendChild(rij);
    }
    const aantal = kn.vormen.filter(v => v !== 'recht').length;
    kaart.appendChild(h('div', { class: 'opn-knoppen' },
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', disabled: n === 1, onclick: klaarKnik }, n === 0 ? 'Geen knikken: de wand is recht' : aantal ? 'Klaar: ' + aantal + (aantal === 1 ? ' uitsprong of nis' : ' uitsprongen en nissen') : 'Klaar: alles recht'),
      h('div', { class: 'opn-onderrij' },
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', disabled: !n, onclick: () => { const p = kn.punten.slice(0, -1); S.knik = { punten: p, vormen: kn.vormen.slice(0, Math.max(0, p.length - 1)) }; X.teken(); } }, 'Laatste knik weg'),
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', disabled: !n, onclick: () => { S.knik = { punten: [], vormen: [] }; X.teken(); } }, 'Opnieuw'),
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: () => { S.knik = null; X.teken(); } }, 'Annuleren')),
      h('p', { class: 'opn-hint', text: 'Zit de uitsprong in een hoek van de kamer? Maak er dan een eigen wand van (volgende foto) met een hoek van 90 of 270 graden.' })));
    return kaart;
  }
  function klaarKnik() {
    const kn = S.knik, r = X.ruimte(), res = K.zetWandVorm(S.rec.opname, r.id, S.wand, { foto: S.wandFoto ? S.wandFoto.id : null, knikken: kn.punten, tussenstukken: kn.vormen });
    if (!X.wijzig(res)) return;
    S.knik = null;
    const stap = lijst(X.route().stappen).find(s => s.wand === S.wand && s.soort === 'uitsprong' && !s.afgehandeld && !s.optioneel);
    S.stapId = stap ? stap.id : null; S.wandKlaar = false;
    X.toast(res.uitsprongen.length ? (res.uitsprongen.length === 1 ? 'Uitsprong' : 'Uitsprongen') + ' ' + res.uitsprongen.join(', ') + ' op de plattegrond gezet. De verhouding komt uit de foto (een schatting); nu de maten.' : 'De vorm van de wand is vastgelegd: recht.');
    X.teken();
  }
  function hoekSheet() {
    X.blad('Hoek na ' + X.wandNaam(S.wand).toLowerCase(), [X.hoekRij(S.wand, { vernieuw: () => { S.hoekSheet = true; X.teken(); } })]);
  }

  // ── Hoeken aanwijzen met een loep (geen precies slepen) ──
  // Tik ongeveer op een hoek: er komt een uitvergrote uitsnede (loep) waarin je de exacte plek tikt. Een hoek kan ook "onbekend" zijn (buiten beeld, achter een kast): dan staan de maatlijnen op
  // een schematisch wandaanzicht in plaats van op de foto. Er worden nooit fictieve hoeken verplicht. Ongedaan en opnieuw kan altijd.
  const HOEK_NAMEN = ['linksonder', 'rechtsonder', 'rechtsboven', 'linksboven'];
  function startKal(aanpassen) {
    const foto = S.wandFoto, lay = X.wandLayout(S.wand);
    if (!foto) { X.toast('Maak eerst een foto van deze wand.'); return; }
    const bestaand = aanpassen && lay.hoeken && lay.foto === foto.id ? lay.hoeken.map(p => p ? [p[0] * foto.w, p[1] * foto.h] : null) : [];
    S.kal = { punten: bestaand, klaar: bestaand.length === 4, loep: null };
    S.plaats = null; S.knik = null; X.teken();
  }
  function tekenKalibratie(svg, px, foto) {
    const k = S.kal, g = sv('g', { class: 'opn-kal' }), punten = k.punten.filter(Boolean);
    if (k.klaar && punten.length === 4) g.appendChild(sv('polygon', { class: 'opn-kal-lijn', points: punten.map(q => q[0] + ',' + q[1]).join(' '), fill: 'rgba(196,50,42,0.10)', stroke: COL.rood, 'stroke-width': 2.4 * px, 'pointer-events': 'none' }));
    else if (punten.length >= 2) g.appendChild(sv('polyline', { class: 'opn-kal-lijn', points: punten.map(q => q[0] + ',' + q[1]).join(' '), fill: 'none', stroke: COL.rood, 'stroke-width': 2.4 * px, 'pointer-events': 'none' }));
    k.punten.forEach((q, i) => {
      if (!q) return;
      const c = sv('circle', { class: 'opn-kal-punt', cx: q[0], cy: q[1], r: 15 * px, fill: 'rgba(196,50,42,0.25)', stroke: COL.rood, 'stroke-width': 2.4 * px, style: { cursor: 'pointer' }, 'data-nr': String(i),
        onclick: ev => { ev.stopPropagation(); if (X._sleept) return; S.kal.loep = { i, x: q[0], y: q[1] }; X.teken(); } });
      g.appendChild(c);
      g.appendChild(sv('text', { class: 'opn-kal-nr', x: q[0], y: q[1] + 5 * px, 'text-anchor': 'middle', 'font-size': 14 * px, 'font-weight': 700, fill: '#fff', stroke: '#000', 'stroke-width': 0.5 * px, 'paint-order': 'stroke', 'pointer-events': 'none', text: String(i + 1) }));
    });
    if (k.loep) {                                                         // waar je net tikte: de loep toont hiervan de omgeving
      const l = k.loep;
      g.appendChild(sv('circle', { cx: l.x, cy: l.y, r: 22 * px, fill: 'none', stroke: COL.accent, 'stroke-width': 2.2 * px, 'stroke-dasharray': (6 * px) + ' ' + (4 * px), 'pointer-events': 'none' }));
    }
    svg.appendChild(g);
  }
  // De loep: een uitsnede van de foto (ongeveer 1/6 van de breedte), zes keer uitvergroot. Tik de exacte plek van de hoek.
  function loepBalk(foto) {
    const k = S.kal, l = k.loep, bw = foto.w / 6, bh = bw * 0.78, x0 = Math.max(0, Math.min(foto.w - bw, l.x - bw / 2)), y0 = Math.max(0, Math.min(foto.h - bh, l.y - bh / 2));
    const px = bw / 340;
    const svg = sv('svg', { class: 'opn-loep-svg', viewBox: x0 + ' ' + y0 + ' ' + bw + ' ' + bh, preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': 'Uitvergrote uitsnede van de foto. Tik de hoek.' },
      sv('image', { href: foto.url, x: 0, y: 0, width: foto.w, height: foto.h, preserveAspectRatio: 'none', 'pointer-events': 'none' }),
      sv('line', { x1: l.x - 14 * px, y1: l.y, x2: l.x + 14 * px, y2: l.y, stroke: COL.accent, 'stroke-width': 1.4 * px, opacity: 0.8, 'pointer-events': 'none' }),
      sv('line', { x1: l.x, y1: l.y - 14 * px, x2: l.x, y2: l.y + 14 * px, stroke: COL.accent, 'stroke-width': 1.4 * px, opacity: 0.8, 'pointer-events': 'none' }));
    k.punten.forEach((q, i) => { if (q && i !== l.i && q[0] >= x0 && q[0] <= x0 + bw && q[1] >= y0 && q[1] <= y0 + bh) svg.appendChild(sv('circle', { cx: q[0], cy: q[1], r: 8 * px, fill: 'rgba(196,50,42,0.3)', stroke: COL.rood, 'stroke-width': 1.6 * px, 'pointer-events': 'none' })); });
    svg.addEventListener('click', ev => {
      const p = svgPunt(svg, ev), pt = [Math.max(0, Math.min(foto.w, p[0])), Math.max(0, Math.min(foto.h, p[1]))];
      k.punten[l.i] = pt; k.loep = null; if (k.punten.length >= 4) k.klaar = true; X.teken();
    });
    return h('div', { class: 'opn-kaart opn-kal-kaart opn-loep' },
      h('div', { class: 'opn-kaart-titel', text: 'Tik de ' + HOEK_NAMEN[l.i] + 'hoek precies aan' }),
      h('div', { class: 'opn-loepvak' }, svg),
      h('p', { class: 'opn-hint', text: 'Dit is een uitvergroting (6x) van het groene rondje op de foto. Tik de plek waar de wand de hoek maakt.' }),
      h('div', { class: 'opn-knoppen' },
        h('button', { type: 'button', class: 'opn-btn opn-btn-licht', onclick: () => { k.punten[l.i] = null; k.loep = null; if (k.punten.length >= 4) k.klaar = true; X.teken(); } }, 'Hoek onbekend (buiten beeld of afgedekt)'),
        h('button', { type: 'button', class: 'opn-btn opn-btn-licht', onclick: () => { k.loep = null; X.teken(); } }, 'Terug naar de foto')));
  }
  function kalibratieBalk(foto) {
    const k = S.kal, n = k.punten.length, vol = n >= 4, onbekend = k.punten.filter(q => !q).length;
    if (k.loep) return loepBalk(foto);
    return h('div', { class: 'opn-kaart opn-kal-kaart' },
      h('div', { class: 'opn-kaart-titel', text: vol ? 'Staan de hoeken goed?' : 'Tik ongeveer de ' + HOEK_NAMEN[n] + 'hoek van de wand (' + (n + 1) + ' van 4)' }),
      h('p', { class: 'opn-hint', text: vol ? 'Tik een nummer op de foto om die hoek opnieuw in de loep te zetten. Het kader moet de wand omsluiten van vloer tot plafond en van hoek tot hoek.' + (onbekend ? ' Bij een onbekende hoek komen de maatlijnen op een schematisch wandaanzicht.' : '') : 'Een ruwe tik is genoeg: daarna zie je een uitvergroting om de hoek precies te zetten. Zit de hoek buiten beeld of achter een kast, kies dan Hoek onbekend.' }),
      h('div', { class: 'opn-knoppen' },
        vol ? h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', onclick: kalKlaar }, onbekend ? 'Klaar, met ' + onbekend + ' onbekende ' + (onbekend === 1 ? 'hoek' : 'hoeken') : 'Klaar, toon de lijnen') : null,
        vol ? null : h('button', { type: 'button', class: 'opn-btn opn-btn-licht', onclick: () => { k.punten.push(null); if (k.punten.length >= 4) k.klaar = true; X.teken(); } }, 'Deze hoek is onbekend (buiten beeld of afgedekt)'),
        h('div', { class: 'opn-onderrij' },
          h('button', { type: 'button', class: 'opn-btn opn-btn-klein', disabled: !n, onclick: () => { k.punten.pop(); k.klaar = false; X.teken(); } }, 'Ongedaan'),
          h('button', { type: 'button', class: 'opn-btn opn-btn-klein', disabled: !n, onclick: () => { S.kal = { punten: [], klaar: false, loep: null }; X.teken(); } }, 'Opnieuw'),
          h('button', { type: 'button', class: 'opn-btn opn-btn-klein', onclick: () => { S.kal = null; X.teken(); } }, 'Annuleren'))));
  }
  function kalKlaar() {
    const k = S.kal, foto = S.wandFoto, kennen = k.punten.filter(Boolean).length;
    if (kennen === 4 && !G.hoekenGeldig(k.punten)) { X.toast('De hoeken kruisen elkaar of liggen op één lijn. Tik een nummer en zet die hoek opnieuw in de loep, of kies Hoek onbekend.'); return; }
    const lay = X.wandLayout(S.wand, true); lay.foto = foto.id; lay.hoeken = k.punten.map(p => p ? [p[0] / foto.w, p[1] / foto.h] : null); lay.onbekend = kennen < 4; lay.tijd = X.nu();
    S.kal = null; X.bewaar(); X.teken();
  }
  function svgPunt(svg, ev) { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, q.y]; }
  function svgTik(ev, svg, afb, px, model, vb) {
    if (X._sleept) return;
    if (S.kal) {                                                          // een tik op de foto opent de loep voor de volgende hoek; precies zetten gebeurt in de loep
      if (S.kal.klaar || S.kal.loep) return;
      const p = svgPunt(svg, ev), foto = S.wandFoto; if (!foto) return;
      S.kal.loep = { i: S.kal.punten.length, x: Math.max(0, Math.min(foto.w, p[0])), y: Math.max(0, Math.min(foto.h, p[1])) };
      X.teken(); return;
    }
    if (S.knik && afb) {
      const lay = X.wandLayout(S.wand), schemaFoto = { w: BEELD_B, h: vb.h - 120 }, k = G.knikVanTik(afb, S.wandFoto && !lay.onbekend ? S.wandFoto : schemaFoto, svgPunt(svg, ev));
      if (!k) { X.toast('Tik op de wand zelf, niet in de hoek of ernaast.'); return; }
      knikToevoegen(k); X.teken(); return;
    }
    if (S.plaats && afb) {
      const p = svgPunt(svg, ev), f = G.beeldNaarFractie(afb, p); if (!f) return;
      S.plaats.punten.push(f);
      const nodig = S.plaats.rect ? 2 : 1;
      if (S.plaats.punten.length >= nodig) maakOnderdeel(model); else X.teken();
    }
  }

  // ── Iets toevoegen aan de wand (kozijn, deur, stopcontact, ...) en de plek op de foto tikken ──
  const TOEVOEG = [['raam', 'Kozijn of raam', true], ['deur', 'Deur', true], ['stopcontact', 'Stopcontact', false], ['schakelaar', 'Schakelaar', false], ['radiator', 'Radiator', true], ['leiding', 'Leiding of kraan', false], ['vensterbank', 'Vensterbank', null], ['plint', 'Plint (deze wand)', null], ['bijzonderheid', 'Bijzonderheid', null], ['overig', 'Iets anders', false]];
  function voegToeSheet() {
    const r = X.ruimte(), w = S.wand;
    const grid = h('div', { class: 'opn-grid' });
    for (const [type, naam, rect] of TOEVOEG) grid.appendChild(h('button', { type: 'button', class: 'opn-grid-knop', onclick: () => kiesType(type, naam, rect) }, naam));
    const buiten = !lijst(r.werkzone).includes(w);
    X.blad('Wat zit er op de ' + X.wandNaam(w).toLowerCase() + '?', [h('p', { class: 'opn-hint', text: 'Alleen toevoegen wat voor het meubel of het ruimtebeeld telt. Elk onderdeel krijgt zijn eigen vragen.' + (buiten ? ' Dit is geen werkzone-wand: wat je hier zelf toevoegt wordt wel helemaal gevraagd.' : '') }), grid]);
  }
  function kiesType(type, naam, rect) {
    const r = X.ruimte(), w = S.wand;
    if (type === 'bijzonderheid') { X.sluitBlad(); const st = lijst(X.route().stappen).find(s => s.id === 'bijz:' + w); if (st) { S.stapId = st.id; S.wandKlaar = false; } else X.toast('Bijzonderheden worden alleen gevraagd bij een werkzone-wand.'); X.teken(); return; }
    if (type === 'plint') {
      X.sluitBlad();
      if (lijst(r.objecten).some(o => o.type === 'plint' && o.wand === w)) { X.toast('Deze wand heeft al een plint.'); return; }
      const res = K.voegObjectToe(S.rec.opname, r.id, { type: 'plint', wand: w }); if (X.wijzig(res)) { S.stapId = (lijst(X.route().stappen).find(s => s.object === res.id) || {}).id || null; S.wandKlaar = false; X.teken(); } return;
    }
    if (type === 'vensterbank') {
      const ramen = lijst(r.openingen).filter(o => o.wand === w && o.soort === 'raam');
      const kn = ramen.map(o => h('button', { type: 'button', class: 'opn-btn opn-btn-licht', onclick: () => voegVensterbank(o.id) }, 'Onder ' + (o.naam || o.id)));
      X.blad('Vensterbank', [h('p', { class: 'opn-hint', text: ramen.length ? 'Bij welk kozijn hoort de vensterbank?' : 'Er is nog geen kozijn op deze wand. Je kunt de vensterbank ook los toevoegen.' }), ...kn, h('button', { type: 'button', class: 'opn-btn opn-btn-licht', onclick: () => voegVensterbank(null) }, 'Los, zonder kozijn')]);
      return;
    }
    if (type === 'raam' || type === 'deur') {
      let definitie = null;
      const chips = h('div', { class: 'opn-chips' });
      const bouw = () => { X.leeg(chips); for (const d of Object.keys(K.DEFINITIES)) chips.appendChild(h('button', { type: 'button', class: 'opn-chip' + (definitie === d ? ' is-aan' : ''), 'aria-pressed': definitie === d ? 'true' : 'false', onclick: () => { definitie = definitie === d ? null : d; bouw(); } }, K.DEFINITIES[d])); };
      bouw();
      X.blad(naam + ' toevoegen', [h('p', { class: 'opn-hint', text: 'Wat ga je meten: de muursparing, de dagmaat of het kozijn aan de buitenkant? Je kunt dit ook later kiezen, maar in de werkzone is het nodig voor het vrijgeven.' }), chips,
        h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Tik de plek op de foto', onclick: () => { X.sluitBlad(); startPlaats({ type, naam, rect: true, definitie }); } })]);
      return;
    }
    X.sluitBlad(); startPlaats({ type, naam, rect: !!rect });
  }
  function voegVensterbank(openingId) {
    X.sluitBlad();
    const res = K.voegObjectToe(S.rec.opname, X.ruimte().id, { type: 'vensterbank', wand: S.wand, opening: openingId || undefined });
    if (X.wijzig(res)) { S.stapId = (lijst(X.route().stappen).find(s => s.object === res.id) || {}).id || null; S.wandKlaar = false; X.teken(); }
  }
  function startPlaats(p) {
    const foto = S.wandFoto, lay = X.wandLayout(S.wand);
    if (foto && !(lay.foto === foto.id && lay.hoeken)) { X.toast('Wijs eerst de vier hoeken van de wand aan (of kies Hoek onbekend), dan kun je hier tikken.'); startKal(); return; }
    S.plaats = { type: p.type, naam: p.naam, rect: p.rect, definitie: p.definitie || null, punten: [] }; X.teken();
  }
  function plaatsBalk() {
    const p = S.plaats, tekst = p.rect ? (p.punten.length ? 'Tik nu de rechteronderhoek van de ' + p.naam.toLowerCase() : 'Tik de linkerbovenhoek van de ' + p.naam.toLowerCase()) : 'Tik op de plek van de ' + p.naam.toLowerCase();
    return h('div', { class: 'opn-kaart opn-kal-kaart' }, h('div', { class: 'opn-kaart-titel', text: tekst }), h('p', { class: 'opn-hint', text: 'Een ruwe plek is genoeg: de lijnen en de volgorde volgen hieruit, de maten vul je daarna in.' }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-licht', onclick: () => { S.plaats = null; X.teken(); } }, 'Annuleren'));
  }
  function maakOnderdeel(model) {
    const p = S.plaats, r = X.ruimte(), w = S.wand, L = model.lengte; S.plaats = null;
    const pts = p.punten, u0 = Math.min.apply(null, pts.map(a => a[0])), u1 = Math.max.apply(null, pts.map(a => a[0])), v0 = Math.min.apply(null, pts.map(a => a[1])), v1 = Math.max.apply(null, pts.map(a => a[1]));
    let res, lijstNaam;
    if (p.type === 'raam' || p.type === 'deur') { res = K.voegOpeningToe(S.rec.opname, r.id, { soort: p.type, wand: w, definitie: p.definitie || undefined }); lijstNaam = 'openingen'; }
    else { const kw = G.kamer(r).wanden[w], hoek = (u0 + u1) / 2 < 0.5 ? kw.van : kw.naar; res = K.voegObjectToe(S.rec.opname, r.id, { type: p.type, wand: w, hoek: p.type === 'radiator' ? undefined : hoek }); lijstNaam = 'objecten'; }
    if (!X.wijzig(res)) { X.teken(); return; }
    const lay = X.wandLayout(w, true); lay.vormen[res.id] = { u0, u1, v0, v1 };
    X.zetVeld(lijstNaam, res.id, 'positie_x', Math.round(u0 * L));
    const stap = lijst(X.route().stappen).find(s => s.object === res.id && !s.optioneel);
    S.stapId = stap ? stap.id : null; S.wandKlaar = false; X.bewaar(); X.toast(p.naam + ' toegevoegd. Nu de maten.'); X.teken();
  }

  // ── Een onderdeel aantikken: extra maten, definitie, close-up, weghalen (alles optioneel) ──
  function itemInfo(id) {
    const r = X.ruimte();
    for (const [l, naam] of [['openingen', 'opening'], ['objecten', 'object'], ['bijzonderheden', 'bijzonderheid'], ['uitsprongen', 'uitsprong']]) { const e = lijst(r[l]).find(x => x && x.id === id); if (e) return { lijstNaam: l, ent: e, soort: naam }; }
    return null;
  }
  function itemSheet(id) {
    const info = itemInfo(id); if (!info) return;
    const r = X.ruimte(), e = info.ent, vm = vragenMap(), mod = G.wandModel(r, S.wand, G.kamer(r), X.wandLayout(S.wand)), vorm = mod.vormen.find(v => v.id === id);
    const naam = vorm ? vorm.naam : (e.naam || e.id);
    const kids = [];
    if (info.lijstNaam === 'openingen') kids.push(h('div', { class: 'opn-veld' }, h('div', { class: 'opn-label', text: 'Wat meet je hier?' }), h('div', { class: 'opn-chips' }, ...Object.keys(K.DEFINITIES).map(d => h('button', { type: 'button', class: 'opn-chip' + (e.definitie === d ? ' is-aan' : ''), 'aria-pressed': e.definitie === d ? 'true' : 'false', onclick: () => { if (X.wijzig(K.zetDefinitie(S.rec.opname, r.id, id, d))) { S.itemSheet = id; X.teken(); } } }, K.DEFINITIES[d])))));
    const stappen = lijst(X.route().stappen).filter(s => s.object === id);
    kids.push(h('div', { class: 'opn-label', text: 'Maten van dit onderdeel' }));
    if (!stappen.length) kids.push(h('p', { class: 'opn-hint', text: 'Voor dit onderdeel worden geen maten gevraagd.' }));
    for (const s of stappen) { const v = vm.get(s.pad), waarde = s.staat === 'gemeten' ? (v && v.maat && v.maat.keuze ? keuzeTekst(v.maat.keuze) : X.mm(v && v.maat && v.maat.waarde) + ' mm') : s.staat === 'nvt' ? 'n.v.t.' : s.staat === 'later' ? 'later' : 'nog meten';
      kids.push(h('button', { type: 'button', class: 'opn-lijstrij', onclick: () => { X.sluitBlad(); S.stapId = s.id; S.wandKlaar = false; X.teken(); } }, h('span', { text: s.label.replace(/^[A-Z]+\d* /, '') + (s.optioneel ? ' (optioneel)' : '') }), h('span', { class: 'opn-lijstwaarde opn-staat-' + s.staat, text: waarde }))); }
    // close-up foto's (niet verplicht)
    const closeups = lijst(S.rec.opname.fotos).filter(f => f && f.soort === 'closeup' && f.item === id);
    kids.push(h('div', { class: 'opn-label', text: 'Close-up foto (niet verplicht)' }));
    const strip = h('div', { class: 'opn-strip' }); kids.push(strip);
    closeups.forEach(async f => { const u = await X.fotoUrl(f.id); if (u) strip.appendChild(h('img', { src: u, alt: 'Close-up ' + id, class: 'opn-thumb' })); });
    const nieuweFoto = async f => { await X.opslaanFoto(f, { wand: S.wand, soort: 'closeup', item: id }); S.itemSheet = id; X.teken(); };
    kids.push(h('div', { class: 'opn-onderrij' }, X.fotoKnop('Close-up maken', nieuweFoto, { klasse: 'opn-btn opn-btn-klein' }), X.fotoKnop('Uit galerij', nieuweFoto, { klasse: 'opn-btn opn-btn-klein', galerij: true })));
    if (info.lijstNaam === 'uitsprongen') kids.push(h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Vorm op de foto aanpassen', onclick: () => { X.sluitBlad(); startKnik(); } })));
    // weghalen: bewaard in het archief van de ruimte
    const bevestig = h('div', { class: 'opn-onderrij' });
    const weg = h('button', { type: 'button', class: 'opn-btn opn-btn-klein opn-gevaar', text: 'Verwijderen van de wand', onclick: () => {
      X.leeg(bevestig); bevestig.appendChild(h('p', { class: 'opn-waarschuwing', text: 'Zeker? De ingevulde maten blijven bewaard in het archief van de opname.' }));
      bevestig.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein opn-gevaar', text: 'Ja, verwijderen', onclick: () => { if (X.wijzig(K.verwijderItem(S.rec.opname, r.id, info.lijstNaam, id))) { const lay = X.wandLayout(S.wand); if (lay.vormen) delete lay.vormen[id]; X.bewaar(); X.sluitBlad(); S.stapId = null; X.teken(); } } }));
      bevestig.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Nee', onclick: () => X.sluitBlad() }));
    } });
    bevestig.appendChild(weg); kids.push(bevestig);
    X.blad(naam, kids);
  }

  M.X = X;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);

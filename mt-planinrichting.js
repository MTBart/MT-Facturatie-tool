/* ============================================================================
 * mt-planinrichting.js - Planning inrichten (P3b): stations, fases en activiteiten zelf aanmaken, hernoemen, ordenen en verwijderen
 * ----------------------------------------------------------------------------
 *  - De beheerlijst staat in Admin > Planning inrichten (beheerTeken). Op het bord gebruikt de beheerder dezelfde bewerkingen
 *    (labelEl, kolomToevoegEl, kolomVerwijderEl, sleepKop): hernoemen, "+ kolom", slepen = volgorde, verwijderen.
 *  - Voor wie niet beheert tekenen labelEl en co gewone tekst: niets lijkt bewerkbaar.
 *  - Een hernoeming verandert alleen het label: taken verwijzen naar het vaste id (activiteit; fase_id), dus er breekt niets.
 *  - Verwijderen kan alleen als er niets meer aan hangt; hangt er wel iets aan, dan kies je eerst waar het heen gaat (met bevestiging en Ongedaan maken).
 *  - Alles wordt opgeslagen via D.opslaan (mt_planinrichting: stempel per veld, samenvoegen per record). Ongedaan maken zet alleen de records terug die deze actie raakte.
 *  - Geen HTML-strings: alles met DOM-aanroepen.
 * ========================================================================== */
(function (root) {
  'use strict';
  const PI = {}; let D = null;
  const NAAM = { station: 'station', fase: 'fase', activiteit: 'activiteit' };
  const MEERVOUD = { station: 'Stations', fase: 'Fases', activiteit: 'Activiteiten' };
  const UITLEG = {
    station: 'De stappen van de stroom door het bedrijf (werkplaats-tv en Bord > Stroom). Eén lijst voor het hele bedrijf.',
    fase: 'De kolommen van Bord > Fase en de fases van het standaardsjabloon; een nieuw project krijgt deze lijst. Een project kan daarnaast eigen fases houden.',
    activiteit: 'Wat een taak is (tekenwerk, werkplaats, ...). Je kiest bij welk station een activiteit hoort en of het kantoor- of werkplaatsuren zijn.' };
  const UURSOORTEN = [['', 'Geen koppeling'], ['calculatie', 'calculatie'], ['ontwerpen', 'ontwerpen'], ['werkvoorbereiding', 'werkvoorbereiding'], ['productie', 'productie'], ['afwerking', 'afwerking'], ['transport', 'transport'], ['montage', 'montage']];
  PI.init = function (deps) { D = deps; };
  const doc = () => (D && D.doc) || root.document;
  const mag = () => { try { return !!(D && D.mag && D.mag()); } catch (e) { return false; } };
  PI.mag = mag;
  const kopie = v => JSON.parse(JSON.stringify(v));
  const toast = (t, undo, label, fout) => { try { if (D && D.toast) D.toast(t, undo || null, !!fout, label || 'Ongedaan maken'); } catch (e) {} };
  function el(tag, a, ...kids) {
    const e = doc().createElement(tag);
    Object.keys(a || {}).forEach(k => {
      const v = a[k]; if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v);
      else if (k === 'wijzig') e.addEventListener('change', v); else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = !!v; else if (k === 'disabled') e.disabled = true;
      else e.setAttribute(k, v === true ? '' : String(v));
    });
    kids.flat().forEach(c => { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === 'string' ? doc().createTextNode(c) : c); });
    return e;
  }
  const naamVan = r => r.label || r.k;
  const lijstVan = (recs, type) => recs.filter(r => r.type === type && !r._vervallen).sort((a, b) => ((Number(a.volgorde) || 0) - (Number(b.volgorde) || 0)) || String(naamVan(a)).localeCompare(String(naamVan(b)), 'nl'));
  const heer = type => D.planning.inrichting()[type === 'station' ? 'stations' : type === 'fase' ? 'fases' : 'activiteiten'];
  const model = () => D.planning.inrichting();
  const labelsVan = type => type === 'activiteit' ? model().activiteiten.map(a => [a.k, a.l]) : (type === 'station' ? model().stations : model().fases).map(x => [x.k, x.label]);

  // ── bewerken: één kern voor het beheer en het bord ──
  // mut(records) wijzigt de kopie en geeft eventueel { fout } of { noop } terug. Wat er veranderde wordt per record en per veld bijgehouden: Ongedaan maken zet alleen die velden terug, en alleen
  // als ze nog zijn zoals deze actie ze achterliet; wat een ander intussen wijzigde (ook aan hetzelfde record) blijft staan.
  const VELDEN = ['label', 'volgorde', 'station', 'soort', 'uursoort', 'namen', 'woorden'];
  const gelijk = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  function verschil(voor, na) {
    const vm = new Map(voor.map(r => [r.id, r])), nm = new Map(na.map(r => [r.id, r])), uit = [];
    nm.forEach((r, id) => { const v = vm.get(id); if (!v) uit.push({ id, soort: 'nieuw', na: kopie(r) }); else { const velden = VELDEN.filter(f => !gelijk(v[f], r[f])); if (velden.length) uit.push({ id, soort: 'wijzig', velden: velden.map(f => ({ f, voor: kopie(v[f] === undefined ? null : v[f]), na: kopie(r[f] === undefined ? null : r[f]) })) }); } });
    vm.forEach((v, id) => { if (!nm.has(id)) uit.push({ id, soort: 'weg', voor: kopie(v) }); });
    return uit;
  }
  function ongedaanRecords(nu, diffs) {
    const uit = kopie(nu), idx = id => uit.findIndex(r => r.id === id);
    diffs.forEach(d => {
      const i = idx(d.id);
      if (d.soort === 'nieuw') { if (i >= 0 && VELDEN.every(f => gelijk(uit[i][f], d.na[f]))) uit.splice(i, 1); }   // alleen weg als niemand het sindsdien wijzigde
      else if (d.soort === 'weg') { if (i < 0) uit.push(kopie(d.voor)); }
      else if (i >= 0) d.velden.forEach(x => { if (gelijk(uit[i][x.f], x.na)) { if (x.voor === null) delete uit[i][x.f]; else uit[i][x.f] = kopie(x.voor); } });
    });
    return uit;
  }
  PI._verschil = verschil; PI._ongedaanRecords = ongedaanRecords;
  async function bewerk(mut, tekst, extraUndo) {
    if (!mag()) { toast('Alleen de beheerder richt de planning in.', null, null, true); return { ok: false }; }
    const voor = D.records(), na = kopie(voor), r0 = mut(na, new Set());   // de tweede parameter is een oude hulp: de wijzigingen worden uit het verschil bepaald
    if (r0 && r0.noop) return { ok: true, noop: true };
    if (r0 && r0.fout) { toast(r0.fout, null, null, true); return { ok: false, reden: r0.fout }; }
    const diffs = verschil(voor, na);
    if (!diffs.length) return { ok: true, noop: true };
    const res = await D.opslaan(na);
    if (!res.ok) { toast(res.reden || 'Niet opgeslagen.', null, null, true); return res; }
    const undo = async () => {
      const o = await D.opslaan(ongedaanRecords(D.records(), diffs)); toast(o.ok ? 'Teruggezet.' : (o.reden || 'Niet teruggezet.'), null, null, !o.ok);
      if (o.ok && extraUndo) { try { await extraUndo(); } catch (e) { toast('Niet alles kon worden teruggezet.', null, null, true); } }   // bij verwijderen met verplaatsen: de taken gaan ook terug
      klaar();
    };
    toast(tekst + (res.lokaal ? ' (nog niet bevestigd door SharePoint)' : '') + '.', undo);
    klaar(); return { ok: true, ongedaan: undo };
  }  function klaar() { try { if (D.naWijziging) D.naWijziging(); } catch (e) {} }
  const hernummer = (recs, type) => lijstVan(recs, type).forEach((r, i) => { if (Number(r.volgorde) !== i + 1) r.volgorde = i + 1; });
  const zoek = (recs, type, k) => recs.find(r => r.type === type && String(r.k) === String(k) && !r._vervallen);
  PI.hernoem = async function (type, k, label) {
    const fout = D.planning.inrichtLabelFout(type, label, k, model()); if (fout) { toast(fout, null, null, true); return { ok: false, reden: fout }; }
    const l = String(label).trim();
    return bewerk((recs, ger) => {
      const r = zoek(recs, type, k); if (!r) return { fout: 'Dit bestaat niet meer.' };
      if (r.label === l) return { noop: true };
      if (type === 'fase') { const namen = new Set((r.namen || []).concat([r.label]).filter(Boolean)); namen.delete(l); r.namen = [...namen]; }   // de oude naam blijft een alias: taken met alleen die naam blijven aan deze fase hangen
      r.label = l; ger.add(r.id);
    }, '"' + l + '" is de nieuwe naam');
  };
  PI.voegToe = async function (type, label, extra) {
    const fout = D.planning.inrichtLabelFout(type, label, '', model()); if (fout) { toast(fout, null, null, true); return { ok: false, reden: fout }; }
    const l = String(label).trim();
    if (type === 'activiteit' && !(extra && (extra.soort === 'kantoor' || extra.soort === 'wp'))) { const f = 'Kies eerst of dit kantooruren of werkplaatsuren zijn.'; toast(f, null, null, true); return { ok: false, reden: f }; }   // een nieuwe activiteit krijgt verplicht een soort
    return bewerk((recs, ger) => {
      const k = D.planning.inrichtNieuwK(type, l, recs), id = type + ':' + k, rec = { id, type, k, label: l, volgorde: lijstVan(recs, type).length + 1 };
      if (type === 'fase') rec.namen = [];
      if (type === 'activiteit') { const e = extra || {}; rec.soort = e.soort; rec.station = e.station || ''; rec.uursoort = e.uursoort || ''; if (e.woorden) rec.woorden = String(e.woorden); }
      recs.push(rec); ger.add(id);
    }, '"' + l + '" is toegevoegd');
  };
  PI.zet = async function (type, k, velden, tekst) {
    return bewerk((recs, ger) => { const r = zoek(recs, type, k); if (!r) return { fout: 'Dit bestaat niet meer.' }; Object.keys(velden).forEach(f => { if (velden[f] === '' && (f === 'station' || f === 'uursoort')) r[f] = ''; else r[f] = velden[f]; }); ger.add(r.id); }, tekst || 'Opgeslagen');
  };
  // Volgorde: k komt op index (0-based) binnen de actieve lijst van dat soort
  PI.verplaatsNaar = async function (type, k, index) {
    return bewerk((recs, ger) => {
      const lijst = lijstVan(recs, type), van = lijst.findIndex(r => String(r.k) === String(k)); if (van < 0) return { fout: 'Dit bestaat niet meer.' };
      const i = Math.max(0, Math.min(lijst.length - 1, index)); if (i === van) return { noop: true };
      const [r] = lijst.splice(van, 1); lijst.splice(i, 0, r);
      lijst.forEach((x, n) => { if (Number(x.volgorde) !== n + 1) { x.volgorde = n + 1; ger.add(x.id); } });
    }, 'Volgorde aangepast');
  };
  PI.verplaatsStap = (type, k, delta) => { const lijst = labelsVan(type), i = lijst.findIndex(([kk]) => kk === k); return i < 0 ? Promise.resolve({ ok: false }) : PI.verplaatsNaar(type, k, i + delta); };
  PI.verwijder = async function (type, k) {
    if (!mag()) { toast('Alleen de beheerder richt de planning in.', null, null, true); return { ok: false }; }
    const dlg = D.dialoog; if (!dlg) return { ok: false };
    const item = labelsVan(type).find(([kk]) => kk === k); if (!item) return { ok: false };
    const vers = async () => { try { if (D.vers) await D.vers(); } catch (e) { /* offline: de lokale stand geldt */ } };   // eerst de gezamenlijke stand van de taken lezen
    await vers();
    let gebruik = D.gebruik(type, k); const andere = labelsVan(type).filter(([kk]) => kk !== k);
    const sj = (gebruik.sjablonen || []).length;
    let doel = null;   // null = niets te verplaatsen; { k: '' } = zonder
    if (gebruik.n > 0 || sj > 0) {
      const opties = andere.map(([kk, ll]) => ({ k: kk, label: ll })).concat(type === 'station' ? [{ k: '', label: 'Geen station' }] : type === 'fase' ? [{ k: '', label: 'Geen fase' }] : [{ k: '', label: 'Niet ingedeeld' }]);
      const wat = type === 'station' ? gebruik.n + (gebruik.n === 1 ? ' activiteit' : ' activiteiten') : gebruik.n + (gebruik.n === 1 ? ' taak' : ' taken');
      if (sj) { await dlg.alert({ title: 'Nog in gebruik', message: '"' + item[1] + '" staat nog in ' + sj + ' projectsjabloon' + (sj === 1 ? '' : 'nen') + ' (' + gebruik.sjablonen.join(', ') + '). Pas eerst het sjabloon aan.' }); return { ok: false }; }
      const i = await dlg.choose({ title: 'Waar gaan ze heen?', message: '"' + item[1] + '" wordt nog gebruikt door ' + wat + (type === 'station' ? ' (' + gebruik.activiteiten.join(', ') + ')' : '') + '.\nKies waar ze heen gaan; daarna wordt "' + item[1] + '" verwijderd.', choices: opties.map(o => ({ label: o.label })) });
      if (i === null || i === undefined || !opties[i]) return { ok: false };
      doel = opties[i];
    } else if (!(await dlg.confirm({ title: '"' + item[1] + '" verwijderen?', message: 'Er hangt niets meer aan. Je kunt het met Ongedaan maken terugzetten.', okLabel: 'Verwijderen', danger: true }))) return { ok: false };
    if (doel !== null && !(await dlg.confirm({ title: 'Verplaatsen en verwijderen', message: gebruik.n + ' ' + (type === 'station' ? 'activiteit(en)' : 'taak/taken') + ' gaan naar "' + doel.label + '" en "' + item[1] + '" wordt verwijderd.', okLabel: 'Doorgaan' }))) return { ok: false };
    const herstel = [];   // wat is verplaatst, voor het terugdraaien
    const terugdraaien = async () => { if (!herstel.length) return ''; const h = await D.verplaatsHerstel(herstel.splice(0)); return h.ok ? ' De al verplaatste taken zijn teruggezet.' : ' Let op: ' + h.mislukt.length + ' al verplaatste taak/taken konden niet terug (iemand wijzigde ze intussen).'; };
    if (type !== 'station') {   // eerst de taken (zij wijzen naar dit id), daarna pas het record; na het verplaatsen opnieuw kijken of er intussen weer taken aan zijn gekomen (hooguit drie rondes)
      for (let ronde = 0; ronde < 3 && (gebruik.n > 0); ronde++) {
        toast('Taken verplaatsen...');
        const v = await D.verplaats(type, k, doel ? doel.k : '', (i, n) => { try { if (D.voortgang) D.voortgang(i, n); } catch (e) { /* alleen de voortgang */ } });
        (v.wijzigingen || []).forEach(w => herstel.push(w));
        if (!v.ok) { const extra = await terugdraaien(); toast((v.mislukt && v.mislukt.length ? v.mislukt.length + ' taak/taken konden niet verplaatst worden (' + v.mislukt[0].reden + ')' : (v.reden || 'Niet verplaatst')) + '; er is niets verwijderd.' + extra, null, null, true); return { ok: false }; }
        await vers(); gebruik = D.gebruik(type, k);
      }
      if (gebruik.n === 0 && (gebruik.sjablonen || []).length) { const extra = await terugdraaien(); toast('Intussen staat "' + item[1] + '" in een projectsjabloon (' + gebruik.sjablonen.join(', ') + '); er is niets verwijderd.' + extra, null, null, true); return { ok: false }; }
      if (gebruik.n > 0) { const extra = await terugdraaien(); toast('Er hangen steeds weer nieuwe taken aan "' + item[1] + '"; er is niets verwijderd.' + extra, null, null, true); return { ok: false }; }
    }
    const res = await bewerk((recs) => {
      const r = zoek(recs, type, k); if (!r) return { fout: 'Dit bestaat niet meer.' };
      if (type === 'station') recs.forEach(a => { if (a.type === 'activiteit' && !a._vervallen && String(a.station) === String(k)) a.station = doel ? doel.k : ''; });
      recs.splice(recs.indexOf(r), 1); hernummer(recs, type);
    }, '"' + item[1] + '" is verwijderd', herstel.length ? async () => { const h = await D.verplaatsHerstel(herstel); if (!h.ok) toast(h.mislukt.length + ' taak/taken konden niet terug (iemand wijzigde ze intussen).', null, null, true); } : null);
    if (!res.ok && !res.lokaal && herstel.length) { const extra = await terugdraaien();   // lokaal: het staat wel lokaal (de tombstone synchroniseert later); dan blijven de taken bij het doel, anders zouden ze naar het verdwenen item wijzen
      if (extra) toast('Het verwijderen is niet gelukt.' + extra, null, null, true); }
    return res;
  };
  // ── het bord: koppen en knoppen die alleen de beheerder ziet ──
  // Een label: voor de beheerder een knop (klik = hernoemen), voor anderen gewone tekst.
  PI.labelEl = function (type, k, label, o) {
    o = o || {};
    if (!mag() || !D) return el(o.tag || 'span', { klass: o.klass, tekst: label });
    const b = el('button', { type: 'button', klass: (o.klass ? o.klass + ' ' : '') + 'pi-naam', title: 'Klik om te hernoemen', 'aria-label': 'Hernoem ' + NAAM[type] + ' ' + label, tekst: label });
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      const inv = el('input', { type: 'text', klass: 'pi-invoer', value: label, 'aria-label': 'Nieuwe naam van ' + label, maxlength: '60' });
      let klaarMet = false;
      const bewaar = async () => { if (klaarMet) return; klaarMet = true; const w = inv.value.trim(); if (!w || w === label) { b.style.display = ''; inv.remove(); return; } const r = await PI.hernoem(type, k, w); if (!r.ok) { b.style.display = ''; inv.remove(); } };
      inv.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); bewaar(); } else if (e.key === 'Escape') { klaarMet = true; b.style.display = ''; inv.remove(); } });
      inv.addEventListener('blur', bewaar);
      b.style.display = 'none'; b.parentNode.insertBefore(inv, b.nextSibling); inv.focus(); inv.select();
    });
    return b;
  };
  PI.kolomToevoegEl = function (type, o) {
    if (!mag() || !D) return null;
    return el('button', { type: 'button', klass: (o && o.klass ? o.klass + ' ' : '') + 'pi-plus', title: 'Nieuwe ' + NAAM[type] + ' toevoegen', tekst: '+ ' + (type === 'station' ? 'station' : 'kolom'), klik: async () => {
      const dlg = D.dialoog; if (!dlg || !dlg.prompt) return;
      const w = await dlg.prompt({ title: 'Nieuwe ' + NAAM[type], message: UITLEG[type], placeholder: 'Naam', okLabel: 'Toevoegen' });
      const l = String(w == null ? '' : w).replace(/\s+/g, ' ').trim(); if (!l) return;
      await PI.voegToe(type, l);
    } });
  };
  PI.kolomVerwijderEl = function (type, k, label, o) {
    if (!mag() || !D) return null;
    return el('button', { type: 'button', klass: (o && o.klass ? o.klass + ' ' : '') + 'pi-weg', title: 'Verwijder ' + NAAM[type] + ' ' + label, 'aria-label': 'Verwijder ' + NAAM[type] + ' ' + label, tekst: '×', klik: ev => { ev.stopPropagation(); PI.verwijder(type, k); } });
  };
  // Een kop (kolomkop of tabelkop) versleepbaar maken om de volgorde te wijzigen; doelen zijn de andere koppen met dezelfde data-pi-type. Alleen voor de beheerder.
  const DT = 'application/x-mt-inrichting';
  PI.sleepKop = function (kop, type, k) {
    if (!mag() || !D || !kop) return;
    kop.setAttribute('draggable', 'true'); kop.setAttribute('data-pi-type', type); kop.setAttribute('data-pi-k', k);
    kop.addEventListener('dragstart', ev => { try { ev.dataTransfer.setData(DT, type + '|' + k); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} });
    kop.addEventListener('dragover', ev => { const t = ev.dataTransfer && Array.from(ev.dataTransfer.types || []); if (t && t.includes(DT)) { ev.preventDefault(); kop.classList.add('pi-doel'); } });
    kop.addEventListener('dragleave', () => kop.classList.remove('pi-doel'));
    kop.addEventListener('drop', ev => {
      kop.classList.remove('pi-doel'); let d = ''; try { d = ev.dataTransfer.getData(DT); } catch (e) {}
      const [t, van] = d.split('|'); if (t !== type || !van || van === k) return;
      ev.preventDefault(); const lijst = labelsVan(type), naar = lijst.findIndex(([kk]) => kk === k); if (naar >= 0) PI.verplaatsNaar(type, van, naar);
    });
  };

  // ── de beheerlijst (Admin > Planning inrichten) ──
  function rij(type, r, recs, opties) {
    const k = String(r.k), n = D.gebruik(type, k), lijst = lijstVan(recs, type), i = lijst.findIndex(x => String(x.k) === k);
    const gebruikt = type === 'station' ? n.n + ' activiteit' + (n.n === 1 ? '' : 'en') : n.n + (n.n === 1 ? ' taak' : ' taken');
    const inv = el('input', { type: 'text', klass: 'pi-invoer', value: naamVan(r), 'aria-label': 'Naam van ' + naamVan(r), maxlength: '60' });
    inv.addEventListener('change', async () => { const w = inv.value.trim(); if (!w || w === naamVan(r)) { inv.value = naamVan(r); return; } const x = await PI.hernoem(type, k, w); if (!x.ok) inv.value = naamVan(r); });
    const knoppen = [
      el('button', { type: 'button', klass: 'pi-knop', 'aria-label': 'Naar boven: ' + naamVan(r), title: 'Naar boven', tekst: '↑', disabled: i <= 0 ? true : null, klik: () => PI.verplaatsStap(type, k, -1) }),
      el('button', { type: 'button', klass: 'pi-knop', 'aria-label': 'Naar beneden: ' + naamVan(r), title: 'Naar beneden', tekst: '↓', disabled: i >= lijst.length - 1 ? true : null, klik: () => PI.verplaatsStap(type, k, 1) })];
    const extra = [];
    if (type === 'activiteit') {
      const st = [['', 'Geen station']].concat(model().stations.map(s => [s.k, s.label]));
      extra.push(
        el('select', { klass: 'pi-sel', 'aria-label': 'Station van ' + naamVan(r), title: 'Bij welk station hoort deze activiteit?', wijzig: ev => PI.zet('activiteit', k, { station: ev.target.value }, 'Station van "' + naamVan(r) + '" aangepast') }, st.map(([v, l]) => el('option', { value: v, tekst: l, selected: String(r.station || '') === v ? true : null }))),
        el('select', { klass: 'pi-sel', 'aria-label': 'Soort uren van ' + naamVan(r), title: 'Kantooruren of werkplaatsuren (telt mee in de projectmeter)', wijzig: ev => PI.zet('activiteit', k, { soort: ev.target.value }, 'Soort uren van "' + naamVan(r) + '" aangepast') }, [['kantoor', 'Kantooruren'], ['wp', 'Werkplaatsuren']].map(([v, l]) => el('option', { value: v, tekst: l, selected: (r.soort === 'kantoor' ? 'kantoor' : 'wp') === v ? true : null }))),
        el('input', { type: 'text', klass: 'pi-invoer pi-woorden', value: r.woorden || '', placeholder: 'herken aan woorden (komma)', 'aria-label': 'Herken ' + naamVan(r) + ' aan woorden in de taaknaam', title: 'Taken met een van deze woorden in de naam krijgen deze activiteit als voorstel; leeg = geen voorstel', wijzig: ev => PI.zet('activiteit', k, { woorden: ev.target.value.trim() }, 'Herkenningswoorden van "' + naamVan(r) + '" aangepast') }),
        el('select', { klass: 'pi-sel', 'aria-label': 'Uursoort van de calculatie bij ' + naamVan(r), title: 'Uren van deze uursoort in de calculatie worden aan deze activiteit gekoppeld', wijzig: ev => PI.zet('activiteit', k, { uursoort: ev.target.value }, 'Calculatiekoppeling van "' + naamVan(r) + '" aangepast') }, UURSOORTEN.map(([v, l]) => el('option', { value: v, tekst: v ? 'Calculatie: ' + l : l, selected: String(r.uursoort || '') === v ? true : null }))));
    }
    const tr = el('div', { klass: 'pi-rij', role: 'listitem' }, el('div', { klass: 'pi-pos' }, knoppen), inv, extra, el('span', { klass: 'pi-gebruik', tekst: gebruikt }),
      el('button', { type: 'button', klass: 'pi-knop pi-verwijder', 'aria-label': 'Verwijder ' + naamVan(r), title: 'Verwijderen', tekst: 'Verwijder', klik: () => PI.verwijder(type, k) }));
    return tr;
  }
  function nieuwRij(type, recs) {
    const inv = el('input', { type: 'text', klass: 'pi-invoer', placeholder: 'Nieuwe ' + NAAM[type], 'aria-label': 'Naam van de nieuwe ' + NAAM[type], maxlength: '60' });
    const st = type === 'activiteit' ? el('select', { klass: 'pi-sel', 'aria-label': 'Station van de nieuwe activiteit' }, [['', 'Geen station']].concat(model().stations.map(s => [s.k, s.label])).map(([v, l]) => el('option', { value: v, tekst: l }))) : null;
    const so = type === 'activiteit' ? el('select', { klass: 'pi-sel', 'aria-label': 'Soort uren van de nieuwe activiteit', title: 'Verplicht: kantooruren of werkplaatsuren' }, [['', 'Kies de soort uren...'], ['wp', 'Werkplaatsuren'], ['kantoor', 'Kantooruren']].map(([v, l]) => el('option', { value: v, tekst: l }))) : null;
    const voeg = async () => { const w = inv.value.trim(); if (!w) { inv.focus(); return; } const r = await PI.voegToe(type, w, { station: st ? st.value : '', soort: so ? so.value : '' }); if (r.ok) inv.value = ''; };
    inv.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); voeg(); } });
    return el('div', { klass: 'pi-rij pi-nieuw' }, inv, st, so, el('button', { type: 'button', klass: 'pi-knop pi-plus', tekst: '+ Toevoegen', klik: voeg }));
  }
  PI.beheerTeken = function (host) {
    if (!host || !D) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    stijl();
    host.appendChild(el('h2', { klass: 'pi-kop', tekst: 'Planning inrichten' }));
    if (!mag()) { host.appendChild(el('p', { klass: 'pi-uitleg', tekst: 'Alleen de beheerder richt de planning in.' })); return; }
    host.appendChild(el('p', { klass: 'pi-uitleg', tekst: 'Hernoemen verandert alleen de naam: taken, de tv en de sjablonen blijven kloppen. Verwijderen kan pas als er niets meer aan hangt; anders kies je eerst waar het heen gaat. Elke wijziging is met Ongedaan maken terug te zetten.' }));
    const recs = D.records();
    ['station', 'fase', 'activiteit'].forEach(type => {
      const sec = el('section', { klass: 'pi-sec', 'aria-label': MEERVOUD[type] }, el('h3', { tekst: MEERVOUD[type] }), el('p', { klass: 'pi-uitleg', tekst: UITLEG[type] }));
      const lijst = el('div', { role: 'list', klass: 'pi-lijst' }, lijstVan(recs, type).map(r => rij(type, r, recs)), nieuwRij(type, recs));
      sec.appendChild(lijst); host.appendChild(sec);
    });
    host.appendChild(migratieEl());
  };
  function migratieEl() {
    const sec = el('section', { klass: 'pi-sec', 'aria-label': 'Fases aan taken koppelen' }, el('h3', { tekst: 'Fases aan taken koppelen' }),
      el('p', { klass: 'pi-uitleg', tekst: 'Taken bewaren hun fase op naam. Hiermee krijgen bestaande taken ook het vaste id van hun fase, zodat een hernoeming niets meer losmaakt. Eerst kijk je wat er zou gebeuren; pas na je akkoord wordt er geschreven, taak voor taak, met controle achteraf.' }));
    const uit = el('div', { klass: 'pi-uit', role: 'status' });
    const kijk = el('button', { type: 'button', klass: 'pi-knop', tekst: 'Controleer (schrijft niets)', klik: () => {
      const p = D.migratiePlan(); while (uit.firstChild) uit.removeChild(uit.firstChild);
      uit.appendChild(el('p', { tekst: p.totaal + ' taken bekeken: ' + p.zet.length + ' krijgen een fase-id, ' + p.klaar + ' zijn al gekoppeld, ' + p.eigen.length + ' hebben een eigen fase van het project (blijven op naam).' }));
      if (p.zet.length) uit.appendChild(el('button', { type: 'button', klass: 'pi-knop pi-plus', tekst: 'Koppel ' + p.zet.length + ' taken', klik: async ev => {
        const dlg = D.dialoog; if (dlg && !(await dlg.confirm({ title: 'Fases aan taken koppelen', message: p.zet.length + ' taken krijgen het id van hun fase. Dit kan een tijdje duren en kan niet in één keer ongedaan gemaakt worden.', okLabel: 'Doorgaan' }))) return;
        ev.target.disabled = true; const r = await D.migratieUitvoer((i, n) => { ev.target.textContent = 'Bezig... ' + i + ' van ' + n; });
        while (uit.firstChild) uit.removeChild(uit.firstChild);
        uit.appendChild(el('p', { tekst: r.ok ? 'Klaar en gecontroleerd: ' + r.gelukt + ' taken gekoppeld, er staat niets meer open.' : 'Niet alles gelukt: ' + r.gelukt + ' gekoppeld, ' + (r.mislukt ? r.mislukt.length : 0) + ' niet' + (r.over ? ' (' + r.over + ' staan nog open)' : '') + '. Probeer het opnieuw.' }));
      } }));
    } });
    sec.appendChild(kijk); sec.appendChild(uit); return sec;
  }
  let gestijld = false;
  function stijl() {
    const d = doc(); if (gestijld || !d || !d.head || d.getElementById('mt-pi-stijl')) { gestijld = true; return; }
    const s = d.createElement('style'); s.id = 'mt-pi-stijl';
    s.textContent = '.pi-kop{font-size:18px;margin:0 0 6px}.pi-uitleg{font-size:13px;color:var(--text-dim,#666);margin:0 0 10px;max-width:70ch}.pi-sec{margin:0 0 22px}.pi-sec h3{font-size:14px;margin:0 0 4px}'
      + '.pi-rij{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--border,#eee)}.pi-pos{display:flex;gap:2px}'
      + '.pi-invoer{width:auto;min-width:180px;flex:1 1 180px;max-width:320px;padding:6px 8px;border:1px solid var(--border,#ccc);border-radius:6px;font:inherit;min-height:34px}'
      + '.pi-sel{width:auto;flex:0 1 190px;min-width:0;padding:5px 6px;border:1px solid var(--border,#ccc);border-radius:6px;font:inherit;min-height:34px;background:var(--surface,#fff)}'
      + '.pi-knop{min-height:34px;min-width:34px;padding:0 10px;border:1px solid var(--border,#ccc);border-radius:6px;background:var(--surface,#fff);cursor:pointer;font:inherit}.pi-knop:disabled{opacity:.4;cursor:default}.pi-plus{color:var(--green,#2A4A38);font-weight:600}.pi-verwijder{color:#b3261e}'
      + '.pi-gebruik{font-size:12px;color:var(--text-faint,#888);min-width:90px}.pi-uit{margin-top:8px;font-size:13px}'
      + '.pi-naam{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:text;text-align:left;text-decoration:underline dotted;text-underline-offset:3px}.pi-weg{border:0;background:none;cursor:pointer;color:var(--text-faint,#888);font-size:16px;line-height:1;padding:0 4px}'
      + '.pi-doel{outline:2px dashed var(--green,#2A4A38);outline-offset:-2px}[data-pi-type][draggable=true]{cursor:grab}';
    d.head.appendChild(s); gestijld = true;
  }
  PI.stijl = stijl;
  root.MTPlanInrichting = PI;
})(typeof window !== 'undefined' ? window : globalThis);

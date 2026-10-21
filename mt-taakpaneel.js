/* ============================================================================
 * mt-taakpaneel.js: het taakpaneel, de eerste objectdefinitie op het objectpaneel (mt-objectpaneel.js)
 * ----------------------------------------------------------------------------
 * Bart 21-10: "taken uitvouwen als je erop klikt, alles inzien en bewerken, overal zien waar de taak bij hoort en daarheen klikken; afhankelijkheden en bestellingen
 * zien; vanuit de tijdlijn de taak in de juiste bucket zetten en vanuit de buckets zien wanneer hij gepland is. Altijd overal volle controle."
 * Eigen link #taak/<projectcode>/<taak-id> (dezelfde vorm als de telefoon-deeplink, MTPlanning.deepLinkLees). Opent vanuit de Capaciteit, Mijn werk, Vandaag, de takenlijst
 * van een project en de zoekbalk: overal hetzelfde paneel. Inhoud: herkomst (klant › locatie › project, klikbaar), naam, status, persoon, fase (de bucket), datums met een
 * mini-tijdlijn ("Toon in tijdlijn"), raming, activiteit, prioriteit, notities, voorgangers/opvolgers (klikbaar), de bestellingen van het project, Toggl en verwijderen.
 * Schrijven alleen via de bestaande taakroutes (de cockpit geeft ze mee): velden via D.wijzig (MTPlanVerplaats.taakWijzig: takenSchrijf met het slot per taak, de tijdgrenzen,
 * de controle achteraf en ongedaan maken met stempelbewaking), datums via D.datums (de sleep-spec taakdatums, met de vraag over opvolgers), de rest via de functies van de projecttabel.
 * model() is rekenwerk zonder DOM, zodat het zonder de hele cockpit te testen is.
 * ========================================================================== */
(function (root) {
  'use strict';
  const T = {};
  let D = null, P = null, O = null;

  // ── kleine hulpjes ──
  const zelfde = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const sleutelVan = (obj, code) => Object.keys(obj && typeof obj === 'object' ? obj : {}).find(k => !k.startsWith('__') && zelfde(k, code));
  const ymdOk = s => !!(P && P.isYmd(s));
  const datum = s => ymdOk(s) ? P.datumKort(s) : '';
  const STATUS_KL = { todo: 'open', bezig: 'bezig', wacht: 'wacht', klaar: 'klaar' };
  const PRIO = { high: 'P1 hoog', medium: 'P2 normaal', low: 'P3 laag' };
  const persNaam = slug => { const m = ((D && D.team && D.team()) || []).find(x => x && zelfde(x.slug, slug)); return m ? m.naam : String(slug || ''); };
  const mag = wat => { try { return !!(D.mag && D.mag[wat] && D.mag[wat]()); } catch (e) { return false; } };
  const naWijziging = () => { if (D.naWijziging) { try { D.naWijziging(); } catch (e) {} } };
  const toast = (t, o, l, lb) => O.H.toast(t, o, l, lb);

  T.href = (code, id) => P.deepLinkTaak('', code, id);
  // De fasen (buckets) waarin taken van dit project staan, plus die van het standaardsjabloon; de taak bewaart de naam van de fase (zoals het sjabloon hem zet)
  const faseOpties = (lijst, huidig) => {
    const namen = []; const voeg = n => { const s = String(n || '').trim(); if (s && !namen.some(x => zelfde(x, s))) namen.push(s); };
    try { (P.sjabloonStd().fases || []).forEach(f => voeg(f.naam)); } catch (e) {}
    (lijst || []).forEach(t => voeg(t.fase)); voeg(huidig);
    return namen;
  };

  // ── rekenwerk (geen DOM) ──
  // → { ok:false } | { ok:true, sleutel, code, taak, project, voorgangers, opvolgers, wacht, bestel, mensen, raming, fasen, blokken }
  T.model = function (code, id) {
    const alle = D.taken() || {}, k = sleutelVan(alle, code), lijst = k ? (alle[k] || []).filter(x => x && !x._vervallen) : [];
    const t = lijst.find(x => String(x.id) === String(id));
    if (!t) return { ok: false, code, id };
    const pr = (D.project && D.project(k || code)) || { code: k || code, naam: '', nummer: '' };
    const afh = D.afhank() || {}, ak = sleutelVan(afh, k || code), depsRuw = ak && Array.isArray(afh[ak]) ? afh[ak] : [];
    const vrij = D.vrij ? D.vrij() : null, vandaag = P.vandaagYmd();
    const perId = new Map(lijst.map(x => [String(x.id), x]));
    const kort = x => ({ id: x.id, naam: x.naam || '(zonder naam)', status: x.status || 'todo', start: ymdOk(x.start) ? x.start : '', eind: ymdOk(x.eind) ? x.eind : '', soort: x.soort || '' });
    // FS met wachttijd: de opvolger begint op zijn vroegst `lag` werkdagen + 1 na het eind van de voorganger (een mijlpaal: `lag` werkdagen erna, zoals P.rooster)
    const vroegst = (voor, lag, na) => ymdOk(voor.eind) ? P.addWerkdagen(voor.eind, (Number(lag) || 0) + (na && na.soort === 'mijlpaal' ? 0 : 1), vrij) : '';
    let edges = []; try { edges = P.depsEffectief(lijst, depsRuw); } catch (e) { edges = []; }
    const voorgangers = edges.filter(e => String(e.naar) === String(t.id)).map(e => {
      const v = perId.get(String(e.van)); if (!v) return null;
      const r = Object.assign(kort(v), { lag: e.lag || 0, inactief: !!e.inactief, vroegst: vroegst(v, e.lag, t) });
      r.botst = !r.inactief && r.status !== 'klaar' && ymdOk(t.start) && !!r.vroegst && t.start < r.vroegst;
      return r;
    }).filter(Boolean);
    const opvolgers = edges.filter(e => String(e.van) === String(t.id)).map(e => {
      const n = perId.get(String(e.naar)); if (!n) return null;
      const r = Object.assign(kort(n), { lag: e.lag || 0, inactief: !!e.inactief, vroegst: vroegst(t, e.lag, n) });
      r.botst = !r.inactief && (t.status || 'todo') !== 'klaar' && r.status !== 'klaar' && !!r.start && !!r.vroegst && r.start < r.vroegst;
      return r;
    }).filter(Boolean);
    let wacht = { wacht: false, op: [] }; try { wacht = P.taakWacht(t, lijst, depsRuw, { vrij, vandaag }); } catch (e) {}
    // Bestellingen: er is (nog) geen koppeling per taak; dit zijn de regels van het project (zelfde regel als MTPlanning.projectStroom).
    const VOLG = { nodig: 0, besteld: 1, geleverd: 2 };
    const regels = (D.bestel ? D.bestel() || [] : []).filter(b => b && typeof b === 'object' && !b._vervallen && b.id !== '__migratie' && ((b.project_id && pr.project_id && b.project_id === pr.project_id) || zelfde(b.project, pr.code)))
      .map(b => { const st = P.bestelStatus(b); return { id: b.id, oms: P.bestelOms(b) || 'regel', aantal: b.aantal || 1, eenheid: P.eenheidTekst(b.eenheid, b.aantal || 1), leverancier: b.leverancier || '', status: st, label: P.BESTEL_STATUS_LABEL[st] || st, voorstel: b.voorstel ? P.voorstelTekst(b.voorstel) : '' }; })
      .sort((a, b) => (VOLG[a.status] - VOLG[b.status]) || String(a.oms).localeCompare(String(b.oms), 'nl'));
    const tel = { nodig: 0, besteld: 0, geleverd: 0 }; regels.forEach(r => { tel[r.status] = (tel[r.status] || 0) + 1; });
    const materiaal = t.sleutel === 'bestellen' || t.sleutel === 'materiaal_geleverd' || (t.status === 'wacht' && /\b(materiaal|plaat|platen|beslag|bestel|besteld|bestelling|levering|leverancier|geleverd|order)/i.test(String(t.wacht_reden || '')));
    // Planblokken die (nog) aan deze taak hangen (oude tb:-blokken), voor de mini-tijdlijn
    let blokken = []; try { if (D.blokken && P.taakBlokkenVan) blokken = P.taakBlokkenVan(t, lijst, k, D.blokken() || [], alle).filter(b => b && ymdOk(b.datum)).map(b => ({ datum: b.datum, persoon: b.persoon || '', min: Number(b.duurMin) || 0, voorstel: b.status === 'voorstel' })); } catch (e) { blokken = []; }
    return { ok: true, sleutel: { code: k || code, id: t.id }, code: k || code, taak: t, project: pr, voorgangers, opvolgers, wacht, bestel: { regels, tel, materiaal }, mensen: P.taakMensen(t), raming: P.taakRamingMin(t), fasen: faseOpties(lijst, t.fase), blokken };
  };

  // De mini-tijdlijn (rekenwerk): een venster van hele weken rond de taak (minstens 4, hoogstens 12), met de balk en de planblokken als percentages
  const dnr = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const ymdVan = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
  const maandag = n => n - (((n + 4) % 7 + 7) % 7 + 6) % 7;
  T.tijdlijnModel = function (m, vandaag) {
    const t = m.taak, nu = dnr(vandaag || P.vandaagYmd());
    const punten = [t.start, t.eind].filter(ymdOk).map(dnr).concat(m.blokken.map(b => dnr(b.datum)));
    if (!punten.length) return null;
    let van = maandag(Math.min(...punten)) - 7, tot = maandag(Math.max(...punten)) + 14;   // een week ervoor, een week erna
    if (tot - van < 28) tot = van + 28; if (tot - van > 84) tot = van + 84;
    const pct = n => Math.max(0, Math.min(100, (n - van) / (tot - van) * 100));
    const weken = []; for (let n = van; n < tot; n += 7) weken.push({ links: pct(n), label: 'wk ' + isoWeek(ymdVan(n)) });
    const balk = ymdOk(t.start) ? { links: pct(dnr(t.start)), breed: Math.max(1.2, pct(dnr(ymdOk(t.eind) ? t.eind : t.start) + 1) - pct(dnr(t.start))) } : null;
    return { van: ymdVan(van), tot: ymdVan(tot - 1), weken, balk, blokken: m.blokken.map(b => ({ links: pct(dnr(b.datum)), breed: Math.max(1, pct(dnr(b.datum) + 1) - pct(dnr(b.datum))), datum: b.datum, voorstel: b.voorstel })), nu: nu >= van && nu < tot ? pct(nu) : null };
  };
  function isoWeek(s) { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))), dag = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dag); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }

  // "6", "6,5", "2u30", "1:30", "90m" → uren (2 decimalen); leeg = 0; anders null
  T.leesUren = function (x) {
    const s = String(x == null ? '' : x).trim().toLowerCase().replace(',', '.'); let m;
    if (s === '') return 0;
    if ((m = /^(\d+(?:\.\d+)?)\s*(?:u|uur|h)?$/.exec(s))) return Math.round(Number(m[1]) * 100) / 100;
    if ((m = /^(\d+)\s*(?:u|uur|h|:)\s*(\d{1,2})\s*(?:m|min)?$/.exec(s))) return Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100;
    if ((m = /^(\d+)\s*(?:m|min|minuten)$/.exec(s))) return Math.round(Number(m[1]) / 60 * 100) / 100;
    return null;
  };
  const urenTekst = u => { const n = Number(u) || 0; return n ? String(n).replace('.', ',') : ''; };

  // ── tekenen (met de bouwstenen van het objectpaneel) ──
  function herkomst(m, h) {
    const pr = m.project, hr = D.href || {}, g = D.ga || {};
    return h.kruimels([
      pr.klant ? { kids: pr.klantNaam || pr.klant, href: hr.klant ? hr.klant(pr.klant) : '#', ga: () => g.klant(pr.klant), titel: 'Naar de klant' } : null,
      pr.klant && pr.loc ? { kids: pr.locNaam || pr.loc, href: hr.klant ? hr.klant(pr.klant, pr.loc) : '#', ga: () => g.klant(pr.klant, pr.loc), titel: 'Naar de locatie' } : null,
      { kids: [pr.nummer ? h.el('span', { klass: 'tp-code', tekst: pr.nummer }) : null, pr.nummer ? ' ' : '', pr.naam || m.code], href: hr.project ? hr.project(m.code) : '#', ga: () => g.project(m.code, 'planning'), titel: 'Naar het project (Planning & taken)', klass: 'tp-kruim-project' }]);
  }
  function taakItems(m, lijst, wat, h) {
    return lijst.map(x => ({ href: T.href(m.code, x.id), ga: () => T.open(m.code, x.id), naam: x.naam, dot: 'tp-st-' + (STATUS_KL[x.status] || 'open'), titel: 'Open ' + x.naam,
      sub: [P.TAAK_STATUS_LABEL[x.status] || x.status, x.start ? (x.eind && x.eind !== x.start ? datum(x.start) + ' – ' + datum(x.eind) : datum(x.start)) : 'zonder datum', x.lag ? 'wachttijd ' + x.lag + ' werkdag' + (x.lag === 1 ? '' : 'en') : '', x.inactief ? 'koppeling staat uit' : ''].filter(Boolean).join(' · '),
      chips: x.botst ? [h.chip('let op', 'tp-chip-let', wat === 'voor' ? 'Eindigt te laat voor de start van deze taak' : 'Begint te vroeg na het eind van deze taak')] : null }));
  }
  function afhSectie(m, h) {
    const kids = [], t = m.taak;
    if (!m.voorgangers.length && !m.opvolgers.length) kids.push(h.el('p', { klass: 'tp-leeg', tekst: 'Geen voorgangers of opvolgers.' }));
    if (m.voorgangers.length) kids.push(h.el('div', { klass: 'tp-subkop', tekst: 'Eerst (voorgangers)' }), h.relatieLijst(taakItems(m, m.voorgangers, 'voor', h)));
    if (m.opvolgers.length) kids.push(h.el('div', { klass: 'tp-subkop', tekst: 'Daarna (opvolgers)' }), h.relatieLijst(taakItems(m, m.opvolgers, 'na', h)));
    const waarsch = m.voorgangers.filter(x => x.botst).map(x => x.naam + ' eindigt ' + datum(x.eind) + '; deze taak kan op zijn vroegst ' + datum(x.vroegst) + ' beginnen (nu ' + datum(t.start) + ').')
      .concat(m.opvolgers.filter(x => x.botst).map(x => x.naam + ' begint al ' + datum(x.start) + '; dat kan op zijn vroegst ' + datum(x.vroegst) + ' (na het eind van deze taak).'));
    if (waarsch.length) kids.push(h.el('div', { klass: 'tp-waarsch', role: 'note' }, h.icoon(h.IC.let), h.el('div', null, waarsch.map(w => h.el('div', { tekst: w })), h.el('div', { klass: 'tp-sub', tekst: 'Er wordt niets vanzelf verschoven.' }))));
    if ((t.status || 'todo') === 'todo' && m.wacht && m.wacht.wacht) kids.push(h.el('p', { klass: 'tp-sub', tekst: 'Wacht op: ' + P.wachtOpTekst(m.wacht, P.datumKort) }));
    return h.sectie('tp-h-afh', 'Afhankelijkheden', h.el('span', { klass: 'tp-teller', tekst: String(m.voorgangers.length + m.opvolgers.length) }), kids);
  }
  function bestelSectie(m, h) {
    const b = m.bestel, g = D.ga || {}, hr = D.href || {}, naarProject = () => { h.sluit({ stil: true }); g.project(m.code, 'productie'); };
    const tel = ['nodig', 'besteld', 'geleverd'].filter(s => b.tel[s]).map(s => b.tel[s] + ' ' + P.BESTEL_STATUS_LABEL[s].toLowerCase()).join(' · ');
    // elke regel is een link naar de bestellijst van het project (daar zet je de status; hier alleen inzien)
    const lijst = b.regels.length ? h.relatieLijst(b.regels.slice(0, 12).map(r => ({ href: hr.project ? hr.project(m.code, 'productie') : '#', ga: naarProject, naam: r.oms, titel: 'Naar de bestellijst van dit project',
      sub: [String(r.aantal).replace('.', ',') + ' ' + r.eenheid, r.leverancier, r.voorstel].filter(Boolean).join(' · '), chips: [h.chip(r.label, 'tp-bst-' + r.status)] }))) : h.el('p', { klass: 'tp-leeg', tekst: 'Dit project heeft geen bestelregels.' });
    const meer = b.regels.length > 12 ? h.el('p', { klass: 'tp-sub', tekst: '… en nog ' + (b.regels.length - 12) + ' regels' }) : null;
    const naar = h.el('div', { klass: 'tp-acties' },
      h.link(hr.project ? hr.project(m.code, 'productie') : '#', naarProject, 'Bestellijst van dit project', 'tp-link tp-knoplink'),
      h.link(hr.bestellijst ? hr.bestellijst() : '#', () => { h.sluit({ stil: true }); g.bestellijst(); }, 'Bestellijst (alle projecten)', 'tp-link tp-knoplink'));
    return h.el('details', { klass: 'tp-sec tp-details', open: b.materiaal || null },
      h.el('summary', null, h.el('h3', { id: 'tp-h-bestel', tekst: 'Bestellingen van dit project' }), h.el('span', { klass: 'tp-teller', tekst: tel || '0' })), lijst, meer,
      h.el('p', { klass: 'tp-sub', tekst: 'Bestelregels hangen aan het project, niet aan een losse taak.' }), naar);
  }
  // Datums: de bestaande sleeproute (taakdatums), met de getoonde datums mee zodat er niets stil overschreven wordt
  function datumVelden(m, h) {
    const t = m.taak, mijlpaal = t.soort === 'mijlpaal', klaar = (t.status || 'todo') === 'klaar';
    const waarom = !mag('plannen') ? 'Datums plannen is voor kantoor.' : klaar ? 'Een klare taak plan je niet meer in.' : t.voorstel ? 'Neem het voorstel eerst over; daarna kun je het inplannen.' : '';
    const tekst = ymdOk(t.start) ? (t.eind && t.eind !== t.start ? datum(t.start) + ' t/m ' + datum(t.eind) : datum(t.start)) : 'Nog niet ingepland';
    if (waarom || !D.datums) return h.el('div', null, h.el('span', { klass: 'tp-tekstwaarde', tekst }), waarom ? h.el('span', { klass: 'tp-sub', tekst: waarom }) : null);
    const s0 = ymdOk(t.start) ? t.start : '', e0 = ymdOk(t.eind) ? t.eind : s0;
    const a = h.el('input', { type: 'date', id: 'tp-v-start', klass: 'tp-invoer tp-datum', 'aria-label': mijlpaal ? 'Datum' : 'Start', value: s0 });
    const b = mijlpaal ? null : h.el('input', { type: 'date', id: 'tp-v-eind', klass: 'tp-invoer tp-datum', 'aria-label': 'Eind', value: e0 });
    let bezig = false;
    const opslaan = async () => {
      if (bezig) return;
      const s = a.value, e = b ? b.value : s;
      if (s === s0 && e === e0) return;
      if (!ymdOk(s) || !ymdOk(e)) { h.opslagStatus('fout', 'Vul een geldige ' + (b ? 'start en eind' : 'datum') + ' in.'); return; }
      if (e < s) { h.opslagStatus('fout', 'Het eind ligt voor de start; er is niets gewijzigd.'); return; }
      bezig = true; h.opslagStatus('bezig', 'Opslaan…');
      let r; try { r = await D.datums({ soort: 'taakdatums', taak: { code: m.code, id: t.id, naam: t.naam }, startDatum: s, eindDatum: e, gezien: { start: t.start || '', eind: t.eind || '' } }); } catch (x) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((x && x.message) || x) }; } finally { bezig = false; }
      h.tekenVeilig(); naWijziging();
      if (r && r.onzeker) { h.opslagStatus('fout', r.reden); return; }
      if (r && r.geannuleerd) { h.opslagStatus('', ''); return; }
      if (!r || !r.ok) { h.opslagStatus(r && r.tegelijk ? 'let' : 'fout', (r && r.reden) || 'Niet opgeslagen.', r && r.tegelijk ? null : () => { a.value = s; if (b) b.value = e; opslaan(); }); return; }
      if (r.noop) return;
      h.opslagStatus(r.tegelijk ? 'let' : 'ok', r.tegelijk || 'Opgeslagen');
    };
    // Een datumveld wijzigt al tijdens het typen van het jaar: opslaan bij Enter of wegklikken, niet bij elke wijziging
    [a, b].filter(Boolean).forEach(i => {
      i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); opslaan(); } else if (ev.key === 'Escape' && (a.value !== s0 || (b && b.value !== e0))) { ev.preventDefault(); ev.stopPropagation(); a.value = s0; if (b) b.value = e0; } });
      i.addEventListener('blur', () => setTimeout(() => { const f = D.doc.activeElement; if (f !== a && f !== b) opslaan(); }, 0));
    });
    return h.el('div', { klass: 'tp-datums' }, a, b ? h.el('span', { klass: 'tp-sub', tekst: 't/m' }) : null, b, h.el('span', { klass: 'tp-sub tp-uitleg', tekst: 'Hangen er opvolgers aan, dan vraag ik eerst of die mee schuiven.' }));
  }
  // De mini-tijdlijn: wanneer staat de taak gepland (balk op een weken-as, met de persoon, de planblokken en vandaag) en "Toon in tijdlijn"
  function tijdlijn(m, h) {
    const tl = T.tijdlijnModel(m), t = m.taak, wie = m.mensen.length ? m.mensen.map(persNaam).join(', ') : 'niemand';
    const toon = D.toonInTijdlijn ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', id: 'tp-toon-tijdlijn', title: 'Naar de capaciteitstijdlijn, met deze taak gemarkeerd', klik: () => D.toonInTijdlijn(m.code, t.id, ymdOk(t.start) ? t.start : (tl ? tl.van : '')) }, h.icoon(h.IC.tijd), 'Toon in tijdlijn') : null;
    if (!tl) {
      const inpl = D.inplannen && mag('plannen') && (t.status || 'todo') !== 'klaar' && !t.voorstel ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', klik: () => D.inplannen({ code: m.code, id: t.id, naam: t.naam, min: m.raming }), tekst: 'Inplannen…', title: 'Kies persoon en dag (zoals Inplannen in Vandaag)' }) : null;
      return h.el('div', { klass: 'tp-tl tp-tl-leeg' }, h.el('span', { klass: 'tp-sub', tekst: 'Nog niet ingepland: de taak staat in Ongepland.' }), h.el('span', { klass: 'tp-acties' }, inpl, toon));
    }
    const as = h.el('div', { klass: 'tp-tl-as', role: 'img', 'aria-label': 'Gepland ' + (ymdOk(t.start) ? datum(t.start) + (t.eind && t.eind !== t.start ? ' t/m ' + datum(t.eind) : '') : 'met planblokken') + ', ' + wie },
      tl.weken.map(w => h.el('span', { klass: 'tp-tl-wk', style: 'left:' + w.links.toFixed(2) + '%', tekst: w.label })),
      tl.balk ? h.el('span', { klass: 'tp-tl-balk tp-st-' + (STATUS_KL[t.status || 'todo'] || 'open'), style: 'left:' + tl.balk.links.toFixed(2) + '%;width:' + tl.balk.breed.toFixed(2) + '%;--block-color:' + P.projectKleur(m.code), title: datum(t.start) + (t.eind && t.eind !== t.start ? ' t/m ' + datum(t.eind) : '') + ' · ' + wie }) : null,
      tl.blokken.map(b => h.el('span', { klass: 'tp-tl-blok' + (b.voorstel ? ' voorstel' : ''), style: 'left:' + b.links.toFixed(2) + '%;width:' + b.breed.toFixed(2) + '%', title: 'Planblok ' + datum(b.datum) + (b.voorstel ? ' (voorstel)' : '') })),
      tl.nu !== null ? h.el('span', { klass: 'tp-tl-nu', style: 'left:' + tl.nu.toFixed(2) + '%', title: 'Vandaag' }) : null);
    return h.el('div', { klass: 'tp-tl' }, as, h.el('div', { klass: 'tp-tl-onder' }, h.el('span', { klass: 'tp-sub', tekst: wie + (m.blokken.length ? ' · ' + m.blokken.length + ' planblok' + (m.blokken.length === 1 ? '' : 'ken') : '') }), toon));
  }
  function velden(m, h) {
    const t = m.taak, team = (D.team && D.team()) || [], kan = mag('alles');
    const wieOpties = [['', 'Niemand']].concat(team.filter(x => x && x.slug).map(x => [x.slug, x.naam]));
    if (t.toegewezen && !team.some(x => zelfde(x.slug, t.toegewezen))) wieOpties.push([t.toegewezen, t.toegewezen + ' (niet in het team)']);
    const extra = m.mensen.slice(1).map(persNaam);
    const actOpties = [['', 'Niet ingedeeld']].concat(P.ACTIVITEITEN.map(a => [a.k, a.l]));
    const prioOpties = [['', 'Geen'], ['high', PRIO.high], ['medium', PRIO.medium], ['low', PRIO.low]];
    const faseKeuze = [['', 'Geen fase']].concat(m.fasen.map(f => [f, f]));
    return h.el('div', { klass: 'tp-velden' },
      h.rij('Wie', h.keuzeVeld('toegewezen', t.toegewezen || '', wieOpties, { kan, label: 'Wie', wat: 'persoon' }), extra.length ? h.el('span', { klass: 'tp-sub', tekst: 'ook: ' + extra.join(', ') }) : null),
      h.rij('Fase', h.keuzeVeld('fase', t.fase || '', faseKeuze, { kan, label: 'Fase (bucket)', wat: 'fase', titel: 'De fase waarin de taak staat (zoals in de fasenplanning en het sjabloon)' })),
      h.rij(t.soort === 'mijlpaal' ? 'Datum' : 'Datums', datumVelden(m, h), tijdlijn(m, h)),
      h.rij('Raming', t.soort === 'mijlpaal' ? h.el('span', { klass: 'tp-tekstwaarde', tekst: 'mijlpaal (telt niet mee)' })
        : h.el('div', { klass: 'tp-inline' }, h.tekstVeld('duur_uur', urenTekst(t.duur_uur), { kan, label: 'Raming in uren', klass: 'tp-kort', inputmode: 'decimal', placeholder: '0', lees: T.leesUren, fout: 'Geen geldige raming: typ bijvoorbeeld 6, 6,5 of 2u30. Er is niets gewijzigd.', gezien: String(t.duur_uur == null ? '' : t.duur_uur), wat: 'raming', titel: 'Uren: 6, 6,5, 2u30 of 90m' }), h.el('span', { klass: 'tp-sub', tekst: 'uur' + (m.raming ? ' · ' + P.fmtUurMin(m.raming) : '') }))),
      h.rij('Activiteit', h.keuzeVeld('activiteit', t.activiteit || '', actOpties, { kan, label: 'Activiteit', wat: 'activiteit' })),
      h.rij('Prioriteit', h.keuzeVeld('prioriteit', t.prioriteit || '', prioOpties, { kan, label: 'Prioriteit', wat: 'prioriteit' })),
      h.rij('Notities', h.tekstVeld('omschrijving', t.omschrijving || '', { kan, label: 'Notities', multi: true, placeholder: 'Notitie toevoegen…', wat: 'notities', titel: 'Ctrl+Enter of wegklikken = opslaan, Esc = annuleren' })));
  }
  function meta(m, h) {
    const t = m.taak, delen = [];
    if (t.klaar_op) delen.push('Klaar gemeld ' + datum(t.klaar_op));
    if (t.bron) delen.push('Bron: ' + ({ ai: 'AI-voorstel', handmatig: 'met de hand', sjabloon: 'sjabloon', werkplaats: 'werkplaats' }[t.bron] || t.bron));
    // Toggl: eerlijk wat de stand is, met de bestaande knop (projTaakTogglSync: altijd met bevestiging; MT is de bron)
    let tg = null; try { tg = P.tgActie ? P.tgActie(t) : null; } catch (e) { tg = null; }
    const tgTekst = { actueel: 'Toggl: gelijk', koppelen: 'Niet in Toggl', bijwerken: 'Toggl loopt achter', herkoppelen: 'Toggl-koppeling niet bevestigd', 'extern-verwijderd': 'Weg in Toggl' }[tg] || (t.tg_task_id ? 'Gekoppeld aan Toggl' : 'Niet in Toggl');
    const tgKnop = D.togglSync && mag('alles') && tg && tg !== 'actueel' ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: tg === 'koppelen' ? 'Naar Toggl…' : 'Toggl bijwerken…', title: 'Zet naam en status in Toggl gelijk met MT (met bevestiging)', klik: async () => { await D.togglSync(m.code, t.id); T.ververs(); } }) : null;
    const weg = D.verwijder && mag('alles') ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', tekst: 'Verwijderen…', title: 'Taak verwijderen (met bevestiging; een gekoppelde Toggl-taak gaat ook weg)', klik: async () => {
      const code = m.code, id = t.id; await D.verwijder(code, id);
      const nog = T.model(code, id); if (!nog.ok) { T.sluit(); naWijziging(); toast('Taak verwijderd. Hij staat in het takenjournaal.'); } else T.ververs();
    } }) : null;
    return h.el('div', { klass: 'tp-meta' }, h.el('div', { klass: 'tp-meta-regel' }, delen.map(x => h.el('span', { tekst: x })), h.el('span', { tekst: tgTekst }), tgKnop), weg ? h.el('div', { klass: 'tp-acties tp-onder' }, weg) : null);
  }
  // De status als vier zichtbare knoppen (geen rondgaande knop): Open · Bezig · Wacht (met een reden) · Klaar
  async function zetStatus(m, nieuw, h) {
    const t = m.taak, huidig = t.status || 'todo', dlg = h.dialoog;
    if (huidig === nieuw && nieuw !== 'wacht') return;
    let reden = '';
    if (nieuw === 'wacht') {
      if (!dlg || !dlg.prompt) return;
      for (let i = 0; i < 3; i++) {
        const r = await dlg.prompt({ title: 'Waarom wacht deze taak?', message: '"' + t.naam + '"', placeholder: 'Bijvoorbeeld: wacht op plaatmateriaal', defaultValue: i === 0 ? (t.wacht_reden || '') : '', okLabel: 'Zet op Wacht' });
        if (r === null || r === undefined) return;
        reden = String(r).replace(/\s+/g, ' ').trim(); if (reden.length >= 2) break;
        reden = ''; toast('Een reden is verplicht bij Wacht.');
      }
      if (!reden) return;
    } else if (huidig === 'todo' && m.wacht && m.wacht.wacht && dlg && dlg.confirm) {   // een taak die op een voorganger wacht start pas na een bevestiging (zoals in de projecttabel en op de telefoon)
      const ja = await dlg.confirm({ title: 'Deze taak wacht', message: '"' + t.naam + '" wacht op: ' + P.wachtOpTekst(m.wacht, P.datumKort) + '.\nToch ' + (nieuw === 'klaar' ? 'op klaar zetten' : 'starten') + '?', okLabel: 'Toch doorgaan' });
      if (!ja) return;
    }
    await h.bewaar({ velden: { status: nieuw }, gezien: { status: huidig, wacht_reden: t.wacht_reden || '', klaar_op: t.klaar_op || '' }, reden }, 'status ' + (P.TAAK_STATUS_LABEL[nieuw] || nieuw).toLowerCase());
  }
  function statusRij(m, h) {
    const st = m.taak.status || 'todo', kan = mag('status') && !!D.wijzig;
    const groep = h.el('div', { klass: 'tp-statusknoppen', role: 'group', 'aria-label': 'Status' }, P.TAAK_STATUSSEN.map(s => h.el('button', { type: 'button', klass: 'tp-stknop tp-st-' + STATUS_KL[s] + (s === st ? ' aan' : ''), 'aria-pressed': s === st ? 'true' : 'false', disabled: kan ? null : true, title: kan ? (s === 'wacht' ? 'Op Wacht zetten (met een reden)' : 'Zet op ' + P.TAAK_STATUS_LABEL[s]) : h.GEEN_RECHT, klik: () => zetStatus(m, s, h), tekst: P.TAAK_STATUS_LABEL[s] })));
    return h.el('div', null, h.el('div', { klass: 'tp-statusrij' }, groep),
      st === 'wacht' && m.taak.wacht_reden ? h.el('div', { klass: 'tp-sub tp-wachtreden', tekst: 'Wacht: ' + m.taak.wacht_reden }) : null, h.opslagZone());
  }
  // Voorstel van de werkplaats en een veldconflict: de bestaande functies van de projecttabel (met hun eigen meldingen)
  function meldingen(m, h) {
    const t = m.taak, kids = [];
    if (t.voorstel) {
      const kan = mag('alles') && D.neemOver;
      kids.push(h.el('div', { klass: 'tp-melding tp-voorstel' }, h.el('span', { tekst: P.voorstelTekst(t.voorstel) }),
        kan ? h.el('span', { klass: 'tp-acties' }, h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Overnemen', title: 'De markering eraf: het is dan een gewone taak', klik: async () => { await D.neemOver(m.code, t.id); T.ververs(); naWijziging(); } }),
          h.el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', tekst: 'Afwijzen…', title: 'Van de takenlijst halen (blijft in het journaal)', klik: async () => { await D.wijsAf(m.code, t.id); T.ververs(); naWijziging(); } }))
          : h.el('span', { klass: 'tp-sub', tekst: 'Kantoor beslist' })));
    }
    if (t._veldconflict && Object.keys(t._veldconflict).length && D.conflict) kids.push(h.el('div', { klass: 'tp-melding tp-conflict' }, h.el('span', { tekst: 'Twee mensen wijzigden tegelijk ' + Object.keys(t._veldconflict).length + ' veld(en) van deze taak.' }),
      mag('alles') ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Kiezen…', klik: async () => { await D.conflict(m.code, t.id); T.ververs(); naWijziging(); } }) : null));
    return kids.length ? h.el('div', { klass: 'tp-meldingen' }, kids) : null;
  }

  // De objectdefinitie voor het objectpaneel
  const DEF = {
    soort: 'taak', label: 'Taak',
    lees: hash => { const r = P.deepLinkLees(hash); return r && r.soort === 'taak' ? { code: r.code, id: String(r.id) } : null; },
    href: s => T.href(s.code, s.id),
    sleutelTekst: s => String(s.code) + '/' + String(s.id),
    klaar: () => !D.takenKlaar || D.takenKlaar(),
    ruw: () => (D.ruw ? D.ruw() : ''),
    model: s => T.model(s.code, s.id),
    schrijf: (s, spec, opt) => { const m = T.model(s.code, s.id); return D.wijzig(Object.assign({ code: m.ok ? m.code : s.code, id: s.id, naam: m.ok ? m.taak.naam : '' }, spec), opt); },
    herstel: (w, opt) => D.wijzigHerstel(w, opt),
    naWijziging,
    teken: (m, h) => {
      if (!m.ok) {
        const klaar = DEF.klaar(), code = m.code;
        return { aria: 'Taak', titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: klaar ? 'Taak niet gevonden' : 'Taken laden…' }), body: [
          h.el('p', { klass: 'tp-sub', tekst: klaar ? 'Deze taak bestaat niet (meer). Misschien is hij verwijderd of naar een ander project verplaatst.' : ((D.takenStatusTekst && D.takenStatusTekst()) || 'De takenlijst is nog niet geladen.') }),
          D.ga && D.ga.project ? h.link(D.href && D.href.project ? D.href.project(code) : '#', () => { h.sluit({ stil: true }); D.ga.project(code, 'planning'); }, 'Naar het project', 'tp-link tp-knoplink') : null] };
      }
      // De naam ziet eruit als een kop, maar is een veld: klikken = bewerken (bewerkbaar oogt = bewerkbaar)
      const titel = D.wijzig ? h.el('h2', { id: 'tp-titel', klass: 'tp-titel' }, h.tekstVeld('naam', m.taak.naam || '', { kan: mag('alles'), label: 'Taaknaam', klass: 'tp-titelinvoer', wat: 'naam', fout: 'Een taak heeft een naam nodig; er is niets gewijzigd.', lees: v => v ? v : null, titel: 'Klik om de naam te wijzigen · Enter = opslaan, Esc = annuleren' }))
        : h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: m.taak.naam || '(zonder naam)' });
      return { aria: 'Taak: ' + (m.taak.naam || ''), boven: herkomst(m, h), titel, body: [statusRij(m, h), meldingen(m, h), velden(m, h), afhSectie(m, h), bestelSectie(m, h), meta(m, h)] };
    }
  };
  // De stijl van wat alleen de taak heeft (de mini-tijdlijn)
  const STIJL_TAAK = [
    '#tp-paneel .tp-tl{margin-top:8px}#tp-paneel .tp-tl-leeg{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '#tp-paneel .tp-tl-as{position:relative;height:46px;border:1px solid var(--line,#dfd8cb);border-radius:4px;background:var(--surface-sunken,#f1ede5);overflow:hidden}',
    '#tp-paneel .tp-tl-wk{position:absolute;top:0;bottom:0;padding:2px 0 0 3px;border-left:1px solid var(--line,#dfd8cb);font:500 10px/12px var(--mono,monospace);color:var(--ink-3,#646a64);white-space:nowrap}',
    '#tp-paneel .tp-tl-balk{position:absolute;top:18px;height:14px;border-radius:3px;background:var(--block-color,#3e5c76);opacity:.85}#tp-paneel .tp-tl-balk.tp-st-klaar{opacity:.45}',
    '#tp-paneel .tp-tl-blok{position:absolute;top:35px;height:6px;border-radius:2px;background:var(--brass,#d19a1f)}#tp-paneel .tp-tl-blok.voorstel{background:transparent;border:1px dashed var(--brass,#d19a1f)}',
    '#tp-paneel .tp-tl-nu{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--brass,#d19a1f)}',
    '#tp-paneel .tp-tl-onder{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}',
    '.cn-blok.tp-gemarkeerd{outline:3px solid var(--brass,#d19a1f);outline-offset:1px;animation:tp-puls 1.2s ease-out 2}@keyframes tp-puls{50%{outline-color:transparent}}'
  ];

  // De takentabel van een project (v2.html, projectTakenHtml): de taaknaam wordt achteraf een link naar het paneel (DOM achteraf, zodat het sjabloon van de tabel ongewijzigd blijft)
  T.verrijkTaken = function (code, wortel) {
    if (!wortel || !code) return 0;
    const alle = D.taken() || {}, k = sleutelVan(alle, code); if (!k) return 0;
    const sid = String(k).replace(/-/g, ''), h = O.H; let n = 0;
    (alle[k] || []).forEach(t => {
      if (!t || t._vervallen || t.id == null) return;
      const tr = wortel.querySelector('#' + (root.CSS && root.CSS.escape ? root.CSS.escape('pt-row-' + sid + '-' + t.id) : ('pt-row-' + sid + '-' + t.id))), td = tr && tr.children[2];
      if (!td || td.querySelector('.tp-naamlink')) return;
      const tekst = [...td.childNodes].find(x => x.nodeType === 3 && x.textContent.trim());
      if (!tekst) return;
      const a = h.link(T.href(k, t.id), () => T.open(k, t.id, { terug: a }), tekst.textContent, 'tp-link tp-naamlink', { title: 'Open de taak (alle details)' });
      td.replaceChild(a, tekst); n++;
    });
    if (n) O.paneelEl();   // de stijl staat er dan (de link heeft een eigen klasse)
    return n;
  };

  // Het Toggl-bord (Uren ▸ Board) toont Toggl-taken: een tegel opent het paneel van de MT-taak die eraan gekoppeld is (tg_task_id). → true als er een MT-taak was
  T.openViaToggl = function (tgId, terug) {
    const alle = D.taken() || {};
    for (const code of Object.keys(alle)) { if (code.startsWith('__')) continue; const t = (alle[code] || []).find(x => x && !x._vervallen && x.tg_task_id != null && String(x.tg_task_id) === String(tgId)); if (t) return T.open(code, t.id, { terug }); }
    return false;
  };  // ── de bekende ingangen (dezelfde namen als vóór het objectpaneel) ──
  T.open = (code, id, o) => (code == null || id == null || id === '') ? false : O.open('taak', { code: String(code), id: String(id) }, o);
  T.sluit = o => O.sluit(o);
  T.isOpen = () => O.isOpen('taak');
  T.huidig = () => { const h = O.huidig(); return h && h.soort === 'taak' ? { code: h.sleutel.code, id: h.sleutel.id } : null; };
  T.ververs = () => O.ververs();
  T.teken = () => O.teken();
  T.bezigMetBewerken = () => O.bezigMetBewerken();

  T.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning; O = deps.objectpaneel || root.MTObjectPaneel;
    O.init({ doc: deps.doc, toast: deps.toast, get dialoog() { return deps.dialoog; } });
    if (!O.STIJL.includes(STIJL_TAAK[0])) STIJL_TAAK.forEach(r => O.STIJL.push(r));
    O.registreer(Object.assign({}, DEF, { startLink: deps.startLink }));
    // Het Toggl-bord: een klik op een tegel (geen sleep: de browser stuurt dan geen klik) opent het paneel van de gekoppelde MT-taak
    if (deps.bordKlik && deps.doc && !T._bord) { T._bord = true; deps.doc.addEventListener('click', ev => {
      const tegel = ev.target && ev.target.closest && ev.target.closest('#tg-board .tg-tile[data-id]'); if (!tegel) return;
      if (!T.openViaToggl(tegel.getAttribute('data-id'), tegel)) toast('Deze Toggl-taak hoort niet bij een taak in de MT tool (nog niet gekoppeld).');
    }); }
    return T;
  };
  root.MTTaakPaneel = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);

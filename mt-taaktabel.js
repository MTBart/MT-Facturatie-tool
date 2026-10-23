/* ============================================================================
 * mt-taaktabel.js — taken bewerken in de takentabel van Project ▸ Planning (planning brok P2p)
 * ----------------------------------------------------------------------------
 * Per taak: een afvinkvakje (aan = Klaar, uit = terug naar de vorige status), een statuskiezer (Open · Bezig · Wacht met verplichte reden · Klaar)
 * en inline velden voor wie, activiteit, prioriteit, start, eind en raming (Enter of wegklikken = opslaan, Esc = terug).
 *
 * Schrijven gaat ALLEEN via de route van het taakpaneel (D.wijzig = tpWijzig → MTPlanVerplaats.taakWijzig: vers lezen, ETag, slot per taak, stempels, journaal)
 * met dezelfde spec als het taakpaneel en het Bord (specStatus/specVeld), en de datums via de sleeproute van de Capaciteit (D.datums, met de vraag "Opvolgers mee?").
 * Elke geslaagde wijziging geeft een melding met Ongedaan maken; wijzigde een collega eerder, dan zegt de melding dat en wordt er niets overschreven.
 * Toggl wordt hier nooit aangeraakt: de bestaande knop (→ Toggl / ↻ Toggl) in de rij blijft de enige route.
 *
 * De tabel zelf staat in een sjabloon met ruwe interpolaties (sink-baseline); die regels blijven ongewijzigd. Deze module verrijkt de rijen achteraf met DOM-calls
 * (zoals MTTaakPaneel.verrijkTaken): geen innerHTML. Een rol zonder recht ziet de waarden, maar geen vakje, kiezer of invoerveld.
 * ========================================================================== */
(function (root) {
  'use strict';
  const TT = {};
  let D = {};
  const S = { bezig: false, vorige: new Map(), focus: null };
  const P = () => root.MTPlanning;

  // ── specs: dezelfde vorm als in het taakpaneel (zetStatus en keuzeVeld/tekstVeld) en het Bord, zodat de stempels identiek zijn ──
  TT.specStatus = (code, t, nieuw, reden) => ({ code, id: t.id, naam: t.naam || '', velden: { status: nieuw }, gezien: { status: t.status || 'todo', wacht_reden: t.wacht_reden || '', klaar_op: t.klaar_op || '' }, reden: reden || '' });
  TT.specVeld = (code, t, veld, nieuw, gezien) => { const velden = {}, gz = {}; velden[veld] = nieuw; gz[veld] = gezien; return { code, id: t.id, naam: t.naam || '', velden, gezien: gz }; };
  TT.specKeuze = (code, t, veld, nieuw) => TT.specVeld(code, t, veld, nieuw, t[veld] || '');                                             // wie, activiteit, prioriteit (keuzeVeld: gezien = wat getoond werd)
  TT.specUren = (code, t, uren) => TT.specVeld(code, t, 'duur_uur', uren, String(t.duur_uur == null ? '' : t.duur_uur));                  // raming (tekstVeld met gezien)
  TT.specDatums = (code, t, s, e) => ({ soort: 'taakdatums', taak: { code, id: t.id, naam: t.naam || '' }, startDatum: s, eindDatum: e, gezien: { start: t.start || '', eind: t.eind || '' } });

  // ── rekenwerk (geen DOM) ──
  // De status waar een taak naar teruggaat bij uitvinken. Eerst wat deze sessie wist, dan het takenjournaal (de laatste statuswijziging via het paneel/de tabel
  // bewaarde de taak zoals hij toen was), anders Open. Wacht is geen terugkeerstand: die vraagt een reden, dus dan Open.
  TT.vorigeUitJournaal = (journaal, code, id) => {
    const lijst = Array.isArray(journaal) ? journaal : [];
    for (let i = lijst.length - 1; i >= 0; i--) {
      const j = lijst[i]; if (!j || !j.taak || String(j.code).toLowerCase() !== String(code).toLowerCase() || String(j.taak.id) !== String(id)) continue;
      if (!/^(paneel:.*\bstatus\b|status)$/.test(String(j.actie || ''))) continue;   // via het paneel/de tabel ('paneel: status') of de oude statusknop ('status'): beide bewaren de taak zoals hij was
      const s = j.taak.status || 'todo'; return s === 'klaar' ? 'todo' : s;
    }
    return 'todo';
  };
  TT.sleutel = (code, id) => String(code).toLowerCase() + '/' + String(id);
  TT.vorige = (code, t) => { const v = S.vorige.get(TT.sleutel(code, t.id)) || (D.journaal ? TT.vorigeUitJournaal(D.journaal(), code, t.id) : 'todo'); return v === 'bezig' ? 'bezig' : 'todo'; };   // alleen Open of Bezig: Wacht vraagt een reden en Klaar is waar we vandaan komen
  // Wat een klik op het vakje doet: klaar → terug naar de vorige status; anders → klaar
  TT.afvinkNaar = (code, t) => (t.status || 'todo') === 'klaar' ? TT.vorige(code, t) : 'klaar';
  TT.rondUren = x => Math.round(x * 100) / 100;
  TT.urenTekst = u => { const n = Number(u) || 0; return n ? String(n).replace('.', ',') : ''; };
  TT.isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  const mag = w => { try { return !!(D.mag && D.mag[w] && D.mag[w]()); } catch (e) { return false; } };
  const toast = (t, o, l, lb) => { try { if (D.toast) D.toast(t, o, l, lb); } catch (e) {} };
  const sleutelVan = (obj, code) => Object.keys(obj || {}).find(k => String(k).toLowerCase() === String(code).toLowerCase());
  const vindTaak = (code, id) => { const alle = (D.taken && D.taken()) || {}, k = sleutelVan(alle, code); return k ? (alle[k] || []).find(x => x && !x._vervallen && String(x.id) === String(id)) || null : null; };
  const klaarMelden = () => { if (D.naWijziging) { try { D.naWijziging(); } catch (e) {} } };
  const GEEN_RECHT = 'Dit mag je niet met jouw rol (kantoor beslist).';
  const statusLabel = s => (P().TAAK_STATUS_LABEL && P().TAAK_STATUS_LABEL[s]) || s;

  // Een wijziging doorvoeren: zelfde afhandeling van de uitkomst als het taakpaneel en het Bord (onzeker, niet gelukt, tegelijk, gelukt met Ongedaan maken)
  async function schrijf(spec, wat) {
    let r; try { r = await D.wijzig(spec, { traag: () => toast('Opslaan duurt lang, even geduld…', null, true) }); } catch (e) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }; }
    if (r && r.onzeker) { toast(r.reden, null, true); Promise.resolve(r.onzeker).then(u => { klaarMelden(); toast((u && u.tekst) || 'Open de taak opnieuw om te zien of het opslaan gelukt is.', null, true); }, () => toast('Ik kon niet vaststellen of het opslaan gelukt is.', null, true)); return false; }
    if (!r || !r.ok) { klaarMelden(); toast((r && r.reden) || 'Niet opgeslagen.', null, true); return false; }
    if (r.noop) { klaarMelden(); return true; }
    klaarMelden();
    if (r.tegelijk) { toast(r.tegelijk, null, true); return false; }
    const w = r.wijziging;
    toast((r.naam || (w && w.naam) || spec.naam || 'Taak') + ': ' + wat + ' opgeslagen.', w && D.wijzigHerstel ? async () => {
      let h; try { h = await D.wijzigHerstel(w, {}); } catch (e) { h = { ok: false, reden: 'Terugzetten mislukt: ' + ((e && e.message) || e) }; }
      klaarMelden();
      if (h && h.onzeker) { toast(h.reden, null, true); Promise.resolve(h.onzeker).then(u => { klaarMelden(); toast((u && u.tekst) || 'Open de taak opnieuw om te zien of het terugzetten gelukt is.', null, true); }); return; }
      toast(h && h.ok ? (h.tegelijk || 'Teruggezet.') : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !!(h && (h.tegelijk || !h.ok)));
    } : null);
    return true;
  }
  // Eén schrijfactie tegelijk (een tweede klik tijdens het opslaan wacht niet stilletjes, maar zegt het)
  async function enkel(fn) {
    if (S.bezig) { toast('Even wachten: de vorige wijziging wordt nog opgeslagen.', null, true); return false; }
    S.bezig = true; try { return await fn(); } finally { S.bezig = false; }
  }

  // Naar een andere status: Wacht vraagt een verplichte reden; een taak die op een voorganger wacht start na een bevestiging; open materiaal vraagt eerst een bevestiging
  TT.naarStatus = (code, id, nieuw) => enkel(async () => {
    const t0 = vindTaak(code, id); if (!t0) { toast('Deze taak bestaat niet meer.', null, true); klaarMelden(); return false; }
    const t = Object.assign({}, t0);   // een momentopname van wat de gebruiker zag: de lijst kan tijdens de vragen in het geheugen worden bijgewerkt (sync)
    const huidig = t.status || 'todo', dlg = D.dialoog, Pl = P();
    if (huidig === nieuw && nieuw !== 'wacht') { klaarMelden(); return false; }
    if (!mag('status')) { toast(GEEN_RECHT, null, true); klaarMelden(); return false; }
    let reden = '';
    if (nieuw === 'wacht') {
      if (!dlg || !dlg.prompt) { klaarMelden(); return false; }
      for (let i = 0; i < 3; i++) {
        const r = await dlg.prompt({ title: 'Waarom wacht deze taak?', message: '"' + t.naam + '"', placeholder: 'Bijvoorbeeld: wacht op plaatmateriaal', defaultValue: i === 0 ? (t.wacht_reden || '') : '', okLabel: 'Zet op Wacht' });
        if (r === null || r === undefined) { klaarMelden(); return false; }
        reden = String(r).replace(/\s+/g, ' ').trim(); if (reden.length >= 2) break;
        reden = ''; toast('Een reden is verplicht bij Wacht.');
      }
      if (!reden) { klaarMelden(); return false; }
    } else if (huidig === 'todo' && D.wachtInfo && dlg && dlg.confirm) {
      const w = D.wachtInfo(code, t);
      if (w && w.wacht) { const ja = await dlg.confirm({ title: 'Deze taak wacht', message: '"' + t.naam + '" wacht op: ' + w.tekst + '.\nToch ' + (nieuw === 'klaar' ? 'op klaar zetten' : 'starten') + '?', okLabel: 'Toch doorgaan' }); if (!ja) { klaarMelden(); return false; } }
    }
    if (nieuw !== 'wacht' && D.bestel && dlg && dlg.confirm) {   // P5: een taak met open materiaal gaat niet stil naar Bezig of Klaar; vers uit de gezamenlijke bestellijst
      let bl = D.bestel() || []; if (D.bestelVers) { try { bl = await D.bestelVers() || bl; } catch (e) { } }
      const mat = Pl.taakMateriaal(t, Pl.bestelVanTaak(bl, t.id, { code, project_id: D.projectId ? D.projectId(code) : '' }), { vandaag: Pl.vandaagYmd() });
      if (Pl.materiaalVraagBevestiging(t, mat, nieuw)) { const ja = await dlg.confirm({ title: 'Het materiaal is nog niet binnen', message: Pl.materiaalBevestigTekst(t.naam, mat, nieuw, Pl.datumKort), okLabel: 'Toch doorgaan' }); if (!ja) { klaarMelden(); return false; } }
    }
    // De spec gebruikt wat de gebruiker zag toen hij klikte (t), niet de stand na de vragen: heeft een collega de status intussen gewijzigd, dan meldt taakWijzig dat en wordt er niets overschreven.
    const ok = await schrijf(TT.specStatus(code, t, nieuw, reden),'status ' + statusLabel(nieuw).toLowerCase());
    if (ok && nieuw === 'klaar' && huidig !== 'klaar') S.vorige.set(TT.sleutel(code, id), huidig);
    return ok;
  });
  TT.afvinken = (code, id) => { const t = vindTaak(code, id); if (!t) { toast('Deze taak bestaat niet meer.', null, true); klaarMelden(); return Promise.resolve(false); } return TT.naarStatus(code, id, TT.afvinkNaar(code, t)); };
  TT.zetKeuze = (code, id, veld, nieuw, wat) => enkel(async () => {
    const t = vindTaak(code, id); if (!t) { toast('Deze taak bestaat niet meer.', null, true); klaarMelden(); return false; }
    if (!mag('alles')) { toast(GEEN_RECHT, null, true); klaarMelden(); return false; }
    if ((t[veld] || '') === nieuw) { klaarMelden(); return false; }
    return schrijf(TT.specKeuze(code, t, veld, nieuw), wat || veld);
  });
  TT.zetUren = (code, id, uren) => enkel(async () => {
    const t = vindTaak(code, id); if (!t) { toast('Deze taak bestaat niet meer.', null, true); klaarMelden(); return false; }
    if (!mag('alles')) { toast(GEEN_RECHT, null, true); klaarMelden(); return false; }
    if (uren === null || uren < 0) { toast('Geen geldige raming: typ bijvoorbeeld 6, 6,5 of 2u30. Er is niets gewijzigd.', null, true); klaarMelden(); return false; }
    if (TT.rondUren(Number(t.duur_uur) || 0) === uren) { klaarMelden(); return false; }
    return schrijf(TT.specUren(code, t, uren), 'raming');
  });
  TT.uurStap = (code, id, delta) => { const t = vindTaak(code, id); if (!t) return Promise.resolve(false); return TT.zetUren(code, id, Math.max(0, TT.rondUren((Number(t.duur_uur) || 0) + delta))); };
  // Datums: de sleeproute van de Capaciteit (opvolgers-vraag, ongedaan maken en meldingen doet die zelf)
  TT.zetDatums = (code, id, s, e) => enkel(async () => {
    const t = vindTaak(code, id); if (!t) { toast('Deze taak bestaat niet meer.', null, true); klaarMelden(); return false; }
    if (!mag('plannen')) { toast('Datums plannen is voor kantoor.', null, true); klaarMelden(); return false; }
    if (!TT.isYmd(s) || !TT.isYmd(e)) { toast('Vul een geldige start en eind in.', null, true); klaarMelden(); return false; }
    if (e < s) { toast('Het eind ligt voor de start; er is niets gewijzigd.', null, true); klaarMelden(); return false; }
    if (s === (t.start || '') && e === (t.eind || t.start || '')) { klaarMelden(); return false; }
    let r; try { r = await D.datums(TT.specDatums(code, t, s, e)); } catch (x) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((x && x.message) || x) }; }
    klaarMelden();
    if (r && r.onzeker) return false;       // de melding komt van de sleeproute zelf
    if (!r || !r.ok) { if (!r || !r.geannuleerd) toast((r && r.reden) || 'Niet opgeslagen.', null, true); return false; }
    return true;
  });

  // ── tekenen: de rijen van de bestaande tabel verrijken (DOM-calls) ──
  const dom = () => D.doc || root.document;
  function el(tag, o, ...kids) {
    const e = dom().createElement(tag);
    Object.keys(o || {}).forEach(k => {
      if (o[k] === null || o[k] === undefined || o[k] === false) return;
      if (k === 'klass') e.className = o[k]; else if (k === 'tekst') e.textContent = o[k]; else if (k === 'klik') e.addEventListener('click', o[k]);
      else if (k === 'value') e.value = o[k]; else if (k === 'checked' || k === 'disabled' || k === 'selected') e[k] = !!o[k]; else e.setAttribute(k, o[k] === true ? '' : o[k]);
    });
    kids.flat().forEach(c => { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === 'string' ? dom().createTextNode(c) : c); });
    return e;
  }
  const STATUSSEN = [['todo', 'Open'], ['bezig', 'Bezig'], ['wacht', 'Wacht'], ['klaar', 'Klaar']];
  const STKL = { todo: 'open', bezig: 'bezig', wacht: 'wacht', klaar: 'klaar' };
  const PRIO = [['', 'Geen'], ['high', 'P1'], ['medium', 'P2'], ['low', 'P3']];   // P1 = hoog, P2 = normaal, P3 = laag (de titel van de kiezer zegt het)
  const PRIO_KORT = { high: 'P1', medium: 'P2', low: 'P3' };

  // Een keuzelijst die bij een wijziging opslaat; bij niet gelukt tekent de tabel opnieuw (klaarMelden) en staat de echte stand er weer
  function keuze(label, waarde, opties, opSlaan, klass, titel) {
    const s = el('select', { klass: 'tt-sel' + (klass ? ' ' + klass : ''), 'aria-label': label, title: titel || label },
      opties.map(([k, l]) => el('option', { value: k, tekst: l, selected: k === waarde })));
    if (!opties.some(([k]) => k === waarde)) s.insertBefore(el('option', { value: waarde, tekst: waarde, selected: true }), s.firstChild);
    s.addEventListener('change', () => opSlaan(s.value));
    return s;
  }
  // Een invoerveld: Enter of wegklikken = opslaan, Esc = terug naar wat er stond
  function invoer(o) {
    const i = el('input', { type: o.type || 'text', klass: 'tt-in ' + (o.klass || ''), 'aria-label': o.label, title: o.titel || o.label, inputmode: o.inputmode || null, autocomplete: 'off', value: o.waarde });
    let begin = o.waarde, klaar = false;
    i.addEventListener('focus', () => { begin = i.value; klaar = false; if (o.selecteer) { try { i.select(); } catch (e) {} } });
    i.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && i.value !== begin) { ev.preventDefault(); ev.stopPropagation(); i.value = begin; klaar = true; i.blur(); klaar = false; }
      else if (ev.key === 'Enter') { ev.preventDefault(); i.blur(); }
    });
    i.addEventListener('blur', () => { if (klaar) return; if (o.paar) { setTimeout(() => o.paar(i), 0); return; } if (i.value !== begin) { klaar = true; o.opslaan(i.value); } });
    return i;
  }

  // Het afvinkvakje als losse component (ook gebruikt door het blok Voortgang): met recht een vakje (aan = Klaar, uit = vorige status) via TT.afvinken, zonder recht alleen een teken.
  TT.afvinkVak = function (code, t) {
    const st = t.status || 'todo', id = t.id;
    if (!mag('status')) return el('span', { klass: 'tt-klaar tt-klaar-uit', 'aria-label': st === 'klaar' ? 'Klaar' : 'Niet klaar', tekst: st === 'klaar' ? '✓' : '' });
    const vak = el('input', { type: 'checkbox', klass: 'tt-klaar-in', 'aria-label': 'Klaar: ' + (t.naam || ''), checked: st === 'klaar', 'data-tt-sleutel': TT.sleutel(code, id) });
    vak.addEventListener('change', async () => { vak.disabled = true; S.focus = TT.sleutel(code, id); const ok = await TT.afvinken(code, id); if (!ok) vak.checked = st === 'klaar'; vak.disabled = false; });
    return el('label', { klass: 'tt-klaar', title: st === 'klaar' ? 'Klaar. Uitvinken zet de taak terug naar de vorige status' : 'Afvinken = Klaar' }, vak);
  };
  // Na het hertekenen staat de focus weer op het vakje waar het toetsenbord was
  TT.herstelFocus = function (wortel) {
    const k = S.focus; if (!k || !wortel || !wortel.querySelector) return false; S.focus = null;
    const v = [...wortel.querySelectorAll('input.tt-klaar-in')].find(x => x.getAttribute('data-tt-sleutel') === k);
    if (v) { try { v.focus(); } catch (e) {} return true; } return false;
  };
  TT.verrijk = function (code, wortel) {
    if (!wortel || !code || !D.taken) return 0;
    const alle = D.taken() || {}, k = sleutelVan(alle, code); if (!k) return 0;
    const sid = String(k).replace(/-/g, ''), Pl = P(), team = (D.team && D.team()) || []; let n = 0;
    (alle[k] || []).forEach(t => {
      if (!t || t._vervallen || t.id == null) return;
      const tr = wortel.querySelector('#' + (root.CSS && root.CSS.escape ? root.CSS.escape('pt-row-' + sid + '-' + t.id) : ('pt-row-' + sid + '-' + t.id)));
      if (!tr || tr.getAttribute('data-tt') || tr.children.length < 7) return;
      tr.setAttribute('data-tt', '1');
      const c = tr.children, st = t.status || 'todo', mijlpaal = t.soort === 'mijlpaal', kanSt = mag('status'), kanAl = mag('alles');
      const kanPlan = mag('plannen') && st !== 'klaar' && !t.voorstel;
      const id = t.id;
      tr.classList.add('tt-rij'); const tab = tr.closest ? tr.closest('table') : null; if (tab) tab.classList.add('pt-tabel');
      // 1) afvinkvakje + selectievakje (verwijderen) in de eerste cel
      const sel = c[0].querySelector('.pt-check');
      c[0].insertBefore(TT.afvinkVak(code, t), c[0].firstChild);
      if (sel && !kanAl) { sel.hidden = true; sel.disabled = true; }
      // 2) statuskiezer (vier zichtbare keuzes) in de tweede cel
      if (kanSt) {
        const w = D.wachtInfo ? D.wachtInfo(code, t) : null;
        const kiezer = keuze('Status', st, STATUSSEN, v => { if (v !== st) TT.naarStatus(code, id, v).then(ok => { if (!ok) kiezer.value = st; }); }, 'tt-st tt-st-' + (STKL[st] || 'open'));
        c[1].textContent = ''; c[1].appendChild(kiezer);
        if (st === 'wacht' && t.wacht_reden) c[1].appendChild(el('span', { klass: 'tt-sub', tekst: 'Wacht: ' + t.wacht_reden, title: t.wacht_reden }));
        else if (st === 'todo' && w && w.wacht) c[1].appendChild(el('span', { klass: 'tt-sub', tekst: 'wacht op voorganger', title: w.tekst || 'Een voorganger is nog niet klaar' }));
      }
      // 3) wie en activiteit (de oude lijsten vervangen door lijsten die via het taakpaneel schrijven; zonder recht gewone tekst)
      const oud = [...c[3].querySelectorAll('select.pt-sel')], actOud = oud.find(x => x.getAttribute('aria-label') === 'Activiteit'), wieOud = oud.find(x => x.getAttribute('aria-label') === 'Toegewezen aan');
      const tekstWaarde = (lijst, v, leeg) => { const f = lijst.find(([k]) => k === v); return el('span', { klass: 'tt-tekst', tekst: f ? f[1] : (v || leeg) }); };
      const wieLijst = [['', '— wie —']].concat(team.filter(x => x && x.slug).map(x => [x.slug, x.naam])), actLijst = [['', '— activiteit —']].concat((Pl.ACTIVITEITEN || []).map(a => [a.k, a.l]));
      const maak = (oudEl, lijst, veld, label, wat) => {
        if (!oudEl) return;
        const nieuwEl = kanAl ? keuze(label, t[veld] || '', lijst, v => TT.zetKeuze(code, id, veld, v, wat)) : tekstWaarde(lijst, t[veld] || '', '—');
        oudEl.parentNode.replaceChild(nieuwEl, oudEl);
      };
      maak(actOud, actLijst, 'activiteit', 'Activiteit', 'activiteit'); maak(wieOud, wieLijst, 'toegewezen', 'Wie', 'persoon');
      // 4) prioriteit
      if (kanAl) { c[4].textContent = ''; c[4].appendChild(keuze('Prioriteit', t.prioriteit || '', PRIO, v => TT.zetKeuze(code, id, 'prioriteit', v, 'prioriteit'), '', 'Prioriteit: P1 hoog, P2 normaal, P3 laag')); }
      // 5) raming: invoerveld met −/+ (mijlpaal telt niet mee)
      if (mijlpaal) { c[5].textContent = ''; c[5].appendChild(el('span', { klass: 'tt-tekst', tekst: 'mijlpaal' })); }
      else if (kanAl) {
        const lees = D.leesUren || (x => { const n = parseFloat(String(x).replace(',', '.')); return isFinite(n) ? n : null; });
        c[5].textContent = '';
        c[5].appendChild(el('span', { klass: 'tt-uren' },
          el('button', { type: 'button', klass: 'btn btn-xs btn-secondary tt-stap', title: '−1 uur', 'aria-label': '1 uur minder', klik: () => TT.uurStap(code, id, -1), tekst: '−' }),
          invoer({ label: 'Raming in uren', titel: 'Uren: 6, 6,5, 2u30 of 90m', klass: 'tt-uur', inputmode: 'decimal', waarde: TT.urenTekst(t.duur_uur), selecteer: true, opslaan: v => TT.zetUren(code, id, lees(v)) }),
          el('span', { klass: 'tt-eenheid', tekst: 'u' }),
          el('button', { type: 'button', klass: 'btn btn-xs btn-secondary tt-stap', title: '+1 uur', 'aria-label': '1 uur meer', klik: () => TT.uurStap(code, id, 1), tekst: '+' })));
      } else { c[5].textContent = ''; c[5].appendChild(el('span', { klass: 'tt-tekst', tekst: TT.urenTekst(t.duur_uur) ? TT.urenTekst(t.duur_uur) + ' u' : '—' })); }
      // 6) start en eind: nieuwe cel vóór de knoppen (de cel van de naam blijft de derde, andere code leest daarop)
      const td = el('td', { klass: 'tt-datums', 'data-label': mijlpaal ? 'Datum' : 'Start – eind' });
      const s0 = TT.isYmd(t.start) ? t.start : '', e0 = TT.isYmd(t.eind) ? t.eind : s0;
      if (kanPlan) {
        const velden = [];
        const opslaan = i => {
          const a = velden[0], b = velden[1] || velden[0], d = dom().activeElement;
          if (d === a || d === b) return;   // nog binnen het paar: pas opslaan als de focus beide velden verlaat
          if (a.value === s0 && (velden[1] ? b.value === e0 : true)) return;
          TT.zetDatums(code, id, a.value, velden[1] ? b.value : a.value);
        };
        velden.push(invoer({ type: 'date', label: mijlpaal ? 'Datum' : 'Start', klass: 'tt-datum', waarde: s0, paar: opslaan }));
        if (!mijlpaal) velden.push(invoer({ type: 'date', label: 'Eind', klass: 'tt-datum', waarde: e0, paar: opslaan }));
        velden.forEach((v, i) => td.appendChild(el('div', { klass: 'tt-dveld' }, el('span', { klass: 'tt-pre', tekst: mijlpaal ? 'datum' : (i ? 'eind' : 'start') }), v)));
      } else td.appendChild(el('span', { klass: 'tt-tekst', tekst: s0 ? (e0 && e0 !== s0 ? P().datumKort(s0) + ' t/m ' + P().datumKort(e0) : P().datumKort(s0)) : 'Niet ingepland', title: st === 'klaar' ? 'Een klare taak plan je niet meer in.' : (mag('plannen') ? '' : 'Datums plannen is voor kantoor.') }));
      tr.insertBefore(td, c[6]);
      // 7) de rondgaande ⟳-knop is vervangen door de kiezer en het vakje
      const rond = [...tr.querySelectorAll('button')].find(b => /projTaakStatus\(/.test(b.getAttribute('onclick') || '')); if (rond) rond.remove();
      n++;
    });
    TT.herstelFocus(wortel);
    if (n) stijl();
    return n;
  };

  const CSS = [
    '.pt-tabel .tt-klaar{display:inline-flex;align-items:center;justify-content:center;min-width:28px;min-height:28px;cursor:pointer;vertical-align:middle}.pt-tabel .tt-klaar-in{width:18px;height:18px;cursor:pointer}.pt-tabel .tt-klaar-uit{cursor:default;color:var(--primary,#2A4A38);font-weight:700}',
    '.pt-tabel .tt-sel,.pt-tabel .tt-in{font:inherit;font-size:12px;padding:3px 4px;min-height:28px;border:1px solid var(--line,#dfd8cb);border-radius:4px;background:var(--surface,#fff);color:inherit}',
    '.pt-tabel select.tt-sel{appearance:none;-webkit-appearance:none;padding-right:20px;background:var(--surface,#fff) url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M1 1l4 4 4-4\' fill=\'none\' stroke=\'%23646a64\' stroke-width=\'1.5\'/%3E%3C/svg%3E") no-repeat right 6px center}',
    '.pt-tabel .tt-st{font-weight:600}.pt-tabel .tt-st-bezig{color:#2563eb;border-color:#2563eb}.pt-tabel .tt-st-wacht{color:#7A6010;border-color:#B8962E}.pt-tabel .tt-st-klaar{color:#2A4A38;border-color:#2A4A38}',
    '.pt-tabel .tt-datum{width:108px}.pt-tabel .tt-uur{width:46px;text-align:right;font-family:var(--mono,monospace)}.pt-tabel .tt-uren{display:inline-flex;align-items:center;gap:2px}.pt-tabel .tt-eenheid{font-size:12px;margin-right:2px}',
    '.pt-tabel .tt-sub{display:block;font-size:11px;color:var(--text-faint,#8a8f8a)}.pt-tabel .tt-tekst{font-size:12px}.pt-tabel td.tt-datums{min-width:140px}.pt-tabel tr.tt-rij>td:nth-child(3){min-width:130px}.pt-tabel .tt-dveld{display:flex;align-items:center;gap:4px;margin-bottom:3px}.pt-tabel .tt-pre{font-size:11px;color:var(--text-faint,#8a8f8a);width:26px;flex:none}.pt-tabel tr.tt-rij>td:nth-child(2){min-width:84px}.pt-tabel tr.tt-rij>td:nth-child(4) .tt-sel{display:block;width:112px;margin-bottom:3px}.pt-tabel tr.tt-rij>td:nth-child(5) .tt-sel{width:52px}',
    '.pt-tabel .tt-sel:focus-visible,.pt-tabel .tt-in:focus-visible,.pt-tabel .tt-klaar-in:focus-visible{outline:2px solid var(--primary,#2A4A38);outline-offset:1px}',
    '@media (max-width:640px){.pt-tabel,.pt-tabel tbody{display:block;width:100%}.pt-tabel tr.tt-rij{display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:8px;row-gap:6px;padding:10px 0;border-bottom:1px solid var(--line,#dfd8cb)}',
    '.pt-tabel tr.tt-rij>td{display:block;width:auto !important;text-align:left !important;padding:0;grid-column:2;min-width:0;white-space:normal !important}.pt-tabel tr.tt-rij .tt-sel{display:block;width:100%;max-width:100%;margin-bottom:4px}.pt-tabel tr.tt-rij>td:first-child{grid-column:1;grid-row:1 / span 8}',
    '.pt-tabel tr.tt-rij>td:nth-child(3){order:-1}.pt-tabel .tt-klaar{min-width:44px;min-height:44px}.pt-tabel .tt-klaar-in{width:26px;height:26px}',
    '.pt-tabel .tt-sel,.pt-tabel .tt-in,.pt-tabel .tt-stap{min-height:44px;font-size:14px}.pt-tabel .tt-stap{min-width:44px}.pt-tabel .tt-datum{width:auto;flex:1}.pt-tabel td.tt-datums{min-width:0}.pt-tabel tr.tt-rij>td:nth-child(4) .tt-sel,.pt-tabel tr.tt-rij>td:nth-child(5) .tt-sel{width:100%}.pt-tabel .tt-pre{width:40px;font-size:12px}}'
  ].join('\n');
  function stijl() { const d = dom(); if (!d || !d.head || d.getElementById('tt-stijl')) return; const s = d.createElement('style'); s.id = 'tt-stijl'; s.textContent = CSS; d.head.appendChild(s); }

  TT.init = cfg => { D = cfg || {}; S.bezig = false; S.vorige = new Map(); S.focus = null; return TT; };
  TT._stijl = CSS;
  root.MTTaakTabel = TT;
  if (typeof module !== 'undefined' && module.exports) module.exports = TT;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

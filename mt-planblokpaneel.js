/* ============================================================================
 * mt-planblokpaneel.js: het planblok in het objectpaneel (planning P1a: lezen; P1b: bewerken, verwijderen, voorstellen beslissen en een nieuw blok maken)
 * ----------------------------------------------------------------------------
 * Een klik op een planblok (in de Capaciteit, in Mijn werk en in de oude Planning-weergave) opent hetzelfde rechterpaneel als bij een taak (mt-objectpaneel.js).
 * Eigen link #planblok/<id>. Inhoud: persoon, dag, tijd, duur, project, taak, titel en notitie, en elk daarvan is een link naar de plek waar het hoort (de dag in de Capaciteit, het taakpaneel, het project).
 * P1b: voor wie mag plannen (kantoor) zijn de velden bewerkbaar (kiezen of typen en wegklikken = opslaan, met Ongedaan maken); een open voorstel beslis je met Goedkeuren of Afwijzen (met reden), de
 * indiener trekt zijn eigen voorstel in; Verwijderen vraagt eerst om bevestiging. "Nieuw" (klik op een lege plek in de Capaciteit) opent hetzelfde paneel als formulier: Inplannen (kantoor) of Voorstel
 * indienen (werkplaats). Het paneel schrijft nooit zelf: alles gaat via D.wijzig (v2.html: capBlokDoe, het rekenwerk van MTPlanVerplaats.blokBewerk en de F1-writer). De werkplaats en een kijker zien
 * het paneel alleen-lezen. model() is rekenwerk zonder DOM, zodat het zonder de hele cockpit te testen is. Alles komt van buiten via init(deps).
 * ========================================================================== */
(function (root) {
  'use strict';
  const B = {};
  let D = null, P = null, O = null;
  const zelfde = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const sleutelVan = (obj, code) => Object.keys(obj && typeof obj === 'object' ? obj : {}).find(k => !k.startsWith('__') && zelfde(k, code));
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

  B.href = id => '#planblok/' + encodeURIComponent(String(id));
  B.leesHash = hash => { const m = /^#?planblok\/([^/#?]+)$/.exec(String(hash == null ? '' : hash).trim()); if (!m) return null; try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } };
  B.NIEUW = 'nieuw';

  // De projectcode van een blok: het veld, of (zonder) die uit het id tb:<code>:<taakId> (zoals MTPlanning)
  const blokCode = b => { const pc = String(b.project_code == null ? '' : b.project_code).trim(); if (pc) return pc; const m = /^tb:([^:]+):/.exec(String(b.id == null ? '' : b.id)); return m ? m[1].trim() : ''; };

  // Een tijd in gewone taal ("9", "9:15", "9.15", "0915", "9u15") naar uu:mm, of null
  B.leesTijd = t => { const s = String(t == null ? '' : t), m = /^\s*(\d{1,2})(?:\s*[:.hu]\s*(\d{1,2}))?\s*$/i.exec(s) || /^\s*(\d{2})(\d{2})\s*$/.exec(s); if (!m) return null; const u = Number(m[1]), mi = Number(m[2] || 0); return u < 24 && mi < 60 ? hhmm(u * 60 + mi) : null; };
  B.leesDuur = t => P.duurNaarMin(t);
  B.tekstDuur = min => min ? P.fmtUurMin(min) : '';

  const rechten = () => { const r = (D.mag && D.mag()) || {}; return { kantoor: !!r.kantoor, voorstel: !!r.voorstel, wie: String(r.wie || '').toLowerCase() }; };
  // De opties voor project en taak (voor het formulier en de keuzelijsten)
  const projectOpties = code => { const lijst = ((D.projecten && D.projecten()) || []).map(p => [p.code, p.label || p.code]); if (code && !lijst.some(x => zelfde(x[0], code))) lijst.unshift([code, code]); return lijst; };
  const taakOpties = (code, huidigId, huidigNaam) => { const l = (code && D.taakLijst ? D.taakLijst(code) : []).map(t => [String(t.id), t.naam]); if (huidigId && !l.some(x => x[0] === String(huidigId))) l.unshift([String(huidigId), huidigNaam || String(huidigId)]); return l; };

  // → { ok:false, id } | { ok:true, nieuw?, sleutel, id, blok, code, project, taak, persoon, persoonNaam, datum, start, eind, duurMin, voorstel, door, notitie, kan, ... }
  B.model = function (id) {
    const r = rechten();
    if (String(id) === B.NIEUW) {
      const c = Object.assign({ persoon: '', datum: P.vandaagYmd(), start: '09:00', duurMin: 60, project_code: '', taak_id: '', taak: '', notitie: '' }, B.concept || {});
      return { ok: true, nieuw: true, sleutel: B.NIEUW, id: B.NIEUW, concept: c, kan: { nieuw: r.kantoor || r.voorstel, voorstel: !r.kantoor && r.voorstel } };
    }
    const blok = (D.blokken() || []).find(b => b && !b._vervallen && String(b.id) === String(id));
    if (!blok) return { ok: false, id };
    const alle = D.taken() || {}, code0 = blokCode(blok), k = code0 ? sleutelVan(alle, code0) : null, code = k || code0;
    const lijst = k ? (alle[k] || []).filter(x => x && !x._vervallen) : [];
    let taak = null;
    if (k && P.taakBlokkenVan) taak = lijst.find(t => { try { return P.taakBlokkenVan(t, lijst, k, [blok], alle).length === 1; } catch (e) { return false; } }) || null;
    const team = (D.team && D.team()) || [], lid = team.find(m => m && P.zelfdePersoon(m.slug, blok.persoon, team));
    const duur = Math.max(0, Math.round(Number(blok.duurMin) || 0));
    const sm = /^(\d{1,2}):(\d{2})/.exec(String(blok.start || '')), s = sm ? Number(sm[1]) * 60 + Number(sm[2]) : null;
    const pr = code ? ((D.project && D.project(k || code)) || { code, naam: '', nummer: '' }) : null;
    const v = blok.status === 'voorstel' ? (blok.voorstel || {}) : null;
    const open = !!(v && !v.goedgekeurd && !v.afgewezen), eigen = !!(open && String(v.door || '').toLowerCase() === r.wie);
    const kan = { wijzig: r.kantoor && !open, verwijder: r.kantoor && !open, beslis: r.kantoor && open, trekin: eigen,
      reden: open ? 'Een open voorstel beslis je eerst (goedkeuren of afwijzen).' : r.voorstel ? 'Wijzigen doet kantoor. Jij kunt een voorstel indienen: klik op een lege plek in de Capaciteit.' : 'Dit paneel is alleen-lezen voor jouw rol (kantoor wijzigt de planning).' };
    return { ok: true, sleutel: String(blok.id), id: String(blok.id), blok, code, project: pr, taak: taak ? { id: taak.id, naam: taak.naam } : null,
      persoon: lid ? lid.slug : String(blok.persoon || ''), persoonNaam: lid ? lid.naam : String(blok.persoon || ''), datum: P.isYmd(blok.datum) ? blok.datum : '',
      start: s === null ? '' : hhmm(s), eind: s !== null && duur ? hhmm(Math.min(24 * 60 - 1, s + duur)) : '', duurMin: duur,
      voorstel: v ? { door: v.doorNaam || v.door || '', afgewezen: !!v.afgewezen, reden: v.reden || '', open } : null, door: String(blok.door || ''), notitie: String(blok.notitie || ''), kan };
  };

  // ── schrijven: elke wijziging gaat als één spec via D.wijzig (capBlokDoe); een vraag (verlof, vrije dag) wordt eerst voorgelegd ──
  const vraagEnDoe = async (spec, opt) => {
    let r = await D.wijzig(spec, opt);
    if (r && r.ok && r.vraag) {
      const ja = D.dialoog && D.dialoog.confirm ? await D.dialoog.confirm({ title: 'Controleer de planning', message: r.vraag, okLabel: 'Toch inplannen', cancelLabel: 'Annuleren' }) : false;
      if (!ja) return { ok: true, noop: true, geannuleerd: true };
      r = await D.wijzig(Object.assign({}, spec, { bevestigd: true }), opt);
    }
    return r;
  };
  const schrijf = async (id, spec, opt) => {
    const m = B.model(id); if (!m.ok || m.nieuw) return { ok: false, reden: 'Dit planblok bestaat niet meer; er is niets gewijzigd.' };
    const velden = Object.assign({}, spec.velden);
    if (velden.taak_id !== undefined && velden.taak_id !== '') {   // een taak koppelen vult de titel als die leeg is of de naam van de vorige taak was
      const nu = taakOpties(m.code, '', '').find(x => x[0] === String(velden.taak_id)), oud = taakOpties(m.code, m.blok.taak_id, '').find(x => x[0] === String(m.blok.taak_id || ''));
      if (nu && (!String(m.blok.taak || '').trim() || (oud && zelfde(oud[1], m.blok.taak)))) velden.taak = nu[1];
    }
    const gezien = Object.assign({}, spec.gezien), team = (D.team && D.team()) || [];   // wat je zag, in de vorm waarin het blok het bewaart (een oud blok kan een naam of e-mailadres als persoon en geen projectcode als veld hebben)
    if (gezien.persoon !== undefined && P.zelfdePersoon(gezien.persoon, m.blok.persoon, team)) gezien.persoon = m.blok.persoon;
    if (gezien.project_code !== undefined && zelfde(gezien.project_code, m.code) && !String(m.blok.project_code || '').trim()) gezien.project_code = '';
    return vraagEnDoe({ soort: 'blokWijzig', blokId: String(id), velden, gezien }, opt);
  };
  const herstel = (w, opt) => D.herstel ? D.herstel(w, opt) : Promise.resolve({ ok: false, reden: 'Terugzetten is hier niet beschikbaar.' });

  // ── tekenen (met de bouwstenen van het objectpaneel) ──
  function herkomst(m, h) {
    const pr = m.project; if (!pr) return null;
    const hr = D.href || {}, g = D.ga || {};
    return h.kruimels([
      pr.klant ? { kids: pr.klantNaam || pr.klant, href: hr.klant ? hr.klant(pr.klant) : '#', ga: () => g.klant(pr.klant), titel: 'Naar de klant' } : null,
      pr.klant && pr.loc ? { kids: pr.locNaam || pr.loc, href: hr.klant ? hr.klant(pr.klant, pr.loc) : '#', ga: () => g.klant(pr.klant, pr.loc), titel: 'Naar de locatie' } : null,
      { kids: [pr.nummer ? h.el('span', { klass: 'tp-code', tekst: pr.nummer }) : null, pr.nummer ? ' ' : '', pr.naam || m.code], href: hr.project ? hr.project(m.code) : '#', ga: () => g.project(m.code, 'planning'), titel: 'Naar het project (Planning & taken)', klass: 'tp-kruim-project' }]);
  }
  const dagLink = (h, tekst, m, titel) => D.ga && D.ga.dag && m.datum
    ? h.link(D.href && D.href.dag ? D.href.dag(m.persoon, m.datum) : '#', () => { h.sluit({ stil: true }); D.ga.dag(m.persoon, m.datum); }, tekst, 'tp-link', { title: titel })
    : h.el('span', { tekst });
  const teamOpties = () => ((D.team && D.team()) || []).filter(t => t && t.slug).map(t => [t.slug, t.naam || t.slug]);
  // Een dagveld (native datumkiezer): kiezen = meteen opslaan
  const datumVeld = (h, waarde, kan, waarom) => {
    const e = h.el('input', { type: 'date', id: 'tp-v-datum', klass: 'tp-invoer tp-datum', 'aria-label': 'Dag', value: waarde, disabled: kan ? null : true, title: kan ? null : waarom });
    let huidig = waarde;   // wat er nu staat (het veld tekent niet opnieuw zolang je erin zit, dus niet de waarde van de eerste tekening)
    e.addEventListener('change', async () => { if (!e.value || e.value === huidig) { e.value = huidig; return; } const nieuw = e.value, ok = await h.bewaar({ velden: { datum: nieuw }, gezien: { datum: huidig } }, 'de dag'); if (ok) huidig = nieuw; else e.value = huidig; });
    return e;
  };
  const knop = (h, id, tekst, klik, kl, titel) => h.el('button', { type: 'button', klass: 'tp-knop tp-klein' + (kl ? ' ' + kl : ''), id, tekst, title: titel || null, klik });
  const naamVan = m => m.blok.taak || (m.project && (m.project.naam || m.project.nummer)) || m.code || 'Planblok';
  const melding = (h, tekst, klass) => h.el('div', { klass: 'tp-melding' + (klass ? ' ' + klass : ''), role: 'status' }, h.el('span', { tekst }));

  // de acties onderaan: verwijderen, voorstel beslissen of intrekken
  function acties(m, h) {
    const uit = [];
    const doe = async (spec, ok, sluit) => {
      h.opslagStatus('bezig', 'Opslaan…');
      let r; try { r = await D.wijzig(spec, {}); } catch (e) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }; }
      if (!r || !r.ok) { h.opslagStatus(r && r.tegelijk ? 'let' : 'fout', (r && r.reden) || 'Niet opgeslagen.'); h.tekenVeilig(); return; }
      h.naWijziging();
      if (r.tegelijk) { h.opslagStatus('let', r.tegelijk); h.toast(r.tegelijk, null, true); } else { h.opslagStatus('ok', 'Opgeslagen'); h.toast(ok); }
      if (sluit) h.sluit(); else h.tekenVeilig();
    };
    if (m.kan.verwijder) uit.push(knop(h, 'pb-weg', 'Verwijderen', async () => {
      const ja = D.dialoog && D.dialoog.confirm ? await D.dialoog.confirm({ title: 'Planblok verwijderen', message: '"' + naamVan(m) + '" op ' + P.datumKort(m.datum) + (m.start ? ' ' + m.start : '') + ' verwijderen? Dit kun je niet ongedaan maken.', okLabel: 'Verwijderen', danger: true }) : false;
      if (ja) doe({ soort: 'blokWeg', blokId: m.id }, 'Planblok verwijderd.', true);
    }, 'tp-gevaar'));
    if (m.kan.beslis) {
      uit.push(knop(h, 'pb-goed', 'Goedkeuren', () => doe({ soort: 'blokKeurGoed', blokId: m.id }, 'Voorstel goedgekeurd: het is nu een gewoon planblok.', false), null, 'Wordt een gewoon planblok'));
      uit.push(knop(h, 'pb-af', 'Afwijzen…', async () => {
        const reden = D.dialoog && D.dialoog.prompt ? await D.dialoog.prompt({ title: 'Voorstel afwijzen', message: 'Reden van afwijzen (de indiener ziet deze):', placeholder: 'bv. die dag staat de CNC stil', okLabel: 'Afwijzen', danger: true }) : null;
        if (reden === null || reden === undefined) return;
        doe({ soort: 'blokWijsAf', blokId: m.id, reden }, 'Voorstel afgewezen.', true);
      }, 'tp-gevaar', 'Met reden; de indiener krijgt een melding'));
    }
    if (m.kan.trekin) uit.push(knop(h, 'pb-in', 'Mijn voorstel intrekken', async () => {
      const ja = D.dialoog && D.dialoog.confirm ? await D.dialoog.confirm({ title: 'Voorstel intrekken', message: 'Je voorstel "' + naamVan(m) + '" intrekken?', okLabel: 'Intrekken', danger: true }) : false;
      if (ja) doe({ soort: 'blokTrekIn', blokId: m.id }, 'Voorstel ingetrokken.', true);
    }, 'tp-gevaar'));
    return uit.length ? h.el('div', { klass: 'tp-acties', id: 'pb-acties' }, uit) : null;
  }

  // het formulier voor een nieuw blok (klik op een lege plek): de velden staan in B.concept, zodat een hertekening ze niet wist
  function nieuwForm(m, h) {
    const c = m.concept, zetC = (k, v) => { B.concept = Object.assign({}, B.concept || c, { [k]: v }); };
    const voorstel = m.kan.voorstel, kids = [];
    if (!m.kan.nieuw) return { aria: 'Nieuw planblok', titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: 'Nieuw planblok' }), body: [melding(h, 'Je kunt hier alleen kijken: plannen doet kantoor.', 'tp-conflict')] };
    if (voorstel) kids.push(melding(h, 'Jij dient een voorstel in: kantoor keurt het goed of wijst het af. Tot dan telt het niet mee in de capaciteit.', 'tp-voorstel'));
    kids.push(h.opslagZone());
    const inv = (id, label, waarde, o) => { const e = h.el('input', { type: 'text', id, klass: 'tp-invoer tp-rand', 'aria-label': label, autocomplete: 'off', placeholder: o.placeholder || null, inputmode: o.inputmode || null }); e.value = waarde; e.addEventListener('input', () => zetC(o.k, e.value)); return e; };
    const sel = (id, label, opties, waarde, k, na) => { const s = h.el('select', { id, klass: 'tp-invoer tp-keuze', 'aria-label': label }, opties.map(([w, l]) => h.el('option', { value: w, tekst: l }))); s.value = waarde; s.addEventListener('change', () => { zetC(k, s.value); if (na) na(); }); return s; };
    const persOpt = [['', '— kies —']].concat(teamOpties());
    const dat = h.el('input', { type: 'date', id: 'tp-v-datum', klass: 'tp-invoer tp-datum', 'aria-label': 'Dag', value: c.datum }); dat.addEventListener('change', () => zetC('datum', dat.value));
    const pOpt = [['', 'Geen project']].concat(projectOpties(c.project_code)), tOpt = [['', 'Geen taak gekoppeld']].concat(taakOpties(c.project_code, c.taak_id, ''));
    kids.push(h.sectie('pb-h-wanneer', 'Wanneer en wie', null, [
      h.rij('Persoon', sel('tp-v-persoon', 'Persoon', persOpt, c.persoon, 'persoon')), h.rij('Dag', dat),
      h.rij('Starttijd', inv('tp-v-start', 'Starttijd', c.start, { k: 'start', placeholder: 'uu:mm', inputmode: 'numeric' })),
      h.rij('Duur', inv('tp-v-duur', 'Duur', typeof c.duurMin === 'number' ? B.tekstDuur(c.duurMin) : String(c.duurMin), { k: 'duurMin', placeholder: 'bv. 1u30 of 90 min' }))]));
    kids.push(h.sectie('pb-h-waarover', 'Waarover', null, [
      h.rij('Project', sel('tp-v-project', 'Project', pOpt, c.project_code, 'project_code', () => { zetC('taak_id', ''); O.teken(); })),
      h.rij('Taak', sel('tp-v-taakid', 'Taak (optioneel)', tOpt, c.taak_id, 'taak_id', () => { const t = taakOpties(c.project_code, '', '').find(x => x[0] === (B.concept || c).taak_id); if (t && !String((B.concept || c).taak || '').trim()) zetC('taak', t[1]); O.teken(); })),
      h.rij('Titel', inv('tp-v-titel', 'Titel of omschrijving', c.taak, { k: 'taak', placeholder: 'Omschrijving' }))]));
    const nt = h.el('textarea', { id: 'tp-v-notitie', klass: 'tp-invoer tp-rand', 'aria-label': 'Notitie', rows: '3', placeholder: 'Notitie (optioneel)' }); nt.value = c.notitie; nt.addEventListener('input', () => zetC('notitie', nt.value));
    kids.push(h.sectie('pb-h-notitie', 'Notitie', null, nt));
    const verstuur = async () => {
      const x = Object.assign({}, B.concept || c), start = B.leesTijd(x.start), duur = typeof x.duurMin === 'number' ? x.duurMin : B.leesDuur(x.duurMin);
      if (!x.persoon) { h.opslagStatus('fout', 'Kies een persoon.'); return; }
      if (!P.isYmd(x.datum)) { h.opslagStatus('fout', 'Kies een dag.'); return; }
      if (start === null) { h.opslagStatus('fout', 'Vul een starttijd in, bijvoorbeeld 09:15.'); return; }
      if (duur === null) { h.opslagStatus('fout', 'Vul een duur in, bijvoorbeeld 1u30 of 90 min.'); return; }
      h.opslagStatus('bezig', 'Opslaan…');
      let r; try { r = await vraagEnDoe({ soort: 'blokNieuw', velden: { persoon: x.persoon, datum: x.datum, start, duurMin: duur, project_code: x.project_code, taak_id: x.taak_id, taak: x.taak, notitie: x.notitie } }, {}); } catch (e) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }; }
      if (r && r.geannuleerd) { h.opslagStatus(null); return; }
      if (!r || !r.ok) { h.opslagStatus(r && r.tegelijk ? 'let' : 'fout', (r && r.reden) || 'Niet opgeslagen.'); return; }
      B.concept = null; h.naWijziging();
      const w = r.wijziging;
      h.toast(w && w.voorstel ? 'Voorstel ingediend: het wacht op goedkeuring.' : '"' + (r.naam || 'Planblok') + '" ingepland.', w && !w.voorstel ? async () => { let u; try { u = await herstel(w, {}); } catch (e) { u = { ok: false, reden: 'Terugzetten mislukt.' }; } h.naWijziging(); h.toast(u && u.ok ? 'Teruggezet.' : ((u && u.reden) || 'Terugzetten lukt niet.')); if (u && u.ok) h.sluit(); } : null);
      if (r.tegelijk) h.toast(r.tegelijk, null, true);
      h.open('planblok', String(r.id));
    };
    kids.push(h.el('div', { klass: 'tp-acties' }, h.el('button', { type: 'button', klass: 'tp-knop tp-prim', id: 'pb-nieuw-ok', tekst: voorstel ? 'Voorstel indienen' : 'Inplannen', klik: verstuur }),
      h.el('button', { type: 'button', klass: 'tp-knop', id: 'pb-nieuw-annuleer', tekst: 'Annuleren', klik: () => { B.concept = null; h.sluit(); } })));
    return { aria: 'Nieuw planblok', titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: voorstel ? 'Nieuw voorstel' : 'Nieuw planblok' }), body: kids };
  }

  const DEF = {
    soort: 'planblok', label: 'Planblok',
    lees: hash => B.leesHash(hash),
    href: id => B.href(id),
    sleutelTekst: id => String(id),
    klaar: () => !D.blokkenKlaar || D.blokkenKlaar(),
    ruw: () => (D.ruw ? D.ruw() : ''),
    model: id => B.model(id),
    schrijf: (id, spec, opt) => schrijf(id, spec, opt),
    herstel: (w, opt) => herstel(w, opt),
    naWijziging: () => { if (D.naWijziging) D.naWijziging(); },
    teken: (m, h) => {
      if (!m.ok) {
        return { aria: 'Planblok', titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: DEF.klaar() ? 'Planblok niet gevonden' : 'Planning laden…' }), body: [
          h.el('p', { klass: 'tp-sub', tekst: DEF.klaar() ? 'Dit planblok bestaat niet (meer). Misschien is het verwijderd of verplaatst.' : 'De planning is nog niet geladen.' })] };
      }
      if (m.nieuw) return nieuwForm(m, h);
      const naam = naamVan(m), kids = [], kan = m.kan.wijzig, waarom = m.kan.reden;
      if (m.voorstel) kids.push(h.el('div', { klass: 'tp-melding', role: 'status' }, h.el('span', { tekst: m.voorstel.afgewezen ? 'Afgewezen voorstel' + (m.voorstel.reden ? ': ' + m.voorstel.reden : '') : 'Open voorstel' + (m.voorstel.door ? ' van ' + m.voorstel.door : '') + ': nog niet gepland, het telt niet mee in de capaciteit.' })));
      if (kan || m.kan.beslis || m.kan.trekin) kids.push(h.opslagZone());
      const tijd = m.start ? (m.eind ? m.start + ' – ' + m.eind : 'vanaf ' + m.start) : 'geen vaste tijd';
      const wanneer = kan ? [
        h.rij('Persoon', h.keuzeVeld('persoon', m.persoon, teamOpties().concat(teamOpties().some(x => x[0] === m.persoon) ? [] : [[m.persoon, m.persoonNaam || '(niemand)']]), { kan, label: 'Persoon', wat: 'de persoon', waarom }), dagLink(h, 'Naar ' + (m.persoonNaam || 'deze persoon'), m, 'Naar de dag van ' + (m.persoonNaam || 'deze persoon') + ' in de Capaciteit')),
        h.rij('Dag', datumVeld(h, m.datum, kan, waarom), dagLink(h, 'Naar deze dag', m, 'Naar deze dag in de Capaciteit')),
        h.rij('Tijd', h.tekstVeld('start', m.start, { kan, label: 'Starttijd', klass: 'tp-kort', placeholder: 'uu:mm', inputmode: 'numeric', lees: B.leesTijd, fout: 'Vul een starttijd in, bijvoorbeeld 09:15.', gezien: m.start, wat: 'de starttijd', waarom }), h.el('span', { klass: 'tp-sub', tekst: m.eind ? 'tot ' + m.eind : '' })),
        h.rij('Duur', h.tekstVeld('duurMin', B.tekstDuur(m.duurMin), { kan, label: 'Duur', klass: 'tp-kort', placeholder: 'bv. 1u30', lees: t => { const v = B.leesDuur(t); return v === null ? null : v; }, fout: 'Vul een duur in, bijvoorbeeld 1u30 of 90 min.', gezien: m.duurMin, wat: 'de duur', waarom }))]
        : [
          h.rij('Persoon', dagLink(h, m.persoonNaam || '(niemand)', m, 'Naar de dag van ' + (m.persoonNaam || 'deze persoon') + ' in de Capaciteit')),
          h.rij('Dag', m.datum ? dagLink(h, P.datumKort(m.datum), m, 'Naar deze dag in de Capaciteit') : h.el('span', { tekst: '—' })),
          h.rij('Tijd', h.el('span', { tekst: tijd })),
          h.rij('Duur', h.el('span', { tekst: m.duurMin ? P.fmtUurMin(m.duurMin) : '—' }))];
      kids.push(h.sectie('pb-h-wanneer', 'Wanneer en wie', null, wanneer));
      const g = D.ga || {}, hr = D.href || {};
      const taakLink = m.taak && h.open ? h.link(D.taakHref ? D.taakHref(m.code, m.taak.id) : '#', () => h.open('taak', { code: m.code, id: String(m.taak.id) }), m.taak.naam || '(zonder naam)', 'tp-link', { title: 'Open de taak (alle details)' }) : null;
      const projLink = m.project && m.code && g.project ? h.link(hr.project ? hr.project(m.code) : '#', () => { h.sluit({ stil: true }); g.project(m.code, 'planning'); }, [m.project.nummer ? m.project.nummer + ' ' : '', m.project.naam || m.code].join(''), 'tp-link', { title: 'Naar het project (Planning & taken)' }) : null;
      const hoort = kan ? [
        h.rij('Project', h.keuzeVeld('project_code', m.code, [['', 'Geen project']].concat(projectOpties(m.code)), { kan, label: 'Project', wat: 'het project', waarom, gezien: m.code }), projLink),
        h.rij('Taak', h.keuzeVeld('taak_id', m.blok.taak_id == null ? '' : String(m.blok.taak_id), [['', 'Geen taak gekoppeld']].concat(taakOpties(m.code, m.blok.taak_id, m.blok.taak)), { kan, label: 'Taak (optioneel)', wat: 'de taak', waarom }), taakLink),
        h.rij('Titel', h.tekstVeld('taak', String(m.blok.taak || ''), { kan, label: 'Titel of omschrijving', placeholder: 'Omschrijving', wat: 'de titel', waarom, gezien: String(m.blok.taak || '') }))]
        : [
          h.rij('Taak', taakLink || h.el('span', { klass: 'tp-sub', tekst: 'Geen taak gekoppeld' })),
          h.rij('Project', projLink || h.el('span', { klass: 'tp-sub', tekst: 'Geen project' }))];
      kids.push(h.sectie('pb-h-hoort', kan ? 'Waarover' : 'Hoort bij', null, hoort));
      if (kan) kids.push(h.sectie('pb-h-notitie', 'Notitie', null, h.tekstVeld('notitie', m.notitie, { kan, multi: true, label: 'Notitie', placeholder: 'Notitie (optioneel)', wat: 'de notitie', waarom, gezien: m.notitie })));
      else if (m.notitie) kids.push(h.sectie('pb-h-notitie', 'Notitie', null, h.el('p', { klass: 'tp-notitie', tekst: m.notitie })));
      const ac = acties(m, h); if (ac) kids.push(ac);
      const meta = [m.door ? 'Laatst gewijzigd door ' + m.door.split('@')[0] : '', m.blok.ts ? String(m.blok.ts).slice(0, 10) : ''].filter(Boolean).join(' · ');
      kids.push(h.el('div', { klass: 'tp-meta' }, h.el('p', { klass: 'tp-sub', tekst: (kan ? 'Wijzigen kan hier: kiezen of typen en wegklikken slaat op.' : waarom) + (meta ? ' ' + meta : '') })));
      return { aria: 'Planblok: ' + naam, boven: herkomst(m, h), titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: naam }), body: kids };
    }
  };

  B.open = (id, o) => (id == null || id === '') ? false : O.open('planblok', String(id), o);
  // Een nieuw blok: het formulier met voorinvulling (persoon, dag, starttijd, duur uit de klik op de Capaciteit)
  B.nieuw = function (concept, o) {
    const r = rechten();
    if (!r.kantoor && !r.voorstel) { try { if (D.toast) D.toast('Je kunt hier alleen kijken: plannen doet kantoor.'); } catch (e) {} return false; }
    B.concept = Object.assign({ persoon: '', datum: P.vandaagYmd(), start: '09:00', duurMin: 60, project_code: '', taak_id: '', taak: '', notitie: '' }, concept || {});
    return O.open('planblok', B.NIEUW, Object.assign({ push: false }, o || {}));
  };
  B.sluit = o => O.sluit(o);
  B.isOpen = () => O.isOpen('planblok');
  B.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning; O = deps.objectpaneel || root.MTObjectPaneel;
    O.registreer(Object.assign({}, DEF, { startLink: deps.startLink }));
    return B;
  };
  B.DEF = DEF;
  root.MTPlanblokPaneel = B;
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})(typeof window !== 'undefined' ? window : globalThis);

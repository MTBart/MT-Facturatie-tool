/* ============================================================================
 * mt-planblokpaneel.js: het planblok in het objectpaneel (planning brok P1a, alleen lezen)
 * ----------------------------------------------------------------------------
 * Een klik op een planblok (in de Capaciteit, in Mijn werk en in de oude Planning-weergave) opent hetzelfde rechterpaneel als bij een taak (mt-objectpaneel.js).
 * Eigen link #planblok/<id>. Inhoud: persoon, dag, tijd, duur, de taak en het project, en elk daarvan is een link naar de plek waar het hoort (de dag in de Capaciteit,
 * het taakpaneel, het project). Dit paneel schrijft NIETS: bewerken komt in P1b (op de veilige planblokwriter van F1). Tot dan staat onderaan één knop naar het bestaande
 * menu van de oude Planning-weergave (verwijderen, voorstel beslissen), zodat er niets verloren gaat.
 * model() is rekenwerk zonder DOM, zodat het zonder de hele cockpit te testen is. Alles komt van buiten via init(deps).
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

  // De projectcode van een blok: het veld, of (zonder) die uit het id tb:<code>:<taakId> (zoals MTPlanning)
  const blokCode = b => { const pc = String(b.project_code == null ? '' : b.project_code).trim(); if (pc) return pc; const m = /^tb:([^:]+):/.exec(String(b.id == null ? '' : b.id)); return m ? m[1].trim() : ''; };

  // → { ok:false, id } | { ok:true, sleutel, id, blok, code, project, taak, persoon, persoonNaam, datum, start, eind, duurMin, voorstel, door, notitie }
  B.model = function (id) {
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
    return { ok: true, sleutel: String(blok.id), id: String(blok.id), blok, code, project: pr, taak: taak ? { id: taak.id, naam: taak.naam } : null,
      persoon: lid ? lid.slug : String(blok.persoon || ''), persoonNaam: lid ? lid.naam : String(blok.persoon || ''), datum: P.isYmd(blok.datum) ? blok.datum : '',
      start: s === null ? '' : hhmm(s), eind: s !== null && duur ? hhmm(Math.min(24 * 60 - 1, s + duur)) : '', duurMin: duur,
      voorstel: v ? { door: v.doorNaam || v.door || '', afgewezen: !!v.afgewezen, reden: v.reden || '' } : null, door: String(blok.door || ''), notitie: String(blok.notitie || '') };
  };

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
  const DEF = {
    soort: 'planblok', label: 'Planblok',
    lees: hash => B.leesHash(hash),
    href: id => B.href(id),
    sleutelTekst: id => String(id),
    klaar: () => !D.blokkenKlaar || D.blokkenKlaar(),
    ruw: () => (D.ruw ? D.ruw() : ''),
    model: id => B.model(id),
    teken: (m, h) => {
      if (!m.ok) {
        return { aria: 'Planblok', titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: DEF.klaar() ? 'Planblok niet gevonden' : 'Planning laden…' }), body: [
          h.el('p', { klass: 'tp-sub', tekst: DEF.klaar() ? 'Dit planblok bestaat niet (meer). Misschien is het verwijderd of verplaatst.' : 'De planning is nog niet geladen.' })] };
      }
      const naam = m.blok.taak || (m.project && (m.project.naam || m.project.nummer)) || m.code || 'Planblok';
      const kids = [];
      if (m.voorstel) kids.push(h.el('div', { klass: 'tp-melding', role: 'status' }, h.el('span', { tekst: m.voorstel.afgewezen ? 'Afgewezen voorstel' + (m.voorstel.reden ? ': ' + m.voorstel.reden : '') : 'Open voorstel' + (m.voorstel.door ? ' van ' + m.voorstel.door : '') + ': nog niet gepland, het telt niet mee in de capaciteit.' })));
      const tijd = m.start ? (m.eind ? m.start + ' – ' + m.eind : 'vanaf ' + m.start) : 'geen vaste tijd';
      const wanneer = [
        h.rij('Persoon', dagLink(h, m.persoonNaam || '(niemand)', m, 'Naar de dag van ' + (m.persoonNaam || 'deze persoon') + ' in de Capaciteit')),
        h.rij('Dag', m.datum ? dagLink(h, P.datumKort(m.datum), m, 'Naar deze dag in de Capaciteit') : h.el('span', { tekst: '—' })),
        h.rij('Tijd', h.el('span', { tekst: tijd })),
        h.rij('Duur', h.el('span', { tekst: m.duurMin ? P.fmtUurMin(m.duurMin) : '—' }))];
      kids.push(h.sectie('pb-h-wanneer', 'Wanneer en wie', null, wanneer));
      const g = D.ga || {}, hr = D.href || {};
      const hoort = [
        h.rij('Taak', m.taak && h.open ? h.link(D.taakHref ? D.taakHref(m.code, m.taak.id) : '#', () => h.open('taak', { code: m.code, id: String(m.taak.id) }), m.taak.naam || '(zonder naam)', 'tp-link', { title: 'Open de taak (alle details)' })
          : h.el('span', { klass: 'tp-sub', tekst: 'Geen taak gekoppeld' })),
        h.rij('Project', m.project && m.code && g.project ? h.link(hr.project ? hr.project(m.code) : '#', () => { h.sluit({ stil: true }); g.project(m.code, 'planning'); }, [m.project.nummer ? m.project.nummer + ' ' : '', m.project.naam || m.code].join(''), 'tp-link', { title: 'Naar het project (Planning & taken)' })
          : h.el('span', { klass: 'tp-sub', tekst: 'Geen project' }))];
      kids.push(h.sectie('pb-h-hoort', 'Hoort bij', null, hoort));
      if (m.notitie) kids.push(h.sectie('pb-h-notitie', 'Notitie', null, h.el('p', { klass: 'tp-notitie', tekst: m.notitie })));
      const meta = [m.door ? 'Laatst gewijzigd door ' + m.door.split('@')[0] : '', m.blok.ts ? String(m.blok.ts).slice(0, 10) : ''].filter(Boolean).join(' · ');
      kids.push(h.el('div', { klass: 'tp-meta' },
        h.el('p', { klass: 'tp-sub', tekst: 'Dit paneel is alleen-lezen.' + (meta ? ' ' + meta : '') }),
        D.oudeActies ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', id: 'pb-oud', title: 'Het bestaande menu: verwijderen, of een voorstel goedkeuren of afwijzen', tekst: 'Verwijderen of voorstel beslissen…', klik: () => { D.oudeActies(m.id); } }) : null));
      return { aria: 'Planblok: ' + naam, boven: herkomst(m, h), titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: naam }), body: kids };
    }
  };

  B.open = (id, o) => (id == null || id === '') ? false : O.open('planblok', String(id), o);
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

/* ============================================================================
 * mt-planvoorstel.js — planblok als VOORSTEL (brok F1e-B), gedeeld door v2 en mobiel
 * ----------------------------------------------------------------------------
 * Werkplaats maakt een planblok als voorstel (status 'voorstel', gestippeld); Kantoor
 * en hoger keuren goed (→ gewoon blok) of wijzen af (tombstone met reden). De indiener
 * ziet de uitkomst als melding (afgeleid uit de blokken zelf + lokaal "gezien").
 * Planblokken staan op SharePoint: dit is UI-afdwinging + samenvoeger; echte afdwinging
 * komt pas met F1d.
 *
 * Samenvoegen (zelfde regels als v2 _SP.mergers.mt_planblokken): per id wint de nieuwste
 * stempel, MAAR een besloten voorstel (goedgekeurd/afgewezen) wint altijd van een nog
 * open versie van hetzelfde voorstel — een late intrekking of oude kopie zet een besluit
 * niet terug.
 * ========================================================================== */
(function (root) {
  'use strict';
  const PV = {};
  const BESLOTEN_BONUS = 1e15;
  PV.besloten = x => !!(x && x.voorstel && (x.voorstel.goedgekeurd || x.voorstel.afgewezen));
  PV.isOpen = x => !!(x && x.status === 'voorstel' && !x._vervallen && !PV.besloten(x));
  PV.basisTijd = x => {
    const v = x && x._gewijzigd;
    const t = typeof v === 'number' ? v : (Date.parse(v || '') || 0);
    return t || (Date.parse((x && x.ts) || '') || 0);
  };
  PV.tijd = x => PV.basisTijd(x) + (PV.besloten(x) ? BESLOTEN_BONUS : 0);
  PV.samen = function (lokaal, remote) {
    const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
    const L = Array.isArray(lees(lokaal)) ? lees(lokaal) : [], R = Array.isArray(lees(remote)) ? lees(remote) : [];
    const per = new Map(), los = new Map();
    for (const x of [...R, ...L]) {
      const k = (x && typeof x === 'object') ? x.id : null;
      if (k === null || k === undefined || k === '') { los.set(JSON.stringify(x), x); continue; }
      const o = per.get(String(k));
      const tx = PV.tijd(x), to = o ? PV.tijd(o) : 0;
      if (!o || tx > to || (tx === to && tx > 0)) per.set(String(k), x);   // gelijk → lokaal (komt later in de lus), zoals _spLokaalWint
    }
    return [...per.values(), ...los.values()];
  };
  PV.stempel = function (x, vorig, wie) {
    let t = Date.now(); const v = PV.basisTijd(vorig); if (v >= t) t = v + 1;
    x._gewijzigd = t; if (wie) x._door = wie; return x;
  };
  const nuIso = () => new Date().toISOString();
  PV.nieuw = function (velden, wie, wieNaam) {
    const b = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), persoon: '', project_code: '', taak: '', datum: '', start: '09:00', duurMin: 60, notitie: '' }, velden || {},
      { status: 'voorstel', voorstel: { door: wie || '', doorNaam: wieNaam || wie || '', ts: nuIso() }, ts: nuIso(), door: wie || '' });
    return PV.stempel(b, null, wie);
  };
  PV.keurGoed = function (b, wie, wieNaam) {
    const n = Object.assign({}, b); delete n.status;
    n.voorstel = Object.assign({}, b.voorstel, { goedgekeurd: { door: wie || '', doorNaam: wieNaam || wie || '', ts: nuIso() } });
    return PV.stempel(n, b, wie);
  };
  PV.wijsAf = function (b, wie, wieNaam, reden) {
    const n = Object.assign({}, b, { _vervallen: { tijd: nuIso(), door: wie || '', reden: String(reden || '').slice(0, 300) } });
    n.voorstel = Object.assign({}, b.voorstel, { afgewezen: { door: wie || '', doorNaam: wieNaam || wie || '', ts: nuIso(), reden: String(reden || '').slice(0, 300) } });
    return PV.stempel(n, b, wie);
  };
  // Indiener trekt een (nog open) voorstel in.
  PV.trekIn = function (b, wie) {
    return PV.stempel(Object.assign({}, b, { _vervallen: { tijd: nuIso(), door: wie || '', ingetrokken: true } }), b, wie);
  };
  PV.open = blokken => (blokken || []).filter(PV.isOpen);
  // Meldingen voor de indiener: eigen voorstellen met een besluit dat nog niet gezien is.
  PV.meldingen = function (blokken, wie, gezien) {
    const g = gezien instanceof Set ? gezien : new Set(gezien || []);
    const w = String(wie || '').toLowerCase();
    return (blokken || []).filter(b => PV.besloten(b) && String(b.voorstel.door || '').toLowerCase() === w && !g.has(b.id + ':' + (b.voorstel.goedgekeurd ? 'g' : 'a')))
      .map(b => ({ sleutel: b.id + ':' + (b.voorstel.goedgekeurd ? 'g' : 'a'), id: b.id, soort: b.voorstel.goedgekeurd ? 'goedgekeurd' : 'afgewezen',
        door: (b.voorstel.goedgekeurd || b.voorstel.afgewezen).doorNaam || '', reden: b.voorstel.afgewezen ? b.voorstel.afgewezen.reden || '' : '', blok: b }));
  };
  const GEZIEN = 'mt_pv_gezien';
  PV.gezien = function () { try { return new Set(JSON.parse(localStorage.getItem(GEZIEN) || '[]')); } catch (e) { return new Set(); } };
  PV.markeerGezien = function (sleutel) {
    try { const s = PV.gezien(); s.add(sleutel); localStorage.setItem(GEZIEN, JSON.stringify([...s].slice(-500))); } catch (e) {}
  };
  root.MTPlanVoorstel = PV;
})(typeof window !== 'undefined' ? window : globalThis);

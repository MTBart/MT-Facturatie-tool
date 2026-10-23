/* ============================================================================
 * mt-voortgang.js — het blok "Voortgang" bovenaan Project ▸ Overzicht (planning brok P2p, uitbreiding)
 * ----------------------------------------------------------------------------
 * Eén plek om een project snel bij te werken:
 *  - per fase een voortgangsbalk ("3/5 klaar") met dezelfde roll-up als de Tijdlijn (D.model = MTTijdlijn.model: geen tweede formule),
 *    daaronder de taken als afvinklijst (ingeklapt per fase, de eerste fase met open taken staat open);
 *  - het afvinkvakje is DEZELFDE component als in de takentabel (MTTaakTabel.afvinkVak): zelfde route, Ongedaan maken, materiaal- en wachtcontrole;
 *  - snelle updates: de projectfase (bestaande overgangen van MTLead, "Gewonnen → project" voor een geaccepteerde offerte) en de verwachte levertijd
 *    van het materiaal (P5: verwacht_op per bestelregel, of voor alle open regels tegelijk, met een bevestiging en Ongedaan maken).
 * Rol zonder recht ziet de voortgang als tekst: geen vakje, kiezer of invoerveld. Geen innerHTML: alleen DOM-calls. Alles van buiten via init(deps).
 * ========================================================================== */
(function (root) {
  'use strict';
  const V = {};
  let D = {};
  const S = { open: new Map(), bezig: false };
  const P = () => root.MTPlanning;
  const dom = () => D.doc || root.document;

  // ── rekenwerk (geen DOM) ──
  // De rijen van MTTijdlijn.model voor één project → { n, klaar, fasen: [{ naam, label, n, klaar, taken: [{ id, naam, status, wacht, mijlpaal, persoon, eind }] }] }
  V.uitRijen = function (rijen, code) {
    const lijst = Array.isArray(rijen) ? rijen : [], uit = { n: 0, klaar: 0, fasen: [] };
    const zelfde = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    let huidig = null;
    lijst.forEach(r => {
      if (!r || (code && !zelfde(r.code, code))) return;
      if (r.soort === 'project') { uit.n = r.n; uit.klaar = r.klaar; }
      else if (r.soort === 'fase') { huidig = { naam: r.fase || '', label: r.label, n: r.n, klaar: r.klaar, taken: [] }; uit.fasen.push(huidig); }
      else if (r.soort === 'taak' && huidig) huidig.taken.push({ id: r.id, naam: r.label, status: r.status, wacht: r.wacht || '', mijlpaal: !!r.mijlpaal, persoon: r.persoon || '', eind: r.eind || '' });
    });
    return uit;
  };
  V.percentage = (n, klaar) => (n > 0 ? Math.round(klaar / n * 100) : 0);
  // Welke fase staat open: de keuze van de gebruiker, anders de eerste fase met nog open taken
  V.faseOpen = function (code, fasen) {
    const eerste = fasen.find(f => f.klaar < f.n);
    return fasen.map(f => { const k = String(code).toLowerCase() + '|' + f.naam, v = S.open.get(k); return v === undefined ? f === eerste : v; });
  };
  // Materiaal: de open regels (nog niet geleverd) van het project en wat er al aan verwachte data staat
  V.materiaal = function (regels) {
    const Pl = P(), open = (regels || []).filter(b => b && !b._vervallen && Pl.bestelStatus(b) !== 'geleverd');
    const met = open.filter(b => Pl.bestelVerwacht(b));
    const data = met.map(b => Pl.bestelVerwacht(b)).sort();
    return { open, zonder: open.filter(b => !Pl.bestelVerwacht(b)), met, vroegste: data[0] || '', laatste: data[data.length - 1] || '' };
  };
  // Welke regels krijgen de datum: alle open regels, of alleen die zonder datum; regels die al die datum hebben tellen niet mee
  V.bulkKeuze = function (regels, ymd, alleenZonder) {
    const Pl = P(), m = V.materiaal(regels), basis = alleenZonder ? m.zonder : m.open;
    return basis.filter(b => String(Pl.bestelVerwacht(b) || '') !== String(ymd));
  };

  const mag = w => { try { return !!(D.mag && D.mag[w] && D.mag[w]()); } catch (e) { return false; } };
  const toast = (t, o, l, lb) => { try { if (D.toast) D.toast(t, o, l, lb); } catch (e) {} };
  const GEEN_RECHT = 'Dit mag je niet met jouw rol.';

  // ── tekenen ──
  function el(tag, o, ...kids) {
    const e = dom().createElement(tag);
    Object.keys(o || {}).forEach(k => {
      const w = o[k]; if (w === null || w === undefined || w === false) return;
      if (k === 'klass') e.className = w; else if (k === 'tekst') e.textContent = w; else if (k === 'klik') e.addEventListener('click', w);
      else if (k === 'value') e.value = w; else if (k === 'disabled' || k === 'selected' || k === 'open') e[k] = !!w; else e.setAttribute(k, w === true ? '' : w);
    });
    kids.flat().forEach(c => { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === 'string' ? dom().createTextNode(c) : c); });
    return e;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const IC = { flag: 'M4 21V4m0 0h12l-2 4 2 4H4', truck: 'M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z', chev: 'M9 6l6 6-6 6' };
  function ico(naam) {
    const s = dom().createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'vg-ico');
    [['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']].forEach(([k, w]) => s.setAttribute(k, w));
    const p = dom().createElementNS(NS, 'path'); p.setAttribute('d', IC[naam]); s.appendChild(p); return s;
  }
  const balk = (n, klaar, klass) => el('span', { klass: 'vg-balk' + (klass ? ' ' + klass : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(n), 'aria-valuenow': String(klaar), 'aria-label': klaar + ' van ' + n + ' klaar' }, el('i', { style: 'width:' + V.percentage(n, klaar) + '%' }));
  const kort = ymd => { try { return P().datumKort(ymd); } catch (e) { return ymd; } };

  function takenLijst(code, f) {
    return el('div', { klass: 'vg-taken' }, f.taken.map(t => {
      const vak = root.MTTaakTabel && root.MTTaakTabel.afvinkVak ? root.MTTaakTabel.afvinkVak(code, t) : el('span', { klass: 'tt-klaar tt-klaar-uit' });
      const meta = [t.persoon, t.eind ? 'eind ' + kort(t.eind) : ''].filter(Boolean).join(' · ');
      const naam = el('button', { type: 'button', klass: 'vg-naam' + (t.status === 'klaar' ? ' klaar' : ''), title: 'Open de taak (alle details)', klik: () => { if (D.openTaak) D.openTaak(code, t.id, naam); } }, t.naam || '(zonder naam)');
      return el('div', { klass: 'vg-taak', 'data-vg-taak': String(t.id) }, vak, el('div', { klass: 'vg-tekst' }, naam,
        t.status === 'wacht' ? el('span', { klass: 'vg-tag vg-wacht', tekst: 'Wacht' + (t.wacht ? ': ' + t.wacht : '') }) : (t.status === 'bezig' ? el('span', { klass: 'vg-tag', tekst: 'Bezig' }) : null),
        meta ? el('span', { klass: 'vg-meta', tekst: meta }) : null));
    }));
  }

  // De projectfase: de bestaande overgangen (D.faseOpties); een geaccepteerde offerte = "Gewonnen → project" (de bestaande logica, met haar eigen bevestiging)
  function faseRij(code) {
    const o = D.faseOpties ? D.faseOpties(code) : null; if (!o) return null;
    const rij = el('div', { klass: 'vg-rij' }, el('span', { klass: 'vg-lab' }, ico('flag'), 'Projectfase'));
    if (!o.kan || !o.opties.length) { rij.appendChild(el('span', { klass: 'vg-waarde', tekst: o.huidig.l || 'Geen fase' })); return rij; }
    const sel = el('select', { klass: 'vg-sel', 'aria-label': 'Projectfase wijzigen', title: 'Nu: ' + (o.huidig.l || 'geen fase') },
      el('option', { value: '', tekst: (o.huidig.l || 'Geen fase') + ' (nu)' }), o.opties.map(x => el('option', { value: x.k, tekst: x.l })));
    sel.addEventListener('change', async () => {
      const naar = sel.value; if (!naar) return;
      if (!mag('fase')) { toast(GEEN_RECHT, null, true); sel.value = ''; return; }
      let r; try { r = await D.faseKies(code, naar, sel); } catch (e) { r = { ok: false, reden: 'Mislukt: ' + ((e && e.message) || e) }; }
      if (r && r.ok === false && r.reden) toast(r.reden, null, true);
      if (r && r.ok && r.terug) toast('Projectfase: ' + r.label + '.', async () => { const h = await r.terug(); toast(h && h.ok ? 'Teruggezet.' : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !(h && h.ok)); if (D.naWijziging) D.naWijziging(); });
      if (D.naWijziging) D.naWijziging();
    });
    rij.appendChild(sel); return rij;
  }

  // Levertijd van het materiaal: één datum voor alle open regels (met keuze en bevestiging), of per regel
  function materiaalRij(code) {
    const regels = D.regels ? D.regels(code) : [], m = V.materiaal(regels), kan = mag('bestel');
    const rij = el('div', { klass: 'vg-rij vg-mat' }, el('span', { klass: 'vg-lab' }, ico('truck'), 'Levertijd materiaal'));
    if (!regels.length) { rij.appendChild(el('span', { klass: 'vg-waarde vg-zacht', tekst: 'Geen bestelregels bij dit project' })); return rij; }
    if (!m.open.length) { rij.appendChild(el('span', { klass: 'vg-waarde', tekst: 'Alles geleverd' })); return rij; }
    rij.appendChild(el('span', { klass: 'vg-waarde', tekst: m.open.length + ' regel' + (m.open.length === 1 ? '' : 's') + ' niet binnen' + (m.met.length ? ', ' + m.met.length + ' met datum' + (m.vroegste ? ' (' + kort(m.vroegste) + (m.laatste !== m.vroegste ? ' t/m ' + kort(m.laatste) : '') + ')' : '') : ', nog geen datum') }));
    if (!kan) return rij;
    const inv = el('input', { type: 'date', klass: 'vg-in', 'aria-label': 'Verwachte leverdatum voor alle open regels', title: 'Verwachte leverdatum voor alle open regels' });
    const knop = el('button', { type: 'button', klass: 'btn btn-primary btn-sm vg-knop', title: 'Zet deze datum bij de open bestelregels (met bevestiging)', klik: () => V.bulk(code, inv.value) }, 'Zet levertijd…');
    rij.appendChild(el('span', { klass: 'vg-invoer' }, inv, knop));
    const det = el('details', { klass: 'vg-regels' }, el('summary', { tekst: 'Per regel' }),
      m.open.map(b => {
        const naam = P().bestelOms(b) || b.materiaal || 'regel', cur = P().bestelVerwacht(b) || '';
        const i = el('input', { type: 'date', klass: 'vg-in', 'aria-label': 'Verwachte leverdatum van ' + naam, value: cur }); let begin = cur;
        const sla = () => { if (i.value !== begin) V.regel(code, b.id, i.value, begin); };
        i.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); i.value = begin; } else if (ev.key === 'Enter') { ev.preventDefault(); i.blur(); } });
        i.addEventListener('blur', sla);
        return el('div', { klass: 'vg-regel' }, el('span', { klass: 'vg-regelnaam', tekst: naam }), i);
      }));
    rij.appendChild(det);
    return rij;
  }

  // ── schrijfacties (alleen via de bestaande P5-route van de bestellijst, met bevestiging en Ongedaan maken) ──
  V.regel = async function (code, id, ymd, voor) {
    if (!mag('bestel')) { toast(GEEN_RECHT, null, true); V.teken(code); return false; }
    const b = (D.regels ? D.regels(code) : []).find(x => String(x.id) === String(id)); const voorB = b ? { id: b.id, verwacht_op: b.verwacht_op || '', verwacht_bron: b.verwacht_bron || '', gezet: ymd } : { id, verwacht_op: voor || '', verwacht_bron: '', gezet: ymd };
    const ok = D.bestelVerwacht(id, ymd);
    if (D.naWijziging) D.naWijziging(); else V.teken(code);
    if (!ok) { toast('De levertijd is niet opgeslagen.', null, true); return false; }
    toast('Levertijd ' + (ymd ? 'op ' + kort(ymd) : 'gewist') + ' opgeslagen.', async () => { const h = D.bestelHerstel([voorB]); toast(h && h.ok ? 'Teruggezet.' : 'Terugzetten lukt niet (de regel is intussen gewijzigd).', null, !(h && h.ok)); if (D.naWijziging) D.naWijziging(); });
    return true;
  };
  V.bulk = async function (code, ymd) {
    if (S.bezig) { toast('Even wachten: de vorige wijziging wordt nog opgeslagen.', null, true); return false; }
    S.bezig = true;
    try {
      if (!mag('bestel')) { toast(GEEN_RECHT, null, true); return false; }
      if (!ymd || !P().isYmd(ymd)) { toast('Kies eerst een geldige datum.', null, true); return false; }
      const dlg = D.dialoog; if (!dlg || !dlg.confirm) return false;
      if (D.bestelVers) { try { await D.bestelVers(); } catch (e) { } }   // eerst de gezamenlijke bestellijst lezen: een collega kan intussen een datum hebben gezet of een regel hebben geleverd
      const regels = D.regels(code), m = V.materiaal(regels);
      if (!m.open.length) { toast('Er zijn geen open regels meer.', null, true); V.teken(code); return false; }
      let alleenZonder = false;
      if (m.met.length && m.zonder.length) {
        const i = await dlg.choose({ title: 'Levertijd ' + kort(ymd), message: m.met.length + ' open regel' + (m.met.length === 1 ? ' heeft' : 's hebben') + ' al een datum.', choices: [{ label: 'Alle open regels (' + m.open.length + ')', sublabel: 'ook die met een datum krijgen ' + kort(ymd) }, { label: 'Alleen regels zonder datum (' + m.zonder.length + ')', sublabel: 'de rest blijft zoals het is' }] });
        if (i === null || i === undefined) return false; alleenZonder = i === 1;
      }
      const keuze = V.bulkKeuze(regels, ymd, alleenZonder);
      if (!keuze.length) { toast('Alle gekozen regels hebben al deze datum.', null, true); return false; }
      const namen = keuze.slice(0, 6).map(b => '• ' + (P().bestelOms(b) || b.materiaal || 'regel')).join('\n') + (keuze.length > 6 ? '\n… en ' + (keuze.length - 6) + ' meer' : '');
      const ja = await dlg.confirm({ title: 'Levertijd zetten?', message: 'De verwachte leverdatum wordt ' + kort(ymd) + ' voor ' + keuze.length + ' bestelregel' + (keuze.length === 1 ? '' : 's') + ':\n' + namen + '\n\nJe kunt dit direct ongedaan maken.', okLabel: 'Zet levertijd' });
      if (!ja) return false;
      if (!mag('bestel')) { toast(GEEN_RECHT, null, true); return false; }   // het recht kan tijdens de bevestiging veranderd zijn
      const r = D.bestelBulk(keuze.map(b => b.id), ymd);
      if (D.naWijziging) D.naWijziging(); else V.teken(code);
      if (!r || !r.n) { toast('Er is niets gewijzigd' + (r && r.reden ? ': ' + r.reden : '.'), null, true); return false; }
      const tekst = 'Levertijd ' + kort(ymd) + ' gezet voor ' + r.n + ' regel' + (r.n === 1 ? '' : 's') + (r.mislukt ? '; ' + r.mislukt + ' niet gelukt' : '') + '.';
      toast(tekst, async () => { const h = D.bestelHerstel(r.vorige); toast(h && h.ok ? 'Teruggezet' + (h.overgeslagen ? ' (' + h.overgeslagen + ' regel(s) overgeslagen: intussen door een collega gewijzigd)' : '.') : 'Terugzetten lukt niet.', null, !!(h && h.overgeslagen) || !(h && h.ok)); if (D.naWijziging) D.naWijziging(); }, !!r.mislukt);
      return true;
    } finally { S.bezig = false; }
  };

  // ── het blok ──
  function bouw(code) {
    const m = D.model ? V.uitRijen(D.model(code), code) : { n: 0, klaar: 0, fasen: [] };
    const sec = el('section', { klass: 'vg', 'aria-labelledby': 'vg-kop-' + String(code).replace(/[^a-z0-9]/gi, ''), 'data-vg-code': code });
    sec.appendChild(el('div', { klass: 'vg-kop' }, el('h3', { id: 'vg-kop-' + String(code).replace(/[^a-z0-9]/gi, ''), tekst: 'Voortgang' }), m.n ? el('span', { klass: 'vg-tot', tekst: m.klaar + '/' + m.n + ' klaar' }) : null));
    if (m.n) sec.appendChild(balk(m.n, m.klaar, 'vg-groot'));
    const snel = el('div', { klass: 'vg-snel' }, faseRij(code), materiaalRij(code)); sec.appendChild(snel);
    if (!m.n) { sec.appendChild(el('p', { klass: 'vg-leeg', tekst: 'Nog geen taken bij dit project. Voeg ze toe bij Planning & taken.' })); return sec; }
    const open = V.faseOpen(code, m.fasen);
    m.fasen.forEach((f, i) => {
      const det = el('details', { klass: 'vg-fase', open: open[i] },
        el('summary', null, ico('chev'), el('span', { klass: 'vg-fasenaam', tekst: f.label }), balk(f.n, f.klaar), el('span', { klass: 'vg-fasetel', tekst: f.klaar + '/' + f.n + ' klaar' })), takenLijst(code, f));
      det.addEventListener('toggle', () => { S.open.set(String(code).toLowerCase() + '|' + f.naam, det.open); });
      sec.appendChild(det);
    });
    return sec;
  }
  V.teken = function (code) {
    const oud = dom().querySelector('.vg[data-vg-code]'); if (!oud) return false;
    const nieuw = bouw(code); oud.parentNode.replaceChild(nieuw, oud); stijl();
    if (root.MTTaakTabel && root.MTTaakTabel.herstelFocus) root.MTTaakTabel.herstelFocus(nieuw);
    return true;
  };
  // Bovenaan de sectie Overzicht zetten (eerste kind van het paneel)
  V.monteer = function (code, paneel) {
    if (!paneel || !code) return false;
    const oud = paneel.querySelector('.vg[data-vg-code]'); if (oud) oud.remove();
    const sec = bouw(code); paneel.insertBefore(sec, paneel.firstChild); stijl();
    if (root.MTTaakTabel && root.MTTaakTabel.herstelFocus) root.MTTaakTabel.herstelFocus(sec);
    return true;
  };

  const CSS = [
    '.vg{border:1px solid var(--line,#dfd8cb);border-radius:8px;padding:12px;margin:0 0 14px;background:var(--surface,#fff);max-width:100%;box-sizing:border-box}.vg *{min-width:0;box-sizing:border-box}',
    '.vg-kop{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px}.vg-kop h3{margin:0;font-size:15px;font-weight:600;color:var(--primary,#2A4A38)}.vg-tot{margin-left:auto;font-size:13px;color:var(--primary,#2A4A38);font-weight:600}',
    '.vg-balk{display:block;height:6px;border-radius:3px;background:var(--surface-sunken,#efe9dd);overflow:hidden}.vg-balk i{display:block;height:100%;background:var(--primary,#2A4A38)}.vg-groot{height:8px}',
    '.vg-snel{display:grid;gap:10px;margin:12px 0}.vg-rij{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.vg-lab{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-3,#646a64);flex:0 0 150px}.vg-ico{flex:none}',
    '.vg-waarde{font-size:13px;overflow-wrap:break-word;word-break:normal}.vg-zacht{color:var(--text-faint,#8a8f8a)}.vg-invoer{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.vg-sel{min-width:200px;max-width:320px}.vg-sel,.vg-in{font:inherit;font-size:13px;min-height:32px;padding:3px 8px;border:1px solid var(--line,#dfd8cb);border-radius:4px;background:var(--surface,#fff);color:inherit;max-width:100%}.vg-knop{min-height:32px}',
    '.vg-regels{flex:1 1 100%;margin-left:0}.vg-regels summary{cursor:pointer;font-size:12px;color:var(--ink-3,#646a64);min-height:32px;display:flex;align-items:center}.vg-regel{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:4px 0}.vg-regelnaam{flex:1 1 140px;font-size:13px;overflow-wrap:break-word}',
    '.vg-fase{border-top:1px solid var(--line,#dfd8cb)}.vg-fase summary{display:flex;align-items:center;gap:8px;cursor:pointer;min-height:40px;list-style:none}.vg-fase summary::-webkit-details-marker{display:none}.vg-fase summary .vg-ico{transition:transform .15s;color:var(--ink-3,#646a64)}.vg-fase[open] summary .vg-ico{transform:rotate(90deg)}',
    '.vg-fasenaam{font-size:13px;font-weight:600;flex:1 1 90px;overflow-wrap:break-word}.vg-fase summary .vg-balk{flex:0 0 80px}.vg-fasetel{font-size:12px;color:var(--ink-3,#646a64);white-space:nowrap}',
    '.vg-taak{display:flex;align-items:flex-start;gap:4px}.vg-taak .tt-klaar{flex:none}.vg-tekst{flex:1 1 140px;display:flex;flex-direction:column;gap:2px;padding:4px 0}',
    '.vg-naam{display:block;text-align:left;background:none;border:0;padding:0;font:inherit;font-size:13px;color:inherit;cursor:pointer;overflow-wrap:break-word;word-break:normal;hyphens:auto}.vg-naam:hover{text-decoration:underline}.vg-naam.klaar{color:var(--text-faint,#8a8f8a);text-decoration:line-through}',
    '.vg-tag{font-size:11px;color:var(--ink-3,#646a64)}.vg-wacht{color:var(--gold-text,#7A6010)}.vg-meta{font-size:11px;color:var(--text-faint,#8a8f8a)}.vg-leeg{font-size:13px;color:var(--text-faint,#8a8f8a);margin:6px 0 0}',
    '.vg .tt-klaar{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;cursor:pointer}.vg .tt-klaar-in{width:18px;height:18px;cursor:pointer}.vg .tt-klaar-uit{cursor:default;color:var(--primary,#2A4A38);font-weight:700}',
    '.vg-sel:focus-visible,.vg-in:focus-visible,.vg-naam:focus-visible,.vg-fase summary:focus-visible,.vg-regels summary:focus-visible,.vg .tt-klaar-in:focus-visible{outline:2px solid var(--primary,#2A4A38);outline-offset:1px}',
    '@media (max-width:640px){.vg{padding:10px}.vg-lab{flex:1 1 100%}.vg-sel,.vg-in,.vg-knop{min-height:44px;font-size:14px}.vg-sel{width:100%;max-width:none}.vg-invoer{width:100%}.vg-invoer .vg-in{flex:1 1 140px}.vg-knop{flex:1 1 100%}',
    '.vg .tt-klaar{min-width:44px;min-height:44px}.vg .tt-klaar-in{width:26px;height:26px}.vg-naam{padding:10px 0}.vg-fase summary,.vg-regels summary{min-height:44px}.vg-regel .vg-in{width:100%}.vg-fase summary .vg-balk{flex:0 0 56px}}'
  ].join('\n');
  function stijl() { const d = dom(); if (!d || !d.head || d.getElementById('vg-stijl')) return; const s = d.createElement('style'); s.id = 'vg-stijl'; s.textContent = CSS; d.head.appendChild(s); }

  V.init = cfg => { D = cfg || {}; S.open = new Map(); S.bezig = false; return V; };
  V._stijl = CSS;
  root.MTVoortgang = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

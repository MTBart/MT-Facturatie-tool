/* ============================================================================
 * mt-lead.js — fases van een dossier, van lead tot afgerond (L1a), en de lijst "Vandaag". Puur: geen DOM, geen opslag.
 * Eén doorlopende lijn per project_id (keuze Bart 12-10):
 *   lead:    nieuw → opname → offerte_maken → verstuurd → gewonnen | verloren | geparkeerd
 *   project: werkvoorbereiding → inkoop → productie → klaar_levering → factureren → nacalculatie → afgerond
 * "Gewonnen" is een mijlpaal: het project gaat meteen door naar werkvoorbereiding (zelfde project_id, geen nieuw dossier).
 * Het oude veld `status` (offerte/lopend/opgeleverd/archief) blijft als compatibiliteitslaag: statusVoor(fase).
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;
  const FASES = [
    { k: 'nieuw', l: 'Nieuw', soort: 'lead', kans: 10 },
    { k: 'opname', l: 'Opname', soort: 'lead', kans: 25 },
    { k: 'offerte_maken', l: 'Offerte maken', soort: 'lead', kans: 40 },
    { k: 'verstuurd', l: 'Offerte verstuurd', soort: 'lead', kans: 50 },
    { k: 'gewonnen', l: 'Gewonnen', soort: 'mijlpaal', kans: 100 },
    { k: 'verloren', l: 'Verloren', soort: 'lead-eind', kans: 0 },
    { k: 'geparkeerd', l: 'Geparkeerd', soort: 'lead', kans: 10 },
    { k: 'werkvoorbereiding', l: 'Werkvoorbereiding', soort: 'project' },
    { k: 'inkoop', l: 'Inkoop', soort: 'project' },
    { k: 'productie', l: 'Productie', soort: 'project' },
    { k: 'klaar_levering', l: 'Klaar voor levering', soort: 'project' },
    { k: 'factureren', l: 'Factureren', soort: 'project' },
    { k: 'nacalculatie', l: 'Nacalculatie', soort: 'project' },
    { k: 'afgerond', l: 'Afgerond', soort: 'project-eind' }];
  const PER = new Map(FASES.map(f => [f.k, f]));
  const LEAD_OPEN = ['nieuw', 'opname', 'offerte_maken', 'verstuurd', 'geparkeerd'];
  const PROJECT = ['werkvoorbereiding', 'inkoop', 'productie', 'klaar_levering', 'factureren', 'nacalculatie', 'afgerond'];
  // Toegestane overgangen. Een project zonder fase (van vóór L1) mag elke fase krijgen (eerste indeling).
  const NAAR = {
    nieuw: ['opname', 'offerte_maken', 'verstuurd', 'gewonnen', 'verloren', 'geparkeerd'],
    opname: ['nieuw', 'offerte_maken', 'verstuurd', 'gewonnen', 'verloren', 'geparkeerd'],
    offerte_maken: ['opname', 'verstuurd', 'gewonnen', 'verloren', 'geparkeerd'],
    verstuurd: ['offerte_maken', 'gewonnen', 'verloren', 'geparkeerd'],
    geparkeerd: ['nieuw', 'opname', 'offerte_maken', 'verstuurd', 'gewonnen', 'verloren'],
    verloren: ['nieuw', 'geparkeerd'],                        // heropenen
  };
  // projectfases: vooruit naar elke latere fase, terug alleen één stap
  PROJECT.forEach((k, i) => { NAAR[k] = PROJECT.slice(i + 1).concat(i > 0 ? [PROJECT[i - 1]] : []); });
  const VERLIES_REDENEN = [['te_duur', 'Te duur'], ['geen_reactie', 'Geen reactie'], ['te_laat', 'Te laat'], ['andere_keus', 'Andere keus'], ['anders', 'Anders']];
  const BRONNEN = [['mail', 'Mail'], ['telefoon', 'Telefoon'], ['website', 'Website'], ['netwerk', 'Netwerk']];
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  const geldigeDatum = d => YMD.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));

  const label = k => (PER.get(k) || {}).l || '';
  const isLead = p => !!p && LEAD_OPEN.concat(['verloren']).includes(p.fase);
  const isOpenLead = p => !!p && !p._vervallen && LEAD_OPEN.includes(p.fase);
  function magNaar(van, naar) {
    if (!PER.has(naar)) return false;
    if (!van) return true;                                     // eerste indeling: alles mag
    if (van === naar) return false;
    return (NAAR[van] || []).includes(naar);
  }
  // Opties voor een keuzelijst vanaf de huidige fase (gewonnen staat erbij als "Gewonnen → project").
  const opties = van => (van ? (NAAR[van] || []) : FASES.map(f => f.k).filter(k => k !== 'gewonnen'));
  // '' = goed; anders de reden waarom de overgang (nog) niet kan.
  function controleer(van, naar, extra) {
    extra = extra || {};
    if (!magNaar(van, naar)) return 'Van "' + (label(van) || 'geen fase') + '" naar "' + (label(naar) || naar) + '" kan niet';
    if (naar === 'verloren') {
      const r = extra.verlies && extra.verlies.reden;
      if (!VERLIES_REDENEN.some(x => x[0] === r)) return 'Kies een reden waarom de lead verloren is';
    }
    if (naar === 'geparkeerd' && !geldigeDatum(extra.geparkeerd_tot)) return 'Kies een datum waarop de lead opnieuw bekeken wordt';
    return '';
  }
  // Compatibiliteit met het oude statusveld.
  function statusVoor(fase) {
    if (LEAD_OPEN.includes(fase)) return 'offerte';
    if (fase === 'verloren' || fase === 'afgerond') return 'archief';
    if (['werkvoorbereiding', 'inkoop', 'productie', 'klaar_levering'].includes(fase)) return 'lopend';
    if (['factureren', 'nacalculatie'].includes(fase)) return 'opgeleverd';
    return null;
  }
  // Wat er na "naar" in de velden komt (de aanroeper zet ze met projVeldZet). Gewonnen → werkvoorbereiding + gewonnen_op.
  function overgang(van, naar, extra, vandaag) {
    extra = extra || {};
    const uit = { fase: naar === 'gewonnen' ? 'werkvoorbereiding' : naar };
    if (naar === 'gewonnen') uit.gewonnen_op = vandaag;
    if (naar === 'verloren') uit.verlies = { reden: extra.verlies.reden, toelichting: String(extra.verlies.toelichting || '').slice(0, 300) };
    if (naar === 'geparkeerd') uit.geparkeerd_tot = extra.geparkeerd_tot;
    if (van === 'geparkeerd' && naar !== 'geparkeerd') uit.geparkeerd_tot = null;
    if (van === 'verloren' && naar !== 'verloren') uit.verlies = null;
    return uit;
  }
  // "Vandaag": acties van vandaag of te laat (open leads en lopende projecten), open leads zonder volgende actie, en
  // geparkeerde leads waarvan de datum bereikt is. Te laat eerst, dan vandaag, dan de rest; binnen een soort op datum.
  function vandaag(projecten, ymd) {
    const uit = [];
    for (const p of Array.isArray(projecten) ? projecten : []) {
      if (!p || p._vervallen || !p.fase || ['verloren', 'afgerond'].includes(p.fase)) continue;
      const a = p.volgende_actie && typeof p.volgende_actie === 'object' ? p.volgende_actie : null, d = a && geldigeDatum(a.datum) ? a.datum : '';
      if (p.fase === 'geparkeerd') { if (geldigeDatum(p.geparkeerd_tot) && p.geparkeerd_tot <= ymd) uit.push({ p, soort: 'geparkeerd_terug', datum: p.geparkeerd_tot }); continue; }
      if (d && d < ymd) uit.push({ p, soort: 'te_laat', datum: d });
      else if (d && d === ymd) uit.push({ p, soort: 'vandaag', datum: d });
      else if (!d && LEAD_OPEN.includes(p.fase)) uit.push({ p, soort: 'geen_actie', datum: '' });
    }
    const orde = { te_laat: 0, vandaag: 1, geparkeerd_terug: 2, geen_actie: 3 };
    return uit.sort((x, y) => (orde[x.soort] - orde[y.soort]) || String(x.datum).localeCompare(String(y.datum)) || String(x.p.code).localeCompare(String(y.p.code)));
  }
  root.MTLead = { FASES, LEAD_OPEN, PROJECT, NAAR, VERLIES_REDENEN, BRONNEN, label, isLead, isOpenLead, magNaar, opties, controleer, statusVoor, overgang, vandaag, geldigeDatum };
})(typeof window !== 'undefined' ? window : globalThis);

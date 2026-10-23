/* ============================================================================
 * mt-verbeter.js — eerlijke Larry + bouwwachtrij voor verbeterpunten en feedback
 * ----------------------------------------------------------------------------
 * Pure functies, geen DOM en geen opslag: te testen zonder browser.
 *
 *  • EERLIJK: één vaste regel die claudeCall (v2.html) aan ELKE Larry-aanroep meegeeft als `system`.
 *    Larry belooft nooit dat iets gebouwd, gepland of "in development" is; de status van een
 *    verbeterpunt komt alleen uit het record, nooit uit Larry.
 *  • Fasen: te-beoordelen → goedgekeurd → in-bouw → live (plus afgewezen, altijd met reden).
 *    De oude statussen blijven bestaan en worden gemapt, zonder bestaande records te herschrijven:
 *    nieuw = te beoordelen, opgepakt = goedgekeurd, afgerond = live.
 *  • Twee bronnen in één wachtrij: mt_verbeterpunten.json (cockpit) en mt_feedback.json (telefoon).
 *  • samen(): samenvoeger per id, de nieuwste `_gewijzigd` wint (gelijk → lokaal; beide zonder stempel → SharePoint).
 * ========================================================================== */
(function (root) {
  'use strict';
  const V = {};

  V.EERLIJK = [
    'EERLIJKHEIDSREGEL (gaat voor al het andere):',
    '- Je belooft nooit dat iets gebouwd, gepland, ingepland of "in development"/"in ontwikkeling" is, en je zegt nooit iets toe namens Bart of het team.',
    '- Je kunt alleen uitleggen wat de tool nu doet, vragen scherp stellen en het punt laten vastleggen. Of en wanneer iets gebouwd wordt, beslist Bart.',
    '- De status van een verbeterpunt (te beoordelen, goedgekeurd, in bouw, live, afgewezen) komt uitsluitend uit het record in de tool, nooit van jou. Noem geen status of datum die je niet in het gesprek hebt gekregen.',
    '- Weet je niet of de tool iets kan? Zeg dat je het niet weet en dat het als verbeterpunt vastgelegd kan worden. Verzin geen functies.'
  ].join('\n');

  // ── Model (één plek): Haiku 5.5, exacte id zonder datum. De worker (CLAUDE_MODEL_RE) staat haiku en sonnet toe. ──
  V.MODEL = 'claude-haiku-5-5';
  V.MAX_TOKENS = 4096;   // plafond van de worker; thinking telt mee, dus nooit krapper dan MIN_TOKENS
  V.MIN_TOKENS = 2000;
  V.EFFORT = 'low';
  V.tokens = n => Math.min(V.MAX_TOKENS, Math.max((Number(n) || 0) + 1000, V.MIN_TOKENS));
  // Het verzoek zoals het naar de worker gaat. Geen temperature en geen budget_tokens (geven een 400 bij Haiku 5.5).
  V.verzoek = (messages, maxTokens, system, effort) => ({ model: V.MODEL, max_tokens: V.tokens(maxTokens), output_config: { effort: effort || V.EFFORT }, system, messages });

  // ── Antwoord lezen: thinking-blokken kunnen voor de tekst staan, dus het eerste blok met type 'text' (nooit content[0]). ──
  V.tekst = r => {
    const b = r && Array.isArray(r.content) ? r.content.find(x => x && (x.type === 'text' || x.type === undefined) && typeof x.text === 'string') : null;
    return b ? b.text : '';
  };
  V.MELDING_WEIGERING = 'Larry wil hier niet op antwoorden. Stel de vraag anders of leg het uit aan Bart.';
  V.MELDING_AFGEKAPT = 'Het antwoord werd afgekapt omdat het te lang werd. Stel de vraag korter of specifieker.';
  // Antwoord voor een gebruiker: een nette melding bij een weigering, een afgekapt antwoord of een fout.
  V.antwoord = r => {
    if (r && r.error && !V.tekst(r)) return 'fout: ' + (r.error.message || r.error);
    if (r && r.stop_reason === 'refusal') return V.MELDING_WEIGERING;
    const tx = V.tekst(r);
    if (r && r.stop_reason === 'max_tokens') return tx ? tx + '\n\n(' + V.MELDING_AFGEKAPT + ')' : V.MELDING_AFGEKAPT;
    return tx || '(geen antwoord)';
  };

  // ── Actuele stand: alleen hiernaar mag Larry verwijzen ("dat weet ik niet" in plaats van gokken). Klein en stabiel voor caching. ──
  const kort = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  V.STAND_MAX = 1200;
  // updates: de lijst uit data/updates.json (nieuwste eerst); extra: regels over het record waar het over gaat.
  V.stand = (updates, extra) => {
    const live = (Array.isArray(updates) ? updates : []).filter(u => u && u.versie).slice(0, 5)
      .map(u => '- v' + u.versie + (u.datum ? ' (' + u.datum + ')' : '') + ': ' + kort(u.titel, 90));
    const delen = ['ACTUELE STAND (alleen hiernaar mag je verwijzen; wat hier niet staat weet je niet: zeg "dat weet ik niet"):'];
    delen.push(live.length ? 'Live in de tool, nieuwste eerst:\n' + live.join('\n') : 'Over wat er live is, is nu niets bekend.');
    if (extra) delen.push(String(extra));
    const uit = delen.join('\n');
    return uit.length > V.STAND_MAX ? uit.slice(0, V.STAND_MAX) : uit;
  };
  // Regels over records uit de wachtrij (titel, fase, laatste notitie); de status komt alleen hieruit.
  V.recordStand = items => 'Status van recente verbeterpunten (uit de tool):\n' + ((items || []).slice(0, 5)
    .map(x => '- ' + kort(x.titel, 60) + ': ' + (V.LABEL[x.fase] || x.fase) + (x.historie && x.historie.length && x.historie[x.historie.length - 1].notitie ? ' (' + kort(x.historie[x.historie.length - 1].notitie, 60) + ')' : '')).join('\n') || '- (geen)');

  // De volledige systeemprompt voor één aanroep, vaste volgorde (stabiel voorop voor caching):
  // eerlijkheidsregel, actuele stand, en als laatste de rol-/taakprompt.
  V.systeem = (extra, stand) => V.EERLIJK + (stand ? '\n\n' + String(stand) : '') + (extra ? '\n\n' + String(extra) : '');
  V.FASEN = ['te-beoordelen', 'goedgekeurd', 'in-bouw', 'live', 'afgewezen'];
  V.LABEL = { 'te-beoordelen': 'Te beoordelen', 'goedgekeurd': 'Goedgekeurd', 'in-bouw': 'In bouw', 'live': 'Live', 'afgewezen': 'Afgewezen' };
  V.LEGACY = { 'te-beoordelen': 'nieuw', 'goedgekeurd': 'opgepakt', 'in-bouw': 'opgepakt', 'live': 'afgerond', 'afgewezen': 'afgewezen' };
  const VAN_LEGACY = { nieuw: 'te-beoordelen', opgepakt: 'goedgekeurd', afgerond: 'live', afgewezen: 'afgewezen' };

  // Fase van een record: het veld `fase` wint; anders de oude status; onbekend → te beoordelen.
  V.fase = r => {
    if (r && V.FASEN.includes(r.fase)) return r.fase;
    return (r && VAN_LEGACY[r.status]) || 'te-beoordelen';
  };

  const tijd = r => { const v = r && r._gewijzigd; if (typeof v === 'number') return v; const t = Date.parse(v || ''); return isNaN(t) ? 0 : t; };
  const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
  const lijstUit = v => { const x = lees(v); return Array.isArray(x) ? x : (x && Array.isArray(x.items) ? x.items : []); };
  V.lijstUit = lijstUit;
  const aangemaakt = r => String((r && (r.aangemaakt_op || r.ts)) || '');

  // Nieuwe stand van één record na een besluit van Bart. Het oude record blijft ongemoeid (nieuw object).
  // → { ok:true, rec } of { ok:false, reden }
  V.wijzig = (rec, fase, opt) => {
    opt = opt || {};
    if (!rec || !V.FASEN.includes(fase)) return { ok: false, reden: 'Onbekende status.' };
    const notitie = String(opt.notitie == null ? '' : opt.notitie).trim();
    if (fase === 'afgewezen' && !notitie) return { ok: false, reden: 'Bij afwijzen hoort een reden.' };
    const nu = opt.nu instanceof Date ? opt.nu : new Date();
    const hist = Array.isArray(rec.historie) ? rec.historie.slice() : [];
    hist.push({ tijd: nu.toISOString(), fase, notitie, door: opt.door || '' });
    return { ok: true, rec: Object.assign({}, rec, { fase, status: V.LEGACY[fase], historie: hist, _gewijzigd: nu.getTime() }) };
  };

  // Samenvoeger per id (lijsten of {items}); de nieuwste `_gewijzigd` wint. Gelijk en gestempeld → lokaal;
  // beide ongestempeld → SharePoint (een oude kopie duwt niets over nieuwere wijzigingen). Records zonder id blijven staan.
  V.samen = (lokaal, remote) => {
    const L = lijstUit(lokaal), R = lijstUit(remote);
    const per = new Map(), los = new Map();
    for (const x of [...R, ...L]) {
      const k = (x && typeof x === 'object') ? x.id : null;
      if (k === null || k === undefined || k === '') { if (x != null) los.set(JSON.stringify(x), x); continue; }
      const o = per.get(String(k));
      const tl = tijd(x), tr = o ? tijd(o) : -1;
      if (!o || tl > tr || (tl === tr && tl > 0)) per.set(String(k), x);
    }
    return [...per.values(), ...los.values()].sort((a, b) => aangemaakt(b).localeCompare(aangemaakt(a)));
  };

  // Eén vorm voor de wachtrij, uit een verbeterpunt (bron 'verbeterpunt') of een feedbackitem van de telefoon (bron 'feedback').
  V.item = (r, bron) => {
    const fb = bron === 'feedback';
    const tekst = fb ? String(r.tekst || '') : String(r.omschrijving || '');
    return {
      id: String(r.id), bron: fb ? 'feedback' : 'verbeterpunt', bestand: fb ? 'mt_feedback.json' : 'mt_verbeterpunten.json',
      titel: fb ? (tekst.split('\n')[0].slice(0, 80) || '(leeg)') : String(r.titel || ''),
      betreft: fb ? ('Telefoon' + (r.type ? ' · ' + r.type : '')) : String(r.betreft || ''),
      omschrijving: tekst,
      indiener: String((fb ? r.user : r.indiener) || ''), indiener_naam: String((fb ? '' : r.indiener_naam) || ''),
      aangemaakt: aangemaakt(r), fase: V.fase(r), historie: Array.isArray(r.historie) ? r.historie : []
    };
  };

  // De wachtrij: alle items uit beide bestanden, in groepen per fase (binnen een groep de oudste eerst bij te beoordelen,
  // anders de nieuwste eerst).
  V.wachtrij = (verbeterpunten, feedback) => {
    const alle = [...lijstUit(verbeterpunten).filter(r => r && r.id).map(r => V.item(r, 'verbeterpunt')),
                  ...lijstUit(feedback).filter(r => r && r.id).map(r => V.item(r, 'feedback'))];
    const uit = {};
    for (const f of V.FASEN) {
      uit[f] = alle.filter(x => x.fase === f).sort((a, b) => f === 'te-beoordelen' ? a.aangemaakt.localeCompare(b.aangemaakt) : b.aangemaakt.localeCompare(a.aangemaakt));
    }
    return uit;
  };

  root.MTVerbeter = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

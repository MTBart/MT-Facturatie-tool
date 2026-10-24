// mt-projopruim.js — projecten opruimen in bulk (PL2): Afronden (projecten) en Verloren (leads), met voorbeeld, waarschuwingen,
// eindstand vooraf, resultaat per project en Ongedaan maken; plus het voorstel "mogelijk af". Er wordt NOOIT iets gewist.
//
// De bulkschrijver werkt per project, één voor één:
//   1. (alleen Afronden) de eindstand vastleggen in een bestand waaraan alleen wordt toegevoegd; lukt dat niet, dan blijft het project ongemoeid;
//   2. mt_projecten.json vers lezen (met ETag); is het geen lijst of ontbreekt de ETag: niets schrijven;
//   3. het project zoeken en controleren dat zijn fase nog is wat het voorbeeld liet zien (anders: conflict);
//   4. één regel in het journaal (alleen toevoegen): oude waarde, nieuwe waarde en het fasestempel van deze actie;
//   5. alleen dát project aanpassen (zelfde veldstempels als projFaseZet) en schrijven met If-Match; 412 → opnieuw lezen (max 3x);
//   6. opnieuw vers lezen ter controle; pas dan telt het als gelukt.
// Ongedaan maken zet een project alleen terug als zijn fasestempel nog precies dat van deze actie is.
// Alles komt van buiten via init(deps); de rekenregels (plan, waarschuwingen, voorstel) zijn puur en los te testen.
(function (root) {
  'use strict';
  const O = root.MTProjOpruim = root.MTProjOpruim || {};
  const DAG = 864e5;
  const LEAD_OPEN = ['nieuw', 'opname', 'offerte_maken', 'verstuurd', 'geparkeerd'];
  const PROJ_EIND = ['factureren', 'nacalculatie'];
  const ACTIES = { afronden: { naar: 'afgerond', kop: 'Afronden', ing: 'afgerond' }, verloren: { naar: 'verloren', kop: 'Verloren', ing: 'op Verloren gezet' } };
  O.ACTIES = ACTIES;
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lead = () => root.MTLead;
  const uurTekst = min => { const m = Math.round(Number(min) || 0); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' u'; };
  const iso = ms => new Date(ms).toISOString();
  const bericht = e => (e && e.message) || String(e);

  // ── Puur: waarschuwingen, plan, voorstel ────────────────────────────────────────────────────────────────────────────
  // item: { code, project_id, naam, fase, faseStempel (ms), gewijzigd (ms), openTaken, openTakenToekomst, uren90 (min), planblokToekomst, planblok90, openBestel, geparkeerdTot }
  O.waarschuwingen = function (it) {
    const w = [];
    if (it.openTaken > 0) w.push({ soort: 'taken', tekst: it.openTaken + (it.openTaken === 1 ? ' open taak' : ' open taken') });
    if (it.uren90 > 0) w.push({ soort: 'uren', tekst: uurTekst(it.uren90) + ' geklokt in de laatste 90 dagen' });
    if (it.planblokToekomst > 0) w.push({ soort: 'planblok', tekst: it.planblokToekomst + (it.planblokToekomst === 1 ? ' planblok' : ' planblokken') + ' in de toekomst' });
    if (it.openBestel > 0) w.push({ soort: 'bestel', tekst: it.openBestel + (it.openBestel === 1 ? ' bestelregel' : ' bestelregels') + ' nog niet geleverd' });
    return w;
  };
  // Wat er per geselecteerd project zou gebeuren. Een project dat de overgang niet mag (bv. een lead afronden) wordt overgeslagen, met reden.
  O.plan = function (items, actie, opt) {
    const a = ACTIES[actie], L = (opt && opt.MTLead) || lead(); if (!a || !L) return [];
    return (items || []).map(it => {
      const extra = actie === 'verloren' ? { verlies: { reden: 'geen_reactie', toelichting: 'Opgeruimd in bulk (geen reactie)' } } : {};
      const e = { code: it.code, project_id: it.project_id || '', naam: it.naam || it.code, van: it.fase || '', naar: a.naar, actie, extra, ok: true, reden: '', waarschuwingen: O.waarschuwingen(it) };
      if (!it.fase && actie === 'verloren') { e.ok = false; e.reden = 'geen lead (geen fase): kan niet op Verloren'; return e; }
      if (it.fase === a.naar) { e.ok = false; e.reden = 'staat al op ' + (L.label(a.naar) || a.naar); return e; }
      if (it.fase) { const f = L.controleer(it.fase, a.naar, extra); if (f) { e.ok = false; e.reden = f; } }
      return e;
    });
  };
  // Het voorstel "mogelijk af" (alleen voorstellen, nooit zelf doen). ctx: { nu, vandaag (ymd), urenSync (ms | null) }.
  O.voorstel = function (items, ctx) {
    const nu = ctx.nu, uit = { syncEerst: false, lijst: [] };
    if (!ctx.urenSync || nu - ctx.urenSync > 7 * DAG) { uit.syncEerst = true; return uit; }   // te oude uren: niets voorstellen (sync eerst)
    for (const it of items || []) {
      if (!it || !it.code) continue;
      const fase = it.fase || '';
      if (it.uren90 > 0 || it.openTakenToekomst > 0 || it.planblokToekomst > 0 || it.openBestel > 0) continue;   // nooit voorstellen
      const offerteMs = Math.max(fase === 'verstuurd' ? (it.faseStempel || 0) : 0, it.offerteMs || 0);
      if (offerteMs && nu - offerteMs < 30 * DAG) continue;                                                    // offerte recent verstuurd of aangepast
      if (fase === 'geparkeerd' && it.geparkeerdTot && it.geparkeerdTot >= ctx.vandaag) continue;             // wacht tot een afgesproken datum
      const stil = it.openTaken === 0 && it.planblok90 === 0 && (!it.gewijzigd || nu - it.gewijzigd > 90 * DAG);
      if (LEAD_OPEN.includes(fase) && stil) uit.lijst.push({ code: it.code, naam: it.naam, fase, actie: 'verloren', reden: 'Lead zonder activiteit in 90 dagen (reden: Geen reactie)' });
      else if ((!fase || PROJ_EIND.includes(fase)) && it.openTaken === 0 && it.planblok90 === 0) uit.lijst.push({ code: it.code, naam: it.naam, fase, actie: 'afronden', reden: (fase ? 'In ' + ((lead() && lead().label(fase)) || fase) : 'Zonder fase') + ', geen uren, taken of planblokken in 90 dagen' });
    }
    return uit;
  };

  // ── De bulkschrijver ────────────────────────────────────────────────────────────────────────────────────────────────
  const sleutelVan = (r) => (r && r.project_id) ? 'pid:' + r.project_id : (r && r.code ? 'code:' + r.code : '');
  function zoek(lijst, e) {
    const k = e.project_id ? 'pid:' + e.project_id : 'code:' + e.code;
    const m = lijst.filter(x => x && typeof x === 'object' && !x._vervallen && sleutelVan(x) === k);
    return m.length === 1 ? m[0] : (m.length > 1 ? 'dubbel' : null);
  }
  function lijstFout(r) {
    if (!r || r.status === 404) return 'mt_projecten.json bestaat niet op SharePoint';
    if (r.status !== 200 || !Array.isArray(r.data)) return 'mt_projecten.json heeft een onverwachte vorm: er is niets geschreven';
    if (!r.etag) return 'SharePoint gaf geen versienummer (ETag) mee: er is niets blind overschreven';
    return '';
  }
  const stempelVeld = (r, v) => Number(r && r._vs && r._vs[v] && r._vs[v].t) || 0;
  const stempelFase = r => stempelVeld(r, 'fase');
  const kloon = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  // Het stempel van een veld bevat naast de tijd ook een actie-id (ctie): twee tabs met hetzelfde milliseconde-stempel zijn zo toch te onderscheiden.
  // Bewijs van 'dit is onze schrijfactie': voor elk gewijzigd veld dezelfde waarde, hetzelfde stempel én hetzelfde actie-id.
  const actieVan = (r, v) => String((r && r._vs && r._vs[v] && r._vs[v].actie) || '');
  const gelijkeVelden = (a, b, velden) => (velden || ['fase']).every(v => JSON.stringify(a[v] === undefined ? null : a[v]) === JSON.stringify(b[v] === undefined ? null : b[v]) && stempelVeld(a, v) === stempelVeld(b, v) && actieVan(a, v) === actieVan(b, v));
  // Eén veilige schrijfpoging-lus voor zowel actie als terugzetten. bouw(rec) → { rec: nieuw record, velden } of { stop: resultaat }.
  // Uitkomsten: ok · conflict · overgeslagen · fout · onzeker. `bewezenNiet` = er is bewezen dat de wijziging niet op SharePoint staat.
  // Een verloren antwoord of time-out na het versturen telt als ONZEKER: dan wordt altijd opnieuw gelezen, en pas het eigen fasestempel bewijst "gelukt".
  async function commit(deps, e, bouw) {
    for (let poging = 1; poging <= 3; poging++) {
      if (deps.toegestaan && !deps.toegestaan()) return { status: 'overgeslagen', reden: 'rechten of synchronisatie zijn veranderd: niets meer geschreven', bewezenNiet: true };
      const r = await deps.lees(), f = lijstFout(r); if (f) return { status: 'fout', reden: f, bewezenNiet: true };
      const rec = zoek(r.data, e);
      if (rec === 'dubbel') return { status: 'overgeslagen', reden: 'staat dubbel in mt_projecten (niet gokken)', bewezenNiet: true };
      if (!rec) return { status: 'overgeslagen', reden: 'staat niet (meer) als actief project op SharePoint', bewezenNiet: true };
      const b = await bouw(rec, poging); if (b.stop) return Object.assign({ bewezenNiet: true }, b.stop);
      const nieuw = r.data.map(x => (x === rec ? b.rec : x));                       // alleen dit ene record verschilt
      if (deps.toegestaan && !deps.toegestaan()) return { status: 'overgeslagen', reden: 'rechten of synchronisatie zijn veranderd: niets meer geschreven', bewezenNiet: true };   // nog eens vlak vóór de PUT
      let w = null, uitzondering = null;
      try { w = await deps.schrijf(JSON.stringify(nieuw), r.etag); } catch (err) { uitzondering = err; }
      if (!uitzondering && w && w.status === 412) continue;                        // iemand schreef tussendoor: opnieuw lezen
      const verwacht = stempelFase(b.rec), faseNa = b.rec.fase || '', aangekomen = !uitzondering && !!(w && w.ok);
      let v = null, vf = '';
      try { v = await deps.lees(); vf = lijstFout(v); } catch (err) { vf = bericht(err); }
      if (vf) return aangekomen ? { status: 'onzeker', reden: 'opgeslagen, maar de controle kon niet worden uitgevoerd (' + vf + ')' }
        : { status: 'onzeker', reden: 'de uitkomst van het opslaan is onzeker (' + (uitzondering ? bericht(uitzondering) : 'HTTP ' + (w && w.status)) + ') en de controle lukte niet: kijk of het project is aangepast' };
      const rec2 = zoek(v.data, e);
      const staat = !!rec2 && rec2 !== 'dubbel' && (rec2.fase || '') === faseNa && stempelFase(rec2) === verwacht && gelijkeVelden(rec2, b.rec, b.velden);
      if (staat) return { status: 'ok', rec: b.rec, velden: b.velden, stempel: verwacht, verlorenAntwoord: !aangekomen };
      if (aangekomen) return { status: 'conflict', reden: 'na het opslaan bleek de fase of het stempel anders: een collega was tegelijk bezig' };
      return { status: 'fout', reden: uitzondering ? 'het opslaan mislukte (' + bericht(uitzondering) + ') en het project is niet aangepast' : 'SharePoint weigerde het opslaan (HTTP ' + (w && w.status) + ')', bewezenNiet: true };
    }
    return { status: 'conflict', reden: 'SharePoint werd steeds tegelijk gewijzigd (3 pogingen)', bewezenNiet: true };
  }
  const velden0 = t => (t && t.velden && t.velden.length ? t.velden : ['fase']);
  async function een(deps, e, batch) {
    const L = lead(); let esId = null, jid = null;
    const r = await commit(deps, e, async (rec) => {
      if ((rec.fase || '') !== e.van) return { stop: { status: 'conflict', reden: 'de fase is intussen veranderd (nu "' + ((L && L.label(rec.fase)) || rec.fase || 'geen fase') + '")' } };
      const fout = L.controleer(rec.fase, e.naar, e.extra); if (fout) return { stop: { status: 'overgeslagen', reden: fout } };
      // De eindstand pas na het vers lezen en controleren van dit project, en één keer: zonder eindstand mag het project niet uit beeld,
      // en een conflict laat geen eindstand van een project achter dat niet is afgerond.
      if (e.naar === 'afgerond' && !esId) {
        let snap;
        try { snap = await deps.eindstand(e); } catch (err) { return { stop: { status: 'overgeslagen', reden: 'de eindstand kon niet worden bepaald (' + bericht(err) + '): niets aangepast' } }; }
        const id = 'es:' + e.project_id + ':' + batch;
        const ok = await deps.eindstandSchrijf(Object.assign({}, snap, { id, tijd: iso(deps.nu()), door: deps.wie(), project_id: e.project_id, code: e.code, naam: e.naam, fase_voor: e.van, batch }));
        if (!ok) return { stop: { status: 'overgeslagen', reden: 'de eindstand kon niet worden vastgelegd: niets aangepast' } };
        esId = id;
      }
      const t = deps.pasToe(rec, Object.assign({}, e, { batch })), velden = velden0(t), voor = {}, voorStempel = {}, stempels = {};
      velden.forEach(v => { voor[v] = rec[v] === undefined ? null : kloon(rec[v]); voorStempel[v] = rec._vs && rec._vs[v] ? kloon(rec._vs[v]) : null; stempels[v] = stempelVeld(t.rec, v); });
      jid = 'oj:' + e.project_id + ':' + batch + ':' + stempelFase(t.rec);
      const jok = await deps.journaalSchrijf({ id: jid, type: 'actie', batch, tijd: iso(deps.nu()), door: deps.wie(), actie: e.actie, code: e.code, project_id: e.project_id, naam: e.naam,
        van: e.van, naar: e.naar, status_voor: rec.status === undefined ? null : rec.status, velden, voor, voor_stempel: voorStempel, stempels, stempel: stempelFase(t.rec), es: esId });
      if (!jok) return { stop: { status: 'overgeslagen', reden: 'het journaal kon niet worden bijgewerkt: niets aangepast' } };
      return { rec: t.rec, velden };
    });
    if (r.status === 'ok') { try { deps.naLokaal(r.rec, r.velden); } catch (err) { /* de lokale kopie volgt bij de volgende sync */ } return { status: 'gelukt', stempel: r.stempel, reden: r.verlorenAntwoord ? 'opgeslagen (het antwoord ging verloren; bevestigd door opnieuw lezen)' : '' }; }
    if (jid && r.bewezenNiet) { try { await deps.journaalSchrijf({ id: jid + ':x', type: 'mislukt', ref: jid, batch, tijd: iso(deps.nu()), reden: r.reden }); } catch (err) { } }
    return r;
  }
  // plan: uit O.plan. opt: { batch, opVoortgang(i, n, resultaat), stop() }. Geeft { batch, resultaten: [{ code, naam, status, reden }] }.
  O.voerUit = async function (deps, plan, opt) {
    opt = opt || {};
    const batch = opt.batch || ('b' + deps.nu().toString(36) + Math.random().toString(36).slice(2, 6)), resultaten = [];
    for (let i = 0; i < plan.length; i++) {
      const e = plan[i]; let r;
      if (!e.ok) r = { status: 'overgeslagen', reden: e.reden };
      else if (opt.stop && opt.stop()) r = { status: 'overgeslagen', reden: 'afgebroken door de gebruiker' };
      else { try { r = await een(deps, e, batch); } catch (err) { r = { status: 'fout', reden: bericht(err) }; } }
      const res = { code: e.code, project_id: e.project_id, naam: e.naam, van: e.van, naar: e.naar, status: r.status, reden: r.reden || '', stempel: r.stempel || 0 };
      resultaten.push(res);
      if (opt.opVoortgang) { try { opt.opVoortgang(i + 1, plan.length, res); } catch (err) { } }
    }
    return { batch, resultaten };
  };
  // Ongedaan maken: alleen als ELK door de actie gewijzigd veld nog precies het stempel van de actie heeft; anders wordt het project overgeslagen
  // (een collega heeft er intussen iets aan veranderd). Alle door de overgang gewijzigde velden gaan terug naar hun vorige waarde.
  const stempelsKloppen = (rec, x) => velden0(x).every(v => stempelVeld(rec, v) === Number((x.stempels && x.stempels[v] != null) ? x.stempels[v] : (v === 'fase' ? x.stempel : -1)) && actieVan(rec, v) === String(x.batch || ''));
  async function terugzetEen(deps, e, regels, klaar) {
    let gekozen = null;
    const r = await commit(deps, e, async (rec) => {
      gekozen = regels.find(x => stempelsKloppen(rec, x));
      if (!gekozen) return { stop: { status: 'overgeslagen', reden: 'een collega heeft dit project intussen gewijzigd (fase of een ander veld van deze actie): niet teruggezet' } };
      return deps.terugzet(rec, gekozen);
    });
    if (r.status !== 'ok') return r;
    let jok = false;
    try { jok = await deps.journaalSchrijf({ id: 'oj-terug:' + gekozen.id, type: 'terug', ref: gekozen.id, batch: gekozen.batch, tijd: iso(deps.nu()), door: deps.wie(), code: gekozen.code, project_id: gekozen.project_id }); } catch (err) { }
    try { deps.naLokaal(r.rec, r.velden); } catch (err) { }
    return { status: 'ok', reden: jok ? '' : 'teruggezet, maar het journaal kon niet worden bijgewerkt (het terugzetten is wel gelukt)' };
  }
  // Opmerking over de journaalregels: bij een nieuwe poging (412) staat er een tweede voornemen-regel met een ander stempel; alleen de regel waarvan
  // het stempel overeenkomt met wat er nu op SharePoint staat kan ooit leiden tot terugzetten. Een project telt als teruggezet zodra één van zijn regels een "terug" heeft.
  O.maakOngedaan = async function (deps, batch, opt) {
    opt = opt || {};
    let lijn; try { lijn = await deps.journaalLees(); } catch (err) { return [{ code: '', naam: '', status: 'fout', reden: 'het journaal kon niet worden gelezen: ' + bericht(err) }]; }
    if (!Array.isArray(lijn)) return [{ code: '', naam: '', status: 'fout', reden: 'het journaal heeft een onverwachte vorm: er is niets teruggezet' }];
    const mislukt = new Set(lijn.filter(x => x && x.type === 'mislukt').map(x => x.ref)), klaar = new Set(lijn.filter(x => x && x.type === 'terug').map(x => x.ref));
    const per = new Map();
    lijn.filter(x => x && x.type === 'actie' && x.batch === batch && !mislukt.has(x.id)).forEach(x => { if (!per.has(x.project_id)) per.set(x.project_id, []); per.get(x.project_id).push(x); });
    const uit = [], ids = [...per.keys()].filter(id => !opt.alleen || opt.alleen.includes(id));
    for (let i = 0; i < ids.length; i++) {
      const regels = per.get(ids[i]), e = { project_id: ids[i], code: regels[0].code, naam: regels[0].naam }; let r;
      try { r = regels.some(x => klaar.has(x.id)) ? { status: 'overgeslagen', reden: 'was al teruggezet' } : await terugzetEen(deps, e, regels, klaar); }
      catch (err) { r = { status: 'fout', reden: bericht(err) }; }
      uit.push({ code: e.code, project_id: e.project_id, naam: e.naam, status: r.status === 'ok' ? 'teruggezet' : r.status, reden: r.reden || '' });
      if (opt.opVoortgang) { try { opt.opVoortgang(i + 1, ids.length, uit[uit.length - 1]); } catch (err) { } }
    }
    return uit;
  };  O.telling = res => res.reduce((t, r) => { t[r.status] = (t[r.status] || 0) + 1; return t; }, {});

  // ── Scherm ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const D = { doc: null, items: null, mag: () => false };
  const S = { el: null, stap: '', actie: '', plan: [], res: null, batch: '', terug: null, voortgang: null, stop: false, bezig: false, voorstel: null, vink: new Set() };
  function css() {
    const doc = D.doc; if (!doc || doc.getElementById('mt-po-css')) return;
    const s = doc.createElement('style'); s.id = 'mt-po-css';
    s.textContent = `
.po-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9100;display:flex;align-items:flex-end;justify-content:center}
.po-modal>div{background:var(--card,#fff);width:100%;max-width:640px;max-height:90vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px 18px 20px;font-size:14px}
@media(min-width:700px){.po-modal{align-items:center}.po-modal>div{border-radius:14px}}
.po-modal h3{margin:0 0 6px;font-size:17px}
.po-uitleg{font-size:12px;color:var(--text-faint,#8a8a80);margin:6px 0}
.po-lijst{border:1px solid var(--border,#e4e2da);border-radius:8px;max-height:46vh;overflow:auto;margin:8px 0}
.po-rij{padding:7px 10px;border-bottom:1px solid var(--border,#eee)}
.po-rij:last-child{border-bottom:0}
.po-rij .k{display:flex;gap:8px;align-items:baseline}
.po-rij .n{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.po-rij .f{font-size:12px;color:var(--text-faint,#8a8a80);white-space:nowrap}
.po-w{font-size:12px;color:#8a5a00;margin:2px 0 0 0}
.po-chip{font-size:11px;border-radius:10px;padding:1px 8px;background:var(--bg,#f1f0ea);color:var(--text-dim,#555);white-space:nowrap}
.po-chip.ok{background:#e1f0e6;color:#1f6a3c}.po-chip.let{background:#fbeccc;color:#8a5a00}.po-chip.fout{background:#fbe3dd;color:#a53a28}
.po-knoppen{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}
.po-knop{border:1px solid var(--border,#ddd);background:var(--card,#fff);border-radius:16px;padding:6px 14px;font-size:14px;cursor:pointer;min-height:36px;color:inherit}
.po-knop.groen{background:var(--green,#2A4A38);border-color:var(--green,#2A4A38);color:#fff}
.po-knop[disabled]{opacity:.45;cursor:default}
.po-vink{display:flex;gap:8px;align-items:flex-start;margin:8px 0;font-size:13px}
.po-vink input{width:auto;margin-top:2px;flex:none}
.po-balk{height:6px;background:var(--bg,#efeee8);border-radius:3px;overflow:hidden;margin:8px 0}
.po-balk>div{height:100%;background:var(--green-mid,#4A7A5C)}
.po-modal label{text-transform:none;letter-spacing:0;font-size:inherit;font-weight:inherit;color:inherit}
.po-modal input[type=checkbox]{accent-color:var(--green,#2A4A38)}
@media(max-width:820px){.po-modal>div{padding-bottom:64px}.po-knop{min-height:44px;font-size:16px}.po-vink input{width:22px;height:22px}}`;
    doc.head.appendChild(s);
  }
  const faseL = k => (lead() && lead().label(k)) || k || 'geen fase';
  const chipKlasse = s => (s === 'gelukt' || s === 'teruggezet') ? 'ok' : (s === 'conflict' || s === 'fout') ? 'fout' : 'let';
  function html() {
    const a = ACTIES[S.actie] || {};
    if (S.stap === 'voorbeeld') {
      const ok = S.plan.filter(e => e.ok), over = S.plan.length - ok.length, metW = ok.filter(e => e.waarschuwingen.length).length;
      return `<h3>${esc(a.kop)}: ${esc(S.plan.length)} project${S.plan.length === 1 ? '' : 'en'}</h3>
        <div>${esc(ok.length)} gaan naar ${esc(faseL(a.naar))}${over ? `, ${esc(over)} worden overgeslagen` : ''}.</div>
        <div class="po-lijst">${S.plan.map(e => `<div class="po-rij"><div class="k"><span class="n" title="${esc(e.naam)}">${esc(e.naam)}</span><span class="f">${esc(faseL(e.van))}</span>${e.ok ? '<span class="po-chip ok">gaat mee</span>' : '<span class="po-chip let">overgeslagen</span>'}</div>${e.ok ? e.waarschuwingen.map(w => `<div class="po-w">⚠ ${esc(w.tekst)}</div>`).join('') : `<div class="po-w">${esc(e.reden)}</div>`}</div>`).join('')}</div>
        ${metW ? `<label class="po-vink"><input type="checkbox" data-po-gezien="1"${S.gezien ? ' checked' : ''}><span>${esc(metW)} project${metW === 1 ? ' heeft' : 'en hebben'} een waarschuwing. Ik heb ze gezien en wil toch doorgaan.</span></label>` : ''}
        <div class="po-uitleg">Er wordt niets gewist. ${a.naar === 'afgerond' ? 'Eerst wordt per project de eindstand vastgelegd (budget, gepland, geklokt). ' : ''}Toggl wordt niet aangeraakt. Je kunt de hele actie hierna ongedaan maken.</div>
        <div class="po-knoppen"><button type="button" class="po-knop" data-po="sluit">Annuleren</button><button type="button" class="po-knop groen" data-po="start"${ok.length && (!metW || S.gezien) ? '' : ' disabled'}>${esc(a.kop)} bevestigen</button></div>`;
    }
    if (S.stap === 'bezig') {
      const v = S.voortgang || { i: 0, n: S.plan.length, laatste: null };
      return `<h3>${esc(a.kop)}…</h3><div>${esc(v.i)} van ${esc(v.n)} verwerkt${v.laatste ? ': ' + esc(v.laatste.naam) : ''}</div>
        <div class="po-balk"><div style="width:${esc(v.n ? Math.round(100 * v.i / v.n) : 0)}%"></div></div>
        <div class="po-uitleg">Eén project tegelijk, met vers lezen en controle. Sluit dit venster niet.</div>
        <div class="po-knoppen"><button type="button" class="po-knop" data-po="stop"${S.stop ? ' disabled' : ''}>${S.stop ? 'Stopt na dit project…' : 'Stop na dit project'}</button></div>`;
    }
    if (S.stap === 'klaar') {
      const res = S.terug || S.res, t = O.telling(res);
      return `<h3>${S.terug ? 'Ongedaan gemaakt' : esc(a.kop) + ': klaar'}</h3>
        <div>${['gelukt', 'teruggezet', 'onzeker', 'conflict', 'overgeslagen', 'fout'].filter(k => t[k]).map(k => `<span class="po-chip ${esc(chipKlasse(k))}">${esc(t[k])} ${esc(k)}</span>`).join(' ')}</div>
        <div class="po-lijst">${res.map(r => `<div class="po-rij"><div class="k"><span class="n" title="${esc(r.naam)}">${esc(r.naam)}</span><span class="po-chip ${esc(chipKlasse(r.status))}">${esc(r.status)}</span></div>${r.reden ? `<div class="po-w">${esc(r.reden)}</div>` : ''}</div>`).join('')}</div>
        <div class="po-uitleg">${S.terug ? 'Een project wordt alleen teruggezet als het nog precies zo staat als deze actie het zette.' : 'Niets is gewist. De eindstand en het journaal staan op SharePoint.'}</div>
        <div class="po-knoppen">${!S.terug && ((O.telling(S.res).gelukt || 0) + (O.telling(S.res).onzeker || 0)) ? '<button type="button" class="po-knop" data-po="terug">Alles ongedaan maken</button>' : ''}<button type="button" class="po-knop groen" data-po="sluit">Sluiten</button></div>`;
    }
    if (S.stap === 'terugbezig') return `<h3>Ongedaan maken…</h3><div class="po-uitleg">Eén project tegelijk, met vers lezen en controle.</div>`;
    if (S.stap === 'voorstel') {
      const v = S.voorstel;
      if (v.syncEerst) return `<h3>Voorstel: mogelijk af</h3><div class="po-w">Sync eerst: de uren zijn nog nooit of langer dan 7 dagen geleden gesynct, dus ik doe geen voorstel. Gebruik "Sync nu" in de Agenda en probeer het opnieuw.</div><div class="po-knoppen"><button type="button" class="po-knop groen" data-po="sluit">Sluiten</button></div>`;
      return `<h3>Voorstel: mogelijk af (${esc(v.lijst.length)})</h3>
        <div class="po-uitleg">Alleen een voorstel: er verandert niets tot jij het kiest. Projecten met uren, open taken met een datum, planblokken in de toekomst, open bestelregels of een recent verstuurde offerte staan hier nooit. De uren zijn gebaseerd op wat lokaal gesynct is (een sync dekt de laatste 365 dagen).</div>
        ${v.lijst.length ? `<div class="po-lijst">${v.lijst.map(x => `<label class="po-rij" style="display:block"><div class="k"><input type="checkbox" data-po-vink="${esc(x.code)}"${S.vink.has(x.code) ? ' checked' : ''} style="width:auto"><span class="n" title="${esc(x.naam)}">${esc(x.naam)}</span><span class="f">${esc(faseL(x.fase))}</span><span class="po-chip">${esc(ACTIES[x.actie].kop)}</span></div><div class="po-w" style="color:var(--text-faint,#8a8a80)">${esc(x.reden)}</div></label>`).join('')}</div>` : '<div class="po-uitleg">Niets te voorstellen.</div>'}
        <div class="po-knoppen"><button type="button" class="po-knop" data-po="sluit">Sluiten</button>${v.lijst.length ? '<button type="button" class="po-knop" data-po="vink-alles">Alles aanvinken</button><button type="button" class="po-knop groen" data-po="kies">Selecteren in de lijst</button>' : ''}</div>`;
    }
    return '';
  }
  function teken() { if (S.el) S.el.firstElementChild.innerHTML = html(); }
  function open(stap) {
    css(); S.stap = stap;
    if (!S.el) {
      const el = D.doc.createElement('div'); el.className = 'po-modal'; el.innerHTML = '<div role="dialog" aria-modal="true"></div>';
      el.addEventListener('click', klik); el.addEventListener('change', wissel); D.doc.body.appendChild(el); S.el = el;
    }
    teken();
  }
  function sluit() { if (S.el) { S.el.remove(); S.el = null; } S.stap = ''; }
  async function start() {
    S.stap = 'bezig'; S.stop = false; S.bezig = true; S.voortgang = { i: 0, n: S.plan.length, laatste: null }; teken();
    const r = await O.voerUit(D.deps, S.plan, { opVoortgang: (i, n, res) => { S.voortgang = { i, n, laatste: res }; if (S.stap === 'bezig') teken(); }, stop: () => S.stop });
    S.res = r.resultaten; S.batch = r.batch; S.terug = null; S.bezig = false; open('klaar');
    if (D.opKlaar) { try { D.opKlaar(S.res); } catch (e) { } }
  }
  async function terug() {
    open('terugbezig'); S.bezig = true;
    const ids = S.res.filter(r => r.status === 'gelukt' || r.status === 'onzeker').map(r => r.project_id);
    S.terug = await O.maakOngedaan(D.deps, S.batch, { alleen: ids }); S.bezig = false; open('klaar');
    if (D.opKlaar) { try { D.opKlaar(S.terug); } catch (e) { } }
  }
  function klik(e) {
    const t = e.target.closest ? e.target.closest('[data-po]') : null;
    if (e.target === S.el && !S.bezig) return sluit();
    if (!t) return;
    const k = t.dataset.po;
    if (k === 'sluit' && !S.bezig) return sluit();
    if (k === 'start' && !t.disabled && !S.bezig) return start();
    if (k === 'stop') { S.stop = true; return teken(); }
    if (k === 'terug' && !S.bezig) return terug();
    if (k === 'vink-alles') { S.voorstel.lijst.forEach(x => S.vink.add(x.code)); return teken(); }
    if (k === 'kies') { const codes = [...S.vink]; sluit(); if (D.opSelecteer) D.opSelecteer(codes); }
  }
  function wissel(e) {
    const g = e.target.closest ? e.target.closest('[data-po-gezien]') : null;
    if (g) { S.gezien = g.checked; return teken(); }
    const v = e.target.closest ? e.target.closest('[data-po-vink]') : null;
    if (v) { if (v.checked) S.vink.add(v.dataset.poVink); else S.vink.delete(v.dataset.poVink); }
  }
  // Voorbeeld voor een actie op de geselecteerde projecten (codes).
  O.openActie = function (actie, codes) {
    if (!ACTIES[actie] || S.bezig) return false;
    if (!D.mag()) return false;
    const items = D.items(codes); if (!items.length) return false;
    S.actie = actie; S.gezien = false; S.res = null; S.terug = null; S.plan = O.plan(items, actie);
    open('voorbeeld'); return true;
  };
  O.openVoorstel = function () {
    if (S.bezig || !D.mag()) return false;
    S.voorstel = O.voorstel(D.items(null, true), { nu: D.deps.nu(), vandaag: new Date(D.deps.nu()).toISOString().slice(0, 10), urenSync: D.urenSync ? D.urenSync() : null });
    S.vink = new Set(); open('voorstel'); return true;
  };
  O.bezig = () => S.bezig;
  // deps: { lees, schrijf, pasToe, terugzet, naLokaal, eindstand, eindstandSchrijf, journaalSchrijf, journaalLees, nu, wie }
  // scherm: { doc, mag(), items(codes | null, alles), urenSync(), opKlaar(res), opSelecteer(codes) }
  O.init = function (scherm, deps) { Object.assign(D, scherm || {}); D.deps = deps; return O; };
})(typeof window !== 'undefined' ? window : globalThis);

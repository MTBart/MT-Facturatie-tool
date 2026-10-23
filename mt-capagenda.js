/* ============================================================================
 * mt-capagenda.js: de Outlook-afspraken van het team als "bezet" in Planning ▸ Capaciteit (brok D1)
 * ----------------------------------------------------------------------------
 * ALLEEN LEZEN. Er wordt niets in Outlook gemaakt, gewijzigd of verwijderd en er wordt niets bewaard (de afspraken staan alleen in het geheugen van de pagina).
 * - Je eigen agenda: GET /me/calendarView, met onderwerp en plaats.
 * - Collega's: POST /me/calendar/getSchedule (bezet/vrij van maximaal 20 mensen per aanroep; dat is een leesopdracht ondanks de POST). Het onderwerp staat er alleen als de collega dat deelt.
 *   De bestaande machtiging Calendars.ReadWrite volstaat daarvoor (Microsoft Learn: getSchedule, "Calendars.ReadBasic, Calendars.Read, Calendars.ReadWrite"); er wordt niets aan machtigingen of Azure gewijzigd.
 * - Is een agenda niet op te vragen, dan zegt de stand dat eerlijk ("agenda van X niet zichtbaar") en wat er aan te zetten is; nooit stil leeg.
 * - Een venster van 2 tot 6 weken rond wat in beeld is; in het geheugen onthouden (5 minuten), hoogstens twee aanroepen tegelijk, 429 en Retry-After worden gerespecteerd, bladeren wordt gedempt.
 * - Tijden: Europe/Amsterdam (Windows-naam "W. Europe Standard Time" in de aanvraag en in de Prefer-kop). Losse en herhalende afspraken zoals calendarView ze teruggeeft (elke keer een eigen afspraak).
 * Alles komt van buiten via init(deps): { fetch(url, opties) -> json (gooit een fout met .status), nu(), team(), ik() }. Het rekenwerk (venster, omzetten, banen) is zonder netwerk te testen.
 * ========================================================================== */
(function (root) {
  'use strict';
  const A = {};
  let D = null;
  const TZ = 'W. Europe Standard Time', TZ_ISO = 'Europe/Amsterdam';
  const MIN_DAGEN = 14, MAX_DAGEN = 42, TTL = 5 * 60 * 1000, MAX_PAGINAS = 5, GROEP = 20, TEGELIJK = 2, DEMP = 450;
  A.TZ = TZ; A.MIN_DAGEN = MIN_DAGEN; A.MAX_DAGEN = MAX_DAGEN; A.TTL = TTL; A.GROEP = GROEP;

  // ── datums ──
  const nr = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const ymd = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
  const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(nr(s)) === s;
  const wd = n => ((n + 4) % 7 + 7) % 7;   // 0 = zondag
  const maandag = s => { const n = nr(s); return ymd(n - ((wd(n) + 6) % 7)); };
  A.nr = nr; A.ymd = ymd;

  // Het venster dat gelezen wordt voor wat in beeld is (van t/m tot, beide dagen): hele weken, een week extra aan beide kanten, minstens 2 en hoogstens 6 weken.
  // Terug: { van, tot } met tot = de dag NA de laatste dag (zoals Graph het vraagt).
  A.venster = function (van, tot) {
    if (!isYmd(van)) return null; if (!isYmd(tot) || tot < van) tot = van;
    let a = nr(maandag(van)) - 7, b = nr(maandag(tot)) + 7 + 7;   // maandag van de volgende week + een week marge
    if (b - a < MIN_DAGEN) b = a + MIN_DAGEN;
    if (b - a > MAX_DAGEN) { a = nr(maandag(van)) - 7; b = a + MAX_DAGEN; }   // te veel in beeld (kwartaal): de eerste zes weken vanaf wat links in beeld is
    return { van: ymd(a), tot: ymd(b) };
  };
  A.bevat = (w, v) => !!w && !!v && w.van <= v.van && w.tot >= v.tot;

  // ── omzetten ──
  // Graph geeft { dateTime, timeZone }. Met de Prefer-kop is dat al de lokale tijd (dan gelden de cijfers letterlijk); zegt het antwoord UTC, dan rekenen we zelf om naar Amsterdam.
  const AMS = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_ISO, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return null; } })();
  const AMSTERDAM = /^(w\. europe standard time|europe\/amsterdam|romance standard time|central europe standard time)$/i;
  A.lokaal = function (dt) {
    if (!dt || typeof dt.dateTime !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(dt.dateTime); if (!m || !isYmd(m[1])) return null;
    const zone = String(dt.timeZone || ''), metOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(dt.dateTime), utc = /^(utc|etc\/utc|gmt|z)$/i.test(zone);
    if (!utc && !metOffset) { if (zone && !AMSTERDAM.test(zone)) return null; return { datum: m[1], min: Number(m[2]) * 60 + Number(m[3]) }; }   // lokale tijd (met de Prefer-kop); een onbekende tijdzone rekenen we niet zelf om: die afspraak wordt gemeld als overgeslagen
    if (!AMS) return null;
    const t = metOffset ? Date.parse(dt.dateTime.replace(/(\.\d{3})\d+/, '$1')) : Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':00Z'); if (!Number.isFinite(t)) return null;
    const p = {}; AMS.formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
    return { datum: p.year + '-' + p.month + '-' + p.day, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  };
  const STATUS = { busy: 'busy', oof: 'oof', tentative: 'tentative' };   // vrij, "elders aan het werk" en onbekend maken iemand niet bezet
  // Een afspraak (van calendarView of een regel van getSchedule) naar blokken per dag: { id, datum, start, eind (minuten), heleDag, status, onderwerp, plaats, herhaald, prive }
  A.blokken = function (e, bron) {
    if (!e || typeof e !== 'object' || e.isCancelled) return [];
    const status = STATUS[String(e.showAs || e.status || '').toLowerCase()]; if (!status) return [];
    const a = A.lokaal(e.start), b = A.lokaal(e.end); if (!a || !b) return [];
    const aN = nr(a.datum), bN = nr(b.datum); if (bN < aN || (bN === aN && b.min <= a.min && !e.isAllDay)) return [];
    const prive = !!(e.isPrivate || String(e.sensitivity || '').toLowerCase() === 'private');
    const onderwerp = prive ? '' : String(e.subject || '').trim().slice(0, 200), plaats = prive ? '' : String((e.location && (e.location.displayName || e.location)) || '').trim().slice(0, 120);
    const herhaald = !!e.type && !/^singleinstance$/i.test(String(e.type));
    const uit = [];
    for (let n = aN; n <= Math.min(bN, aN + 62); n++) {
      const s = n === aN ? a.min : 0, t = n === bN ? b.min : 1440;
      if (t <= s) continue;   // een afspraak die precies om middernacht eindigt heeft geen stuk op de volgende dag
      uit.push({ id: String(e.id || e.iCalUId || (bron + ':' + a.datum + ':' + a.min)), datum: ymd(n), start: s, eind: t, heleDag: !!e.isAllDay || (s === 0 && t === 1440), status, onderwerp, plaats, herhaald, prive });
    }
    return uit;
  };
  // Per dag op volgorde en in banen (lanes) zodat elkaar overlappende afspraken onder elkaar staan. Hele-dagafspraken vormen samen de bovenste banen.
  A.banen = function (lijst) {
    const hele = lijst.filter(x => x.heleDag), tijd = lijst.filter(x => !x.heleDag).sort((x, y) => x.start - y.start || x.eind - y.eind);
    const uit = [], einde = [];
    hele.forEach((b, i) => uit.push(Object.assign({}, b, { lane: i })));
    const basis = hele.length;
    tijd.forEach(b => { let l = einde.findIndex(e => e <= b.start); if (l < 0) { l = einde.length; einde.push(0); } einde[l] = b.eind; uit.push(Object.assign({}, b, { lane: basis + l })); });
    return { blokken: uit, banen: basis + einde.length };
  };

  // ── de stand per persoon ──
  const stand = new Map();   // slug -> { status, melding, perDag: { datum: [blok] }, ts, venster, n }
  let rev = 0, luisteraars = [], wachtTot = 0, uitstaand = 0, tijdstip = 0, bezig = new Map(), timer = null, wachtrij = [], teller = 0, gen = 0, lopend = new Map();   // teller: het volgnummer van een leesronde (een oud antwoord overschrijft een nieuwer nooit); gen: telt op bij wis() (na uitloggen schrijft een trage aanvraag niets meer terug)
  A.rev = () => rev;
  A.opLuister = f => { if (typeof f === 'function') luisteraars.push(f); };
  const melden = () => { rev++; luisteraars.slice().forEach(f => { try { f(); } catch (e) { console.warn('Agenda (Outlook):', e); } }); };
  A.stand = slug => stand.get(String(slug || '').toLowerCase()) || { status: 'leeg', melding: '', perDag: {}, ts: 0, venster: null, n: 0 };
  A.afspraken = (slug, datum) => ((A.stand(slug).perDag || {})[datum]) || [];
  A.dekt = (slug, van, tot) => { const s = A.stand(slug); return !!s.venster && s.venster.van <= van && s.venster.tot > tot; };   // staan de dagen van (van t/m tot) in wat gelezen is?
  A.wis = () => { gen++; clearTimeout(timer); clearTimeout(tijdstip); stand.clear(); bezig.clear(); lopend.clear(); wachtrij = []; uitstaand = 0; wachtTot = 0; rev++; };   // voor tests en bij uitloggen
  const zet = (slug, o) => { const s = String(slug).toLowerCase(), oud = stand.get(s) || { perDag: {}, ts: 0, venster: null, n: 0, melding: '', status: 'leeg' }; const nieuw = Object.assign({}, oud, o); stand.set(s, nieuw); return nieuw; };

  // Wat Bart kan aanzetten als een agenda niet te lezen is. Wij wijzigen zelf niets aan machtigingen of Azure.
  A.UITLEG_DEELN = 'Dit komt meestal doordat de agenda niet gedeeld is: de eigenaar kan dat zelf aanzetten in Outlook ▸ Agenda ▸ Delen (minstens "Kan beschikbaarheid zien", voor onderwerpen "Kan titels en locaties zien").';
  A.UITLEG_RECHT = 'Microsoft weigerde de aanvraag. Wat Bart kan controleren: in Azure ▸ App-registraties ▸ de MT-app ▸ API-machtigingen staat Calendars.ReadWrite (gedelegeerd, die staat er al; Calendars.ReadBasic of Calendars.Read volstaat ook) en de toestemming is gegeven voor de organisatie.';
  const naam = slug => { const m = (D.team() || []).find(t => String(t.slug || '').toLowerCase() === String(slug).toLowerCase()); return m ? (m.naam || m.label || m.slug) : String(slug); };
  const ZICHTBAAR = { 'ErrorFreeBusyDataNotAvailable': 1, 'ErrorMailRecipientNotFound': 1, 'ErrorAccessDenied': 1 };
  function foutStand(slug, fout) {
    const st = fout && fout.status;
    if (st === 401) return { status: 'inloggen', melding: 'Je bent niet (meer) ingelogd bij Microsoft: log opnieuw in om de afspraken te zien.' };
    if (st === 403) return { status: 'niet-zichtbaar', melding: 'agenda van ' + naam(slug) + ' niet zichtbaar (403). ' + A.UITLEG_RECHT };
    if (st === 429) return { status: 'wacht', melding: 'Microsoft vraagt om rustiger aan te doen; de afspraken worden zo weer opgehaald.' };
    return { status: 'fout', melding: 'De afspraken van ' + naam(slug) + ' konden niet worden opgehaald' + (st ? ' (HTTP ' + st + ')' : '') + '; er wordt zo opnieuw geprobeerd.' };
  }
  const retryNa = f => { const s = f && f.retryAfter; return Math.min(300, Math.max(5, Number(s) || 15)); };
  const wachtFout = () => { const e = new Error('wachten op Microsoft'); e.status = 429; e.intern = true; return e; };   // een taak in de wachtrij die pas begint als Microsoft om rust vroeg, begint niet

  // ── aanroepen ──
  const kop = { Prefer: 'outlook.timezone="' + TZ + '"' };
  async function leesEigen(slug, w) {
    if (D.nu() < wachtTot) throw wachtFout();
    const marge = (d, k) => ymd(nr(d) + k) + 'T00:00:00Z', perDag = {}; let n = 0, over = 0;
    const u = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
    Object.entries({ startDateTime: marge(w.van, -1), endDateTime: marge(w.tot, 1), $select: 'id,subject,start,end,location,isAllDay,isCancelled,showAs,type,sensitivity', $orderby: 'start/dateTime', $top: '100' }).forEach(([k, v]) => u.searchParams.set(k, v));
    let url = u.toString();
    for (let p = 0; url && p < MAX_PAGINAS; p++) {
      const r = await D.fetch(url, { headers: kop });
      ((r && r.value) || []).forEach(e => { const bl = A.blokken(e, 'eigen'); if (!bl.length && e && e.start && !e.isCancelled && !A.lokaal(e.start)) over++; bl.forEach(b => { if (b.datum >= w.van && b.datum < w.tot) { (perDag[b.datum] = perDag[b.datum] || []).push(b); n++; } }); });
      url = r && r['@odata.nextLink'] || '';
    }
    return { perDag, n, volledig: !url, over };   // volledig: onwaar als er na de laatste pagina nog meer was (dan staat niet alles op het scherm, en dat zeggen we)
  }
  async function leesAnderen(personen, w) {   // personen: [{ slug, email }]; een groep van hoogstens 20
    if (D.nu() < wachtTot) throw wachtFout();
    const r = await D.fetch('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, kop), body: JSON.stringify({ schedules: personen.map(p => p.email), startTime: { dateTime: w.van + 'T00:00:00', timeZone: TZ }, endTime: { dateTime: w.tot + 'T00:00:00', timeZone: TZ }, availabilityViewInterval: 60 }) });
    const uit = new Map(), waarden = (r && r.value) || [];
    personen.forEach(p => {
      const s = waarden.find(x => String(x && x.scheduleId || '').toLowerCase() === p.email.toLowerCase());
      if (!s) { uit.set(p.slug, { fout: { code: 'ontbreekt' } }); return; }
      if (s.error) { uit.set(p.slug, { fout: { code: s.error.responseCode || 'fout', tekst: s.error.message || '', teVeel: /5006|too many calendar entries/i.test(String(s.error.responseCode || '') + ' ' + String(s.error.message || '')) } }); return; }
      const perDag = {}; let n = 0, over = 0;
      (s.scheduleItems || []).forEach(it => { const bl = A.blokken(it, 'schedule'); if (!bl.length && it && it.start && STATUS[String(it.status || '').toLowerCase()] && !A.lokaal(it.start)) over++; bl.forEach(b => { if (b.datum >= w.van && b.datum < w.tot) { (perDag[b.datum] = perDag[b.datum] || []).push(b); n++; } }); });
      uit.set(p.slug, { perDag, n, volledig: true, over });
    });
    return uit;
  }

  // Een opdracht tegelijk per soort, hoogstens TEGELIJK (2) samen; een nieuwe vraag voor dezelfde sleutel sluit aan op wat al loopt.
  function plan(sleutel, taak) {
    if (bezig.has(sleutel)) return bezig.get(sleutel);
    const p = new Promise(res => { wachtrij.push({ taak, res }); });
    bezig.set(sleutel, p); p.then(() => bezig.delete(sleutel), () => bezig.delete(sleutel)); pomp(); return p;
  }
  function pomp() {
    while (uitstaand < TEGELIJK && wachtrij.length) {
      const w = wachtrij.shift(); uitstaand++;
      Promise.resolve().then(w.taak).then(v => w.res(v), e => w.res({ fout: e })).then(() => { uitstaand--; pomp(); });
    }
  }
  const vers = (s, w) => s && s.venster && A.bevat(s.venster, w) && (D.nu() - s.ts) < TTL && (s.status === 'klaar' || s.status === 'niet-zichtbaar' || s.status === 'geen-email' || s.status === 'te-veel');

  // Lees het venster voor het hele team (alleen wat niet vers in het geheugen staat). Terug: de belofte voor een test of een aanroeper die wil wachten.
  // Dezelfde vraag die al loopt: aansluiten op wat loopt (geen tweede ronde die de eerste ongeldig maakt en dan zelf niets terugschrijft).
  A.laad = function (w, o) {
    if (!D || !w) return Promise.resolve();
    const k = w.van + '|' + w.tot; if (lopend.has(k)) return lopend.get(k);
    const p = laadRonde(w, o).then(() => { if (lopend.get(k) === p) lopend.delete(k); }, e => { if (lopend.get(k) === p) lopend.delete(k); throw e; });
    lopend.set(k, p); return p;
  };
  async function laadRonde(w, o) {
    const nu = D.nu(), team = (D.team() || []).filter(t => t && t.slug), ik = String(D.ik ? D.ik() : '').toLowerCase();
    if (nu < wachtTot) {   // Microsoft vroeg om te wachten: niets aanroepen; wat er al staat blijft staan
      team.forEach(t => { const s = stand.get(String(t.slug).toLowerCase()); if (!s || !s.n) zet(t.slug, { status: 'wacht', melding: 'Microsoft vraagt om rustiger aan te doen; de afspraken worden zo weer opgehaald.' }); });
      melden(); return;
    }
    const mijn = team.find(t => String(t.email || '').toLowerCase() === ik), te = [];
    team.forEach(t => { const s = stand.get(String(t.slug).toLowerCase()); if (o && o.forceer || !vers(s, w)) te.push(t); });
    if (!te.length) return;
    const seq = ++teller, mijnGen = gen;
    te.forEach(t => { const s = stand.get(String(t.slug).toLowerCase()); if (!s || !s.n) zet(t.slug, { status: 'laden', melding: '', seq }); else zet(t.slug, { verversen: true, seq }); });
    melden();
    const taken = [];
    const actueel = t => gen === mijnGen && ((stand.get(String(t.slug).toLowerCase()) || {}).seq || 0) <= seq;   // is er na wis() of door een nieuwere ronde niets veranderd voor deze persoon?
    const klaar = (t, d) => { if (actueel(t)) zet(t.slug, { status: 'klaar', melding: '', perDag: d.perDag, n: d.n, ts: D.nu(), venster: w, verversen: false, seq, deels: d.volledig === false, over: d.over || 0 }); };
    const faal = (t, f) => {
      if (f && f.status === 429 && !f.intern) wachtTot = Math.max(wachtTot, D.nu() + retryNa(f) * 1000);
      if (!actueel(t)) return;
      const fs = foutStand(t.slug, f), oud = stand.get(String(t.slug).toLowerCase());
      if (oud && oud.n && (fs.status === 'fout' || fs.status === 'wacht')) zet(t.slug, { status: 'klaar', melding: '', verversen: false });   // een tijdelijke fout: wat er al stond blijft zichtbaar (de volgende vraag probeert opnieuw)
      else zet(t.slug, Object.assign({ verversen: false, ts: D.nu(), venster: w, perDag: {}, n: 0 }, fs));
    };
    if (mijn && te.includes(mijn)) taken.push(plan('eigen|' + w.van + '|' + w.tot, async () => { try { klaar(mijn, await leesEigen(mijn.slug, w)); } catch (f) { faal(mijn, f); } melden(); }));
    const anderen = te.filter(t => t !== mijn);
    const metMail = anderen.filter(t => String(t.email || '').includes('@')).map(t => ({ slug: t.slug, email: String(t.email).trim() }));
    anderen.filter(t => !String(t.email || '').includes('@')).forEach(t => zet(t.slug, { status: 'geen-email', melding: 'agenda van ' + naam(t.slug) + ' niet zichtbaar: er is geen e-mailadres bekend (Beheer ▸ Team).', perDag: {}, n: 0, ts: D.nu(), venster: w }));
    for (let i = 0; i < metMail.length; i += GROEP) {
      const groep = metMail.slice(i, i + GROEP);
      taken.push(plan('groep|' + groep.map(g => g.slug).join(',') + '|' + w.van + '|' + w.tot, async () => {
        try {
          const uit = await leesAnderen(groep, w);
          groep.forEach(g => { const d = uit.get(g.slug), t = { slug: g.slug };
            if (d && !d.fout) klaar(t, d);
            else if (actueel(t) && d && d.fout && d.fout.teVeel) zet(g.slug, { status: 'te-veel', melding: 'agenda van ' + naam(g.slug) + ': te veel afspraken in dit venster om bezet/vrij op te vragen (de grens van Microsoft is 1000). Kijk een kortere periode of open Outlook zelf.', perDag: {}, n: 0, ts: D.nu(), venster: w, verversen: false });
            else if (actueel(t)) zet(g.slug, { status: 'niet-zichtbaar', melding: 'agenda van ' + naam(g.slug) + ' niet zichtbaar' + (d && d.fout && d.fout.tekst ? ' (' + String(d.fout.tekst).slice(0, 120) + ')' : '') + '. ' + A.UITLEG_DEELN, perDag: {}, n: 0, ts: D.nu(), venster: w, verversen: false }); });
        } catch (f) { groep.forEach(g => faal({ slug: g.slug }, f)); }
        melden();
      }));
    }
    melden();
    await Promise.all(taken);
    // na een fout of een Retry-After later nog eens proberen (niet sneller dan de wachttijd, en niet eindeloos)
    const open = gen === mijnGen && team.some(t => { const s = stand.get(String(t.slug).toLowerCase()); return s && (s.status === 'fout' || s.status === 'wacht'); });
    if (open && !(o && o.poging >= 3) && typeof setTimeout === 'function' && A.opnieuw !== false) { clearTimeout(timer); const na = Math.max(15000, wachtTot - D.nu() + 500); timer = setTimeout(() => { A.laad(w, { poging: ((o && o.poging) || 0) + 1 }); }, na); }
  }
  // Gedempt (bladeren): pas na DEMP ms rust de aanvraag doen, en alleen voor het laatste venster.
  A.vraag = function (van, tot) {
    const w = A.venster(van, tot); if (!w) return null;
    clearTimeout(tijdstip); const stil = A.dempen === false;
    if (stil) return A.laad(w);
    tijdstip = setTimeout(() => { A.laad(w); }, DEMP);
    return null;
  };
  A.init = function (deps) { D = deps; return A; };
  A.stop = () => { clearTimeout(tijdstip); clearTimeout(timer); };
  root.MTCapAgenda = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})(typeof window !== 'undefined' ? window : globalThis);

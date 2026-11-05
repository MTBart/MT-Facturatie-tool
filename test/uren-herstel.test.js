// Tests "Uren zonder project" (mt-uren-herstel.js, herstelbak + datakwaliteitsmeter, alleen lezen) plus de Toggl-lezers uit mt-toggl.js.
// Draaien: node test/uren-herstel.test.js  — verzonnen gegevens, geen echte Toggl-aanroepen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const H = require('../mt-uren-herstel.js');
const VANDAAG = '2026-11-05';
const U = [{ id: 1, naam: 'Anna' }, { id: 2, naam: 'Bas' }];
const uur = u => u * 3600;

// Een minimale nep-omgeving: zonder document-element (getElementById geeft null) tekent H.teken niets, de logica loopt wel.
const maakDeps = (extra) => {
  const aanroepen = { rijenMaand: [], entriesTeam: [], eigenEntries: [], gebruikers: 0 };
  const deps = Object.assign({
    doc: { getElementById: () => null }, vandaag: () => VANDAAG, nu: () => Date.parse('2026-11-05T10:00:00Z'), lockDagen: () => 14,
    teamdata: () => true, foutTekst: e => (e && e.message) || 'onbekende fout',
    gebruikers: async () => { aanroepen.gebruikers++; return U; },
    rijenMaand: async (van, tot) => { aanroepen.rijenMaand.push([van, tot]); return []; },
    entriesTeam: async (van, tot) => { aanroepen.entriesTeam.push([van, tot]); return { entries: [], onvolledig: false }; },
    eigenEntries: async (van, tot) => { aanroepen.eigenEntries.push([van, tot]); return { entries: [], onvolledig: false }; },
  }, extra || {});
  return { deps, aanroepen };
};
const nieuw = (extra) => { const m = maakDeps(extra); H.init(m.deps); Object.assign(H.S, { status: 'nieuw', fout: '', meldingen: [], open: {}, bak: {}, entriesEigen: null, meter: null }); return m; };

(async () => {
  await test('Amsterdam: entry rond middernacht valt in de juiste maand (winter- en zomertijd)', () => {
    assert.strictEqual(H.amsterdamMaand('2026-10-31T22:30:00Z'), '2026-10');   // 23:30 CET
    assert.strictEqual(H.amsterdamMaand('2026-10-31T23:30:00Z'), '2026-11');   // 00:30 CET op 1 november
    assert.strictEqual(H.amsterdamMaand('2026-05-31T21:59:00Z'), '2026-05');   // 23:59 CEST
    assert.strictEqual(H.amsterdamMaand('2026-05-31T22:00:00Z'), '2026-06');   // 00:00 CEST op 1 juni
    assert.strictEqual(H.amsterdamMaand('2026-12-31T23:00:00+00:00'), '2027-01');
    assert.strictEqual(H.amsterdamMaand('2026-11-01T00:30:00+01:00'), '2026-11');
    assert.strictEqual(H.amsterdamYmd('2026-10-31T23:30:00Z'), '2026-11-01');
    assert.strictEqual(H.amsterdamMaand('geen datum'), '');
  });

  await test('Amsterdam: maandgrenzen als UTC-instants kloppen rond de wissel van zomer- en wintertijd', () => {
    assert.deepStrictEqual(H.maandGrenzen('2026-03'), { van: '2026-02-28T23:00:00.000Z', tot: '2026-03-31T21:59:59.999Z' });   // maart eindigt in zomertijd
    assert.deepStrictEqual(H.maandGrenzen('2026-10'), { van: '2026-09-30T22:00:00.000Z', tot: '2026-10-31T22:59:59.999Z' });   // oktober eindigt in wintertijd
    assert.deepStrictEqual(H.maandGrenzen('2026-11'), { van: '2026-10-31T23:00:00.000Z', tot: '2026-11-30T22:59:59.999Z' });
    assert.deepStrictEqual(H.maandGrenzen('2026-12'), { van: '2026-11-30T23:00:00.000Z', tot: '2026-12-31T22:59:59.999Z' });
  });

  await test('laatsteMaanden: zes maanden t/m de huidige, ook over de jaargrens', () => {
    assert.deepStrictEqual(H.laatsteMaanden('2026-11-05', 6), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    assert.deepStrictEqual(H.laatsteMaanden('2027-02-01', 3), ['2026-12', '2027-01', '2027-02']);
  });

  await test('meter: percentages project en taak per maand en per persoon', () => {
    const rijen = [
      { user: 1, project: 'p', taak: 't', sec: uur(10) }, { user: 1, project: 'p', taak: null, sec: uur(10) }, { user: 1, project: null, taak: null, sec: uur(20) },
      { user: 2, project: 'p', taak: 't', sec: uur(8) },
    ];
    const m = H.meter({ maanden: ['2026-10'], rijenPerMaand: { '2026-10': rijen }, users: U, vandaag: VANDAAG })[0];
    assert.strictEqual(m.status, 'ok');
    assert.strictEqual(m.totaalSec, uur(48)); assert.strictEqual(m.zonderProjectSec, uur(20));
    assert.strictEqual(m.pctProject, 58.3);   // 28 van 48
    assert.strictEqual(m.pctTaak, 37.5);      // 18 van 48
    const anna = m.personen.find(p => p.naam === 'Anna'), bas = m.personen.find(p => p.naam === 'Bas');
    assert.strictEqual(anna.pctProject, 50); assert.strictEqual(anna.pctTaak, 25); assert.strictEqual(anna.zonderProjectSec, uur(20));
    assert.strictEqual(bas.pctProject, 100); assert.strictEqual(bas.pctTaak, 100);
    assert.strictEqual(m.personen[0].naam, 'Anna');   // slechtste eerst
    assert.strictEqual(m.lopend, false);
  });

  await test('meter: een taak zonder project en een project zonder taak tellen elk in hun eigen percentage', () => {
    const m = H.meter({ maanden: ['2026-10'], rijenPerMaand: { '2026-10': [{ user: 1, project: 'p', taak: null, sec: uur(5) }] }, users: U, vandaag: VANDAAG })[0];
    assert.strictEqual(m.pctProject, 100); assert.strictEqual(m.pctTaak, 0); assert.strictEqual(m.zonderProjectSec, 0);
  });

  await test('meter: maand zonder uren geeft geen percentage (geen deling door 0, geen verzonnen 0% of 100%)', () => {
    const [leeg, nulRij] = H.meter({ maanden: ['2026-09', '2026-08'], rijenPerMaand: { '2026-09': [], '2026-08': [{ user: 1, project: 'p', taak: null, sec: 0 }] }, users: U, vandaag: VANDAAG });
    [leeg, nulRij].forEach(m => { assert.strictEqual(m.status, 'leeg'); assert.strictEqual(m.pctProject, null); assert.strictEqual(m.pctTaak, null); assert.strictEqual(m.totaalSec, 0); });
    assert.strictEqual(H.pctTekst(null), 'n.v.t.');
    assert.strictEqual(H.pctTekst(58.3), '58,3%');
  });

  await test('meter: de lopende maand is gemarkeerd; een maand die niet laadde is een fout, geen nul', () => {
    const r = H.meter({ maanden: ['2026-10', '2026-11'], rijenPerMaand: { '2026-10': [{ user: 1, project: 'p', taak: null, sec: 3600 }], '2026-11': null }, fouten: { '2026-11': 'Toggl vraagt om even te wachten' }, users: U, vandaag: VANDAAG });
    assert.strictEqual(r[0].lopend, false);
    assert.strictEqual(r[1].lopend, true); assert.strictEqual(r[1].status, 'fout'); assert.strictEqual(r[1].fout, 'Toggl vraagt om even te wachten'); assert.strictEqual(r[1].pctProject, null);
    const lopend = H.meter({ maanden: ['2026-11'], rijenPerMaand: { '2026-11': [{ user: 1, project: 'p', taak: null, sec: 3600 }] }, users: U, vandaag: VANDAAG })[0];
    assert.strictEqual(lopend.lopend, true); assert.strictEqual(lopend.status, 'ok');
  });

  await test('trend: vergelijkt de laatste twee afgesloten maanden en slaat de lopende maand over', () => {
    const rij = (user, p, t, s) => ({ user, project: p, taak: t, sec: s });
    const meter = H.meter({ maanden: ['2026-09', '2026-10', '2026-11'], vandaag: VANDAAG, users: U, rijenPerMaand: {
      '2026-09': [rij(1, 'p', null, 80), rij(1, null, null, 20)],           // 80%, taak 0%
      '2026-10': [rij(1, 'p', 't', 90), rij(1, null, null, 10)],            // 90%, taak 90%
      '2026-11': [rij(1, null, null, 100)] } });                           // lopend, telt niet mee
    const t = H.trend(meter);
    assert.strictEqual(t.genoeg, true); assert.strictEqual(t.van, '2026-09'); assert.strictEqual(t.naar, '2026-10');
    assert.strictEqual(t.project, 10); assert.strictEqual(t.taak, 90); assert.strictEqual(t.richting, 'beter');
    assert.ok(/80% → 90%/.test(t.tekst));
    assert.strictEqual(H.trend(meter.slice(2)).genoeg, false);
    assert.strictEqual(H.trend([]).genoeg, false);
  });

  await test('bak: alleen entries zonder project in de maand, oud naar nieuw; entries zonder taak maar met project horen er niet in', () => {
    const e = (id, start, project, taak, oms) => ({ id, persoon: 'Anna', start, sec: 1800, project, taak, omschrijving: oms });
    const entries = [
      e(1, '2026-10-20T08:00:00Z', null, null, 'later'), e(2, '2026-10-05T08:00:00Z', null, 't', 'vroeg, zonder project maar wel taak'),
      e(3, '2026-10-06T08:00:00Z', 'p', null, 'project zonder taak'), e(4, '2026-09-30T08:00:00Z', null, null, 'andere maand'),
      e(5, '2026-10-31T23:30:00Z', null, null, 'middernacht, hoort in november'), e(6, '2026-10-31T22:30:00Z', null, null, 'nog oktober'),
      { id: 7, persoon: 'Anna', start: '2026-10-07T08:00:00Z', sec: 0, project: null, taak: null, omschrijving: 'zonder duur' },
    ];
    const b = H.bak(entries, '2026-10', { nu: Date.parse('2026-11-05T10:00:00Z'), lockDagen: 14 });
    assert.deepStrictEqual(b.entries.map(x => x.id), [2, 1, 6]);   // 2 heeft wel een taak maar geen project: hoort in de bak
    assert.strictEqual(b.aantal, 3); assert.strictEqual(b.sec, 5400);
    assert.strictEqual(b.entries[0].datum, '2026-10-05'); assert.strictEqual(b.entries[0].vergrendeld, true);
    assert.strictEqual(b.entries[2].vergrendeld, false);   // 31 oktober is minder dan 14 dagen geleden
    assert.ok(!b.entries.some(x => x.id === 3), 'project zonder taak hoort niet in de bak');
    assert.deepStrictEqual(H.bak(entries, '2026-11', {}).entries.map(x => x.id), [5]);
    assert.strictEqual(H.bak(entries, '2026-08', {}).aantal, 0);
    assert.strictEqual(H.bak(null, '2026-10').aantal, 0);
  });

  await test('laad (team): alle zes maanden via de Amsterdamse maandgrenzen, personen uit de gebruikerslijst', async () => {
    const { aanroepen } = nieuw({ rijenMaand: async (van, tot) => { aanroepen2.push([van, tot]); return [{ user: 1, project: 'p', taak: null, sec: uur(4) }, { user: 2, project: null, taak: null, sec: uur(4) }]; } });
    const aanroepen2 = []; // eslint-disable-line
    await H.laad(false);
    assert.strictEqual(H.S.status, 'ok'); assert.strictEqual(H.S.modus, 'team');
    assert.strictEqual(aanroepen2.length, 6);
    assert.deepStrictEqual(aanroepen2[5], ['2026-10-31T23:00:00.000Z', '2026-11-30T22:59:59.999Z']);
    assert.strictEqual(H.S.meter.length, 6);
    assert.strictEqual(H.S.meter[5].pctProject, 50); assert.strictEqual(H.S.meter[5].lopend, true);
    assert.deepStrictEqual(H.S.meter[5].personen.map(p => p.naam).sort(), ['Anna', 'Bas']);
    assert.strictEqual(aanroepen.eigenEntries.length, 0);
  });

  await test('rechten: wie geen teamgegevens mag zien haalt nooit teamdata op en ziet alleen de eigen uren', async () => {
    const { aanroepen } = nieuw({ teamdata: () => false, eigenEntries: async (v, t) => { aanroepenEigen.push([v, t]); return { entries: [
      { id: 1, persoon: 'Jij', start: '2026-10-10T08:00:00Z', sec: uur(6), project: 'p', taak: null, omschrijving: 'a' },
      { id: 2, persoon: 'Jij', start: '2026-10-11T08:00:00Z', sec: uur(2), project: null, taak: null, omschrijving: 'zonder' }], onvolledig: false }; } });
    const aanroepenEigen = [];
    await H.laad(false);
    assert.strictEqual(H.S.modus, 'eigen'); assert.strictEqual(H.S.status, 'ok');
    assert.strictEqual(aanroepen.gebruikers, 0); assert.strictEqual(aanroepen.rijenMaand.length, 0); assert.strictEqual(aanroepen.entriesTeam.length, 0);
    assert.strictEqual(aanroepenEigen.length, 1);
    assert.strictEqual(aanroepenEigen[0][0], '2026-05-31'); assert.ok(aanroepenEigen[0][1] >= '2026-12-01');
    const okt = H.S.meter.find(m => m.ym === '2026-10');
    assert.strictEqual(okt.pctProject, 75); assert.strictEqual(okt.zonderProjectSec, uur(2)); assert.deepStrictEqual(okt.personen.map(p => p.naam), ['Jij']);
    await H.laadBak('2026-10');   // eigen: de bak komt uit de al geladen eigen entries, nooit uit het team
    assert.strictEqual(H.S.bak['2026-10'].aantal, 1); assert.strictEqual(aanroepen.entriesTeam.length, 0);
  });

  await test('laad: fout van Toggl (429) geeft een nette melding en geen nullen', async () => {
    const e429 = Object.assign(new Error('Toggl HTTP 429'), { status: 429 });
    nieuw({ rijenMaand: async () => { throw e429; }, foutTekst: e => 'Toggl vraagt om even te wachten' });
    await H.laad(false);
    assert.strictEqual(H.S.status, 'fout'); assert.ok(/even te wachten/.test(H.S.fout));
    assert.ok(H.S.meter.every(m => m.status === 'fout' && m.pctProject === null));
  });

  await test('laad: één maand mislukt, de rest blijft zichtbaar en de fout staat erbij', async () => {
    let i = 0;
    nieuw({ rijenMaand: async () => { if (++i === 3) throw new Error('offline'); return [{ user: 1, project: 'p', taak: null, sec: 3600 }]; } });
    await H.laad(false);
    assert.strictEqual(H.S.status, 'ok');
    assert.strictEqual(H.S.meter.filter(m => m.status === 'fout').length, 1);
    assert.strictEqual(H.S.meter[2].fout, 'offline');
    assert.ok(H.S.meldingen.some(t => /Niet alle maanden/.test(t)));
  });

  await test('laad: gebruikerslijst of eigen entries onbereikbaar (offline) geeft een fout, geen lege cijfers', async () => {
    nieuw({ gebruikers: async () => { throw new Error('Microsoft-login vereist'); } });
    await H.laad(false); assert.strictEqual(H.S.status, 'fout'); assert.ok(/login/.test(H.S.fout));
    nieuw({ teamdata: () => false, eigenEntries: async () => { throw new Error('Failed to fetch'); } });
    await H.laad(false); assert.strictEqual(H.S.status, 'fout'); assert.strictEqual(H.S.meter, null);
  });

  await test('laad: een lege respons voor alle maanden wordt gemeld in plaats van als 100% goed getoond', async () => {
    nieuw();   // standaard geeft rijenMaand overal []
    await H.laad(false);
    assert.strictEqual(H.S.status, 'ok');
    assert.ok(H.S.meter.every(m => m.status === 'leeg' && m.pctProject === null));
    assert.ok(H.S.meldingen.some(t => /nul uren/.test(t)));
  });

  await test('laad: de eigen lijst die op de grens van de Toggl-limiet uitkomt, wordt onvolledig genoemd', async () => {
    nieuw({ teamdata: () => false, eigenEntries: async () => ({ entries: [{ id: 1, start: '2026-10-10T08:00:00Z', sec: 60, project: 'p', taak: null }], onvolledig: true }) });
    await H.laad(false);
    assert.ok(H.S.meldingen.some(t => /onvolledig/.test(t)));
  });

  await test('bak (team): paginering onvolledig wordt doorgegeven; fout van Toggl wordt een foutstatus', async () => {
    const e = { id: 1, persoon: 'Bas', start: '2026-10-10T08:00:00Z', sec: 600, project: null, taak: null, omschrijving: 'x' };
    const { aanroepen } = nieuw({ entriesTeam: async (van, tot) => { aanroepen2.push([van, tot]); return { entries: [e], onvolledig: true }; } });
    const aanroepen2 = [];
    await H.laad(false);
    await H.laadBak('2026-10');
    assert.deepStrictEqual(aanroepen2[0], ['2026-09-30', '2026-11-02']);
    assert.strictEqual(H.S.bak['2026-10'].status, 'ok'); assert.strictEqual(H.S.bak['2026-10'].onvolledig, true); assert.strictEqual(H.S.bak['2026-10'].aantal, 1);
    nieuw({ entriesTeam: async () => { throw new Error('Toggl vraagt om even te wachten'); } });
    await H.laad(false); await H.laadBak('2026-10');
    assert.strictEqual(H.S.bak['2026-10'].status, 'fout'); assert.ok(/even te wachten/.test(H.S.bak['2026-10'].fout));
    void aanroepen;
  });

  await test('tekenen: de pagina zegt dat het alleen leest, escapet data via textContent en heeft geen schrijfknoppen', async () => {
    // Een mini-DOM: genoeg om te zien wat er getekend wordt.
    const maakEl = tag => { const e = { tag, kids: [], attrs: {}, style: {}, set className(v) { this._c = v; }, get className() { return this._c || ''; }, textContent: '', appendChild(k) { this.kids.push(k); return k; }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (this.ev = this.ev || {})[t] = f; } };
      Object.defineProperty(e, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = String(v); if (v === '') this.kids = []; } }); return e; };
    const w = maakEl('div'), doc = { getElementById: id => id === 'uren-herstel' ? w : null, createElement: maakEl, createTextNode: t => ({ tekstknoop: t }), head: maakEl('head') };
    const kwaad = '<img src=x onerror=alert(1)>';
    nieuw({ doc, rijenMaand: async () => [{ user: 1, project: null, taak: null, sec: 3600 }], entriesTeam: async () => ({ entries: [{ id: 1, persoon: kwaad, start: '2026-10-10T08:00:00Z', sec: 600, project: null, taak: null, omschrijving: kwaad }], onvolledig: false }) });
    await H.laad(false); H.S.open['2026-10'] = true; await H.laadBak('2026-10');
    const alles = []; (function loop(e) { alles.push(e); (e.kids || []).forEach(loop); })(w);
    const tekst = alles.map(e => (e.tekstknoop || e._t || '')).join('|');
    assert.ok(/Alleen lezen/.test(tekst) && /niets gekoppeld of gewijzigd/.test(tekst));
    assert.ok(tekst.includes(kwaad));   // staat als tekst, nooit als markup
    assert.ok(alles.every(e => e.tag !== 'img'));
    assert.ok(alles.every(e => !e.tag || e.tag === 'button' || !e.ev), 'alleen knoppen hebben een klik');
    const knoppen = alles.filter(e => e.tag === 'button').map(e => e._t);
    assert.ok(knoppen.every(t => /Opnieuw|Toon|Verberg/.test(t)), 'geen koppel- of wijzigknop: ' + knoppen);
  });

  await test('bron: de module bevat geen schrijfacties (POST/PATCH/PUT/DELETE, opslag, innerHTML)', () => {
    const bron = fs.readFileSync(path.join(__dirname, '..', 'mt-uren-herstel.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//, '').replace(/\/\/.*$/gm, '');
    ['POST', 'PATCH', 'PUT', 'DELETE', 'localStorage', 'sessionStorage', 'innerHTML', 'insertAdjacentHTML', 'fetch(', 'audit'].forEach(w => assert.ok(!bron.includes(w), 'verboden: ' + w));
  });

  // ── de Toggl-lezers in mt-toggl.js, met een nep-omgeving ──
  const ctx = { console, JSON, Date, Promise, Math, Number, String, Array, Object, isFinite, setTimeout, clearTimeout, Error, sessionStorage: { getItem: () => null, setItem: () => {} }, localStorage: { getItem: () => null }, window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'mt-toggl.js'), 'utf8'), ctx);
  vm.runInContext('_tgQ.tussen=0; _tgQ.slaap=function(){ return Promise.resolve(); }', ctx);
  ctx.agNames = () => ({ pn: {}, un: { 7: 'Zeven' } });   // in de app staat agNames in v2.html
  const zetEigen = f => { ctx.__mock = f; vm.runInContext('tgStore.eigenEntries=__mock', ctx); };   // tgStore is een const in het script, dus niet direct als eigenschap bereikbaar
  const rij = (user, project, taak, desc, start, sec) => ({ user_id: user, username: 'Anna', project_id: project, task_id: taak, description: desc, time_entries: [{ id: 9, seconds: sec, start }] });

  await test('tgUrenEntriesTeam: leest pagina na pagina tot een korte pagina, negeert lopende timers', async () => {
    const paginas = []; ctx.tgReports = async b => { paginas.push(b.first_row_number); if (b.first_row_number === 1) return Array.from({ length: 1000 }, () => rij(1, null, null, 'x', '2026-10-10T08:00:00Z', 60)); return [rij(1, null, null, 'laatste', '2026-10-11T08:00:00Z', 60), rij(1, 5, null, 'lopend', '2026-10-12T08:00:00Z', -1)]; };
    const r = await ctx.tgUrenEntriesTeam('2026-09-30', '2026-11-02');
    assert.deepStrictEqual(paginas, [1, 1001]);
    assert.strictEqual(r.entries.length, 1001); assert.strictEqual(r.onvolledig, false);
    assert.strictEqual(r.entries[1000].omschrijving, 'laatste'); assert.strictEqual(r.entries[1000].project, null);
  });

  await test('tgUrenEntriesTeam: meer dan 20 volle pagina\'s wordt onvolledig, niet stil afgekapt', async () => {
    let calls = 0; ctx.tgReports = async () => { calls++; return Array.from({ length: 1000 }, () => rij(1, 1, null, 'x', '2026-10-10T08:00:00Z', 60)); };
    const r = await ctx.tgUrenEntriesTeam('2026-09-30', '2026-11-02');
    assert.strictEqual(calls, 20); assert.strictEqual(r.onvolledig, true); assert.strictEqual(r.entries.length, 20000);
  });

  await test('tgUrenEntriesTeam: een onverwacht antwoord of een fout (429) wordt een fout, geen lege lijst', async () => {
    ctx.tgReports = async () => ({ fout: 'x' });
    await assert.rejects(() => ctx.tgUrenEntriesTeam('2026-09-30', '2026-11-02'), /onverwacht antwoord/);
    ctx.tgReports = async () => { throw Object.assign(new Error('Reports HTTP 403'), { status: 403 }); };
    await assert.rejects(() => ctx.tgUrenEntriesTeam('2026-09-30', '2026-11-02'), /403/);
  });

  await test('tgUrenEntriesEigen: eigen entries in dezelfde vorm; lopende timer en vorm-fouten', async () => {
    zetEigen(async () => [{ id: 1, start: '2026-10-10T08:00:00+02:00', duration: 3600, project_id: null, task_id: null, description: 'a' }, { id: 2, start: '2026-10-10T09:00:00+02:00', duration: -1700000000, project_id: 3, description: 'lopend' }, { id: 3, start: '2026-10-10T10:00:00+02:00', duration: 600, project_id: 3, task_id: 4, description: 'b' }]);
    const r = await ctx.tgUrenEntriesEigen('2026-09-30', '2026-11-02');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.entries.map(e => [e.id, e.project, e.taak, e.sec]))), [[1, null, null, 3600], [3, 3, 4, 600]]); assert.strictEqual(r.onvolledig, false);
    zetEigen(async () => Array.from({ length: 1000 }, (_, i) => ({ id: i, start: '2026-10-10T08:00:00Z', duration: 60, project_id: 1 })));
    assert.strictEqual((await ctx.tgUrenEntriesEigen('a', 'b')).onvolledig, true);
    zetEigen(async () => 'kapot');
    await assert.rejects(() => ctx.tgUrenEntriesEigen('a', 'b'), /onverwacht antwoord/);
  });

  await test('tgUrenPerGebruikerIso: stuurt de ISO-grenzen mee, leest alleen (POST is hier een query), en weigert een kapot antwoord', async () => {
    let body = null, pad = null;
    ctx.focusFetchPad = async (p, m, b) => { pad = p; body = b; return { data_json_row: [{ user_account_id: 1, project_id: null, task_id: null, sum_duration: 3600 }] }; };
    const r = await ctx.tgUrenPerGebruikerIso('2026-10-31T23:00:00.000Z', '2026-11-30T22:59:59.999Z', true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), [{ user: 1, project: null, taak: null, sec: 3600 }]);
    assert.ok(/^reports\/workspaces\/\d+\/query$/.test(pad));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(body.filters[0].value)), ['2026-10-31T23:00:00.000Z', '2026-11-30T22:59:59.999Z']);
    ctx.focusFetchPad = async () => ({});
    await assert.rejects(() => ctx.tgUrenPerGebruikerIso('a', 'b', true), /onverwacht antwoord/);
  });

  console.log('\n' + n + ' tests geslaagd' + (process.exitCode ? ' (met fouten)' : ''));
})();

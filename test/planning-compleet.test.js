// Tests "Planning compleet?" (mt-compleet.js): de controle-logica als pure functies, plus de Toggl-lezers uit mt-toggl.js.
// Draaien: node test/planning-compleet.test.js  — verzonnen gegevens, geen echte Toggl-aanroepen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const P = require('../mt-planning.js'), C = require('../mt-compleet.js');
const TEAM = [
  { slug: 'anna', naam: 'Anna', email: 'anna@mortiseandtenon.nl' },
  { slug: 'bas', naam: 'Bas', email: 'bas@mortiseandtenon.nl' },
  { slug: 'carla', naam: 'Carla', email: 'carla@mortiseandtenon.nl' },
  { slug: 'rol-x', naam: 'Plaats', email: '', placeholder: true },
];
const VANDAAG = '2026-11-04';   // woensdag; de week begint op 2026-11-02
const dagenVan = (van, tot, perDag, extra) => { const o = {}; for (let d = new Date(van + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= tot; d.setUTCDate(d.getUTCDate() + 1)) { const s = d.toISOString().slice(0, 10), wd = (d.getUTCDay() + 6) % 7; o[s] = Object.assign({ werk: wd < 5 ? perDag : 0, gepland: 0, vrij: wd < 5 ? perDag : 0, verlof: 0 }, (extra && extra[s]) || {}); } return o; };
const V = C.vensterVooruit(VANDAAG), vensterDagen = (perDag, extra) => dagenVan(V.van, V.tot, perDag, extra);

(async () => {
  await test('vensters: vooruit = maandag van deze week + 8 weken, terug = 28 dagen t/m gisteren', () => {
    assert.deepStrictEqual(V, { van: '2026-11-02', tot: '2026-12-27', weken: 8 });
    assert.deepStrictEqual(C.vensterTerug(VANDAAG), { van: '2026-10-07', tot: '2026-11-03' });
  });

  await test('zonderSchatting: telt open taken zonder raming per project; klaar, mijlpaal en vervallen tellen niet', () => {
    const taken = {
      P1: [{ id: 't1', naam: 'Een', duur_uur: 0, toegewezen: 'anna' }, { id: 't2', naam: 'Twee', duur_uur: 3 }, { id: 't3', naam: 'Drie', status: 'klaar' }, { id: 't4', naam: 'Mijlpaal', soort: 'mijlpaal' }, { id: 't5', naam: 'Weg', _vervallen: true }, { id: 't6', naam: 'Zes', budget_min: 90 }, { id: 't7', naam: 'Zeven', status: 'bezig' }],
      P2: [{ id: 'u1', naam: 'Uno' }],
      P3: [{ id: 'v1', naam: 'Klaar', duur_uur: 1 }],
      __meta: [{ id: 'x' }],
    };
    const r = C.zonderSchatting({ taken, projecten: [{ code: 'P1', label: 'Project een' }], team: TEAM, planning: P });
    assert.strictEqual(r.totaal, 3);
    assert.deepStrictEqual(r.groepen.map(g => [g.code, g.label, g.aantal]), [['P1', 'Project een', 2], ['P2', 'P2', 1]]);
    assert.deepStrictEqual(r.groepen[0].taken.map(t => t.id), ['t1', 't7']);
    assert.strictEqual(r.groepen[0].taken[0].persoon, 'anna');
  });

  await test('zonderSchatting: lege of ontbrekende gegevens geven 0', () => {
    assert.strictEqual(C.zonderSchatting({ planning: P }).totaal, 0);
    assert.strictEqual(C.zonderSchatting({ taken: { P1: 'geen lijst' }, planning: P }).totaal, 0);
  });

  await test('gebruikers: inactieve gebruiker met werkuren wordt gevonden; actieve niet', () => {
    const users = [{ id: 1, naam: 'Anna', email: 'anna@mortiseandtenon.nl', actief: true }, { id: 2, naam: 'Oud', email: 'oud@mortiseandtenon.nl', actief: false }];
    const g = C.gebruikers({ users, cap: { 1: vensterDagen(8), 2: vensterDagen(8) }, team: TEAM, werkuren: { anna: 40 }, verlof: [], vandaag: VANDAAG, planning: P });
    assert.deepStrictEqual(g.inactief.map(x => [x.id, x.uren]), [[2, 320]]);
    assert.strictEqual(g.statusOnbekend, false);
    assert.strictEqual(g.afwijkend.length, 0);
  });

  await test('gebruikers: inactief zonder werkuren is geen bevinding; onbekende status wordt gemeld', () => {
    const g = C.gebruikers({ users: [{ id: 2, naam: 'Oud', actief: false }], cap: { 2: vensterDagen(0) }, team: TEAM, vandaag: VANDAAG, planning: P });
    assert.strictEqual(g.inactief.length, 0);
    const h = C.gebruikers({ users: [{ id: 1, naam: 'Anna', email: 'anna@mortiseandtenon.nl', actief: null }], cap: { 1: vensterDagen(8) }, team: TEAM, werkuren: { anna: 40 }, vandaag: VANDAAG, planning: P });
    assert.strictEqual(h.statusOnbekend, true);
  });

  await test('gebruikers: zonder werkuren en afwijkende werkuren (per week gemiddeld, tolerantie 1,5 u)', () => {
    const users = [{ id: 1, naam: 'Anna', email: 'anna@mortiseandtenon.nl', actief: true }, { id: 3, naam: 'Bas', email: 'bas@mortiseandtenon.nl', actief: true }, { id: 4, naam: 'Carla', email: 'carla@mortiseandtenon.nl', actief: true }, { id: 5, naam: 'Dirk', email: 'dirk@mortiseandtenon.nl', actief: true }];
    const g = C.gebruikers({ users, cap: { 1: vensterDagen(8), 3: vensterDagen(6), 4: vensterDagen(0), 5: vensterDagen(0) }, team: TEAM, werkuren: { anna: 40, bas: 40, carla: 32 }, verlof: [], vandaag: VANDAAG, planning: P });
    assert.deepStrictEqual(g.zonderWerkuren.map(x => x.id), [4, 5]);
    assert.deepStrictEqual(g.afwijkend.map(x => [x.id, x.toggl, x.beheer]), [[3, 30, 40]]);
    const klein = C.gebruikers({ users: [users[0]], cap: { 1: vensterDagen(7.8) }, team: TEAM, werkuren: { anna: 40 }, vandaag: VANDAAG, planning: P });
    assert.strictEqual(klein.afwijkend.length, 0);   // 39 u/week tegenover 40: binnen de tolerantie
  });

  await test('gebruikers: verlof uit Beheer dat niet in de Toggl-capaciteit zit', () => {
    const users = [{ id: 1, naam: 'Anna', email: 'anna@mortiseandtenon.nl', actief: true }, { id: 3, naam: 'Bas', email: 'bas@mortiseandtenon.nl', actief: true }];
    const verlof = [{ persoon: 'anna', van: '2026-11-09', tm: '2026-11-13' }, { persoon: 'bas', van: '2026-11-09', tm: '2026-11-10' }];
    // Anna: Toggl telt de week gewoon als werk (mist); Bas: Toggl heeft verlof al meegenomen (werk 0 of verlof > 0)
    const capAnna = vensterDagen(8), capBas = vensterDagen(8, { '2026-11-09': { werk: 0, verlof: 8 }, '2026-11-10': { werk: 8, verlof: 8 } });
    const g = C.gebruikers({ users, cap: { 1: capAnna, 3: capBas }, team: TEAM, werkuren: { anna: 40, bas: 40 }, verlof, vandaag: VANDAAG, planning: P });
    assert.deepStrictEqual(g.verlofMist.map(x => [x.id, x.dagen, x.eerste, x.laatste]), [[1, 5, '2026-11-09', '2026-11-13']]);
  });

  await test('gebruikers: verlof in het verleden of in het weekend telt niet; gebruiker zonder capaciteitsantwoord wordt apart gemeld', () => {
    const users = [{ id: 1, naam: 'Anna', email: 'anna@mortiseandtenon.nl', actief: true }, { id: 9, naam: 'Zonder', actief: true }];
    const verlof = [{ persoon: 'anna', van: '2026-11-02', tm: '2026-11-03' }, { persoon: 'anna', van: '2026-11-07', tm: '2026-11-08' }];
    const g = C.gebruikers({ users, cap: { 1: vensterDagen(8) }, fouten: { 9: '402' }, team: TEAM, werkuren: { anna: 40 }, verlof, vandaag: VANDAAG, planning: P });
    assert.strictEqual(g.verlofMist.length, 0);
    assert.deepStrictEqual(g.geenCapaciteit, [{ id: 9, naam: 'Zonder', code: '402' }]);
  });

  await test('teamLid: op e-mail, anders op voornaam; plaatshouders tellen niet', () => {
    assert.strictEqual(C.teamLid({ email: 'BAS@mortiseandtenon.nl' }, TEAM).slug, 'bas');
    assert.strictEqual(C.teamLid({ naam: 'Carla Jansen', email: 'ander@mortiseandtenon.nl' }, TEAM).slug, 'carla');
    assert.strictEqual(C.teamLid({ naam: 'Plaats' }, TEAM), null);
  });

  await test('urenZonderKoppeling: percentage per persoon en totaal; alleen "geen project en geen taak" telt', () => {
    const rijen = [
      { user: 1, project: 'p', taak: 't', sec: 3600 * 4 }, { user: 1, project: null, taak: null, sec: 3600 }, { user: 1, project: 'p', taak: null, sec: 3600 * 5 },
      { user: 3, project: null, taak: null, sec: 3600 * 3 }, { user: 3, project: 'p', taak: 't', sec: 3600 },
      { user: 7, project: null, taak: null, sec: 0 },
    ];
    const users = [{ id: 1, naam: 'Anna', email: 'anna@mortiseandtenon.nl' }, { id: 3, naam: 'Bas', email: 'bas@mortiseandtenon.nl' }];
    const r = C.urenZonderKoppeling({ rijen, users, team: TEAM });
    assert.deepStrictEqual(r.personen.map(p => [p.naam, p.pct, p.boven]), [['Bas', 75, true], ['Anna', 10, false]]);
    assert.strictEqual(r.totaalUur, 14);
    assert.strictEqual(r.zonderUur, 4);
    assert.strictEqual(r.pct, 29);
    assert.ok(!JSON.stringify(r).includes('omschrijving'));
  });

  await test('urenZonderKoppeling: geen uren = lege uitkomst; onbekende gebruiker krijgt een neutrale naam', () => {
    assert.deepStrictEqual(C.urenZonderKoppeling({ rijen: [], users: [] }), { totaalUur: 0, zonderUur: 0, pct: 0, personen: [] });
    const r = C.urenZonderKoppeling({ rijen: [{ user: 99, project: null, taak: null, sec: 7200 }], users: [], team: TEAM });
    assert.strictEqual(r.personen[0].naam, 'Onbekende gebruiker');
  });

  await test('controles en telling: alleen berekende controles tellen mee; nog niets geladen = geen tekst', () => {
    const a = { totaal: 3, groepen: [] };
    const leeg = C.telling({ a: { totaal: 0, groepen: [] } });
    assert.deepStrictEqual([leeg.controles, leeg.metBevinding, leeg.tekst], [1, 0, '']);
    const g = { inactief: [{}], zonderWerkuren: [{}], afwijkend: [], verlofMist: [], geenCapaciteit: [], statusOnbekend: false };
    const u = { personen: [{ boven: true }, { boven: false }], totaalUur: 1, zonderUur: 1, pct: 100 };
    const t = C.telling({ a, g, u });
    assert.deepStrictEqual([t.controles, t.metBevinding, t.totaal], [4, 4, 3 + 1 + 1 + 1]);
    assert.ok(/4 controles/.test(t.tekst));
    assert.strictEqual(C.controles({ a }).filter(c => c.gereed).length, 1);
    assert.strictEqual(C.controles({ a })[1].aantal, null);
  });

  // ── mt-toggl.js: de lezers die de controle gebruikt (functies uit het klassieke script, met een nagebootste omgeving) ──
  const ctx = { console, JSON, Date, Promise, Math, Number, String, Array, Object, isFinite, sessionStorage: { getItem: () => null, setItem: () => {} }, window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'mt-toggl.js'), 'utf8'), ctx);

  await test('tgUserActief: herkent de gangbare velden; zonder veld null (niet raden)', () => {
    const f = ctx.tgUserActief;
    assert.strictEqual(f({ active: false }), false);
    assert.strictEqual(f({ is_active: false }), false);
    assert.strictEqual(f({ status: 'Deactivated' }), false);
    assert.strictEqual(f({ inactive_at: '2026-06-01' }), false);
    assert.strictEqual(f({ active: true }), true);
    assert.strictEqual(f({ status: 'active' }), true);
    assert.strictEqual(f({ email: 'nep@mortiseandtenon.nl' }), null);
    assert.strictEqual(f(null), null);
  });

  await test('_tgCapLees: neemt verlof (time_off_minutes) mee; ontbrekend verlof wordt null, geen 0', () => {
    const d = [{ id: 5, type: 'user', computations: [{ date: '2026-11-09', working_minutes: 480, estimated_minutes: 60, time_off_minutes: 480 }, { date: '2026-11-10', working_minutes: 480, estimated_minutes: 0 }] }];
    const r = ctx._tgCapLees(d, 5);
    assert.strictEqual(r['2026-11-09'].verlof, 8);
    assert.strictEqual(r['2026-11-09'].werk, 8);
    assert.strictEqual(r['2026-11-10'].verlof, null);
    assert.strictEqual(r['2026-11-10'].vrij, 8);
  });

  console.log('\n' + n + ' tests geslaagd' + (process.exitCode ? ' (met fouten)' : ''));
})();

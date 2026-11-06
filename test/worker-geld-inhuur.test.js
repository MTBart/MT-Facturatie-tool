// Worker-test: vaste inhuur apart in Cijfers (categorie inhuur: factuurregels van één leverancier op ingestelde grootboeken tellen als arbeid).
// Draaien: node test/worker-geld-inhuur.test.js  — verzonnen id's, namen en bedragen; Moneybird en KV worden nagebootst.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8') + '\nexport { geldCijfersRoute, geldCijferReeksen, geldCijferCfgNorm, geldCijferIndeling, GELD_CATS };\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-inhuur-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let W; try { W = await import(pathToFileURL(tmp).href); } finally { try { fs.unlinkSync(tmp); } catch { } }
  const Y = String(new Date().getFullYear() - 1), M3 = `${Y}-03`, M4 = `${Y}-04`;
  const LD = '700200', LM = '700100', LK = '700300', LO = '800100', CA = '555555', CB = '666666';   // dienst, materiaal, kantoor, omzet; vaste leverancier, andere leverancier
  const ledgerLijst = [{ id: LD, name: 'Inkoop diensten', account_type: 'direct_costs' }, { id: LM, name: 'Inkoop materiaal', account_type: 'direct_costs' },
    { id: LK, name: 'Kantoorkosten', account_type: 'expenses' }, { id: LO, name: 'Omzet', account_type: 'revenue' }];
  const facturen = [
    { id: '9001', contact_id: CA, contact: { id: CA, company_name: 'Leverancier A' }, date: `${M3}-10`, state: 'paid', reference: 'A-1', details: [{ ledger_account_id: LD, total_price_excl_tax_with_discount_base: '1000.00' }, { ledger_account_id: LM, total_price_excl_tax_with_discount_base: '200.00' }, { ledger_account_id: LK, total_price_excl_tax_with_discount_base: '50.00' }] },
    { id: '9002', contact_id: CB, contact: { id: CB, company_name: 'Leverancier B' }, date: `${M3}-12`, state: 'open', reference: 'B-1', details: [{ ledger_account_id: LD, total_price_excl_tax_with_discount_base: '400.00' }] },
    { id: '9003', contact_id: CA, contact: { id: CA, company_name: 'Leverancier A' }, date: `${M3}-20`, state: 'open', reference: 'A-CN', details: [{ ledger_account_id: LD, total_price_excl_tax_with_discount_base: '-100.00' }] },
    { id: '9004', contact_id: CA, contact: { id: CA, company_name: 'Leverancier A' }, date: `${M4}-05`, state: 'late', reference: 'A-2', details: [{ ledger_account_id: LD, total_price_excl_tax_with_discount_base: '800.00' }] },
    { id: '9005', contact_id: CA, contact: { id: CA, company_name: 'Leverancier A' }, date: `${M4}-06`, state: 'new', reference: 'A-concept', details: [{ ledger_account_id: LD, total_price_excl_tax_with_discount_base: '999.00' }] },   // concept telt niet
  ];
  // W&V per maand: dienst = A + B + creditnota; materiaal = alleen de regel van A; kantoor = alleen de regel van A
  const wv = { [M3]: { [LD]: 1300, [LM]: 200, [LK]: 50 }, [M4]: { [LD]: 800 } };
  const maakOmgeving = (cijfers, opties = {}) => {
    const m = new Map(); const tel = { fact: 0, ink: [] };
    if (cijfers !== undefined) m.set('geld:config', JSON.stringify({ cijfers: Object.assign({ correctie_van: '2099-12' }, cijfers) }));
    const kv = { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } };
    const fetchNep = async url => {
      const u = decodeURIComponent(String(url)), ok = x => ({ ok: true, status: 200, headers: new Map(), json: async () => x, text: async () => JSON.stringify(x) });
      if (u.includes('ledger_accounts')) return ok(ledgerLijst);
      let mm = /reports\/profit_loss\?period=(\d{4})(\d{2})/.exec(u);
      if (mm) { const r = wv[`${mm[1]}-${mm[2]}`] || {}, tot = Object.values(r).reduce((a, x) => a + x, 0), omzet = r[LD] ? 5000 : 0;
        return ok({ total_revenue: String(omzet), net_profit: String(omzet - tot), gross_profit: '0', revenue_by_ledger_account: { ledger_accounts: omzet ? [{ ledger_account_id: LO, value: String(omzet) }] : [] },
          direct_costs_by_ledger_account: { ledger_accounts: [LD, LM].filter(l => r[l]).map(l => ({ ledger_account_id: l, value: String(r[l]) })) }, expenses_by_ledger_account: { ledger_accounts: r[LK] ? [{ ledger_account_id: LK, value: String(r[LK]) }] : [] } }); }
      if (u.includes('reports/balance_sheet')) return ok({});
      if (u.includes('financial_mutations') || u.includes('documents/receipts')) return ok([]);
      if (u.includes('documents/purchase_invoices')) {
        tel.ink.push(u);
        if (opties.inkoopFout) return { ok: false, status: 500, headers: new Map(), json: async () => ({}), text: async () => '{"error":"kapot"}' };
        const per = /period:(\d{8})\.\.(\d{8})/.exec(u), c = /contact_id:(\d+)/.exec(u);
        const van = per[1].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), tot = per[2].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        return ok(facturen.filter(f => f.date >= van && f.date <= tot && (opties.negeerContactfilter || !c || f.contact_id === c[1])));
      }
      return ok([]);
    };
    return { env: { MT_ROLLEN: kv, MONEYBIRD_KEY: 'test' }, m, tel, fetchNep };
  };
  const json = (x, s) => ({ s: s || 200, x });
  const R = { geld: 'wijzigen' };
  const route = async (o, pad, vraag) => { globalThis.fetch = o.fetchNep; return await W.geldCijfersRoute(pad, o.env, new URL('https://x' + pad + '?' + vraag), R, json); };
  const hoofd = (o, per = 'maand') => route(o, '/geld/cijfers', `per=${per}&van=${Y}-03&tot=${Y}-04`);
  const P = (r, id) => r.x.perioden.find(p => p.id === id);
  const aan = { inhuur: { contact_id: CA, ledgers: [LD] } };
  let n = 0; const ok = t => { n++; console.log('ok  - ' + t); };

  // 1. instelling uit = zoals nu
  const uit = maakOmgeving({}), ru = await hoofd(uit);
  assert.strictEqual(ru.s, 200); assert.deepStrictEqual(ru.x.inhuur, { aan: false });
  assert.strictEqual(P(ru, M3).kosten.inhuur, 0, 'zonder instelling is inhuur 0'); assert.strictEqual(P(ru, M3).kosten.uitbesteed, 1300);
  assert.strictEqual(uit.tel.ink.length, 0, 'zonder instelling geen extra Moneybird-verzoeken voor inhuur');
  assert.ok(ru.x.categorieen.some(c => c.id === 'inhuur' && c.naam === 'Vaste inhuur')); assert.ok(ru.x.compleet);
  ok('instelling uit: inhuur 0, uitbesteed ongewijzigd, geen extra verzoeken');

  // 2. instelling aan
  const an = maakOmgeving(aan), ra = await hoofd(an);
  assert.strictEqual(ra.s, 200); assert.ok(ra.x.compleet, JSON.stringify(ra.x.waarschuwingen));
  const a3 = P(ra, M3), u3 = P(ru, M3);
  assert.strictEqual(a3.kosten.inhuur, 900, 'factuur 1000 + creditnota -100 op het ingestelde grootboek van de vaste leverancier');
  assert.strictEqual(a3.kosten.uitbesteed, 400, 'andere leverancier op hetzelfde grootboek blijft uitbesteed');
  assert.strictEqual(a3.kosten.materiaal, 200, 'regel van de vaste leverancier op een ander grootboek blijft in zijn categorie'); assert.strictEqual(a3.kosten.kantoor, 50);
  assert.strictEqual(a3.kosten_totaal, u3.kosten_totaal, 'totaal kosten gelijk'); assert.strictEqual(a3.resultaat, u3.resultaat, 'resultaat gelijk'); assert.strictEqual(a3.wijkt_af, u3.wijkt_af);
  assert.strictEqual(a3.brutomarge, u3.brutomarge + 900, 'brutomarge stijgt met de verschoven inhuur'); assert.ok(a3.brutomarge_pct > u3.brutomarge_pct);
  const a4 = P(ra, M4); assert.strictEqual(a4.kosten.inhuur, 800, 'concept-factuur telt niet'); assert.strictEqual(a4.kosten.uitbesteed, 0);
  assert.deepStrictEqual(ra.x.inhuur, { aan: true, onvolledig: [], afwijkingen: [] });
  ok('instelling aan: alleen contact + grootboek verschuift, creditnota telt, totaal/resultaat gelijk, brutomarge stijgt');

  // 3. per jaar en cache
  const rj = await route(an, '/geld/cijfers', `per=jaar&van=${Y}-03&tot=${Y}-04`);
  assert.strictEqual(rj.x.perioden[0].kosten.inhuur, 1700); assert.strictEqual(an.tel.ink.length, 1, 'het jaar staat in de eigen cache: geen tweede verzoek');
  assert.ok(an.m.has(`geld:cijfers:inhuur:${Y}`)); const c = JSON.parse(an.m.get(`geld:cijfers:inhuur:${Y}`)); assert.deepStrictEqual(c.maanden, { '03': { [LD]: 900 }, '04': { [LD]: 800 } });
  ok('jaarcache: één verzoek per jaar, daarna uit KV');

  // 4. wijziging van de instelling laat de cache vervallen; defensief tegen een genegeerd contactfilter
  an.m.set('geld:config', JSON.stringify({ cijfers: { correctie_van: '2099-12', inhuur: { contact_id: CA, ledgers: [LD, LM] } } }));
  const rw = await hoofd(an); assert.strictEqual(P(rw, M3).kosten.inhuur, 1100, 'nu ook materiaalregel van de vaste leverancier'); assert.strictEqual(P(rw, M3).kosten.materiaal, 0); assert.strictEqual(an.tel.ink.length, 2);
  assert.strictEqual(P(rw, M3).kosten_totaal, u3.kosten_totaal);
  const ng = maakOmgeving(aan, { negeerContactfilter: true }), rn = await hoofd(ng); assert.strictEqual(P(rn, M3).kosten.inhuur, 900, 'regels van een ander contact tellen nooit mee');
  ok('cache vervalt bij nieuwe grootboeken; ander contact nooit meegeteld');

  // 5. onvolledig = geen verschuiving, waarschuwing, niet opslaan
  const kapot = maakOmgeving(aan, { inkoopFout: true }), rk = await hoofd(kapot);
  assert.strictEqual(P(rk, M3).kosten.inhuur, 0); assert.strictEqual(P(rk, M3).kosten.uitbesteed, 1300, 'niets half verschoven'); assert.strictEqual(rk.x.compleet, false);
  assert.ok(rk.x.waarschuwingen.some(w => w.onvolledig && /vaste inhuur/.test(w.bron))); assert.deepStrictEqual(rk.x.inhuur.onvolledig, [Y]); assert.ok(!kapot.m.has(`geld:cijfers:inhuur:${Y}`));
  ok('onvolledige lijst: geen verschuiving, waarschuwing met onvolledig, niet opgeslagen');

  // 6. detail
  const d = async (o, cat, ym = M3) => (await route(o, '/geld/cijfers/detail', `maand=${ym}&reeks=kosten&categorie=${cat}`)).x;
  const an2 = maakOmgeving(aan); await hoofd(an2);   // eerst de maandrecords vullen
  const d1 = await d(an2, 'inhuur'); assert.deepStrictEqual(d1.items.map(x => x.bedrag).sort((a, b) => a - b), [-100, 1000]); assert.strictEqual(d1.som, 900); assert.strictEqual(d1.totaal_wv, 900); assert.strictEqual(d1.rest, 0);
  const d2 = await d(an2, 'uitbesteed'); assert.deepStrictEqual(d2.items.map(x => x.bedrag), [400]); assert.strictEqual(d2.totaal_wv, 400); assert.strictEqual(d2.rest, 0, 'uitbesteed toont de regels van de vaste leverancier niet meer');
  const d3 = await d(an2, 'materiaal'); assert.strictEqual(d3.som, 200); assert.strictEqual(d3.rest, 0);
  const d4 = await d(maakOmgeving({}), 'inhuur'); assert.deepStrictEqual(d4.items, []);
  const dz = maakOmgeving({}); await hoofd(dz); const d5 = await d(dz, 'uitbesteed'); assert.strictEqual(d5.som, 1300); assert.strictEqual(d5.rest, 0, 'instelling uit: detail zoals nu');
  ok('detail: inhuur, rest-categorie en instelling uit kloppen (som = totaal_wv, rest 0)');

  // 7. reeksen met oude/ontbrekende inhuurdata, en negatieve categorie blijft kloppen
  const ledgers = { [LD]: { naam: 'Inkoop diensten', soort: 'direct_costs' }, [LM]: { naam: 'Inkoop materiaal', soort: 'direct_costs' } };
  const cc = W.geldCijferCfgNorm({ correctie_van: '2099-12', inhuur: { contact_id: CA, ledgers: [LD] } }), idl = W.geldCijferIndeling(ledgers, cc);
  const recs = { [M3]: { omzet: { [LO]: 5000 }, kosten: { [LD]: 300, [LM]: 100 }, mb: { resultaat: 4600 }, v: 2 } };
  const zonder = W.geldCijferReeksen(recs, [M3], 'maand', idl, ledgers, cc, {}, undefined).perioden[0];
  assert.strictEqual(zonder.kosten.inhuur, 0); assert.strictEqual(zonder.kosten.uitbesteed, 300);
  const neg = W.geldCijferReeksen(recs, [M3], 'maand', idl, ledgers, cc, {}, { maand: { [M3]: { [LD]: 500 } }, onvolledig: new Set() });
  assert.strictEqual(neg.perioden[0].kosten.uitbesteed, -200, 'niet afkappen'); assert.strictEqual(neg.perioden[0].kosten.inhuur, 500); assert.strictEqual(neg.perioden[0].kosten_totaal, 400); assert.strictEqual(neg.perioden[0].resultaat, 4600);
  assert.strictEqual(neg.inhuur_afwijkingen.length, 1, 'meer factuurregels dan W&V wordt gemeld');
  ok('oude data zonder inhuur crasht niet; negatieve categorie wordt niet afgekapt en meldt de afwijking');

  // 8. configuratie
  assert.strictEqual(W.geldCijferCfgNorm({ inhuur: { contact_id: 'abc', ledgers: [LD] } }).inhuur, null); assert.strictEqual(W.geldCijferCfgNorm({ inhuur: { contact_id: CA, ledgers: ['x'] } }).inhuur, null);
  assert.deepStrictEqual(W.geldCijferCfgNorm({ inhuur: { contact_id: CA, ledgers: [LD, LD, LM], naam: ' X ' } }).inhuur, { contact_id: CA, ledgers: [LD, LM], naam: 'X' });
  assert.deepStrictEqual(W.geldCijferCfgNorm({ map: { [LD]: 'inhuur', [LM]: 'materiaal' }, benchmarks: { inhuur: { pct: 3 } } }).map, { [LM]: 'materiaal' }); assert.strictEqual(W.geldCijferCfgNorm({ benchmarks: { inhuur: { pct: 3 } } }).benchmarks.inhuur, undefined);
  assert.strictEqual(W.geldCijferCfgNorm(null).inhuur, null);
  assert.ok(W.GELD_CATS.findIndex(x => x[0] === 'inhuur') === W.GELD_CATS.findIndex(x => x[0] === 'personeel') + 1);
  ok('configuratie: validatie, uniek, begrensd; inhuur niet via indeling of branche');

  console.log(`\n${n} tests geslaagd`);
})().catch(e => { console.log('FOUT - ' + (e.stack || e)); process.exitCode = 1; });

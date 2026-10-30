// Worker-test: bankhistorie per maand (maand_partij) in de nachtelijke patronenberekening, voor de Forecast (voorbije maanden exact uit de bank).
// Draaien: node test/worker-geld-historie.test.js  — verzonnen namen en bedragen; Moneybird wordt nagebootst.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8') + '\nexport { geldPatronenBereken };\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-historie-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let geldPatronenBereken; try { ({ geldPatronenBereken } = await import(pathToFileURL(tmp).href)); } finally { try { fs.unlinkSync(tmp); } catch { } }
  const kv = () => { const m = new Map(); return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async list() { return { keys: [], list_complete: true }; } }; };
  const d = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const muts = [
    { id: '1', date: d(40), amount: '-1000.00', contra_account_name: 'Houthandel Test', contra_account_number: 'REK1', payments: [{ invoice_id: '9', invoice_type: 'Document' }] },
    { id: '2', date: d(40), amount: '-250.50', contra_account_name: 'Houthandel Test', contra_account_number: 'REK1' },
    { id: '3', date: d(40), amount: '5000.00', contra_account_name: 'Klant Test', contra_account_number: 'REK2', payments: [{ invoice_id: '8', invoice_type: 'SalesInvoice' }] },
    { id: '4', date: d(40), amount: '-900.00', contra_account_name: 'Belastingdienst', contra_account_number: 'REK3', message: 'btw aangifte kwartaal 3 2026' },
    { id: '5', date: d(40), amount: '-300.00', contra_account_name: 'Belastingdienst', contra_account_number: 'REK3', payments: [{ invoice_id: '7', invoice_type: 'VatDocument' }] },
    { id: '6', date: d(40), amount: '-2000.00', contra_account_name: 'Spaarrekening', contra_account_number: 'REK4' },
    { id: '7', date: d(40), amount: '-75.00', contra_account_name: '', contra_account_number: 'REK5' },
  ];
  globalThis.fetch = async url => {
    const u = String(url), json = x => ({ ok: true, status: 200, headers: new Map(), json: async () => x, text: async () => JSON.stringify(x) });
    if (u.includes('financial_mutations')) { const m = /period:(\d{8})\.\.(\d{8})/.exec(decodeURIComponent(u)); const a = m[1].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), b = m[2].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      return json(muts.filter(x => x.date >= a && x.date <= b)); }
    return json([]);
  };
  const r = await geldPatronenBereken({ MT_ROLLEN: kv(), MONEYBIRD_KEY: 'test' });
  const ym = d(40).slice(0, 7), mp = r.maand_partij && r.maand_partij[ym];
  assert.ok(mp, 'maand_partij voor ' + ym);
  assert.deepStrictEqual(mp.uit, { 'Houthandel Test': 1250.5 }, 'uitgaven per tegenpartij; btw, spaar en zonder naam (intern vermoed) niet');
  assert.strictEqual(mp.btw, 1200, 'btw-aangifte via tekst en via btw-document');
  assert.strictEqual(mp.in, 5000, 'ontvangsten');
  console.log('ok  - maand_partij: uitgaven per tegenpartij, btw apart, ontvangsten, spaar/intern eruit\n\n1 test geslaagd');
})().catch(e => { console.log('FOUT - ' + (e.stack || e)); process.exitCode = 1; });

#!/usr/bin/env node
// F7: draait ALLE sink-baselines op de bronbestanden en eindigt met een non-zero exitcode bij een afwijking.
//   node tools/check-sinks.js [--root <map>] [--stil]
// Het script wordt aangeroepen door githooks/pre-commit (bij gewijzigde .html/.js/tools/*.json) en is een verplichte stap in RELEASE.md.
// Wat het controleert (zie ook tools/sinkscan.js en REPO-VEILIGHEID.md):
//   1. groepen (tools/sinks-groepen.js): elke ruwe ${...}-interpolatie in een gedekt bestand staat met reden in de houd-lijst; geen verouderde regels;
//   2. bestanden met ruwe interpolaties die in geen groep zitten: alleen die in tools/sinks-nog-open.json (en die lijst mag niet verouderen);
//   3. plakwerk (HTML met + aan een variabele geplakt)  -> tools/plakwerk-baseline.json;
//   4. links uit data (href/src direct een interpolatie) -> tools/url-sinks-baseline.json;
//   5. interpolaties in on*-attributen buiten jsArg/ja/ibJa/_ctlArg/jsLit/Number -> tools/handler-baseline.json;
//   6. verboden patronen: .replace(/"/g,'&quot;') op een waarde die & niet eerst escapet, en ${JSON.stringify(...)} direct in een on*-attribuut.
const fs = require('fs'), path = require('path');
const S = require('./sinkscan.js');
const args = process.argv.slice(2), stil = args.includes('--stil');
const ri = args.indexOf('--root'), ROOT = ri >= 0 ? path.resolve(args[ri + 1]) : path.join(__dirname, '..');
const lees = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const json = f => JSON.parse(lees(f));
const bestanden = fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f) && !/^(worker|sw)\.js$/.test(f));
const fouten = [], waarsch = [];
const fout = (cat, tekst) => fouten.push(`[${cat}] ${tekst}`);

// 1. groepen -----------------------------------------------------------------------------------------------------------------------------
const GROEPEN = require(path.join(ROOT, 'tools', 'sinks-groepen.js'));
const gedekt = new Set();
for (const [naam, g] of Object.entries(GROEPEN)) {
  gedekt.add(g.bestand);
  let tx; try { tx = lees(g.bestand); } catch (e) { fout('groep ' + naam, g.bestand + ' niet te lezen'); continue; }
  const isHtml = /\.html$/.test(g.bestand);
  const items = S.letOpInGroep(tx, isHtml, g), lijst = g.houd.concat(g.overslaan || []);
  const nietGedekt = items.filter(i => !lijst.some(e => S.dekt(e, i)));
  for (const i of nietGedekt.slice(0, 8)) fout('groep ' + naam, `ruwe interpolatie zonder reden: ${g.bestand} r${i.regel} ${i.fn} (${i.ctx}) ${i.expr.slice(0, 80)}`);
  if (nietGedekt.length > 8) fout('groep ' + naam, `… en nog ${nietGedekt.length - 8} meer`);
  for (const e of lijst.filter(e => !items.some(i => S.dekt(e, i))).slice(0, 8)) fout('groep ' + naam, `verouderde uitzondering: ${e.fn} | ${e.expr || e.exprBegin}`);
  for (const e of lijst.filter(e => !e.reden || String(e.reden).length <= 8).slice(0, 5)) fout('groep ' + naam, `uitzondering zonder reden: ${e.fn} | ${e.expr || e.exprBegin}`);
  const r = S.scanBestand(tx, isHtml, { veiligeFns: g.veiligeFns, fragmentFns: g.fragmentFns });
  if (r.fouten.length) fout('groep ' + naam, `${g.bestand}: ${r.fouten.length} tokenizerfout(en) — de scanner leest het bestand niet goed`);
}

// 2. bestanden zonder groep --------------------------------------------------------------------------------------------------------------
let nogOpen = []; try { nogOpen = json('tools/sinks-nog-open.json').bestanden; } catch (e) { fout('nog-open', 'tools/sinks-nog-open.json ontbreekt of is kapot'); }
const nogSet = new Set(nogOpen.map(x => x.bestand));
for (const f of bestanden) {
  if (gedekt.has(f)) continue;
  let n = 0; try { n = S.scanBestand(lees(f), /\.html$/.test(f), {}).items.filter(i => i.klasse === 'let-op').length; } catch (e) { continue; }
  if (n && !nogSet.has(f)) fout('nog-open', `${f} heeft ${n} ruwe interpolaties maar zit in geen groep (maak een groep in tools/sinks-groepen.js)`);
  else if (n) waarsch.push(`${f}: ${n} ruwe interpolaties, nog niet door 3b (tools/sinks-nog-open.json)`);
}
for (const x of nogOpen) {
  if (gedekt.has(x.bestand)) fout('nog-open', `${x.bestand} zit nu in een groep: haal hem uit tools/sinks-nog-open.json`);
  else if (!bestanden.includes(x.bestand)) fout('nog-open', `${x.bestand} bestaat niet meer: haal hem uit tools/sinks-nog-open.json`);
}

// 3. plakwerk, 4. url-sinks, 5. handlers --------------------------------------------------------------------------------------------------
function vergelijk(cat, baselineFile, nu, sleutelVan, reden) {
  let b; try { b = json(baselineFile).regels; } catch (e) { return fout(cat, baselineFile + ' ontbreekt of is kapot'); }
  const sl = new Set(b.map(sleutelVan)), nuSet = new Set(nu);
  const nieuw = nu.filter(x => !sl.has(x)), oud = [...sl].filter(x => !nuSet.has(x));
  for (const x of nieuw.slice(0, 6)) fout(cat, `niet beoordeeld: ${x.slice(0, 160)}`);
  if (nieuw.length > 6) fout(cat, `… en nog ${nieuw.length - 6} meer`);
  for (const x of oud.slice(0, 6)) fout(cat, `verouderd in ${baselineFile}: ${x.slice(0, 160)}`);
  if (reden) for (const e of b.filter(x => !x.reden || x.reden === 'ONBEOORDEELD' || String(x.reden).length < 10).slice(0, 5)) fout(cat, `geen reden in ${baselineFile}: ${sleutelVan(e).slice(0, 120)}`);
}
const nuPlak = [], nuUrl = [], nuHandler = new Set();
for (const f of bestanden) {
  const tx = lees(f);
  for (const x of S.plakwerk(tx)) nuPlak.push(f + '|' + x.tekst);
  for (const x of S.urlSinks(tx)) nuUrl.push(f + '|' + x.expr);
  try { for (const x of S.handlerCtx(tx, /\.html$/.test(f))) nuHandler.add(f + '|' + x.expr); } catch (e) { /* bestand zonder templates */ }
}
vergelijk('plakwerk', 'tools/plakwerk-baseline.json', nuPlak, x => x.bestand + '|' + x.tekst, false);
vergelijk('url-sinks', 'tools/url-sinks-baseline.json', nuUrl, x => x.bestand + '|' + x.expr, true);
vergelijk('handlers', 'tools/handler-baseline.json', [...nuHandler], x => x.bestand + '|' + x.expr, true);

// 6. verboden patronen -------------------------------------------------------------------------------------------------------------------
for (const f of bestanden) lees(f).split('\n').forEach((l, i) => {
  if (/\.replace\(\s*\/"\/g\s*,\s*['"]&quot;['"]\s*\)/.test(l) && !/replace\(\/&\/g,'&amp;'\)\.replace\(\/"\/g,'&quot;'\)/.test(l))
    fout('patroon', `${f}:${i + 1} .replace(/"/g,'&quot;') zonder eerst & te escapen (de browser decodeert &quot; terug, ook in een JS-tekenreeks): gebruik esc()/jsArg()`);
  if (/on[a-z]+=\\?"[^"\n]*\$\{\s*JSON\.stringify\(/.test(l)) fout('patroon', `${f}:${i + 1} \${JSON.stringify(...)} direct in een on*-attribuut: gebruik jsArg()/ja()`);
});

// uitvoer ----------------------------------------------------------------------------------------------------------------------------------
if (!stil) for (const w of waarsch) console.log('  let op:', w);
if (fouten.length) {
  console.log(`\n🛑 check-sinks: ${fouten.length} afwijking(en)`);
  for (const f of fouten) console.log('  ' + f);
  console.log('\n  Beoordeel de plek (esc()/jsArg()/veiligeLink() gebruiken, of bewust documenteren met reden in tools/sinks-groep-*.json of de baselines) en draai opnieuw.');
  process.exit(1);
}
if (!stil) console.log(`✓ check-sinks: groepen (${Object.keys(GROEPEN).length}), plakwerk, url-sinks, handlers en verboden patronen in orde (${bestanden.length} bestanden)`);

// Bart 6-11: Rapporten op de plek van Financiën, de tabknop Financiën alleen voor Bart.
const assert = require('assert'), fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const v2 = rd('v2.html'), mob = rd('mobiel.html'), zb = rd('mt-zijbalk.js'), cij = rd('mt-cijfers.js');
let n = 0; const t = (naam, f) => { f(); n++; console.log('ok - ' + naam); };
t('Rapporten staat vóór Financiën in de tabrij', () => assert(v2.indexOf('id="tab-btn-rapporten"') < v2.indexOf('id="tab-btn-geld"')));
t('zijbalk: Rapporten op de oude plek, niet meer onder Meer', () => {
  assert(/rapporten: \{ l: 'Rapporten', i: 'rapporten', o: 20 \}/.test(zb));
  assert(/geld: \{ l: 'Financiën', i: 'dash', o: 22 \}/.test(zb));
});
t('tabknop Financiën volgt recht én Bart', () => assert(v2.includes("b.style.display=ja&&financienZichtbaar()?'':'none';")));
t('startpagina met geldrecht is Rapporten', () => assert(v2.includes("if(zichtbaar(r)) showTab('rapporten',r); else if(zichtbaar(g)) showTab('geld',g);")));
t('acties vanuit een project hangen aan het recht, niet aan de knop', () => {
  const stuk = v2.slice(v2.indexOf('function geldPrognoseOpen'), v2.indexOf('let _geldProgCache'));
  assert(!stuk.includes("b.style.display==='none'")); assert.strictEqual(stuk.match(/geldActieMag\(\)/g).length, 2);
});
t('mobiel: €-knop alleen voor Bart, Forecast blijft op het recht', () => {
  assert(/geldKnop'\); if \(gk\) gk\.style\.display = .*bart@mortiseandtenon\.nl'/.test(mob));
  assert(mob.includes('id="bk-forecast" data-recht="geld"'));
});
t('tegel toont "Naar Financiën" alleen bij een zichtbare tabknop', () => assert(cij.includes("document.getElementById('tab-btn-geld').style.display !== 'none'")));
console.log(n + ' tests geslaagd');
// Bouwt mt-rust.css uit tools/rust-ontwerp.json (design system, bron van waarheid) + tools/mt-rust-bron.css (componenten).
// node tools/bouw-rust-css.js [--controle]   --controle: schrijft niets, exit 1 als mt-rust.css niet gelijk is aan wat gebouwd zou worden.
// Alleen licht: het donkere thema gaat pas aan na R4 (losse kleurcodes). De donkere waarden staan wel in het tokenbestand.
'use strict';
const fs = require('fs'), path = require('path');
const map = process.argv.includes('--controle');
const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'rust-ontwerp.json'), 'utf8'));
const bron = fs.readFileSync(path.join(__dirname, 'mt-rust-bron.css'), 'utf8').replace(/\r\n/g, '\n');
const v = [];
const naam = n => n === 'ink-3' ? 'ink-faint' : n;     // zie brug in mt-rust-bron.css: --ink-3 blijft de leesbare bijtekstkleur
for (const k of T.color.tokens) v.push(`  --${naam(k.name)}:${k.value.light};`);
v.push(`  --font-ui:${T.type.families.ui};`, `  --font-head:${T.type.families.head};`, `  --font-mono:${T.type.families.mono};`);
for (const k of T.spacing.tokens) v.push(`  --${k.name}:${k.value};`);
for (const k of T.radius.tokens) v.push(`  --${k.name}:${k.value};`);
for (const k of T.size.tokens) v.push(`  --${k.name}:${k.value};`);
for (const k of T.shadow.tokens) v.push(`  --${k.name}:${k.value.light};`);
const kop = `/* =====================================================================
   mt-rust.css: de rust-pas (R1). GEBOUWD uit tools/rust-ontwerp.json en tools/mt-rust-bron.css met tools/bouw-rust-css.js. Niet met de hand bewerken.
   Alles staat onder html[data-stijl="nieuw"] en wordt NA mt-stijl-nieuw.css geladen; zonder dat attribuut is de oude stijl ongewijzigd.
   ===================================================================== */
/* ── 1. Tokens (licht) ── */
html[data-stijl="nieuw"]{
${v.join('\n')}
}
`;
const uit = kop + '\n' + bron;
const doel = path.join(__dirname, '..', 'mt-rust.css');
if (map) { const nu = fs.existsSync(doel) ? fs.readFileSync(doel, 'utf8').replace(/\r\n/g, '\n') : ''; if (nu !== uit) { console.error('mt-rust.css is niet gelijk aan de bron: draai node tools/bouw-rust-css.js'); process.exit(1); } console.log('mt-rust.css klopt met de bron'); }
else { fs.writeFileSync(doel, uit); console.log('mt-rust.css geschreven (' + uit.length + ' tekens)'); }
// Tekstsink-scanner (F7 3b): zoekt in de scripts van html-/js-bestanden alle template-literals die HTML opbouwen
// (bevatten '<' of komen in innerHTML/outerHTML/insertAdjacentHTML/srcdoc) en classificeert elke ${…}-interpolatie.
// Eigen tokenizer (strings, templates met geneste ${}, commentaar, regex-literals); geen parser nodig.
// Gebruik: const { scan } = require('./sinkscan.js'); scan(tekst, {safeFns}) → { items:[{regel, expr, klasse, ctx}], fouten }
const VEILIG_FN = new Set(['esc', 'escHtml', '_escH', 'jsArg', 'jsLit', 'ibEsc', 'UI_ESC', 'veiligeHtml', 'html', 'veiligeUrl', 'Number', 'parseInt', 'parseFloat', 'String(Number', 'Math.round', 'Math.max', 'Math.min', 'Math.abs', 'encodeURIComponent', 'encodeURI']);
function tokenize(src) {
  // → lijst templates: { start, end, delen:[tekst], exprs:[{start,end,tekst}] } (ook geneste); fouten
  const templates = [], fouten = []; let i = 0; const n = src.length;
  const regexMag = prev => !prev || /^[(,=:\[!&|?{};+\-*%<>~^]$/.test(prev) || /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(prev);
  function leesTemplate(begin) {   // begin = index van de openende `; geeft index NA de afsluitende `
    const t = { start: begin, delen: [], exprs: [] }; let j = begin + 1, deel = '';
    while (j < n) {
      const c = src[j];
      if (c === '\\') { deel += src.slice(j, j + 2); j += 2; continue; }
      if (c === '`') { t.delen.push(deel); t.end = j; templates.push(t); return j + 1; }
      if (c === '$' && src[j + 1] === '{') {
        t.delen.push(deel); deel = '';
        const es = j + 2; const eind = leesBlok(es);   // index van de bijbehorende }
        t.exprs.push({ start: es, end: eind, tekst: src.slice(es, eind) });
        j = eind + 1; continue;
      }
      deel += c; j++;
    }
    fouten.push('onafgesloten template bij ' + begin); t.end = n; templates.push(t); return n;
  }
  function leesBlok(vanaf) {   // JS-code tot de bijpassende } (diepte 0); slaat strings/templates/commentaar/regex over
    let d = 0, j = vanaf, prev = '';
    while (j < n) {
      const c = src[j];
      if (c === '"' || c === "'") { const q = c; j++; while (j < n && src[j] !== q) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; } j++; prev = 'S'; continue; }
      if (c === '`') { j = leesTemplate(j); prev = 'S'; continue; }
      if (c === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
      if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue; }
      if (c === '/' && regexMag(prev)) {   // regex-literal
        j++; let kl = false; while (j < n) { const x = src[j]; if (x === '\\') { j += 2; continue; } if (x === '[') kl = true; else if (x === ']') kl = false; else if (x === '/' && !kl) break; else if (x === '\n') break; j++; }
        j++; while (/[a-z]/.test(src[j] || '')) j++; prev = 'S'; continue;
      }
      if (c === '{' || c === '(' || c === '[') { d++; prev = c; j++; continue; }
      if (c === '}' || c === ')' || c === ']') { if (c === '}' && d === 0) return j; d--; prev = c; j++; continue; }
      if (/\s/.test(c)) { j++; continue; }
      if (/[A-Za-z0-9_$]/.test(c)) { let k = j; while (k < n && /[A-Za-z0-9_$.]/.test(src[k])) k++; prev = src.slice(j, k); j = k; continue; }
      prev = c; j++;
    }
    return n;
  }
  // hoofdlus: buiten templates; scant tot einde
  let prev = '';
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') break; i++; } i++; prev = 'S'; continue; }
    if (c === '`') { i = leesTemplate(i); prev = 'S'; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && regexMag(prev)) { i++; let kl = false; while (i < n) { const x = src[i]; if (x === '\\') { i += 2; continue; } if (x === '[') kl = true; else if (x === ']') kl = false; else if (x === '/' && !kl) break; else if (x === '\n') break; i++; } i++; while (/[a-z]/.test(src[i] || '')) i++; prev = 'S'; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) { let k = i; while (k < n && /[A-Za-z0-9_$.]/.test(src[k])) k++; prev = src.slice(i, k); i = k; continue; }
    prev = c; i++;
  }
  return { templates, fouten, blokEind: leesBlok };
}
// Splitst een expressie op het hoogste niveau op een operator (bv. '?' en ':' voor een ternary, '&&', '||'), buiten haakjes/strings.
function splitTop(e, ops) {
  const delen = []; let d = 0, s = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < e.length && e[i] !== q) { if (e[i] === '\\') i++; if (q === '`' && e[i] === '$' && e[i + 1] === '{') { let dd = 1; i += 2; while (i < e.length && dd) { if (e[i] === '{') dd++; else if (e[i] === '}') dd--; i++; } i--; } i++; } continue; }
    if ('([{'.includes(c)) { d++; continue; } if (')]}'.includes(c)) { d--; continue; }
    if (d === 0) for (const op of ops) if (e.startsWith(op, i)) { delen.push(e.slice(s, i)); s = i + op.length; i += op.length - 1; break; }
  }
  delen.push(e.slice(s)); return delen;
}
function isLiteral(e) { e = e.trim(); return /^(['"])(?:\\.|(?!\1).)*\1$/.test(e) || /^`[^`$]*`$/.test(e) || /^-?\d+(\.\d+)?$/.test(e) || e === '' || e === 'null' || e === 'undefined' || e === 'true' || e === 'false'; }
// Past de hele expressie in één aanroep van een veilige functie? (esc(...), jsArg(...), Number(...) …)
function veiligeAanroep(e, extra, frag) {
  const m = e.match(/^([A-Za-z_$][\w$.]*)\(/); if (!m) return false;
  const naam = m[1]; if (!(VEILIG_FN.has(naam) || (extra && extra.has(naam)) || (frag && frag.has(naam)))) return false;
  let d = 0; for (let i = m[0].length - 1; i < e.length; i++) { if (e[i] === '(') d++; else if (e[i] === ')') { d--; if (d === 0) return i === e.length - 1; } else if (e[i] === '"' || e[i] === "'" || e[i] === '`') { const q = e[i]; i++; while (i < e.length && e[i] !== q) { if (e[i] === '\\') i++; i++; } } }
  return false;
}
// Klasse: 'veilig' (bewezen door vorm), 'getal' (getal-achtig), 'samengesteld' (bevat zelf templates → die worden apart gescand), 'let-op' (ruwe waarde).
function classificeer(expr, extra, frag) {
  const e = expr.trim();
  if (isLiteral(e)) return 'veilig';
  if (veiligeAanroep(e, extra, null)) return 'veilig';
  if (frag && veiligeAanroep(e, null, frag)) return 'samengesteld';
  if (/^\(?\s*[\w$.]+\s*\)?\s*\.(toFixed|toLocaleString|toISOString|toDateString)\(.*\)$/.test(e) || /\.length$/.test(e) || /^(Math\.\w+|Date\.now)\(/.test(e) || /^[-+]?\(?\s*(i|j|k|n|idx|index|nr|teller|count|aantal)\s*\)?(\s*[-+*]\s*\d+)?$/.test(e)) return 'getal';
  const tern = splitTop(e, ['?']);
  if (tern.length >= 2) {   // a ? b : c  (b en c apart; a is een conditie en wordt niet geplaatst)
    const rest = e.slice(tern[0].length + 1), delen = splitTop(rest, [':']);
    if (delen.length >= 2) return delen.map(x => classificeer(x, extra, frag)).every(k => k === 'veilig' || k === 'getal' || k === 'samengesteld') ? (delen.every(x => isLiteral(x) || /^`/.test(x.trim())) ? 'samengesteld' : 'veilig') : 'let-op';
  }
  const plus = splitTop(e, ['+']);
  if (plus.length >= 2 && !/^\s*[-+]/.test(e) && plus.every(x => x.trim() !== '')) { const k = plus.map(x => classificeer(x, extra, frag)); if (k.every(x => x !== 'let-op')) return k.every(x => x === 'veilig' || x === 'getal') ? 'veilig' : 'samengesteld'; }
  const en = splitTop(e, ['&&']);
  if (en.length >= 2) return classificeer(en[en.length - 1], extra, frag);   // cond && waarde → de waarde telt
  const of = splitTop(e, ['||', '??']);
  if (of.length >= 2) return of.map(x => classificeer(x, extra, frag)).every(k => k !== 'let-op') ? 'veilig' : 'let-op';
  if (/^`/.test(e) && /`$/.test(e)) return 'samengesteld';
  if (/\.map\(/.test(e) && /\.join\(/.test(e)) return 'samengesteld';
  if (/\.join\(/.test(e) && /^\[/.test(e)) return 'samengesteld';
  return 'let-op';
}
function regelVan(src, idx) { let r = 1; for (let i = 0; i < idx && i < src.length; i++) if (src.charCodeAt(i) === 10) r++; return r; }
function scan(src, opt) {
  opt = opt || {}; const extra = new Set(opt.veiligeFns || []), frag = new Set(opt.fragmentFns || []);
  const { templates, fouten } = tokenize(src), items = [];
  // regelnummers efficiënt: tabel
  const nl = [0]; for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) nl.push(i + 1);
  const regel = idx => { let lo = 0, hi = nl.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nl[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
  for (const t of templates) {
    const tekst = t.delen.join('');
    const vooraf = src.slice(Math.max(0, t.start - 160), t.start);
    const sink = /(innerHTML|outerHTML|insertAdjacentHTML|srcdoc|\.html)\s*(\+?=|\()[^;`]*$/.test(vooraf) || /innerHTML\s*\+?=\s*$/.test(vooraf.replace(/\s+$/, ''));
    const htmlAchtig = /<[a-zA-Z\/!]/.test(tekst) || /\bstyle=|\bclass=|\bonclick=/.test(tekst);
    if (!htmlAchtig && !sink) continue;
    t.exprs.forEach((x, k) => {
      const klas = classificeer(x.tekst, extra, frag);
      // context: waar staat de interpolatie (tekst, attribuut, handler, url, stijl)
      const voor = t.delen.slice(0, k + 1).join('\u0000').split('\u0000'); const lastDeel = voor[voor.length - 1];
      let ctx = 'tekst';
      const mAttr = lastDeel.match(/([a-zA-Z-:]+)\s*=\s*(["']?)([^"'<>]*)$/);
      if (mAttr && (mAttr[2] || !/\s/.test(mAttr[3]))) { const a = mAttr[1].toLowerCase(); ctx = /^on/.test(a) ? 'handler' : /^(href|src|action|formaction|xlink:href|data|poster|srcset)$/.test(a) ? 'url' : a === 'style' ? 'stijl' : 'attribuut:' + a; }
      items.push({ regel: regel(x.start), expr: x.tekst.trim().replace(/\s+/g, ' ').slice(0, 140), klasse: klas, ctx, sink, start: x.start, end: x.end, ruw: x.tekst, voorDeel: lastDeel.slice(-60) });
    });
  }
  return { items, fouten, aantalTemplates: templates.length };
}
// Haalt de inline <script>-blokken uit html (met regelverschuiving) of geeft het hele bestand terug voor .js
function scripts(tekst, isHtml) {
  if (!isHtml) return [{ offset: 0, src: tekst }];
  const uit = []; const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(tekst))) uit.push({ offset: m.index + m[0].indexOf('>') + 1, src: m[1] });
  return uit;
}
function scanBestand(tekst, isHtml, opt) {
  const alle = []; let fouten = [], aantal = 0;
  for (const s of scripts(tekst, isHtml)) {
    const r = scan(s.src, opt); const verschuiving = regelVan(tekst, s.offset) - 1;
    for (const it of r.items) alle.push(Object.assign({}, it, { regel: it.regel + verschuiving, abs: s.offset + it.start, absEind: s.offset + it.end }));
    fouten = fouten.concat(r.fouten); aantal += r.aantalTemplates;
  }
  return { items: alle, fouten, aantalTemplates: aantal };
}
// Broncode van één top-level of geneste functie (voor tests): `function naam(…) {…}` of `async function naam(…) {…}`.
function vindFunctie(src, naam) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + naam.replace(/\$/g, '\\$') + '\\s*\\(').exec(src); if (!m) throw new Error('functie niet gevonden: ' + naam);
  const { blokEind } = tokenize(src), open = src.indexOf('{', src.indexOf(')', m.index)), eind = blokEind(open + 1);
  return src.slice(m.index, eind + 1);
}
module.exports = { tokenize, scan, scanBestand, classificeer, splitTop, vindFunctie, scripts };

// ── Groepen (F7 3b): per bestandsgroep de functies die extern afkomstige data in HTML zetten, met de bewust-ruwe interpolaties ──
// Gebruik (CLI):  node tools/sinkscan.js <bestand> [groepnaam]   → toont de ruwe interpolaties (let-op) per functie
function fnVanRegel(regels, reg) {
  for (let i = reg - 1; i >= 0; i--) {
    const m = regels[i].match(/^\s{0,4}(?:async\s+)?function\s+([\w$]+)|^\s{0,2}(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function|\(|[\w$]+\s*=>)/);
    if (m) return m[1] || m[2];
  }
  return '?';
}
// Ruwe interpolaties ("let-op") in de functies van één groep. groep = { functies, veiligeFns, fragmentFns }.
function letOpInGroep(tekst, isHtml, groep) {
  const t = tekst.replace(/\r\n/g, '\n'), regels = t.split('\n'), F = new Set(groep.functies);
  const r = scanBestand(t, isHtml, { veiligeFns: groep.veiligeFns, fragmentFns: groep.fragmentFns });
  return r.items.filter(i => i.klasse === 'let-op').map(i => Object.assign({ fn: fnVanRegel(regels, i.regel) }, i)).filter(i => F.has(i.fn));
}
module.exports.fnVanRegel = fnVanRegel; module.exports.letOpInGroep = letOpInGroep;
if (require.main === module) {
  const fs = require('fs'), path = require('path'), f = process.argv[2], G = require('./sinks-groepen.js');
  const namen = process.argv[3] ? [process.argv[3]] : Object.keys(G).filter(k => G[k].bestand === path.basename(f));
  for (const n of namen) { const g = G[n]; const lijst = letOpInGroep(fs.readFileSync(f, 'utf8'), /\.html$/.test(f), g); console.log(`${n}: ${lijst.length} ruwe interpolaties`); for (const i of lijst) console.log(`  ${i.fn}  r${i.regel}  ${i.ctx}  ${i.expr}`); }
}

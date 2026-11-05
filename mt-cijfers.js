// mt-cijfers.js — de cijfers bij de rapporten (G9): CEO-balk, kerncijfers en interactieve grafieken (eigen SVG).
// Data van de worker: /geld/cijfers (per maand vanaf 2022; de worker vult de historie in stukken aan),
// /geld/cijfers/detail (drill-down met Moneybird-links), /geld/cijfers/indeling (eigenaar: indeling aanpassen),
// /geld/prognose (omzetprognose), /geld/tijdlijn (kasprognose, als het geldscherm geladen is).
// Altijd per boekjaar (kalenderjaar), nooit rollende 12 maanden. Prognose is gestippeld/gearceerd en telt nooit
// mee in de kerncijfers. Rood/oranje/groen is alleen voor oordelen; categorieën zijn neutrale tinten.
(function (root) {
  'use strict';
  const C = root.MTCijfers = root.MTCijfers || {};
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => n == null || !isFinite(n) ? '—' : (n < 0 ? '−' : '') + '€ ' + Math.round(Math.abs(n)).toLocaleString('nl-NL');
  const kort = n => { if (n == null || !isFinite(n)) return '—'; const a = Math.abs(n), t = n < 0 ? '−' : ''; return t + '€ ' + (a >= 1e6 ? (a / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'k' : Math.round(a)); };
  const pct = n => n == null || !isFinite(n) ? '—' : n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const maandNaam = ym => `${MND[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const START = '2022-01', BTW = 1.21, MAX_RONDES = 15;
  const LOONSOORT = [['netto', 'werknemers (netto)'], ['loonheffing', 'Belastingdienst (loonheffing)'], ['pensioen', 'pensioenfonds']];
  // Neutrale tinten per categorie (geen rood/oranje/groen: die kleuren zijn voor oordelen).
  const TINT = ['#3f4a56', '#6b7682', '#94a0ab', '#2b333c', '#7f8a96', '#b3bcc5', '#56616d', '#a2abb4', '#c9d0d6', '#1f262d', '#8c96a0'];
  const ZOOMS = [['M', 'maand'], ['K', 'kwartaal'], ['J', 'jaar t/m nu'], ['5J', '5 jaar']];
  const WEERGAVEN = [['omzet_kosten', 'Omzet en kosten'], ['brutomarge', 'Brutomarge'], ['kosten_pct', 'Kosten vs branche'], ['opnames', 'Opnames'], ['kas', 'Kas'], ['waterval', 'Waterval']];
  const REEKS_NAAR = { omzet_kosten: 'omzet_kosten', omzet: 'omzet_kosten', kosten: 'omzet_kosten', resultaat: 'omzet_kosten', brutomarge: 'brutomarge', kosten_pct: 'kosten_pct', opnames: 'opnames', kas: 'kas', waterval: 'waterval' };
  const st = C._st = { el: null, bron: null, mag: false, wie: '', maanden: [], cats: [], bm: {}, ontbrekend: [], laden: false, rondes: 0, fout: null, prognose: null, kasProg: null,
    jaar: null, stapelSel: null, zoom: 'M', weergave: 'omzet_kosten', eerlijk: true, vergelijk: 0, vgl: { j1: true, j2: true, b: true }, statusOpen: false, tabel: false, vast: null, hover: null, paneel: null, paneelEl: null, paneelNieuw: false, openerFk: null, top: null, sel: null, focusCat: null, horizon: 'kort', opHorizon: null, correctieVan: null, prive: [], vandaag: null, nietIngedeeld: [], bes: { data: null, cfg: null, laden: false, fout: null, cache: null }, besZoom: null };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const mobiel = () => { try { return root.matchMedia && root.matchMedia('(max-width: 760px)').matches; } catch (e) { return false; } };

  function css() {
    if (document.getElementById('mtc-css')) return;
    const s = document.createElement('style'); s.id = 'mtc-css';
    s.textContent = `
.mtc{font-size:14px;--mtc-zacht:var(--text-faint,#8a8a80);--mtc-lijn:var(--green,#2A4A38)}
.mtc *{box-sizing:border-box}
.mtc-balk{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}
.mtc-groep{display:inline-flex;border:1px solid var(--border,#ddd);border-radius:22px;overflow:hidden;background:var(--card,#fff)}
.mtc-groep button{border:0;background:none;padding:0 12px;min-height:44px;min-width:44px;font:inherit;font-size:14px;cursor:pointer;color:inherit}
.mtc-groep button.aan{background:var(--green,#2A4A38);color:#fff}
.mtc-knop{border:1px solid var(--border,#ddd);background:var(--card,#fff);border-radius:22px;padding:0 12px;min-height:44px;font:inherit;font-size:14px;cursor:pointer}
.mtc-knop.aan{background:#e8eef9;border-color:#9fb3d6}
.mtc-badge{font-size:11px;background:#e8eef9;color:#3a5a8a;border-radius:10px;padding:1px 7px;margin-left:4px;white-space:nowrap}
.mtc-kpi{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:10px}
.mtc-kpi>div{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:8px 10px;min-width:0}
.mtc-kpi .l{font-size:12px;color:var(--mtc-zacht)}.mtc-kpi .w{font-size:18px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mtc-kpi .s{font-size:12px;color:var(--mtc-zacht)}
.mtc-weergaven{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:6px}
.mtc-weergaven button{flex:0 0 auto}
.mtc-kaart{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:10px 12px;margin-bottom:10px}
.mtc-grafiek{touch-action:pan-y;user-select:none;position:relative}
.mtc-grafiek svg{display:block;width:100%;height:auto}
.mtc-grafiek [data-tik]{cursor:pointer}
.mtc-noot{font-size:12px;color:var(--mtc-zacht);margin-top:4px}
.mtc-legenda{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--mtc-zacht);margin-top:4px}
.mtc-legenda i{display:inline-block;width:14px;height:10px;margin-right:4px;vertical-align:-1px}
.mtc-euro{display:flex;height:44px;border-radius:8px;overflow:hidden;margin-top:6px}
.mtc-euro button{border:0;padding:0;min-width:3px;cursor:pointer;color:#fff;font-size:11px;overflow:hidden;white-space:nowrap}
.mtc-sheet{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9000;display:flex;align-items:flex-end;justify-content:center}
.mtc-sheet>div{background:var(--card,#fff);width:100%;max-width:640px;max-height:85vh;overflow:auto;border-radius:14px 14px 0 0;padding:14px 16px}
@media(min-width:761px){.mtc-sheet{justify-content:flex-end;align-items:stretch}.mtc-sheet>div{max-width:460px;max-height:none;border-radius:0}}
.mtc-sheet table{width:100%;border-collapse:collapse;font-size:13px}.mtc-sheet td{border-bottom:1px solid var(--border,#eee);padding:5px 4px;vertical-align:top}
.mtc-sheet td.b{text-align:right;white-space:nowrap}
.mtc-sheet select,.mtc-sheet input{font:inherit;font-size:14px;padding:4px 6px;max-width:100%}
.mtc-waarsch{font-size:12px;background:#fbf0dc;border-radius:8px;padding:6px 8px;margin-bottom:8px}
@media(max-width:760px){.mtc-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}.mtc-kpi>div:last-child{grid-column:1/-1}}

.mtd{--mtd-res:#0f7c80;--mtd-streep:#9db7cc;display:flex;flex-direction:column;gap:16px;color:var(--ink,#1b211e);font-family:var(--sans,system-ui,sans-serif)}
.mtd .mtc-noot{margin-top:0}
.mtd .mtc-groep{border-radius:4px}.mtd .mtc-groep button{min-height:36px;min-width:36px;padding:0 12px;font-size:13px}.mtd .mtc-knop{min-height:36px;border-radius:4px;font-size:13px}
.mtd button:focus-visible,.mtd [role=button]:focus-visible,.mtd a:focus-visible{outline:2px solid var(--primary,#17643f);outline-offset:2px}
.mtd-kop{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.mtd-titel{margin:0;font-family:var(--serif,inherit);font-size:24px;line-height:30px;font-weight:600;letter-spacing:-.015em}
.mtd-status{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border:1px solid var(--line,#dfd8cb);border-radius:4px;background:var(--surface,#fff);color:var(--ink-2,#596059);font:inherit;font-size:13px;cursor:pointer}
.mtd-status[aria-expanded=true]{border-color:var(--border-strong,#9a917f)}.mtd-stip{width:8px;height:8px;border-radius:999px;background:#8c918a}.mtd-sep{color:#8c918a}.mtd-n{color:var(--ink,#1b211e);font-weight:500}
.mtd-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.mtd-vgl{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}.mtd-vgl-t{font-size:12px;font-weight:500;color:var(--ink-2,#596059);padding-right:4px}
.mtd-vglknop{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border-radius:4px;border:1px solid var(--line,#dfd8cb);background:var(--surface,#fff);color:var(--ink-2,#596059);font:inherit;font-size:13px;cursor:pointer}
.mtd-vglknop.aan{border-color:var(--primary,#17643f);background:var(--primary-soft,#ddefe3);color:var(--primary,#17643f);font-weight:500}
.mtd-staal{display:inline-block;width:14px;height:0;border-top:2px solid transparent;vertical-align:middle;flex:0 0 auto}
.mtd-staal.dashed{border-top:2px dashed #8c918a}.mtd-staal.dotted{border-top:2px dotted #b8b2a4}.mtd-staal.brons{border-top:2px solid #c9b07a}.mtd-staal.prog{border-top:2px dashed var(--info,#3e5c76)}
.mtd-staal.balk{width:12px;height:12px;border:0;border-radius:2px;background:var(--info,#3e5c76)}.mtd-staal.res{width:12px;height:12px;border:0;border-radius:2px;background:var(--mtd-res)}.mtd-staal.huidig{border-top:3px solid var(--ink,#1b211e)}.mtd-staal.resprog{border-top:2px dashed var(--mtd-res)}
.mtd-staal.prog.blok{height:12px}
.mtd-statuspaneel{background:var(--surface,#fff);border:1px solid var(--line,#dfd8cb);border-radius:8px;padding:20px 24px}
.mtd-statuspaneel h2{margin:0;font-size:16px}.mtd-statuspaneel h3{margin:16px 0 6px;font-size:13px;color:var(--ink-2,#596059);font-weight:600}.mtd-statuspaneel ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:13px}
.mtd-sp-kop{display:flex;justify-content:space-between;align-items:center;gap:12px}
.mtd-tegels{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
@media(min-width:1200px){.mtd-tegels{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(min-width:2200px){.mtd-tegels{grid-template-columns:repeat(6,minmax(0,1fr))}}
.mtd-tegel{display:flex;flex-direction:column;gap:12px;padding:20px 24px;background:var(--surface,#fff);border:1px solid var(--line,#dfd8cb);border-radius:8px;color:inherit;cursor:pointer;transition:border-color .15s ease-out;min-width:0}
.mtd-tegel:hover{border-color:var(--border-strong,#9a917f)}.mtd-tegel.uit{cursor:default}.mtd-tegel.uit:hover{border-color:var(--line,#dfd8cb)}.mtd-tegel.uit .mtd-getal{color:var(--ink-3,#646a64)}
.mtd-t-kop{display:flex;align-items:center;justify-content:space-between;gap:8px}.mtd-t-l{font-size:13px;line-height:18px;font-weight:500;color:var(--ink-2,#596059)}.mtd-vol-ico{color:#8c918a;font-size:15px}
.mtd-fc{margin-left:8px;font-size:12px;font-weight:500;color:var(--info,#3e5c76);background:var(--info-50,#e6edf3);padding:0 6px;border-radius:4px}
.mtd-t-mid{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.mtd-t-w{display:flex;flex-direction:column;gap:4px;min-width:0}
.mtd-getal{font-family:var(--mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:30px;line-height:34px;font-weight:500;letter-spacing:-.02em}.mtd-sub{font-size:13px;line-height:18px;color:var(--ink-2,#596059)}
.mtd-spark{width:132px;height:44px;flex:0 0 auto;overflow:visible}.mtd-spark path{fill:none;vector-effect:non-scaling-stroke}
.mtd-s-vorig{stroke:#b8b2a4;stroke-width:1.5;stroke-dasharray:3 3}.mtd-s-huidig{stroke:var(--ink,#1b211e);stroke-width:2}.mtd-s-prog{stroke:var(--info,#3e5c76);stroke-width:2;stroke-dasharray:4 3}
.mtd-chip{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;min-height:24px;padding:0 8px;border-radius:4px;font-size:13px;font-weight:500;background:var(--n-150,#f1ede5);color:var(--ink-2,#596059)}
.mtd-chip.goed{background:var(--success-50,#e3f3e8);color:var(--success,#1a6e3b)}.mtd-chip.slecht{background:var(--error-50,#fce6e4);color:var(--error,#c4322a)}
.mtd-vgl1{display:none;font-size:12px;line-height:16px;color:var(--ink-2,#596059)}
.mtd-rijen{display:flex;flex-direction:column;border-top:1px solid var(--n-200,#ece7de)}
.mtd-rij{display:grid;grid-template-columns:minmax(0,1fr) auto 64px;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--n-200,#ece7de)}
.mtd-rl{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-2,#596059)}.mtd-rv{font-family:var(--mono,monospace);font-variant-numeric:tabular-nums;font-size:13px;font-weight:500}
.mtd-rd,.mtd-td,.mtd-ks{font-family:var(--mono,monospace);font-size:12px;text-align:right;color:var(--ink-2,#596059)}.mtd-rd.goed,.mtd-td.goed,.mtd-ks.goed,.mtd-tabel td.goed,.mtd-kw-d.goed{color:var(--success,#1a6e3b)}.mtd-rd.slecht,.mtd-td.slecht,.mtd-ks.slecht,.mtd-tabel td.slecht,.mtd-kw-d.slecht{color:var(--error,#c4322a)}
.mtd-kaart{background:var(--surface,#fff);border:1px solid var(--line,#dfd8cb);border-radius:8px;padding:24px;display:flex;flex-direction:column;gap:16px;min-width:0}
.mtd-kaart h3{margin:0;font-size:16px;line-height:22px;font-weight:600}
.mtd-kaartkop{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}.mtd-kaartkop>div:first-child{display:flex;flex-direction:column;gap:2px}
.mtd-acties-k{display:flex;flex-wrap:wrap;align-items:center;gap:16px;font-size:12px;color:var(--ink-2,#596059)}.mtd-legenda{display:flex;flex-wrap:wrap;align-items:center;gap:16px}.mtd-leg{display:inline-flex;align-items:center;gap:6px}
.mtd-kn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:0 12px;border:1px solid var(--border-strong,#9a917f);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1b211e);font:inherit;font-size:13px;cursor:pointer;text-decoration:none}
.mtd-kn.ico{width:36px;padding:0}.mtd-kn[aria-pressed=true]{background:var(--n-150,#f1ede5)}
.mtd-chart{display:flex;flex-direction:column;gap:8px}.mtd-plot{position:relative;touch-action:pan-y}
.mtd-svg{display:block;width:100%;height:auto;overflow:visible}.mtd-raster{stroke:var(--n-200,#ece7de)}.mtd-as0{stroke:var(--border-strong,#9a917f)}
.mtd-astekst{font-family:var(--mono,monospace);font-size:11px;fill:var(--ink-2,#596059)}.mtd-xtekst{font-size:12px;fill:var(--ink-2,#596059)}.mtd-xtekst.fc,.mtd-restekst.fc{fill:var(--info,#3e5c76)}.mtd-restekst{font-family:var(--mono,monospace);font-size:11px;fill:var(--ink-2,#596059)}
.mtd-bar{fill:var(--info,#3e5c76);opacity:.82}.mtd-bargroep.sel .mtd-bar{opacity:1}.mtd-bar.lopend{opacity:.5;stroke:var(--info,#3e5c76);stroke-dasharray:3 2;fill-opacity:.6}
.mtd-bar-prog{stroke:var(--info,#3e5c76);stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}.mtd-arc-bg{fill:var(--info-50,#e6edf3)}.mtd-arc-lijn{stroke:var(--mtd-streep)}.mtd-arcres-bg{fill:#e3f0f0}.mtd-arcres-lijn{stroke:#8cc5c7}
.mtd-l-vgl,.mtd-l-prog,.mtd-l-huidig{fill:none;vector-effect:non-scaling-stroke}.mtd-l-vgl{stroke-width:2}.mtd-l-vgl.o1{stroke:#8c918a;stroke-dasharray:7 5}.mtd-l-vgl.o2{stroke:#b8b2a4;stroke-dasharray:2 4;stroke-linecap:round}
.mtd-l-prog{stroke:var(--info,#3e5c76);stroke-width:2.5;stroke-dasharray:6 4}.mtd-l-huidig{stroke:var(--ink,#1b211e);stroke-width:3}
.mtd-scheid{stroke:var(--mtd-streep);stroke-dasharray:3 3}.mtd-scheidtekst{font-size:12px;fill:var(--info,#3e5c76)}.mtd-kruis{stroke:var(--border-strong,#9a917f)}
.mtd-hit{fill:transparent;cursor:crosshair}.mtd-hit:focus-visible{outline:2px solid var(--primary,#17643f);outline-offset:-2px}
.mtd-res{fill:var(--mtd-res);opacity:.8}.mtd-res-prog{stroke:var(--mtd-res);stroke-width:1;stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
.mtd-tip{position:absolute;top:8px;width:260px;box-sizing:border-box;padding:12px 14px;background:var(--surface,#fff);border:1px solid var(--line,#dfd8cb);border-radius:8px;box-shadow:0 8px 24px rgba(40,34,20,.12);pointer-events:none;font-size:13px;z-index:2}.mtd-tip[hidden]{display:none}
.mtd-tk{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding-bottom:8px;border-bottom:1px solid var(--n-200,#ece7de)}.mtd-tt{font-weight:600}.mtd-tlab{font-size:12px;color:var(--ink-2,#596059)}.mtd-tlab.fc{font-weight:500;color:var(--info,#3e5c76);background:var(--info-50,#e6edf3);padding:0 6px;border-radius:4px}
.mtd-tr{display:grid;grid-template-columns:14px minmax(0,1fr) auto auto;align-items:center;gap:8px;padding-top:6px;font-size:13px}.mtd-tl{color:var(--ink-2,#596059)}.mtd-tv{font-family:var(--mono,monospace);font-variant-numeric:tabular-nums;font-weight:500}.mtd-td{min-width:30px}
.mtd-info{display:none;flex-direction:column;background:var(--n-150,#f1ede5);border-radius:4px;padding:12px;font-size:13px}.mtd-info.vast.heeft{display:flex}.mtd-info .mtd-tk{border-bottom-color:var(--n-300,#dfd8cb)}.mtd-tacties{margin-top:10px}
.mtd-tabelwrap{overflow-x:auto}.mtd-tabel{width:100%;border-collapse:collapse;font-size:13px}.mtd-tabel th,.mtd-tabel td{padding:8px 10px;border-bottom:1px solid var(--n-200,#ece7de);text-align:right;white-space:nowrap}.mtd-tabel th:first-child,.mtd-tabel thead th{text-align:left}.mtd-tabel td{font-family:var(--mono,monospace);font-variant-numeric:tabular-nums}.mtd-tabel thead th{font-size:12px;color:var(--ink-2,#596059);font-weight:500}.mtd-tabel tr.fc td,.mtd-tabel tr.fc th{color:var(--info,#3e5c76)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mtd-vol{position:fixed;inset:0;z-index:8000;background:var(--canvas,#f6f3ed);overflow:auto;padding:24px 32px 48px;display:block}.mtd-vol-in{max-width:1320px;margin:0 auto;display:flex;flex-direction:column;gap:24px}
.mtd-pkop{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}.mtd-pkop-l{display:flex;align-items:center;gap:16px}.mtd-pkop h1{margin:0;font-family:var(--serif,inherit);font-size:28px;line-height:32px;font-weight:600;letter-spacing:-.015em}.mtd-pkop-l>div{display:flex;flex-direction:column;gap:2px}
.mtd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--line,#dfd8cb);border:1px solid var(--line,#dfd8cb);border-radius:8px;overflow:hidden}
.mtd-kpi{display:flex;flex-direction:column;gap:4px;padding:20px 24px;background:var(--surface,#fff);min-width:0}.mtd-kl{font-size:13px;font-weight:500;color:var(--ink-2,#596059)}.mtd-kv{font-family:var(--mono,monospace);font-variant-numeric:tabular-nums;font-size:26px;line-height:30px;font-weight:500;letter-spacing:-.02em}.mtd-kv.prog,.mtd-ks.prog{color:var(--info,#3e5c76)}.mtd-ks{text-align:left;font-family:inherit;font-size:13px}
.mtd-twee{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;align-items:start}
.mtd-kw{display:grid;grid-template-columns:48px repeat(4,minmax(0,1fr));gap:0 12px;font-size:13px}.mtd-kw-k{font-size:12px;font-weight:500;color:var(--ink-2,#596059);padding:6px 0;border-bottom:1px solid var(--line,#dfd8cb);text-align:right}.mtd-kw>*:not(.mtd-kw-k):not(:first-child){padding:10px 0;border-bottom:1px solid var(--n-200,#ece7de)}
.mtd-kw-q{font-weight:500;padding:10px 0;border-bottom:1px solid var(--n-200,#ece7de)}.mtd-kw-v,.mtd-kw-d{text-align:right;font-family:var(--mono,monospace);font-variant-numeric:tabular-nums}.mtd-kw-v{font-weight:500}.mtd-kw-v.z{color:var(--ink-2,#596059);font-weight:400}.mtd-kw-fc{display:block;font-size:12px;font-weight:400;color:var(--info,#3e5c76)}.mtd-kw-d{font-size:12px}
.mtd-pr{display:flex;flex-direction:column;gap:6px}.mtd-pr-k{display:flex;justify-content:space-between;gap:12px;font-size:13px}.mtd-pr-v{font-family:var(--mono,monospace);font-weight:500}.mtd-pr-b{height:6px;border-radius:2px;background:var(--n-150,#f1ede5)}.mtd-pr-b>div{height:6px;border-radius:2px;background:var(--info,#3e5c76)}.mtd-pr-b>div.grijs{background:#b8b2a4}
.mtd-feit{display:grid;grid-template-columns:20px minmax(0,1fr);gap:10px;color:var(--ink-2,#596059)}.mtd-feit svg{margin-top:2px}.mtd-feit>div{display:flex;flex-direction:column;gap:2px}.mtd-feit>div>span:first-child{color:var(--ink,#1b211e)}
.mtd-oud .mtc-noot{margin-top:4px}
.mtd-t-besteedbaar{grid-column:1/-1;order:10}
.mtd-bes-top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px 32px}
.mtd-bes-stats{display:grid;grid-template-columns:repeat(3,minmax(150px,auto));gap:8px 32px}
.mtd-bes-st{display:flex;flex-direction:column;gap:2px;min-width:0}
.mtd-bes-v{font-family:var(--mono,monospace);font-variant-numeric:tabular-nums;font-size:20px;line-height:26px;font-weight:500}
.mtd-getal.slecht{color:var(--error,#c4322a)}
.mtd-bes-grens{stroke:var(--warning,#b7791f);stroke-width:1.5;stroke-dasharray:5 4}
.mtd-bes-laag{fill:var(--ink,#1b211e);stroke:var(--surface,#fff);stroke-width:2}.mtd-bes-laag.slecht{fill:var(--error,#c4322a)}
.mtd-staal.grens{border-top:2px dashed var(--warning,#b7791f)}
.mtd-bes-leg{font-size:12px}
@media(max-width:760px){.mtd-bes-top{gap:10px}.mtd-bes-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;width:100%}.mtd-bes-v{font-size:15px;line-height:20px}.mtd-bes-st .mtd-kl{font-size:12px}.mtd-t-besteedbaar .mtd-getal{font-size:30px;line-height:34px}}
@media(max-width:760px){
.mtd .mtc-groep button,.mtd .mtc-knop,.mtd-vglknop,.mtd-kn,.mtd-status{min-height:44px}.mtd .mtc-groep button{min-width:44px}.mtd-kn.ico{width:44px}
.mtd-titel{font-size:22px}
.mtd-tegels{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.mtd-tegel{padding:14px;gap:6px;min-height:132px}.mtd-tegel.breed{grid-column:1/-1;gap:10px;padding:16px}.mtd-t-komende{order:9}
.mtd-t-mid{flex-direction:column;align-items:stretch;gap:6px}.mtd-spark{width:100%;height:28px}.mtd-getal{font-size:22px;line-height:26px}.mtd-sub{font-size:12px;line-height:16px}
.mtd-tegel.breed .mtd-t-mid{flex-direction:row;align-items:flex-end}.mtd-tegel.breed .mtd-getal{font-size:30px;line-height:34px}.mtd-tegel.breed .mtd-spark{width:130px;height:44px}
.mtd-tegel:not(.breed) .mtd-rijen{display:none}.mtd-tegel:not(.breed) .mtd-vgl1{display:block}
.mtd-tegel.breed .mtd-rijen{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding-top:10px}.mtd-tegel.breed .mtd-rij{display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:0;padding:0}.mtd-tegel.breed .mtd-rd{text-align:left}
.mtd-kaart{padding:16px}.mtd-tip{display:none}.mtd-info.heeft{display:flex}.mtd-info.heeft .mtd-tacties .mtc-knop{width:100%}
.mtd-vol{padding:16px 16px 48px}.mtd-vol-in{gap:16px}.mtd-pkop h1{font-size:22px;line-height:26px}.mtd-kpi{padding:14px 16px}.mtd-kv{font-size:22px}.mtd-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
.mtd-twee{grid-template-columns:minmax(0,1fr)}.mtd-legenda{gap:10px}
}
/* kleur: vaste kleur per categorie (klassen mtd-k0..k6), resultaat en oordelen; donkere modus als eigen stappen (gevalideerd met het validatiescript van de dataviz-skill) */
.mtd{--k0:#2a78d6;--k1:#eb6834;--k2:#1baf7a;--k3:#eda100;--k4:#e87ba4;--k5:#6250d6;--k6:#8c918a;--kres:#118048;--kverlies:#c4322a;--mtd-goed:#1a6e3b;--mtd-goed-bg:#e3f3e8;--mtd-let:#8f5508;--mtd-let-bg:#fcefd9;--mtd-slecht:#b42a23;--mtd-slecht-bg:#fce6e4;--mtd-band:#dbe6ee;--mtd-hoofd:#17643f}
:root[data-theme="dark"] .mtd{color-scheme:dark;--surface:#1c221f;--canvas:#141916;--ink:#eef1ee;--ink-2:#c0c8c2;--ink-3:#a3ada6;--line:#323b36;--n-150:#242b27;--n-200:#2b332e;--n-300:#38423c;--border-strong:#55605a;--info:#8db3d4;--info-50:#22303b;--primary:#59c28b;--k0:#3987e5;--k1:#d95926;--k2:#199e70;--k3:#c98500;--k4:#d55181;--k5:#9085e9;--k6:#8c918a;--kres:#3fa874;--kverlies:#e66767;--mtd-goed:#6fd29b;--mtd-goed-bg:#1b3a29;--mtd-let:#e8ae4d;--mtd-let-bg:#3a2d12;--mtd-slecht:#ff9088;--mtd-slecht-bg:#44211e;--mtd-band:#2e3f4c;--mtd-hoofd:#59c28b;--success:#6fd29b;--error:#ff9088;--warning:#e8ae4d}
.mtd-k0{--k:var(--k0)}.mtd-k1{--k:var(--k1)}.mtd-k2{--k:var(--k2)}.mtd-k3{--k:var(--k3)}.mtd-k4{--k:var(--k4)}.mtd-k5{--k:var(--k5)}.mtd-k6{--k:var(--k6)}.mtd-kres{--k:var(--kres)}.mtd-kverlies{--k:var(--kverlies)}
.mtd-sw{display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--k,#8c918a);flex:0 0 auto}.mtd-sw.verlies{background:repeating-linear-gradient(135deg,var(--kverlies) 0 3px,transparent 3px 5px);border:1px solid var(--kverlies)}.mtd-sw.lijn{height:0;width:14px;border-radius:0;background:none;border-top:3px solid var(--ink,#1b211e)}
.mtd-oordeel{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 8px;border-radius:4px;font-size:13px;font-weight:500;background:var(--n-150,#f1ede5);color:var(--ink-2,#596059)}
.mtd-oordeel.goed{background:var(--mtd-goed-bg);color:var(--mtd-goed)}.mtd-oordeel.let-op{background:var(--mtd-let-bg);color:var(--mtd-let)}.mtd-oordeel.slecht{background:var(--mtd-slecht-bg);color:var(--mtd-slecht)}
.mtd-oordeelrij{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.mtd-oordeelrij>div{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--line,#dfd8cb);border-radius:6px;background:var(--surface,#fff)}
.mtd-or-l{font-size:12px;font-weight:500;color:var(--ink-2,#596059)}.mtd-or-t{font-size:13px;color:var(--ink-2,#596059)}
/* periodetabel: kolommen in de breedte, scrollt alleen binnen de tabel */
.mtd-pt{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}
.mtd-pt table{border-collapse:separate;border-spacing:0;font-size:13px;width:100%}
.mtd-pt th,.mtd-pt td{padding:7px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--n-200,#ece7de);vertical-align:top}
.mtd-pt thead th{font-size:12px;font-weight:500;color:var(--ink-2,#596059);background:var(--surface,#fff)}
.mtd-pt thead th.fc{color:var(--info,#3e5c76)}
.mtd-pt th:first-child{position:sticky;left:0;z-index:1;text-align:left;background:var(--surface,#fff);font-weight:500;padding-right:12px}
.mtd-pt td{font-family:var(--mono,monospace);font-variant-numeric:tabular-nums}
.mtd-pt .tot{border-left:1px solid var(--line,#dfd8cb)}
.mtd-pt tr.kop th,.mtd-pt tr.kop td{font-weight:600}
.mtd-pt td.leeg{color:var(--ink-3,#646a64)}
.mtd-pt-v{display:block}.mtd-pt-fc{display:block;font-size:11px;color:var(--info,#3e5c76)}
.mtd-pt-bar{display:block;height:4px;margin-top:3px;border-radius:2px;background:var(--k,var(--info,#3e5c76));opacity:.9}
.mtd-pt tr.vs td{font-size:12px;border-bottom:0}.mtd-pt tr.vs th{font-size:12px;font-weight:400;color:var(--ink-2,#596059);border-bottom:0}
.mtd-pt td.goed{color:var(--mtd-goed)}.mtd-pt td.slecht{color:var(--mtd-slecht)}
.mtd-pt td.deels .mtd-pt-v::after{content:'*'}
.mtd-pt-bar.j0{background:var(--mtd-hoofd)}.mtd-pt-bar.j1{background:var(--k6)}.mtd-pt-bar.j2{background:var(--n-300,#dfd8cb)}.mtd-pt-bar.kost{background:var(--k6)}.mtd-pt-bar.res{background:var(--kres)}
/* stapel "waar ging de omzet heen" */
.mtd-seg{fill:var(--k);stroke:var(--surface,#fff);stroke-width:2;paint-order:stroke}.mtd-seg.mtd-verlies{fill:url(#mtd-verlies);stroke:var(--kverlies)}
.mtd-verlies-bg{fill:var(--mtd-slecht-bg)}.mtd-verlies-lijn{stroke:var(--kverlies)}
.mtd-omzetlijn{stroke:var(--ink,#1b211e);stroke-width:2.5;stroke-linecap:round}
.mtd-stapel.sel .mtd-seg{stroke:var(--ink,#1b211e);stroke-width:1}.mtd-stapel:not(.sel) .mtd-seg{opacity:.92}
.mtd-hit[aria-pressed=true]{fill:rgba(120,130,125,.10)}
.mtd-sdetail{display:flex;gap:10px}.mtd-sh{margin:6px 0 0;font-size:13px;font-weight:600}
.mtd-s100s{display:flex;flex-direction:column;gap:6px}
.mtd-s100{display:grid;grid-template-columns:96px minmax(0,1fr) auto;align-items:center;gap:10px}.mtd-s100-n{font-size:13px;font-weight:500}.mtd-s100-t{font-size:12px;color:var(--mtd-slecht)}
.mtd-s100-b{display:flex;gap:2px;height:26px;min-width:0}.mtd-s100-d{display:flex;align-items:center;justify-content:center;min-width:2px;background:var(--k);color:#fff;font-size:11px;font-weight:600;border-radius:2px;overflow:hidden}.mtd-s100-d.mtd-k3{color:#0b0b0b}
.mtd-s100-leeg{grid-column:2/4;font-size:12px;color:var(--ink-3,#646a64)}
.mtd-sdetail .mtd-pt th:first-child,.mtd-sdetail .mtd-pt thead th{background:var(--n-150,#f1ede5)}
.mtd-pt td .mtd-oordeel{min-height:20px;font-size:12px;padding:0 6px}
@media(max-width:760px){.mtd-s100{grid-template-columns:minmax(0,1fr);gap:4px}.mtd-s100-leeg{grid-column:1}}
.mtd-l-huidig{stroke-width:4.5;stroke-linecap:round}.mtd-l-vgl{stroke-width:1.75}
.mtd-lijnlabel{font-size:12px;fill:var(--ink-2,#596059)}.mtd-lijnlabel.huidig{font-size:13px;font-weight:700;fill:var(--ink,#1b211e)}.mtd-lijnlabel.prog{fill:var(--info,#3e5c76)}
.mtd-cumzin{display:flex;align-items:center;gap:10px;margin:0;font-size:16px;line-height:22px;font-weight:600;color:var(--ink,#1b211e)}
.mtd-cumzin .pijl{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:4px;font-size:14px;background:var(--n-150,#f1ede5);color:var(--ink-2,#596059)}
.mtd-cumzin.voor .pijl{background:var(--mtd-goed-bg);color:var(--mtd-goed)}.mtd-cumzin.achter .pijl{background:var(--mtd-slecht-bg);color:var(--mtd-slecht)}
@media(prefers-reduced-motion:reduce){.mtd-tegel{transition:none}}
`;
    document.head.appendChild(s);
  }

  // ── Rekenen (los te testen) ──────────────────────────────────────────────
  // Maanden optellen tot één periode; met "eerlijk beeld" telt de correctie (lonen via de bank) als personeelskosten.
  C.som = function (ms, cats, eerlijk) {
    const P = { maanden: 0, ontbrekend: 0, omzet: 0, prognoseRef: 0, kosten: {}, correctie: 0, correctie_soort: { netto: 0, loonheffing: 0, pensioen: 0 }, prive: {}, prive_totaal: 0, aflossing: 0, kas: null, kasStart: null, prognose: 0, prognoseKosten: 0 };
    for (const c of cats) P.kosten[c] = 0;
    for (const m of ms) {
      if (m.prognose) { P.prognose += m.omzet || 0; P.prognoseKosten += m.kosten_totaal || 0; P.prognoseRef += m.kosten_ref || 0; if (m.geen_historie) P.geenHistorie = true; continue; }
      if (!m.maanden) { P.ontbrekend++; continue; }
      P.maanden++; P.omzet += m.omzet || 0;
      for (const c of cats) P.kosten[c] += (m.kosten || {})[c] || 0;
      P.correctie += m.correctie || 0; P.aflossing += m.aflossing || 0;
      for (const [k, x] of Object.entries(m.correctie_soort || {})) if (k in P.correctie_soort) P.correctie_soort[k] += x || 0;
      for (const [n, x] of Object.entries(m.prive || {})) { P.prive[n] = (P.prive[n] || 0) + x; P.prive_totaal += x; }
      if (m.kas) { if (!P.kasStart) P.kasStart = m.kas; P.kas = m.kas; }
    }
    if (eerlijk && P.kosten.personeel != null) P.kosten.personeel += P.correctie;
    P.kosten_totaal = Object.values(P.kosten).reduce((a, x) => a + x, 0);
    P.brutomarge = P.omzet - (P.kosten.materiaal || 0) - (P.kosten.uitbesteed || 0);
    P.brutomarge_pct = P.omzet ? P.brutomarge / P.omzet * 100 : null;
    P.resultaat = P.omzet - P.kosten_totaal;
    return P;
  };
  // Periodes voor een zoomstand. M/K: het gekozen boekjaar; J: elk boekjaar t/m dezelfde maand als nu (eerlijk vergelijken); 5J: hele jaren.
  C.periodes = function (maanden, zoom, jaar, laatsteMaand, prog) {
    const per = new Map(), alle = maanden.concat(prog || []);
    const zet = (k, label, m) => { if (!per.has(k)) per.set(k, { id: k, label, ms: [] }); per.get(k).ms.push(m); };
    if (zoom === 'M' || zoom === 'K') {
      for (let i = 1; i <= 12; i++) { const ym = `${jaar}-${String(i).padStart(2, '0')}`; if (zoom === 'M') per.set(ym, { id: ym, label: MND[i - 1], ms: [] }); else { const k = `${jaar}-K${Math.ceil(i / 3)}`; if (!per.has(k)) per.set(k, { id: k, label: 'K' + Math.ceil(i / 3), ms: [] }); } }
      for (const m of alle) if (m.id.startsWith(jaar + '-')) zet(zoom === 'M' ? m.id : `${jaar}-K${Math.ceil(Number(m.id.slice(5)) / 3)}`, null, m);
    } else {
      const tm = laatsteMaand ? Number(laatsteMaand.slice(5, 7)) : 12, j0 = Number(START.slice(0, 4)), j1 = Number(laatsteMaand ? laatsteMaand.slice(0, 4) : jaar);
      for (let j = j0; j <= j1; j++) per.set(String(j), { id: String(j), label: zoom === 'J' ? `${j} t/m ${MND[tm - 1]}` : String(j), ms: [] });
      for (const m of alle) { if (zoom === 'J' && (m.prognose || Number(m.id.slice(5, 7)) > tm)) continue; if (per.has(m.id.slice(0, 4))) per.get(m.id.slice(0, 4)).ms.push(m); }
    }
    return [...per.values()];
  };
  // Omzetprognose voor de rest van het boekjaar: de termijnen uit de prognose (incl. btw → ≈ excl. ÷ 1,21).
  // Kosten bij die omzet = omzet × (1 − gemiddelde brutomarge) + gemiddelde vaste kosten (afgesloten maanden van dit
  // jaar, anders de laatste 3). Zonder prognose-omzet geen kosten- of resultaatprognose: alleen een referentie (kosten_ref).
  C.prognose = function (maanden, progItems, vandaag, eerlijk, cats) {
    const jaar = vandaag.slice(0, 4), huidig = vandaag.slice(0, 7), uit = [];
    const dicht = maanden.filter(m => m.maanden && m.id < huidig), ditJaar = dicht.filter(m => m.id.startsWith(jaar + '-'));
    const basis = ditJaar.length >= 3 ? ditJaar : dicht.slice(-3);
    const S = basis.map(m => C.som([m], cats, eerlijk)), som = f => S.reduce((a, P) => a + f(P), 0);
    const kostGem = S.length ? som(P => P.kosten_totaal) / S.length : null;
    const marge = som(P => P.omzet) > 0 ? som(P => P.brutomarge) / som(P => P.omzet) : null;              // gemiddelde brutomarge (fractie)
    const vast = S.length ? Math.max(0, som(P => P.kosten_totaal - (P.kosten.materiaal || 0) - (P.kosten.uitbesteed || 0)) / S.length) : null;   // gemiddelde vaste kosten per maand
    for (let i = Number(huidig.slice(5)) + 1; i <= 12; i++) {
      const ym = `${jaar}-${String(i).padStart(2, '0')}`; let omzet = 0, n = 0;
      for (const it of Object.values(progItems || {})) {
        if (!it || it.soort !== 'project' || it.aan === false) continue;
        for (const t of it.termijnen || []) if (t.aan !== false && String(t.factuurdatum || '').slice(0, 7) === ym) { omzet += (t.bedrag || 0) / BTW; n++; }
      }
      const r2 = x => Math.round(x * 100) / 100, kanRekenen = marge != null && vast != null, kosten = omzet > 0 && kanRekenen ? Math.max(0, omzet * (1 - marge) + vast) : 0;
      // zonder historie geen kosten- of resultaatprognose (anders een misleidend positief resultaat)
      uit.push({ id: ym, prognose: true, omzet: r2(omzet), kosten_totaal: r2(kosten), kosten_ref: omzet > 0 || kostGem == null ? 0 : r2(kostGem), termijnen: n, geen_historie: omzet > 0 && !kanRekenen });
    }
    return { maanden: uit, kostenBasis: basis.length, marge, vast };
  };
  // Waterval: omzet → brutomarge → resultaat → na opnames → na aflossing → werkelijke kasmutatie (rest = btw, debiteuren e.d.).
  // De kasmutatie loopt van de stand vóór de periode (eind van de maand ervoor) tot het eind van de periode; zonder
  // die beginstand geen kasmutatie-stap.
  C.waterval = function (P, kasVoor) {
    const stappen = [{ id: 'omzet', label: 'Omzet', kort: 'omzet', w: P.omzet, totaal: true },
      { id: 'inkoop', label: 'Materiaal en uitbesteed', kort: 'inkoop', w: -((P.kosten.materiaal || 0) + (P.kosten.uitbesteed || 0)) }, { id: 'marge', label: 'Brutomarge', kort: 'marge', w: P.brutomarge, totaal: true },
      { id: 'overig', label: 'Overige kosten', kort: 'overig', w: -(P.kosten_totaal - (P.kosten.materiaal || 0) - (P.kosten.uitbesteed || 0)) }, { id: 'resultaat', label: 'Resultaat', kort: 'resultaat', w: P.resultaat, totaal: true },
      { id: 'prive', label: 'Privé-opnames', kort: 'opnames', w: -P.prive_totaal }, { id: 'aflossing', label: 'Aflossing', kort: 'aflossing', w: -P.aflossing }];
    const naOp = P.resultaat - P.prive_totaal - P.aflossing;
    stappen.push({ id: 'vrij', label: 'Over na opnames en aflossing', kort: 'over', w: naOp, totaal: true });
    if (P.kas && kasVoor && P.kas.met_btw != null && kasVoor.met_btw != null) {
      const mut = P.kas.met_btw - kasVoor.met_btw;
      stappen.push({ id: 'rest', label: 'Btw, debiteuren, afschrijving e.d.', kort: 'btw e.d.', w: mut - naOp, rest: true }, { id: 'kas', label: 'Kasmutatie (lopend + BTW-pot)', kort: 'kas', w: mut, totaal: true });
    }
    return stappen;
  };

  // ── Laden ────────────────────────────────────────────────────────────────
  C.mount = async function (el, opt) {
    st.el = el; st.bron = opt.bron; st.mag = !!opt.magWijzigen; st.wie = opt.wie || ''; st.opHorizon = opt.opHorizon || null; st.horizon = opt.horizon || st.horizon;
    st.vandaag = opt.vandaag || new Date().toISOString().slice(0, 10); st.jaar = st.jaar || Number(st.vandaag.slice(0, 4));
    st.eerlijk = ls.get('mtc:eerlijk:' + st.wie) !== '0';
    st.vgl = C.vglLees(ls.get('mtc:vgl:' + st.wie), mobiel());
    besteedBewaak(); css(); teken();
    if (!C._wachtLuisteraar && typeof document !== 'undefined' && document.addEventListener) { C._wachtLuisteraar = true; document.addEventListener('focusout', () => setTimeout(verwerkWacht, 0)); try { new MutationObserver(() => verwerkWacht()).observe(document.body, { childList: true }); } catch (e) { } }   // een uitgestelde herschildering verwerken zodra het blad dicht of het invoerveld los is
    if (!C._resize && root.addEventListener) { let tm = null; C._resize = true; root.addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (st.el && st.el.isConnected && st.maanden.length && Math.abs(((st.el.clientWidth || 640) - 24) - BR) > 24) teken(); }, 200); }); }
    if (!st.maanden.length && !st.laden) await C.laad();
    else besteedLaad();
  };
  C.laad = async function (herbouw) {
    st.laden = true; st.rondes = 0; st.fout = null; const mislukt = new Set();
    const [prog] = await Promise.all([st.bron.haal('/geld/prognose').catch(() => null)]);
    st.prognoseRuw = prog && prog.items ? prog.items : {};
    for (;;) {
      const r = await st.bron.haal(`/geld/cijfers?per=maand&van=${START}&tot=${st.vandaag.slice(0, 7)}${herbouw && !st.rondes ? '&herbouw=' + encodeURIComponent(herbouw) : ''}`);
      if (!r || r.error) { st.fout = (r && r.error) || 'geen antwoord'; break; }
      st.maanden = r.perioden || []; st.cats = (r.categorieen || []).map(c => c.id); st.catNaam = Object.fromEntries((r.categorieen || []).map(c => [c.id, c.naam]));
      st.bm = r.benchmarks || {}; st.bmBron = r.benchmarks_bron; st.ontbrekend = r.ontbrekend || []; st.correctieVan = r.correctie_van; st.voorstel = r.indeling_voorstel || 0;
      st.nietIngedeeld = r.niet_ingedeeld || []; st.waarsch = r.waarschuwingen || []; st.equityOver = r.equity_niet_ingedeeld || [];
      (r.mislukt || []).forEach(m => mislukt.add(m)); st.mislukt = [...mislukt].filter(m => st.ontbrekend.includes(m)).sort();
      teken();
      // stoppen als alles wat nog ontbreekt al eens mislukte (Moneybird gaf het niet): niet blijven proberen
      if (r.compleet || st.ontbrekend.every(m => mislukt.has(m)) || ++st.rondes >= MAX_RONDES || !st.el || !st.el.isConnected) break;
      await new Promise(res => setTimeout(res, C._pauze == null ? 1500 : C._pauze));
    }
    st.laden = false; teken();
    kasPrognose();
    besteedLaad();
  };
  // Kasprognose uit de geldtijdlijn (zelfde rekenregels), alleen als het geldscherm geladen is.
  async function kasPrognose() {
    if (!root.MTGeld || !root.MTGeld.lijn) return;
    try {
      const v = st.vandaag, d = await st.bron.haal(`/geld/tijdlijn?van=${C._dag(v, -35)}&tot=${C._dag(v, 364)}`); if (!d || d.error || !d.events) return;
      const met = root.MTGeld.lijn(d, { modus: 'lopend', prognose: true }).punten, zonder = root.MTGeld.lijn(d, { modus: 'lopend', prognose: true, groep: ['lopend'] }).punten;
      const uit = [];
      for (let i = Number(v.slice(5, 7)); i <= 12; i++) {
        const ym = `${v.slice(0, 4)}-${String(i).padStart(2, '0')}`, eind = C._eind(ym), p = met.filter(x => x.datum <= eind && !x.verleden).pop(), q = zonder.filter(x => x.datum <= eind && !x.verleden).pop();
        if (p) uit.push({ id: ym, met_btw: p.saldo, lopend: q ? q.saldo : null });
      }
      st.kasProg = uit; teken();
    } catch (e) { }
  }
  C._maandPlus = (ym, n) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
  C._dag = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  C._eind = ym => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
  // Een rapportsectie opent de grafiek in context.
  C.toon = function (g) {
    if (!g) return;
    st.weergave = REEKS_NAAR[g.reeks] || 'omzet_kosten'; st.focusCat = g.categorie || null;
    if (g.per) st.zoom = g.per === 'kwartaal' ? 'K' : g.per === 'jaar' ? '5J' : 'M';
    if (g.van && /^\d{4}/.test(g.van)) st.jaar = Number(g.van.slice(0, 4));
    st.sel = null; st.vast = null;
    // Een rapportsectie wijst een grafiek aan: de bijbehorende tegel gaat open (omzet en kosten staan in Resultaat, opnames en waterval bij Kaspositie).
    const naarPaneel = { omzet_kosten: g.categorie ? 'resultaat' : null, brutomarge: 'brutomarge', kosten_pct: 'brutomarge', opnames: 'opnames', kas: 'kas', waterval: 'kas' }[st.weergave];
    if (st.paneel && !naarPaneel) st.paneel = null;
    teken();
    if (naarPaneel && st.maanden.length) { st.paneel = naarPaneel; st.paneelNieuw = true; st.openerFk = null; tekenPaneel(); }
  };
  C.horizon = function (h) { st.horizon = h; teken(); };
  // Voor de tests (zonder DOM): de tekenfuncties op de huidige staat.
  C._laadTop = () => laadTop();
  C._grafiekHtml = (g) => grafiekHtml(huidigePeriodes(), g);

  // ── Tekenen ──────────────────────────────────────────────────────────────
  // laatste afgesloten maand: de lopende maand is nog niet compleet en telt niet mee in vergelijkingen en kerncijfers
  const laatste = () => { const h = st.vandaag.slice(0, 7), m = st.maanden.filter(x => x.maanden && x.id < h).map(x => x.id).sort(); return m[m.length - 1] || null; };
  function huidigePeriodes() {
    const prog = st.jaar === Number(st.vandaag.slice(0, 4)) && (st.zoom === 'M' || st.zoom === 'K' || st.zoom === '5J') ? C.prognose(st.maanden, st.prognoseRuw, st.vandaag, st.eerlijk, st.cats).maanden : [];
    return C.periodes(st.maanden, st.zoom, st.jaar, laatste(), prog).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, st.eerlijk) }));
  }
  // ── Dashboard: bouwstenen, tegelmodel, statuspaneel en feitzinnen (rekenen los te testen, zonder DOM) ──
  const NS = 'http://www.w3.org/2000/svg';
  function bouw(svgMode, tag, attrs, kids) {
    const e = svgMode ? document.createElementNS(NS, tag) : document.createElement(tag);
    for (const k of Object.keys(attrs || {})) { const v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'text') e.textContent = String(v); else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : String(v)); }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const ee = (tag, attrs, ...kids) => bouw(false, tag, attrs, kids);      // HTML-element (tekst via textContent: nooit ruwe HTML)
  const ss = (tag, attrs, ...kids) => bouw(true, tag, attrs, kids);       // SVG-element
  const d2 = n => String(n).padStart(2, '0');
  const MAANDLANG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const maandLang = ym => `${MAANDLANG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const dagKort = ym => `${Number(C._eind(ym).slice(8))} ${MND[Number(ym.slice(5, 7)) - 1]}`;
  const tmVan = (jaar, lm) => { if (!lm) return 0; const ly = Number(lm.slice(0, 4)); return jaar < ly ? 12 : jaar === ly ? Number(lm.slice(5, 7)) : 0; };   // t/m welke maand het boekjaar afgesloten is
  const dPct = (a, b) => a == null || b == null || !b ? null : (a - b) / Math.abs(b) * 100;
  const pctTeken = p => p == null ? '' : (p >= 0 ? '+' : '−') + Math.abs(p).toLocaleString('nl-NL', { maximumFractionDigits: 0 }) + '%';
  const puntTeken = x => x == null ? '' : (x >= 0 ? '+' : '−') + Math.abs(x).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // chip "▲ 13,3% t.o.v. 2025": pijl, tekst en oordeel (goed/slecht/neutraal). punten = verschil in procentpunten i.p.v. percentage.
  const chipVan = (d, vs, opt) => { if (d == null || !isFinite(d)) return null; const op = (opt && opt.hogerIsGoed) !== false, nul = Math.abs(d) < 0.05;
    return { pijl: nul ? '' : d > 0 ? '▲' : '▼', tekst: (opt && opt.punt ? Math.abs(d).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' punt' : pct(Math.abs(d))) + ' t.o.v. ' + vs, goed: nul || (opt && opt.neutraal) ? null : (d > 0) === op }; };
  // De drie vergelijk-schakelaars (jaar−1, jaar−2, branche): onthouden per gebruiker.
  C.vglLees = (tekst, mob) => { const t = tekst == null ? null : String(tekst); return t && /^[01]{3}$/.test(t) ? { j1: t[0] === '1', j2: t[1] === '1', b: t[2] === '1' } : { j1: true, j2: !mob, b: true }; };
  C.vglTekst = v => (v.j1 ? '1' : '0') + (v.j2 ? '1' : '0') + (v.b ? '1' : '0');
  const vglOffsets = () => [st.vgl.j1 ? 1 : 0, st.vgl.j2 ? 2 : 0].filter(Boolean);

  // Verwachte omzet per maand uit de termijnen in de prognose (excl. btw). Vanaf de lopende maand; in de lopende maand alleen termijnen na vandaag.
  C.forecastMaanden = function (progItems, vandaag, n) {
    const huidig = vandaag.slice(0, 7), uit = [];
    for (let k = 0; k < n; k++) {
      const ym = C._maandPlus(huidig, k); let omzet = 0, nT = 0;
      for (const it of Object.values(progItems || {})) {
        if (!it || it.soort !== 'project' || it.aan === false) continue;
        for (const t of it.termijnen || []) { const fd = String(t.factuurdatum || ''); if (t.aan !== false && fd.slice(0, 7) === ym && (k > 0 || fd > vandaag)) { omzet += (t.bedrag || 0) / BTW; nT++; } }
      }
      uit.push({ id: ym, omzet: Math.round(omzet * 100) / 100, termijnen: nT });
    }
    return uit;
  };
  // Sparkline: pad-tekst per reeks op één gedeelde schaal (alle reeksen samen), viewBox 120×40. null = onderbreking.
  C.sparkPaden = function (reeksen) {
    const w = C.verzamel(Object.values(reeksen).filter(Boolean)); if (!w.length) return null;
    let lo = Math.min(...w), hi = Math.max(...w); if (hi === lo) { lo -= 1; hi += 1; }
    const uit = {};
    for (const [k, r] of Object.entries(reeksen)) { if (!r) continue; const L = Math.max(1, r.length - 1); let d = '', open = false;
      r.forEach((v, i) => { if (typeof v !== 'number' || !isFinite(v)) { open = false; return; } d += (open ? 'L' : 'M') + (i / L * 120).toFixed(1) + ' ' + (36 - (v - lo) / (hi - lo) * 32).toFixed(1) + ' '; open = true; });
      uit[k] = d.trim(); }
    return uit;
  };
  const rij = (l, v, d, o) => Object.assign({ l, v: v == null ? '—' : v, d: d || '', goed: null, soort: null, streep: 'geen' }, o || {});

  // Het model van de zes tegels (en hun detailpaneel) voor het gekozen boekjaar. Alleen echte gegevens; wat ontbreekt blijft "—" of valt weg.
  function tegelModel() {
    const lm = laatste(); if (!lm) return [];
    const jaar = st.jaar, j1 = jaar - 1, j2 = jaar - 2, tm = tmVan(jaar, lm), cats = st.cats, eerl = st.eerlijk, huidig = st.vandaag.slice(0, 7), isNu = jaar === Number(huidig.slice(0, 4));
    const kies = (j, t) => st.maanden.filter(m => m.maanden && !m.prognose && m.id.startsWith(j + '-') && Number(m.id.slice(5, 7)) <= t);
    const som = (j) => { const ms = kies(j, tm); return ms.length === tm && tm > 0 ? C.som(ms, cats, eerl) : null; };   // alleen een vergelijking als alle maanden er zijn
    const A = C.som(kies(jaar, tm), cats, eerl), B = jaar > Number(START.slice(0, 4)) ? som(j1) : null, B2 = som(j2);
    const reeks = (j, f) => { const t = j === jaar ? tm : 12; return Array.from({ length: 12 }, (_, i) => { const m = st.maanden.find(x => x.id === `${j}-${d2(i + 1)}`); return m && m.maanden && !m.prognose && i + 1 <= t ? f(C.som([m], cats, eerl), m) : null; }); };
    const prog = isNu ? C.prognose(st.maanden, st.prognoseRuw, st.vandaag, eerl, cats) : null, progMnd = prog ? prog.maanden : [];
    const progOmzet = progMnd.reduce((a, m) => a + m.omzet, 0), lopend = st.maanden.find(m => m.id === huidig && m.maanden && !m.prognose);
    const fcTot = isNu ? C.forecastMaanden(st.prognoseRuw, st.vandaag, 1)[0].omzet + progOmzet : 0;   // verwacht na vandaag: termijnen in de lopende maand + de latere maanden
    const verwacht = isNu && fcTot > 0 && C._maandPlus(lm, 1) === huidig && tm > 0 ? A.omzet + (lopend ? lopend.omzet || 0 : 0) + fcTot : null;
    const progReeks = (f) => { const r = Array(12).fill(null); if (!progMnd.length || tm < 1) return null; const huidigeW = f(null); r[tm - 1] = huidigeW; let heeft = false;
      for (const m of progMnd) if (m.omzet > 0) { const v = f(m); if (v != null) { r[Number(m.id.slice(5, 7)) - 1] = v; heeft = true; } } return heeft ? r : null; };
    const t = [];
    // Omzet
    {
      const oRij = [];
      if (B) oRij.push(rij(String(j1), kort(B.omzet), pctTeken(dPct(A.omzet, B.omzet)), { soort: 'j1', streep: 'dashed', goed: A.omzet >= B.omzet }));
      if (B2) oRij.push(rij(String(j2), kort(B2.omzet), pctTeken(dPct(A.omzet, B2.omzet)), { soort: 'j2', streep: 'dotted', goed: A.omzet >= B2.omzet }));
      if (verwacht != null) oRij.push(rij('Verwacht jaar', kort(verwacht), 'forecast', { soort: 'prog', streep: 'prog' }));
      const huid = reeks(jaar, P => P.omzet), vorig = B || reeks(j1, P => P.omzet).some(v => v != null) ? reeks(j1, P => P.omzet) : null;
      const pr = progReeks(m => m ? m.omzet : huid[tm - 1]);
      t.push({ id: 'omzet', label: 'Omzet', waarde: kort(A.omzet), sub: tm ? `jan t/m ${MND[tm - 1]}` : '', chip: B ? chipVan(dPct(A.omzet, B.omzet), j1) : null, rijen: oRij, spark: tm ? C.sparkPaden({ vorig, huidig: huid, prog: pr }) : null, klik: true, breed: true,
        kpis: [{ l: `Omzet t/m ${MND[Math.max(0, tm - 1)]}`, v: kort(A.omzet), s: B ? `${B.omzet <= A.omzet ? '▲' : '▼'} ${kort(Math.abs(A.omzet - B.omzet))} t.o.v. ${j1}` : '', goed: B ? A.omzet >= B.omzet : null },
          { l: `Zelfde periode ${j1}`, v: B ? kort(B.omzet) : '—', s: B ? pctTeken(dPct(A.omzet, B.omzet)) : 'niet alle maanden aanwezig' }, { l: `Zelfde periode ${j2}`, v: B2 ? kort(B2.omzet) : '—', s: B2 ? pctTeken(dPct(A.omzet, B2.omzet)) : 'niet alle maanden aanwezig' },
          { l: 'Verwacht jaartotaal', v: verwacht != null ? kort(verwacht) : '—', s: verwacht != null ? 'forecast' : 'geen forecast', prog: verwacht != null }] });
    }
    // Brutomarge
    {
      const bm = st.bm.brutomarge, mid = bmMid(bm), bRij = [];
      if (B && B.omzet) bRij.push(rij(String(j1), pct(B.brutomarge_pct), puntTeken(A.brutomarge_pct - B.brutomarge_pct), { soort: 'j1', streep: 'dashed', goed: A.brutomarge_pct >= B.brutomarge_pct }));
      if (B2 && B2.omzet) bRij.push(rij(String(j2), pct(B2.brutomarge_pct), puntTeken(A.brutomarge_pct - B2.brutomarge_pct), { soort: 'j2', streep: 'dotted', goed: A.brutomarge_pct >= B2.brutomarge_pct }));
      if (bm && mid != null && A.omzet) bRij.push(rij('Branche', bmTekst(bm), puntTeken(A.brutomarge_pct - mid), { soort: 'b', streep: 'brons', goed: A.brutomarge_pct >= mid }));
      const f = P => P.omzet ? P.brutomarge_pct : null;
      t.push({ id: 'brutomarge', label: 'Brutomarge', waarde: A.omzet ? pct(A.brutomarge_pct) : '—', sub: A.omzet ? `${kort(A.brutomarge)} na materiaal en uitbesteed` : '', chip: B && B.omzet && A.omzet ? chipVan(A.brutomarge_pct - B.brutomarge_pct, j1, { punt: true }) : null, rijen: bRij, spark: C.sparkPaden({ vorig: reeks(j1, f), huidig: reeks(jaar, f) }), klik: true,
        kpis: [{ l: 'Brutomarge', v: A.omzet ? pct(A.brutomarge_pct) : '—', s: A.omzet ? kort(A.brutomarge) : '' }, { l: `Zelfde periode ${j1}`, v: B && B.omzet ? pct(B.brutomarge_pct) : '—', s: '' }, { l: `Zelfde periode ${j2}`, v: B2 && B2.omzet ? pct(B2.brutomarge_pct) : '—', s: '' }, { l: 'Branche', v: bm ? bmTekst(bm) : '—', s: bm && bm.bron ? String(bm.bron) : '' }] });
    }
    // Resultaat (eerlijk beeld als dat aan staat)
    {
      const rb = st.bm.resultaat, rmid = bmMid(rb), rpct = P => P && P.omzet ? P.resultaat / P.omzet * 100 : null, rRij = [];
      const regel = P => `${kort(P.resultaat)}${P.omzet ? ' · ' + pct(rpct(P)) : ''}`;
      if (B) rRij.push(rij(String(j1), regel(B), pctTeken(dPct(A.resultaat, B.resultaat)), { soort: 'j1', streep: 'dashed', goed: A.resultaat >= B.resultaat }));
      if (B2) rRij.push(rij(String(j2), regel(B2), pctTeken(dPct(A.resultaat, B2.resultaat)), { soort: 'j2', streep: 'dotted', goed: A.resultaat >= B2.resultaat }));
      if (rb && rmid != null && A.omzet) rRij.push(rij('Branche', bmTekst(rb), puntTeken(rpct(A) - rmid), { soort: 'b', streep: 'brons', goed: rpct(A) >= rmid }));
      const huid = reeks(jaar, P => P.resultaat), pr = progReeks(m => m ? (m.geen_historie ? null : m.omzet - m.kosten_totaal) : huid[tm - 1]);
      t.push({ id: 'resultaat', label: eerl && A.correctie ? 'Resultaat · eerlijk beeld' : 'Resultaat', waarde: kort(A.resultaat), sub: A.omzet ? `${pct(rpct(A))} van de omzet` : '', chip: B ? chipVan(dPct(A.resultaat, B.resultaat), j1) : null, rijen: rRij, spark: tm ? C.sparkPaden({ vorig: reeks(j1, P => P.resultaat), huidig: huid, prog: pr }) : null, klik: true,
        kpis: [{ l: 'Resultaat', v: kort(A.resultaat), s: A.omzet ? pct(rpct(A)) + ' van de omzet' : '' }, { l: `Zelfde periode ${j1}`, v: B ? kort(B.resultaat) : '—', s: B ? pctTeken(dPct(A.resultaat, B.resultaat)) : '' }, { l: `Zelfde periode ${j2}`, v: B2 ? kort(B2.resultaat) : '—', s: B2 ? pctTeken(dPct(A.resultaat, B2.resultaat)) : '' }, { l: 'Branche', v: rb ? bmTekst(rb) : '—', s: rb && rb.bron ? String(rb.bron) : '' }] });
    }
    // Komende 3 maanden (forecast, altijd vanaf vandaag, los van het gekozen boekjaar)
    {
      const fm = C.forecastMaanden(st.prognoseRuw, st.vandaag, 3), tot = fm.reduce((a, m) => a + m.omzet, 0), terug = k => { const ms = fm.map(m => st.maanden.find(x => x.id === `${Number(m.id.slice(0, 4)) - k}${m.id.slice(4)}` && x.maanden && !x.prognose)); return ms.every(Boolean) ? ms.reduce((a, m) => a + (m.omzet || 0), 0) : null; };
      const v1 = terug(1), v2 = terug(2), kRij = fm.map(m => rij(maandNaam(m.id), m.omzet > 0 ? kort(m.omzet) : '—', '', { soort: 'prog', streep: 'prog' }));
      if (tot > 0 && v1 != null) kRij.push(rij('Geboekt ' + (Number(huidig.slice(0, 4)) - 1), kort(v1), pctTeken(dPct(tot, v1)), { soort: 'j1', streep: 'dashed', goed: tot >= v1 }));
      if (tot > 0 && v2 != null) kRij.push(rij('Geboekt ' + (Number(huidig.slice(0, 4)) - 2), kort(v2), pctTeken(dPct(tot, v2)), { soort: 'j2', streep: 'dotted', goed: tot >= v2 }));
      t.push({ id: 'komende', label: 'Komende 3 maanden', waarde: tot > 0 ? kort(tot) : '—', sub: tot > 0 ? `${MND[Number(fm[0].id.slice(5, 7)) - 1]} t/m ${MND[Number(fm[2].id.slice(5, 7)) - 1]} · verwachting uit forecast` : 'geen termijnen in de forecast', forecast: true, chip: tot > 0 && v1 != null ? chipVan(dPct(tot, v1), 'vorig jaar') : null, rijen: kRij,
        spark: tot > 0 ? C.sparkPaden({ vorig: v1 != null ? fm.map(m => { const x = st.maanden.find(q => q.id === `${Number(m.id.slice(0, 4)) - 1}${m.id.slice(4)}`); return x && x.maanden ? x.omzet : null; }) : null, prog: fm.map(m => m.omzet > 0 ? m.omzet : null) }) : null, klik: true, breed: true, fm, tot, v1, v2,
        kpis: [{ l: 'Verwacht, komende 3 maanden', v: tot > 0 ? kort(tot) : '—', s: 'forecast', prog: true }].concat(fm.map(m => ({ l: maandNaam(m.id), v: m.omzet > 0 ? kort(m.omzet) : '—', s: 'forecast', prog: true }))) });
    }
    // Kaspositie (stand op het maandeinde, lopend + btw-pot)
    {
      const kasM = (j) => { const m = st.maanden.find(x => x.id === `${j}-${d2(tm)}`); return m && m.maanden && !m.prognose && m.kas && m.kas.met_btw != null ? m.kas : null; };
      const k0 = tm ? kasM(jaar) : null, k1 = tm ? kasM(j1) : null, k2 = tm ? kasM(j2) : null, f = P => P.kas && P.kas.met_btw != null ? P.kas.met_btw : null, kRij = [];
      const mn = MND[Math.max(0, tm - 1)];
      if (k0 && k1) kRij.push(rij(`Eind ${mn} ${j1}`, kort(k1.met_btw), pctTeken(dPct(k0.met_btw, k1.met_btw)), { soort: 'j1', streep: 'dashed', goed: k0.met_btw >= k1.met_btw }));
      if (k0 && k2) kRij.push(rij(`Eind ${mn} ${j2}`, kort(k2.met_btw), pctTeken(dPct(k0.met_btw, k2.met_btw)), { soort: 'j2', streep: 'dotted', goed: k0.met_btw >= k2.met_btw }));
      if (k0 && k0.lopend != null) kRij.push(rij('Lopend, zonder btw', kort(k0.lopend), '', { streep: 'geen' }));
      const kp = isNu && st.kasProg && st.kasProg.length ? Array.from({ length: 12 }, (_, i) => { const q = st.kasProg.find(x => x.id === `${jaar}-${d2(i + 1)}`); return q && i + 1 >= tm && q.met_btw != null ? q.met_btw : null; }) : null;
      if (kp && tm) kp[tm - 1] = k0 ? k0.met_btw : null;
      const verschil = k0 && k1 ? k0.met_btw - k1.met_btw : null;
      t.push({ id: 'kas', label: 'Kaspositie', waarde: k0 ? kort(k0.met_btw) : '—', sub: k0 ? `eind ${mn}, incl. btw-pot${k0.lopend != null ? ' · lopend ' + kort(k0.lopend) : ''}` : '', chip: verschil != null ? { pijl: verschil >= 0 ? '▲' : '▼', tekst: `${kort(Math.abs(verschil))} ${verschil >= 0 ? 'meer' : 'minder'} dan eind ${mn} ${j1}`, goed: verschil >= 0 } : null, rijen: kRij,
        spark: tm ? C.sparkPaden({ vorig: reeks(j1, f), huidig: reeks(jaar, f), prog: kp && kp.some(v => v != null) ? kp : null }) : null, klik: true,
        kpis: [{ l: 'Kas incl. btw-pot', v: k0 ? kort(k0.met_btw) : '—', s: `eind ${mn}` }, { l: 'Waarvan lopend', v: k0 && k0.lopend != null ? kort(k0.lopend) : '—', s: 'zonder btw-pot' }, { l: `Eind ${mn} ${j1}`, v: k1 ? kort(k1.met_btw) : '—', s: k0 && k1 ? pctTeken(dPct(k0.met_btw, k1.met_btw)) : '' }, { l: `Opnames ${jaar}`, v: kort(A.prive_totaal), s: Object.entries(A.prive).map(([n, x]) => n + ' ' + kort(x)).join(' · ') || '—' }] });
    }
    // Opnames (privé, per eigenaar): geboekte opnames t/m de laatste afgesloten maand, tegenover hetzelfde deel van vorige jaren.
    // (Een Debiteuren-tegel is er niet: de worker levert geen openstaande verkoopfacturen.)
    {
      const oRij = [], namen = Object.entries(A.prive).filter(([, x]) => x > 0), f = P => P.prive_totaal;
      if (B) oRij.push(rij(String(j1), kort(B.prive_totaal), pctTeken(dPct(A.prive_totaal, B.prive_totaal)), { soort: 'j1', streep: 'dashed' }));
      if (B2) oRij.push(rij(String(j2), kort(B2.prive_totaal), pctTeken(dPct(A.prive_totaal, B2.prive_totaal)), { soort: 'j2', streep: 'dotted' }));
      if (A.aflossing > 0) oRij.push(rij('Aflossing', kort(A.aflossing), '', { streep: 'geen' }));
      t.push({ id: 'opnames', label: 'Opnames', waarde: kort(A.prive_totaal), sub: namen.length ? namen.map(([n, x]) => n + ' ' + kort(x)).join(' · ') : (tm ? 'jan t/m ' + MND[tm - 1] : ''), chip: B && B.prive_totaal ? chipVan(dPct(A.prive_totaal, B.prive_totaal), j1, { neutraal: true }) : null, rijen: oRij,
        spark: tm ? C.sparkPaden({ vorig: reeks(j1, f), huidig: reeks(jaar, f) }) : null, klik: true,
        kpis: [{ l: `Opnames t/m ${MND[Math.max(0, tm - 1)]}`, v: kort(A.prive_totaal), s: namen.map(([n, x]) => n + ' ' + kort(x)).join(' · ') }, { l: `Zelfde periode ${j1}`, v: B ? kort(B.prive_totaal) : '—', s: B ? pctTeken(dPct(A.prive_totaal, B.prive_totaal)) : '' }, { l: `Zelfde periode ${j2}`, v: B2 ? kort(B2.prive_totaal) : '—', s: B2 ? pctTeken(dPct(A.prive_totaal, B2.prive_totaal)) : '' }, { l: 'Aflossing', v: kort(A.aflossing), s: `t/m ${MND[Math.max(0, tm - 1)]}` }] });
    }
    t.A = A; t.B = B; t.B2 = B2; t.tm = tm; t.lm = lm; t.verwacht = verwacht;
    return t;
  }
  C._tegels = tegelModel;

  // Wat er bij "Gegevens t/m …" in het statuspaneel staat: aandachtspunten (tellen mee) en toelichting (uitleg bij de cijfers).
  C.statusItems = function () {
    const aandacht = [], uitleg = [], lm = laatste(), pl = (n, e, m) => n === 1 ? e : m;
    const nogTeGaan = st.ontbrekend.length - (st.mislukt || []).length;
    if (nogTeGaan > 0) aandacht.push(`Historie wordt opgebouwd: nog ${nogTeGaan} ${pl(nogTeGaan, 'maand', 'maanden')} te gaan${st.laden ? '…' : ' (ververs later)'}. Totalen over oudere jaren kunnen daardoor nog onvolledig zijn.`);
    if (st.voorstel) aandacht.push(`${st.voorstel} ${pl(st.voorstel, 'grootboek', 'grootboeken')} ingedeeld volgens het voorstel${st.mag ? ' — controleer de indeling (⚙ Indeling)' : ''}.`);
    if ((st.equityOver || []).length) aandacht.push(`Privé-opnames: alleen rekeningen met privé, opname of onttrek in de naam tellen nu mee. Niet ingedeeld: ${st.equityOver.join(', ')}${st.mag ? ' — kies in ⚙ Indeling' : ''}.`);
    if ((st.mislukt || []).length) aandacht.push(`${st.mislukt.length} ${pl(st.mislukt.length, 'maand kon', 'maanden konden')} niet worden opgehaald (${st.mislukt.map(maandNaam).join(', ')}) — probeer later opnieuw.`);
    if (st.fout && st.maanden.length) aandacht.push('Laatste aanvulling mislukte: ' + st.fout);
    for (const w of st.waarsch || []) { const x = typeof w === 'string' ? w : w && (w.tekst || w.melding || w.bericht); if (x) aandacht.push(String(x)); }
    if ((st.nietIngedeeld || []).length) aandacht.push(`Niet ingedeeld: ${st.nietIngedeeld.map(x => typeof x === 'string' ? x : (x && (x.naam || x.ledger)) || '').filter(Boolean).join(', ')}.`);
    const pr = C.prognose(st.maanden, st.prognoseRuw, st.vandaag, st.eerlijk, st.cats), zonderOmzet = pr.maanden.filter(m => m.kosten_ref && !m.omzet);
    if (pr.maanden.some(m => m.geen_historie)) aandacht.push('Onvoldoende historie voor een prognose van kosten en resultaat: alleen de verwachte omzet staat in de forecast.');
    if (zonderOmzet.length) aandacht.push(`${zonderOmzet.map(m => maandNaam(m.id)).join(', ')}: omzet nog niet bekend — zet projecten in de prognose. De gemiddelde kosten zijn alleen een referentie, geen verlies.`);
    if (lm) uitleg.push(`Kerncijfers tellen t/m ${dagKort(lm)}: alleen afgesloten maanden. De lopende maand is nog niet compleet en staat lichter en gestreept in de grafiek (met een *).`);
    const A = lm ? C.som(st.maanden.filter(m => m.maanden && !m.prognose && m.id.startsWith(st.jaar + '-') && m.id <= lm), st.cats, st.eerlijk) : null;
    uitleg.push(st.eerlijk ? `Eerlijk beeld staat aan: lonen die via de bank zijn betaald maar niet in de W&V staan, tellen mee als personeelskosten${st.correctieVan ? ' (vanaf ' + maandNaam(st.correctieVan) + ')' : ''}${A && A.correctie ? '. In ' + st.jaar + ' tot nu toe ' + kort(A.correctie) : ''}. Opnames van de eigenaren tellen nooit mee.`
      : 'Eerlijk beeld staat uit: het resultaat is zoals het in de W&V staat, zonder de lonen die alleen via de bank zijn betaald.');
    uitleg.push('Brutomarge = omzet − materiaal − uitbesteed werk, als % van de omzet.');
    uitleg.push(`Forecast: omzet uit de termijnen in de prognose (≈ excl. 21% btw); kosten = omzet × (1 − gemiddelde brutomarge${pr.marge != null ? ' ' + pct(pr.marge * 100) : ''}) + gemiddelde vaste kosten${pr.vast != null ? ' ' + kort(pr.vast) : ''}/mnd, uit ${pr.kostenBasis} afgesloten ${pl(pr.kostenBasis, 'maand', 'maanden')}. Forecast telt nooit mee in de kerncijfers en is altijd gestippeld of gearceerd.`);
    uitleg.push('Komende 3 maanden = termijnen in de prognose met factuurdatum na vandaag (lopende maand + 2 maanden), omzet excl. btw. Het is een verwachting uit de forecast, niet ontdubbeld met boekingen: een termijn die al is gefactureerd kan er nog in staan (de prognose weet niet welke termijnen al gefactureerd zijn). Hetzelfde geldt voor Verwacht jaar en de forecast-staven.');
    if (st.bm && Object.keys(st.bm).length) uitleg.push(`Branche${st.bmBron === 'standaard' ? ': standaard CBS-kengetallen' : ': eigen of ingestelde waarden'}; voor omzet en kaspositie is geen brancheniveau beschikbaar. Aanpassen kan via ⚙ Indeling.`);
    uitleg.push('Historie en indeling: cijfers komen uit Moneybird (alleen lezen), per boekjaar (kalenderjaar). Na late boekingen kan een afgesloten jaar opnieuw worden opgehaald via ⚙ Indeling.');
    return { aandacht, uitleg, lm };
  };

  // Feitzinnen onder "Wat de cijfers zeggen": alleen wat uit de gegevens volgt, met de bron erbij. Geen interpretatie of AI-tekst.
  C.feiten = function (id, extra) {
    const tm = tegelModel(), uit = [], A = tm.A, B = tm.B, lm = tm.lm; if (!A || !lm) return uit;
    if (id !== 'komende' && st.maanden.filter(m => m.maanden && !m.prognose && m.id.startsWith(st.jaar + '-') && m.id <= lm).length !== tm.tm) return uit;   // ontbrekende maand = geen uitspraak
    const jaar = st.jaar, j1 = jaar - 1, t = tm.tm, mn = MND[t - 1];
    const maandOmzet = (j) => Array.from({ length: t }, (_, i) => { const m = st.maanden.find(x => x.id === `${j}-${d2(i + 1)}`); return m && m.maanden && !m.prognose ? m.omzet || 0 : null; });
    if (id === 'omzet') {
      if (B) { const dv = A.omzet - B.omzet; uit.push({ icoon: dv >= 0 ? 'trend' : 'dal', t: `T/m ${MAANDLANG[t - 1]} ${kort(A.omzet)}: ${kort(Math.abs(dv))} (${pct(Math.abs(dPct(A.omzet, B.omzet)))}) ${dv >= 0 ? 'meer' : 'minder'} dan in dezelfde maanden van ${j1}.`, bron: `geboekt in Moneybird, jan–${mn} ${jaar} tegenover ${j1}` }); }
      const kw = [1, 2, 3, 4].filter(q => q * 3 <= t).map(q => { const som = j => { const ms = st.maanden.filter(m => m.maanden && !m.prognose && m.id.startsWith(j + '-') && Math.ceil(Number(m.id.slice(5, 7)) / 3) === q); return ms.length === 3 ? ms.reduce((a, m) => a + (m.omzet || 0), 0) : null; }; return { q, a: som(jaar), b: som(j1) }; }).filter(x => x.a != null && x.b);
      if (kw.length) { const dl = kw.map(x => dPct(x.a, x.b)); if (kw.length > 1 && dl.every(d => d >= 0)) uit.push({ icoon: 'trend', t: `Alle ${kw.length} afgesloten kwartalen groeiden ${Math.round(Math.min(...dl))} tot ${Math.round(Math.max(...dl))}% ten opzichte van ${j1}.`, bron: 'kwartaaltotalen in de tabel hiernaast' });
        else if (kw.length > 1 && dl.every(d => d < 0)) uit.push({ icoon: 'dal', t: `Alle ${kw.length} afgesloten kwartalen lagen ${Math.round(Math.min(...dl.map(Math.abs)))} tot ${Math.round(Math.max(...dl.map(Math.abs)))}% onder ${j1}.`, bron: 'kwartaaltotalen in de tabel hiernaast' });
        else uit.push({ icoon: 'trend', t: kw.map((x, i) => `K${x.q} ${pctTeken(dl[i])}`).join(', ') + ` ten opzichte van ${j1}.`, bron: 'afgesloten kwartalen' }); }
      const cur = maandOmzet(jaar); if (cur.filter(v => v != null).length >= 3) {
        const laag = (a) => a.reduce((b, v, i) => v != null && (b < 0 || v < a[b]) ? i : b, -1), i = laag(cur), ook = [j1, jaar - 2].filter(j => { const a = maandOmzet(j); return a.every(v => v != null) && laag(a) === i; });
        uit.push({ icoon: 'dal', t: `Zwakste maand was ${MAANDLANG[i]} (${kort(cur[i])})${ook.length ? ', net als in ' + ook.join(' en ') : ''}.`, bron: ook.length ? `laagste maand in ${[jaar].concat(ook).join(', ')}` : `laagste afgesloten maand van ${jaar}` }); }
      if (extra && extra.top && extra.top.items.length > 5 && !extra.top.onvolledig && extra.top.totaal > 0) { const n = 5, s = extra.top.items.slice(0, n).reduce((a, x) => a + x.v, 0);
        uit.push({ icoon: 'taart', t: `De ${n} grootste klanten zijn samen ${Math.round(s / extra.top.totaal * 100)}% van de omzet.`, bron: `${kort(s)} van ${kort(extra.top.totaal)} aan geboekte omzetstukken` }); }
      if (tm.verwacht != null) { const rest = tm.verwacht - A.omzet; uit.push({ icoon: 'klok', t: `Er staat ${kort(rest)} aan verwachte en lopende omzet tot het einde van ${jaar}. Komt dat binnen, dan eindigt ${jaar} op ${kort(tm.verwacht)}.`, bron: 'forecast; telt niet mee in de kerncijfers' }); }
    } else if (id === 'brutomarge') {
      const bm = st.bm.brutomarge, mid = bmMid(bm);
      if (A.omzet) uit.push({ icoon: 'taart', t: `T/m ${MAANDLANG[t - 1]} bleef ${pct(A.brutomarge_pct)} van de omzet over na materiaal en uitbesteed werk (${kort(A.brutomarge)}).`, bron: `Moneybird, jan–${mn} ${jaar}` });
      if (A.omzet && B && B.omzet) uit.push({ icoon: A.brutomarge_pct >= B.brutomarge_pct ? 'trend' : 'dal', t: `${Math.abs(A.brutomarge_pct - B.brutomarge_pct).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} procentpunt ${A.brutomarge_pct >= B.brutomarge_pct ? 'hoger' : 'lager'} dan in dezelfde maanden van ${j1} (${pct(B.brutomarge_pct)}).`, bron: `jan–${mn} ${jaar} tegenover ${j1}` });
      if (A.omzet && mid != null) uit.push({ icoon: 'taart', t: `De branche zit op ${bmTekst(bm)}; wij liggen ${Math.abs(A.brutomarge_pct - mid).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} procentpunt ${A.brutomarge_pct >= mid ? 'erboven' : 'eronder'} (midden van de band).`, bron: `branche${bm.bron ? ': ' + bm.bron : ''}` });
    } else if (id === 'resultaat') {
      if (A.omzet) uit.push({ icoon: A.resultaat >= 0 ? 'trend' : 'dal', t: `T/m ${MAANDLANG[t - 1]} is het resultaat ${kort(A.resultaat)}, ${pct(A.resultaat / A.omzet * 100)} van de omzet.`, bron: `Moneybird, jan–${mn} ${jaar}${st.eerlijk ? ', eerlijk beeld' : ', zoals in de W&V'}` });
      if (B) uit.push({ icoon: A.resultaat >= B.resultaat ? 'trend' : 'dal', t: `${kort(Math.abs(A.resultaat - B.resultaat))} ${A.resultaat >= B.resultaat ? 'meer' : 'minder'} resultaat dan in dezelfde maanden van ${j1} (${kort(B.resultaat)}).`, bron: `jan–${mn} ${jaar} tegenover ${j1}` });
      if (st.eerlijk && A.correctie) uit.push({ icoon: 'klok', t: `In het resultaat zit ${kort(A.correctie)} aan lonen die via de bank zijn betaald maar niet in de W&V staan.`, bron: 'eerlijk beeld; uit te zetten bovenaan' });
      const maandRes = Array.from({ length: t }, (_, i) => { const m = st.maanden.find(x => x.id === `${jaar}-${d2(i + 1)}`); return m && m.maanden && !m.prognose ? C.som([m], st.cats, st.eerlijk).resultaat : null; }), neg = maandRes.map((v, i) => v != null && v < 0 ? MAANDLANG[i] : null).filter(Boolean);
      if (maandRes.some(v => v != null)) uit.push({ icoon: neg.length ? 'dal' : 'klok', t: neg.length ? `In ${neg.join(', ')} was het resultaat negatief.` : `Geen enkele afgesloten maand van ${jaar} had een negatief resultaat.`, bron: `maandresultaten jan–${mn} ${jaar}` });
    } else if (id === 'opnames') {
      if (A.prive_totaal > 0) uit.push({ icoon: 'taart', t: `Opnames en aflossing samen ${kort(A.prive_totaal + A.aflossing)} in ${jaar} tot nu toe (opnames ${kort(A.prive_totaal)}, aflossing ${kort(A.aflossing)}).`, bron: 'Moneybird, geboekte opnames en aflossingen' });
      if (B && B.prive_totaal > 0 && A.prive_totaal > 0) uit.push({ icoon: 'taart', t: `Opnames waren ${pctTeken(dPct(A.prive_totaal, B.prive_totaal))} ten opzichte van dezelfde maanden van ${j1} (${kort(B.prive_totaal)}).`, bron: `jan–${mn} ${jaar} tegenover ${j1}` });
    } else if (id === 'kas') {
      const k0 = (st.maanden.find(x => x.id === lm) || {}).kas;
      if (k0 && k0.met_btw != null) uit.push({ icoon: 'klok', t: `Eind ${MAANDLANG[t - 1]} staat er ${kort(k0.met_btw)} (incl. btw-pot)${k0.lopend != null ? ', waarvan ' + kort(k0.lopend) + ' lopend' : ''}.`, bron: 'balans in Moneybird, stand op het maandeinde' });
      if (A.prive_totaal > 0) uit.push({ icoon: 'taart', t: `Opnames en aflossing samen ${kort(A.prive_totaal + A.aflossing)} in ${jaar} tot nu toe (opnames ${kort(A.prive_totaal)}, aflossing ${kort(A.aflossing)}).`, bron: 'Moneybird, geboekte opnames en aflossingen' });
    } else if (id === 'komende') {
      if (tm.tot > 0) uit.push({ icoon: 'klok', t: `In de forecast staat ${kort(tm.tot)} aan omzet voor ${tm.fm.filter(m => m.omzet > 0).map(m => MAANDLANG[Number(m.id.slice(5, 7)) - 1]).join(', ')}.`, bron: 'forecast (termijnen na vandaag); telt niet mee in de kerncijfers' });
      if (tm.tot > 0 && tm.v1 != null) uit.push({ icoon: tm.tot >= tm.v1 ? 'trend' : 'dal', t: `Dat is ${kort(Math.abs(tm.tot - tm.v1))} ${tm.tot >= tm.v1 ? 'meer' : 'minder'} dan de geboekte omzet in dezelfde maanden van vorig jaar (${kort(tm.v1)}).`, bron: 'forecast tegenover geboekt' });
    }
    return uit;
  };
  // ── Dashboard: scherm ──
  function focusSleutel() { const a = document.activeElement; return a && a.getAttribute && ((st.el && st.el.contains(a)) || (st.paneelEl && st.paneelEl.contains(a))) ? a.getAttribute('data-fk') : null; }
  function herstelFocus(sleutel, wortel) { if (!sleutel || !wortel) return; const e = [...wortel.querySelectorAll('[data-fk]')].find(x => x.getAttribute('data-fk') === sleutel); if (e) try { e.focus({ preventScroll: true }); } catch (x) { } }
  const groep = (naam, knoppen) => ee('div', { class: 'mtc-groep', role: 'group', 'aria-label': naam }, knoppen);
  const staal = streep => ee('span', { class: 'mtd-staal ' + streep, 'aria-hidden': 'true' });
  const jaarTitel = () => st.zoom === 'M' ? 'per maand' : st.zoom === 'K' ? 'per kwartaal' : 'per jaar';

  // De bediening: boekjaar, periode, eerlijk beeld, vergelijken en (eigenaar) indeling. De horizon stuurt alleen het advies en staat bij het rapport.
  function bediening() {
    const uit = [];
    if (st.zoom === 'M' || st.zoom === 'K') uit.push(ee('div', { class: 'mtc-groep' }, ee('button', { 'data-jaar': '-1', 'data-fk': 'jaar-', 'aria-label': 'Vorig boekjaar', disabled: st.jaar <= Number(START.slice(0, 4)) }, '‹'),
      ee('button', { disabled: true, style: 'font-weight:600;color:inherit' }, String(st.jaar)), ee('button', { 'data-jaar': '1', 'data-fk': 'jaar+', 'aria-label': 'Volgend boekjaar', disabled: st.jaar >= Number(st.vandaag.slice(0, 4)) }, '›')));
    uit.push(groep('Periode', ZOOMS.map(([k, t]) => ee('button', { 'data-zoom': k, 'data-fk': 'zoom-' + k, class: st.zoom === k ? 'aan' : '', 'aria-pressed': String(st.zoom === k), title: t }, { M: 'Maand', K: 'Kwartaal', J: 'Jaar', '5J': '5 jaar' }[k]))));
    uit.push(ee('button', { class: 'mtc-knop' + (st.eerlijk ? ' aan' : ''), 'data-eerlijk': '1', 'data-fk': 'eerlijk', 'aria-pressed': String(st.eerlijk), title: 'Telt lonen die alleen via de bank zijn betaald mee als personeelskosten' }, 'Eerlijk beeld'));
    uit.push(ee('div', { class: 'mtd-vgl', role: 'group', 'aria-label': 'Vergelijk met' }, ee('span', { class: 'mtd-vgl-t' }, 'Vergelijk'),
      [['j1', String(st.jaar - 1), 'dashed'], ['j2', String(st.jaar - 2), 'dotted'], ['b', 'Branche', 'brons']].map(([k, naam, streep]) => ee('button', { class: 'mtd-vglknop' + (st.vgl[k] ? ' aan' : ''), 'data-vgl': k, 'data-fk': 'vgl-' + k, 'aria-pressed': String(!!st.vgl[k]) }, staal(streep), naam))));
    if (st.mag) uit.push(ee('button', { class: 'mtc-knop', 'data-indeling': '1', 'data-fk': 'indeling', title: 'Indeling grootboeken, privé, aflossing, loonpatronen, branche' }, '⚙ Indeling'));
    return ee('div', { class: 'mtd-bar' }, uit);
  }
  function statusKnop() {
    const S = C.statusItems(), n = S.aandacht.length;
    return ee('button', { class: 'mtd-status', type: 'button', 'data-status': '1', 'data-fk': 'status', 'aria-expanded': String(!!st.statusOpen), 'aria-controls': 'mtd-statuspaneel', 'aria-label': S.lm ? `Gegevensstatus: geboekt t/m ${dagKort(S.lm)}, ${n ? n + ' aandachtspunt' + (n === 1 ? '' : 'en') : 'geen aandachtspunten'}` : 'Gegevensstatus' },
      ee('span', { class: 'mtd-stip', 'aria-hidden': 'true' }), ee('span', null, S.lm ? 'Gegevens t/m ' + dagKort(S.lm) : 'Gegevens laden'), ee('span', { class: 'mtd-sep' }, '·'), ee('span', { class: 'mtd-n' }, n ? `${n} aandachtspunt${n === 1 ? '' : 'en'}` : 'geen aandachtspunten'));
  }
  function statusPaneel() {
    const S = C.statusItems(), lijst = (items) => ee('ul', null, items.map(t => ee('li', null, t)));
    return ee('section', { class: 'mtd-statuspaneel', id: 'mtd-statuspaneel', 'aria-label': 'Gegevensstatus' },
      ee('div', { class: 'mtd-sp-kop' }, ee('h2', null, S.lm ? 'Gegevens t/m ' + dagKort(S.lm) : 'Gegevens'), ee('button', { class: 'mtc-knop', 'data-status': '1', 'data-fk': 'status-sluit' }, 'Sluiten')),
      ee('h3', null, S.aandacht.length ? `Aandachtspunten (${S.aandacht.length})` : 'Geen aandachtspunten'), S.aandacht.length ? lijst(S.aandacht) : ee('p', { class: 'mtc-noot' }, 'Alle gegevens zijn opgehaald en ingedeeld.'),
      ee('h3', null, 'Toelichting bij de cijfers'), lijst(S.uitleg));
  }

  function tegelEl(t) {
    const rijen = t.rijen.filter(r => !((r.soort === 'j1' && !st.vgl.j1) || (r.soort === 'j2' && !st.vgl.j2) || (r.soort === 'b' && !st.vgl.b)));
    const sp = t.spark ? ss('svg', { class: 'mtd-spark', viewBox: '0 0 120 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, ['vorig', 'huidig', 'prog'].filter(k => t.spark[k]).map(k => ss('path', { d: t.spark[k], class: 'mtd-s-' + k }))) : null;
    const chip = t.chip ? ee('div', { class: 'mtd-chip ' + (t.chip.goed == null ? 'n' : t.chip.goed ? 'goed' : 'slecht') }, ee('span', { 'aria-hidden': 'true' }, t.chip.pijl), ee('span', null, t.chip.tekst)) : null;
    const een = rijen.length ? rijen[0] : null;
    const e = ee('div', { class: `mtd-tegel mtd-t-${t.id}${t.breed ? ' breed' : ''}${t.klik ? '' : ' uit'}`, role: t.klik ? 'button' : 'group', tabindex: t.klik ? '0' : null, 'data-paneel': t.klik ? t.id : null, 'data-fk': 'tegel-' + t.id,
      'aria-label': `${t.label} ${t.waarde}${t.chip ? ', ' + t.chip.tekst : ''}${t.sub ? '. ' + t.sub : ''}${t.klik ? '. Open op volledig scherm.' : ''}` },
      ee('div', { class: 'mtd-t-kop' }, ee('span', { class: 'mtd-t-l' }, t.label, t.forecast ? ee('span', { class: 'mtd-fc' }, 'forecast') : null), t.klik ? ee('span', { class: 'mtd-vol-ico', 'aria-hidden': 'true' }, '⤢') : null),
      ee('div', { class: 'mtd-t-mid' }, ee('div', { class: 'mtd-t-w' }, ee('span', { class: 'mtd-getal' }, t.waarde), ee('span', { class: 'mtd-sub' }, t.sub)), sp),
      chip,
      een ? ee('div', { class: 'mtd-vgl1' }, `${een.l}: ${een.v}${een.d ? ' · ' + een.d : ''}`) : null,
      rijen.length ? ee('div', { class: 'mtd-rijen' }, rijen.map(r => ee('div', { class: 'mtd-rij' }, ee('span', { class: 'mtd-rl' }, staal(r.streep), r.l), ee('span', { class: 'mtd-rv' }, r.v), ee('span', { class: 'mtd-rd ' + (r.goed == null ? '' : r.goed ? 'goed' : 'slecht') }, r.d)))) : null);
    return e;
  }

  // ── Besteedbaar budget: tegel en paneel ──
  // Alles komt uit het rekenwerk van Financiën (MTGeld.besteedbaar / kasLijn / laagste / drempel), met dezelfde invoer: de tijdlijn, de config en de keuzes die
  // Financiën per gebruiker onthoudt (noodbuffer, prognose, periode). Hier wordt niets opnieuw berekend; ontbreekt er iets dan staat er "—" met de reden.
  const BES_ZOOM = { week: 14, maand: 31, kwartaal: 92, jaar: 365 };
  const rond2 = n => Math.round(n * 100) / 100;
  const dagenTss = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  const datKort = d => `${Number(d.slice(8))} ${MND[Number(d.slice(5, 7)) - 1]}`;
  const datLang = d => `${['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][new Date(d + 'T00:00:00Z').getUTCDay()]} ${datKort(d)} ${d.slice(0, 4)}`;
  const zoomNaam = z => z === 'week' ? '2 weken' : z;
  C.besteedModel = function (data, cfg, o) {
    o = o || {}; const G = root.MTGeld, leeg = reden => ({ ok: false, reden });
    if (!G || typeof G.besteedbaar !== 'function' || typeof G.kasLijn !== 'function' || typeof G.laagste !== 'function' || typeof G.drempel !== 'function') return leeg('Financiën-rekenmodule niet geladen');
    if (!data) return leeg(o.laden ? 'laden…' : o.fout ? 'tijdlijn niet geladen' : 'nog niet geladen');
    if (!data.saldo || !data.vandaag) return leeg('tijdlijn onvolledig');
    if (!cfg) return leeg('instellingen van Financiën niet geladen');
    try {
      const zoom = BES_ZOOM[o.zoom] ? o.zoom : 'maand', nood = !!o.nood, prognose = o.prognose !== false;
      const d = typeof G.metScenario === 'function' ? G.metScenario(data, o.scenario || {}) : data, bes = G.besteedbaar(d, cfg, { nood });
      if (!bes) return leeg('lopende rekening onbekend');
      const lijn = G.kasLijn(d, cfg, { prognose, nood}); if (!lijn || lijn.onbekend) return leeg('lopende rekening onbekend');
      const low = G.laagste(lijn, C._dag(d.vandaag, BES_ZOOM[zoom])), onder = G.drempel(d, cfg);
      return { ok: true, d, bes, lijn, low, onder, ruimte: low ? rond2(low.saldo - onder) : null, nood, prognose, zoom, vandaag: d.vandaag, heeftProg: (d.events || []).some(e => e.zekerheid === 'prognose'), grens: typeof G.drempelSoort === 'function' ? G.drempelSoort(d, cfg) : null };
    } catch (e) { return leeg('berekening mislukt'); }
  };
  function besZoom() { const z = st.besZoom || ls.get('mtg:zoom:' + st.wie); return BES_ZOOM[z] ? z : 'maand'; }
  // De tegel: kale getallen (voor de tests) en wat de tegel erbij zegt.
  function besteedTegelModel() {
    // Is Financiën zelf geladen voor dezelfde gebruiker, dan is de actuele config en tijdlijn daarvan de bron (ook na een configwijziging); anders de eigen kopie van dezelfde
    // verzoeken. Een onopgeslagen scenario in Financiën telt bewust NIET mee: de tegel toont altijd het echte besteedbaar budget.
    const b = st.bes, fin = root.MTGeld && root.MTGeld._st, live = !!(fin && fin.data && fin.cfg && fin.wie === st.wie), data = live ? fin.data : b.data, cfg = live ? fin.cfg : b.cfg;
    const o = { nood: ls.get('mtg:nood:' + st.wie) === '1', prognose: ls.get('mtg:prognose:' + st.wie) !== '0', zoom: besZoom(), laden: b.laden, fout: b.fout };
    const sleutel = [o.nood, o.prognose, o.zoom, o.laden, o.fout, !!root.MTGeld, live].join('|');
    if (!b.cache || b.cache.data !== data || b.cache.cfg !== cfg || b.cache.sleutel !== sleutel) b.cache = { data, cfg, sleutel, m: C.besteedModel(data, cfg, o) };
    const m = b.cache.m;
    if (!m.ok) return { id: 'besteedbaar', label: 'Besteedbaar budget', waarde: '—', sub: m.reden, ok: false, klik: false, m, rijen: [], chip: null };
    const bes = m.bes, low = m.low, ruimte = m.ruimte, rijen = [];
    rijen.push({ l: 'Laagste punt' + (m.heeftProg && m.prognose ? ' (incl. prognose)' : ''), v: low ? eur(low.saldo) : '—', s: low ? `${datKort(low.datum)} · komende ${zoomNaam(m.zoom)}` : 'geen verwachting beschikbaar', goed: low ? low.saldo >= m.onder : null });
    rijen.push({ l: 'Ruimte op laagste punt', v: ruimte == null ? '—' : eur(ruimte), s: m.onder > 0 ? 'tot de fictieve buffer' : 'tot nul', goed: ruimte == null ? null : ruimte >= 0 });
    rijen.push({ l: 'Lopende rekening', v: eur(bes.lopend), s: bes.btwTekort > 0 ? `btw nog te betalen ${eur(bes.btwTekort)}` : 'geen open btw', goed: null });
    const chip = ruimte == null ? null : { pijl: ruimte >= 0 ? '▲' : '▼', tekst: ruimte >= 0 ? `${eur(ruimte)} ruimte op het laagste punt` : `${eur(-ruimte)} tekort op het laagste punt`, goed: ruimte >= 0 };
    return { id: 'besteedbaar', label: 'Besteedbaar budget' + (m.nood ? ' (incl. noodbuffer)' : ''), waarde: eur(bes.besteedbaar), raw: bes.besteedbaar, sub: 'lopende rekening min de btw die je nog moet betalen' + (m.nood ? ', plus de noodbuffer' : ''), ok: true, klik: true, m, rijen, chip, rood: bes.besteedbaar < 0 };
  }
  C.besteedTegel = besteedTegelModel;
  function besteedLaad() { besteedBewaak(); const p = besteedRonde(); st.bes.belofte = p; return p; }   // de belofte van de lopende ronde: ververs() voegt daarbij aan i.p.v. een nieuwe te starten
  async function besteedRonde() {
    const b = st.bes, bron = st.bron; if (!bron || !st.vandaag) return;
    const tok = b.tok = (b.tok || 0) + 1; b.laden = true; b.fout = null;   // elke ronde een eigen token: een laat antwoord van een oude ronde (of van een andere gebruiker of bron) telt niet
    let d = null, c = null, fout = null;
    try {
      const v = st.vandaag; [d, c] = await Promise.all([bron.haal(`/geld/tijdlijn?van=${C._dag(v, -35)}&tot=${C._dag(v, 364)}&historie=1`), bron.haal('/geld/config')]);   // dezelfde verzoeken als Financiën
      if (!d || d.error) throw new Error(d && d.error || 'geen antwoord');
    } catch (e) { fout = (e && e.message) || String(e); }
    if (st.bes !== b || b.tok !== tok) return;
    b.laden = false;
    if (fout) { b.fout = fout; b.data = null; b.cfg = null; } else { b.data = d; b.cfg = c && c.config ? c.config : null; b.laatst = Date.now(); }   // bij een mislukte verversing geen oud getal laten staan
    herteken();
  }
  // Een automatische herschildering (nieuw getal binnen) wacht zolang een volschermpaneel, een blad (Indeling e.d.) of een invoerveld met focus open is, en wordt daarna verwerkt.
  function tekenBezig() {
    if (st.paneel) return true; if (typeof document === 'undefined') return false;
    const a = document.activeElement; return !!document.querySelector('.mtc-sheet') || !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && ((st.el && st.el.contains(a)) || (st.paneelEl && st.paneelEl.contains(a))));
  }
  function herteken() { if (!(st.el && st.el.isConnected)) return; if (tekenBezig()) { st.bes.wacht = true; return; } st.bes.wacht = false; (C._tekenHook || teken)(); }
  function verwerkWacht() { if (st.bes.wacht && !tekenBezig()) herteken(); }
  C._herteken = herteken; C._verwerkWacht = verwerkWacht;
  // Andere gebruiker of andere bron dan waarvoor st.bes geladen is: alles weg, zodat er nooit een getal van iemand anders of van vorige sessie staat.
  function besteedBewaak() {
    if (st.bes.wie === st.wie && st.bes.bron === st.bron) return;
    st.bes = { data: null, cfg: null, laden: false, fout: null, cache: null, tok: 0, wie: st.wie, bron: st.bron }; st.besZoom = null;
  }
  C._besteedLaad = besteedLaad; C._besteedBewaak = besteedBewaak;
  // Voor als Rapporten opnieuw opent: meteen herschilderen (Financiën kan veranderd zijn). Geen nieuwe laadronde als er al een loopt (tenzij de config van Financiën intussen wijzigde)
  // of als de laatste minder dan 60 seconden geleden klaar was.
  C.ververs = () => {
    besteedBewaak(); const b = st.bes, fin = root.MTGeld && root.MTGeld._st, finCfg = (fin && fin.cfg) || null, gewijzigd = finCfg !== (b.finCfg || null); b.finCfg = finCfg;
    if (st.maanden.length) herteken();
    if (b.laden && b.belofte && !gewijzigd) return b.belofte;
    if (!gewijzigd && !b.laden && b.laatst && Date.now() - b.laatst < 60000) return Promise.resolve();
    return besteedLaad();
  };
  const trap = (lijst, x, y) => lijst.map((p, i) => (i ? `H${x(p.datum).toFixed(1)}V${y(p.saldo).toFixed(1)}` : `M${x(p.datum).toFixed(1)} ${y(p.saldo).toFixed(1)}`)).join('');
  // Het verloop: tot vandaag de lopende rekening (doorgetrokken), daarna het besteedbaar budget zoals Financiën het verwacht (gestippeld).
  function besteedGrafiek(m, o) {
    o = o || {}; const br = o.breedte || BR, klein = br < 500, ho = o.hoog || (klein ? 170 : 220), ml = klein ? 44 : 60, mr = 12, mt = 26, mb = 24, n = BES_ZOOM[m.zoom];
    const vanD = C._dag(m.vandaag, -Math.round(n * 0.25)), totD = C._dag(m.vandaag, n), span = Math.max(1, dagenTss(vanD, totD)), pts = m.lijn.punten.filter(p => p.datum >= vanD && p.datum <= totD);
    if (pts.length < 2) return ee('div', { class: 'mtc-noot' }, 'Geen gegevens voor deze periode.');
    const x = dd => ml + dagenTss(vanD, dd) / span * (br - ml - mr);
    const sc = C.schaalVoor([pts.map(p => p.saldo), m.onder > 0 ? [m.onder] : [], m.low ? [m.low.saldo] : []], {}), y = v => mt + (ho - mt - mb) * (1 - (v - sc.a) / (sc.b - sc.a));
    const svg = ss('svg', { viewBox: `0 0 ${br} ${ho}`, class: 'mtd-svg', role: 'img', 'aria-label': `Verloop besteedbaar budget, komende ${zoomNaam(m.zoom)}, met de verwachting gestippeld` });
    sc.ticks.forEach(tk => svg.append(ss('line', { x1: ml, x2: br - mr, y1: y(tk), y2: y(tk), class: tk === 0 ? 'mtd-as0' : 'mtd-raster' }), ss('text', { x: ml - 6, y: y(tk) + 4, 'text-anchor': 'end', class: 'mtd-astekst' }, kort(tk))));
    const stappen = klein ? 3 : 6;
    for (let i = 0; i <= stappen; i++) { const dd = C._dag(vanD, Math.round(span * i / stappen)); svg.append(ss('text', { x: x(dd), y: ho - mb + 16, 'text-anchor': i === 0 ? 'start' : i === stappen ? 'end' : 'middle', class: 'mtd-xtekst' + (dd > m.vandaag ? ' fc' : '') }, datKort(dd))); }
    if (m.onder > 0 && m.onder <= sc.b) svg.append(ss('line', { x1: ml, x2: br - mr, y1: y(m.onder), y2: y(m.onder), class: 'mtd-bes-grens' }), ss('text', { x: br - mr - 2, y: y(m.onder) - 4, 'text-anchor': 'end', class: 'mtd-astekst' }, 'fictieve buffer'));
    const dx = x(m.vandaag); svg.append(ss('line', { x1: dx, x2: dx, y1: mt - 14, y2: ho - mb, class: 'mtd-scheid' }), ss('text', { x: dx + (dx > br - 150 ? -5 : 5), y: mt - 5, 'text-anchor': dx > br - 150 ? 'end' : 'start', class: 'mtd-scheidtekst' }, 'vanaf hier verwachting'));
    const ver = pts.filter(p => p.datum <= m.vandaag), toek = pts.filter(p => p.datum >= m.vandaag);
    if (ver.length > 1) svg.append(ss('path', { d: trap(ver, x, y), class: 'mtd-l-huidig mtd-bes-l' }));
    if (toek.length > 1) svg.append(ss('path', { d: trap(toek, x, y), class: 'mtd-l-prog' }));
    if (m.low) svg.append(ss('circle', { cx: x(m.low.datum), cy: y(m.low.saldo), r: 4.5, class: 'mtd-bes-laag' + (m.low.saldo < m.onder ? ' slecht' : '') }));
    const kruis = ss('line', { class: 'mtd-kruis', y1: mt - 4, y2: ho - mb, visibility: 'hidden' }); svg.append(kruis);
    const hit = ss('rect', { class: 'mtd-hit', x: ml, y: mt - 16, width: br - ml - mr, height: ho - mt + 16 }); svg.append(hit);
    const tip = ee('div', { class: 'mtd-tip', role: 'status', hidden: true }), info = ee('div', { class: 'mtd-info', role: 'status' });
    const vul = p => { const fc = p.datum > m.vandaag, rijen = [{ l: fc || p.datum === m.vandaag ? 'Besteedbaar budget' : 'Lopende rekening', v: eur(p.saldo), stip: fc ? 'prog' : 'huidig' }];
      if (p.saldo_gepland != null && p.saldo_gepland !== p.saldo) rijen.push({ l: 'Na wat vandaag gepland staat', v: eur(p.saldo_gepland), stip: 'prog' });
      if (m.low && p.datum === m.low.datum) rijen.push({ l: 'Laagste punt', v: eur(m.low.saldo), d: m.low.saldo < m.onder ? 'onder de grens' : '', goed: m.low.saldo >= m.onder, stip: 'geen' });
      return [ee('div', { class: 'mtd-tk' }, ee('span', { class: 'mtd-tt' }, datLang(p.datum)), ee('span', { class: 'mtd-tlab' + (fc ? ' fc' : '') }, fc ? 'verwachting' : p.datum === m.vandaag ? 'vandaag' : 'geboekt')), ...rijen.map(rijTip)]; };
    const dichtbij = cx => { const r = svg.getBoundingClientRect(); if (!r.width) return null; const f = (cx - r.left) / r.width * br, dd = C._dag(vanD, Math.round((f - ml) / (br - ml - mr) * span)); let b = null, bd = 1e9;
      for (const p of pts) { const k = Math.abs(dagenTss(p.datum, dd)); if (k < bd) { bd = k; b = p; } } return b; };
    const toon = (p, vast) => { if (!p) return; kruis.setAttribute('x1', x(p.datum)); kruis.setAttribute('x2', x(p.datum)); kruis.setAttribute('visibility', 'visible'); tip.hidden = false; tip.replaceChildren(...vul(p));
      const fr = (x(p.datum) - ml) / (br - ml - mr); tip.style.left = (x(p.datum) / br * 100) + '%'; tip.style.transform = fr < 0.12 ? 'translateX(8px)' : fr > 0.88 ? 'translateX(calc(-100% - 8px))' : 'translateX(-50%)';
      if (vast) { info.replaceChildren(...vul(p)); info.classList.add('heeft', 'vast'); } };
    hit.addEventListener('mousemove', e => toon(dichtbij(e.clientX), false)); hit.addEventListener('click', e => toon(dichtbij(e.clientX), true));
    const plot = ee('div', { class: 'mtd-plot' }, svg, tip); plot.addEventListener('mouseleave', () => { kruis.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    const leg = ee('div', { class: 'mtd-legenda mtd-bes-leg' }, legendaItem('huidig', 'lopende rekening tot vandaag'), legendaItem('prog', 'verwachting' + (m.nood ? ', incl. noodbuffer' : '') + (m.heeftProg && m.prognose ? ', incl. prognose' : '')), m.onder > 0 ? legendaItem('grens', 'fictieve buffer') : null);
    return ee('div', { class: 'mtd-chart' }, plot, o.info ? info : null, leg);
  }
  function besteedTegelEl() {
    const t = besteedTegelModel(), m = t.m;
    const chip = t.chip ? ee('div', { class: 'mtd-chip ' + (t.chip.goed ? 'goed' : 'slecht') }, ee('span', { 'aria-hidden': 'true' }, t.chip.pijl), ee('span', null, t.chip.tekst)) : null;
    const stats = t.ok ? ee('div', { class: 'mtd-bes-stats' }, t.rijen.map(r => ee('div', { class: 'mtd-bes-st' }, ee('span', { class: 'mtd-kl' }, r.l), ee('span', { class: 'mtd-bes-v' }, r.v), ee('span', { class: 'mtd-ks ' + (r.goed == null ? '' : r.goed ? 'goed' : 'slecht') }, r.s)))) : null;
    return ee('div', { class: 'mtd-tegel mtd-t-besteedbaar' + (t.klik ? '' : ' uit'), role: t.klik ? 'button' : 'group', tabindex: t.klik ? '0' : null, 'data-paneel': t.klik ? 'besteedbaar' : null, 'data-fk': 'tegel-besteedbaar',
      'aria-label': `${t.label} ${t.waarde}${t.chip ? ', ' + t.chip.tekst : ''}. ${t.sub}${t.klik ? '. Open op volledig scherm.' : ''}` },
      ee('div', { class: 'mtd-t-kop' }, ee('span', { class: 'mtd-t-l' }, t.label, t.ok && m.heeftProg && m.prognose ? ee('span', { class: 'mtd-fc' }, 'incl. prognose') : null), t.klik ? ee('span', { class: 'mtd-vol-ico', 'aria-hidden': 'true' }, '⤢') : null),
      ee('div', { class: 'mtd-bes-top' }, ee('div', { class: 'mtd-t-w' }, ee('span', { class: 'mtd-getal' + (t.rood ? ' slecht' : '') }, t.waarde), ee('span', { class: 'mtd-sub' }, t.sub), chip), stats),
      t.ok ? besteedGrafiek(m, { breedte: Math.max(300, BR - (mobiel() ? 32 : 48)), hoog: mobiel() ? 150 : 200 }) : null);
  }
  function besteedPaneel(breedte) {
    const t = besteedTegelModel(), m = t.m, kop = ee('div', { class: 'mtd-pkop' }, ee('div', { class: 'mtd-pkop-l' }, ee('button', { class: 'mtd-kn ico', 'data-sluitpaneel': '1', 'data-fk': 'sluit', 'aria-label': 'Sluiten en terug naar cijfers' }, '✕'),
      ee('div', null, ee('h1', null, 'Besteedbaar budget'), ee('span', { class: 'mtc-noot' }, m.ok ? `stand van ${datLang(m.vandaag)} · zelfde getal als in Financiën` : 'niet beschikbaar'))),
      ee('div', { class: 'mtd-pkop-r' }, document.getElementById('tab-btn-geld') && typeof root.showTab === 'function' ? ee('button', { class: 'mtd-kn', 'data-naarfin': '1', 'data-fk': 'naar-fin' }, 'Naar Financiën →') : null));
    if (!t.ok) return [kop, ee('div', { class: 'mtc-kaart mtc-noot' }, `Het besteedbaar budget kan nu niet worden getoond: ${t.sub}.`)];
    const zoek = ee('div', { class: 'mtd-bar' }, ee('div', { class: 'mtc-groep', role: 'group', 'aria-label': 'Periode' }, Object.keys(BES_ZOOM).map(z => ee('button', { 'data-bzoom': z, 'data-fk': 'bzoom-' + z, class: m.zoom === z ? 'aan' : '', 'aria-pressed': String(m.zoom === z) }, z))),
      ee('span', { class: 'mtc-noot' }, `Noodbuffer ${m.nood ? 'telt mee' : 'telt niet mee'} · prognose ${m.prognose ? 'aan' : 'uit'} · zoals ingesteld in Financiën`));
    const kpis = [{ l: 'Besteedbaar nu', v: t.waarde, s: m.nood ? 'incl. noodbuffer' : 'lopend min btw', goed: t.raw >= 0 }].concat(t.rijen.map(r => ({ l: r.l, v: r.v, s: r.s, goed: r.goed })));
    return [kop, zoek, kpiRij(kpis), sectie('Verloop besteedbaar budget', `Tot vandaag de lopende rekening, daarna de verwachting (gestippeld) · komende ${zoomNaam(m.zoom)}`, besteedGrafiek(m, { breedte, hoog: 380, info: true }))];
  }

  function teken() {
    if (!st.el) return;
    const fk = focusSleutel(); maat(Math.max(320, (st.el.clientWidth || 640) - 50), 2400);
    const wortel = ee('div', { class: 'mtc mtd' }); wortel.addEventListener('click', klik); wortel.addEventListener('keydown', toets);
    const modelFout = st.fout && !st.maanden.length;
    wortel.append(ee('div', { class: 'mtd-kop' }, ee('h2', { class: 'mtd-titel' }, 'Cijfers ' + st.jaar), st.maanden.length ? statusKnop() : null), bediening());
    if (st.statusOpen && st.maanden.length) wortel.append(statusPaneel());
    if (modelFout) wortel.append(ee('div', { class: 'mtc-kaart' }, 'Cijfers konden niet worden geladen: ' + st.fout + '.'));
    else if (!st.maanden.length) wortel.append(ee('div', { class: 'mtc-kaart mtc-noot' }, 'Cijfers laden…'));
    else {
      const per = huidigePeriodes(), tegels = tegelModel();
      wortel.append(ee('section', { class: 'mtd-tegels', 'aria-label': 'Kerncijfers' }, tegels.map(tegelEl), besteedTegelEl()), hoofdKaart(per));
    }
    st.el.replaceChildren(wortel);
    gebaren(wortel.querySelector('.mtd-plot'));
    herstelFocus(fk, st.el);
    tekenPaneel();
  }
  // ── Dashboard: hoofdgrafiek (omzet per periode met forecast, vorige jaren, crosshair en tooltip) ──
  function padD(pts) { let d = '', open = false; for (const q of pts) { if (!q) { open = false; continue; } d += (open ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ' '; open = true; } return d.trim(); }
  const progRes = p => p.P.prognose > 0 && !p.P.geenHistorie ? (p.P.maanden ? p.P.omzet : 0) + p.P.prognose - (p.P.maanden ? p.P.kosten_totaal : 0) - p.P.prognoseKosten : null;
  const isLopend = p => p.ms.some(m => !m.prognose && m.id === st.vandaag.slice(0, 7));
  const rijTip = r => ee('div', { class: 'mtd-tr' }, staal(r.stip || 'geen'), ee('span', { class: 'mtd-tl' }, r.l), ee('span', { class: 'mtd-tv' }, r.v), ee('span', { class: 'mtd-td ' + (r.goed == null ? '' : r.goed ? 'goed' : 'slecht') }, r.d || ''));
  // Wat er bij één periode staat (tooltip op de computer, infopaneel op de telefoon): geboekt of forecast, vergelijkingen, resultaat.
  C.periodeInhoud = function (p, i, vgl) {
    const P = p.P, act = P.maanden > 0, fc = P.prognose > 0, lop = isLopend(p), basis = (act ? P.omzet : 0) + P.prognose, rijen = [];
    const titel = st.zoom === 'M' ? maandLang(p.id) : st.zoom === 'K' ? `${p.label} ${st.jaar}` : (p.label || p.id);
    const label = fc && !act ? 'forecast' : fc ? 'deels forecast' : lop ? 'lopende maand, nog niet compleet' : 'geboekt';
    if (act) rijen.push({ l: 'Omzet', v: kort(P.omzet), stip: 'balk' });
    if (fc) rijen.push({ l: act ? 'Waarvan verwacht' : 'Verwachte omzet', v: kort(P.prognose), stip: 'prog' });
    for (const r of vgl) { const v = r.w[i]; if (v != null) rijen.push({ l: 'Omzet ' + r.jaar, v: kort(v), d: lop ? '' : pctTeken(dPct(basis, v)), goed: basis >= v, stip: r.off > 1 ? 'dotted' : 'dashed' }); }
    if (act) rijen.push({ l: 'Resultaat', v: kort(P.resultaat), d: P.omzet ? Math.round(P.resultaat / P.omzet * 100) + '%' : '', stip: 'res' });
    const pr = progRes(p); if (pr != null) rijen.push({ l: 'Verwacht resultaat', v: kort(pr), stip: 'resprog' });
    return { titel, label, fc, act, lop, rijen };
  };

  function legendaItem(streep, tekst) { return ee('span', { class: 'mtd-leg' }, staal(streep), tekst); }
  function hoofdKaart(per, o) {
    o = o || {}; const vgl = vergelijkReeks(per, P => P.omzet), heeftProg = per.some(p => p.P.prognose > 0);
    const leg = ee('div', { class: 'mtd-legenda' }, legendaItem('balk', 'omzet'), legendaItem('res', 'resultaat'), heeftProg ? legendaItem('prog', 'forecast') : null, vgl.map(r => legendaItem(r.off > 1 ? 'dotted' : 'dashed', String(r.jaar))));
    const acties = ee('div', { class: 'mtd-acties-k' }, leg, ee('button', { class: 'mtd-kn', 'data-tabel': '1', 'data-fk': 'tabel', 'aria-pressed': String(!!st.tabel) }, 'Tabel'),
      o.paneel ? null : ee('button', { class: 'mtd-kn ico', 'data-paneel': 'hoofd', 'data-fk': 'vol-hoofd', 'aria-label': 'Grafiek op volledig scherm' }, '⤢'));
    return ee('section', { class: 'mtd-kaart mtd-hoofd', 'aria-label': 'Omzet en resultaat ' + jaarTitel() },
      ee('div', { class: 'mtd-kaartkop' }, ee('div', null, ee('h3', null, 'Omzet en resultaat ' + jaarTitel()), ee('span', { class: 'mtc-noot' }, 'Beweeg over een periode, of tik erop, voor de details')), acties),
      hoofdGrafiek(per, o), st.tabel ? tabelEl(per, vgl) : null);
  }

  function hoofdGrafiek(per, o) {
    o = o || {};
    const br = o.breedte || BR, klein = br < 500, ho = o.hoog || (klein ? 190 : Math.min(440, Math.max(300, Math.round(br * .27)))), ml = klein ? 40 : 56, mr = 10, mt = 28, mb = 24;
    const n = Math.max(1, per.length), bw = (br - ml - mr) / n, x = i => ml + i * bw + bw / 2, vgl = vergelijkReeks(per, P => P.omzet);
    // alle getekende waarden eerst: staven + forecast bovenop + vergelijkjaren; dan pas de schaal
    const sc = C.schaalVoor([per.map(p => (p.P.maanden ? p.P.omzet : 0) + p.P.prognose), ...vgl.map(r => r.w)], { min: 0, max: 1 }), y = v => mt + (ho - mt - mb) * (1 - (v - sc.a) / (sc.b - sc.a));
    const svg = ss('svg', { viewBox: `0 0 ${br} ${ho}`, class: 'mtd-svg', role: 'img', 'aria-label': `Omzet ${jaarTitel()} ${st.jaar}, met verwachting en vorige jaren` });
    svg.append(ss('defs', null, ss('pattern', { id: 'mtd-arc', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, ss('rect', { width: 6, height: 6, class: 'mtd-arc-bg' }), ss('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'mtd-arc-lijn', 'stroke-width': 2 }))));
    sc.ticks.forEach(tk => svg.append(ss('line', { x1: ml, x2: br - mr, y1: y(tk), y2: y(tk), class: tk === 0 ? 'mtd-as0' : 'mtd-raster' }), ss('text', { x: ml - 6, y: y(tk) + 4, 'text-anchor': 'end', class: 'mtd-astekst' }, kort(tk))));
    const f0 = per.findIndex(p => p.P.prognose > 0);
    if (f0 >= 0) { const dx = ml + f0 * bw; svg.append(ss('line', { x1: dx, x2: dx, y1: mt - 14, y2: ho - mb, class: 'mtd-scheid' }), ss('text', { x: dx + (dx > br - 150 ? -5 : 5), y: mt - 5, 'text-anchor': dx > br - 150 ? 'end' : 'start', class: 'mtd-scheidtekst' }, 'vanaf hier verwachting')); }
    const bars = per.map((p, i) => { const w = Math.max(4, bw * 0.62), x0 = x(i) - w / 2, basis = p.P.maanden ? p.P.omzet : 0, g = ss('g', { class: 'mtd-bargroep' });
      if (basis > 0) g.append(ss('rect', { class: 'mtd-bar' + (isLopend(p) ? ' lopend' : ''), x: x0, y: y(basis), width: w, height: Math.max(0.5, y(0) - y(basis)), rx: 2 }));
      if (p.P.prognose > 0) g.append(ss('rect', { class: 'mtd-bar-prog', x: x0, y: y(basis + p.P.prognose), width: w, height: Math.max(0.5, y(basis) - y(basis + p.P.prognose)), rx: 2, fill: 'url(#mtd-arc)' }));
      svg.append(g); return g; });
    vgl.forEach(r => svg.append(ss('path', { d: padD(r.w.map((v, i) => v == null ? null : [x(i), y(v)])), class: 'mtd-l-vgl o' + r.off })));
    if (f0 >= 0) { const pts = per.map((p, i) => p.P.prognose > 0 ? [x(i), y((p.P.maanden ? p.P.omzet : 0) + p.P.prognose)] : null); const vz = per.map((p, i) => i < f0 && p.P.maanden && !isLopend(p) && p.P.omzet > 0 ? i : -1).filter(i => i >= 0).pop(); if (vz != null) pts[vz] = [x(vz), y(per[vz].P.omzet)]; svg.append(ss('path', { d: padD(pts.filter(Boolean)), class: 'mtd-l-prog' })); }
    per.forEach((p, i) => svg.append(ss('text', { x: x(i), y: ho - mb + 16, 'text-anchor': 'middle', class: 'mtd-xtekst' + (p.P.prognose > 0 ? ' fc' : '') }, (p.label || p.id) + (isLopend(p) ? '*' : ''))));
    const kruis = ss('line', { class: 'mtd-kruis', y1: mt - 4, y2: ho - mb, visibility: 'hidden' }); svg.append(kruis);
    // resultaat-strook eronder (zelfde kolommen)
    const rs = per.map(p => p.P.maanden ? p.P.resultaat : null), rp = per.map(progRes), rsc = C.schaalVoor([rs, rp], { min: 0, max: 1 }), rh = 84, rt = 18, rb = 6, ry = v => rt + (rh - rt - rb) * (1 - (v - rsc.a) / (rsc.b - rsc.a));
    const strook = ss('svg', { viewBox: `0 0 ${br} ${rh}`, class: 'mtd-svg mtd-strook', role: 'img', 'aria-label': 'Resultaat ' + jaarTitel() });
    strook.append(ss('line', { x1: ml, x2: br - mr, y1: ry(0), y2: ry(0), class: 'mtd-as0' }), ss('text', { x: ml - 6, y: rt - 6, 'text-anchor': 'end', class: 'mtd-astekst' }, 'Resultaat'));
    per.forEach((p, i) => { const w = Math.max(4, bw * 0.62), x0 = x(i) - w / 2, toon = bw >= 30;
      [[rs[i], false], [rp[i], true]].forEach(([v, prog]) => { if (v == null) return; const top = Math.min(ry(v), ry(0)), h = Math.max(1, Math.abs(ry(v) - ry(0)));
        strook.append(ss('rect', { class: prog ? 'mtd-res-prog' : 'mtd-res', x: x0, y: top, width: w, height: h, rx: 2, fill: prog ? 'url(#mtd-arc-res)' : null }));
        if (toon) strook.append(ss('text', { x: x(i), y: v >= 0 ? top - 3 : top + h + 10, 'text-anchor': 'middle', class: 'mtd-restekst' + (prog ? ' fc' : '') }, kort(v))); }); });
    strook.insertBefore(ss('defs', null, ss('pattern', { id: 'mtd-arc-res', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, ss('rect', { width: 6, height: 6, class: 'mtd-arcres-bg' }), ss('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'mtd-arcres-lijn', 'stroke-width': 2 }))), strook.firstChild);
    // tooltip (computer) en infopaneel (telefoon / vastgezet)
    const tip = ee('div', { class: 'mtd-tip', role: 'status', hidden: true }), info = ee('div', { class: 'mtd-info', role: 'status' });
    const vast0 = per.findIndex(p => p.id === st.vast), laatsteAf = (() => { let k = -1; per.forEach((p, i) => { if (p.P.maanden && !p.P.prognose && !isLopend(p)) k = i; }); return k; })();
    let vastI = vast0 >= 0 ? vast0 : (mobiel() ? laatsteAf : -1), nu = -1;
    const vul = (i, tooltip) => { const p = per[i], c = C.periodeInhoud(p, i, vgl), kop = ee('div', { class: 'mtd-tk' }, ee('span', { class: 'mtd-tt' }, c.titel), ee('span', { class: 'mtd-tlab' + (c.fc ? ' fc' : '') }, c.label));
      const dl = [kop].concat(c.rijen.map(rijTip));
      if (!tooltip && c.act) dl.push(ee('div', { class: 'mtd-tacties' }, ee('button', { class: 'mtc-knop', 'data-drill': 'omzet:' + p.id, 'data-fk': 'drill-info' }, 'Omzetstukken bekijken')));
      return dl; };
    const toon = (i) => { nu = i; const p = per[i]; kruis.setAttribute('x1', x(i)); kruis.setAttribute('x2', x(i)); kruis.setAttribute('visibility', 'visible');
      bars.forEach((g, k) => g.classList.toggle('sel', k === i)); tip.hidden = false; tip.replaceChildren(...vul(i, true)); tip.style.left = (x(i) / br * 100) + '%'; tip.style.transform = i < 2 ? 'translateX(8px)' : i > n - 3 ? 'translateX(calc(-100% - 8px))' : 'translateX(-50%)';
      info.replaceChildren(...vul(i, false)); info.classList.add('heeft'); info.classList.toggle('vast', vastI === i); };
    const weg = () => { if (vastI >= 0) { toon(vastI); return; } nu = -1; kruis.setAttribute('visibility', 'hidden'); bars.forEach(g => g.classList.remove('sel')); tip.hidden = true; };
    const pin = (i) => { vastI = vastI === i && !mobiel() ? -1 : i; st.vast = vastI >= 0 ? per[vastI].id : null; if (vastI < 0) { info.replaceChildren(); info.classList.remove('heeft', 'vast'); } toon(i); if (vastI < 0) { /* alleen hover */ } };
    per.forEach((p, i) => { const hit = ss('rect', { class: 'mtd-hit', x: ml + i * bw, y: mt - 16, width: bw, height: ho - mt + 16, tabindex: '0', role: 'button', 'data-fk': 'kol-' + i, 'aria-label': `${st.zoom === 'M' ? maandLang(p.id) : (p.label || p.id)}: ${(p.P.maanden ? kort(p.P.omzet) : '—')}${p.P.prognose > 0 ? ' + ' + kort(p.P.prognose) + ' verwacht' : ''}. Tonen.` });
      hit.addEventListener('mouseenter', () => toon(i)); hit.addEventListener('focus', () => toon(i)); hit.addEventListener('click', () => pin(i)); hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pin(i); } }); svg.append(hit); });
    const plot = ee('div', { class: 'mtd-plot' }, svg, tip); plot.addEventListener('mouseleave', weg);
    const wrap = ee('div', { class: 'mtd-chart' }, plot, strook, info);
    if (vastI >= 0) toon(vastI);
    return wrap;
  }
  function tabelEl(per, vgl) {
    const lab = p => (p.label || p.id) + (p.P.prognose > 0 ? ' (verw.)' : isLopend(p) ? '*' : '');
    const cel = (v, o) => Object.assign({ v, n: v == null ? 0 : 1, vol: true, fc: 0, reden: 'geen gegevens' }, o || {});
    const rijen = [{ label: 'Omzet', cellen: per.map(p => cel(p.P.maanden ? p.P.omzet : null, { fc: p.P.prognose, vol: !isLopend(p) && !(p.P.prognose > 0), reden: p.P.prognose > 0 ? '' : 'geen gegevens' })) }]
      .concat(vgl.map(r => ({ label: 'Omzet ' + r.jaar, cellen: r.w.map(v => cel(v)) })),
        [{ label: 'Kosten', cellen: per.map(p => cel(p.P.maanden ? p.P.kosten_totaal : null)) },
         { label: 'Resultaat', cellen: per.map(p => { const pr = progRes(p); return cel(p.P.maanden ? p.P.resultaat : null, { fc: p.P.maanden && pr != null ? pr - p.P.resultaat : 0, vol: !isLopend(p) && pr == null }); }) }]);
    const stijlen = ['j0'].concat(vgl.map(r => r.off > 1 ? 'j2' : 'j1'), ['kost', 'res']), naam = 'Omzet, kosten en resultaat ' + jaarTitel() + ' ' + st.jaar;
    return periodeTabelEl({ zoom: st.zoom, kolommen: per.map(p => ({ id: p.id, label: lab(p), fc: p.P.prognose > 0 })), rijen, verschil: null, totaalLabel: null }, { naam, hoek: '', stijlen });
  }
  // ── Dashboard: volledig-scherm-paneel per tegel ──
  const PANEEL_TITEL = { besteedbaar: 'Besteedbaar budget', omzet: 'Omzet', brutomarge: 'Brutomarge', resultaat: 'Resultaat', komende: 'Komende 3 maanden', kas: 'Kaspositie', opnames: 'Opnames', hoofd: 'Omzet en resultaat' };
  const ICONEN = { trend: 'M3 17l6-6 4 4 8-8M15 7h6v6', dal: 'M3 7l6 6 4-4 8 8M15 17h6v-6', klok: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', taart: 'M21 12A9 9 0 1 1 12 3v9z' };
  const mbAdmin = () => { try { const a = typeof root.getAdmin === 'function' ? String(root.getAdmin() || '') : ''; return /^[\w-]+$/.test(a) ? a : ''; } catch (e) { return ''; } };
  const sectie = (titel, sub, ...inhoud) => ee('section', { class: 'mtd-kaart', 'aria-label': titel }, ee('div', { class: 'mtd-kaartkop' }, ee('div', null, ee('h3', null, titel), sub ? ee('span', { class: 'mtc-noot' }, sub) : null)), inhoud);
  function htmlBlok(html) { const d = ee('div', { class: 'mtd-oud' }); d.innerHTML = html; return d; }   // de bestaande grafieken (esc()'t HTML-fragmenten uit grafiekHtml/bulletHtml/watervalHtml)
  function feitenSectie(id) {
    const f = C.feiten(id, { top: st.top && st.top.jaar === st.jaar && !st.top.laden ? st.top : null }); if (!f.length) return null;
    return ee('section', { class: 'mtd-kaart', 'aria-label': 'Wat de cijfers zeggen' }, ee('h3', null, 'Wat de cijfers zeggen'), f.map(x => ee('div', { class: 'mtd-feit' }, ss('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, ss('path', { d: ICONEN[x.icoon] || ICONEN.klok })),
      ee('div', null, ee('span', null, x.t), ee('span', { class: 'mtc-noot' }, x.bron)))));
  }
  function kpiRij(kpis) {
    return ee('section', { class: 'mtd-kpis', 'aria-label': 'Kerngetallen' }, kpis.map(k => ee('div', { class: 'mtd-kpi' }, ee('span', { class: 'mtd-kl' }, k.l), ee('span', { class: 'mtd-kv' + (k.prog ? ' prog' : '') }, k.v), ee('span', { class: 'mtd-ks ' + (k.goed == null ? '' : k.goed ? 'goed' : 'slecht') + (k.prog ? ' prog' : '') }, k.s || ''))));
  }
  // Verwacht per maand voor de rest van het boekjaar: de lopende maand (voor zover geboekt) plus termijnen na vandaag, en de latere maanden uit de prognose.
  function restPerMaand() {
    const huidig = st.vandaag.slice(0, 7), uit = {}, lop = st.maanden.find(m => m.id === huidig && m.maanden && !m.prognose);
    if (st.jaar !== Number(huidig.slice(0, 4))) return uit;
    uit[huidig] = (lop ? lop.omzet || 0 : 0) + C.forecastMaanden(st.prognoseRuw, st.vandaag, 1)[0].omzet;
    for (const m of C.prognose(st.maanden, st.prognoseRuw, st.vandaag, st.eerlijk, st.cats).maanden) uit[m.id] = m.omzet;
    return uit;
  }
  // Eén zin in woorden: hoeveel je voor of achter ligt op vorig jaar, op dezelfde datum (eind van de laatste afgesloten maand). Alleen echte, afgesloten cijfers.
  C.cumulZin = function (c0, c1, t, jaar) {
    if (!(t > 0) || !c0 || c0[t - 1] == null) return { tekst: 'Nog geen afgesloten maand om mee te vergelijken.', richting: null };
    const a = c0[t - 1], b = c1 ? c1[t - 1] : null, mnd = MAANDLANG[t - 1];
    if (b == null) return { tekst: `Geen vergelijking met ${jaar - 1} eind ${mnd}: niet alle maanden van ${jaar - 1} zijn beschikbaar.`, richting: null };
    const v = a - b, d = dPct(a, b), p = d == null ? '' : ` (${pct(Math.abs(d))})`;
    if (Math.abs(v) < 0.5) return { tekst: `Eind ${mnd} ligt je omzet gelijk aan ${jaar - 1} op dezelfde datum.`, richting: 0 };
    return { tekst: `Eind ${mnd} ligt je omzet ${eur(Math.abs(v))}${p} ${v > 0 ? 'voor' : 'achter'} op ${jaar - 1} op dezelfde datum.`, richting: v > 0 ? 1 : -1 };
  };
  // Opgetelde omzet door het jaar (cumulatief): boekjaar, vorige jaren en forecast.
  function cumulEl(tm) {
    const br = BR, klein = br < 500, ho = klein ? 230 : 340, ml = klein ? 40 : 56, mr = klein ? 46 : 100, mt = 28, mb = 24, bw = (br - ml - mr) / 12, x = i => ml + i * bw + bw / 2, jaar = st.jaar, lm = tm.lm, t = tm.tm;
    const cum = (j, tot) => { let s = 0, stop = false; return Array.from({ length: 12 }, (_, i) => { if (stop || i + 1 > tot) return null; const m = st.maanden.find(q => q.id === `${j}-${d2(i + 1)}`); if (!m || !m.maanden || m.prognose) { stop = true; return null; } s += m.omzet || 0; return s; }); };
    const c0 = cum(jaar, t), c1 = st.vgl.j1 ? cum(jaar - 1, 12) : null, c2 = st.vgl.j2 ? cum(jaar - 2, 12) : null, rest = restPerMaand();
    let cp = null; if (tm.verwacht != null && t > 0) { cp = Array(12).fill(null); cp[t - 1] = c0[t - 1]; let s = c0[t - 1]; for (let i = t; i < 12; i++) { s += rest[`${jaar}-${d2(i + 1)}`] || 0; cp[i] = s; } }
    const sc = C.schaalVoor([c0, c1, c2, cp].filter(Boolean), { min: 0, max: 1 }), y = v => mt + (ho - mt - mb) * (1 - (v - sc.a) / (sc.b - sc.a));
    const svg = ss('svg', { viewBox: `0 0 ${br} ${ho}`, class: 'mtd-svg', role: 'img', 'aria-label': `Opgetelde omzet ${jaar} tegenover ${jaar - 1} en ${jaar - 2}` });
    sc.ticks.forEach(tk => svg.append(ss('line', { x1: ml, x2: br - mr, y1: y(tk), y2: y(tk), class: tk === 0 ? 'mtd-as0' : 'mtd-raster' }), ss('text', { x: ml - 6, y: y(tk) + 4, 'text-anchor': 'end', class: 'mtd-astekst' }, kort(tk))));
    if (cp) { const dx = ml + t * bw; svg.append(ss('line', { x1: dx, x2: dx, y1: mt - 14, y2: ho - mb, class: 'mtd-scheid' }), ss('text', { x: dx + (dx > br - 150 ? -5 : 5), y: mt - 5, 'text-anchor': dx > br - 150 ? 'end' : 'start', class: 'mtd-scheidtekst' }, 'vanaf hier verwachting')); }
    const lijn = (r, cls) => r ? svg.append(ss('path', { d: padD(r.map((v, i) => v == null ? null : [x(i), y(v)])), class: cls })) : null;
    lijn(c2, 'mtd-l-vgl o2'); lijn(c1, 'mtd-l-vgl o1'); lijn(cp, 'mtd-l-prog'); lijn(c0, 'mtd-l-huidig');
    // jaarlabels direct bij de lijnen (geen kleur-alleen), op de rechterrand zonder elkaar te raken
    const eindY = r => { if (!r) return null; for (let i = 11; i >= 0; i--) if (r[i] != null) return { i, v: r[i] }; return null; };
    const lab = [[c2, String(jaar - 2), 'o2'], [c1, String(jaar - 1), 'o1'], [cp, klein ? 'verw.' : 'verwacht', 'prog']].map(([r, t, k]) => { const e = eindY(r); return e ? { t, k, x: x(e.i) + 7, y: y(e.v) } : null; }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < lab.length; i++) if (lab[i].y - lab[i - 1].y < 14) lab[i].y = lab[i - 1].y + 14;
    lab.forEach(l => svg.append(ss('text', { x: l.x, y: l.y + 4, class: 'mtd-lijnlabel ' + l.k }, l.t)));
    const e0 = eindY(c0); if (e0) svg.append(ss('text', { x: x(e0.i) - 6, y: y(e0.v) + 20, 'text-anchor': 'end', class: 'mtd-lijnlabel huidig' }, String(jaar)));
    MND.forEach((m, i) => svg.append(ss('text', { x: x(i), y: ho - mb + 16, 'text-anchor': 'middle', class: 'mtd-xtekst' + (i >= t && cp ? ' fc' : '') }, m)));
    const kruis = ss('line', { class: 'mtd-kruis', y1: mt - 4, y2: ho - mb }); svg.append(kruis);
    const tip = ee('div', { class: 'mtd-tip', role: 'status' });
    const toon = (i) => { kruis.setAttribute('x1', x(i)); kruis.setAttribute('x2', x(i)); const geb = c0[i] != null, fc = !geb && cp && cp[i] != null, v = geb ? c0[i] : fc ? cp[i] : null, rijen = [];
      if (v != null) rijen.push({ l: String(jaar), v: kort(v), stip: fc ? 'prog' : 'huidig' });
      for (const [r, off, streep] of [[c1, 1, 'dashed'], [c2, 2, 'dotted']]) if (r && r[i] != null) rijen.push({ l: String(jaar - off), v: kort(r[i]), d: v != null ? pctTeken(dPct(v, r[i])) : '', goed: v != null ? v >= r[i] : null, stip: streep });
      tip.replaceChildren(ee('div', { class: 'mtd-tk' }, ee('span', { class: 'mtd-tt' }, 't/m ' + MAANDLANG[i]), ee('span', { class: 'mtd-tlab' + (fc ? ' fc' : '') }, fc ? 'verwachting' : geb ? 'opgeteld' : '')), ...rijen.map(rijTip));
      tip.style.left = (x(i) / br * 100) + '%'; tip.style.transform = i < 2 ? 'translateX(8px)' : i > 8 ? 'translateX(calc(-100% - 8px))' : 'translateX(-50%)'; };
    MND.forEach((m, i) => { const hit = ss('rect', { class: 'mtd-hit', x: ml + i * bw, y: mt - 16, width: bw, height: ho - mt + 16, tabindex: '0', role: 'button', 'data-fk': 'cum-' + i, 'aria-label': `Opgeteld t/m ${MAANDLANG[i]}` });
      hit.addEventListener('mouseenter', () => toon(i)); hit.addEventListener('focus', () => toon(i)); hit.addEventListener('click', () => toon(i)); svg.append(hit); });
    toon(Math.max(0, Math.min(11, (t || 1) - 1)));
    const z = C.cumulZin(c0, c1 || cum(jaar - 1, 12), t, jaar);
    const leg = ee('div', { class: 'mtd-legenda' }, legendaItem('huidig', String(jaar)), c1 ? legendaItem('dashed', String(jaar - 1)) : null, c2 ? legendaItem('dotted', String(jaar - 2)) : null, cp ? legendaItem('prog', 'verwachting') : null);
    return ee('div', { class: 'mtd-chart' }, ee('p', { class: 'mtd-cumzin ' + (z.richting === 1 ? 'voor' : z.richting === -1 ? 'achter' : ''), role: 'status' }, ee('span', { class: 'pijl', 'aria-hidden': 'true' }, z.richting === 1 ? '▲' : z.richting === -1 ? '▼' : '–'), z.tekst), leg, ee('div', { class: 'mtd-plot' }, svg, tip));
  }
  // ── Kleur: vaste kleur per categorie (tokens en klassen in css()); legenda, stapels en tabellen gebruiken dezelfde klasse ──
  const KAT_VAST = { materiaal: 0, uitbesteed: 1, personeel: 2, huisvesting: 3, overig: 4 };
  C.katKlasse = function (id, cats) {
    if (id === 'resultaat') return 'mtd-kres';
    if (Object.prototype.hasOwnProperty.call(KAT_VAST, id)) return 'mtd-k' + KAT_VAST[id];
    const vrij = (cats || []).filter(c => !Object.prototype.hasOwnProperty.call(KAT_VAST, c)), i = vrij.indexOf(id);
    return 'mtd-k' + Math.min(5 + Math.max(i, 0), 6);
  };
  const katNaam = c => c === 'resultaat' ? 'Resultaat' : (st.catNaam && st.catNaam[c]) || c;
  const katKl = c => C.katKlasse(c, st.cats);

  // ── Periodetabel: één tabelvorm voor Cijfers. Kolommen = periodes (volgt Maand/Kwartaal/Jaar), rijen = jaren of reeksen. ──
  // Rekenen los van de DOM (te testen). Een cel is {v, n, vol, fc, reden}: v = null betekent "—" met een reden; alleen afgesloten maanden tellen,
  // "verwacht" (fc) staat apart en telt nooit mee. Verschillen alleen tussen volledig afgesloten periodes.
  const PT_KOL = { M: MND.map((m, i) => ({ id: d2(i + 1), label: m, maanden: [i + 1] })), K: [1, 2, 3, 4].map(q => ({ id: 'K' + q, label: 'K' + q, maanden: [q * 3 - 2, q * 3 - 1, q * 3] })) };
  C.periodeTabelModel = function (o) {
    const kol = PT_KOL[o.zoom === 'K' ? 'K' : 'M'], lm = o.lm || null, lmJ = lm ? Number(lm.slice(0, 4)) : 0, rest = o.rest || {}, meet = o.meet || (P => P.omzet);
    const cel = (j, nrs, metFc) => {
      const ids = nrs.map(n => `${j}-${d2(n)}`), ms = ids.map(id => o.maanden.find(m => m.id === id)), dicht = ms.filter(m => m && m.maanden && !m.prognose && lm && m.id <= lm);
      const v = dicht.length ? meet(C.som(dicht, o.cats, o.eerlijk)) : null, fc = metFc && j === o.jaar ? ids.reduce((a, id) => a + (rest[id] || 0), 0) : 0;
      return { v, n: dicht.length, vol: dicht.length === nrs.length, fc, reden: v != null ? '' : (!lm || ids.every(id => id > lm)) ? 'nog niet afgesloten' : 'niet opgehaald' };
    };
    const tm = tmVan(o.jaar, lm), tot = tm > 0 ? Array.from({ length: tm }, (_, i) => i + 1) : [];
    const rij = j => ({ jaar: j, label: String(j), cellen: kol.map(k => cel(j, k.maanden, true)), totaal: tm > 0 ? (c => c.n === tm ? c : Object.assign(c, { v: null, reden: 'niet alle maanden beschikbaar' }))(cel(j, tot, false)) : { v: null, n: 0, vol: false, fc: 0, reden: 'nog niet afgesloten' } });
    const jaren = (o.jaren && o.jaren.length ? o.jaren : [o.jaar]).filter(j => j >= Number(START.slice(0, 4))), rijen = jaren.map(rij);
    // verschil met het jaar ervoor (altijd berekend, ook als die rij niet getoond wordt)
    const vorig = o.jaar - 1, heeftVorig = vorig >= Number(START.slice(0, 4)), nu = rijen.find(r => r.jaar === o.jaar) || rij(o.jaar), vr = rijen.find(r => r.jaar === vorig) || (heeftVorig ? rij(vorig) : null);
    const delta = (a, b) => { if (!b) return { d: null, reden: 'geen gegevens ' + vorig }; if (a.v == null) return { d: null, reden: a.reden || 'geen gegevens' }; if (b.v == null) return { d: null, reden: 'geen gegevens ' + vorig }; if (!a.vol || !b.vol) return { d: null, reden: 'alleen afgesloten periodes' }; const d = dPct(a.v, b.v); return d == null ? { d: null, reden: 'vorig jaar is 0' } : { d, reden: '' }; };
    const verschil = heeftVorig ? { label: 'Verschil met ' + vorig, cellen: nu.cellen.map((c, i) => delta(c, vr.cellen[i])), totaal: delta(Object.assign({}, nu.totaal, { vol: nu.totaal.v != null }), Object.assign({}, vr.totaal, { vol: vr.totaal.v != null })) } : null;
    return { zoom: o.zoom, kolommen: kol.map(k => ({ id: k.id, label: k.label })), rijen, verschil, totaalLabel: tm > 0 && tm < 12 ? 't/m ' + MND[tm - 1] : 'Jaar', hoofdJaar: o.jaar };
  };
  // Zoom Jaar (t/m nu) en 5 jaar: de kolommen zijn jaren, één rij; verschil met het jaar ervoor.
  C.periodeTabelJaren = function (per, o) {
    const lm = o.lm || null, tmL = lm ? Number(lm.slice(5, 7)) : 0, meet = o.meet || (P => P.omzet);
    const cellen = per.map(p => { const n = p.P.maanden, want = o.zoom === 'J' ? tmL : 12, vol = n > 0 && n === want, v = n > 0 ? meet(p.P) : null; return { v, n, vol, fc: 0, reden: v != null ? '' : 'geen gegevens' }; });
    const verschil = { label: 'Verschil met jaar ervoor', cellen: cellen.map((c, i) => { const b = cellen[i - 1]; if (i === 0) return { d: null, reden: 'geen jaar ervoor' }; if (!c.vol || !b || !b.vol) return { d: null, reden: 'alleen afgesloten periodes' }; const d = dPct(c.v, b.v); return d == null ? { d: null, reden: 'jaar ervoor is 0' } : { d, reden: '' }; }) };
    return { zoom: o.zoom, kolommen: per.map(p => ({ id: p.id, label: p.label || p.id })), rijen: [{ jaar: null, label: o.label || 'Omzet', cellen, totaal: null }], verschil, totaalLabel: null };
  };
  // Tekenen. Eerste rij is het hoofdjaar (vet), de rest grijzer; cel-balkjes op één schaal voor de hele tabel.
  function periodeTabelEl(m, o) {
    o = o || {}; const alle = m.rijen.flatMap(r => r.cellen.map(c => c.v != null ? Math.abs(c.v) + (c.fc || 0) : 0)), max = Math.max(1, ...alle), heeftTot = !!m.totaalLabel, nKol = m.kolommen.length + (heeftTot ? 1 : 0);
    const celEl = (c, bar, stijl, tot) => {
      const leeg = c.v == null && !(c.fc > 0), neg = c.v != null && c.v < 0;
      return ee('td', { class: [leeg ? 'leeg' : '', c.v != null && !c.vol ? 'deels' : '', neg ? 'slecht' : '', tot ? 'tot' : ''].filter(Boolean).join(' '), title: leeg ? c.reden : c.v != null && !c.vol ? 'nog niet alle maanden afgesloten' : null },
        leeg ? '—' : [ee('span', { class: 'mtd-pt-v' }, c.v == null ? '—' : kort(c.v)), c.fc > 0 ? ee('span', { class: 'mtd-pt-fc' }, '+ ' + kort(c.fc) + ' verwacht') : null,
          bar && c.v != null && c.v > 0 ? ee('span', { class: 'mtd-pt-bar ' + stijl, style: 'width:' + Math.max(3, Math.round(c.v / max * 100)) + '%' }) : null]);
    };
    const rijEl = (r, ri) => ee('tr', { class: ri === 0 ? 'kop' : '' }, ee('th', { scope: 'row' }, r.label), r.cellen.map(c => celEl(c, !o.zonderBalk, o.stijlen ? o.stijlen[ri] : 'j' + Math.min(ri, 2), false)), heeftTot && r.totaal ? celEl(r.totaal, false, '', true) : null);
    const vs = m.verschil ? ee('tr', { class: 'vs' }, ee('th', { scope: 'row' }, m.verschil.label), m.verschil.cellen.map(c => ee('td', { class: c.d == null ? 'leeg' : Math.abs(c.d) < 0.05 ? '' : c.d > 0 ? 'goed' : 'slecht', title: c.d == null ? c.reden : null }, c.d == null ? '—' : (Math.abs(c.d) < 0.05 ? '' : c.d > 0 ? '▲ ' : '▼ ') + pctTeken(c.d))),
      heeftTot ? ee('td', { class: 'tot ' + (m.verschil.totaal.d == null ? 'leeg' : m.verschil.totaal.d >= 0 ? 'goed' : 'slecht'), title: m.verschil.totaal.d == null ? m.verschil.totaal.reden : null }, m.verschil.totaal.d == null ? '—' : (m.verschil.totaal.d >= 0 ? '▲ ' : '▼ ') + pctTeken(m.verschil.totaal.d)) : null) : null;
    return ee('div', { class: 'mtd-pt', role: 'region', 'aria-label': o.naam || 'Tabel', tabindex: '0' }, ee('table', { style: 'min-width:' + (96 + nKol * 66) + 'px' }, ee('caption', { class: 'sr' }, o.naam || 'Tabel'),
      ee('thead', null, ee('tr', null, ee('th', { scope: 'col' }, o.hoek || ''), m.kolommen.map(k => ee('th', { scope: 'col', class: k.fc ? 'fc' : '' }, k.label)), heeftTot ? ee('th', { scope: 'col', class: 'tot' }, m.totaalLabel) : null)),
      ee('tbody', null, m.rijen.map(rijEl), vs)));
  }
  const zoomWoord = () => st.zoom === 'M' ? 'maand' : st.zoom === 'K' ? 'kwartaal' : 'jaar';
  // Omzet-tabel van het Omzet-paneel: volgt de knop Maand/Kwartaal/Jaar (de oude kwartaaltabel negeerde die).
  function omzetTabelSectie(tm) {
    const lm = tm.lm || laatste(), naam = 'Omzet per ' + zoomWoord() + (st.zoom === 'M' || st.zoom === 'K' ? ' ' + st.jaar : '');
    const noot = ee('span', { class: 'mtc-noot' }, 'Verschil alleen voor afgesloten periodes ("—" = geen vergelijking mogelijk, houd de muis erboven voor de reden). "Verwacht" = lopende maand (voor zover geboekt) plus forecast; dat telt niet mee in de kerncijfers.');
    if (st.zoom === 'J' || st.zoom === '5J') return sectie(naam, null, periodeTabelEl(C.periodeTabelJaren(huidigePeriodes(), { zoom: st.zoom, lm, meet: P => P.omzet, label: 'Omzet' }), { naam, hoek: '' }), noot);
    const model = C.periodeTabelModel({ maanden: st.maanden, cats: st.cats, eerlijk: st.eerlijk, zoom: st.zoom, jaar: st.jaar, jaren: [st.jaar].concat(vglOffsets().map(off => st.jaar - off)), lm, rest: restPerMaand(), meet: P => P.omzet });
    return sectie(naam, null, periodeTabelEl(model, { naam, hoek: '' }), noot);
  }

    // ── Oordelen: goed / let op / slecht, vastgelegd in één constante (nooit alleen kleur: er hoort altijd een woord en teken bij) ──
  const DREMPEL = C.DREMPEL = { INLIJN_PP: 1, SLECHT_PP: 5 };   // verschil in procentpunten: binnen INLIJN_PP = in lijn; tot SLECHT_PP = let op; daarboven slecht
  // ref: een getal (punt) of {van, tot} / {pct} zoals de branchecijfers. hogerIsGoed bepaalt welke kant gunstig is. pp = punten buiten de band (0 = erbinnen).
  C.oordeel = function (v, ref, hogerIsGoed) {
    if (v == null || !isFinite(v) || ref == null) return null;
    let lo, hi; if (typeof ref === 'number') { if (!isFinite(ref)) return null; lo = hi = ref; } else if (ref.van != null && ref.tot != null) { lo = ref.van; hi = ref.tot; } else if (ref.pct != null) { lo = hi = ref.pct; } else return null;
    const pp = v > hi ? v - hi : v < lo ? v - lo : 0, abs = Math.abs(pp), beter = hogerIsGoed ? pp > 0 : pp < 0;
    if (abs <= DREMPEL.INLIJN_PP) return { niveau: 'goed', woord: 'in lijn', pp, beter: false };
    if (beter) return { niveau: 'goed', woord: 'beter', pp, beter: true };
    return abs <= DREMPEL.SLECHT_PP ? { niveau: 'let-op', woord: 'iets slechter', pp, beter: false } : { niveau: 'slecht', woord: 'duidelijk slechter', pp, beter: false };
  };
  const OORDEEL_ICOON = { 'goed': '✓', 'let-op': '!', 'slecht': '✕' };
  const oordeelEl = (o, tekst) => o ? ee('span', { class: 'mtd-oordeel ' + o.niveau }, ee('span', { 'aria-hidden': 'true' }, OORDEEL_ICOON[o.niveau]), tekst ? tekst : o.woord) : null;
  const puntTekst = pp => pp == null ? '' : (Math.abs(pp) < 0.05 ? '0,0' : puntTeken(pp)) + ' punt';

  // ── Stapel "Waar ging de omzet heen" (rekenen los te testen): per periode kosten per categorie + resultaat, alleen geboekte cijfers ──
  // Positieve delen stapelen vanaf 0; een negatief resultaat staat onder de nullijn en telt niet in de stapel (die loopt dan tot de kosten, de omzet staat als streep).
  C.stapelModel = function (per, cats) {
    const kol = per.map(p => {
      const P = p.P; if (!(P.maanden > 0)) return { id: p.id, label: p.label || p.id, geen: true };
      const omzet = P.omzet, resultaat = omzet - P.kosten_totaal, delen = cats.map(c => ({ id: c, v: P.kosten[c] || 0 })), boven = []; let top = 0, credit = 0;
      for (const d of delen) { if (d.v > 0) { boven.push({ id: d.id, v: d.v, y0: top, y1: top + d.v }); top += d.v; } else if (d.v < 0) credit += -d.v; }
      let onder = null; if (resultaat > 0) { boven.push({ id: 'resultaat', v: resultaat, y0: top, y1: top + resultaat }); top += resultaat; } else if (resultaat < 0) onder = { id: 'resultaat', v: resultaat, y0: 0, y1: resultaat };
      const alle = delen.concat([{ id: 'resultaat', v: resultaat }]);
      return { id: p.id, label: p.label || p.id, geen: false, omzet, resultaat, delen: alle.map(d => Object.assign(d, { pct: omzet > 0 ? d.v / omzet * 100 : null })), boven, onder, top: Math.max(top, omzet), som: alle.reduce((a, d) => a + d.v, 0), credit };
    });
    const ks = kol.filter(k => !k.geen);
    return { kolommen: kol, max: ks.length ? Math.max(...ks.map(k => k.top)) : 0, min: ks.length ? Math.min(0, ...ks.map(k => k.onder ? k.onder.y1 : 0)) : 0 };
  };
  // Vergelijking van één gekozen periode met dezelfde periode in de twee vorige jaren en de branche. Alleen tussen afgesloten periodes; ontbrekend = {v:null, reden}.
  const verwachtMnd = (zoom, lm) => zoom === 'M' ? 1 : zoom === 'K' ? 3 : zoom === 'J' ? (lm ? Number(lm.slice(5, 7)) : 0) : 12;
  C.periodeAfgesloten = (p, zoom, lm) => !!lm && !!p && p.P.maanden > 0 && p.P.maanden === verwachtMnd(zoom, lm) && p.ms.every(m => m.prognose || m.id <= lm);
  C.stapelVergelijk = function (o) {
    const { per, i, zoom, lm } = o, p = per[i], ond = P => { if (!(P.omzet > 0)) return null; const u = { brutomarge: P.brutomarge_pct, resultaat: P.resultaat / P.omzet * 100 }; for (const c of o.cats) u[c] = (P.kosten[c] || 0) / P.omzet * 100; return u; };
    const dit = p && p.P.maanden > 0 ? ond(p.P) : null, ditOk = C.periodeAfgesloten(p, zoom, lm);
    const reden0 = !p || !(p.P.maanden > 0) ? 'geen geboekte maand in deze periode' : !(p.P.omzet > 0) ? 'geen omzet in deze periode' : !ditOk ? 'deze periode is nog niet afgesloten' : '';
    const vorigeVan = off => {
      if (zoom === 'M' || zoom === 'K') { const j = o.jaar - off; if (j < Number(START.slice(0, 4))) return null; const q = C.periodes(o.maanden, zoom, j, lm, [])[i]; return q ? Object.assign(q, { P: C.som(q.ms, o.cats, o.eerlijk) }) : null; }
      return per.find(x => x.id === String(Number(p.id) - off)) || null;
    };
    const vorig = o.offsets.map(off => {
      const q = vorigeVan(off), jr = zoom === 'M' || zoom === 'K' ? o.jaar - off : Number(p.id) - off, uit = { off, jaar: jr, label: String(jr), delen: null, v: null, reden: '' };
      if (reden0) { uit.reden = reden0; return uit; }
      if (!q || !(q.P.maanden > 0)) { uit.reden = 'geen gegevens ' + jr; return uit; }
      if (!C.periodeAfgesloten(q, zoom, lm)) { uit.reden = 'periode ' + jr + ' is niet volledig'; return uit; }
      uit.u = ond(q.P); uit.P = q.P; if (!uit.u) uit.reden = 'geen omzet in ' + jr; return uit;
    });
    const namen = ['brutomarge'].concat(o.cats, ['resultaat']);
    const onderdelen = namen.map(id => {
      const hoger = id === 'brutomarge' || id === 'resultaat', v = dit ? dit[id] : null, ref = o.bm ? o.bm[id] : null;
      const vj = vorig.map(q => { const w = q.u ? q.u[id] : null, ord = reden0 || w == null ? null : C.oordeel(v, w, hoger); return { off: q.off, jaar: q.jaar, v: w, pp: w == null || v == null ? null : v - w, oordeel: ord, reden: w != null ? '' : (q.reden || 'geen gegevens ' + q.jaar) }; });
      const br = { ref: ref || null, oordeel: null, reden: '' };
      if (reden0) br.reden = reden0; else if (!ref || (ref.van == null && ref.pct == null)) br.reden = 'geen branchecijfer voor ' + (id === 'brutomarge' ? 'brutomarge' : katNaam(id).toLowerCase()); else br.oordeel = C.oordeel(v, ref, hoger);
      return { id, naam: id === 'brutomarge' ? 'Brutomarge' : katNaam(id), hogerIsGoed: hoger, v, vorig: vj, branche: br };
    });
    return { afgesloten: ditOk, reden: reden0, onderdelen, vorig, dit };
  };
  const bmTekst2 = b => !b ? '' : b.van != null && b.tot != null ? `${pct(b.van)}–${pct(b.tot)}` : pct(b.pct);

  function stapelKaart(per) {
    const m = C.stapelModel(per, st.cats), br = BR, klein = br < 500, ho = klein ? 230 : 320, ml = klein ? 40 : 56, mr = 10, mt = 14, mb = 26, n = Math.max(1, per.length), bw = (br - ml - mr) / n, x = i => ml + i * bw + bw / 2;
    const sc = C.schaalVoor([[m.max], [m.min]], { min: 0, max: 1 }), y = v => mt + (ho - mt - mb) * (1 - (v - sc.a) / (sc.b - sc.a)), w = Math.max(6, Math.min(56, bw * 0.66));
    const heeft = m.kolommen.some(k => !k.geen);
    const svg = ss('svg', { viewBox: `0 0 ${br} ${ho}`, class: 'mtd-svg', role: 'img', 'aria-label': `Waar ging de omzet heen, per ${zoomWoord()}: materiaal, uitbesteed, personeel, overige kosten en resultaat, geboekte cijfers` });
    svg.append(ss('defs', null, ss('pattern', { id: 'mtd-verlies', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, ss('rect', { width: 6, height: 6, class: 'mtd-verlies-bg' }), ss('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'mtd-verlies-lijn', 'stroke-width': 2 }))));
    sc.ticks.forEach(tk => svg.append(ss('line', { x1: ml, x2: br - mr, y1: y(tk), y2: y(tk), class: tk === 0 ? 'mtd-as0' : 'mtd-raster' }), ss('text', { x: ml - 6, y: y(tk) + 4, 'text-anchor': 'end', class: 'mtd-astekst' }, kort(tk))));
    const sel = per.findIndex(p => p.id === st.stapelSel), tip = ee('div', { class: 'mtd-tip', role: 'status', hidden: true });
    const tipVul = k => { tip.replaceChildren(ee('div', { class: 'mtd-tk' }, ee('span', { class: 'mtd-tt' }, k.label), ee('span', { class: 'mtd-tlab' }, 'geboekt')),
      ee('div', { class: 'mtd-tr' }, ee('span', { class: 'mtd-sw lijn' }), ee('span', { class: 'mtd-tl' }, 'Omzet'), ee('span', { class: 'mtd-tv' }, kort(k.omzet)), ee('span', { class: 'mtd-td' }, '100%')),
      ...k.delen.map(d => ee('div', { class: 'mtd-tr' }, ee('span', { class: 'mtd-sw ' + (d.id === 'resultaat' && d.v < 0 ? 'verlies' : katKl(d.id)) }), ee('span', { class: 'mtd-tl' }, katNaam(d.id) + (d.id === 'resultaat' && d.v < 0 ? ' (verlies)' : '')), ee('span', { class: 'mtd-tv' }, kort(d.v)), ee('span', { class: 'mtd-td' }, d.pct == null ? '' : Math.round(d.pct) + '%')))); };
    m.kolommen.forEach((k, i) => {
      if (k.geen) return; const x0 = x(i) - w / 2, g = ss('g', { class: 'mtd-stapel' + (i === sel ? ' sel' : '') });
      k.boven.forEach(s => g.append(ss('rect', { class: 'mtd-seg ' + katKl(s.id), x: x0, y: y(s.y1), width: w, height: Math.max(0.5, y(s.y0) - y(s.y1)) }, ss('title', null, `${katNaam(s.id)} ${k.label}: ${eur(s.v)}`))));
      if (k.onder) g.append(ss('rect', { class: 'mtd-seg mtd-verlies', x: x0, y: y(0), width: w, height: Math.max(0.5, y(k.onder.y1) - y(0)) }, ss('title', null, `Verlies ${k.label}: ${eur(k.resultaat)}`)));
      g.append(ss('line', { class: 'mtd-omzetlijn', x1: x0 - 3, x2: x0 + w + 3, y1: y(k.omzet), y2: y(k.omzet) }, ss('title', null, `Omzet ${k.label}: ${eur(k.omzet)}`)));
      svg.append(g);
    });
    per.forEach((p, i) => svg.append(ss('text', { x: x(i), y: ho - mb + 17, 'text-anchor': 'middle', class: 'mtd-xtekst' }, (p.label || p.id) + (isLopend(p) ? '*' : ''))));
    const kruis = ss('line', { class: 'mtd-kruis', y1: mt - 4, y2: ho - mb, visibility: 'hidden' }); svg.append(kruis);
    per.forEach((p, i) => { const k = m.kolommen[i], naamP = st.zoom === 'M' ? maandLang(p.id) : (p.label || p.id);
      const hit = ss('rect', { class: 'mtd-hit', x: ml + i * bw, y: mt - 8, width: bw, height: ho - mt - mb + 8, tabindex: '0', role: 'button', 'data-stapel': p.id, 'data-fk': 'stap-' + i, 'aria-pressed': String(i === sel),
        'aria-label': k.geen ? `${naamP}: geen geboekte cijfers` : `${naamP}: omzet ${kort(k.omzet)}, resultaat ${kort(k.resultaat)}. Vergelijking tonen.` });
      if (!k.geen) { hit.addEventListener('mouseenter', () => { kruis.setAttribute('x1', x(i)); kruis.setAttribute('x2', x(i)); kruis.setAttribute('visibility', 'visible'); tipVul(k); tip.hidden = false; tip.style.left = (x(i) / br * 100) + '%'; tip.style.transform = i < 2 ? 'translateX(8px)' : i > n - 3 ? 'translateX(calc(-100% - 8px))' : 'translateX(-50%)'; });
        hit.addEventListener('mouseleave', () => { kruis.setAttribute('visibility', 'hidden'); tip.hidden = true; }); }
      hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
      svg.append(hit); });
    const gebruikt = st.cats.filter(c => m.kolommen.some(k => !k.geen && k.delen.some(d => d.id === c && d.v > 0))), verlies = m.kolommen.some(k => k.onder);
    const leg = ee('div', { class: 'mtd-legenda', role: 'list', 'aria-label': 'Legenda' }, gebruikt.map(c => ee('span', { class: 'mtd-leg', role: 'listitem' }, ee('span', { class: 'mtd-sw ' + katKl(c) }), katNaam(c))), ee('span', { class: 'mtd-leg', role: 'listitem' }, ee('span', { class: 'mtd-sw mtd-kres' }), 'Resultaat'),
      verlies ? ee('span', { class: 'mtd-leg', role: 'listitem' }, ee('span', { class: 'mtd-sw verlies' }), 'Verlies (onder de nullijn)') : null, ee('span', { class: 'mtd-leg', role: 'listitem' }, ee('span', { class: 'mtd-sw lijn' }), 'Omzet'));
    if (!heeft) return ee('p', { class: 'mtc-noot' }, 'Geen geboekte cijfers in deze periodes.');
    const delen = [leg, ee('div', { class: 'mtd-plot' }, svg, tip)];
    if (sel >= 0 && !m.kolommen[sel].geen) delen.push(stapelDetail(per, sel));
    else delen.push(ee('p', { class: 'mtc-noot' }, `Klik op een kolom om die ${zoomWoord()} te vergelijken met dezelfde periode in eerdere jaren en met de branche.`));
    return ee('div', { class: 'mtd-chart' }, delen);
  }
  const pctF = v => v == null ? '—' : v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  function stapelDetail(per, i) {
    const p = per[i], v = C.stapelVergelijk({ per, i, zoom: st.zoom, jaar: st.jaar, maanden: st.maanden, cats: st.cats, eerlijk: st.eerlijk, bm: st.bm, lm: laatste(), offsets: [1, 2] });
    const titel = st.zoom === 'M' ? maandLang(p.id) : st.zoom === 'K' ? `${p.label} ${st.jaar}` : (p.label || p.id);
    // 100%-balken: de verdeling van elke € omzet per periode, zelfde kleuren als de stapel
    const balk = (naam, u, P) => { const delen = u ? [].concat(st.cats.map(c => ({ id: c, v: P.kosten[c] || 0 })), [{ id: 'resultaat', v: P.omzet - P.kosten_totaal }]) : null;
      if (!delen) return null;
      const pos = delen.filter(d => d.v > 0), tot = pos.reduce((a, d) => a + d.v, 0), res = delen[delen.length - 1].v;
      return ee('div', { class: 'mtd-s100' }, ee('span', { class: 'mtd-s100-n' }, naam), ee('div', { class: 'mtd-s100-b', role: 'img', 'aria-label': naam + ': ' + delen.map(d => `${katNaam(d.id)} ${pctF(d.v / P.omzet * 100)}`).join(', ') },
        pos.map(d => ee('span', { class: 'mtd-s100-d ' + katKl(d.id), style: 'flex:' + (d.v / tot).toFixed(4), title: `${katNaam(d.id)}: ${pctF(d.v / P.omzet * 100)} van de omzet` }, d.v / tot > 0.07 ? Math.round(d.v / P.omzet * 100) + '%' : ''))),
        ee('span', { class: 'mtd-s100-t' }, res < 0 ? 'kosten ' + Math.round(-res / P.omzet * 100 + 100) + '% van de omzet: verlies' : ''));
    };
    const rijen = [balk(titel, v.dit, p.P)].concat(v.vorig.map(q => q.u ? balk(q.label, q.u, q.P) : ee('div', { class: 'mtd-s100' }, ee('span', { class: 'mtd-s100-n' }, q.label), ee('span', { class: 'mtd-s100-leeg' }, '— ' + q.reden))));
    const ond = v.onderdelen.filter(o => o.v != null || o.id === 'brutomarge');
    const tabel = ee('div', { class: 'mtd-pt', role: 'region', 'aria-label': 'Vergelijking per onderdeel', tabindex: '0' }, ee('table', { style: 'min-width:560px' }, ee('caption', { class: 'sr' }, 'Vergelijking van ' + titel + ' met vorige jaren en de branche, in procenten van de omzet'),
      ee('thead', null, ee('tr', null, ee('th', { scope: 'col' }, 'Onderdeel'), ee('th', { scope: 'col' }, titel), v.vorig.map(q => ee('th', { scope: 'col' }, q.label)), ee('th', { scope: 'col' }, 'Branche'))),
      ee('tbody', null, ond.map(o => ee('tr', null, ee('th', { scope: 'row' }, ee('span', { class: 'mtd-sw ' + (o.id === 'brutomarge' ? 'mtd-kres' : katKl(o.id)), style: 'margin-right:6px' }), o.naam), ee('td', null, pctF(o.v)),
        o.vorig.map(q => ee('td', { class: q.v == null ? 'leeg' : '', title: q.v == null ? q.reden : null }, q.v == null ? '—' : [pctF(q.v), ee('span', { class: 'mtd-pt-fc' }, puntTekst(q.pp), ' ', oordeelEl(q.oordeel))])),
        ee('td', { class: o.branche.ref && !o.branche.reden ? '' : 'leeg', title: o.branche.reden || null }, o.branche.reden ? '—' : [bmTekst2(o.branche.ref), ee('span', { class: 'mtd-pt-fc' }, oordeelEl(o.branche.oordeel, o.branche.oordeel.woord + ' (' + puntTekst(o.branche.oordeel.pp) + ')'))]))))));
    const redenen = [...new Set(v.vorig.filter(q => !q.u).map(q => q.reden))];
    return ee('div', { class: 'mtd-info vast heeft mtd-sdetail' }, ee('div', { class: 'mtd-tk' }, ee('span', { class: 'mtd-tt' }, titel), ee('span', { class: 'mtd-tlab' }, 'geboekt, geen prognose')),
      ee('h4', { class: 'mtd-sh' }, 'Waar ging elke € omzet heen'), ee('div', { class: 'mtd-s100s' }, rijen),
      ee('h4', { class: 'mtd-sh' }, 'Tegenover vorige jaren en de branche'), !v.afgesloten ? ee('p', { class: 'mtc-noot' }, 'Geen vergelijking: ' + v.reden + '. Vergelijken gebeurt alleen tussen afgesloten periodes.') : null,
      tabel, redenen.length && v.afgesloten ? ee('p', { class: 'mtc-noot' }, 'Niet vergeleken: ' + redenen.join('; ') + '.') : null,
      ee('div', { class: 'mtd-tacties' }, ee('button', { class: 'mtc-knop', 'data-drill': 'omzet:' + p.id, 'data-fk': 'drill-stapel' }, 'Omzetstukken bekijken')));
  }
  function stapelSectie(per) {
    return sectie('Waar ging de omzet heen', `Per ${zoomWoord()}, alleen geboekte cijfers (geen prognose) · klik op een kolom voor de vergelijking`, stapelKaart(per),
      ee('span', { class: 'mtc-noot' }, 'De streep is de omzet. Een negatief resultaat staat onder de nullijn en telt niet mee in de stapel; die loopt dan tot de totale kosten. Eerlijk beeld: lonen buiten de W&V tellen mee bij personeel (zoals ingesteld).' + (per.some(isLopend) ? ' * = lopende maand: nog niet compleet, dus vaak nog zonder alle omzet.' : '')));
  }
  async function laadTop() {
    if (st.top && st.top.laden) return;   // geen tweede ronde verzoeken terwijl de eerste loopt
    const lm = laatste(), jaar = st.jaar, ms = st.maanden.filter(m => m.maanden && !m.prognose && m.id.startsWith(jaar + '-') && m.id <= lm).map(m => m.id), top = st.top = { jaar, laden: true, items: [], totaal: 0, onvolledig: false, fouten: 0, klaar: 0, n: ms.length }, per = new Map();
    tekenPaneel();
    try {
      for (const ym of ms) {
        if (st.top !== top) return;
        try {
          const r = await st.bron.haal(`/geld/cijfers/detail?maand=${encodeURIComponent(ym)}&reeks=omzet`);
          if (!r || r.error) { top.onvolledig = true; top.fouten++; } else { if (r.meer || r.onvolledig) top.onvolledig = true; for (const x of r.items || []) { const k = String(x.tegenpartij || 'Onbekend'); per.set(k, (per.get(k) || 0) + (Number(x.bedrag) || 0)); } }
        } catch (e) { top.onvolledig = true; top.fouten++; }
        top.klaar++; tekenPaneel();
      }
    } finally {
      if (st.top === top) { top.items = [...per.entries()].map(([naam, v]) => ({ naam, v })).filter(x => x.v > 0).sort((a, b) => b.v - a.v); top.totaal = top.items.reduce((a, x) => a + x.v, 0); top.laden = false; tekenPaneel(); }   // altijd uit de laadstand
    }
  }
  function topSectie() {
    const top = st.top && st.top.jaar === st.jaar ? st.top : null;
    if (!top) return sectie('Waar de omzet vandaan komt', 'Per klant, uit de geboekte stukken', ee('p', { class: 'mtc-noot' }, 'Hiervoor worden de omzetstukken van alle afgesloten maanden uit Moneybird opgehaald (alleen lezen).'), ee('button', { class: 'mtc-knop', 'data-topladen': '1', 'data-fk': 'topladen' }, 'Grootste klanten tonen'));
    if (top.laden) return sectie('Waar de omzet vandaan komt', null, ee('p', { class: 'mtc-noot' }, `Ophalen uit Moneybird… ${top.klaar} van ${top.n} maanden`));
    const opnieuw = () => top.fouten ? ee('button', { class: 'mtc-knop', 'data-topladen': '1', 'data-fk': 'topladen' }, 'Opnieuw proberen') : null, fout = top.fouten ? ee('p', { class: 'mtc-waarsch' }, `Niet alle maanden konden worden opgehaald (${top.fouten} van ${top.n}); de lijst is onvolledig.`) : null;
    if (!top.items.length) return sectie('Waar de omzet vandaan komt', null, fout, ee('p', { class: 'mtc-noot' }, top.fouten ? 'Geen omzetstukken opgehaald.' : 'Geen omzetstukken gevonden.'), opnieuw());
    const v5 = top.items.slice(0, 5), rest = top.items.slice(5), max = v5[0].v, overig = rest.reduce((a, x) => a + x.v, 0);
    const balk = (naam, v, breed, grijs) => ee('div', { class: 'mtd-pr' }, ee('div', { class: 'mtd-pr-k' }, ee('span', null, naam), ee('span', { class: 'mtd-pr-v' }, kort(v))), ee('div', { class: 'mtd-pr-b' }, ee('div', { class: grijs ? 'grijs' : '', style: `width:${Math.max(1, Math.round(breed))}%` })));
    return sectie('Waar de omzet vandaan komt', 'Grootste klanten ' + st.jaar + ' (geboekte stukken)', v5.map(x => balk(x.naam, x.v, x.v / max * 100)), rest.length ? balk(`Overige klanten (${rest.length}×)`, overig, 100, true) : null,
      fout, top.onvolledig && !top.fouten ? ee('p', { class: 'mtc-noot' }, 'Er zijn kleinere posten weggelaten; de lijst kan onvolledig zijn.') : null, opnieuw());
  }
  // Komende maanden: verwachte omzet per maand uit de forecast, met de geboekte omzet van dezelfde maand vorig jaar ter vergelijking.
  function komendeSectie(tm) {
    const fm = C.forecastMaanden(st.prognoseRuw, st.vandaag, 12).filter(m => m.omzet > 0 || m.termijnen), vorig = m => { const x = st.maanden.find(q => q.id === `${Number(m.id.slice(0, 4)) - 1}${m.id.slice(4)}`); return x && x.maanden && !x.prognose ? x.omzet || 0 : null; };
    if (!fm.length) return sectie('Verwachte omzet per maand', null, ee('p', { class: 'mtc-noot' }, 'Er staan geen termijnen met een factuurdatum na vandaag in de forecast.'));
    const br = BR, klein = br < 500, ho = klein ? 200 : 280, ml = klein ? 40 : 56, mr = 10, mt = 20, mb = 24, n = fm.length, bw = (br - ml - mr) / n, x = i => ml + i * bw + bw / 2;
    const vg = fm.map(vorig), sc = C.schaalVoor([fm.map(m => m.omzet), vg], { min: 0, max: 1 }), y = v => mt + (ho - mt - mb) * (1 - (v - sc.a) / (sc.b - sc.a)), w = Math.max(4, Math.min(48, bw * 0.62));
    const svg = ss('svg', { viewBox: `0 0 ${br} ${ho}`, class: 'mtd-svg', role: 'img', 'aria-label': 'Verwachte omzet per maand' });
    svg.append(ss('defs', null, ss('pattern', { id: 'mtd-arc', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, ss('rect', { width: 6, height: 6, class: 'mtd-arc-bg' }), ss('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'mtd-arc-lijn', 'stroke-width': 2 }))));
    sc.ticks.forEach(tk => svg.append(ss('line', { x1: ml, x2: br - mr, y1: y(tk), y2: y(tk), class: tk === 0 ? 'mtd-as0' : 'mtd-raster' }), ss('text', { x: ml - 6, y: y(tk) + 4, 'text-anchor': 'end', class: 'mtd-astekst' }, kort(tk))));
    fm.forEach((m, i) => { svg.append(ss('rect', { class: 'mtd-bar-prog', x: x(i) - w / 2, y: y(m.omzet), width: w, height: Math.max(0.5, y(0) - y(m.omzet)), rx: 2, fill: 'url(#mtd-arc)' }, ss('title', null, `${maandNaam(m.id)}: ${eur(m.omzet)} verwacht`)), ss('text', { x: x(i), y: ho - mb + 16, 'text-anchor': 'middle', class: 'mtd-xtekst fc' }, MND[Number(m.id.slice(5, 7)) - 1] + (klein && n > 8 ? '' : ' ' + m.id.slice(2, 4)))); });
    svg.append(ss('path', { d: padD(vg.map((v, i) => v == null ? null : [x(i), y(v)])), class: 'mtd-l-vgl o1' }));
    const rijen = fm.map((m, i) => ee('tr', null, ee('th', { scope: 'row' }, maandLang(m.id)), ee('td', null, eur(m.omzet)), ee('td', null, String(m.termijnen)), ee('td', null, vg[i] != null ? eur(vg[i]) : '—'), ee('td', { class: vg[i] != null && m.omzet >= vg[i] ? 'goed' : 'slecht' }, vg[i] != null ? pctTeken(dPct(m.omzet, vg[i])) : '')));
    return sectie('Verwachte omzet per maand', 'forecast: termijnen in de prognose met factuurdatum na vandaag, excl. btw', ee('div', { class: 'mtd-chart' }, ee('div', { class: 'mtd-plot' }, svg)),
      ee('div', { class: 'mtd-tabelwrap' }, ee('table', { class: 'mtd-tabel' }, ee('thead', null, ee('tr', null, ['Maand', 'Verwacht', 'Termijnen', 'Zelfde maand vorig jaar (geboekt)', 'Verschil'].map(k => ee('th', { scope: 'col' }, k)))), ee('tbody', null, rijen))),
      ee('span', { class: 'mtc-noot' }, 'Verwachting uit de forecast, niet ontdubbeld met boekingen (een al gefactureerde termijn kan er nog in staan). Telt niet mee in de kerncijfers.'));
  }

  function bedieningPaneel() { const b = bediening(); [...b.querySelectorAll('[data-horizon],[data-indeling]')].forEach(e => (e.closest('.mtc-groep') && e.closest('.mtc-groep').getAttribute('aria-label') === 'Horizon advies' ? e.closest('.mtc-groep') : e).remove()); return b; }
  function paneelInhoud(id, breedte) {
    if (id === 'besteedbaar') return besteedPaneel(breedte);
    const tm = tegelModel(), tegel = tm.find(q => q.id === id), per = huidigePeriodes(), lm = tm.lm || laatste();
    const kop = ee('div', { class: 'mtd-pkop' }, ee('div', { class: 'mtd-pkop-l' }, ee('button', { class: 'mtd-kn ico', 'data-sluitpaneel': '1', 'data-fk': 'sluit', 'aria-label': 'Sluiten en terug naar cijfers' }, '✕'),
      ee('div', null, ee('h1', null, PANEEL_TITEL[id] || id), ee('span', { class: 'mtc-noot' }, id === 'komende' ? 'verwachting uit forecast (niet ontdubbeld met boekingen)' : id === 'hoofd' ? `${st.jaar} · ${jaarTitel()}` : lm ? `${st.jaar} · geboekt t/m ${dagKort(lm)}${id === 'omzet' ? ' · excl. btw' : ''}` : String(st.jaar)))),
      ee('div', { class: 'mtd-pkop-r' }, id === 'omzet' ? ee('a', { class: 'mtd-kn', href: mbAdmin() ? `https://moneybird.com/${mbAdmin()}/sales_invoices` : 'https://moneybird.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Bekijk boekingen in Moneybird ↗') : null));
    const delen = [kop];
    if (!tm.length || !lm) { delen.push(ee('div', { class: 'mtc-kaart mtc-noot' }, 'Nog geen afgesloten maanden om te tonen.')); return delen; }
    if (id !== 'komende' && id !== 'hoofd') delen.push(bedieningPaneel());
    if (tegel && tegel.kpis.length) delen.push(kpiRij(tegel.kpis));
    const oud = g => htmlBlok(grafiekHtml(per, g)), sel = st.sel ? ee('div', { class: 'mtc-noot' }, `Gekozen: ${st.sel.label || st.sel.id} · `, ee('a', { href: '#', 'data-wissel': '1' }, 'terug naar het boekjaar')) : null;
    if (id === 'omzet') { delen.push(sectie('Omzet opgeteld door het jaar', 'Dikke lijn = dit jaar; de gestippelde lijnen zijn eerdere jaren op dezelfde datum', cumulEl(tm)), stapelSectie(per), omzetTabelSectie(tm), ee('div', { class: 'mtd-twee' }, topSectie(), feitenSectie('omzet'))); }
    else if (id === 'brutomarge') delen.push(sectie('Brutomarge per periode', 'Omzet − materiaal − uitbesteed werk, als % van de omzet', sel, oud('brutomarge')), sectie('Kosten tegenover de branche', null, htmlBlok(bulletHtml())), feitenSectie('brutomarge'));
    else if (id === 'resultaat') delen.push(sectie('Omzet, kosten en resultaat', 'Tik op een staaf of kostendeel voor de stukken in Moneybird', sel, oud('omzet_kosten')), feitenSectie('resultaat'));
    else if (id === 'kas') delen.push(sectie('Kaspositie', null, sel, oud('kas')), sectie('Van omzet naar kas', null, htmlBlok(watervalHtml())), feitenSectie('kas'));
    else if (id === 'opnames') delen.push(sectie('Privé-opnames en aflossing', 'Komen uit het resultaat (of uit de kas als dat niet genoeg is)', sel, oud('opnames')), feitenSectie('opnames'));
    else if (id === 'komende') delen.push(komendeSectie(tm), feitenSectie('komende'));
    else if (id === 'hoofd') { delen.push(hoofdKaart(per, { paneel: true, breedte, hoog: 380 })); if (!st.tabel) delen.push(tabelEl(per, vergelijkReeks(per, P => P.omzet))); }
    return delen.filter(Boolean);
  }
  function breedtePaneel(o) { const w = o.clientWidth || 800; return Math.max(300, Math.min(w, 1320) - (w < 700 ? 32 : 64) - (w < 700 ? 32 : 48)); }
  function tekenPaneel() {
    if (!st.paneel) { if (st.paneelEl) { st.paneelEl.remove(); st.paneelEl = null; } return; }
    let o = st.paneelEl;
    if (!o || !o.isConnected) {
      o = st.paneelEl = ee('div', { class: 'mtc mtd mtd-vol', role: 'dialog', 'aria-modal': 'true', 'aria-label': (PANEEL_TITEL[st.paneel] || '') + ' op volledig scherm' }); o.addEventListener('click', klik); o.addEventListener('keydown', toetsPaneel); document.body.appendChild(o);
      if (st.paneelEl.clientWidth === 0) { /* nog niet gemeten */ }
    }
    const scroll = o.scrollTop, fk = focusSleutel(), b = breedtePaneel(o); maat(b, 1200);
    const binnen = ee('div', { class: 'mtd-vol-in' }, paneelInhoud(st.paneel, BR));
    o.replaceChildren(binnen); o.scrollTop = scroll;
    o.querySelectorAll('.mtc-grafiek').forEach(gebaren);
    if (fk) herstelFocus(fk, o); else if (st.paneelNieuw) { const s = o.querySelector('[data-sluitpaneel]'); if (s) s.focus(); }
    st.paneelNieuw = false; maat();
  }
  function openPaneel(id, opener) { st.paneel = id; st.paneelNieuw = true; st.openerFk = opener ? opener.getAttribute('data-fk') : null; tekenPaneel(); }
  function sluitPaneel() { st.paneel = null; st.focusCat = null; st.sel = null; tekenPaneel(); verwerkWacht(); const k = st.openerFk; st.openerFk = null; herstelFocus(k, st.el); }
  function toetsPaneel(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sluitPaneel(); return; }
    if (e.key === 'Tab' && st.paneelEl) { const f = [...st.paneelEl.querySelectorAll('button:not([disabled]),a[href],[tabindex="0"],select,input')].filter(x => x.getClientRects().length); if (!f.length) return; const eerste = f[0], laatste2 = f[f.length - 1];
      if (e.shiftKey && document.activeElement === eerste) { e.preventDefault(); laatste2.focus(); } else if (!e.shiftKey && document.activeElement === laatste2) { e.preventDefault(); eerste.focus(); } }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-paneel]')) { e.preventDefault(); openPaneel(e.target.getAttribute('data-paneel'), e.target); }
  }
  function toets(e) {
    if (e.key === 'Escape' && st.statusOpen) { st.statusOpen = false; teken(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.mtd-tegel[data-paneel]')) { e.preventDefault(); openPaneel(e.target.getAttribute('data-paneel'), e.target); }
  }
  const bmTekst = b => b.van != null && b.tot != null ? `${pct(b.van)}–${pct(b.tot)}` : pct(b.pct);
  const bmMid = b => !b ? null : b.pct != null ? b.pct : (b.van + b.tot) / 2;

  // ── Grafieken ──
  // De viewBox volgt de breedte (anders worden de letters op een telefoon onleesbaar klein).
  let BR = 640, HO = 260; const ML = 52, MR = 12, MT = 24, MB = 30;   // MT: ruimte boven de grafiek voor het label "vanaf hier prognose"
  function maat(breed, max) { const b = breed || (st.el && st.el.clientWidth) || 640; BR = Math.max(320, Math.min(max || 900, breed ? b : b - 24)); HO = BR < 500 ? 230 : 260; }
  function schaal(min, max) { if (min === max) { max = min + 1; } const stap = Math.pow(10, Math.floor(Math.log10((max - min) / 4))), s = [1, 2, 2.5, 5, 10].map(x => x * stap).find(x => (max - min) / x <= 5) || stap * 10;
    const a = Math.floor(min / s) * s, b = Math.ceil(max / s) * s, ticks = []; for (let v = a; v <= b + s / 2; v += s) ticks.push(Math.round(v * 100) / 100); return { a, b, ticks }; }
  // Eén plek voor de schaal: eerst ALLE getekende waarden verzamelen (staven, lijnen, vergelijkjaren, prognose, referentielijnen),
  // dan pas de schaal bepalen. Zo loopt er nooit een lijn buiten de grafiek (de vorige schaalfout).
  C.verzamel = reeksen => { const w = []; for (const r of reeksen) for (const v of (Array.isArray(r) ? r : [r])) if (typeof v === 'number' && isFinite(v)) w.push(v); return w; };
  C.schaal = schaal;
  C.schaalVoor = (reeksen, opt) => {
    opt = opt || {}; const w = C.verzamel(reeksen.concat(opt.nul === false ? [] : [[0]]));
    if (!w.length) return schaal(0, 1);
    let lo = Math.min(...w), hi = Math.max(...w); if (opt.min != null) lo = Math.min(lo, opt.min); if (opt.max != null) hi = Math.max(hi, opt.max);
    return schaal(lo, hi);
  };
  function assen(sc, y, fmt, n) {
    return sc.ticks.map(t => `<g><line x1="${esc(ML)}" x2="${esc(BR - MR)}" y1="${esc(y(t))}" y2="${esc(y(t))}" stroke="${t === 0 ? '#9aa' : '#e6e6e0'}"/><text x="${esc(ML - 6)}" y="${esc(y(t) + 4)}" text-anchor="end" font-size="11" fill="#888">${esc(fmt(t))}</text></g>`).join('');
  }
  const defs = `<defs><pattern id="mtc-arcering" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#eef1f6"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9fb3d6" stroke-width="2"/></pattern>
    <pattern id="mtc-corr" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#f3e9d2"/><line x1="0" y1="0" x2="0" y2="6" stroke="#a5803a" stroke-width="2"/></pattern>
    <pattern id="mtc-streep" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" fill="#d5d9de"/><line x1="0" y1="0" x2="0" y2="5" stroke="#8c96a0" stroke-width="1.5"/></pattern></defs>`;
  function vergelijkReeks(per, f) {   // dezelfde periodes in eerdere jaren (alleen M/K)
    if (!(st.zoom === 'M' || st.zoom === 'K')) return [];
    return vglOffsets().map(off => { const j = st.jaar - off; if (j < Number(START.slice(0, 4))) return null;
      const pv = C.periodes(st.maanden, st.zoom, j, laatste(), []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, st.eerlijk) }));
      return { jaar: j, off, w: pv.map(p => p.P.maanden ? f(p.P) : null) }; }).filter(Boolean);
  }
  function grafiekHtml(per, g) {
    g = g || st.weergave;
    if (g === 'kosten_pct') return bulletHtml();
    if (g === 'waterval') return watervalHtml();
    const n = per.length, bw = (BR - ML - MR) / n, x = i => ML + i * bw + bw / 2;
    const geo = (st.geos = st.geos || {})[g] = st.geo = { weergave: g, n, bw, ids: per.map(p => p.id), segs: [] };   // voor tikken op de x-positie (smalle staven op mobiel)
    const progStart = per.findIndex(p => p.ms.length && p.ms.every(m => m.prognose));
    let svg = '', leg = [], noot = [];
    if (g === 'omzet_kosten') {
      const vgl = vergelijkReeks(per, P => P.omzet), progRes = p => p.P.prognose > 0 && !p.P.geenHistorie ? p.P.omzet + p.P.prognose - p.P.kosten_totaal - p.P.prognoseKosten : null;
      const sc = C.schaalVoor([per.map(p => p.P.omzet + p.P.prognose), per.map(p => p.P.kosten_totaal + p.P.prognoseKosten), per.map(p => p.P.prognoseRef || null), per.map(p => p.P.maanden ? p.P.resultaat : null), per.map(progRes),
        st.eerlijk ? [] : per.map(p => p.P.maanden && p.P.correctie ? p.P.resultaat - p.P.correctie : null), ...vgl.map(r => r.w)], { min: 0, max: 1 }), y = v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a));   // ook de vergelijkjaren, de prognoselijn en de referentielijn passen op de as
      svg += assen(sc, y, kort);
      per.forEach((p, i) => {
        let top = 0; const P = p.P, w = Math.max(4, bw * 0.62), x0 = x(i) - w / 2, gekozen = st.sel && st.sel.id === p.id;
        const lopend = p.ms.some(m => !m.prognose && m.id === st.vandaag.slice(0, 7));   // lopende maand (t/m vandaag): lichter + gestreept kader
        if (gekozen) svg += `<rect x="${esc(ML + i * bw)}" y="${esc(MT)}" width="${esc(bw)}" height="${esc(HO - MT - MB)}" fill="#eef1f6"/>`;
        const segs = st.geo.segs[i] = [];
        st.cats.forEach((c, k) => { const v = c === 'personeel' && st.eerlijk ? P.kosten[c] - P.correctie : P.kosten[c]; if (!(v > 0)) return; const y1 = y(top + v), y0 = y(top); top += v; segs.push({ tik: 'kosten', cat: c, y1, y2: y0 });
          const dim = st.focusCat && st.focusCat !== c ? ' opacity="0.25"' : lopend ? ' opacity="0.5"' : '';
          svg += `<rect data-tik="kosten" data-p="${esc(p.id)}" data-cat="${esc(c)}" x="${esc(x0)}" y="${esc(y1)}" width="${esc(w)}" height="${Math.max(0.5, y0 - y1)}" fill="${esc(TINT[k % TINT.length])}"${dim}><title>${esc((st.catNaam[c] || c) + ' ' + (p.label || p.id) + ': ' + eur(v))}</title></rect>`; });
        if (st.eerlijk && P.correctie > 0) { const y1 = y(top + P.correctie), y0 = y(top); top += P.correctie; segs.push({ tik: 'correctie', y1, y2: y0 });
          svg += `<rect data-tik="correctie" data-p="${esc(p.id)}" x="${esc(x0)}" y="${esc(y1)}" width="${esc(w)}" height="${Math.max(0.5, y0 - y1)}" fill="url(#mtc-corr)"><title>${esc('lonen buiten de W&V (eerlijk beeld) ' + (p.label || p.id) + ': ' + eur(P.correctie) + ' — ' + LOONSOORT.map(([k, t]) => t + ' ' + eur(P.correctie_soort[k])).join(', '))}</title></rect>`; }
        if (P.maanden) segs.push({ tik: 'omzet', y1: y(P.omzet) - 2, y2: y(P.omzet) + 2 });
        if (lopend && top > 0) svg += `<rect x="${esc(x0 - 1)}" y="${esc(y(top))}" width="${esc(w + 2)}" height="${Math.max(1, y(0) - y(top))}" fill="none" stroke="#56616d" stroke-dasharray="3 2"><title>lopende maand (t/m vandaag)</title></rect>`;
        if (P.prognoseRef && !P.prognose) svg += `<line x1="${esc(x0)}" x2="${esc(x0 + w)}" y1="${esc(y(P.prognoseRef))}" y2="${esc(y(P.prognoseRef))}" stroke="#9fb3d6" stroke-width="1.5" stroke-dasharray="2 3"><title>${esc('gemiddelde kosten ≈ ' + eur(P.prognoseRef) + ' — omzet nog niet bekend')}</title></line>`;
        if (P.prognoseKosten) svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${esc(x0)}" y="${esc(y(top + P.prognoseKosten))}" width="${esc(w)}" height="${Math.max(0.5, y(top) - y(top + P.prognoseKosten))}" fill="url(#mtc-arcering)" stroke="#9fb3d6" stroke-dasharray="3 2"><title>prognose kosten ${esc(eur(P.prognoseKosten))}</title></rect>`;
        if (P.maanden) svg += `<line data-tik="omzet" data-p="${esc(p.id)}" x1="${esc(x0 - 3)}" x2="${esc(x0 + w + 3)}" y1="${esc(y(P.omzet))}" y2="${esc(y(P.omzet))}" stroke="#1d3557" stroke-width="3"><title>omzet ${esc(eur(P.omzet))}</title></line>`;
        if (P.prognose) svg += `<line x1="${esc(x0 - 3)}" x2="${esc(x0 + w + 3)}" y1="${esc(y(P.omzet + P.prognose))}" y2="${esc(y(P.omzet + P.prognose))}" stroke="#1d3557" stroke-width="2" stroke-dasharray="4 3"><title>prognose omzet ≈ ${esc(eur(P.prognose))} (excl. btw)</title></line>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${esc(ML + i * bw)}" y="${esc(HO - MB)}" width="${esc(bw)}" height="${esc(MB)}" fill="transparent"/><text x="${esc(x(i))}" y="${esc(HO - MB + 14)}" text-anchor="middle" font-size="11" fill="#666">${esc((p.label || p.id) + (lopend ? '*' : ''))}</text>`;
      });
      if (per.some(p => p.ms.some(m => !m.prognose && m.id === st.vandaag.slice(0, 7)))) noot.push('* lopende maand (t/m vandaag): lichter en gestreept, nog niet compleet.');
      const zonderOmzet = per.filter(p => p.P.prognoseRef && !p.P.prognose);
      if (per.some(p => p.P.geenHistorie)) noot.push('Onvoldoende historie voor een prognose van kosten en resultaat (alleen de verwachte omzet staat erin).');
      if (zonderOmzet.length) noot.push(`${zonderOmzet.map(p => p.label || p.id).join(', ')}: omzet nog niet bekend — zet projecten in de prognose. De dunne stippellijn is alleen de gemiddelde kosten ter referentie, geen verlies.`);
      const res = per.map((p, i) => p.P.maanden ? [x(i), y(p.P.resultaat)] : null);
      svg += pad(res, '#2A4A38', 2.5) + res.map((q, i) => q ? `<circle data-tik="periode" data-p="${esc(per[i].id)}" cx="${esc(q[0])}" cy="${esc(q[1])}" r="${st.sel && st.sel.id === per[i].id ? 6 : 4}" fill="#2A4A38"><title>resultaat ${esc(eur(per[i].P.resultaat))}</title></circle>` : '').join('');
      const resProg = per.map((p, i) => p.P.prognose > 0 && !p.P.geenHistorie ? [x(i), y(p.P.omzet + p.P.prognose - p.P.kosten_totaal - p.P.prognoseKosten)] : null);   // alleen waar prognose-omzet is
      svg += pad(resProg, '#2A4A38', 2, '4 4');
      svg += resProg.map((q, i) => q ? `<circle cx="${esc(q[0])}" cy="${esc(q[1])}" r="4" fill="#fff" stroke="#2A4A38" stroke-width="1.5" stroke-dasharray="2 1.5"><title>${esc('prognose resultaat ≈ ' + eur(per[i].P.omzet + per[i].P.prognose - per[i].P.kosten_totaal - per[i].P.prognoseKosten))}</title></circle>` : '').join('');   // ook één losse prognosemaand zichtbaar
      if (!st.eerlijk) { const ref = per.map((p, i) => p.P.maanden && p.P.correctie ? [x(i), y(p.P.resultaat - p.P.correctie)] : null); if (ref.some(Boolean)) { svg += pad(ref, '#2A4A38', 1.2, '2 3'); noot.push('Dunne stippellijn: resultaat mét de lonen die niet in de W&V staan (eerlijk beeld).'); } }
      vgl.forEach((r) => { svg += pad(r.w.map((v, i) => v == null ? null : [x(i), y(v)]), '#9aa3ad', 1.5, r.off > 1 ? '2 4' : '6 3'); leg.push([`border-top:2px ${r.off > 1 ? 'dotted' : 'dashed'} #9aa3ad;height:0`, `omzet ${r.jaar}`]); });
      leg.unshift(['background:#3f4a56', 'kosten (tik voor de categorie)'], ['border-top:3px solid #1d3557;height:0', 'omzet'], ['border-top:3px solid #2A4A38;height:0', 'resultaat']);
      if (st.eerlijk && per.some(p => p.P.correctie > 0)) leg.splice(3, 0, ['background:repeating-linear-gradient(135deg,#f3e9d2 0 3px,#a5803a 3px 5px)', 'lonen buiten de W&V (eerlijk beeld)']);
      if (per.some(p => p.P.prognose || p.P.prognoseKosten)) leg.push(['background:url(#x);background:repeating-linear-gradient(45deg,#eef1f6 0 3px,#9fb3d6 3px 5px)', 'prognose']);
    } else if (g === 'brutomarge') {
      const vals = per.map(p => p.P.maanden ? p.P.brutomarge_pct : null), bm = st.bm.brutomarge, vgl = vergelijkReeks(per, P => P.brutomarge_pct);
      const sc = C.schaalVoor([vals, ...vgl.map(r => r.w), bm ? [bm.van, bm.tot, bm.pct] : []], { min: 0 }), y =v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a));         // %-as altijd vanaf 0
      svg += assen(sc, y, v => v + '%');
      if (bm) svg += bm.van != null && bm.tot != null ? `<rect x="${esc(ML)}" y="${esc(y(bm.tot))}" width="${esc(BR - ML - MR)}" height="${esc(y(bm.van) - y(bm.tot))}" fill="#e4e7eb"/>` : `<line x1="${esc(ML)}" x2="${esc(BR - MR)}" y1="${esc(y(bm.pct))}" y2="${esc(y(bm.pct))}" stroke="#7f8a96" stroke-width="2" stroke-dasharray="6 3"/>`;
      per.forEach((p, i) => { const v = vals[i], w = Math.max(4, bw * 0.55);
        if (v != null) svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${esc(x(i) - w / 2)}" y="${esc(y(Math.max(0, v)))}" width="${esc(w)}" height="${Math.abs(y(Math.max(0, v)) - y(0))}" fill="${st.sel && st.sel.id === p.id ? '#1d3557' : '#56616d'}"><title>${esc((p.label || p.id) + ': ' + pct(v))}</title></rect>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${esc(ML + i * bw)}" y="${esc(HO - MB)}" width="${esc(bw)}" height="${esc(MB)}" fill="transparent"/><text x="${esc(x(i))}" y="${esc(HO - MB + 14)}" text-anchor="middle" font-size="11" fill="#666">${esc(p.label || p.id)}</text>`; });
      vgl.forEach((r) => { svg += pad(r.w.map((v, i) => v == null ? null : [x(i), y(v)]), '#9aa3ad', 1.5, r.off > 1 ? '2 4' : '6 3'); leg.push([`border-top:2px ${r.off > 1 ? 'dotted' : 'dashed'} #9aa3ad;height:0`, String(r.jaar)]); });
      leg.unshift(['background:#56616d', 'brutomarge %']); if (bm) leg.push(['background:#e4e7eb', 'branche ' + bmTekst(bm) + (bm.bron ? ' (' + bm.bron + ')' : '')]);
      noot.push('Brutomarge = omzet − materiaal − uitbesteed werk, als % van de omzet. De as begint bij 0%.');
    } else if (g === 'opnames') {
      const namen = [...new Set(per.flatMap(p => Object.keys(p.P.prive)))];
      const sc = C.schaalVoor([per.map(p => p.P.prive_totaal + p.P.aflossing), per.map(p => p.P.maanden ? p.P.resultaat : null)], { min: 0, max: 1 }), y = v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a)); svg += assen(sc, y, kort);
      per.forEach((p, i) => { let top = 0; const w = Math.max(4, bw * 0.55), x0 = x(i) - w / 2;
        namen.forEach((nm, k) => { const v = p.P.prive[nm] || 0; if (!(v > 0)) return; svg += `<rect data-tik="prive" data-p="${esc(p.id)}" x="${esc(x0)}" y="${esc(y(top + v))}" width="${esc(w)}" height="${esc(y(top) - y(top + v))}" fill="${esc(['#3f4a56', '#94a0ab', '#6b7682'][k % 3])}"><title>${esc(nm + ': ' + eur(v))}</title></rect>`; top += v; });
        if (p.P.aflossing > 0) svg += `<rect data-tik="aflossing" data-p="${esc(p.id)}" x="${esc(x0)}" y="${esc(y(top + p.P.aflossing))}" width="${esc(w)}" height="${esc(y(top) - y(top + p.P.aflossing))}" fill="url(#mtc-streep)"><title>aflossing ${esc(eur(p.P.aflossing))}</title></rect>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${esc(ML + i * bw)}" y="${esc(HO - MB)}" width="${esc(bw)}" height="${esc(MB)}" fill="transparent"/><text x="${esc(x(i))}" y="${esc(HO - MB + 14)}" text-anchor="middle" font-size="11" fill="#666">${esc(p.label || p.id)}</text>`; });
      svg += pad(per.map((p, i) => p.P.maanden ? [x(i), y(p.P.resultaat)] : null), '#2A4A38', 2.5);
      leg = namen.slice(0, 3).map((nm, k) => [`background:${['#3f4a56', '#94a0ab', '#6b7682'][k % 3]}`, 'opname ' + nm]).concat([['background:repeating-linear-gradient(-45deg,#d5d9de 0 3px,#8c96a0 3px 4px)', 'aflossing'], ['border-top:3px solid #2A4A38;height:0', 'resultaat']]);
      noot.push('Opnames en aflossing komen uit het resultaat (of uit de kas als het resultaat niet genoeg is).');
    } else if (g === 'kas') {
      const pts = per.map(p => p.P.kas), prog = st.zoom === 'M' && st.jaar === Number(st.vandaag.slice(0, 4)) ? (st.kasProg || []) : [];
      const vgl = vergelijkReeks(per, P => P.kas && P.kas.met_btw);
      const alle = pts.filter(Boolean).flatMap(k => [k.lopend, k.met_btw]).concat(prog.flatMap(k => [k.lopend, k.met_btw]));
      const sc = C.schaalVoor([alle, ...vgl.map(r => r.w)], { min: 0, max: 1 }), y = v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a)); svg += assen(sc, y, kort);
      svg += pad(pts.map((k, i) => k && k.met_btw != null ? [x(i), y(k.met_btw)] : null), '#1d3557', 2.5) + pad(pts.map((k, i) => k && k.lopend != null ? [x(i), y(k.lopend)] : null), '#7f8a96', 2);
      if (prog.length) { const xi = id => per.findIndex(p => p.id === id); svg += pad(prog.map(k => xi(k.id) >= 0 && k.met_btw != null ? [x(xi(k.id)), y(k.met_btw)] : null), '#1d3557', 2, '4 4') + pad(prog.map(k => xi(k.id) >= 0 && k.lopend != null ? [x(xi(k.id)), y(k.lopend)] : null), '#7f8a96', 1.5, '4 4'); }
      per.forEach((p, i) => { if (pts[i]) svg += `<circle data-tik="periode" data-p="${esc(p.id)}" cx="${esc(x(i))}" cy="${esc(y(pts[i].met_btw != null ? pts[i].met_btw : pts[i].lopend))}" r="${st.sel && st.sel.id === p.id ? 6 : 4}" fill="#1d3557"><title>${esc((p.label || p.id) + ': lopend + BTW-pot ' + eur(pts[i].met_btw) + ', lopend ' + eur(pts[i].lopend))}</title></circle>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${esc(ML + i * bw)}" y="${esc(HO - MB)}" width="${esc(bw)}" height="${esc(MB)}" fill="transparent"/><text x="${esc(x(i))}" y="${esc(HO - MB + 14)}" text-anchor="middle" font-size="11" fill="#666">${esc(p.label || p.id)}</text>`; });
      vgl.forEach((r) => { svg += pad(r.w.map((v, i) => v == null ? null : [x(i), y(v)]), '#9aa3ad', 1.5, r.off > 1 ? '2 4' : '6 3'); leg.push([`border-top:2px ${r.off > 1 ? 'dotted' : 'dashed'} #9aa3ad;height:0`, String(r.jaar)]); });
      leg.unshift(['border-top:3px solid #1d3557;height:0', 'lopend + BTW-pot'], ['border-top:3px solid #7f8a96;height:0', 'lopend']);
      if (prog.length) leg.push(['border-top:2px dashed #1d3557;height:0', 'prognose (geldtijdlijn)']);
      noot.push('Stand op het maandeinde (balans in Moneybird). Een €-as die niet bij 0 begint, staat er niet: de as loopt altijd door 0.');
    }
    if (progStart >= 0 && g !== 'opnames') { svg += `<line x1="${esc(ML + progStart * bw)}" x2="${esc(ML + progStart * bw)}" y1="${esc(MT - 18)}" y2="${esc(HO - MB)}" stroke="#9fb3d6" stroke-dasharray="3 3"/><text x="${esc(ML + progStart * bw + (ML + progStart * bw > BR - 130 ? -4 : 4))}" y="${esc(MT - 8)}" text-anchor="${ML + progStart * bw > BR - 130 ? 'end' : 'start'}" font-size="11" fill="#3a5a8a">vanaf hier prognose</text>`;
      const pr = C.prognose(st.maanden, st.prognoseRuw, st.vandaag, st.eerlijk, st.cats); noot.push(`Prognose: omzet uit de termijnen in de prognose (≈ excl. 21% btw); kosten = omzet × (1 − gemiddelde brutomarge${pr.marge != null ? ' ' + pct(pr.marge * 100) : ''}) + gemiddelde vaste kosten${pr.vast != null ? ' ' + kort(pr.vast) : ''}/mnd, uit ${pr.kostenBasis} afgesloten maand${pr.kostenBasis === 1 ? '' : 'en'}. Telt nooit mee in de kerncijfers.`); }
    if (per.some(p => p.P.ontbrekend && !p.ms.every(m => m.prognose))) noot.push('Niet alle maanden zijn al opgehaald (zie boven).');
    leg = leg.slice(0, 6);
    return `<div class="mtc-grafiek" data-grafiek="${esc(g)}"><svg viewBox="0 0 ${esc(BR)} ${esc(HO)}" role="img" aria-label="${esc(WEERGAVEN.find(w => w[0] === g)[1])}">${defs}${svg}</svg></div>
      <div class="mtc-legenda">${leg.map(([s, t]) => `<span><i style="${esc(s)}"></i>${esc(t)}</span>`).join('')}</div>${noot.map(t => `<div class="mtc-noot">${esc(t)}</div>`).join('')}
      ${g === 'omzet_kosten' ? euroHtml(per) : ''}`;
  }
  function pad(pts, kleur, dikte, streep) {
    let d = '', open = false; for (const q of pts) { if (!q) { open = false; continue; } d += (open ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ' '; open = true; }
    return d ? `<path d="${d}" fill="none" stroke="${esc(kleur)}" stroke-width="${esc(dikte)}"${streep ? ` stroke-dasharray="${streep}"` : ''}/>` : '';
  }
  // "Waar ging elke € omzet heen": één balk, per categorie aan te tikken (de gekozen periode, anders het boekjaar t/m nu).
  const selP = () => C.som(st.sel.ms.filter(m => !m.prognose), st.cats, st.eerlijk);   // altijd opnieuw (eerlijk beeld kan gewisseld zijn)
  function euroHtml(per) {
    const P = st.sel ? selP() : C.som(per.flatMap(p => p.ms.filter(m => !m.prognose)), st.cats, st.eerlijk); if (!(P.omzet > 0)) return '';
    const delen = st.cats.map((c, k) => ({ c, v: P.kosten[c], kleur: TINT[k % TINT.length] })).filter(x => x.v > 0);
    const res = P.resultaat;
    return `<div class="mtc-noot" style="margin-top:10px"><b>Waar ging elke € 1 omzet heen</b> (${esc(st.sel ? st.sel.label || st.sel.id : st.jaar + ' t/m nu')}) — tik op een deel</div>
      <div class="mtc-euro" role="group">${delen.map(x => `<button data-euro="${esc(x.c)}" style="background:${esc(x.kleur)};flex:${esc(x.v / P.omzet)}" title="${esc((st.catNaam[x.c] || x.c) + ': ' + Math.round(x.v / P.omzet * 100) + ' ct per € omzet')}">${x.v / P.omzet > 0.08 ? esc(Math.round(x.v / P.omzet * 100) + 'ct') : ''}</button>`).join('')}
      ${res > 0 ? `<button data-euro="resultaat" style="background:#2A4A38;flex:${esc(res / P.omzet)}" title="${esc('resultaat: ' + Math.round(res / P.omzet * 100) + ' ct')}">${res / P.omzet > 0.08 ? esc(Math.round(res / P.omzet * 100) + 'ct') : ''}</button>` : ''}</div>
      ${res < 0 ? `<div class="mtc-noot">De kosten zijn ${esc(Math.round(-res / P.omzet * 100))} ct per € omzet hoger dan de omzet (verlies).</div>` : ''}<div id="mtc-euro-uitleg" class="mtc-noot"></div>`;
  }
  // Bullet charts: eigen kosten als % van de omzet tegenover de branche (CBS-marker of -band).
  function bulletHtml() {
    const lm = laatste(), tm = st.jaar === Number((lm || '').slice(0, 4)) ? Number(lm.slice(5, 7)) : 12;
    const P = st.sel ? selP() : C.som(st.maanden.filter(m => m.id.startsWith(st.jaar + '-') && Number(m.id.slice(5, 7)) <= tm), st.cats, st.eerlijk);
    if (!(P.omzet > 0)) return '<div class="mtc-noot">Geen omzet in deze periode.</div>';
    const rij = (id, naam, v, b, tik, schaal) => { const max = schaal || Math.max(10, v * 1.25, b ? (b.tot || b.pct || 0) * 1.5 : 0), sx = q => 4 + (Math.min(q, max) / max) * 92;
      const bmEl = !b ? '' : b.van != null && b.tot != null ? `<rect x="${esc(sx(b.van))}%" y="4" width="${esc(sx(b.tot) - sx(b.van))}%" height="20" fill="#d5d9de"/>` : `<line x1="${esc(sx(b.pct))}%" x2="${esc(sx(b.pct))}%" y1="2" y2="26" stroke="#1f262d" stroke-width="2"/>`;
      return `<div ${tik ? `data-bullet="${esc(id)}" style="cursor:pointer;min-height:44px"` : 'style="min-height:44px"'}><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(naam)}</span><span><b>${esc(pct(v))}</b>${b ? ` <span class="mtc-noot">· branche ${esc(bmTekst(b))}</span>` : ''}</span></div>
        <svg width="100%" height="28" style="display:block">${bmEl}<rect x="4%" y="10" width="${Math.max(0.3, sx(Math.max(0, v)) - 4)}%" height="8" fill="${st.focusCat === id ? '#1d3557' : '#56616d'}"/></svg></div>`; };
    return `<div class="mtc-noot" style="margin-bottom:6px">${esc(st.sel ? st.sel.label || st.sel.id : st.jaar + ' t/m ' + MND[tm - 1])} — kosten als % van de omzet. Balk = eigen, streep of band = branche${st.bmBron === 'standaard' ? ' (standaard CBS-kengetallen)' : ''}. Tik voor de maanden.</div>
      ${rij('brutomarge', 'Brutomarge', P.brutomarge_pct, st.bm.brutomarge)}
      ${(() => { const gem = Math.max(10, ...st.cats.map(c => P.kosten[c] / P.omzet * 100 * 1.15), ...st.cats.map(c => st.bm[c] ? (st.bm[c].tot || st.bm[c].pct || 0) * 1.15 : 0));   // één schaal voor alle categorieën (eerlijk vergelijken)
        return st.cats.map(c => rij(c, st.catNaam[c] || c, P.kosten[c] / P.omzet * 100, st.bm[c], true, gem)).join(''); })()}
      ${rij('resultaat', 'Resultaat' + (st.eerlijk && P.correctie ? ' (eerlijk)' : ''), P.resultaat / P.omzet * 100, st.bm.resultaat)}`;
  }
  // Waterval als verhaalkaart (gekozen periode, anders het boekjaar t/m nu).
  function watervalHtml() {
    const lm = laatste(), tm = st.jaar === Number((lm || '').slice(0, 4)) ? Number(lm.slice(5, 7)) : 12;
    const P = st.sel ? selP() : C.som(st.maanden.filter(m => m.id.startsWith(st.jaar + '-') && Number(m.id.slice(5, 7)) <= tm), st.cats, st.eerlijk);
    const eerste = st.sel ? st.sel.ms.filter(m => !m.prognose).map(m => m.id).sort()[0] : `${st.jaar}-01`;
    const voor = eerste ? st.maanden.find(m => m.maanden && m.id === C._maandPlus(eerste, -1)) : null, kasVoor = voor && voor.kas;
    const s = C.waterval(P, kasVoor), H = BR < 500 ? 320 : 300, top = Math.max(1, ...s.map(x => Math.abs(x.w)), P.omzet), y = v => 16 + (H - 60) * (1 - v / top), bw = (BR - ML - MR) / s.length;
    let loop = 0, svg = `<line x1="${esc(ML)}" x2="${esc(BR - MR)}" y1="${esc(y(0))}" y2="${esc(y(0))}" stroke="#9aa"/>`;
    s.forEach((x, i) => { const van = x.totaal ? 0 : loop, tot = x.totaal ? x.w : loop + x.w; if (x.totaal) loop = x.w; else loop = tot;
      const y1 = y(Math.max(van, tot)), y2 = y(Math.min(van, tot)), kl = x.totaal ? '#3f4a56' : x.rest ? 'url(#mtc-streep)' : '#94a0ab';
      svg += `<rect data-tik="stap" data-stap="${esc(x.id)}" x="${esc(ML + i * bw + bw * 0.15)}" y="${esc(y1)}" width="${esc(bw * 0.7)}" height="${Math.max(1, y2 - y1)}" fill="${esc(kl)}"><title>${esc(x.label + ': ' + eur(x.w))}</title></rect>
        <text x="${esc(ML + i * bw + bw / 2)}" y="${Math.max(12, y1 - 4)}" text-anchor="middle" font-size="11" fill="#333">${esc(kort(x.w))}</text>
        ${bw < 60 ? `<text transform="translate(${esc(ML + i * bw + bw / 2)},${esc(H - 40)}) rotate(-35)" text-anchor="end" font-size="10" fill="#666">${esc(x.kort || x.label)}</text>` : `<text x="${esc(ML + i * bw + bw / 2)}" y="${esc(H - 30)}" text-anchor="middle" font-size="10" fill="#666">${esc(x.label.length > 14 ? x.label.slice(0, 13) + '…' : x.label)}</text>`}`; });
    return `<div class="mtc-noot" style="margin-bottom:6px">${esc(st.sel ? st.sel.label || st.sel.id : st.jaar + ' t/m ' + MND[tm - 1])}: van omzet naar wat er in de kas overblijft.${st.eerlijk && P.correctie ? ' Incl. ' + esc(kort(P.correctie)) + ' lonen buiten de W&V.' : ''}</div>
      <div class="mtc-grafiek" data-grafiek="waterval"><svg viewBox="0 0 ${esc(BR)} ${esc(H)}" role="img" aria-label="Waterval">${defs}${svg}</svg></div>
      <div class="mtc-noot">${kasVoor ? 'Gearceerd: het verschil tussen "over na opnames" en de werkelijke kasmutatie (btw, debiteuren/crediteuren, afschrijving, investeringen). Kasmutatie = stand (lopend + BTW-pot) eind van de periode − stand eind van de maand ervoor.' : 'Geen kasmutatie: de stand vóór deze periode is niet bekend.'}</div>`;
  }

  // ── Interactie ──
  // Tik naast een (smalle) staaf: kies de kolom op de x-positie en het dichtstbijzijnde deel binnen ±22 px (samen ≥ 44 px).
  function tikOpPositie(e) {
    const svg = e.target.closest && e.target.closest('.mtc-grafiek svg'), kader = svg && svg.closest('[data-grafiek]'), geo = kader && st.geos && st.geos[kader.dataset.grafiek]; if (!svg || !geo || !geo.n || geo.weergave === 'waterval') return false;
    const b = svg.getBoundingClientRect(), vbA = String(svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), vb = { width: vbA[2], height: vbA[3] }; if (!b.width || !(vb.width > 0)) return false;
    const x = (e.clientX - b.left) * vb.width / b.width, yy = (e.clientY - b.top) * vb.height / b.height, i = Math.floor((x - ML) / geo.bw);
    if (i < 0 || i >= geo.n) return false;
    const p = huidigePeriodes().find(q => q.id === geo.ids[i]); if (!p) return false;
    const seg = (geo.segs[i] || []).map(q => ({ q, af: yy < q.y1 ? q.y1 - yy : yy > q.y2 ? yy - q.y2 : 0 })).filter(z => z.af <= 22).sort((a, c) => a.af - c.af)[0];
    st.sel = p; teken();
    if (seg) drill(seg.q.tik === 'kosten' ? 'kosten' : seg.q.tik, seg.q.cat || null, p);
    return true;
  }
  function klik(e) {
    const b = e.target.closest('[data-zoom],[data-jaar],[data-eerlijk],[data-vgl],[data-horizon],[data-indeling],[data-wissel],[data-tik],[data-euro],[data-bullet],[data-paneel],[data-sluitpaneel],[data-status],[data-tabel],[data-stapel],[data-drill],[data-topladen],[data-bzoom],[data-naarfin]'); if (!b) { tikOpPositie(e); return; }
    const d = b.dataset;
    if (d.naarfin) { e.preventDefault(); const kn = document.getElementById('tab-btn-geld'); if (kn && typeof root.showTab === 'function') { sluitPaneel(); root.showTab('geld', kn); } return; }
    if (d.bzoom) { if (BES_ZOOM[d.bzoom]) st.besZoom = d.bzoom; return teken(); }   // alleen dit paneel: de keuze van Financiën zelf blijft onaangeroerd
    if (d.paneel) return openPaneel(d.paneel, b);
    if (d.sluitpaneel) return sluitPaneel();
    if (d.status) { st.statusOpen = !st.statusOpen; teken(); const k = st.statusOpen ? 'status-sluit' : 'status'; herstelFocus(k, st.el); return; }
    if (d.drill) { const [soort, pid] = d.drill.split(':'), p = huidigePeriodes().find(q => q.id === pid); return drill(soort, null, p); }
    if (d.topladen) return laadTop();
    if (d.stapel) { st.stapelSel = st.stapelSel === d.stapel ? null : d.stapel; }
    else if (d.zoom) { st.zoom = d.zoom; st.sel = null; st.vast = null; st.stapelSel = null; }
    else if (d.jaar) { st.jaar = Math.max(Number(START.slice(0, 4)), Math.min(Number(st.vandaag.slice(0, 4)), st.jaar + Number(d.jaar))); st.sel = null; st.vast = null; st.top = null; st.stapelSel = null; }
    else if (d.eerlijk) { st.eerlijk = !st.eerlijk; ls.set('mtc:eerlijk:' + st.wie, st.eerlijk ? '1' : '0'); }
    else if (d.vgl) { st.vgl[d.vgl] = !st.vgl[d.vgl]; ls.set('mtc:vgl:' + st.wie, C.vglTekst(st.vgl)); }
    else if (d.tabel) { st.tabel = !st.tabel; }
    else if (d.horizon) { st.horizon = d.horizon; if (st.opHorizon) st.opHorizon(d.horizon); }
    else if (d.indeling) return indelingBlad();
    else if (d.wissel) { e.preventDefault(); st.sel = null; }
    else if (d.euro) { const u = st.el.querySelector('#mtc-euro-uitleg'); if (d.euro === 'resultaat') { if (u) u.textContent = 'Resultaat: wat er van elke € omzet overblijft.'; return; } return drill('kosten', d.euro); }
    else if (d.bullet) return drill('kosten', d.bullet);
    else if (d.tik) {
      const p = huidigePeriodes().find(x => x.id === d.p);
      if (d.tik === 'stap') return;
      if (p && (d.tik === 'periode' || !st.sel || st.sel.id !== p.id)) st.sel = p;          // vaste markering op het gekozen punt
      if (d.tik === 'kosten') return (teken(), drill('kosten', d.cat, p));
      if (d.tik === 'omzet' || d.tik === 'prive' || d.tik === 'aflossing' || d.tik === 'correctie') return (teken(), drill(d.tik, null, p));
    }
    teken();
  }
  function gebaren(box) {
    if (!box) return;
    const ptrs = new Map(); let start = null, knijp = null;
    box.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, e.clientX); if (ptrs.size === 1) start = { x: e.clientX, t: Date.now() }; if (ptrs.size === 2) { const v = [...ptrs.values()]; knijp = Math.abs(v[0] - v[1]); start = null; } });
    box.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e.clientX);
      if (ptrs.size === 2 && knijp) { const v = [...ptrs.values()], a = Math.abs(v[0] - v[1]), z = ZOOMS.map(q => q[0]), i = z.indexOf(st.zoom);
        if (a > knijp * 1.4 && i > 0) { st.zoom = z[i - 1]; knijp = a; teken(); } else if (a < knijp / 1.4 && i < z.length - 1) { st.zoom = z[i + 1]; knijp = a; teken(); } } });
    const los = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) knijp = null;
      if (start && (st.zoom === 'M' || st.zoom === 'K')) { const dx = e.clientX - start.x; if (Math.abs(dx) > 60 && Date.now() - start.t < 800) { const nj = st.jaar + (dx < 0 ? 1 : -1);
        if (nj >= Number(START.slice(0, 4)) && nj <= Number(st.vandaag.slice(0, 4))) { st.jaar = nj; st.sel = null; start = null; teken(); return; } } } start = null; };
    box.addEventListener('pointerup', los); box.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); start = null; knijp = null; });
  }
  function sheet(html) {
    const o = document.createElement('div'); o.className = 'mtc-sheet';
    o.innerHTML = `<div role="dialog" aria-modal="true">${html}<div style="margin-top:12px;text-align:right"><button class="mtc-knop" data-sluit="1">Sluiten</button></div></div>`;
    o.addEventListener('click', ev => { if (ev.target === o || ev.target.closest('[data-sluit]')) o.remove(); });
    document.body.appendChild(o); return o;
  }
  const mbLink = u => /^https:\/\/moneybird\.com\//.test(String(u || '')) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">open</a>` : '';
  // Drill-down: per maand de stukken uit Moneybird; een kwartaal/jaar eerst de maanden laten kiezen.
  async function drill(reeks, cat, p) {
    p = p || st.sel;
    const titel = reeks === 'kosten' ? (st.catNaam[cat] || cat) : { omzet: 'Omzet', prive: 'Privé-opnames', aflossing: 'Aflossing', correctie: 'Lonen buiten de W&V' }[reeks];
    const ms = p ? p.ms.filter(m => !m.prognose && m.maanden) : st.maanden.filter(m => m.maanden && m.id.startsWith(st.jaar + '-'));
    if (ms.length !== 1) {
      const waarde = m => { const P = C.som([m], st.cats, st.eerlijk); return reeks === 'kosten' ? P.kosten[cat] : reeks === 'omzet' ? P.omzet : reeks === 'prive' ? P.prive_totaal : reeks === 'aflossing' ? P.aflossing : P.correctie; };
      const o = sheet(`<h3 style="margin-top:0">${esc(titel)} — kies een maand</h3><table>${ms.map(m => `<tr><td><a href="#" data-maand="${esc(m.id)}">${esc(maandNaam(m.id))}</a></td><td class="b">${esc(eur(waarde(m)))}</td>${reeks === 'kosten' ? `<td class="b mtc-noot">${m.omzet ? esc(pct(waarde(m) / m.omzet * 100)) : ''}</td>` : ''}</tr>`).join('')}</table>`);
      o.addEventListener('click', ev => { const a = ev.target.closest('[data-maand]'); if (a) { ev.preventDefault(); o.remove(); drillMaand(reeks, cat, a.dataset.maand, titel); } });
      return;
    }
    return drillMaand(reeks, cat, ms[0].id, titel);
  }
  async function drillMaand(reeks, cat, ym, titel) {
    const o = sheet(`<h3 style="margin-top:0">${esc(titel)} — ${esc(maandNaam(ym))}</h3><div class="mtc-noot">Ophalen uit Moneybird…</div>`), box = o.firstElementChild;
    const r = await st.bron.haal(`/geld/cijfers/detail?maand=${encodeURIComponent(ym)}&reeks=${encodeURIComponent(reeks)}${cat ? '&categorie=' + encodeURIComponent(cat) : ''}`);
    if (!r || r.error) { box.querySelector('.mtc-noot').textContent = 'Kon niet worden opgehaald: ' + ((r && r.error) || 'geen antwoord'); return; }
    const extra = reeks === 'kosten' && st.eerlijk && cat === 'personeel' ? (st.maanden.find(m => m.id === ym) || {}).correctie || 0 : 0;
    const cr = reeks === 'correctie' && r.correctie ? r.correctie : null;   // de worker rekent wat meetelt (boven de lonen in de W&V)
    const perSoort = reeks === 'correctie' ? LOONSOORT.map(([k, tt]) => [tt, cr && cr.per_soort ? cr.per_soort[k] || 0 : r.items.filter(x => x.loonsoort === k).reduce((a, x) => a + x.bedrag, 0)]) : null;
    box.innerHTML = `<h3 style="margin-top:0">${esc(titel)} — ${esc(maandNaam(ym))}</h3>
      ${cr ? `<div class="mtc-noot">Via de bank betaald: ${esc(eur(cr.betaald))}${cr.al_in_wv ? `, waarvan ${esc(eur(cr.al_in_wv))} al als loon in de W&V staat` : ''} → telt mee: <b>${esc(eur(cr.telt))}</b>.</div>` : ''}
      ${perSoort ? `<div class="mtc-noot">Telt mee: ${perSoort.map(([tt, x]) => esc(tt) + ' ' + esc(eur(x))).join(' · ')}. Opnames van de eigenaren tellen niet mee, ook niet als er "loon" bij staat.</div>` : ''}
      ${r.totaal_wv != null ? `<div class="mtc-noot">In de W&V: ${esc(eur(r.totaal_wv))}${r.rest ? ` · waarvan ${esc(eur(r.rest))} niet als losse factuur/bon/mutatie te zien (memoriaal, afschrijving e.d.)` : ''}</div>` : ''}
      ${extra ? `<div class="mtc-noot">Eerlijk beeld: plus ${esc(eur(extra))} lonen die via de bank zijn betaald maar niet in de W&V staan (<a href="#" data-corr="1">bekijk</a>).</div>` : ''}
      <table>${r.items.map(x => `<tr><td>${esc(x.datum || '')}</td><td>${esc(x.tegenpartij || '')}${x.nummer ? ' · ' + esc(x.nummer) : ''}${x.omschrijving ? `<div class="mtc-noot">${esc(x.omschrijving)}</div>` : ''}<div class="mtc-noot">${esc(x.soort)}${x.loonsoort ? ' · ' + esc((LOONSOORT.find(q => q[0] === x.loonsoort) || [0, ''])[1]) : ''}</div></td><td class="b">${esc(eur(x.bedrag))}${x.betaald != null && Math.abs(x.betaald - x.bedrag) > 0.5 ? `<div class="mtc-noot">van ${esc(eur(x.betaald))}</div>` : ''}</td><td class="b">${mbLink(x.url)}</td></tr>`).join('') || '<tr><td>Geen losse stukken gevonden.</td></tr>'}</table>
      ${r.meer ? `<div class="mtc-noot">En nog ${esc(r.meer)} kleinere posten.</div>` : ''}${r.onvolledig ? '<div class="mtc-waarsch">Niet alles kon worden opgehaald; de lijst is mogelijk onvolledig.</div>' : ''}
      <div style="margin-top:12px;text-align:right"><button class="mtc-knop" data-sluit="1">Sluiten</button></div>`;
    box.addEventListener('click', ev => { if (ev.target.closest('[data-corr]')) { ev.preventDefault(); o.remove(); drillMaand('correctie', null, ym, 'Lonen buiten de W&V'); } });
  }
  // Vaste loonrekeningen aanpassen (meteen opslaan) en de cijfers opnieuw laden.
  async function loonIbanZet(fn) {
    const c = await st.bron.haal('/geld/config'); if (!c || !c.config) return false;
    const cc = c.config.cijfers || {}, lijst = fn((cc.loon_iban || []).slice());
    const res = await st.bron.haal('/geld/config', { method: 'POST', body: { revisie: c.config.revisie, cijfers: Object.assign({}, cc, { loon_iban: lijst }) } });
    if (!res || res.error) return false;
    st.maanden = []; C.laad(); return true;
  }
  // Controle van het eerlijke beeld per maand (eigenaar): betaald per soort, al als loon in de W&V, telt; en wat niet herkend wordt.
  async function diagnoseBlad(jaar) {
    if (!st.mag) return;
    const o = sheet(`<h3 style="margin-top:0">Controle eerlijk beeld ${esc(jaar)}</h3><div class="mtc-noot">Laden…</div>`), box = o.firstElementChild;
    const d = await st.bron.haal(`/geld/cijfers/diagnose?jaar=${encodeURIComponent(jaar)}`);
    if (!d || d.error) { box.querySelector('.mtc-noot').textContent = 'Kon niet worden geladen: ' + ((d && d.error) || 'geen antwoord'); return; }
    const k = x => esc(eur(x)), som = b => (b.netto || 0) + (b.loonheffing || 0) + (b.pensioen || 0);
    box.innerHTML = `<h3 style="margin-top:0">Controle eerlijk beeld ${esc(jaar)}</h3>
      <div class="mtc-noot">Woorden: ${esc(d.loonpatronen.join(', '))} · via balansgrootboek: ${esc((d.loon_balans || []).map(x => x.naam + ' (' + ((LOONSOORT.find(q => q[0] === x.soort) || [0, x.soort])[1]) + ')').join(', ') || 'geen')}${d.loon_balans_bron === 'voorstel' ? ' (voorstel)' : ''} · loon in de W&V: ${esc(d.loon_wv.join(', ') || 'geen')} (${d.loon_wv_bron === 'voorstel' ? 'voorstel op naam' : 'ingesteld'}) · telt vanaf ${esc(maandNaam(d.correctie_van))}.</div>
      <table><tr><td><b>Maand</b></td><td class="b"><b>netto</b></td><td class="b"><b>loonheffing</b></td><td class="b"><b>pensioen</b></td><td class="b"><b>via balans</b></td><td class="b"><b>via factuur</b></td><td class="b"><b>al in W&V</b></td><td class="b"><b>telt</b></td><td class="b"><b>eigenaar (uit)</b></td></tr>
      ${d.maanden.map(m => `<tr><td>${esc(maandNaam(m.maand))}${m.in_correctie ? '' : ' <span class="mtc-noot">(vóór start)</span>'}</td><td class="b">${esc(k(m.betaald.netto))}</td><td class="b">${esc(k(m.betaald.loonheffing))}</td><td class="b">${esc(k(m.betaald.pensioen))}</td><td class="b">${esc(k(m.via_balans || 0))}</td><td class="b">${esc(k(m.via_factuur || 0))}${m.in_correctie && m.facturen_gehaald === false ? '*' : ''}</td><td class="b" title="${esc(m.wv_grootboeken.map(g => g.naam + ' ' + eur(g.bedrag)).join(', '))}">${esc(k(m.al_in_wv))}</td><td class="b"><b>${esc(k(m.telt))}</b></td><td class="b">${esc(k(m.eigenaar_uitgesloten))}</td></tr>`).join('')}
      <tr><td><b>Totaal</b></td><td class="b"><b>${esc(k(d.totaal.betaald.netto))}</b></td><td class="b"><b>${esc(k(d.totaal.betaald.loonheffing))}</b></td><td class="b"><b>${esc(k(d.totaal.betaald.pensioen))}</b></td><td class="b"><b>${esc(k(d.maanden.reduce((a, m) => a + (m.via_balans || 0), 0)))}</b></td><td class="b"><b>${esc(k(d.maanden.reduce((a, m) => a + (m.via_factuur || 0), 0)))}</b></td><td class="b"><b>${esc(k(d.totaal.al_in_wv))}</b></td><td class="b"><b>${esc(k(d.totaal.telt))}</b></td><td class="b">${esc(k(d.totaal.eigenaar_uitgesloten))}</td></tr></table>
      <div class="mtc-noot">"via factuur" = regels van inkoopfacturen en bonnen op een loon-balansgrootboek (bv. pensioenpremies), op factuurdatum.${d.maanden.some(m => m.in_correctie && m.facturen_gehaald === false) ? ' * = facturen voor die maand nog niet opgehaald (ververs de cijfers).' : ''}</div>
      <div class="mtc-noot">Betaald via de bank samen ${esc(k(som(d.totaal.betaald)))}; telt in het eerlijke beeld ${esc(k(d.totaal.telt))}.${d.ontbrekend.length ? ' Nog niet opgehaald: ' + esc(d.ontbrekend.map(maandNaam).join(', ')) + '.' : ''}</div>
      <h4>Niet herkend</h4><div class="mtc-noot">Uitgaande betalingen die niet in de W&V geboekt zijn, geen trefwoord hebben, niet op een loon-balansgrootboek staan en niet naar een eigenaar, spaarpot of lening gaan. Hoort er een bij de lonen (werknemer, Belastingdienst, pensioenfonds)? Maak er een vaste loonrekening van.</div>
      <table>${d.niet_herkend.map((x, i) => `<tr><td>${esc(x.tegenpartij || '—')}<div class="mtc-noot">${esc(x.iban || 'geen IBAN')} · ${esc(x.n)}× · ${esc(x.voorbeeld)}</div></td><td class="b">${esc(k(x.bedrag))}</td>
        <td>${x.iban ? `<select data-nhsoort="${i}">${LOONSOORT.map(([kk, t]) => `<option value="${esc(kk)}">${esc(t)}</option>`).join('')}</select> <button class="mtc-knop" data-alsloon="${i}">telt als loon</button>` : ''}</td></tr>`).join('') || '<tr><td>Niets.</td></tr>'}</table>
      <div style="margin-top:12px;text-align:right"><button class="mtc-knop" data-sluit="1">Sluiten</button></div>`;
    box.querySelectorAll('[data-alsloon]').forEach(b => b.addEventListener('click', async () => {
      const x = d.niet_herkend[Number(b.dataset.alsloon)], soort = box.querySelector(`[data-nhsoort="${b.dataset.alsloon}"]`).value;
      b.disabled = true;
      const ok = await loonIbanZet(l => l.filter(q => q.iban !== x.iban).concat([{ iban: x.iban, naam: x.tegenpartij || '', soort }]));
      if (ok) { o.remove(); diagnoseBlad(jaar); } else { b.disabled = false; }
    }));
  }
  // Indeling (eigenaar): grootboek → categorie, privé- en aflossingsgrootboeken, loonpatronen, correctie vanaf, branche.
  async function indelingBlad() {
    if (!st.mag) return;
    const o = sheet('<h3 style="margin-top:0">Indeling</h3><div class="mtc-noot">Laden…</div>'), box = o.firstElementChild;
    const [r, c] = await Promise.all([st.bron.haal('/geld/cijfers/indeling'), st.bron.haal('/geld/config')]);
    if (!r || r.error || !c || !c.config) { box.querySelector('.mtc-noot').textContent = 'Kon niet worden geladen.'; return; }
    const priveSet = new Map((r.prive || []).map(p => [p.ledger, p.naam])), afl = new Set(r.aflossing || []), loonWv = new Set(r.loon_wv || []), lbKeuze = new Map((r.loon_balans || []).map(x => [x.ledger, x.soort]));
    const opties = sel => r.categorieen.map(k => `<option value="${esc(k.id)}" ${k.id === sel ? 'selected' : ''}>${esc(k.naam)}</option>`).join('');
    const bmVeld = (id, naam) => { const b = (r.benchmarks || {})[id] || {}; return `<tr><td>${esc(naam)}</td><td><input type="number" step="0.1" min="0" max="100" data-bm="${esc(id)}" value="${esc(b.pct != null ? b.pct : b.van != null ? (b.van + b.tot) / 2 : '')}" style="width:80px"> %</td></tr>`; };
    box.innerHTML = `<h3 style="margin-top:0">Indeling</h3>
      <div class="mtc-noot">Welke grootboekrekening in welke categorie valt. "voorstel" = op naam geraden; kies om vast te leggen. De cijfers rekenen meteen opnieuw (zonder Moneybird opnieuw te vragen).</div>
      <table>${r.kosten.map(k => `<tr><td>${esc(k.naam)}${k.bron === 'voorstel' ? ' <span class="mtc-badge">voorstel</span>' : ''}</td><td><select data-led="${esc(k.ledger)}">${opties(k.categorie)}</select></td>
        <td>${k.categorie === 'personeel' || loonWv.has(k.ledger) ? `<label title="Dit grootboek bevat de lonen zelf (bruto, sociale lasten, pensioen) — tegen dubbel tellen met het eerlijke beeld"><input type="checkbox" data-loonwv="${esc(k.ledger)}" ${loonWv.has(k.ledger) ? 'checked' : ''}> loon</label>` : ''}</td></tr>`).join('')}</table>
      <div class="mtc-noot">"loon" = het grootboek bevat de lonen zelf${r.loon_wv_bron === 'voorstel' ? ' (nu een voorstel op naam)' : ''}. Alleen dat telt als "al in de W&V" bij het eerlijke beeld; overige personeelskosten, reiskosten en inhuur niet.</div>
      <h4>Privé-opnames (per eigenaar)</h4><table>${r.eigen_vermogen.map(l => `<tr><td><label><input type="checkbox" data-prive="${esc(l.ledger)}" ${priveSet.has(l.ledger) ? 'checked' : ''}> ${esc(l.naam)}</label></td><td><input data-privenaam="${esc(l.ledger)}" value="${esc(priveSet.get(l.ledger) || '')}" placeholder="naam" maxlength="40" style="width:120px"></td></tr>`).join('') || '<tr><td>Geen eigen-vermogensrekeningen.</td></tr>'}</table>
      <h4>Aflossingen (leningen)</h4><table>${r.schulden.map(l => `<tr><td><label><input type="checkbox" data-afl="${esc(l.ledger)}" ${afl.has(l.ledger) ? 'checked' : ''}> ${esc(l.naam)}</label></td></tr>`).join('') || '<tr><td>Geen schulden-rekeningen.</td></tr>'}</table>
      <h4>Eerlijk beeld</h4><div class="mtc-noot">Uitgaande bankmutaties die niet in de W&V staan en een van deze woorden bevatten, of naar een vaste loonrekening gaan, tellen als personeelskosten (alleen het deel dat nog niet als loon in de W&V staat). Opnames van de eigenaren tellen nooit.</div>
      <div class="mtc-noot" style="margin-top:6px"><b>Lonen via balansgrootboeken</b>${r.loon_balans_bron === 'voorstel' ? ' <span class="mtc-badge">voorstel</span>' : ''} — elke uitgaande betaling die op zo'n grootboek is geboekt, telt als die soort (ook zonder trefwoord).</div>
      <table>${(r.balans_schulden || []).map(l => { const keuze = lbKeuze.get(l.ledger) || ''; return `<tr><td>${esc(l.naam)}</td><td><select data-loonbalans="${esc(l.ledger)}"><option value="">—</option>${LOONSOORT.map(([k2, t2]) => `<option value="${esc(k2)}" ${keuze === k2 ? 'selected' : ''}>${esc(t2)}</option>`).join('')}</select></td></tr>`; }).join('') || '<tr><td>Geen balansgrootboeken.</td></tr>'}</table>
      <div style="margin:6px 0"><button class="mtc-knop" data-diagnose="1">Controle per maand</button></div>
      <div class="mtc-noot">Vaste loonrekeningen: ${(r.loon_iban || []).length ? (r.loon_iban || []).map(x => `<span class="mtc-badge">${esc((x.naam || x.iban) + ' · ' + (LOONSOORT.find(q => q[0] === x.soort) || [0, x.soort])[1])} <a href="#" data-weg-iban="${esc(x.iban)}" aria-label="verwijderen">×</a></span>`).join(' ') : 'nog geen (kies ze in de controle per maand)'}</div>
      <label>Woorden <input data-loon value="${esc((r.loonpatronen || []).join(', '))}" style="width:100%"></label><label>Vanaf maand <input type="month" data-corrvan value="${esc(r.correctie_van || '')}"></label>
      <h4>Opnieuw ophalen</h4><div class="mtc-noot">Na late boekingen in Moneybird: haal een afgesloten jaar opnieuw op (in rondes van 6 maanden).</div>
      <select data-herbouwjaar>${Array.from({ length: Number(st.vandaag.slice(0, 4)) - Number(START.slice(0, 4)) + 1 }, (_, i) => Number(START.slice(0, 4)) + i).reverse().map(j => `<option value="${j}">${j}</option>`).join('')}</select> <button class="mtc-knop" data-herbouw="1">Jaar opnieuw ophalen</button>
      <h4>Branche (% van de omzet)</h4><table>${bmVeld('brutomarge', 'Brutomarge')}${r.categorieen.map(k => bmVeld(k.id, k.naam)).join('')}${bmVeld('resultaat', 'Resultaat')}</table>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"><button class="mtc-knop" data-sluit="1">Annuleren</button><button class="mtc-knop aan" data-bewaar="1">Opslaan</button></div>`;
    box.querySelector('[data-herbouw]').addEventListener('click', () => { const j = box.querySelector('[data-herbouwjaar]').value; o.remove(); C.laad(j); });
    box.querySelector('[data-diagnose]').addEventListener('click', () => { o.remove(); diagnoseBlad(st.jaar); });
    box.querySelectorAll('[data-weg-iban]').forEach(a => a.addEventListener('click', async ev => { ev.preventDefault(); await loonIbanZet(l => l.filter(x => x.iban !== a.dataset.wegIban)); o.remove(); indelingBlad(); }));
    box.querySelector('[data-bewaar]').addEventListener('click', async () => {
      const map = {}; box.querySelectorAll('select[data-led]').forEach(s => { const k = r.kosten.find(x => x.ledger === s.dataset.led); if (k && (k.bron === 'instelling' || s.value !== k.categorie)) map[s.dataset.led] = s.value; });
      const prive = [...box.querySelectorAll('input[data-prive]:checked')].map(i => ({ ledger: i.dataset.prive, naam: (box.querySelector(`[data-privenaam="${i.dataset.prive}"]`) || {}).value || 'privé' }));
      const aflossing = [...box.querySelectorAll('input[data-afl]:checked')].map(i => i.dataset.afl);
      const loonpatronen = box.querySelector('[data-loon]').value.split(',').map(x => x.trim()).filter(Boolean);
      const bm = {}; const oud = r.benchmarks || {};
      box.querySelectorAll('[data-bm]').forEach(i => { const id = i.dataset.bm, v = i.value === '' ? null : Number(i.value), o2 = oud[id] || {};
        if (v == null || !isFinite(v)) return; const gelijk = o2.pct != null ? o2.pct === v : o2.van != null && (o2.van + o2.tot) / 2 === v; bm[id] = gelijk ? o2 : { pct: v, bron: 'eigen' }; });
      const loon_wv = [...box.querySelectorAll('input[data-loonwv]:checked')].map(i => i.dataset.loonwv);
      const loon_balans = [...box.querySelectorAll('select[data-loonbalans]')].filter(x => x.value).map(x => ({ ledger: x.dataset.loonbalans, soort: x.value }));
      const cijfers = Object.assign({}, c.config.cijfers || {}, { map: Object.assign({}, (c.config.cijfers || {}).map || {}, map), prive, aflossing, loonpatronen, correctie_van: box.querySelector('[data-corrvan]').value || null, benchmarks: bm, loon_wv, loon_balans });
      const res = await st.bron.haal('/geld/config', { method: 'POST', body: { revisie: c.config.revisie, cijfers } });
      if (!res || res.error) { const f = document.createElement('div'); f.className = 'mtc-waarsch'; f.textContent = 'Niet opgeslagen: ' + ((res && res.error) || 'geen antwoord'); box.appendChild(f); return; }
      o.remove(); st.maanden = []; await C.laad();
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);

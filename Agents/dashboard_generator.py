#!/usr/bin/env python3
"""
Dashboard-generator — MT Night Agent, fase 6
==============================================
Bundelt alles wat de agent heeft gescand en verwerkt in EEN HTML-dashboard:
  - Opdrachten (dispatch) + status + resultaat
  - Gescande RSS-items met score en aanbevolen opvolging
  - Interessante GitHub-tools
  - Dagelijkse bedrijfsanalyse
  - Zelf-verbeter-voorstellen van de agent (wachten op review)
  - Run-geschiedenis

Het dashboard is een self-contained HTML — dubbelklik en het werkt, geen server.
Data wordt als JS-object in de HTML gebakken.

Gebruik:  python dashboard_generator.py
"""

import json
import datetime
import html
import re
from pathlib import Path

AGENTS_DIR = Path(__file__).parent
BASE_DIR   = AGENTS_DIR.parent
OPDR_DIR   = AGENTS_DIR / "opdrachten"
VOORSTEL   = AGENTS_DIR / "voorstellen"
DASHBOARD  = AGENTS_DIR / "agent_dashboard.html"
RUNLOG     = AGENTS_DIR / "run_historie.json"


def _lees_json(pad: Path, default):
    try:
        return json.loads(pad.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, FileNotFoundError):
        return default


def verzamel_data() -> dict:
    vandaag = datetime.date.today().isoformat()

    # ── RSS-items (fase 1) ───────────────────────────────────────────────────
    rss = _lees_json(AGENTS_DIR / "fase1_resultaat.json", [])
    rss = sorted(rss, key=lambda x: -x.get("score", 0))

    # ── GitHub-repos (fase 2) ────────────────────────────────────────────────
    repos = _lees_json(AGENTS_DIR / "fase2_resultaat.json", [])

    # ── Bedrijfsanalyse (fase 3) ─────────────────────────────────────────────
    analyse = ""
    ap = AGENTS_DIR / "dagelijkse_analyse.md"
    if ap.exists():
        analyse = ap.read_text(encoding="utf-8")

    # ── Opdrachten (fase 0) ──────────────────────────────────────────────────
    opdrachten = _lees_json(OPDR_DIR / "historie.json", [])
    opdrachten = list(reversed(opdrachten))[:50]

    # ── Voorstellen (fase 5 zelf-verbeteren) ─────────────────────────────────
    voorstellen = []
    if VOORSTEL.exists():
        for f in sorted(VOORSTEL.glob("*.md"), reverse=True):
            if f.name.lower().startswith("readme"):
                continue
            tekst = f.read_text(encoding="utf-8", errors="replace")
            status = "open"
            m = re.search(r"(?im)^status:\s*(\w[\w-]*)", tekst)
            if m:
                status = m.group(1).lower()
            titel = f.stem.replace("_", " ")
            m2 = re.search(r"(?m)^#\s+(.+)", tekst)
            if m2:
                titel = m2.group(1).strip()
            voorstellen.append({"bestand": f.name, "titel": titel,
                                "status": status, "tekst": tekst[:1500]})

    # ── Run-historie ─────────────────────────────────────────────────────────
    runs = _lees_json(RUNLOG, [])

    # ── Laatste digest ───────────────────────────────────────────────────────
    digest = ""
    digests = sorted(AGENTS_DIR.glob("digest_*.md"), reverse=True)
    if digests:
        digest = digests[0].read_text(encoding="utf-8", errors="replace")

    return {
        "gegenereerd": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "vandaag": vandaag,
        "rss": rss,
        "repos": repos,
        "analyse": analyse,
        "opdrachten": opdrachten,
        "voorstellen": voorstellen,
        "runs": list(reversed(runs))[:20],
        "digest": digest,
    }


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MT Night Agent — Dashboard</title>
<style>
  :root {
    --paper:#f4f1ea; --ink:#22271f; --green:#23402f; --green2:#2f5740;
    --gold:#c0972c; --line:#ddd6c8; --soft:#fffdf7; --rood:#b5462f;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font-family:"Segoe UI",system-ui,sans-serif; line-height:1.5; }
  header { background:var(--green); color:#fff; padding:22px 32px; }
  header h1 { margin:0; font-size:22px; }
  header .meta { color:#bcd3c2; font-size:13px; margin-top:4px; }
  .wrap { max-width:1080px; margin:0 auto; padding:24px 32px 60px; }
  .tabs { display:flex; gap:4px; flex-wrap:wrap; margin:18px 0; }
  .tab { padding:8px 16px; background:var(--soft); border:1px solid var(--line);
         border-radius:8px 8px 0 0; cursor:pointer; font-size:14px; }
  .tab.actief { background:var(--green2); color:#fff; border-color:var(--green2); }
  .paneel { display:none; }
  .paneel.actief { display:block; }
  .kaart { background:var(--soft); border:1px solid var(--line);
           border-radius:10px; padding:16px 18px; margin-bottom:12px; }
  .kaart h3 { margin:0 0 6px; font-size:15px; }
  .score { display:inline-block; min-width:34px; text-align:center;
           font-family:"DM Mono",Consolas,monospace; font-weight:700;
           border-radius:6px; padding:2px 6px; font-size:13px; }
  .s-hoog { background:var(--green2); color:#fff; }
  .s-mid  { background:var(--gold); color:#fff; }
  .s-laag { background:#e7e1d2; color:#888; }
  .badge { display:inline-block; font-size:11px; padding:2px 9px;
           border-radius:20px; font-weight:600; }
  .b-klaar { background:#dff0e3; color:var(--green2); }
  .b-wacht { background:#fbecd0; color:#9a6b13; }
  .b-open  { background:#f3ddd6; color:var(--rood); }
  .meta-r { color:#8a8676; font-size:12px; }
  a { color:var(--green2); }
  .leeg { color:#9a9684; font-style:italic; padding:14px 0; }
  pre { white-space:pre-wrap; font-family:inherit; background:#fbf9f2;
        border-left:3px solid var(--gold); padding:10px 14px; border-radius:4px;
        font-size:13px; }
  .opvolg { margin-top:8px; padding:8px 12px; background:#fbf4e2;
            border-radius:6px; font-size:13px; }
  .opvolg b { color:#9a6b13; }
  .kpi-rij { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
  .kpi { background:var(--green2); color:#fff; border-radius:10px;
         padding:12px 18px; min-width:120px; }
  .kpi .n { font-size:26px; font-weight:700; }
  .kpi .l { font-size:12px; color:#cfe0d3; }
</style>
</head>
<body>
<header>
  <h1>🌙 MT Night Agent — Dashboard</h1>
  <div class="meta">Laatst bijgewerkt: <span id="gen"></span> · lokaal gegenereerd, geen cloud</div>
</header>
<div class="wrap">
  <div class="kpi-rij" id="kpi"></div>
  <div class="tabs" id="tabs"></div>
  <div id="panelen"></div>
</div>
<script>
const DATA = __DATA__;

function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
function scoreKlasse(s){ return s>=7?'s-hoog':s>=5?'s-mid':'s-laag'; }
function statusBadge(st){
  st=(st||'').toLowerCase();
  if(st.includes('klaar')) return '<span class="badge b-klaar">'+esc(st)+'</span>';
  if(st.includes('wacht')) return '<span class="badge b-wacht">'+esc(st)+'</span>';
  return '<span class="badge b-open">'+esc(st||'open')+'</span>';
}

document.getElementById('gen').textContent = DATA.gegenereerd;

// ── KPI's ──────────────────────────────────────────────────────────────────
const hoogRss = DATA.rss.filter(r=>r.score>=7).length;
const wachtClaude = DATA.opdrachten.filter(o=>(o.status||'').includes('wacht')).length;
const openVoorstel = DATA.voorstellen.filter(v=>v.status==='open').length;
document.getElementById('kpi').innerHTML = [
  ['n','Opdrachten', DATA.opdrachten.length],
  ['n','Wacht op Claude', wachtClaude],
  ['n','Nieuws ≥7', hoogRss],
  ['n','GitHub-tools', DATA.repos.length],
  ['n','Voorstellen open', openVoorstel],
].map(k=>'<div class="kpi"><div class="n">'+k[2]+'</div><div class="l">'+k[1]+'</div></div>').join('');

// ── Panelen ────────────────────────────────────────────────────────────────
const panelen = {};

panelen['Opdrachten'] = () => {
  if(!DATA.opdrachten.length) return '<div class="leeg">Nog geen opdrachten verwerkt. '
    + 'Leg een .md-bestand in <code>Agents/opdrachten/inbox/</code> of mail naar de Outlook-map "MT-Agent".</div>';
  return DATA.opdrachten.map(o=>`
    <div class="kaart">
      <h3>${statusBadge(o.status)} <span class="meta-r">${esc(o.bron)} · ${esc(o.verwerkt||o.ontvangen||'')}</span></h3>
      <div>${esc(o.opdracht)}</div>
      ${o.resultaat?`<div class="opvolg"><b>Resultaat (lokaal):</b><br>${esc(o.resultaat).slice(0,1200)}</div>`:''}
      ${(o.status||'').includes('wacht')?`<div class="opvolg"><b>Opvolging:</b> wacht op de dagelijkse Claude-review — bestand <code>${esc(o.wachtrij_pad||'')}</code></div>`:''}
    </div>`).join('');
};

panelen['Nieuws & scans'] = () => {
  if(!DATA.rss.length) return '<div class="leeg">Geen RSS-items gescand.</div>';
  return DATA.rss.map(r=>`
    <div class="kaart">
      <h3><span class="score ${scoreKlasse(r.score)}">${r.score}</span>
        <a href="${esc(r.link)}" target="_blank">${esc(r.titel)}</a></h3>
      <div class="meta-r">${esc(r.bron)} · ${esc(r.categorie||'')}</div>
      ${r.analyse_diep
        ? `<pre>${esc(r.analyse_diep)}</pre>`
        : `<div>${esc(r.duiding || (r.beschrijving||'').slice(0,220))}</div>`}
      ${r.nabouw_waarde>=4?`<div class="opvolg"><b>Nabouw-kandidaat (${r.nabouw_waarde}/5):</b> voorstel staat klaar voor de Claude-review.</div>`:''}
    </div>`).join('');
};

panelen['GitHub-tools'] = () => {
  if(!DATA.repos.length) return '<div class="leeg">Geen relevante repos gevonden.</div>';
  return DATA.repos.map(r=>`
    <div class="kaart">
      <h3><a href="${esc(r.url)}" target="_blank">${esc(r.naam)}</a> <span class="meta-r">⭐ ${esc(r.sterren||'?')}</span></h3>
      <div>${esc(r.beschrijving||'')}</div>
      ${r.reden?`<div class="meta-r">Waarom: ${esc(r.reden)}</div>`:''}
      ${r.gebruik?`<div class="opvolg"><b>Mogelijke toepassing:</b> ${esc(r.gebruik)}</div>`:''}
    </div>`).join('');
};

panelen['Analyse'] = () => {
  const a = DATA.analyse || DATA.digest || '';
  return a ? '<div class="kaart"><pre>'+esc(a)+'</pre></div>'
           : '<div class="leeg">Nog geen analyse beschikbaar.</div>';
};

panelen['Voorstellen'] = () => {
  if(!DATA.voorstellen.length) return '<div class="leeg">Geen zelf-verbeter-voorstellen open. '
    + 'De agent zet hier voorstellen neer; Claude beoordeelt ze in de dagelijkse review.</div>';
  return DATA.voorstellen.map(v=>`
    <div class="kaart">
      <h3>${statusBadge(v.status)} ${esc(v.titel)}</h3>
      <div class="meta-r">${esc(v.bestand)}</div>
      <pre>${esc(v.tekst)}</pre>
    </div>`).join('');
};

panelen['Runs'] = () => {
  if(!DATA.runs.length) return '<div class="leeg">Nog geen run-historie.</div>';
  return DATA.runs.map(r=>`
    <div class="kaart">
      <h3>${esc(r.tijd||'')} ${statusBadge(r.status)}</h3>
      <div class="meta-r">${esc(r.samenvatting||'')}</div>
    </div>`).join('');
};

const namen = Object.keys(panelen);
const tabsEl = document.getElementById('tabs');
const panEl  = document.getElementById('panelen');
namen.forEach((naam,i)=>{
  const t = document.createElement('div');
  t.className = 'tab'+(i===0?' actief':''); t.textContent = naam;
  t.onclick = ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('actief'));
    document.querySelectorAll('.paneel').forEach(x=>x.classList.remove('actief'));
    t.classList.add('actief');
    document.getElementById('pan-'+i).classList.add('actief');
  };
  tabsEl.appendChild(t);
  const p = document.createElement('div');
  p.className = 'paneel'+(i===0?' actief':''); p.id = 'pan-'+i;
  p.innerHTML = panelen[naam]();
  panEl.appendChild(p);
});
</script>
</body>
</html>
"""


def genereer() -> None:
    print("=== FASE 6: Dashboard genereren ===")
    data = verzamel_data()
    payload = json.dumps(data, ensure_ascii=False)
    DASHBOARD.write_text(HTML_TEMPLATE.replace("__DATA__", payload), encoding="utf-8")
    print(f"  Dashboard bijgewerkt: {DASHBOARD.name}")
    print(f"  {len(data['opdrachten'])} opdrachten · {len(data['rss'])} scans · "
          f"{len(data['voorstellen'])} voorstellen")


if __name__ == "__main__":
    genereer()

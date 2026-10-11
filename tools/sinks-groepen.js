// F7 3b — tekstsinks per bestandsgroep. Beleid: externe of gedeelde data (mail, Moneybird, SharePoint, Toggl, AI, collega-invoer) komt in
// innerHTML-templates ALLEEN via esc() (tekst en attributen), jsArg()/jsLit() (handlers), veiligeUrl() (links) of html``; zie mt-core.js.
// Deze lijst benoemt per groep (a) de functies die zulke templates bouwen en (b) de interpolaties die bewust NIET door esc() gaan, elk met reden.
// De test (b-f7r3b-harness) scant de bronnen met tools/sinkscan.js en laat falen zodra er in een groepsfunctie een ruwe interpolatie bijkomt die hier niet staat.
module.exports = {
  'inbox-mail': {
    bestand: 'mt-inbox.js',
    omschrijving: 'mt-inbox.js: mail (Outlook/Graph), To Do, mappen, gesprekken, koppel-popovers en bijlagen',
    heleBestand: true,   // elke functie in het bestand telt mee
    veiligeFns: [],
    fragmentFns: ['ibKoppelBadge', 'ibKoppelChips', 'inboxKoppelKnopHtml', 'MTKoppelUI.badge', 'ntkLijst', 'todoRow', 'tdsActieHtml', 'inboxMsgRow', 'ntkPlek'],
    houd: [
      { fn: 'inboxRenderAgenda', expr: 't', reden: 'tijd uit toLocaleTimeString of de vaste tekst "hele dag"' },
      { fn: 'inboxRenderAgenda', expr: 'loc', reden: 'begint met " · " en de locatienaam gaat via ibEsc()' },
      { fn: 'inboxRenderAgenda', expr: 'dagen[i]', reden: 'vaste lijst met dagnamen' },
      { fn: 'inboxRenderAgenda', expr: 'd.getDate()', reden: 'getal uit Date' },
      { fn: 'inboxRenderAgenda', expr: 'd.getMonth()+1', reden: 'getal uit Date' },
      { fn: 'inboxRenderAgenda', expr: 'lijst', reden: 'fragment: de agenda-items, onderwerp en locatie gaan via ibEsc()' },
      { fn: 'inboxRenderTakenShell', expr: "opts||'<option>geen lijsten</option>'", reden: 'fragment: de optie-elementen, id en naam gaan via ibEsc()' },
      { fn: 'inboxRenderTakenShell', expr: 'TDS_LIJST', reden: 'vaste tekst-constante' },
      { fn: 'due', expr: 'due', reden: 'datum uit toLocaleDateString (of leeg)' },
      { fn: 'due', expr: 'imp', reden: 'vast HTML-fragment (uitroeptekens), geen data' },
      { fn: 'tdsActieHtml', expr: 'ic', reden: 'emoji uit een vaste tabel op soort' },
      { fn: 'tdsDroogloop', expr: 'doen', reden: 'getal: som van tellingen' },
      { fn: 'tdsDroogloop', expr: 'TDS_LIJST', reden: 'vaste tekst-constante' },
      { fn: 'tdsDroogloop', expr: "n('maken')", reden: 'getal: lengte van een gefilterde lijst' },
      { fn: 'tdsDroogloop', expr: "n('voltooien')", reden: 'getal: lengte van een gefilterde lijst' },
      { fn: 'tdsDroogloop', expr: "n('bijwerken')", reden: 'getal: lengte van een gefilterde lijst' },
      { fn: 'tdsDroogloop', expr: "n('koppelen')", reden: 'getal: lengte van een gefilterde lijst' },
      { fn: 'tdsDroogloop', expr: "n('conflict')", reden: 'getal: lengte van een gefilterde lijst' },
      { fn: 'tdsDroogloop', expr: "n('melding')", reden: 'getal: lengte van een gefilterde lijst' },
      { fn: 'row', expr: 'act', reden: 'vaste CSS-klasse " actief" of leeg' },
      { fn: 'row', expr: 'b', reden: 'fragment: badge met het aantal ongelezen, het getal gaat via ibEsc()' },
      { fn: 'inboxRenderList', exprBegin: "filterAan?'niets met deze filters", reden: 'drie vaste teksten' },
      { fn: 'inboxFilterChipsTekenen', expr: '!!f[k]', reden: 'boolean (true/false) in aria-pressed' },
      { fn: 'inboxFilterChipsTekenen', expr: 'l', reden: 'label uit de vaste lijst IB_FILTERS' },
      { fn: 'fnaam', expr: 'kpcls', reden: 'vaste CSS-klasse " gekoppeld" of leeg' },
      { fn: 'fnaam', expr: 'act', reden: 'vaste CSS-klasse " actief" of leeg' },
      { fn: 'fnaam', expr: 'dt', reden: 'datum/tijd uit toLocaleString' },
      { fn: 'fnaam', expr: 'clip', reden: 'vast tekentje of leeg' },
      { fn: 'fnaam', expr: 'kpchip', reden: 'fragment: MTKoppelUI.badge, die zelf alles escapet' },
      { fn: 'fnaam', expr: 'fchip', reden: 'fragment: de mapnaam erin gaat via ibEsc()' },
      { fn: 'act', expr: 'kpcls', reden: 'vaste CSS-klasse " gekoppeld" of leeg' },
      { fn: 'act', expr: 'act', reden: 'vaste CSS-klasse " actief" of leeg' },
      { fn: 'act', expr: 'dt', reden: 'datum/tijd uit toLocaleString' },
      { fn: 'act', expr: 'anyClip', reden: 'vast tekentje of leeg' },
      { fn: 'act', expr: 'kpchip', reden: 'fragment: MTKoppelUI.badge, die zelf alles escapet' },
      { fn: 'inboxRenderThread', expr: 'clip', reden: 'vast tekentje of leeg' },
      { fn: 'inboxRenderThread', expr: 'dt', reden: 'datum/tijd uit toLocaleString' },
      { fn: 'inboxRenderThread', expr: 'fid', reden: 'zelf gemaakt id "ibthr-<volgnummer>", geen data' },
      { fn: 'inboxRenderThread', expr: 'blocks', reden: 'fragment: de berichtblokken, afzender en voorbeeldtekst gaan via ibEsc()' },
      { fn: 'inboxOpenMail', expr: 'dt', reden: 'datum/tijd uit toLocaleString' },
      { fn: 'inboxOpenMail', expr: 'attHtml', reden: 'fragment: bijlagenaam en id gaan via ibEsc()' },
      { fn: 'inboxOpenMail', expr: 'folderOpts', reden: 'fragment: optie-elementen, id en naam gaan via ibEsc()' },
      { fn: 'nr', expr: "nr(c)?naam(c):''", reden: 'naam() geeft een met ibEsc() geëscapete naam of leeg' },
      { fn: 'nr', expr: 'cc', reden: 'cc = ibJa(code): JSON-letterlijke, HTML-veilig voor een handler' },
      { fn: 'nr', expr: 'mid', reden: 'mid = ibJa(id): JSON-letterlijke, HTML-veilig voor een handler' },
      { fn: 'nr', exprBegin: 'naam(o.code)||ibEsc(', reden: 'beide kanten zijn al geëscaped (naam() en ibEsc())' },
      { fn: 'projOpt', exprBegin: 'ibEsc(key).replace(', reden: 'na het escapen blijven alleen letters en cijfers over' },
      { fn: 'projOpt', expr: 'projOpt(m)', reden: 'fragment: optie-elementen, waarde en label gaan via ibEsc()' },
      { fn: 'inboxKoppelProject', exprBegin: "typeof projLabelCode==='function'", reden: 'beide takken bouwen een span met de code via ibEsc()' },
      { fn: 'inboxKoppelProject', expr: 'lijst', reden: 'fragment: de projectrijen, alle velden gaan via ibEsc()/ibJa()' },
      { fn: 'proj', expr: 's', reden: 'submapnaam uit de vaste lijst IB_SUBMAPPEN' },
      { fn: 'proj', expr: 'overig', reden: 'getal: aantal bijlagen dat geen bestand is' },
    ],
    overslaan: [],
  },
  'v2-mail-mb-sharepoint': {
    bestand: 'v2.html',
    omschrijving: 'v2: Moneybird (facturen, controle, klanten, dashboard), mail-facturen en SharePoint-bijlagen/-mappen',
    functies: ['scanEmailFacturen', 'emailRij', 'bekijkEmailPDF', 'laadEmailPDF', 'handleFile', 'toonBoekDeelfout', 'boekInMoneybirdOud', 'boekInMoneybird', 'renderFactuurFormulier', 'addRegel', 'updateTotalen', 'loadLedgers', 'projectOptiesHTML',
      'laadKlanten', 'renderKlantenGrid', 'openKlantDetail', 'laadFacturen', 'renderControleLijst', 'laadControlePDF', 'renderControleDetail', 'addCtrlRegel', 'analyseerdControleFactuur', 'neemAlleenProjectOver', 'renderHistory',
      'renderAgingBars', 'renderLeveranciersBar', '_cfRenderTeFact', '_cfRenderOnderhanden', '_cfRenderPijplijn', 'nacalcLaadOfferte', 'nacalcMaakFactuur', 'mbPop', 'klantMbPop', 'bijlagenHtml', 'mapPop', 'klantSecGeld', 'klantGeldLaad', 'arr'],
    veiligeFns: ['fmt', 'fmtDatum', 'fmtL', 'cfFmt2'],   // getal-/datumopmaak: geeft nooit markup terug
    fragmentFns: ['projKortHtml', 'projTag', 'projectOptiesHTML', 'MTKoppelUI.badge', 'ntkPlek', 'icoon', 'tabel', 'state', 'agenda', 't2ProjectRijHtml', 'projMapBadge', 'MTContactenUI.projectKaart'],   // geven HTML terug; hun eigen templates worden zelf gescand
    houd: [
      { fn: 'handleFile', expr: "hints.join(' · ')", reden: 'eigen HTML-brokjes (<strong>); de variabele data erin (parsed.project_code) gaat via esc()' },
      { fn: 'renderControleLijst', expr: 'voorraadBadge', reden: 'vaste HTML-badge zonder data' },
      { fn: 'renderControleLijst', expr: 'betaalStatus', reden: 'vaste HTML-badge zonder data' },
      { fn: 'renderControleLijst', expr: 'badge', reden: 'vaste HTML-badge zonder data' },
      { fn: 'openKlantDetail', expr: 'state', reden: 'vaste HTML-badge zonder data' },
      { fn: 'renderKlantenGrid', expr: 'kleur', reden: 'kleur uit een vast palet van CSS-variabelen' },
      { fn: 'renderAgingBars', expr: 'kleur', reden: 'vaste CSS-variabele (rood/oranje/groen)' },
      { fn: 'renderKlantenGrid', expr: "k.firstname||''", reden: 'bouwt een tekst-naam (geen HTML); de naam wordt bij het plaatsen via esc(naam) geëscaped' },
      { fn: 'renderKlantenGrid', expr: "k.lastname||''", reden: 'zie hierboven: tekst-naam, geëscaped bij plaatsing' },
    ],
    overslaan: [   // contexten die esc() niet beveiligt of niet nodig hebben, met reden
      { fn: 'addRegel', ctx: 'handler', expr: 'id', reden: 'volgnummer (regelCount++), geen data' },
      { fn: 'renderAgingBars', ctx: 'stijl', expr: 'pct', reden: 'getal uit Math.round' },
      { fn: 'renderLeveranciersBar', ctx: 'stijl', expr: 'pct', reden: 'getal uit Math.round' },
    ],
  },
};
// Groep 3: de rest van v2.html (alles wat niet in groep 1 zit). De houd-lijst met redenen staat in sinks-groep-v2overig.json (gegenereerd door de scan, met de hand gecontroleerd).
const _v2o = require('./sinks-groep-v2overig.json'), _g1 = module.exports['v2-mail-mb-sharepoint'];
module.exports['v2-overig'] = { bestand: 'v2.html', omschrijving: _v2o.omschrijving, heleBestand: true, uitgezonderd: _g1.functies, veiligeFns: _g1.veiligeFns, fragmentFns: _g1.fragmentFns.concat(_v2o.fragmentFns), houd: _v2o.houd, overslaan: [] };
// Groep 4: mobiel.html (houd-lijst met redenen in sinks-groep-mobiel.json).
const _mob = require('./sinks-groep-mobiel.json');
module.exports['mobiel'] = { bestand: 'mobiel.html', omschrijving: _mob.omschrijving, heleBestand: true, veiligeFns: _g1.veiligeFns, fragmentFns: _g1.fragmentFns.concat(_mob.fragmentFns), houd: _mob.houd, overslaan: [] };
// Groep uren: uren.html (houd-lijst met redenen in sinks-groep-uren.json).
const _g_uren = require('./sinks-groep-uren.json');
module.exports['uren'] = { bestand: 'uren.html', omschrijving: _g_uren.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_uren.fragmentFns, houd: _g_uren.houd, overslaan: [] };
// Groep toggl: mt-toggl.js (houd-lijst met redenen in sinks-groep-toggl.json).
const _g_toggl = require('./sinks-groep-toggl.json');
module.exports['toggl'] = { bestand: 'mt-toggl.js', omschrijving: _g_toggl.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_toggl.fragmentFns, houd: _g_toggl.houd, overslaan: [] };
// Groep geld: mt-geld.js (houd-lijst met redenen in sinks-groep-geld.json).
const _g_geld = require('./sinks-groep-geld.json');
module.exports['geld'] = { bestand: 'mt-geld.js', omschrijving: _g_geld.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_geld.fragmentFns, houd: _g_geld.houd, overslaan: [] };
// Groep cijfers: mt-cijfers.js (houd-lijst met redenen in sinks-groep-cijfers.json).
const _g_cijfers = require('./sinks-groep-cijfers.json');
module.exports['cijfers'] = { bestand: 'mt-cijfers.js', omschrijving: _g_cijfers.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_cijfers.fragmentFns, houd: _g_cijfers.houd, overslaan: [] };
// Groep schulden: mt-schulden.js (houd-lijst met redenen in sinks-groep-schulden.json).
const _g_schulden = require('./sinks-groep-schulden.json');
module.exports['schulden'] = { bestand: 'mt-schulden.js', omschrijving: _g_schulden.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_schulden.fragmentFns, houd: _g_schulden.houd, overslaan: [] };
// Groep verhuis: mt-verhuis.js (houd-lijst met redenen in sinks-groep-verhuis.json).
const _g_verhuis = require('./sinks-groep-verhuis.json');
module.exports['verhuis'] = { bestand: 'mt-verhuis.js', omschrijving: _g_verhuis.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_verhuis.fragmentFns, houd: _g_verhuis.houd, overslaan: [] };
// Groep rapport: mt-rapport.js (houd-lijst met redenen in sinks-groep-rapport.json).
const _g_rapport = require('./sinks-groep-rapport.json');
module.exports['rapport'] = { bestand: 'mt-rapport.js', omschrijving: _g_rapport.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_rapport.fragmentFns, houd: _g_rapport.houd, overslaan: [] };
// Groep aanwezig: mt-aanwezig.js (houd-lijst met redenen in sinks-groep-aanwezig.json).
const _g_aanwezig = require('./sinks-groep-aanwezig.json');
module.exports['aanwezig'] = { bestand: 'mt-aanwezig.js', omschrijving: _g_aanwezig.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_aanwezig.fragmentFns, houd: _g_aanwezig.houd, overslaan: [] };
// Groep dialog: mt-dialog.js (houd-lijst met redenen in sinks-groep-dialog.json).
const _g_dialog = require('./sinks-groep-dialog.json');
module.exports['dialog'] = { bestand: 'mt-dialog.js', omschrijving: _g_dialog.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_dialog.fragmentFns, houd: _g_dialog.houd, overslaan: [] };
// Groep koers: mt-koers.js (houd-lijst met redenen in sinks-groep-koers.json).
const _g_koers = require('./sinks-groep-koers.json');
module.exports['koers'] = { bestand: 'mt-koers.js', omschrijving: _g_koers.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_koers.fragmentFns, houd: _g_koers.houd, overslaan: [] };

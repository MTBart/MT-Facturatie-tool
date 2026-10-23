// F7 3b — tekstsinks per bestandsgroep. Beleid: externe of gedeelde data (mail, Moneybird, SharePoint, Toggl, AI, collega-invoer) komt in
// innerHTML-templates ALLEEN via esc() (tekst en attributen), jsArg()/jsLit() (handlers), veiligeUrl() (links) of html``; zie mt-core.js.
// Deze lijst benoemt per groep (a) de functies die zulke templates bouwen en (b) de interpolaties die bewust NIET door esc() gaan, elk met reden.
// De test (b-f7r3b-harness) scant de bronnen met tools/sinkscan.js en laat falen zodra er in een groepsfunctie een ruwe interpolatie bijkomt die hier niet staat.
const _h1 = require('./sinks-groep-inbox.json'), _h2 = require('./sinks-groep-v2mail.json');   // houd-/overslaan-lijsten met vingerafdruk (fp), zie tools/check-sinks.js
module.exports = {
  'inbox-mail': {
    bestand: 'mt-inbox.js',
    omschrijving: 'mt-inbox.js: mail (Outlook/Graph), To Do, mappen, gesprekken, koppel-popovers en bijlagen',
    heleBestand: true,   // elke functie in het bestand telt mee
    veiligeFns: [],
    fragmentFns: ['ibKoppelBadge', 'ibKoppelChips', 'inboxKoppelKnopHtml', 'MTKoppelUI.badge', 'ntkLijst', 'todoRow', 'tdsActieHtml', 'inboxMsgRow', 'ntkPlek'],
    houd: _h1.houd || [],
    overslaan: _h1.overslaan || [],
  },
  'v2-mail-mb-sharepoint': {
    bestand: 'v2.html',
    omschrijving: 'v2: Moneybird (facturen, controle, klanten, dashboard), mail-facturen en SharePoint-bijlagen/-mappen',
    functies: ['scanEmailFacturen', 'emailRij', 'bekijkEmailPDF', 'laadEmailPDF', 'handleFile', 'toonBoekDeelfout', 'boekInMoneybirdOud', 'boekInMoneybird', 'renderFactuurFormulier', 'addRegel', 'updateTotalen', 'loadLedgers', 'projectOptiesHTML',
      'laadKlanten', 'renderKlantenGrid', 'openKlantDetail', 'laadFacturen', 'renderControleLijst', 'laadControlePDF', 'renderControleDetail', 'addCtrlRegel', 'analyseerdControleFactuur', 'neemAlleenProjectOver', 'renderHistory',
      'renderAgingBars', 'renderLeveranciersBar', '_cfRenderTeFact', '_cfRenderOnderhanden', '_cfRenderPijplijn', 'nacalcLaadOfferte', 'nacalcMaakFactuur', 'mbPop', 'klantMbPop', 'bijlagenHtml', 'mapPop', 'klantSecGeld', 'klantGeldLaad', 'arr'],
    veiligeFns: ['fmt', 'fmtDatum', 'fmtL', 'cfFmt2'],   // getal-/datumopmaak: geeft nooit markup terug
    fragmentFns: ['projKortHtml', 'projTag', 'projectOptiesHTML', 'MTKoppelUI.badge', 'ntkPlek', 'icoon', 'tabel', 'state', 'agenda', 't2ProjectRijHtml', 'offertesRijHtml', 'projMapBadge', 'MTContactenUI.projectKaart'],   // geven HTML terug; hun eigen templates worden zelf gescand
    houd: _h2.houd || [],
    overslaan: _h2.overslaan || [],
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
// Groep mcp-inlog: mcp/src/inlog.js, server-side HTML van de MCP-proef (houd-lijst met redenen in sinks-groep-mcp-inlog.json).
const _g_mcpinlog = require('./sinks-groep-mcp-inlog.json');
module.exports['mcp-inlog'] = { bestand: 'mcp/src/inlog.js', omschrijving: _g_mcpinlog.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_mcpinlog.fragmentFns, houd: _g_mcpinlog.houd, overslaan: [] };
// Groep projfilter: mt-projfilter.js (houd-lijst met redenen in sinks-groep-projfilter.json).
const _g_pf = require('./sinks-groep-projfilter.json');
module.exports['projfilter'] = { bestand: 'mt-projfilter.js', omschrijving: _g_pf.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_pf.fragmentFns, houd: _g_pf.houd, overslaan: [] };
// Groep projopruim: mt-projopruim.js (houd-lijst met redenen in sinks-groep-projopruim.json).
const _g_po = require('./sinks-groep-projopruim.json');
module.exports['projopruim'] = { bestand: 'mt-projopruim.js', omschrijving: _g_po.omschrijving, heleBestand: true, veiligeFns: [], fragmentFns: _g_po.fragmentFns, houd: _g_po.houd, overslaan: [] };

// F7 3b — tekstsinks per bestandsgroep. Beleid: externe of gedeelde data (mail, Moneybird, SharePoint, Toggl, AI, collega-invoer) komt in
// innerHTML-templates ALLEEN via esc() (tekst en attributen), jsArg()/jsLit() (handlers), veiligeUrl() (links) of html``; zie mt-core.js.
// Deze lijst benoemt per groep (a) de functies die zulke templates bouwen en (b) de interpolaties die bewust NIET door esc() gaan, elk met reden.
// De test (b-f7r3b-harness) scant de bronnen met tools/sinkscan.js en laat falen zodra er in een groepsfunctie een ruwe interpolatie bijkomt die hier niet staat.
module.exports = {
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

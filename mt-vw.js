/* ============================================================================
 * mt-vw.js — projectgegevens voor Vectorworks/interiorcad (L1c). Puur: geen DOM, geen opslag.
 * interiorcad ▸ Projectgegevens ▸ Importeer leest deze XML (bewezen 12-10-2026): alleen element-tekst, nesting
 *   PROJECT_INFO > PROJECT_HEADER > PROJECT_INFO > {PROJECT_ID, COMMISSION, BUILDING, SALESREP,
 *                                                  DELIVERY_DATE > {DELIVERY_DATE, DELIVERY_WEEK, DELIVERY_YEAR}}
 *                                 > CUSTOMER {CUSTOMER_ID, COMPANY, SALUTATION, FIRSTNAME, LASTNAME, STREET, POSTAL_CODE, CITY}
 *              > PROJECT_ITEM_LIST > PROJECT_ITEM {LINE_ITEM_ID, QUANTITY, DESCRIPTION}
 * PROJECT_ID = projectnummer (of code), COMMISSION = projectnaam (gaat ook naar HHOS "Commission"), BUILDING = projectonderdeel,
 * SALESREP = projectleider, DELIVERY_DATE = de leverdatum als tekst (JJJJ-MM-DD), week en jaar volgens ISO 8601.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;
  // XML-tekst: & < > " ' ge-escaped; tekens die in XML 1.0 niet mogen (stuurtekens) weg.
  const xmlEsc = s => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  // ISO-week en ISO-jaar van een datum JJJJ-MM-DD (bv. 2026-12-31 → week 53 van 2026; 2027-01-01 → week 53 van 2026).
  function isoWeek(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (isNaN(d) || d.getUTCMonth() !== +m[2] - 1) return null;
    const dag = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dag);                     // donderdag van dezelfde week bepaalt het jaar
    const jaar = d.getUTCFullYear(), jan1 = new Date(Date.UTC(jaar, 0, 1));
    return { week: Math.ceil(((d - jan1) / 86400000 + 1) / 7), jaar };
  }
  // g = {projectnummer, naam, onderdeel, leider, leverdatum, klantnummer, bedrijf, aanhef, voornaam, achternaam,
  //      straat, postcode, plaats, items:[{aantal, omschrijving}]}
  function projectgegevensXml(g) {
    g = g || {};
    const w = isoWeek(g.leverdatum);
    const e = (tag, v, ind) => ind + '<' + tag + '>' + xmlEsc(v) + '</' + tag + '>';   // XML, geen HTML: xmlEsc rond elke waarde
    const r = ['<?xml version="1.0" encoding="UTF-8"?>', '<PROJECT_INFO version="1.0">', '  <PROJECT_HEADER>', '    <PROJECT_INFO>',
      e('PROJECT_ID', g.projectnummer, '      '), e('COMMISSION', g.naam, '      '), e('BUILDING', g.onderdeel, '      '), e('SALESREP', g.leider, '      '),
      '      <DELIVERY_DATE>', e('DELIVERY_DATE', w ? g.leverdatum : '', '        '), e('DELIVERY_WEEK', w ? w.week : '', '        '), e('DELIVERY_YEAR', w ? w.jaar : '', '        '), '      </DELIVERY_DATE>',
      '    </PROJECT_INFO>', '    <CUSTOMER>',
      e('CUSTOMER_ID', g.klantnummer, '      '), e('COMPANY', g.bedrijf, '      '), e('SALUTATION', g.aanhef, '      '), e('FIRSTNAME', g.voornaam, '      '),
      e('LASTNAME', g.achternaam, '      '), e('STREET', g.straat, '      '), e('POSTAL_CODE', g.postcode, '      '), e('CITY', g.plaats, '      '),
      '    </CUSTOMER>', '  </PROJECT_HEADER>'];
    const items = (Array.isArray(g.items) ? g.items : []).filter(x => x && String(x.omschrijving || '').trim());
    if (items.length) {
      r.push('  <PROJECT_ITEM_LIST>');
      items.forEach((x, i) => r.push('    <PROJECT_ITEM>', e('LINE_ITEM_ID', i + 1, '      '), e('QUANTITY', Number(x.aantal) > 0 ? Number(x.aantal) : 1, '      '), e('DESCRIPTION', x.omschrijving, '      '), '    </PROJECT_ITEM>'));
      r.push('  </PROJECT_ITEM_LIST>');
    }
    r.push('</PROJECT_INFO>');
    return r.join('\n') + '\n';
  }
  // Bestandsnaam "260812-projectgegevens.xml" (bewust NIET de naam van een .vwx: de automatische Corpora-route komt later).
  const bestandsnaam = nr => (String(nr == null ? '' : nr).replace(/[^A-Za-z0-9-]/g, '') || 'project') + '-projectgegevens.xml';
  root.MTVW = { xmlEsc, isoWeek, projectgegevensXml, bestandsnaam };
})(typeof window !== 'undefined' ? window : globalThis);

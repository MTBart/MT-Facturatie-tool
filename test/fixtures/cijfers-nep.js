// Nep-gegevens voor de cijfers-test en de kijkjes: verzonnen bedragen en namen, deterministisch (geen echte cijfers).
// Vorm gelijk aan het antwoord van /geld/cijfers; werkt in node (require) en in de browser (window.MTCijfersNep).
(function (root) {
  'use strict';
  const CATS = [{ id: 'materiaal', naam: 'Materiaal' }, { id: 'uitbesteed', naam: 'Uitbesteed werk' }, { id: 'personeel', naam: 'Personeel' }, { id: 'huisvesting', naam: 'Huisvesting' }, { id: 'overig', naam: 'Overig' }];
  // Seizoensvorm (jan..dec) in duizenden euro omzet per jaar; verzonnen.
  const OMZET = { 2022: [20, 22, 26, 25, 28, 30, 24, 18, 29, 31, 28, 25], 2023: [25, 27, 32, 31, 34, 37, 29, 22, 35, 38, 34, 30], 2024: [29, 33, 38, 40, 42, 47, 35, 28, 44, 48, 46, 41], 2025: [34, 37, 45, 44, 49, 52, 40, 31, 50, 55, 53, 47], 2026: [38, 41, 52, 47, 55, 61, 44, 36, 58, 63, 21] };
  const d2 = n => String(n).padStart(2, '0');
  function maanden(tot) {
    const uit = [];
    for (const j of Object.keys(OMZET).map(Number)) OMZET[j].forEach((k, i) => {
      const id = `${j}-${d2(i + 1)}`; if (id > tot) return;
      const omzet = k * 1000, mat = Math.round(omzet * (0.27 + 0.015 * ((i * 5 + j) % 5) + (j >= 2026 ? -0.02 : 0))), ub = Math.round(omzet * 0.07), pers = 12000 + (j - 2022) * 400, huis = 2100, ov = 1800 + (i % 3) * 300;
      const kosten = { materiaal: mat, uitbesteed: ub, personeel: pers, huisvesting: huis, overig: ov }, kt = mat + ub + pers + huis + ov, res = omzet - kt;
      uit.push({ id, maanden: 1, omzet, kosten, kosten_totaal: kt, correctie: j >= 2025 ? 3200 : 0, correctie_soort: j >= 2025 ? { netto: 2000, loonheffing: 900, pensioen: 300 } : { netto: 0, loonheffing: 0, pensioen: 0 },
        prive: { Eigenaar: 4000 }, aflossing: 1500, kas: { maand: id, lopend: 30000 + (j - 2022) * 6000 + i * 2500 + Math.round(res / 4), met_btw: 42000 + (j - 2022) * 6000 + i * 2500 + Math.round(res / 4) } });
    });
    return uit;
  }
  // Antwoord zoals de worker het geeft; "tot" = laatste maand met gegevens (de lopende maand is deels gevuld).
  function antwoord(tot) {
    return { perioden: maanden(tot || '2026-11'), categorieen: CATS, benchmarks: { brutomarge: { van: 50, tot: 56, bron: 'CBS' }, resultaat: { van: 10, tot: 13, bron: 'CBS' } }, benchmarks_bron: 'standaard',
      ontbrekend: [], compleet: true, correctie_van: '2025-01', indeling_voorstel: 0, niet_ingedeeld: [], waarschuwingen: [], equity_niet_ingedeeld: [], mislukt: [] };
  }
  // Prognose-items (termijnen incl. btw) voor de komende maanden.
  function prognose() {
    return { items: { a: { soort: 'project', aan: true, termijnen: [{ factuurdatum: '2026-11-20', bedrag: 36300, aan: true }, { factuurdatum: '2026-12-10', bedrag: 60500, aan: true }, { factuurdatum: '2027-01-15', bedrag: 24200, aan: true }] },
      b: { soort: 'project', aan: true, termijnen: [{ factuurdatum: '2026-12-18', bedrag: 30250, aan: true }, { factuurdatum: '2027-01-22', bedrag: 18150, aan: true }] } } };
  }
  const uit = { CATS, maanden, antwoord, prognose };
  if (typeof module !== 'undefined' && module.exports) module.exports = uit; else root.MTCijfersNep = uit;
})(typeof window !== 'undefined' ? window : globalThis);

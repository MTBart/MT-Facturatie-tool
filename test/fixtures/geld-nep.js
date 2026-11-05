// Fictieve geldtijdlijn en config voor de tests van het besteedbaar-budget-tegel (geen echte bedragen of namen).
'use strict';
const dag = (v, n) => { const x = new Date(v + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function tijdlijn(vandaag) {
  const v = vandaag || '2026-11-05';
  return {
    vandaag: v, van: dag(v, -35), tot: dag(v, 364),
    saldo: { lopend: { gerapporteerd: 15000, kredietlimiet: 10000 }, potten: { buffer: { gerapporteerd: 8000 } } },
    instellingen: { potten: [{ id: 'buffer', doel: 'buffer', naam: 'Noodbuffer' }] },
    waarschuwingen: [],
    events: [
      { id: 'bank-0', bron: 'bank', datum: dag(v, -30), delta: 5200, rekening: 'lopend' },
      { id: 'bank-a', bron: 'bank', datum: dag(v, -21), delta: -3100, rekening: 'lopend' },
      { id: 'bank-b', bron: 'bank', datum: dag(v, -13), delta: 2400, rekening: 'lopend' },
      { id: 'bank-c', bron: 'bank', datum: dag(v, -8), delta: -4600, rekening: 'lopend' },
      { id: 'bank-1', bron: 'bank', datum: dag(v, -3), delta: -1200, rekening: 'lopend' },
      { id: 'v-1', bron: 'verkoop', datum: dag(v, 3), delta: 4000, rekening: 'lopend' },
      { id: 'i-1', bron: 'inkoop', datum: dag(v, 10), delta: -22000, rekening: 'lopend' },
      { id: 'v-2', bron: 'verkoop', datum: dag(v, 25), delta: 18000, rekening: 'lopend' },
      { id: 'i-2', bron: 'inkoop', datum: dag(v, 40), delta: -6000, rekening: 'lopend' },
      { id: 'p-1', bron: 'prognose', zekerheid: 'prognose', datum: dag(v, 70), delta: 9000, rekening: 'lopend' },
    ],
  };
}
const config = () => ({ potten: [{ id: 'buffer', doel: 'buffer', naam: 'Noodbuffer' }], fictieve_buffer: 2500 });

const uit = { tijdlijn, config, dag };
if (typeof module !== 'undefined' && module.exports) module.exports = uit; else window.MTGeldNep = uit;

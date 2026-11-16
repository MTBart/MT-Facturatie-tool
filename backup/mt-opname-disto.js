// mt-opname-disto.js — proef: rechtstreeks met de DISTO praten over Bluetooth (Web Bluetooth, in Edge en Chrome). Dit is alleen een kijkvenster: het laat zien wat de DISTO in app-modus
// werkelijk stuurt (afstand, helling, andere waarden), zodat daarna de echte koppeling gebouwd kan worden. Er wordt niets in de opname opgeslagen en niets verstuurd.
// In de toetsenbordmodus stuurt de DISTO alleen het getal van het scherm; dat werkt al (mt-opname-model.js herkent de snelle reeks toetsen). Deze proef is voor de app-modus.
// Bouwt uitsluitend met DOM-methoden (textContent), nooit innerHTML.
(function (root) {
  'use strict';
  const M = root.MTOpname, X = M.X, h = X.h, S = X.S;
  const D = M.Disto = {};
  D.SERVICE = '3ab10100-f831-4395-b29d-570977d5bf94';                    // de eigen dienst van de Leica DISTO (uit openbare voorbeelden; per model kan de inhoud verschillen)
  // Wat de kenmerken vermoedelijk zijn (laatste twee tekens van het eerste blok van de UUID). Vermoedelijk: dit is niet door Leica gedocumenteerd voor de X4.
  D.NAMEN = { '01': 'afstand (m)', '02': 'eenheid afstand', '03': 'helling (rad)', '04': 'eenheid helling', '05': 'richting (rad)', '06': 'eenheid richting', '07': 'helling horizontaal', '08': 'helling verticaal', '09': 'commando', '0a': 'status', '0d': 'meting (basis)' };
  D.kort = uuid => String(uuid || '').slice(6, 8).toLowerCase();
  // De bytes van een melding leesbaar maken: hex, en elk blok van vier bytes als kommagetal (little endian). Een helling in radialen komt er ook in graden bij.
  D.lees = function (bytes, kort) {
    const b = Array.from(bytes || []), hex = b.map(x => (x < 16 ? '0' : '') + x.toString(16)).join(' '), getallen = [];
    for (let i = 0; i + 4 <= b.length; i += 4) { const v = new DataView(new Uint8Array(b.slice(i, i + 4)).buffer).getFloat32(0, true); getallen.push(isFinite(v) ? Math.round(v * 100000) / 100000 : null); }
    let extra = '';
    if (getallen.length && getallen[0] != null) { if (kort === '01' || kort === '0d') extra = ' = ' + Math.round(getallen[0] * 1000 * 10) / 10 + ' mm'; else if (kort === '03' || kort === '05' || kort === '07' || kort === '08') extra = ' = ' + Math.round(getallen[0] * 180 / Math.PI * 100) / 100 + ' graden'; }
    return { hex, getallen, tekst: (D.NAMEN[kort] || 'kenmerk ' + kort) + ': ' + (getallen.length ? getallen.join(' | ') : '(geen getal)') + extra + '   [' + hex + ']' };
  };
  X.distoProefKnop = () => h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-link', text: 'DISTO via Bluetooth verbinden (proef)', onclick: () => X.distoProef() }));
  X.distoProef = function () {
    const log = h('div', { class: 'opn-distolog', role: 'log', 'aria-label': 'Wat de DISTO stuurt' }), regels = [];
    const schrijf = t => { const tijd = new Date().toTimeString().slice(0, 8), r = tijd + '  ' + t; regels.push(r); log.appendChild(h('div', { text: r })); log.scrollTop = log.scrollHeight; };
    const bt = root.navigator && root.navigator.bluetooth; let apparaat = null;
    const verbind = async alle => {
      try {
        const opties = { optionalServices: [D.SERVICE, 'battery_service', 'device_information'] };
        if (alle) opties.acceptAllDevices = true; else opties.filters = [{ namePrefix: 'DISTO' }];
        apparaat = await bt.requestDevice(opties);
        schrijf('Gekozen: ' + (apparaat.name || 'naamloos apparaat') + '. Verbinden...');
        apparaat.addEventListener('gattserverdisconnected', () => schrijf('De verbinding is verbroken.'));
        const server = await apparaat.gatt.connect(), dienst = await server.getPrimaryService(D.SERVICE), kenmerken = await dienst.getCharacteristics();
        schrijf('Verbonden. De DISTO biedt ' + kenmerken.length + ' kenmerken aan.');
        for (const k of kenmerken) {
          const kort = D.kort(k.uuid), p = k.properties, wat = [p.read ? 'lezen' : '', p.notify ? 'meldt' : '', p.indicate ? 'meldt (bevestigd)' : '', p.write || p.writeWithoutResponse ? 'schrijven' : ''].filter(Boolean).join(', ');
          schrijf('- ' + (D.NAMEN[kort] || 'kenmerk ' + kort) + ' (' + wat + ')');
          if (p.notify || p.indicate) {
            k.addEventListener('characteristicvaluechanged', ev => { const dv = ev.target.value; schrijf(D.lees(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), kort).tekst); });
            try { await k.startNotifications(); } catch (e) { schrijf('  meldingen aanzetten lukte niet: ' + (e.message || e)); }
          }
        }
        schrijf('Klaar. Doe nu een paar metingen met de DISTO (ook een keer schuin omhoog) en kijk wat er binnenkomt.');
      } catch (e) { schrijf('Niet gelukt: ' + ((e && e.message) || e)); }
    };
    const kids = [];
    if (!bt) kids.push(h('p', { class: 'opn-waarschuwing', text: 'Deze browser kan niet rechtstreeks met Bluetooth praten. Gebruik Edge of Chrome op de Windows-tablet of op een Android-toestel.' }));
    else {
      kids.push(h('p', { text: 'Een proef: dit laat zien wat de DISTO over Bluetooth stuurt, zoals de afstand en de helling. Er wordt niets opgeslagen.' }));
      kids.push(h('p', { class: 'opn-hint', text: 'Zet op de DISTO Bluetooth aan in de app-modus (dus niet de toetsenbordmodus). Vindt de tablet hem niet, haal dan in Windows de koppeling als toetsenbord tijdelijk weg en probeer het opnieuw.' }));
      kids.push(h('div', { class: 'opn-knoppen' },
        h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Zoek de DISTO', onclick: () => verbind(false) }),
        h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Staat hij er niet bij? Toon alle apparaten', onclick: () => verbind(true) })));
      kids.push(log);
      kids.push(h('div', { class: 'opn-onderrij' },
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Kopieer het logboek', onclick: async () => { try { await root.navigator.clipboard.writeText(regels.join('\n')); X.toast('Logboek gekopieerd. Plak het in het gesprek met Claude.'); } catch (e) { X.toast('Kopiëren lukte niet; maak een schermfoto.'); } } }),
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Verbinding verbreken', onclick: () => { try { if (apparaat && apparaat.gatt && apparaat.gatt.connected) apparaat.gatt.disconnect(); } catch (e) {} } })));
    }
    X.blad('DISTO via Bluetooth (proef)', kids);
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);

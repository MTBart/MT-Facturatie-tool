// M&T Migration Tool v2
// Workflow: Map kiezen → Klant → Projectnaam(en) → Folder mapping → Migreer
// SCOPE: Alleen bestanden uit geopende map, NOOIT oude mappen verwijderen

class MigrationTool {
  constructor() {
    this.mbAdminId = '342968480452052559';
    this.mbApiBase = `https://moneybird.com/api/v2/${this.mbAdminId}`;
    this.mbToken = null;
    this.allContacts = [];
    this.nodeApiBase = 'http://localhost:3456';

    // Workflow state
    this.workflow = 'step1'; // step1, step2, step3, step4, step5
    this.selectedFolder = null;
    this.folderContents = []; // bestanden in de map
    this.selectedContact = null;
    this.projectNames = []; // 1 of meerdere projecten
    this.folderMapping = {};
  }

  // ────────────────────────────────────────────────────
  // 1. MONEYBIRD API
  // ────────────────────────────────────────────────────

  async loadContacts() {
    // Load all contacts ONCE and cache in localStorage (like index-v4.html does)
    const cacheKey = 'mt_migration_contacts';
    const cached = localStorage.getItem(cacheKey);
    if (cached) { // Enable cache
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < 86400000) { // 24 uur geldig
        this.allContacts = data;
        console.log(`✓ ${this.allContacts.length} cached contacten`);
        return data;
      }
    }

    console.log('Laden contacten van Moneybird...');
    let allContacts = [];
    for (let page = 1; page <= 100; page++) {
      try {
        const response = await fetch(
          `${this.nodeApiBase}/api/moneybird/contacts?page=${page}&per_page=100&token=${this.mbToken}`
        );
        if (!response.ok) {
          console.log(`Page ${page}: HTTP ${response.status}, stopping`);
          break;
        }
        const data = await response.json();
        if (!data || data.length === 0) {
          console.log(`Page ${page}: empty, stopping`);
          break;
        }

        allContacts = allContacts.concat(data);
        console.log(`Page ${page}: ${data.length} contacten (totaal: ${allContacts.length})`);

        if (data.length < 100) {
          console.log(`Page ${page}: ${data.length} < 100, stopping`);
          break;
        }
      } catch (err) {
        console.error(`Fout ophalen page ${page}:`, err);
        break;
      }
    }

    // Remove duplicates + add full name if company_name is empty
    const unique = new Map();
    allContacts.forEach(c => {
      if (c.id && !unique.has(c.id)) {
        // Add full name if company_name is empty (particuliere klanten)
        if (!c.company_name || !c.company_name.trim()) {
          c.company_name = `${c.firstname||''} ${c.lastname||''}`.trim();
        }
        // Only add if there's a name
        if (c.company_name && c.company_name.trim()) {
          unique.set(c.id, c);
        }
      }
    });

    this.allContacts = Array.from(unique.values());
    console.log(`✓ ${this.allContacts.length} contacten geladen en gecached (24h)`);
    localStorage.setItem('mt_migration_contacts', JSON.stringify({ data: this.allContacts, ts: Date.now() }));
    return this.allContacts;
  }

  // ────────────────────────────────────────────────────
  // 2. FOLDER PICKER & SCANNING
  // ────────────────────────────────────────────────────

  async handleFolderSelect(files) {
    // HTML5 webkitdirectory geeft FileList met alle bestanden in map
    this.folderContents = Array.from(files);
    console.log(`✓ Map geladen: ${this.folderContents.length} bestanden`);
    this.workflow = 'step2';
    this.renderWorkflow();
  }

  // ────────────────────────────────────────────────────
  // 3. UI RENDERING
  // ────────────────────────────────────────────────────

  renderMigrationTab() {
    return `
      <div class="card">
        <div class="card-title">📦 Project Migratie v2</div>
        <div class="card-subtitle">Stap 1: Map kiezen → Klant → Projectnamen → Migreer</div>
        <div id="migration-container" style="margin-top:1.5rem;">
          <button class="btn btn-primary" onclick="migrationTool.initializeMigration()" style="margin-top:1rem;">
            Start Migratie
          </button>
        </div>
      </div>
    `;
  }

  async renderWorkflow() {
    const container = document.getElementById('migration-container');
    if (!container) return;

    let html = '';

    if (this.workflow === 'step1') {
      html = this.renderStep1();
    } else if (this.workflow === 'step2') {
      html = this.renderStep2();
    } else if (this.workflow === 'step3') {
      html = this.renderStep3();
    } else if (this.workflow === 'step4') {
      html = this.renderStep4();
    } else if (this.workflow === 'step5') {
      html = this.renderStep5();
    }

    container.innerHTML = html;

    // Re-attach event listeners (wacht tot rendering klaar is)
    setTimeout(() => {
      if (this.workflow === 'step1') {
        const folderInput = document.getElementById('folder-picker');
        if (folderInput) {
          folderInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
              this.handleFolderSelect(e.target.files);
            }
          });
        }
      } else if (this.workflow === 'step2') {
        this.setupContactAutocomplete();
      }
    }, 0);
  }

  renderStep1() {
    return `
      <div style="padding:1rem; background:var(--surface2); border-radius:8px; border:2px dashed var(--border);">
        <div style="font-weight:600; margin-bottom:1rem;">📁 Stap 1: Selecteer oude projectmap</div>
        <input type="file" id="folder-picker" webkitdirectory mozdirectory msdirectory odirectory directory
               style="padding:0.75rem; border:1px solid var(--border); border-radius:4px; width:100%; cursor:pointer;">
        <div style="font-size:12px; color:var(--text-faint); margin-top:0.5rem;">
          Selecteer de projectmap uit: <code>1_Projecten NAS</code> of <code>2_Compananny NAS</code>
        </div>
      </div>
    `;
  }

  renderStep2() {
    return `
      <div style="padding:1rem; background:var(--surface2); border-radius:8px;">
        <div style="font-weight:600; margin-bottom:1rem;">✓ Map geladen (${this.folderContents.length} bestanden)</div>

        <div style="margin-bottom:1.5rem;">
          <label style="display:block; margin-bottom:0.5rem; font-weight:600;">🏢 Stap 2: Selecteer Moneybird klant</label>
          <div style="font-size:12px; color:var(--text-faint); margin-bottom:0.5rem;">
            Zoeken in alle Moneybird klanten - typ minstens 1 letter
          </div>
          <input type="text" id="contact-search"
                 placeholder="Typ naam (bv: Yvette, Tim, CompaNanny)..."
                 style="padding:0.75rem; border:2px solid var(--border); border-radius:4px; width:100%;
                        margin-bottom:0.5rem; font-size:14px; background:white;">
          <div id="contact-dropdown" style="background:white; border:1px solid var(--border); border-radius:4px;
                                            max-height:300px; overflow-y:auto; display:none; z-index:100;
                                            position:relative;"></div>
        </div>

        <div style="margin-bottom:1.5rem; padding:1rem; background:white; border:1px dashed var(--border); border-radius:4px;">
          <label style="display:block; margin-bottom:0.5rem; font-weight:600;">➕ Of: Nieuwe klant aanmaken</label>
          <input type="text" id="new-contact-name" placeholder="Nieuwe klantnaam (bijv. ABC Bouw)"
                 style="padding:0.75rem; border:1px solid var(--border); border-radius:4px; width:100%; margin-bottom:0.5rem;">
          <button class="btn btn-secondary" onclick="migrationTool.createNewContact()" style="width:100%;">+ Nieuwe klant</button>
        </div>

        <button class="btn btn-primary" onclick="migrationTool.goToStep3()" style="width:100%;">
          Volgende → Projectnamen
        </button>
      </div>
    `;
  }

  renderStep3() {
    let html = `
      <div style="padding:1rem; background:var(--surface2); border-radius:8px;">
        <div style="font-weight:600; margin-bottom:1rem;">✓ Klant: ${this.selectedContact?.company_name || 'Nieuwe klant'}</div>
        <div style="margin-bottom:1.5rem; font-size:12px; color:var(--text-faint);">
          ${this.folderContents.length} bestanden in deze map
        </div>

        <div style="margin-bottom:1.5rem;">
          <label style="display:block; margin-bottom:0.5rem;">📝 Stap 3: Projectnaam(en)</label>
          <div style="margin-bottom:0.75rem;">
            <input type="number" id="project-count" min="1" max="10" value="${this.projectNames.length}"
                   onchange="migrationTool.updateProjectCount()"
                   style="padding:0.5rem; border:1px solid var(--border); border-radius:4px; width:100px;">
            <span style="margin-left:0.75rem; font-size:12px; color:var(--text-faint);">Hoeveel projecten in deze map?</span>
          </div>
          <div id="project-names-container" style="display:flex; flex-direction:column; gap:0.5rem; margin-top:1rem;">
    `;

    const count = this.projectNames.length;
    for (let i = 0; i < count; i++) {
      html += `
        <div>
          <label style="font-size:12px; color:var(--text-faint);">Project ${i + 1}</label>
          <input type="text" id="project-name-${i}" value="${this.projectNames[i]}"
                 placeholder="bijv. Garderobe, Pantry"
                 style="padding:0.5rem; border:1px solid var(--border); border-radius:4px; width:100%;">
        </div>
      `;
    }

    html += `
          </div>
        </div>

        <button class="btn btn-primary" onclick="migrationTool.goToStep4()">
          Volgende → Folder mapping
        </button>
      </div>
    `;
    return html;
  }

  renderStep4() {
    return `
      <div style="padding:1rem; background:var(--surface2); border-radius:8px;">
        <div style="font-weight:600; margin-bottom:1rem;">✓ Projecten: ${this.projectNames.join(', ')}</div>

        <div style="margin-bottom:1.5rem;">
          <label style="display:block; margin-bottom:1rem; font-weight:600;">📂 Stap 4: Folder mapping</label>
          <div style="font-size:12px; color:var(--text-faint); margin-bottom:1rem;">
            Wijs oude subfolders toe aan nieuwe structuur:
          </div>
          <div id="mapping-container" style="display:flex; flex-direction:column; gap:1rem;"></div>
        </div>

        <button class="btn btn-primary" onclick="migrationTool.goToStep5()">
          Volgende → Migreren
        </button>
      </div>
    `;
  }

  renderStep5() {
    return `
      <div style="padding:1rem; background:var(--surface2); border-radius:8px;">
        <div style="font-weight:600; margin-bottom:1rem; color:var(--green);">✓ Klaar om te migreren!</div>

        <div style="background:var(--bg); padding:1rem; border-radius:4px; margin-bottom:1.5rem; font-size:12px;">
          <div><strong>Klant:</strong> ${this.selectedContact?.company_name || 'Nieuw'}</div>
          <div><strong>Projecten:</strong> ${this.projectNames.join(', ')}</div>
          <div><strong>Bestanden:</strong> ${this.folderContents.length}</div>
        </div>

        <button class="btn btn-gold" onclick="migrationTool.executeMigration()">
          🚀 Migratie starten
        </button>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────
  // 4. WORKFLOW INTERACTION
  // ────────────────────────────────────────────────────

  async initializeMigration() {
    console.log('Initialiseer migratie tool...');
    await this.loadContacts();
    console.log(`✓ ${this.allContacts.length} contacten geladen:`, this.allContacts.map(c => c.company_name));
    this.workflow = 'step1';
    await this.renderWorkflow();
  }

  setupContactAutocomplete() {
    const searchInput = document.getElementById('contact-search');
    const dropdown = document.getElementById('contact-dropdown');
    if (!searchInput || !dropdown) {
      console.warn('Contact autocomplete elements not found');
      return;
    }

    console.log(`✓ Contact autocomplete setup (${this.allContacts.length} contacten beschikbaar)`);
    console.log('First 10:', this.allContacts.slice(0, 10).map(c => c.company_name));
    console.log('Last 10:', this.allContacts.slice(-10).map(c => c.company_name));

    const tool = this;

    // Bij input: lokaal zoeken in gecachete contacten
    searchInput.addEventListener('input', function(e) {
      const query = e.target.value.toLowerCase();
      console.log(`Input: "${query}", allContacts: ${tool.allContacts.length}`);

      if (!query) {
        dropdown.style.display = 'none';
        return;
      }

      // Lokaal zoeken
      const filtered = tool.allContacts.filter(c =>
        c.company_name && c.company_name.toLowerCase().includes(query)
      ).slice(0, 20);

      console.log(`Filtered: ${filtered.length} contacten`);

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding:0.75rem; color:var(--text-faint);">Geen contacten gevonden</div>';
        dropdown.style.display = 'block';
        return;
      }

      let html = '';
      filtered.forEach(c => {
        const safeId = String(c.id).replace(/'/g, "\\'");
        const safeName = String(c.company_name).replace(/'/g, "\\'");
        html += `<div style="padding:0.75rem; cursor:pointer; border-bottom:1px solid var(--border); background:white;"
                      onmouseover="this.style.background='#f0f0f0'"
                      onmouseout="this.style.background='white'"
                      onclick="migrationTool.selectContact('${safeId}', '${safeName}')">
          <strong>${c.company_name}</strong>
          <div style="font-size:11px; color:var(--text-faint);">Klantnr: ${c.customer_id || 'n.v.t.'}</div>
        </div>`;
      });

      dropdown.innerHTML = html;
      dropdown.style.display = 'block';
    });

    // Sluit dropdown op blur
    searchInput.addEventListener('blur', function() {
      setTimeout(() => { dropdown.style.display = 'none'; }, 200);
    });
  }


  selectContact(contactId, contactName) {
    this.selectedContact = this.allContacts.find(c => c.id === contactId);
    document.getElementById('contact-search').value = contactName;
    document.getElementById('contact-dropdown').style.display = 'none';
  }

  async createNewContact() {
    const name = document.getElementById('new-contact-name').value.trim();
    if (!name) {
      alert('Voer klantnaam in');
      return;
    }
    // TODO: API call om nieuwe klant aan te maken in Moneybird
    this.selectedContact = { id: 'new', company_name: name };
    console.log('Nieuwe klant aangemaakt:', name);
  }

  goToStep3() {
    if (!this.selectedContact) {
      alert('Selecteer klant of maak nieuw aan');
      return;
    }
    this.workflow = 'step3';
    this.projectNames = [''];
    this.renderWorkflow();
  }

  updateProjectCount() {
    const count = parseInt(document.getElementById('project-count').value) || 1;
    this.projectNames = Array(count).fill('');

    // Re-render step 3 with correct number of inputs
    const html = this.renderStep3();
    const container = document.getElementById('migration-container');
    if (container) {
      container.innerHTML = html;

      // Wait for DOM update, then focus first input
      setTimeout(() => {
        const firstInput = document.getElementById('project-name-0');
        if (firstInput) firstInput.focus();
      }, 0);
    }
  }

  goToStep4() {
    const count = parseInt(document.getElementById('project-count').value) || 1;
    for (let i = 0; i < count; i++) {
      const inp = document.getElementById(`project-name-${i}`);
      this.projectNames[i] = inp?.value?.trim() || `Project ${i + 1}`;
    }

    if (this.projectNames.some(n => !n)) {
      alert('Vul alle projectnamen in');
      return;
    }

    this.workflow = 'step4';
    this.renderWorkflow();
    this.renderMappingUI();
  }

  renderMappingUI() {
    const container = document.getElementById('mapping-container');
    if (!container) return;

    const newFolders = ['01_Offerte', '02_Ontwerp', '03_Vectorworks', '04_Holzher', '05_CNC Files', '06_Aangeleverd', '07_Fotos', '08_Administratie', '09_Archief', '10_Werktekeningen'];

    // Extract subfolder names from file paths
    const subfolders = new Set();
    this.folderContents.forEach(file => {
      const parts = file.webkitRelativePath.split('/');
      if (parts.length > 1) {
        subfolders.add(parts[1]); // Get first level subfolder
      }
    });

    let html = '';
    Array.from(subfolders).sort().forEach(folder => {
      // Smart defaults: guess folder mapping
      let defaultFolder = '09_Archief'; // fallback
      const folderLower = folder.toLowerCase();
      if (folderLower.includes('offerte') || folderLower.includes('quote')) defaultFolder = '01_Offerte';
      else if (folderLower.includes('ontwerp') || folderLower.includes('design')) defaultFolder = '02_Ontwerp';
      else if (folderLower.includes('vectorworks')) defaultFolder = '03_Vectorworks';
      else if (folderLower.includes('holzher')) defaultFolder = '04_Holzher';
      else if (folderLower.includes('cnc') || folderLower.includes('files')) defaultFolder = '05_CNC Files';
      else if (folderLower.includes('aangeleverd') || folderLower.includes('delivered')) defaultFolder = '06_Aangeleverd';
      else if (folderLower.includes('foto') || folderLower.includes('photo')) defaultFolder = '07_Fotos';
      else if (folderLower.includes('admin')) defaultFolder = '08_Administratie';
      else if (folderLower.includes('werk') || folderLower.includes('tekening')) defaultFolder = '10_Werktekeningen';

      html += `
        <div style="padding:0.75rem; background:white; border:1px solid var(--border); border-radius:4px;">
          <div style="font-weight:600; margin-bottom:0.5rem; font-size:12px;">${folder}</div>
          <select id="map_${folder}" style="padding:0.5rem; border:1px solid var(--border); border-radius:4px; width:100%; font-size:12px;">
            <option value="">-- Kies doel --</option>
      `;
      newFolders.forEach(nf => {
        const selected = nf === defaultFolder ? 'selected' : '';
        html += `<option value="${nf}" ${selected}>${nf}</option>`;
      });
      html += `</select></div>`;
    });

    container.innerHTML = html;
  }

  goToStep5() {
    const newFolders = ['01_Offerte', '02_Ontwerp', '03_Vectorworks', '04_Holzher', '05_Aangeleverd', '06_Fotos', '07_Administratie', '08_Archief', '09_Werktekeningen'];

    const subfolders = new Set();
    this.folderContents.forEach(file => {
      const parts = file.webkitRelativePath.split('/');
      if (parts.length > 1) {
        subfolders.add(parts[1]);
      }
    });

    Array.from(subfolders).forEach(folder => {
      const select = document.getElementById(`map_${folder}`);
      this.folderMapping[folder] = select?.value || '08_Archief';
    });

    this.workflow = 'step5';
    this.renderWorkflow();
  }

  async executeMigration() {
    console.log('Migratie starten...');

    if (!this.selectedContact || this.projectNames.length === 0) {
      alert('Klant en projectnamen nog niet ingevuld');
      return;
    }

    try {
      const response = await fetch(`${this.nodeApiBase}/api/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: this.selectedFolder,
          contactId: this.selectedContact.id,
          contactName: this.selectedContact.company_name,
          projectNames: this.projectNames,
          folderMapping: this.folderMapping
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();

      if (result.success) {
        alert(`✓ Gemigreerd!\n\n${result.files} bestanden naar:\n${result.newPath}`);
        console.log('Migratie rapport:', result);
      } else {
        alert(`✗ Fout: ${result.error}`);
      }
    } catch (err) {
      console.error('Migratie error:', err);
      alert(`✗ Fout: ${err.message}`);
    }
  }
}

// ═════════════════════════════════════════════════════
// INITIALIZE
const migrationTool = new MigrationTool();

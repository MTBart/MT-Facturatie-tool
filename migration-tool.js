// M&T Migration Tool v1
// Migreert oude projecten naar nieuwe mappenstructuur + metadata
// Opgeslagen in projects.json op NAS

class MigrationTool {
  constructor() {
    this.mbAdminId = '342968480452052559';
    this.mbApiBase = `https://moneybird.com/api/v2/${this.mbAdminId}`;
    this.mbToken = null;
    this.allContacts = [];
    this.allEstimates = [];
    this.allInvoices = [];
    this.projectList = [];
    this.currentProjectIndex = 0;
    this.nodeApiBase = 'http://localhost:3456';
    this.scanResults = null;
    this.folderMapping = {};
  }

  // ────────────────────────────────────────────────────
  // 1. MONEYBIRD API CALLS
  // ────────────────────────────────────────────────────

  async fetchContacts() {
    try {
      const response = await fetch(`${this.nodeApiBase}/api/moneybird/contacts?token=${this.mbToken}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.allContacts = await response.json();
      return this.allContacts;
    } catch (err) {
      console.error('Fout bij ophalen contacten:', err);
      return [];
    }
  }

  async fetchEstimates() {
    try {
      const response = await fetch(`${this.nodeApiBase}/api/moneybird/estimates?token=${this.mbToken}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.allEstimates = await response.json();
      return this.allEstimates;
    } catch (err) {
      console.error('Fout bij ophalen offertes:', err);
      return [];
    }
  }

  async fetchInvoices() {
    try {
      const response = await fetch(`${this.nodeApiBase}/api/moneybird/sales_invoices?token=${this.mbToken}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.allInvoices = await response.json();
      return this.allInvoices;
    } catch (err) {
      console.error('Fout bij ophalen facturen:', err);
      return [];
    }
  }

  // Haalt offertes + facturen op voor specifieke klant
  getEstimatesAndInvoicesForContact(contactId) {
    const estimates = this.allEstimates
      .filter(e => e.contact_id === contactId)
      .map(e => ({ type: 'offerte', number: e.reference || e.estimate_number || '(geen naam)', id: e.id }));

    const invoices = this.allInvoices
      .filter(i => i.contact_id === contactId)
      .map(i => ({ type: 'factuur', number: i.reference || i.invoice_number || '(geen naam)', id: i.id }));

    return [...estimates, ...invoices];
  }

  // ────────────────────────────────────────────────────
  // 2. SCAN OUDE PROJECTEN (NODE API)
  // ────────────────────────────────────────────────────

  async scanOldProjects(limit = 5) {
    try {
      const response = await fetch(`${this.nodeApiBase}/api/projects?limit=${limit}`);
      const data = await response.json();
      this.projectList = data.projects || [];
      console.log(`✓ Scanned ${this.projectList.length}/${data.total} projects`);
      return this.projectList;
    } catch (err) {
      console.error('Scan error:', err);
      alert('Fout: Node.js server niet bereikbaar.\n\nStart eerst: npm install && npm start');
      return [];
    }
  }

  async scanProjectStructure(projectId) {
    try {
      const response = await fetch(`${this.nodeApiBase}/api/scan-project/${projectId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.scanResults = await response.json();
      this.folderMapping = {};
      this.scanResults.subfolders.forEach(f => {
        this.folderMapping[f.name] = f.suggestion;
      });
      return this.scanResults;
    } catch (err) {
      console.error('Project scan error:', err);
      alert(`Fout: ${err.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────────────
  // 3. FORM RENDERING
  // ────────────────────────────────────────────────────

  renderMigrationTab() {
    const tabContent = `
        <div class="card">
          <div class="card-title">Project Migratie</div>
          <div class="card-subtitle">Oude mappen → Nieuwe structuur</div>

          <div class="status-bar warn" id="migration-status" style="display:none;">
            <span class="dot"></span>
            <span id="migration-status-text">Gereed</span>
          </div>

          <div id="migration-form" style="display:none;">
            <!-- Huidige project info -->
            <div class="card">
              <div class="card-title">Huidige Project</div>
              <div id="current-project-name" style="font-size:14px; font-weight:600; margin-bottom:1rem;"></div>

              <!-- Klant selectie -->
              <div class="field">
                <label>Moneybird Klant</label>
                <select id="migration-contact" onchange="migrationTool.onContactChanged()">
                  <option value="">-- Kies klant --</option>
                </select>
              </div>

              <!-- Projectnaam -->
              <div class="field">
                <label>Projectnaam (nieuw)</label>
                <input type="text" id="migration-projectname" placeholder="bijv. Garderobe, Pantry">
              </div>

              <!-- Offertes/Facturen -->
              <div class="field">
                <label>Offertes & Facturen</label>
                <div id="migration-documents" style="background:var(--bg); padding:0.75rem; border-radius:6px; max-height:200px; overflow-y:auto;">
                  <div style="color:var(--text-faint); font-size:12px; padding:0.5rem;">Selecteer klant eerst...</div>
                </div>
              </div>

              <!-- Buttons -->
              <div style="display:flex; gap:0.75rem; margin-top:1.5rem;">
                <button class="btn btn-primary" onclick="migrationTool.scanCurrentProject()">
                  📋 Scan oud project
                </button>
                <button class="btn btn-secondary" onclick="migrationTool.nextProject()">
                  Volgende ›
                </button>
                <button class="btn btn-gold" onclick="migrationTool.finalizeMigration()">
                  ✓ Afgerond
                </button>
              </div>
            </div>
          </div>

          <!-- Initial setup button -->
          <button class="btn btn-primary" id="migration-start-btn" onclick="migrationTool.initializeMigration()">
            Start Migratie
          </button>
        </div>
    `;
    return tabContent;
  }

  // ────────────────────────────────────────────────────
  // 4. UI INTERACTION
  // ────────────────────────────────────────────────────

  async initializeMigration(limit = 5) {
    document.getElementById('migration-status').style.display = 'flex';
    document.getElementById('migration-status-text').textContent = 'Laden (max 5 projecten test-modus)...';

    // Fetch Moneybird data
    await this.fetchContacts();
    await this.fetchEstimates();
    await this.fetchInvoices();

    // Populate contact dropdown
    const contactSelect = document.getElementById('migration-contact');
    this.allContacts.forEach(c => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = `${c.company_name} (${c.customer_id || 'n.v.t.'})`;
      contactSelect.appendChild(option);
    });

    // Scan old projects (max 5 for testing)
    await this.scanOldProjects(limit);

    // Hide start button, show form
    document.getElementById('migration-start-btn').style.display = 'none';
    document.getElementById('migration-form').style.display = 'block';

    // Show first project
    this.showCurrentProject();

    document.getElementById('migration-status-text').textContent = `Gereed! ${this.projectList.length} projecten geladen`;
  }

  onContactChanged() {
    const contactId = document.getElementById('migration-contact').value;
    if (!contactId) return;

    const docs = this.getEstimatesAndInvoicesForContact(contactId);
    const docContainer = document.getElementById('migration-documents');

    if (docs.length === 0) {
      docContainer.innerHTML = '<div style="color:var(--text-faint); font-size:12px;">Geen offertes/facturen voor deze klant</div>';
      return;
    }

    let html = '<div style="display:flex; flex-direction:column; gap:0.75rem;">';

    // N.V.T. option
    html += `<div style="display:flex; align-items:center; gap:8px; padding:8px; background:var(--surface2); border-radius:4px;">
      <input type="checkbox" value="nvt" style="width:16px; height:16px; cursor:pointer;">
      <span style="font-size:12px; font-weight:500;">n.v.t. (geen koppeling)</span>
    </div>`;

    // Documents with better formatting
    docs.forEach(doc => {
      const icon = doc.type === 'offerte' ? '📋 Offerte' : '📄 Factuur';
      html += `<div style="display:flex; align-items:center; gap:8px; padding:8px; background:var(--surface2); border-radius:4px; border-left:3px solid ${doc.type === 'offerte' ? 'var(--gold)' : 'var(--green)'};">
        <input type="checkbox" value="${doc.id}" data-number="${doc.number}" data-type="${doc.type}" style="width:16px; height:16px; cursor:pointer;">
        <div style="flex:1;">
          <div style="font-size:12px; font-weight:500;">${icon}</div>
          <div style="font-size:11px; color:var(--text-faint);">${doc.number}</div>
        </div>
      </div>`;
    });

    // Manual entry
    html += `<div style="margin-top:0.5rem;">
      <input type="text" placeholder="📝 Handmatig: offerte/factuur nr..." id="manual-doc" style="font-size:12px;">
    </div>`;

    html += '</div>';

    docContainer.innerHTML = html;
  }

  showCurrentProject() {
    if (this.currentProjectIndex >= this.projectList.length) {
      document.getElementById('migration-form').style.display = 'none';
      document.getElementById('migration-status-text').textContent = '✓ Klaar! Alle projecten gemigreerd.';
      return;
    }

    const project = this.projectList[this.currentProjectIndex];
    document.getElementById('current-project-name').textContent = `${this.currentProjectIndex + 1}. ${project.name}`;
    document.getElementById('migration-projectname').value = project.name;
    document.getElementById('migration-contact').value = '';
    document.getElementById('migration-documents').innerHTML = '<div style="color:var(--text-faint); font-size:12px;">Selecteer klant...</div>';
  }

  async scanCurrentProject() {
    const project = this.projectList[this.currentProjectIndex];
    document.getElementById('migration-status-text').textContent = 'Scannend...';
    const result = await this.scanProjectStructure(project.id);
    if (result) {
      this.showMappingUI();
    }
    document.getElementById('migration-status-text').textContent = `${result?.subfolders.length || 0} folders gevonden`;
  }

  showMappingUI() {
    if (!this.scanResults) return;

    const mapContainer = document.getElementById('migration-form');
    if (!mapContainer) return;

    const newFolders = ['01_Offerte', '02_Ontwerp', '03_Vectorworks', '04_Holzher', '05_Aangeleverd', '06_Fotos', '07_Administratie', '08_Archief', '09_Werktekeningen'];

    let html = `<div class="card" style="margin-top:1.5rem;">
      <div class="card-title">📋 Mapping-overzicht</div>
      <div class="card-subtitle">${this.scanResults.subfolders.length} oude folders → 9 nieuwe subfolders</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; margin-top:1.5rem; max-height:500px; overflow-y:auto;">`;

    // Links: oude folders
    html += '<div style="border-right:2px solid var(--border);"><div style="font-weight:600;margin-bottom:1rem;font-size:12px;color:var(--text-faint);text-transform:uppercase;">Oude folders</div>';
    this.scanResults.subfolders.forEach(folder => {
      html += `<div style="padding:8px; background:var(--surface2); border-radius:4px; margin-bottom:8px; font-size:12px;">${folder.name}</div>`;
    });
    html += '</div>';

    // Rechts: mapping selecten
    html += '<div><div style="font-weight:600;margin-bottom:1rem;font-size:12px;color:var(--text-faint);text-transform:uppercase;">Doel subfolder</div>';
    this.scanResults.subfolders.forEach(folder => {
      const current = this.folderMapping[folder.name];
      html += `<select id="map_${folder.name}" style="width:100%;margin-bottom:8px;font-size:12px;" onchange="migrationTool.updateMapping('${folder.name}',this.value)">`;
      newFolders.forEach(nf => {
        html += `<option value="${nf}" ${current === nf ? 'selected' : ''}>${nf}</option>`;
      });
      html += '</select>';
    });
    html += '</div></div>';

    html += `<div style="margin-top:1rem;">
      <button class="btn btn-primary" onclick="migrationTool.executeMigrateWithMapping()">✓ Migreren met deze mapping</button>
    </div>
    </div>`;

    mapContainer.innerHTML += html;
  }

  updateMapping(folderName, newTarget) {
    this.folderMapping[folderName] = newTarget;
  }

  async executeMigrateWithMapping() {
    const project = this.projectList[this.currentProjectIndex];
    const contactId = document.getElementById('migration-contact').value;
    const projectName = document.getElementById('migration-projectname').value;

    if (!contactId || !projectName) {
      alert('Vul klant en projectnaam in');
      return;
    }

    const selectedDocs = Array.from(document.querySelectorAll('#migration-documents input[type="checkbox"]:checked'))
      .map(el => ({ id: el.value, number: el.dataset.number }));

    const contactOption = document.querySelector(`#migration-contact option[value="${contactId}"]`);
    const contactName = contactOption ? contactOption.textContent.split('(')[0].trim() : 'Onbekend';

    try {
      const response = await fetch(`${this.nodeApiBase}/api/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          contactName,
          projectName,
          documents: selectedDocs,
          folderMapping: this.folderMapping
        })
      });

      const result = await response.json();
      if (result.success) {
        alert(`✓ Gemigreerd: ${projectName}\n→ ${result.path}`);
      } else {
        alert(`✗ Fout: ${result.error}`);
      }
    } catch (err) {
      console.error('Migration error:', err);
      alert(`✗ Fout: ${err.message}`);
    }
  }

  nextProject() {
    this.currentProjectIndex++;
    this.showCurrentProject();
  }

  async finalizeMigration() {
    console.log('Migratie afgerond. Toon validatie-rapport.');
    // TODO: Validatie-rapport genereren
  }
}

// ═════════════════════════════════════════════════════
// INITIALIZE
const migrationTool = new MigrationTool();

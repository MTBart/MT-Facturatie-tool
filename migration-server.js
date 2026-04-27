// M&T Migration Server
// Node.js backend voor scannen, kopieren, metadata
// Start: node migration-server.js

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (HTML, JS, CSS)
app.use(express.static(__dirname));

// ════════════════════════════════════════════════════
// CONFIGURATIE
// ════════════════════════════════════════════════════

const PATHS = {
  oldProjects: 'C:\\Users\\BartWitte\\Mortise & Tenon\\Mortise & Tenon - On-Prem-Data\\Algemeen\\1_Projecten NAS',
  oldCompaNanny: 'C:\\Users\\BartWitte\\Mortise & Tenon\\Mortise & Tenon - On-Prem-Data\\Algemeen\\2_Compananny NAS',
  newProjects: 'C:\\Users\\BartWitte\\Mortise & Tenon\\Mortise & Tenon - On-Prem-Data\\Nieuwe mappenstructuur',
  projectsJson: 'C:\\Users\\BartWitte\\Mortise & Tenon\\Mortise & Tenon - On-Prem-Data\\Applicaties\\Claude\\projects.json'
};

let projectsList = [];
let projectsMetadata = {};

// ════════════════════════════════════════════════════
// 1. SCAN OUDE PROJECTEN
// ════════════════════════════════════════════════════

async function scanOldProjects() {
  projectsList = [];

  try {
    // Scan 1_Projecten NAS
    const dirs1 = await fs.readdir(PATHS.oldProjects);
    for (const dir of dirs1) {
      const fullPath = path.join(PATHS.oldProjects, dir);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        projectsList.push({
          id: fullPath, // Use path as stable ID
          name: dir,
          oldPath: fullPath,
          source: '1_Projecten NAS',
          type: 'regular'
        });
      }
    }

    // Scan 2_Compananny NAS
    const dirs2 = await fs.readdir(PATHS.oldCompaNanny);
    for (const dir of dirs2) {
      const fullPath = path.join(PATHS.oldCompaNanny, dir);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        projectsList.push({
          id: fullPath, // Use path as stable ID
          name: dir,
          oldPath: fullPath,
          source: '2_Compananny NAS',
          type: 'compananny'
        });
      }
    }

    console.log(`✓ Scanned ${projectsList.length} projects`);
    return projectsList;
  } catch (err) {
    console.error('Scan error:', err);
    return [];
  }
}

// ════════════════════════════════════════════════════
// 2. MIGRATIE (KOPIE + NIEUWE STRUCTUUR)
// ════════════════════════════════════════════════════

async function migrateProject(projectId, contactName, projectName, documents, folderMapping) {
  try {
    const project = projectsList.find(p => p.id === projectId);
    if (!project) throw new Error('Project niet gevonden');

    const newCustomerFolder = `${contactName}`;
    const newProjectFolder = projectName;
    const targetPath = path.join(PATHS.newProjects, newCustomerFolder, newProjectFolder);

    // Maak nieuwe structuur aan
    const subfolders = [
      '01_Offerte', '02_Ontwerp', '03_Vectorworks', '04_Holzher',
      '05_Aangeleverd', '06_Fotos', '07_Administratie', '08_Archief', '09_Werktekeningen'
    ];

    for (const folder of subfolders) {
      await fs.ensureDir(path.join(targetPath, folder));
    }

    // Kopieëren met mapping: oude folders → 9 nieuwe subfolders
    if (folderMapping && Object.keys(folderMapping).length > 0) {
      const oldFolders = await fs.readdir(project.oldPath);
      for (const oldFolder of oldFolders) {
        const oldPath = path.join(project.oldPath, oldFolder);
        const stat = await fs.stat(oldPath);
        if (stat.isDirectory()) {
          const targetSubfolder = folderMapping[oldFolder] || '08_Archief';
          const newFolderPath = path.join(targetPath, targetSubfolder);
          await fs.copy(oldPath, newFolderPath, { errorOnExist: false });
        }
      }
    } else {
      // Fallback: alles naar 08_Archief
      const archiveTarget = path.join(targetPath, '08_Archief');
      await fs.copy(project.oldPath, archiveTarget, { errorOnExist: false });
    }

    // Genereer PROJECT_INFO.txt
    const infoContent = `PROJECTNAAM: ${projectName}
Klant: ${contactName}
Adres: (uit Moneybird)
Datum migratie: ${new Date().toLocaleString('nl-NL')}

OORSPRONG: ${project.source}/${project.name}

MAPPEN:
01_Offerte - Offertes en aanvragen
02_Ontwerp - Ontwerpen en concept
03_Vectorworks - Vectorworks + CSV exports
04_Holzher - Holzher optimalisatie, HHA, NCR
05_Aangeleverd - Eindproduct, leveringsdetails
06_Fotos - Foto's en documentatie
07_Administratie - Facturen, communicatie
08_Archief - Gearchiveerde items + gemigreerde bestanden
09_Werktekeningen - Werktekeningen en detailtekeningen
`;

    await fs.writeFile(path.join(targetPath, 'PROJECT_INFO.txt'), infoContent, 'utf8');

    const metadata = {
      id: projectId,
      projectName,
      contactName,
      oldPath: project.oldPath,
      newPath: targetPath,
      documents,
      folderMapping,
      migratedAt: new Date().toISOString(),
      source: project.source
    };

    projectsMetadata[projectId] = metadata;
    await saveProjectsJson();

    return { success: true, path: targetPath };
  } catch (err) {
    console.error('Migration error:', err);
    return { success: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════
// 3. PROJECTS.JSON OPSLAAN
// ════════════════════════════════════════════════════

async function saveProjectsJson() {
  try {
    await fs.writeFile(
      PATHS.projectsJson,
      JSON.stringify(projectsMetadata, null, 2),
      'utf8'
    );
    console.log('✓ Saved projects.json');
  } catch (err) {
    console.error('Save error:', err);
  }
}

async function loadProjectsJson() {
  try {
    if (await fs.pathExists(PATHS.projectsJson)) {
      const data = await fs.readFile(PATHS.projectsJson, 'utf8');
      projectsMetadata = JSON.parse(data);
      console.log('✓ Loaded projects.json');
    }
  } catch (err) {
    console.error('Load error:', err);
  }
}

// ════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════

// Root — serve index-v4.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index-v4.html'));
});

// ════════════════════════════════════════════════════
// MONEYBIRD PROXY (avoid CORS issues)
// ════════════════════════════════════════════════════

const MONEYBIRD_BASE = 'https://moneybird.com/api/v2/342968480452052559';

async function fetchMoneyBird(endpoint, token) {
  try {
    const response = await fetch(`${MONEYBIRD_BASE}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`MB ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error(`MB fetch error on ${endpoint}:`, err);
    return null;
  }
}

app.get('/api/moneybird/:endpoint', async (req, res) => {
  const { endpoint } = req.params;
  const token = req.query.token;

  if (!token) return res.status(401).json({ error: 'No token' });

  // Build full path with query params (except token)
  const { token: _, ...queryParams } = req.query;
  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const path = `/${endpoint}.json${queryString ? '?' + queryString : ''}`;
  const data = await fetchMoneyBird(path, token);
  res.json(data || []);
});

// GET /api/all-contacts — Debug: toon alle contactnamen
app.get('/api/all-contacts', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    let allContacts = [];
    let seenIds = new Set();

    for (let page = 0; page < 20; page++) {
      const path = `/contacts.json?limit=100&offset=${page * 100}`;
      const data = await fetchMoneyBird(path, token);
      if (!data || data.length === 0) break;

      allContacts = allContacts.concat(data.filter(c => {
        if (c.id && seenIds.has(c.id)) return false;
        if (c.id) seenIds.add(c.id);
        return true;
      }));
    }

    // Deduplicate by company_name
    const uniqueByName = new Map();
    allContacts.forEach(c => {
      if (c.company_name && !uniqueByName.has(c.company_name)) {
        uniqueByName.set(c.company_name, { name: c.company_name, id: c.id, nr: c.customer_id });
      }
    });

    const names = Array.from(uniqueByName.values());
    res.json({ total: allContacts.length, unique: names.length, names });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search-contacts — Server-side klant zoeken
app.get('/api/search-contacts', async (req, res) => {
  const { q, token } = req.query;

  if (!token) return res.status(401).json({ error: 'No token' });
  if (!q || q.length < 1) return res.json([]);

  try {
    // Fetch contacts using page-based pagination (like index-v4.html does)
    let contactMap = new Map(); // ID → contact

    for (let page = 1; page <= 50; page++) {
      const path = `/contacts.json?page=${page}&per_page=100`;
      const data = await fetchMoneyBird(path, token);

      if (!data || data.length === 0) {
        console.log(`Search "${q}": Reached end at page ${page}`);
        break;
      }

      data.forEach(c => {
        if (c.id && !contactMap.has(c.id)) {
          contactMap.set(c.id, c);
        }
      });

      if (data.length < 100) {
        console.log(`Search "${q}": Page ${page} had ${data.length} < 100, stopping`);
        break;
      }
    }

    const allContacts = Array.from(contactMap.values());
    console.log(`Search "${q}": ${allContacts.length} unique contacts fetched`);

    // Filter op zoekterm
    const query = q.toLowerCase();
    const filtered = allContacts
      .filter(c => c.company_name && c.company_name.length > 0 && c.company_name.toLowerCase().includes(query))
      .slice(0, 20); // Max 20 resultaten

    console.log(`Search "${q}": ${filtered.length} unieke resultaten`);
    if (filtered.length > 0) {
      filtered.forEach(c => {
        console.log(`  → "${c.company_name}" (ID: ${c.id})`);
      });
    }
    res.json(filtered);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════
// API ENDPOINTS
// ════════════════════════════════════════════════════

// GET /api/projects — Laad projecten (optioneel: ?limit=5)
app.get('/api/projects', async (req, res) => {
  if (projectsList.length === 0) {
    await scanOldProjects();
  }

  const limit = req.query.limit ? parseInt(req.query.limit) : projectsList.length;
  const result = projectsList.slice(0, limit);

  res.json({
    total: projectsList.length,
    limit,
    count: result.length,
    projects: result
  });
});

// POST /api/migrate — Kopieert oude map naar nieuwe structuur
app.post('/api/migrate', async (req, res) => {
  const { folderPath, contactName, projectNames, folderMapping } = req.body;

  if (!folderPath || !contactName || !projectNames || !folderMapping) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    // Scan old folder
    const oldFiles = [];
    const scanFolder = (dir, prefix = '') => {
      try {
        const entries = fs.readdirSync(dir);
        entries.forEach(entry => {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);
          const relativePath = prefix ? `${prefix}/${entry}` : entry;

          if (stat.isDirectory()) {
            scanFolder(fullPath, relativePath);
          } else {
            oldFiles.push({ path: fullPath, relative: relativePath });
          }
        });
      } catch (e) {
        console.error(`Error scanning ${dir}:`, e.message);
      }
    };

    scanFolder(folderPath);
    console.log(`Scanned ${oldFiles.length} files from ${folderPath}`);

    // Build new structure
    const newBasePath = path.join(PATHS.newProjects, `${contactName}`, `${projectNames[0]}`);
    let copiedCount = 0;

    // Create all target folders first
    const newFolders = ['01_Offerte', '02_Ontwerp', '03_Vectorworks', '04_Holzher', '05_CNC Files',
                       '06_Aangeleverd', '07_Fotos', '08_Administratie', '09_Archief', '10_Werktekeningen'];

    for (const folder of newFolders) {
      const folderPath = path.join(newBasePath, folder);
      await fs.ensureDir(folderPath);
    }

    // Copy files with mapping
    const sortedFiles = oldFiles.sort((a, b) => a.relative.localeCompare(b.relative));

    for (const file of sortedFiles) {
      // Determine target folder
      const oldFolderName = file.relative.split('/')[0];
      const targetFolder = folderMapping[oldFolderName] || '09_Archief';
      const targetPath = path.join(newBasePath, targetFolder, path.basename(file.relative));

      try {
        await fs.ensureDir(path.dirname(targetPath));
        await fs.copy(file.path, targetPath);
        copiedCount++;
      } catch (e) {
        console.error(`Error copying ${file.relative}:`, e.message);
      }
    }

    res.json({
      success: true,
      files: copiedCount,
      newPath: newBasePath,
      total: sortedFiles.length
    });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/migrate — Migreer 1 project (OLD)
app.post('/api/migrate', async (req, res) => {
  const { projectId, contactName, projectName, documents, folderMapping } = req.body;
  const result = await migrateProject(projectId, contactName, projectName, documents, folderMapping);
  res.json(result);
});

// GET /api/projects-json — Laad metadata
app.get('/api/projects-json', (req, res) => {
  res.json(projectsMetadata);
});

// ════════════════════════════════════════════════════
// SMART SCAN: Scan oude project en suggest mapping
// ════════════════════════════════════════════════════

function smartMatchFolder(folderName) {
  const lower = folderName.toLowerCase();
  if (lower.includes('offert') || lower.includes('aanvraag') || lower.includes('quote')) return '01_Offerte';
  if (lower.includes('ontwerp') || lower.includes('concept') || lower.includes('design') || lower.includes('schets')) return '02_Ontwerp';
  if (lower.includes('vectorwork') || lower.includes('cad') || lower.includes('dwg') || lower.includes('vwx')) return '03_Vectorworks';
  if (lower.includes('holzher') || lower.includes('optimize') || lower.includes('nesting') || lower.includes('optim')) return '04_Holzher';
  if (lower.includes('aangelev') || lower.includes('afgewerkt') || lower.includes('product') || lower.includes('finale')) return '05_Aangeleverd';
  if (lower.includes('foto') || lower.includes('photo') || lower.includes('beeld') || lower.includes('afbeeld')) return '06_Fotos';
  if (lower.includes('admin') || lower.includes('email') || lower.includes('mail') || lower.includes('factuur') || lower.includes('invoice') || lower.includes('commun')) return '07_Administratie';
  if (lower.includes('werk') || lower.includes('detail') || lower.includes('bestek') || lower.includes('uitvoering')) return '09_Werktekeningen';
  return '08_Archief';
}

app.get('/api/scan-project/:projectId', async (req, res) => {
  const { projectId } = req.params;

  // Scan projecten als niet gedaan
  if (projectsList.length === 0) {
    await scanOldProjects();
  }

  const project = projectsList.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: `Project ${projectId} niet gevonden` });

  try {
    const subfolders = await fs.readdir(project.oldPath);
    const entries = [];

    for (const folder of subfolders) {
      const fullPath = path.join(project.oldPath, folder);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        entries.push({
          name: folder,
          suggestion: smartMatchFolder(folder),
          path: fullPath
        });
      }
    }

    res.json({
      projectName: project.name,
      projectPath: project.oldPath,
      subfolders: entries.sort((a, b) => a.name.localeCompare(b.name))
    });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════

const PORT = 3456;
app.listen(PORT, async () => {
  await loadProjectsJson();
  console.log(`\n🚀 M&T Migration Server running on http://localhost:${PORT}`);
  console.log(`📦 Old projects: ${PATHS.oldProjects}`);
  console.log(`📂 New projects: ${PATHS.newProjects}`);
  console.log(`💾 Metadata: ${PATHS.projectsJson}\n`);
});

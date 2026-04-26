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
          id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
          id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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

async function migrateProject(projectId, contactName, projectName, documents) {
  try {
    const project = projectsList.find(p => p.id === projectId);
    if (!project) throw new Error('Project niet gevonden');

    // Bepaal doelpad
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

    // Kopie alle bestanden van oude naar nieuwe locatie
    // Voor nu: kopie alles naar 08_Archief (kan later specifieker)
    const archiveTarget = path.join(targetPath, '08_Archief');
    await fs.copy(project.oldPath, archiveTarget, { errorOnExist: false });

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

    // Sla metadata op
    const metadata = {
      id: projectId,
      projectName,
      contactName,
      oldPath: project.oldPath,
      newPath: targetPath,
      documents,
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

// POST /api/migrate — Migreer 1 project
app.post('/api/migrate', async (req, res) => {
  const { projectId, contactName, projectName, documents } = req.body;
  const result = await migrateProject(projectId, contactName, projectName, documents);
  res.json(result);
});

// GET /api/projects-json — Laad metadata
app.get('/api/projects-json', (req, res) => {
  res.json(projectsMetadata);
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

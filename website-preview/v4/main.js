/* =========================================================================
   MORTISE & TENON — prototype 3D-website  (v4 — SCHETSSTIJL, gespiegelde regie)
   -------------------------------------------------------------------------
   v4 = de geverifieerde v3-regie (GESPIEGELD, niets draait) in Barts
   schets-esthetiek ("geschetst en gestift veel mooier en echter dan net
   niet computer renders" — luxe handwerk-vibe):

   Regie (identiek aan v3):
     - Stijl LINKS (verticaal, ±65×21 mm-verhouding), de regel met haunched
       pen glijdt VAN RECHTS naar binnen. Geen camera-zwenk, geen rotatie.
     - Camera schuift alleen recht-van-voren-toe (translatie + fov); een
       clipping plane opent de dwarsdoorsnede halverwege de dikte.
     - De pen valt ÍN doorsnedebeeld in het gat; een getekende lijn trekt
       kader + naadlijn over, morpht naar de logo-deellijn en valt
       pixel-exact over het M&T-merk (#intro-logo, crossfade) -> iris.

   Stijl (v4):
     - Donker "gestift papier" met crème stift-arcering i.p.v. hout;
       dubbele licht-trillende crème contourlijnen (#ece5e0) op elke vorm —
       dezelfde beeldtaal als het lijn-logo.
     - Exploded view: het paneel hangt onder de regel iets uitgezakt en
       rijdt tijdens het aanschuiven de groef in; gestreepte crème
       hulplijnen tonen de assemblage-paden en vervagen daarna.
     - Rekwisieten: blokschaaf met gepatineerd-messing knop (#6e6650),
       schaafkrullen en zaagmeel op de werkbank in de achtergrond.
     - De tekenlaag trekt haar lijnen dubbel met minieme verschuiving —
       stift op papier, geen CAD-lijn.

   DEBUG: ?t=<seconden> (bv. ?t=6.5) rendert één bevroren frame op dat
   intro-tijdstip — voor fase-checks en headless screenshots.

   Intro-API:
     window.playIntro()  — start de cinematische opening (gebeurt automatisch)
     window.skipIntro()  — breekt af en onthult direct de site

   De 3D-scène leeft volledig in #intro-stage en is later 1-op-1 te
   vervangen door echt beeldmateriaal: zet in #intro-stage een
   <video autoplay muted playsinline> i.p.v. het canvas en laat de
   vignette + logo-crossfade + iris-reveal (CSS-var --reveal) staan.
   ========================================================================= */

'use strict';

document.documentElement.classList.add('js');

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */
function clamp01(v){ return Math.min(1, Math.max(0, v)); }

function smoothstep(a, b, t){
  var u = clamp01((t - a) / (b - a));
  return u * u * (3 - 2 * u);
}

function easeInOut(u){
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

/* soepele glide: traag los, traag vast — géén terugvering */
function easeInOutSine(u){
  return -(Math.cos(Math.PI * clamp01(u)) - 1) / 2;
}

function rand(a, b){ return a + Math.random() * (b - a); }

/* ------------------------------------------------------------------ *
 *  INTRO
 * ------------------------------------------------------------------ */
var Intro = (function () {

  var elIntro = document.getElementById('intro');
  var elStage = document.getElementById('intro-stage');
  var elLogo  = document.getElementById('intro-logo');
  var elSkip  = document.getElementById('intro-skip');

  /* Tijdlijn in seconden — totaal ca. 13s (identiek aan v3)
     Fases: van rechts aanschuiven tot vlak voor het gat -> camera settelt
     face-on met dolly-zoom -> doorsnede-clip opent -> pen valt IN
     doorsnedebeeld in het gat -> tekenlaag: kader + naadlijn -> morph
     naar logo-deellijn -> crossfade -> iris-reveal. */
  var TL = {
    glideStart:  0.60,          // regel begint van rechts in te schuiven
    glideEnd:    3.40,          // hangt stil vlak vóór het gat (hover)
    faceStart:   3.40,          // dolly-zoom naar de logo-eindstand begint
    clipStart:   4.20,          // clipping plane veegt de doorsnede open
    clipEnd:     5.60,
    insertStart: 5.90,          // de pen valt — in doorsnedebeeld — in het gat
    insertEnd:   7.60,          // schouder ligt aan; camera staat definitief
    lineStart:   8.00,          // tekenlaag trekt kader + naadlijn
    lineEnd:     9.20,
    morphStart:  9.20,          // naadlijn morpht naar de logo-deellijn
    morphEnd:    9.80,
    logoIn:      9.95,          // crossfade naar het merk (pixel-uitgelijnd)
    renderStop: 10.95,          // logo dekt alles af; 3D mag stoppen
    revealStart:11.35,          // iris opent zich
    revealEnd:  12.95
  };

  /* ------------------------------------------------------------------
     MAATVOERING — alles afgeleid uit de logo-SVG (viewBox 100, kader
     x/y 1.1 zijde 97.8, deellijn M55.5 1.1 V30.9 H33.9 V67.6 H55.5 V98.9).
     1 scene-eenheid ~ 100 mm. Stijlbreedte 0.65 (65mm), dikte 0.21 (21mm).
     Fracties van de kaderzijde 97.8:
       naad          (55.5-1.1)/97.8 = 0.55624  -> stijlbreedte 0.65
       kaderzijde    S = 0.65/0.55624           = 1.1686
       pen-diepte    (55.5-33.9)/97.8 = 0.22086 -> 0.2581
       sprong-boven  (30.9-1.1)/97.8  = 0.30470 -> y +0.2282
       sprong-onder  (67.6-1.1)/97.8  = 0.67996 -> y -0.2103
     Assenstelsel (gespiegelde regie): x = horizontaal in beeld, y =
     verticaal, z = deurDIKTE, naar de camera toe. De naad (binnenkant
     stijl) ligt op x = 0; het logokader is x -0.65..+0.5186, y ±0.5843.
     ------------------------------------------------------------------ */
  var S     = 1.1686;           // logokader-zijde in scene-eenheden
  var HS    = 0.5843;           // halve kaderzijde
  var FR_R  = -0.65 + S;        // rechterrand kader = 0.5186
  var FR_CX = (-0.65 + FR_R) / 2; // kader-middelpunt x = -0.0657

  /* stijl (verticaal, links): 65mm breed, 21mm dik, loopt onder het
     kader door naar beneden (de deur loopt door buiten beeld) */
  var STL = { x0: -0.65, x1: 0.0, y0: -1.35, y1: HS, z: 0.105 };
  /* regel (horizontaal, schuift van rechts): hoogte = kaderzijde,
     bovenkant gelijk met de stijltop (bovenhoek van de deur) */
  var RAI = { x0: 0.0, x1: 1.60, y0: -HS, y1: HS, z: 0.105 };
  /* pen: ~1/3 van de dikte; hoogtematen = de logo-deellijn */
  var TEN = { x0: -0.258, y0: -0.2103, y1: 0.2282, z: 0.035 };
  /* haunch: verlaagd trapje boven de pen, vult het open groefeind;
     0.01 korter dan de groefdiepte (geen z-fight met de groefbodem) */
  var HAU = { x0: -0.10, y0: 0.2282, y1: HS, z: 0.035 };
  /* gat: 0.005 speling rondom de pen, 0.012 dieper */
  var MOR = { x0: -0.27, y0: -0.2153, y1: 0.2332, z: 0.04 };
  /* paneelgroef in de stijl: zelfde breedte als het gat, diepte 0.11.
     GESTOPT: alleen boven het gat (haunch vult hem) en onder de regel
     (paneel rijdt erin); tussen gat en regel-onderkant massief. */
  var GRV = { back: -0.11, z: 0.04 };
  /* groef in de regel-ONDERkant (het paneel hangt onder de bovenregel) */
  var RGR = { top: -0.4743 };   // bovenkant groefholte (diepte 0.11)
  /* paneel: rijdt in de groeven, met speling */
  var PAN = { x0: -0.10, x1: 1.45, y0: -1.30, y1: -0.484, z: 0.03 };

  var SLIDE = 1.35;             // startafstand van de regel (naar rechts)
  var HOVER = 0.34;             // hover-positie: pen vlak vóór het gat
  var PANEL_DROP = 0.38;        // exploded view: paneel start zo ver gezakt

  var renderer = null, scene = null, camera = null;
  var railGroup = null, panelGroup = null, spot = null;
  var dust = null, dustMat = null;
  var clipPlane = null;
  var caps = null;              // doorsnede-vlakken (stijl/regel/paneel)
  var trace = null;             // canvas-tekenlaag (kader + naadlijn)
  var strokeMats = null;        // [vol, zacht] crème schetslijn-materialen
  var leaderMat = null;         // gestreepte hulplijnen van de exploded view
  var jointMats = [];           // alle materialen die geclipt worden
  var finished = false, started = false;
  var rafId = 0, t0 = 0, prevNow = 0;

  var camPos = null, camLook = null;
  var CAM = null;
  var FIT = null;               // pixel-uitlijning op de logo-SVG

  var prefersReduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- procedureel "gestift papier" ----------------
     v4: geen fotorealistisch hout maar donker papier met crème
     stift-arcering — dezelfde beeldtaal als het lijn-logo. */
  function paperTexture(cfg){
    var W = 512, H = 512, i;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');

    ctx.fillStyle = cfg.base;
    ctx.fillRect(0, 0, W, H);

    /* zachte lichtvlekken: gestift gevuld, niet egaal */
    for (i = 0; i < 26; i++){
      var gx = Math.random() * W, gy = Math.random() * H, gr = rand(50, 170);
      var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, 'rgba(236,229,224,' + rand(0.020, 0.050).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(236,229,224,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    /* diagonale arcering — de "stift"-strepen, licht gebogen */
    ctx.lineWidth = 1;
    for (i = 0; i < cfg.hatch; i++){
      var x0 = Math.random() * (W + 160) - 80;
      var y0 = Math.random() * (H + 160) - 80;
      var len = rand(26, 90);
      var ang = -Math.PI / 4 + rand(-0.16, 0.16);
      ctx.strokeStyle = 'rgba(236,229,224,' + rand(0.10, 0.22).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(
        x0 + Math.cos(ang) * len * 0.5 + rand(-3, 3),
        y0 + Math.sin(ang) * len * 0.5 + rand(-3, 3),
        x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      ctx.stroke();
    }

    /* papierkorrel */
    for (i = 0; i < 1600; i++){
      ctx.fillStyle = (Math.random() < 0.5)
        ? 'rgba(236,229,224,0.030)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    }

    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------------- schetslijnen ----------------
     Elke vorm krijgt twee crème contour-passes met licht verschoven
     hoekpunten — dat "trillen" maakt het handgetekend i.p.v. CAD-strak. */
  function jitterEdges(geo, amp){
    var arr = geo.attributes.position.array;
    for (var i = 0; i < arr.length; i++){
      arr[i] += rand(-amp, amp);
    }
    return geo;
  }

  function sketchEdges(mesh, mats){
    var sm = mats || strokeMats;
    if (!sm) return;
    var e1 = jitterEdges(new THREE.EdgesGeometry(mesh.geometry), 0.005);
    var e2 = jitterEdges(new THREE.EdgesGeometry(mesh.geometry), 0.010);
    mesh.add(new THREE.LineSegments(e1, sm[0]));
    mesh.add(new THREE.LineSegments(e2, sm[1]));
  }

  /* doosje op min/max-coördinaten — alles tegelt exact, niets overlapt.
     v4: elke doos krijgt meteen zijn dubbele schets-contour. */
  function boxMM(parent, mat, x0, x1, y0, y1, z0, z1){
    var m = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    sketchEdges(m);
    parent.add(m);
    return m;
  }

  /* donker vlak dat een holte diepte laat lezen; facing = 'x' of 'y' */
  function darkPlane(parent, mat, facing, at, a0, a1, b0, b1){
    var g, m;
    if (facing === 'x'){
      /* vlak in het y-z-vlak op x=at; a = y-bereik, b = z-bereik */
      g = new THREE.PlaneGeometry(b1 - b0, a1 - a0);
      m = new THREE.Mesh(g, mat);
      m.rotation.y = Math.PI / 2;
      m.position.set(at, (a0 + a1) / 2, (b0 + b1) / 2);
    } else {
      /* horizontaal vlak op y=at; a = x-bereik, b = z-bereik */
      g = new THREE.PlaneGeometry(a1 - a0, b1 - b0);
      m = new THREE.Mesh(g, mat);
      m.rotation.x = Math.PI / 2;
      m.position.set((a0 + a1) / 2, at, (b0 + b1) / 2);
    }
    parent.add(m);
    return m;
  }

  /* ---------------- de stijl (links, verticaal) ----------------
     Binnenkant (naad) = x=0; het gat en de gestopte groef zitten in dat
     vlak. Exact tegelende dozen; openingen zijn écht leeg. */
  function buildStile(mat, darkMat){
    var g = new THREE.Group();

    /* massieve rug achter gat + groef */
    boxMM(g, mat, STL.x0, MOR.x0, STL.y0, STL.y1, -STL.z, STL.z);
    /* dikte-flanken vóór/achter de holtes, volle hoogte */
    boxMM(g, mat, MOR.x0, 0, STL.y0, STL.y1,  MOR.z,  STL.z);
    boxMM(g, mat, MOR.x0, 0, STL.y0, STL.y1, -STL.z, -MOR.z);
    /* middenstrook (z ±0.04):
       - boven het gat: groef open (haunch vult hem straks) -> hout
         alleen achter de groefbodem */
    boxMM(g, mat, MOR.x0, GRV.back, MOR.y1, STL.y1, -MOR.z, MOR.z);
    /* - het gat zelf: leeg
       - tussen gat en regel-onderkant: massief (groef is gestopt) */
    boxMM(g, mat, MOR.x0, 0, -HS, MOR.y0, -MOR.z, MOR.z);
    /* - onder de regel: groef open (paneel rijdt erin) */
    boxMM(g, mat, MOR.x0, GRV.back, STL.y0, -HS, -MOR.z, MOR.z);

    /* donkere bodems zodat de holtes diepte lezen */
    darkPlane(g, darkMat, 'x', MOR.x0 + 0.004,
              MOR.y0 + 0.004, MOR.y1 - 0.004, -MOR.z * 0.96, MOR.z * 0.96);
    darkPlane(g, darkMat, 'x', GRV.back + 0.002,
              MOR.y1 + 0.002, STL.y1 - 0.002, -GRV.z * 0.96, GRV.z * 0.96);
    darkPlane(g, darkMat, 'x', GRV.back + 0.002,
              STL.y0 + 0.002, -HS - 0.002, -GRV.z * 0.96, GRV.z * 0.96);

    return g;
  }

  /* ---------------- de regel (schuift van rechts) ----------------
     Groep-oorsprong = het schoudervlak; railGroup.position.x = afstand
     tot de naad. De pen steekt naar -x, het lichaam naar +x. Groef in
     de ONDERkant (het paneel hangt eronder). Haunched pen: logo-exact. */
  function buildRail(mat, darkMat){
    var g = new THREE.Group();

    /* lichaam: twee dikte-flanken + middenstrook boven de groefholte */
    boxMM(g, mat, RAI.x0, RAI.x1, RAI.y0, RAI.y1,  GRV.z,  RAI.z);
    boxMM(g, mat, RAI.x0, RAI.x1, RAI.y0, RAI.y1, -RAI.z, -GRV.z);
    boxMM(g, mat, RAI.x0, RAI.x1, RGR.top, RAI.y1, -GRV.z, GRV.z);

    /* volle pen + haunch (trapje) — exact de logo-deellijn */
    boxMM(g, mat, TEN.x0, 0, TEN.y0, TEN.y1, -TEN.z, TEN.z);
    boxMM(g, mat, HAU.x0, 0, HAU.y0, HAU.y1, -HAU.z, HAU.z);

    /* donkere groefbodem (van onderen zichtbaar) */
    darkPlane(g, darkMat, 'y', RGR.top - 0.002,
              RAI.x0 + 0.01, RAI.x1 - 0.01, -GRV.z * 0.96, GRV.z * 0.96);

    return g;
  }

  /* ---------------- paneel (hangt onder de regel, schuift mee) -------
     v4: hangt aan een eigen groep zodat het exploded kan starten
     (uitgezakt) en tijdens het aanschuiven de groef in rijdt. */
  function buildPanel(mat){
    var g = new THREE.Group();
    boxMM(g, mat, PAN.x0, PAN.x1, PAN.y0, PAN.y1, -PAN.z, PAN.z);
    return g;
  }

  /* ---------------- werkplaats-props (v4) ----------------
     Blokschaaf met gepatineerd-messing details, schaafkrullen en een
     hoopje zaagmeel op de werkbank — geschetst, in de mid-achtergrond
     (z<0, dus de doorsnede-clip laat ze staan; de tekenlaag dekt ze af).
     Eigen materialen, bewust NIET in jointMats. */
  function buildProps(propWood, brassMat, propStrokes){
    var grp = new THREE.Group();

    /* blokschaaf */
    var plane = new THREE.Group();
    var romp = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.20), propWood);
    romp.position.y = 0.13; romp.castShadow = romp.receiveShadow = true;
    sketchEdges(romp, propStrokes); plane.add(romp);
    var zool = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.22), propWood);
    zool.position.y = 0.025; zool.castShadow = zool.receiveShadow = true;
    sketchEdges(zool, propStrokes); plane.add(zool);
    var knop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.11, 20), brassMat);
    knop.position.set(-0.14, 0.26, 0); knop.castShadow = true;
    sketchEdges(knop, propStrokes); plane.add(knop);
    var beitel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.14), brassMat);
    beitel.position.set(0.08, 0.24, 0); beitel.rotation.z = -0.5;
    sketchEdges(beitel, propStrokes); plane.add(beitel);
    plane.position.set(1.35, -1.50, -1.10); plane.rotation.y = -0.6;
    grp.add(plane);

    /* schaafkrullen naast de schaaf */
    for (var k = 0; k < 3; k++){
      grp.add(makeShavingCurl(propWood, propStrokes,
        0.80 + k * 0.30 + rand(-0.05, 0.05), -1.485,
        -1.35 + k * 0.18 + rand(-0.06, 0.06), rand(0, Math.PI * 2)));
    }

    /* hoopje zaagmeel — fijne puntjes in eiken-tint */
    var sdN = 90, sdPos = new Float32Array(sdN * 3), i;
    for (i = 0; i < sdN; i++){
      var a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.6) * 0.30;
      sdPos[i * 3]     = 1.75 + Math.cos(a) * r;
      sdPos[i * 3 + 1] = -1.485 + rand(0, 0.02);
      sdPos[i * 3 + 2] = -1.35 + Math.sin(a) * r * 0.7;
    }
    var sdGeo = new THREE.BufferGeometry();
    sdGeo.setAttribute('position', new THREE.BufferAttribute(sdPos, 3));
    grp.add(new THREE.Points(sdGeo, new THREE.PointsMaterial({
      color: 0xc9a87c, size: 0.014, transparent: true, opacity: 0.8, depthWrite: false })));

    scene.add(grp);
    return grp;
  }

  /* één schaafkrul: spiraalcurve als tube + crème schetslijn erlangs */
  function makeShavingCurl(mat, propStrokes, px, py, pz, rot){
    var pts = [], n = 26;
    for (var i = 0; i <= n; i++){
      var a = i * 0.55, r = 0.028 + i * 0.0022;
      pts.push(new THREE.Vector3(
        Math.cos(a) * r, i * 0.0035 + Math.sin(a) * r * 0.4, i * 0.016));
    }
    var curve = new THREE.CatmullRomCurve3(pts);
    var tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.011, 6, false), mat);
    tube.castShadow = true;
    var g = new THREE.Group();
    g.add(tube);
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)), propStrokes[1]));
    g.position.set(px, py + 0.03, pz); g.rotation.y = rot;
    return g;
  }

  /* ---------------- exploded-view hulplijnen (v4) ----------------
     Gestreepte crème lijnen zoals in een technische schets: de as
     pen→gat (langs x, de schuifrichting) en de stijg-lijn van het
     uitgezakte paneel naar de groef in de regel-onderkant. Ze vervagen
     zodra de assemblage loopt (zie tick). Liggen net vóór het hout
     (z=0.14) en zijn bewust NIET geclipt. */
  function buildLeaders(){
    var g = new THREE.Group();
    leaderMat = new THREE.LineDashedMaterial({
      color: 0xece5e0, transparent: true, opacity: 0.55,
      dashSize: 0.05, gapSize: 0.045, depthWrite: false });

    function dashed(a, b){
      var geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      var ln = new THREE.Line(geo, leaderMat);
      ln.computeLineDistances();
      g.add(ln);
    }

    /* as van pen naar gat — langs de schuifrichting, op penhoogte */
    dashed(new THREE.Vector3(SLIDE + 0.20, 0.01, 0.14),
           new THREE.Vector3(MOR.x0 - 0.05, 0.01, 0.14));
    /* stijg-lijn van het uitgezakte paneel naar de regel-groef */
    dashed(new THREE.Vector3(1.55, PAN.y1 - PANEL_DROP - 0.10, 0.14),
           new THREE.Vector3(1.55, -HS + 0.05, 0.14));

    scene.add(g);
    return g;
  }

  /* ---------------- doorsnede-vlakken (caps) ----------------
     De clip verwijdert de voorste helft van de dikte; deze platte vlakken
     zijn de "zaagsnede". v4: iets lichtere papier-tinten dan de romp —
     alsof het kopse vlak dichter gestift is. De stijl-cap heeft het gat
     en de groeven als echte uitsparing; de regel-cap (pen + haunch)
     schuift er tijdens de insert exact in: dát is het logo dat in elkaar
     valt. Vlakken liggen net vóór het eind-clipvlak (0.004). */
  function buildCaps(){
    function shapeMesh(pts, mat, z){
      var sh = new THREE.Shape();
      sh.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
      sh.closePath();
      var m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat);
      m.position.z = z;
      m.renderOrder = 3;
      return m;
    }
    function capMat(color){
      return new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0,
        depthWrite: false, fog: false, side: THREE.DoubleSide
      });
    }

    var matS = capMat(0x6b543a);   // stijl — kops "papier", toon A
    var matR = capMat(0x74593c);   // regel — toon B (bewust nét anders)
    var matP = capMat(0x5f4a33);   // paneel

    /* stijl-doorsnede: buitenrand met gat + beide groef-uitsparingen */
    var stilePts = [
      [STL.x0,   STL.y1], [GRV.back, STL.y1], [GRV.back, MOR.y1],
      [MOR.x0,   MOR.y1], [MOR.x0,   MOR.y0], [0,        MOR.y0],
      [0,        -HS],    [GRV.back, -HS],    [GRV.back, STL.y0],
      [STL.x0,   STL.y0]
    ];
    scene.add(shapeMesh(stilePts, matS, 0.005));

    /* regel-doorsnede (regel-lokaal): pen + haunch + lichaam boven groef */
    var railPts = [
      [0,      RGR.top], [0,      TEN.y0], [TEN.x0, TEN.y0],
      [TEN.x0, TEN.y1],  [HAU.x0, TEN.y1], [HAU.x0, RAI.y1],
      [RAI.x1, RAI.y1],  [RAI.x1, RGR.top]
    ];
    railGroup.add(shapeMesh(railPts, matR, 0.0055));

    /* paneel-doorsnede — aan de paneelgroep, zodat hij exact meebeweegt */
    var panelPts = [
      [PAN.x0, PAN.y1], [PAN.x1, PAN.y1], [PAN.x1, PAN.y0], [PAN.x0, PAN.y0]
    ];
    panelGroup.add(shapeMesh(panelPts, matP, 0.006));

    return {
      setOpacity: function (o){
        matS.opacity = o; matR.opacity = o; matP.opacity = o;
      }
    };
  }

  /* ---------------- tekenlaag (canvas op een vlak) ----------------
     Trekt in de eindfase het logokader + de échte naadlijn van de
     doorsnede, en morpht die naadlijn naar de logo-deellijn (alleen het
     haunch-segment schuift 0.10 naar de naad). De donkere achtergrond
     dimt het 3D-beeld eronder mee weg. Ligt op z=0.02, vóór de caps.
     v4: elke lijn wordt dubbel getrokken met minieme, vaste verschuiving
     per hoekpunt — stift op papier, geen CAD-lijn. */
  function buildTrace(){
    var W = 2048, H = 896;         // canvas-pixels
    var PW = 6.4,  PH = 2.8;       // vlak-afmeting in scene-eenheden
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');

    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      fog: false, toneMapped: false
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat);
    mesh.renderOrder = 4;
    mesh.visible = false;
    scene.add(mesh);

    /* kader (gesloten) + naadlijn: ECHT profiel -> LOGO-deellijn */
    var SQ = [
      [STL.x0, HS], [FR_R, HS], [FR_R, -HS], [STL.x0, -HS], [STL.x0, HS]
    ];
    var BD_TRUE = [
      [HAU.x0, HS], [HAU.x0, TEN.y1], [TEN.x0, TEN.y1],
      [TEN.x0, TEN.y0], [0, TEN.y0], [0, -HS]
    ];
    var BD_LOGO = [
      [0, HS], [0, TEN.y1], [TEN.x0, TEN.y1],
      [TEN.x0, TEN.y1 - (TEN.y1 - TEN.y0)], [0, TEN.y0], [0, -HS]
    ];

    var pxw = W / PW;                       // pixels per scene-eenheid
    var LW  = 0.0263 * pxw;                 // = SVG-stroke 2.2/97.8 * S

    /* vaste jitter per hoekpunt (eenmalig): de hoofdlijn blijft binnen
       ~1px van de ware geometrie (pixel-uitlijning blijft kloppen), de
       echo-pass mag verder afwijken. */
    function mkJit(n, amp){
      var a = [], i;
      for (i = 0; i < n; i++) a.push([rand(-amp, amp), rand(-amp, amp)]);
      return a;
    }
    var J = {
      sq1: mkJit(SQ.length,      LW * 0.10),
      sq2: mkJit(SQ.length,      LW * 0.45),
      bd1: mkJit(BD_TRUE.length, LW * 0.10),
      bd2: mkJit(BD_TRUE.length, LW * 0.45)
    };

    function toPx(p){
      return [ (p[0] - FIT.camX + PW / 2) * pxw,
               (1 - (p[1] - FIT.camY + PH / 2) / PH) * H ];
    }

    function strokePartial(pts, frac, jit){
      if (frac <= 0) return;
      var segs = [], total = 0, i, dx, dy, L;
      for (i = 0; i < pts.length - 1; i++){
        dx = pts[i + 1][0] - pts[i][0];
        dy = pts[i + 1][1] - pts[i][1];
        L = Math.sqrt(dx * dx + dy * dy);
        segs.push(L); total += L;
      }
      function px(idx, pt){
        var q = toPx(pt);
        if (jit){ q[0] += jit[idx][0]; q[1] += jit[idx][1]; }
        return q;
      }
      var want = total * clamp01(frac), run = 0;
      var p = px(0, pts[0]);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (i = 0; i < segs.length; i++){
        if (run + segs[i] <= want){
          p = px(i + 1, pts[i + 1]);
          ctx.lineTo(p[0], p[1]);
          run += segs[i];
        } else {
          var k = (want - run) / segs[i];
          p = px(i + 1, [ pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k,
                          pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k ]);
          ctx.lineTo(p[0], p[1]);
          break;
        }
      }
      ctx.stroke();
    }

    /* sqF/bdF = trace-voortgang 0..1; m = morph 0..1; bgA = dim 0..1 */
    function draw(sqF, bdF, m, bgA){
      ctx.clearRect(0, 0, W, H);
      if (bgA > 0){
        ctx.fillStyle = 'rgba(9,6,5,' + (0.94 * bgA).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      var pts = null, i;
      if (bdF > 0){
        pts = [];
        for (i = 0; i < BD_TRUE.length; i++){
          pts.push([ BD_TRUE[i][0] + (BD_LOGO[i][0] - BD_TRUE[i][0]) * m,
                     BD_TRUE[i][1] + (BD_LOGO[i][1] - BD_TRUE[i][1]) * m ]);
        }
      }

      /* pass 1: de volle stiftlijn */
      ctx.strokeStyle = 'rgba(236,229,224,0.95)';
      ctx.lineWidth = LW;
      strokePartial(SQ, sqF, J.sq1);
      if (pts) strokePartial(pts, bdF, J.bd1);

      /* pass 2: zachte echo, iets verschoven — de dubbele stift-streek */
      ctx.strokeStyle = 'rgba(236,229,224,0.30)';
      ctx.lineWidth = LW * 0.75;
      strokePartial(SQ, sqF, J.sq2);
      if (pts) strokePartial(pts, bdF, J.bd2);

      tex.needsUpdate = true;
    }

    return {
      mesh: mesh, draw: draw,
      reposition: function (){
        mesh.position.set(FIT.camX, FIT.camY, 0.02);
      }
    };
  }

  /* ---------------- pixel-uitlijning op de logo-SVG ----------------
     Het #intro-logo staat al in de DOM (opacity 0, wél layout). We geven
     de SVG een vaste maat, meten waar het kader op het scherm staat en
     zetten de eindcamera zó dat het 3D-kader daar exact overheen valt:
     camera kijkt evenwijdig aan z, dolly-zoom naar tele. */
  function computeLogoFit(){
    var svg = elLogo.querySelector('.bm-mark');
    var vw = window.innerWidth, vh = window.innerHeight;
    var frameHpx = Math.min(0.46 * vh, 0.80 * vw);
    var svgW = frameHpx / 0.978;              // kader = 97.8/100 van de SVG
    svg.style.width  = svgW + 'px';
    svg.style.height = svgW + 'px';
    var r  = svg.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top  + r.height / 2;
    var D  = 8.5;
    var f  = frameHpx / S;                    // pixels per scene-eenheid
    FIT = {
      D: D,
      fovEnd: 2 * Math.atan((vh / 2) / (f * D)) * 180 / Math.PI,
      camX: FR_CX - (cx - vw / 2) / f,
      camY: (cy - vh / 2) / f
    };
    if (trace) trace.reposition();
  }

  /* ---------------- fijn, spaarzaam stof (dust motes) ----------------
     v4: crème-tint i.p.v. warm goud — sluit aan op de stiftlijnen. */
  function makeDust(){
    var MAX = 140;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(MAX * 3);
    var col = new Float32Array(MAX * 3);
    var i;

    var sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    var sg = sc.getContext('2d');
    var grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0,    'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,.5)');
    grad.addColorStop(1,    'rgba(255,255,255,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 64, 64);
    var sprite = new THREE.CanvasTexture(sc);

    var motes = [];
    for (i = 0; i < MAX; i++){
      var i3 = i * 3;
      var mx = rand(-1.2, 2.0), my = rand(-1.2, 1.5), mz = rand(-0.6, 2.2);
      pos[i3] = mx; pos[i3 + 1] = my; pos[i3 + 2] = mz;
      var w = rand(0.10, 0.34);
      col[i3] = 0.60 * w; col[i3 + 1] = 0.57 * w; col[i3 + 2] = 0.52 * w;
      motes.push({
        bx: mx, by: my, bz: mz,
        px: rand(0, Math.PI * 2), py: rand(0, Math.PI * 2), pz: rand(0, Math.PI * 2),
        sx: rand(0.12, 0.32), sy: rand(0.10, 0.26), sz: rand(0.10, 0.28),
        w: w
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));

    dustMat = new THREE.PointsMaterial({
      size: 0.02,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    var pts = new THREE.Points(geo, dustMat);
    pts.frustumCulled = false;
    scene.add(pts);

    function update(t){
      for (var k = 0; k < MAX; k++){
        var m = motes[k];
        var i3 = k * 3;
        pos[i3]     = m.bx + Math.sin(t * m.sx + m.px) * 0.10;
        pos[i3 + 1] = m.by + Math.sin(t * m.sy + m.py) * 0.08;
        pos[i3 + 2] = m.bz + Math.sin(t * m.sz + m.pz) * 0.10;
        var w = m.w * (0.7 + 0.3 * Math.sin(t * 1.7 + m.px));
        col[i3]     = 0.60 * w;
        col[i3 + 1] = 0.57 * w;
        col[i3 + 2] = 0.52 * w;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }

    /* één dun stofsliertje wanneer de pen thuisvalt — subtiel */
    var wispDone = false;
    var wisps = [];
    function wisp(origin){
      if (wispDone) return;
      wispDone = true;
      for (var k = 0; k < 8; k++){
        wisps.push({
          x: origin.x + rand(-0.06, 0.06),
          y: origin.y + rand(-0.05, 0.05),
          z: origin.z + rand(-0.02, 0.04),
          vy: rand(0.05, 0.14), vx: rand(-0.04, 0.04), vz: rand(0.02, 0.07),
          life: rand(0.9, 1.5), ttl: 1.4
        });
      }
    }
    function updateWisp(dt){
      for (var k = 0; k < wisps.length; k++){
        var wsp = wisps[k];
        if (wsp.life <= 0) continue;
        wsp.life -= dt;
        wsp.vy -= 0.4 * dt;
        wsp.x += wsp.vx * dt; wsp.y += wsp.vy * dt; wsp.z += wsp.vz * dt;
        var slot = (MAX - 1 - k);
        var i3 = slot * 3;
        pos[i3] = wsp.x; pos[i3 + 1] = wsp.y; pos[i3 + 2] = wsp.z;
        var a = clamp01(wsp.life / wsp.ttl) * 0.5;
        col[i3] = 0.62 * a; col[i3 + 1] = 0.59 * a; col[i3 + 2] = 0.54 * a;
      }
    }

    return { update: update, wisp: wisp, updateWisp: updateWisp };
  }

  /* ---------------- scène-opbouw ---------------- */
  function buildScene(){
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.localClippingEnabled = true;      // dwarsdoorsnede
    elStage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090605);
    /* milde fog (v3): de eindcamera staat ver weg (tele) en mag de
       doorsnede niet in het duister trekken */
    scene.fog = new THREE.FogExp2(0x090605, 0.06);

    camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 60);

    /* camera-regie (GEEN rotatie): het werk staat al face-on. Alleen een
       trage drift tijdens het aanschuiven en daarna een dolly-zoom naar
       tele op de logo-positie (FIT). */
    CAM = {
      aPos:  new THREE.Vector3(1.15, 0.35, 3.20),
      aLook: new THREE.Vector3(0.35, 0.05, 0.00),
      bPos:  new THREE.Vector3(0.45, 0.12, 3.35),
      bLook: new THREE.Vector3(0.10, 0.00, 0.00)
    };
    camPos = new THREE.Vector3();
    camLook = new THREE.Vector3();

    computeLogoFit();

    /* licht: warme bovenlichtbundel + hogere ambient dan v3 — de
       papier-arcering moet leesbaar blijven (Lambert-materialen) */
    var amb = new THREE.AmbientLight(0x6b6058, 1.15);
    scene.add(amb);

    spot = new THREE.SpotLight(0xffd7a0, 1.9, 0, 0.42, 0.72, 1.0);
    spot.position.set(1.4, 5.0, 2.2);
    spot.target.position.set(0, -0.1, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.width = 2048;
    spot.shadow.mapSize.height = 2048;
    spot.shadow.bias = -0.0004;
    scene.add(spot);
    scene.add(spot.target);

    var rim = new THREE.DirectionalLight(0xb8aca4, 0.45);
    rim.position.set(-3, 1.2, -2.2);
    scene.add(rim);

    /* materialen — donker "gestift papier" met crème arcering (v4).
       Eerst de schetslijn-materialen, want sketchEdges leest strokeMats. */
    strokeMats = [
      new THREE.LineBasicMaterial({ color: 0xece5e0, transparent: true, opacity: 0.85 }),
      new THREE.LineBasicMaterial({ color: 0xece5e0, transparent: true, opacity: 0.26 })
    ];
    /* aparte, NIET-geclipte lijnen voor de props (anders knipt de
       doorsnede-sweep contouren van de blokschaaf weg) */
    var propStrokes = [
      new THREE.LineBasicMaterial({ color: 0xece5e0, transparent: true, opacity: 0.85 }),
      new THREE.LineBasicMaterial({ color: 0xece5e0, transparent: true, opacity: 0.26 })
    ];

    var texA = paperTexture({ base: '#372a21', hatch: 340 });
    var texB = paperTexture({ base: '#3d2e23', hatch: 300 });
    var texP = paperTexture({ base: '#30241c', hatch: 240 });

    var matA = new THREE.MeshLambertMaterial({ map: texA });
    var matB = new THREE.MeshLambertMaterial({ map: texB });
    var matPanel = new THREE.MeshLambertMaterial({ map: texP });
    var matDark = new THREE.MeshBasicMaterial({
      color: 0x070404, side: THREE.DoubleSide, fog: false
    });
    var matBrass = new THREE.MeshStandardMaterial({
      color: 0x6e6650, metalness: 0.55, roughness: 0.52 });
    var propWood = new THREE.MeshLambertMaterial({ map: texB });

    /* clipping plane: normaal -z, behoudt z <= constant. De sweep haalt
       de VOORSTE helft van de deurdikte weg -> doorsnede halverwege.
       Ook de schetslijnen clippen mee, anders blijven contouren zweven. */
    clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 5.0);
    jointMats = [matA, matB, matPanel, matDark, strokeMats[0], strokeMats[1]];
    jointMats.forEach(function (m){
      m.clippingPlanes = [clipPlane];
      m.clipShadows = true;
    });

    /* vage werkvloer — verdwijnt in de fog */
    var bench = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x15100e, roughness: 0.96 })
    );
    bench.rotation.x = -Math.PI / 2;
    bench.position.y = -1.50;
    bench.receiveShadow = true;
    scene.add(bench);

    /* een paar vage werkbank-silhouetten — donker vlak + heel vage
       crème contour, alsof ze licht aangeschetst zijn in de achtergrond */
    var silMat = new THREE.MeshBasicMaterial({ color: 0x0d0907 });
    var silhouettes = [
      { w: 0.9, h: 1.6, d: 0.9,  x: -3.4, y: -0.70, z: -2.6 },
      { w: 1.3, h: 0.9, d: 0.7,  x:  3.6, y: -1.05, z: -3.2 },
      { w: 0.5, h: 2.0, d: 0.5,  x: -2.9, y: -0.50, z: -3.8 }
    ];
    silhouettes.forEach(function (s){
      var geo = new THREE.BoxGeometry(s.w, s.h, s.d);
      var m = new THREE.Mesh(geo, silMat);
      m.position.set(s.x, s.y, s.z);
      m.add(new THREE.LineSegments(
        jitterEdges(new THREE.EdgesGeometry(geo), 0.02),
        new THREE.LineBasicMaterial({ color: 0xece5e0, transparent: true, opacity: 0.15 })
      ));
      scene.add(m);
    });

    /* de deurhoek: stijl links (vast), regel + paneel schuiven van rechts.
       v4: het paneel hangt aan een eigen groep en start uitgezakt
       (exploded view); het rijdt tijdens het aanschuiven de groef in. */
    scene.add(buildStile(matA, matDark));

    railGroup = buildRail(matB, matDark);
    panelGroup = buildPanel(matPanel);
    panelGroup.position.y = -PANEL_DROP;   // start: exploded, onder de groef
    railGroup.add(panelGroup);
    railGroup.position.set(SLIDE, 0, 0);
    scene.add(railGroup);

    buildProps(propWood, matBrass, propStrokes);
    buildLeaders();

    caps  = buildCaps();
    trace = buildTrace();
    trace.reposition();
    dust  = makeDust();
  }

  /* ---------------- regel-positie 0..1 per fase ---------------- */
  function glideProgress(t){
    if (t <= TL.glideStart) return 0;
    if (t >= TL.glideEnd)   return 1;
    return easeInOutSine((t - TL.glideStart) / (TL.glideEnd - TL.glideStart));
  }
  function insertProgress(t){
    if (t <= TL.insertStart) return 0;
    if (t >= TL.insertEnd)   return 1;
    return easeInOutSine((t - TL.insertStart) / (TL.insertEnd - TL.insertStart));
  }

  /* ---------------- hoofdlus ---------------- */
  /* debug: ?t=6.5 rendert één bevroren frame op dat tijdstip (fase-check) */
  var FREEZE = (function (){
    var m = /[?&]t=([0-9.]+)/.exec(window.location.search);
    return m ? parseFloat(m[1]) : null;
  })();
  if (FREEZE !== null){
    /* bevroren frame moet deterministisch zijn: CSS-transities (logo-
       crossfade/zelftekenende stroke) meteen op hun eindtoestand */
    var frz = document.createElement('style');
    frz.textContent = '#intro-logo,#intro-logo *{transition:none !important}';
    document.head.appendChild(frz);
  }

  function tick(now){
    if (finished) return;
    var t = (FREEZE !== null) ? FREEZE : (now - t0) / 1000;
    var dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    /* regel: van rechts naar hover, later (in doorsnedebeeld) het gat in */
    var gp = glideProgress(t);
    var ip = insertProgress(t);
    railGroup.position.x = HOVER + (SLIDE - HOVER) * (1 - gp) - HOVER * ip;
    /* lichte zweving vóór het contact, volledig uitgedempt bij hover */
    railGroup.position.y = 0.010 * Math.sin(t * 1.8) *
        (1 - smoothstep(TL.glideStart + 1.2, TL.glideEnd - 0.2, t));

    /* paneel rijdt de groef in (de exploded view sluit zich) */
    var pk = easeInOutSine(smoothstep(TL.glideStart, TL.glideStart + 1.2, t));
    panelGroup.position.y = -PANEL_DROP * (1 - pk);

    /* hulplijnen vervagen zodra de assemblage loopt */
    leaderMat.opacity = 0.55 * (1 - smoothstep(TL.glideStart + 0.4, TL.glideEnd - 0.6, t));

    /* stofsliertje wanneer de pen thuisvalt */
    if (ip > 0.985){ dust.wisp({ x: 0.0, y: -0.3, z: 0.3 }); }
    dust.update(t);
    dust.updateWisp(dt);
    /* motes vervagen zodra de tekenlaag komt */
    dustMat.opacity = 0.9 * (1 - smoothstep(TL.lineStart, TL.lineEnd, t));

    /* -------- camera: drift -> dolly-zoom naar de logo-positie -------- */
    var dk = easeInOut(clamp01((t - TL.glideStart) / (TL.faceStart - TL.glideStart)));
    camPos.lerpVectors(CAM.aPos, CAM.bPos, dk);
    camLook.lerpVectors(CAM.aLook, CAM.bLook, dk);

    var fe = easeInOutSine(clamp01((t - TL.faceStart) / (TL.insertEnd - TL.faceStart)));
    if (fe > 0){
      camPos.x  += (FIT.camX - camPos.x)  * fe;
      camPos.y  += (FIT.camY - camPos.y)  * fe;
      camPos.z  += (FIT.D    - camPos.z)  * fe;
      camLook.x += (FIT.camX - camLook.x) * fe;
      camLook.y += (FIT.camY - camLook.y) * fe;
      camLook.z  = 0;
      camera.fov = 38 + (FIT.fovEnd - 38) * fe;
      camera.updateProjectionMatrix();
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    /* -------- dwarsdoorsnede: clip veegt de voorste helft weg -------- */
    var ck = smoothstep(TL.clipStart, TL.clipEnd, t);
    if (ck > 0){
      clipPlane.constant = 5.0 - (5.0 - 0.004) * easeInOut(ck);
      caps.setOpacity(ck);
    }

    /* -------- tekenlaag: kader + naadlijn -> morph naar deellijn ------ */
    if (t >= TL.lineStart - 0.05 && t < TL.renderStop){
      trace.mesh.visible = true;
      var sqF = clamp01((t - TL.lineStart) / 0.7);
      var bdF = clamp01((t - (TL.lineStart + 0.35)) /
                        (TL.lineEnd - TL.lineStart - 0.35));
      var mm  = easeInOutSine(clamp01((t - TL.morphStart) /
                                      (TL.morphEnd - TL.morphStart)));
      var bgA = smoothstep(TL.lineStart, TL.lineEnd, t);
      trace.draw(easeInOutSine(sqF), easeInOutSine(bdF), mm, bgA);
    }

    if (t < TL.renderStop){
      renderer.render(scene, camera);
    }

    /* crossfade naar het merk — de SVG tekent zichzelf over onze lijnen */
    if (t >= TL.logoIn){
      elLogo.classList.add('on');
    }

    /* iris-reveal naar de site */
    if (t >= TL.revealStart){
      var r = smoothstep(TL.revealStart, TL.revealEnd, t);
      elIntro.style.setProperty('--reveal', r.toFixed(4));
    }
    if (FREEZE !== null){             // bevroren debug-frame: blijf hetzelfde
      rafId = requestAnimationFrame(tick);   // tijdstip her-renderen (screenshot)
      return;
    }

    if (t >= TL.revealEnd + 0.08){
      finish();
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  /* ---------------- zonder WebGL: alleen merk + reveal ---------------- */
  function liteIntro(){
    elStage.style.display = 'none';
    elLogo.classList.add('on');
    window.setTimeout(function(){ revealNow(1200); }, 1800);
  }

  function revealNow(dur){
    var start = performance.now();
    function step(now){
      if (finished) return;
      var k = clamp01((now - start) / dur);
      elIntro.style.setProperty('--reveal', easeInOut(k).toFixed(4));
      if (k < 1) requestAnimationFrame(step);
      else finish();
    }
    requestAnimationFrame(step);
  }

  function webglOK(){
    try {
      var cv = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (cv.getContext('webgl') || cv.getContext('experimental-webgl')));
    } catch (e){ return false; }
  }

  function onResize(){
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    computeLogoFit();
  }

  /* ---------------- afronden / overslaan ---------------- */
  function finish(){
    if (finished) return;
    finished = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    if (renderer){
      renderer.dispose();
      renderer = null;
    }
    elIntro.style.display = 'none';
    elIntro.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    document.body.classList.add('intro-done');
    SiteFX.init();
  }

  function skip(){
    if (finished) return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    elIntro.classList.add('skipping');
    document.body.classList.remove('no-scroll');
    window.setTimeout(finish, 580);
  }

  function play(){
    if (started || finished) return;
    started = true;

    if (prefersReduced){
      finish();                       // direct de site, geen beweging
      return;
    }
    elSkip.addEventListener('click', skip);
    window.addEventListener('keydown', function (e){
      if (e.key === 'Escape') skip();
    });

    if (typeof THREE === 'undefined' || !webglOK()){
      liteIntro();                    // CDN offline of geen WebGL
      return;
    }
    try {
      buildScene();
    } catch (err){
      if (window.console) console.warn('3D-intro kon niet starten:', err);
      liteIntro();
      return;
    }
    window.addEventListener('resize', onResize);
    t0 = prevNow = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  return { play: play, skip: skip };
})();

window.playIntro = Intro.play;
window.skipIntro = Intro.skip;

/* ------------------------------------------------------------------ *
 *  SITE — scroll-reveals, header, mobiel menu
 * ------------------------------------------------------------------ */
var SiteFX = (function () {

  var inited = false;

  function init(){
    if (inited) return;
    inited = true;

    /* scroll-reveal */
    var targets = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window){
      var io = new IntersectionObserver(function (entries){
        entries.forEach(function (en){
          if (en.isIntersecting){
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
      targets.forEach(function (el){ io.observe(el); });
    } else {
      targets.forEach(function (el){ el.classList.add('in'); });
    }

    /* header-achtergrond na scrollen */
    var header = document.getElementById('site-header');
    function onScroll(){
      header.classList.toggle('scrolled', window.scrollY > 24);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* mobiel menu */
    var toggle = document.getElementById('nav-toggle');
    if (toggle){
      toggle.addEventListener('click', function (){
        var open = document.body.classList.toggle('nav-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.querySelectorAll('.site-nav a').forEach(function (a){
        a.addEventListener('click', function (){
          document.body.classList.remove('nav-open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    /* jaartal in de footer */
    var jaar = document.getElementById('jaar');
    if (jaar) jaar.textContent = String(new Date().getFullYear());
  }

  return { init: init };
})();

/* start */
window.playIntro();

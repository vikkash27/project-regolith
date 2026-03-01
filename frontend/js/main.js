// ============================================
// Project Regolith — Three.js Scene & HUD
// NASA GLB Moon + Crater Selection + GLSL Shaders
// State Machine: ORBIT -> CONFIG -> ZOOMING -> SIMULATION
// ============================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CRATERS, LUNAR_PHYSICS, latLonToVector3, latLonToNormal, difficultyColor } from './craters.js';
import {
    craterVertexShader, craterFragmentShader,
    shadowVertexShader, shadowFragmentShader,
    dustVertexShader, dustFragmentShader
} from './shaders.js';

// ---- APP STATE ----
const AppState = { ORBIT: 'ORBIT', CONFIG: 'CONFIG', ZOOMING: 'ZOOMING', SIMULATION: 'SIMULATION' };
let currentState = AppState.ORBIT;
let selectedCrater = null;

// ---- Constants ----
const MOON_RADIUS = 800;
const SUN_DIR = new THREE.Vector3(-0.85, 0.18, 0.45).normalize();

// Dynamic rover palette (up to 5)
const ROVER_PALETTE = [
    { id: 'alpha',   color: 0xff6b6b, name: 'ROVER-ALPHA',   role: 'Scout' },
    { id: 'beta',    color: 0x4ecdc4, name: 'ROVER-BETA',    role: 'Heavy-Lift' },
    { id: 'gamma',   color: 0xffd93d, name: 'ROVER-GAMMA',   role: 'Sensor' },
    { id: 'delta',   color: 0xa855f7, name: 'ROVER-DELTA',   role: 'Relay' },
    { id: 'epsilon', color: 0x06d6a0, name: 'ROVER-EPSILON', role: 'Excavator' },
];

// ---- Swarm palette (15 rovers, no named identities) ----
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color);
    };
    return (f(0) << 16) + (f(8) << 8) + f(4);
}

const SWARM_COUNT = 15;
const SWARM_PALETTE = [];
for (let i = 0; i < SWARM_COUNT; i++) {
    const hue = (i * 24) % 360;
    SWARM_PALETTE.push({
        id: `sw${String(i + 1).padStart(2, '0')}`,
        color: hslToHex(hue, 70, 55),
        name: `SW-${String(i + 1).padStart(2, '0')}`,
        role: 'Swarm Unit',
    });
}

// ---- Scene objects ----
let scene, camera, renderer, controls;
let moonGlobe, localTerrain, shadowMesh, dustParticles;
let craterMaterial, shadowMaterial;
let craterMarkers = [];
let roverMeshes = {}, roverTrails = {};
const clock = new THREE.Clock();

// ---- Mission state ----
let missionStartTime = null;
let missionActive = false;
let telemetryWs = null, negotiationWs = null;
let roverStates = {};
let shadowBoundaryX = -250;

// ---- Swarm / Construction Mode ----
let swarmMode = false;
let constructionMode = false;
let padTiles = [];
let padTileMeshes = [];
let padOutlineMesh = null;
let padProgress = 0;
let padPhase = 'survey';
let padCenter = { x: 0, z: 0 };
let padTargetRadius = 80;
let collectionZones = [];
let collectionZoneMeshes = [];
let materialPileMeshes = [];

// ---- Simulation speed ----
let simSpeed = 1;

// ---- Rover POV Camera ----
let povRoverId = null;           // null = orbit cam, string = following that rover
let povOffset = new THREE.Vector3(0, 8, -18); // Behind and above rover
let povSmooth = 0.06;

// ---- Minimap ----
let minimapCanvas = null, minimapCtx = null;

// ---- Mission Analytics ----
let missionStats = { totalDistance: {}, coverageCells: new Set(), iceFound: 0, energyUsed: {} };

// ---- Free Camera (WASD + virtual joystick) ----
const keysDown = {};
const freeCamSpeed = 80;  // units/s

// ---- Zoom animation ----
let zoomStart = {}, zoomEnd = {};
let zoomStartTime = 0;
const ZOOM_DURATION = 3.5;

// ---- Terrain scale (world units per km) ----
const CRATER_SCALE = 15;       // 3× original — vast terrain feel
const DEPTH_SCALE = 30;        // Proportional depth for visual realism
const ROVER_MESH_SCALE = 0.55; // Visible rovers at larger terrain scale

// ---- Config defaults ----
let missionConfig = {
    craterId: null,
    numRovers: 3,
    shadowSpeed: 3.0,
    missionDuration: 300,
    initialBattery: 100,
    scenario: 'exploration',
};

// ---- Mission Scenarios ----
const SCENARIOS = {
    exploration: {
        name: 'Ice Exploration',
        description: 'Survey and map water ice deposits across the crater floor',
        objectives: ['Discover all ice deposits', 'Map >80% of crater', 'Return data before shadow engulfs area'],
        shadowSpeed: 3.0,
        initialBattery: 100,
        modifiers: {},
    },
    rescue: {
        name: 'Emergency Rescue',
        description: 'A rover is stranded deep in the shadow zone — the swarm must coordinate a rescue before its battery dies',
        objectives: ['Locate stranded rover', 'Navigate rescue team to shadow zone', 'Escort stranded rover back to safety'],
        shadowSpeed: 5.0,
        initialBattery: 80,
        modifiers: { strandedRover: true },
    },
    mining: {
        name: 'Ice Mining Operations',
        description: 'Extract water ice from confirmed deposits and transport to processing station at crater rim',
        objectives: ['Locate richest deposits', 'Mine ice at each location', 'Transport to rim base before shadow'],
        shadowSpeed: 2.0,
        initialBattery: 90,
        modifiers: { miningMode: true },
    },
    relay: {
        name: 'Communications Relay',
        description: 'Establish a communication relay chain across the crater to maintain contact with all science targets',
        objectives: ['Deploy relay positions across crater', 'Maintain chain from rim to deep floor', 'Maximize coverage area'],
        shadowSpeed: 4.0,
        initialBattery: 100,
        modifiers: { relayMode: true },
    },
    race: {
        name: 'Shadow Race',
        description: 'The shadow is advancing fast — all rovers must escape to the sunlit zone before they are engulfed',
        objectives: ['All rovers reach safety', 'No rover battery drops below 10%', 'Fastest evacuation time'],
        shadowSpeed: 8.0,
        initialBattery: 60,
        modifiers: { raceMode: true },
    },
    swarm_construction: {
        name: 'Landing Pad Construction',
        description: 'Deploy a 15-rover ISRU swarm to construct a sintered-regolith landing pad for future missions',
        objectives: ['Survey and grade the construction site', 'Collect regolith feedstock from surrounding terrain', 'Sinter regolith tiles via concentrated solar / microwave at ~1100°C', 'Place interlocking hex tiles in concentric rings', 'Compact and verify pad surface integrity'],
        shadowSpeed: 0.5,
        initialBattery: 100,
        modifiers: { swarmMode: true, constructionMode: true },
    },
    swarm_crater: {
        name: 'Swarm Crater Mission',
        description: 'Deploy a 15-rover swarm into the crater for complex multi-agent exploration and ice prospecting',
        objectives: ['Maximize crater floor coverage with 15-rover coordination', 'Discover all ice deposits using distributed sensing', 'Maintain swarm communication mesh across entire crater'],
        shadowSpeed: 4.0,
        initialBattery: 90,
        modifiers: { swarmMode: true },
    },
};

// ---- AI Narrator (Web Speech API) ----
let narratorEnabled = false;
let narratorQueue = [];
let narratorSpeaking = false;
let lastNarratorEvent = 0; // throttle

// ---- Post-Mission Tracking ----
let nemotronHistory = []; // [{time, helpfulness, correctness, coherence, complexity, verbosity}]
let totalAIDecisions = 0;
let sidePanelOpen = true;

// ---- Active rover IDs (dynamic) ----
function activeRovers() { return isSwarmMode() ? SWARM_PALETTE : ROVER_PALETTE.slice(0, missionConfig.numRovers); }

function isSwarmMode() {
    const sc = SCENARIOS[missionConfig.scenario];
    return sc && sc.modifiers && sc.modifiers.swarmMode;
}
function isConstructionMode() {
    const sc = SCENARIOS[missionConfig.scenario];
    return sc && sc.modifiers && sc.modifiers.constructionMode;
}
function activeSwarmRovers() {
    return isSwarmMode() ? SWARM_PALETTE : ROVER_PALETTE.slice(0, missionConfig.numRovers);
}

// ============================================
// INIT
// ============================================
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000005);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50000);
    // Start looking at the south pole — all craters are lat -84 to -90
    camera.position.set(0, -1400, 1200);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 900;
    controls.maxDistance = 5000;
    controls.target.set(0, -MOON_RADIUS * 0.85, 0); // look toward south pole

    // Lights
    const sunLight = new THREE.DirectionalLight(0xffeedd, 3.0);
    sunLight.position.set(-2000, 500, 1000);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x0a1020, 0.15));
    const rimLight = new THREE.DirectionalLight(0x3366aa, 0.25);
    rimLight.position.set(1500, 300, -1500);
    scene.add(rimLight);

    // Build
    createStarfield();
    loadNASAMoon();

    // Raycaster for crater selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    renderer.domElement.addEventListener('click', (e) => {
        if (currentState !== AppState.ORBIT) return;
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const meshes = craterMarkers.map(m => m.hitbox);
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
            const marker = craterMarkers.find(m => m.hitbox === hits[0].object);
            if (marker) selectCrater(marker.crater);
        }
    });

    renderer.domElement.addEventListener('mousemove', (e) => {
        if (currentState !== AppState.ORBIT) return;
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const meshes = craterMarkers.map(m => m.hitbox);
        const hits = raycaster.intersectObjects(meshes, false);
        renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
        craterMarkers.forEach(m => {
            const hovered = hits.length > 0 && m.hitbox === hits[0].object;
            m.ring.material.opacity = hovered ? 1.0 : 0.9;
            if (m.pulseRing) m.pulseRing.material.opacity = hovered ? 0.8 : 0.35;
            if (m.card) m.card.classList.toggle('hovered', hovered);
        });
    });

    window.addEventListener('resize', onResize);

    // Hide simulation HUD until needed
    document.getElementById('rover-strip').style.display = 'none';
    document.getElementById('side-panel').style.display = 'none';
    document.getElementById('bottom-bar').style.display = 'none';

    animate();
}

// ============================================
// STARFIELD
// ============================================
function createStarfield() {
    const COUNT = 15000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
        const r = 5000 + Math.random() * 20000;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = r * Math.cos(phi);
        pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
        const b = 0.4 + Math.random() * 0.6;
        const temp = Math.random();
        col[i*3]   = b * (temp < 0.3 ? 0.8 : 1.0);
        col[i*3+1] = b * (temp < 0.3 ? 0.9 : temp < 0.6 ? 0.95 : 0.7);
        col[i*3+2] = b * (temp < 0.3 ? 1.0 : temp < 0.6 ? 0.8 : 0.5);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
        size: 2.0, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true
    })));
}

// ============================================
// NASA MOON GLB
// ============================================
function loadNASAMoon() {
    const loader = new GLTFLoader();
    const loadingEl = document.getElementById('loading-indicator');
    if (loadingEl) loadingEl.style.display = 'flex';

    loader.load('/assets/Moon_NASA_LRO_8k_Topo_Small.glb',
        (gltf) => {
            moonGlobe = gltf.scene;
            moonGlobe.scale.setScalar(MOON_RADIUS);
            moonGlobe.position.set(0, 0, 0);
            moonGlobe.traverse((child) => {
                if (child.isMesh) {
                    child.material.roughness = 0.92;
                    child.material.metalness = 0.0;
                    child.material.envMapIntensity = 0.1;
                }
            });
            scene.add(moonGlobe);
            if (loadingEl) loadingEl.style.display = 'none';
            // Show interactive onboarding instead of just orbit instruction
            showOnboarding();
            addCraterMarkers();
            console.log('NASA Moon + crater markers loaded');
        },
        (progress) => {
            const pct = progress.total ? Math.round(progress.loaded / progress.total * 100) : 0;
            const bar = document.getElementById('loading-bar-fill');
            const text = document.getElementById('loading-text');
            if (bar) bar.style.width = pct + '%';
            if (text) text.textContent = 'INITIALIZING LUNAR RECONNAISSANCE... ' + pct + '%';
        },
        (error) => {
            console.warn('Moon GLB failed:', error);
            if (loadingEl) loadingEl.style.display = 'none';
            document.getElementById('orbit-instruction').style.display = 'block';
            const geo = new THREE.SphereGeometry(MOON_RADIUS, 128, 128);
            const mat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.95 });
            moonGlobe = new THREE.Mesh(geo, mat);
            scene.add(moonGlobe);
            addCraterMarkers();
        }
    );
}

// ============================================
// CRATER MARKERS — PIN + CALLOUT CARD SYSTEM
// Small uniform dots on surface with HTML overlay
// labels connected by leader lines to avoid overlap
// ============================================
let craterOverlayContainer = null;

function addCraterMarkers() {
    craterMarkers = [];

    // Create HTML overlay container for callout cards
    if (!craterOverlayContainer) {
        craterOverlayContainer = document.createElement('div');
        craterOverlayContainer.id = 'crater-overlay';
        craterOverlayContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:50;pointer-events:none;';
        document.body.appendChild(craterOverlayContainer);

        // SVG layer for leader lines
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.id = 'crater-leader-lines';
        svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
        craterOverlayContainer.appendChild(svg);
    }

    // Calculate non-overlapping label offsets — spread cards evenly around a circle
    const cardOffsets = computeCardOffsets(CRATERS.length);

    for (let i = 0; i < CRATERS.length; i++) {
        const crater = CRATERS[i];
        const pos3 = latLonToVector3(crater.lat, crater.lon, MOON_RADIUS * 1.01);
        const normal = latLonToNormal(crater.lat, crater.lon);
        const group = new THREE.Group();
        group.position.set(pos3.x, pos3.y, pos3.z);
        const lookTarget = new THREE.Vector3(
            pos3.x + normal.x * 100, pos3.y + normal.y * 100, pos3.z + normal.z * 100
        );
        group.lookAt(lookTarget);
        const color = new THREE.Color(difficultyColor(crater.difficulty));

        // Small uniform pin dot (same size for all craters)
        const PIN_SIZE = 5;
        const dotGeo = new THREE.CircleGeometry(PIN_SIZE, 16);
        const dotMat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
        });
        const ring = new THREE.Mesh(dotGeo, dotMat);
        group.add(ring);

        // Outer pulse ring (small, uniform)
        const pulseGeo = new THREE.RingGeometry(PIN_SIZE * 1.3, PIN_SIZE * 1.8, 24);
        const pulseMat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false
        });
        const pulseRing = new THREE.Mesh(pulseGeo, pulseMat);
        group.add(pulseRing);

        // Invisible hitbox — uniform size for all craters (20 radius)
        const hitGeo = new THREE.SphereGeometry(20, 8, 8);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitbox = new THREE.Mesh(hitGeo, hitMat);
        group.add(hitbox);

        scene.add(group);

        // Create HTML callout card
        const hexColor = '#' + color.getHex().toString(16).padStart(6, '0');
        const card = document.createElement('div');
        card.className = 'crater-callout';
        card.style.cssText = 'pointer-events:auto;cursor:pointer;';
        card.dataset.craterIndex = i;
        card.innerHTML = `
            <div class="callout-pip" style="background:${hexColor}"></div>
            <div class="callout-body">
                <div class="callout-name" style="color:${hexColor}">${crater.name}</div>
                <div class="callout-meta">${crater.diameter_km} km · ${crater.difficulty}</div>
            </div>
        `;
        card.addEventListener('click', () => selectCrater(crater));
        card.addEventListener('mouseenter', () => {
            card.classList.add('hovered');
            ring.material.opacity = 1.0;
            pulseRing.material.opacity = 0.8;
        });
        card.addEventListener('mouseleave', () => {
            card.classList.remove('hovered');
            ring.material.opacity = 0.9;
            pulseRing.material.opacity = 0.35;
        });
        craterOverlayContainer.appendChild(card);

        craterMarkers.push({
            mesh: group,
            ring,
            pulseRing,
            hitbox,
            label: null,
            crater,
            card,
            cardOffset: cardOffsets[i],
            worldPos: new THREE.Vector3(pos3.x, pos3.y, pos3.z),
        });
    }
}

function computeCardOffsets(count) {
    // Spread label cards in a fan pattern — each gets a unique angle
    // Cards offset radially 120-180px from projected pin position
    const offsets = [];
    const baseAngle = -Math.PI / 2; // start from top
    const spread = Math.PI * 1.6; // use 290° arc
    for (let i = 0; i < count; i++) {
        const angle = baseAngle + (spread * i) / (count - 1 || 1);
        const dist = 110 + (i % 2) * 40; // alternate near/far for separation
        offsets.push({
            dx: Math.cos(angle) * dist,
            dy: Math.sin(angle) * dist,
        });
    }
    return offsets;
}

function updateCraterOverlays() {
    // Project 3D pin positions to 2D screen and position HTML cards + leader lines
    if (!craterOverlayContainer || currentState === AppState.SIMULATION || currentState === AppState.ZOOMING) {
        if (craterOverlayContainer) craterOverlayContainer.style.display = 'none';
        return;
    }
    craterOverlayContainer.style.display = '';

    const svg = document.getElementById('crater-leader-lines');
    if (svg) svg.innerHTML = ''; // clear old lines

    const w = window.innerWidth;
    const h = window.innerHeight;

    for (const m of craterMarkers) {
        // Project world position to screen
        const projected = m.worldPos.clone().project(camera);
        const sx = (projected.x * 0.5 + 0.5) * w;
        const sy = (-projected.y * 0.5 + 0.5) * h;

        // Check if behind camera
        const behind = projected.z > 1;

        if (behind || sx < -100 || sx > w + 100 || sy < -100 || sy > h + 100) {
            m.card.style.display = 'none';
            continue;
        }

        m.card.style.display = '';

        // Card position = pin position + offset
        const cx = sx + m.cardOffset.dx;
        const cy = sy + m.cardOffset.dy;
        m.card.style.transform = `translate(${cx}px, ${cy}px)`;

        // Draw leader line (SVG)
        if (svg) {
            const svgNS = 'http://www.w3.org/2000/svg';
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', sx);
            line.setAttribute('y1', sy);
            line.setAttribute('x2', cx + 6);
            line.setAttribute('y2', cy + 10);
            const hexColor = m.card.querySelector('.callout-pip')?.style.background || '#4a9eff';
            line.setAttribute('stroke', hexColor);
            line.setAttribute('stroke-width', '1');
            line.setAttribute('stroke-opacity', '0.4');
            line.setAttribute('stroke-dasharray', '4 3');
            svg.appendChild(line);

            // Small dot at pin end
            const dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('cx', sx);
            dot.setAttribute('cy', sy);
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', hexColor);
            dot.setAttribute('fill-opacity', '0.6');
            svg.appendChild(dot);
        }
    }
}

function createTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
    ctx.textAlign = 'center';
    ctx.fillText(text, 256, 70);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.7 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(60, 15, 1);
    return sprite;
}

// ============================================
// CRATER SELECTION -> CONFIG PANEL
// ============================================
function selectCrater(crater) {
    selectedCrater = crater;
    missionConfig.craterId = crater.id;
    missionConfig.diameter_m = crater.diameter_km * 1000;
    missionConfig.depth_m = crater.depth_km * 1000;
    document.getElementById('config-crater-name').textContent = crater.name;
    document.getElementById('config-crater-desc').textContent = crater.description;
    document.getElementById('config-crater-diameter').textContent = crater.diameter_km + ' km';
    document.getElementById('config-crater-depth').textContent = crater.depth_km + ' km';
    document.getElementById('config-crater-difficulty').textContent = crater.difficulty;
    document.getElementById('config-crater-difficulty').style.color = difficultyColor(crater.difficulty);
    document.getElementById('config-crater-science').textContent = crater.science;

    const featList = document.getElementById('config-crater-features');
    featList.innerHTML = '';
    crater.features.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        featList.appendChild(li);
    });

    document.getElementById('config-panel').classList.add('visible');
    document.getElementById('orbit-instruction').style.display = 'none';
    currentState = AppState.CONFIG;

    const viewPos = latLonToVector3(crater.lat, crater.lon, MOON_RADIUS * 2.8);
    animateCameraTo(viewPos.x, viewPos.y, viewPos.z, 0, 0, 0, 1.5);
}

function animateCameraTo(x, y, z, tx, ty, tz, duration) {
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPos = new THREE.Vector3(x, y, z);
    const endTarget = new THREE.Vector3(tx, ty, tz);
    const t0 = clock.getElapsedTime();
    function step() {
        const t = Math.min((clock.getElapsedTime() - t0) / duration, 1);
        const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
        camera.position.lerpVectors(startPos, endPos, ease);
        controls.target.lerpVectors(startTarget, endTarget, ease);
        if (t < 1) requestAnimationFrame(step);
    }
    step();
}

// ============================================
// CONFIG PANEL HANDLERS
// ============================================
window.updateConfig = function(param, value) {
    missionConfig[param] = parseFloat(value);
    const display = document.getElementById('config-val-' + param);
    if (display) display.textContent = value;
    // When scenario changes, disable rover slider for swarm modes
    if (param === 'scenario') {
        missionConfig.scenario = value;
        const sc = SCENARIOS[value];
        const roverSlider = document.getElementById('slider-numRovers');
        const roverLabel = document.getElementById('config-val-numRovers');
        if (sc && sc.modifiers && sc.modifiers.swarmMode) {
            if (roverSlider) { roverSlider.disabled = true; roverSlider.value = 15; }
            if (roverLabel) roverLabel.textContent = '15 (SWARM)';
        } else {
            if (roverSlider) roverSlider.disabled = false;
            if (roverLabel) roverLabel.textContent = roverSlider ? roverSlider.value : '3';
        }
    }
};

window.cancelConfig = function() {
    document.getElementById('config-panel').classList.remove('visible');
    currentState = AppState.ORBIT;
    document.getElementById('orbit-instruction').style.display = 'block';
    animateCameraTo(0, -1400, 1200, 0, -MOON_RADIUS * 0.85, 0, 1.0);
};

window.launchMission = function() {
    if (!selectedCrater) return;
    document.getElementById('config-panel').classList.remove('visible');
    missionConfig.numRovers = parseInt(document.getElementById('slider-numRovers').value);
    missionConfig.shadowSpeed = parseFloat(document.getElementById('slider-shadowSpeed').value);
    missionConfig.missionDuration = parseInt(document.getElementById('slider-missionDuration').value);
    missionConfig.initialBattery = parseInt(document.getElementById('slider-initialBattery').value);
    // Scenario selection
    const scenSelect = document.getElementById('select-scenario');
    if (scenSelect) missionConfig.scenario = scenSelect.value;
    // Swarm mode overrides
    const isSwarm = isSwarmMode();
    swarmMode = isSwarm;
    constructionMode = isConstructionMode();
    if (isSwarm) {
        missionConfig.numRovers = SWARM_COUNT;
    }
    startZoomTransition();
};

// ============================================
// GOOGLE EARTH-STYLE ZOOM TRANSITION
// ============================================
function startZoomTransition() {
    currentState = AppState.ZOOMING;
    controls.enabled = false;
    document.getElementById('orbit-instruction').style.display = 'none';

    const crater = selectedCrater;
    const surfacePos = latLonToVector3(crater.lat, crater.lon, MOON_RADIUS * 1.01);
    const norm = latLonToNormal(crater.lat, crater.lon);

    zoomStart = { pos: camera.position.clone(), target: controls.target.clone() };
    const viewDist = 600; // Larger for 3× terrain scale
    zoomEnd = {
        pos: new THREE.Vector3(
            surfacePos.x + norm.x * viewDist,
            surfacePos.y + norm.y * viewDist,
            surfacePos.z + norm.z * viewDist
        ),
        target: new THREE.Vector3(surfacePos.x, surfacePos.y, surfacePos.z),
    };
    zoomStartTime = clock.getElapsedTime();
    craterMarkers.forEach(m => {
        m.mesh.visible = false;
        if (m.card) m.card.style.display = 'none';
    });
    if (craterOverlayContainer) craterOverlayContainer.style.display = 'none';
}

function updateZoom(time) {
    const elapsed = time - zoomStartTime;
    let t = Math.min(elapsed / ZOOM_DURATION, 1);
    if (t < 0.25) {
        const sub = t / 0.25;
        const pullback = zoomStart.pos.clone().multiplyScalar(1.0 + sub * 0.08);
        camera.position.copy(pullback);
        const target = new THREE.Vector3().lerpVectors(zoomStart.target, zoomEnd.target, sub * 0.1);
        camera.lookAt(target);
    } else {
        const dive = (t - 0.25) / 0.75;
        const ease = dive * dive * (3 - 2 * dive);
        camera.position.lerpVectors(zoomStart.pos, zoomEnd.pos, ease);
        const target = new THREE.Vector3().lerpVectors(zoomStart.target, zoomEnd.target, 0.1 + ease * 0.9);
        camera.lookAt(target);
    }
    if (moonGlobe && t > 0.7) {
        const fade = (t - 0.7) / 0.3;
        moonGlobe.traverse(c => {
            if (c.isMesh) { c.material.opacity = 1 - fade; c.material.transparent = true; }
        });
    }
    if (t >= 1.0) transitionToSimulation();
}

// ============================================
// TRANSITION TO SIMULATION
// ============================================
function transitionToSimulation() {
    currentState = AppState.SIMULATION;
    if (moonGlobe) moonGlobe.visible = false;

    const craterRadius = selectedCrater.diameter_km * CRATER_SCALE;
    const craterDepth = selectedCrater.depth_km * DEPTH_SCALE;
    const effectiveDepth = constructionMode ? 5 : craterDepth;

    createLocalTerrain(craterRadius, effectiveDepth);
    createShadowOverlay(craterRadius);
    createDustParticles(craterRadius, effectiveDepth);

    camera.position.set(0, craterRadius * 0.5, craterRadius * 0.7);
    camera.lookAt(0, -effectiveDepth * 0.3, 0);
    controls.target.set(0, -effectiveDepth * 0.3, 0);
    controls.enabled = true;
    controls.minDistance = 20;
    controls.maxDistance = craterRadius * 2;

    initRoverStates(craterRadius);
    createRovers(craterRadius, effectiveDepth);

    // Frontier technique overlays
    if (!constructionMode) {
        generateIceDeposits(craterRadius, effectiveDepth);
        createIceMarkers(craterRadius, effectiveDepth);
    }
    createCommsMesh();
    createVoronoiOverlay(craterRadius);
    if (constructionMode) {
        initLandingPadConstruction(craterRadius, effectiveDepth);
    }

    document.getElementById('rover-strip').style.display = '';
    document.getElementById('side-panel').style.display = '';
    document.getElementById('bottom-bar').style.display = '';
    document.getElementById('sim-controls').style.display = 'flex';
    document.getElementById('minimap-container').style.display = 'block';
    if (document.getElementById('nvidia-panel')) document.getElementById('nvidia-panel').style.display = '';
    initHUD();
    initViewTabs();
    initMinimap();
    initMissionGoals();

    // Show scenario badge
    const scenBadge = document.getElementById('mission-scenario-badge');
    if (scenBadge && missionConfig.scenario) {
        const sc = SCENARIOS[missionConfig.scenario] || SCENARIOS.exploration;
        scenBadge.textContent = sc.name.toUpperCase();
        scenBadge.style.display = '';
    }

    missionStartTime = Date.now();
    missionActive = true;
    connectWebSockets();

    // Apply scenario modifiers and shadow speed
    const sc = SCENARIOS[missionConfig.scenario] || SCENARIOS.exploration;
    missionConfig.shadowSpeed = sc.shadowSpeed;
    missionConfig.initialBattery = sc.initialBattery;

    fetch('/api/start-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(missionConfig),
    }).catch(e => addLogEntry('danger', 'Backend error: ' + e.message));

    // Apply scenario after a short delay so rovers are initialized
    setTimeout(() => applyScenario(), 500);
}

// ============================================
// BACK TO MAP
// ============================================
window.backToMap = function() {
    missionActive = false;
    if (telemetryWs) try { telemetryWs.close(); } catch(e) {}
    if (negotiationWs) try { negotiationWs.close(); } catch(e) {}
    telemetryWs = null; negotiationWs = null;

    // Remove simulation objects
    if (localTerrain) { scene.remove(localTerrain); localTerrain = null; }
    if (shadowMesh) { scene.remove(shadowMesh); shadowMesh = null; }
    if (dustParticles) { scene.remove(dustParticles); dustParticles = null; }
    if (commsMesh) { scene.remove(commsMesh); commsMesh = null; }
    if (voronoiLines) { scene.remove(voronoiLines); voronoiLines = null; }
    for (const dep of iceDeposits) {
        if (dep._marker) scene.remove(dep._marker);
        if (dep._ring) scene.remove(dep._ring);
    }
    iceDeposits = [];
    // Clean up construction objects
    for (const mesh of padTileMeshes) scene.remove(mesh);
    padTileMeshes = [];
    padTiles = [];
    if (padOutlineMesh) { scene.remove(padOutlineMesh); padOutlineMesh = null; }
    if (padGlowRing) { scene.remove(padGlowRing); padGlowRing = null; }
    if (padHexMeshGroup) { scene.remove(padHexMeshGroup); padHexMeshGroup = null; }
    for (const mesh of collectionZoneMeshes) scene.remove(mesh);
    collectionZoneMeshes = [];
    collectionZones = [];
    padProgress = 0;
    padPhase = 'survey';
    padPhaseIndex = 0;
    padPhaseTime = 0;
    padTotalTime = 0;
    swarmMode = false;
    constructionMode = false;
    for (const id of Object.keys(roverMeshes)) {
        scene.remove(roverMeshes[id]);
        if (roverTrails[id]) scene.remove(roverTrails[id].line);
    }
    roverMeshes = {}; roverTrails = {}; roverStates = {};

    // Restore moon
    if (moonGlobe) {
        moonGlobe.visible = true;
        moonGlobe.traverse(c => {
            if (c.isMesh) { c.material.opacity = 1; c.material.transparent = false; }
        });
    }
    craterMarkers.forEach(m => {
        m.mesh.visible = true;
        if (m.card) m.card.style.display = '';
    });
    if (craterOverlayContainer) craterOverlayContainer.style.display = '';

    // Reset camera
    camera.position.set(0, -1400, 1200);
    controls.target.set(0, -MOON_RADIUS * 0.85, 0);
    controls.minDistance = 900;
    controls.maxDistance = 5000;
    controls.enabled = true;

    // Reset HUD
    document.getElementById('rover-strip').style.display = 'none';
    document.getElementById('side-panel').style.display = 'none';
    document.getElementById('bottom-bar').style.display = 'none';
    document.getElementById('sim-controls').style.display = 'none';
    document.getElementById('minimap-container').style.display = 'none';
    if (document.getElementById('pov-hud')) document.getElementById('pov-hud').style.display = 'none';
    if (document.getElementById('post-mission')) document.getElementById('post-mission').style.display = 'none';
    if (document.getElementById('mission-goals')) document.getElementById('mission-goals').style.display = 'none';
    if (document.getElementById('nvidia-panel')) document.getElementById('nvidia-panel').style.display = 'none';
    const scenBadge = document.getElementById('mission-scenario-badge');
    if (scenBadge) scenBadge.style.display = 'none';
    povRoverId = null;
    nemotronHistory = [];
    totalAIDecisions = 0;
    if (heatmapMesh) { heatmapMesh.visible = false; heatmapVisible = false; }
    document.getElementById('orbit-instruction').style.display = 'block';
    document.getElementById('mission-title').textContent = 'PROJECT REGOLITH';
    document.getElementById('mission-clock').textContent = 'T+ 00:00:00';
    document.getElementById('mission-status').textContent = 'AWAITING LAUNCH';
    document.getElementById('mission-status').className = 'status-idle';
    document.getElementById('negotiation-log').innerHTML = '';

    currentState = AppState.ORBIT;
    selectedCrater = null;
    simSpeed = 1;
    updateSpeedDisplay();
};

// ============================================
// SPEED CONTROL
// ============================================
window.setSimSpeed = function(s) {
    simSpeed = s;
    updateSpeedDisplay();
};

function updateSpeedDisplay() {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('speed-' + simSpeed + 'x');
    if (btn) btn.classList.add('active');
}

// ============================================
// MISSION BRIEF PANEL
// ============================================
window.toggleMissionBrief = function() {
    const panel = document.getElementById('mission-brief-panel');
    panel.classList.toggle('visible');
};

// ============================================
// LOCAL TERRAIN (GLSL)
// ============================================
function createLocalTerrain(craterRadius, craterDepth) {
    const geo = new THREE.PlaneGeometry(craterRadius * 2.5, craterRadius * 2.5, 511, 511);
    geo.rotateX(-Math.PI / 2);
    craterMaterial = new THREE.ShaderMaterial({
        vertexShader: craterVertexShader,
        fragmentShader: craterFragmentShader,
        uniforms: {
            uCraterRadius: { value: craterRadius },
            uCraterDepth: { value: craterDepth },
            uTime: { value: 0 },
            uSunDirection: { value: SUN_DIR },
            uSunColor: { value: new THREE.Color(1.0, 0.95, 0.88) },
            uSunIntensity: { value: 2.5 },
            uShadowBoundaryX: { value: -craterRadius },
            uCameraPosition: { value: camera.position },
        },
    });
    localTerrain = new THREE.Mesh(geo, craterMaterial);
    localTerrain.receiveShadow = true;
    scene.add(localTerrain);
}

// ---- Terrain noise functions (matching GLSL craterHeightGLSL exactly) ----
// Hash: matches GLSL fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123)
function _thash(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
}

// 2D value noise with smoothstep interpolation (matches GLSL noise())
function _tnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = _thash(ix, iy), b = _thash(ix + 1, iy);
    const c = _thash(ix, iy + 1), d = _thash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Fractal Brownian Motion — 4 octaves (matches GLSL vertex shader fbm)
function _tfbm(x, y) {
    let value = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < 4; i++) {
        value += amp * _tnoise(x * freq, y * freq);
        freq *= 2.17; amp *= 0.48;
    }
    return value;
}

function craterHeight(x, z) {
    if (!selectedCrater) return 0;
    const R = selectedCrater.diameter_km * CRATER_SCALE;
    const D = selectedCrater.depth_km * DEPTH_SCALE;
    const r = Math.sqrt(x * x + z * z);

    // Main bowl (Gaussian depression)
    const sigma = R * 0.45;
    let h = -D * Math.exp(-(r * r) / (2 * sigma * sigma));

    // Rim uplift
    const rimSigma = R * 0.15;
    const rimCenter = R * 0.85;
    const rimDist = r - rimCenter;
    h += 12 * Math.exp(-(rimDist * rimDist) / (2 * rimSigma * rimSigma));

    // Multi-scale FBM roughness (matches GLSL vertex shader exactly)
    h += 3.0 * _tfbm(x * 0.02, z * 0.02);
    h += 1.5 * _tfbm(x * 0.05 + 17.3, z * 0.05 + 17.3);
    h += 0.8 * _tfbm(x * 0.12 + 42.7, z * 0.12 + 42.7);

    // Scattered boulders
    const bn = _tnoise(x * 0.008, z * 0.008);
    if (bn > 0.72) {
        const bh = (bn - 0.72) * 25.0;
        const t = Math.max(0, Math.min(1, (bn - 0.72) / 0.13));
        h += bh * t * t * (3 - 2 * t); // smoothstep
    }

    // Small craterlets (3, matching GLSL)
    for (let i = 0; i < 3; i++) {
        const cx = _thash(i * 13.7, 7.3) * R * 1.4 - R * 0.7;
        const cz = _thash(i * 23.1, 3.1) * R * 1.4 - R * 0.7;
        const cr = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
        const cSize = 10 + _thash(i, 0) * 20;
        const cSigma = cSize * 0.4;
        h -= (cSize * 0.3) * Math.exp(-(cr * cr) / (2 * cSigma * cSigma));
    }

    return h;
}

// ============================================
// SHADOW OVERLAY
// ============================================
function createShadowOverlay(craterRadius) {
    const geo = new THREE.PlaneGeometry(craterRadius * 3, craterRadius * 3, 1, 64);
    geo.rotateX(-Math.PI / 2);
    shadowMaterial = new THREE.ShaderMaterial({
        vertexShader: shadowVertexShader,
        fragmentShader: shadowFragmentShader,
        uniforms: { uShadowBoundaryX: { value: -craterRadius }, uTime: { value: 0 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    shadowMesh = new THREE.Mesh(geo, shadowMaterial);
    shadowMesh.position.y = 3;
    shadowMesh.renderOrder = 2;
    scene.add(shadowMesh);
}

function updateShadow(bx) {
    shadowBoundaryX = bx;
    if (craterMaterial) craterMaterial.uniforms.uShadowBoundaryX.value = bx;
    if (shadowMaterial) shadowMaterial.uniforms.uShadowBoundaryX.value = bx;
}

// ============================================
// DUST PARTICLES
// ============================================
function createDustParticles(craterRadius, craterDepth) {
    const COUNT = 400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const alphas = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * craterRadius * 0.7;
        pos[i*3] = Math.cos(a) * d;
        pos[i*3+1] = -craterDepth * 0.5 + Math.random() * craterDepth * 0.3;
        pos[i*3+2] = Math.sin(a) * d;
        sizes[i] = 1.0 + Math.random() * 3.0;
        alphas[i] = 0.1 + Math.random() * 0.25;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    dustParticles = new THREE.Points(geo, new THREE.ShaderMaterial({
        vertexShader: dustVertexShader, fragmentShader: dustFragmentShader,
        uniforms: { uTime: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    scene.add(dustParticles);
}

// ============================================
// ROVERS (dynamic count)
// ============================================
function initRoverStates(craterRadius) {
    const R = craterRadius * 0.3;
    const rovers = activeRovers();
    roverStates = {};
    const angleStep = (Math.PI * 2) / rovers.length;
    rovers.forEach((r, i) => {
        const a = angleStep * i + Math.PI * 0.25;
        roverStates[r.id] = {
            x: Math.cos(a) * R * (0.5 + Math.random() * 0.4),
            z: Math.sin(a) * R * (0.5 + Math.random() * 0.4),
            battery: missionConfig.initialBattery,
            sensor_health: 100,
            in_shadow: false,
            task: 'EXPLORING',
            vx: 0, vz: 0,
            // Local sim — randomized patrol target
            _tx: (Math.random() - 0.5) * craterRadius * 0.8,
            _tz: (Math.random() - 0.5) * craterRadius * 0.8,
            _retargetTime: 0,
        };
    });
}

function createRoverMesh(color, name) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(5, 2.5, 7),
        new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.65, emissive: color, emissiveIntensity: 0.2 })
    );
    body.castShadow = true; body.position.y = 2;
    group.add(body);

    const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(6, 0.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 })
    );
    chassis.position.set(0, 0.5, 0);
    group.add(chassis);

    const ant = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.18, 5, 8),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9 })
    );
    ant.position.set(0, 5.5, -2);
    group.add(ant);

    const tipMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), tipMat);
    tip.position.set(0, 8.2, -2);
    group.add(tip);
    group.userData.tip = tip;

    const wGeo = new THREE.CylinderGeometry(1, 1, 0.8, 16);
    wGeo.rotateZ(Math.PI / 2);
    const wMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
    [[-3.2,0.7,-3],[3.2,0.7,-3],[-3.2,0.7,0],[3.2,0.7,0],[-3.2,0.7,3],[3.2,0.7,3]].forEach(p => {
        const w = new THREE.Mesh(wGeo, wMat); w.position.set(...p); w.castShadow = true; group.add(w);
    });

    const panel = new THREE.Mesh(
        new THREE.BoxGeometry(9, 0.08, 4.5),
        new THREE.MeshStandardMaterial({ color: 0x0a2a5a, roughness: 0.15, metalness: 0.85 })
    );
    panel.position.set(0, 3.8, 1); panel.rotation.x = -0.1;
    group.add(panel);

    const headlight = new THREE.PointLight(color, 1.2, 120, 2); // Extended range for scaled rovers
    headlight.position.set(0, 2, 4); group.add(headlight);
    group.userData.headlight = headlight;

    const dGeo = new THREE.RingGeometry(6, 8, 32); dGeo.rotateX(-Math.PI / 2);
    const dangerRing = new THREE.Mesh(dGeo, new THREE.MeshBasicMaterial({
        color: 0xff0000, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
    }));
    dangerRing.position.y = 0.5; group.add(dangerRing);
    group.userData.dangerRing = dangerRing;

    if (!swarmMode) {
        const label = createTextSprite(name, color);
        label.position.set(0, 48, 0);
        label.scale.set(240, 60, 1);
        group.add(label);
    }

    if (swarmMode) return group;

    // Vertical beacon for long-range visibility
    const beaconGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 10, 0),
        new THREE.Vector3(0, 140, 0)
    ]);
    const beaconMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 });
    const beacon = new THREE.Line(beaconGeo, beaconMat);
    group.add(beacon);

    const beaconTip = new THREE.Mesh(
        new THREE.SphereGeometry(2, 8, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 })
    );
    beaconTip.position.set(0, 140, 0);
    group.add(beaconTip);
    group.userData.beaconTip = beaconTip;

    return group;
}

function createRovers(craterRadius, craterDepth) {
    const rovers = activeRovers();
    roverMeshes = {};
    roverTrails = {};
    for (const r of rovers) {
        const group = createRoverMesh(r.color, r.name);
        group.scale.setScalar(swarmMode ? ROVER_MESH_SCALE * 0.7 : ROVER_MESH_SCALE);
        const state = roverStates[r.id];
        group.position.set(state.x, craterHeight(state.x, state.z) + 2, state.z);
        scene.add(group);
        roverMeshes[r.id] = group;

        const tGeo = new THREE.BufferGeometry();
        tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3000 * 3), 3));
        tGeo.setDrawRange(0, 0);
        const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ color: r.color, transparent: true, opacity: 0.5 }));
        scene.add(trail);
        roverTrails[r.id] = { line: trail, count: 0 };
    }
}

// ============================================
// LOCAL ROVER SIMULATION — FRONTIER TECHNIQUES
// Implements: Voronoi partitioning, potential field
// navigation, cooperative relay, formation control,
// and ice deposit discovery
// References:
//   Cortés et al. (2004) "Coverage Control for Mobile Sensing Networks"
//   Khatib (1986) "Real-Time Obstacle Avoidance for Manipulators"
//   Olfati-Saber (2006) "Flocking for Multi-Agent Dynamic Systems"
//   Dias et al. (2006) "Market-Based Multirobot Coordination"
// ============================================

// Ice deposit locations (discovered during sim)
let iceDeposits = [];
let commsMesh = null;
let voronoiLines = null;
let potentialFieldArrows = [];

function generateIceDeposits(craterRadius, craterDepth) {
    // Place ice deposits in permanently shadowed zones (negative X = shadow side)
    iceDeposits = [];
    const numDeposits = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numDeposits; i++) {
        const x = -craterRadius * (0.2 + Math.random() * 0.5); // in shadow zone
        const z = (Math.random() - 0.5) * craterRadius * 0.8;
        const richness = 0.3 + Math.random() * 0.7; // 0-1 ice concentration
        iceDeposits.push({ x, z, richness, discovered: false, discoveredBy: null });
    }
    // Also add a few near the shadow boundary (high-value targets)
    for (let i = 0; i < 2; i++) {
        const x = -craterRadius * 0.1 + Math.random() * craterRadius * 0.15;
        const z = (Math.random() - 0.5) * craterRadius * 0.6;
        iceDeposits.push({ x, z, richness: 0.8 + Math.random() * 0.2, discovered: false, discoveredBy: null });
    }
    return iceDeposits;
}

function createIceMarkers(craterRadius, craterDepth) {
    // Visual markers for ice deposits (appear when discovered)
    iceDeposits.forEach((dep, i) => {
        const y = craterHeight(dep.x, dep.z) + 0.5;
        // Diamond-shaped marker
        const geo = new THREE.OctahedronGeometry(2 + dep.richness * 3, 0);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x00ccff, emissive: 0x0066aa, emissiveIntensity: 0.8,
            transparent: true, opacity: 0, roughness: 0.1, metalness: 0.9
        });
        const marker = new THREE.Mesh(geo, mat);
        marker.position.set(dep.x, y + 3, dep.z);
        marker.userData.deposit = dep;
        marker.userData.depositIndex = i;
        scene.add(marker);
        dep._marker = marker;

        // Glow ring on ground
        const ringGeo = new THREE.RingGeometry(3, 5 + dep.richness * 4, 24);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00ccff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(dep.x, y + 0.5, dep.z);
        scene.add(ring);
        dep._ring = ring;
    });
}

function createCommsMesh() {
    // Communication links between rovers (drawn as glowing lines)
    const maxLinks = swarmMode ? 120 : 15; // max rover pairs (15 choose 2 = 105)
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxLinks * 2 * 3); // 2 vertices per line
    const colors = new Float32Array(maxLinks * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    commsMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.6, linewidth: 1
    }));
    commsMesh.renderOrder = 5;
    scene.add(commsMesh);
}

function createVoronoiOverlay(craterRadius) {
    // Voronoi boundary lines showing area partitioning
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((swarmMode ? 6000 : 2000) * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    voronoiLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: 0x4a9eff, transparent: true, opacity: 0.15, linewidth: 1
    }));
    voronoiLines.renderOrder = 4;
    scene.add(voronoiLines);
}

// ---- Potential Field Navigation (Khatib 1986) ----
function computePotentialField(state, allStates, craterRadius, time) {
    // Returns force vector [fx, fz] from superposition of:
    // 1. Attractive: goal point (exploration frontier / ice deposit)
    // 2. Repulsive: shadow boundary, other rovers, crater walls
    // 3. Formation: maintain communication distance (Olfati-Saber 2006)

    let fx = 0, fz = 0;
    const K_ATTRACT = 0.8;
    const K_REPULSE_SHADOW = 2.5;
    const K_REPULSE_ROVER = 1.2;
    const K_REPULSE_WALL = 1.5;
    const K_FORMATION = 0.4;
    const COMM_RANGE = craterRadius * 0.6;
    const DESIRED_SPACING = craterRadius * 0.25;

    // --- Attractive force toward exploration target ---
    const dx = state._tx - state.x;
    const dz = state._tz - state.z;
    const distToGoal = Math.sqrt(dx * dx + dz * dz);
    if (distToGoal > 2) {
        fx += K_ATTRACT * (dx / distToGoal);
        fz += K_ATTRACT * (dz / distToGoal);
    }

    // --- Repulsive force from shadow boundary ---
    const distToShadow = state.x - shadowBoundaryX;
    if (distToShadow < craterRadius * 0.3) {
        const strength = K_REPULSE_SHADOW * Math.exp(-distToShadow / (craterRadius * 0.1));
        fx += strength; // push toward +X (away from shadow)
    }

    // --- Repulsive force from other rovers (collision avoidance) ---
    for (const [otherId, otherState] of Object.entries(allStates)) {
        if (otherId === state._id) continue;
        const ox = state.x - otherState.x;
        const oz = state.z - otherState.z;
        const oDist = Math.sqrt(ox * ox + oz * oz);
        if (oDist < DESIRED_SPACING && oDist > 0.1) {
            const strength = K_REPULSE_ROVER * (1.0 - oDist / DESIRED_SPACING);
            fx += (ox / oDist) * strength;
            fz += (oz / oDist) * strength;
        }
    }

    // --- Formation force: maintain communication range (Olfati-Saber) ---
    for (const [otherId, otherState] of Object.entries(allStates)) {
        if (otherId === state._id) continue;
        const ox = otherState.x - state.x;
        const oz = otherState.z - state.z;
        const oDist = Math.sqrt(ox * ox + oz * oz);
        // If too far from any teammate, pull toward them
        if (oDist > COMM_RANGE * 0.8 && oDist > 0.1) {
            const strength = K_FORMATION * ((oDist - COMM_RANGE * 0.8) / COMM_RANGE);
            fx += (ox / oDist) * strength;
            fz += (oz / oDist) * strength;
        }
    }

    // --- Repulsive force from crater walls ---
    const r = Math.sqrt(state.x * state.x + state.z * state.z);
    if (r > craterRadius * 0.8) {
        const wallDist = craterRadius - r;
        const strength = K_REPULSE_WALL * Math.exp(-wallDist / (craterRadius * 0.1));
        fx -= (state.x / r) * strength;
        fz -= (state.z / r) * strength;
    }

    return { fx, fz };
}

// ---- Voronoi-Based Coverage Control (Cortés et al. 2004) ----
function computeVoronoiTarget(state, allStates, craterRadius) {
    // Compute approximate Voronoi centroid for this rover's cell
    // Weighted by science value (ice deposits, unexplored terrain)
    const GRID = 12;
    const step = craterRadius * 2 / GRID;
    let cx = 0, cz = 0, totalWeight = 0;

    for (let gi = 0; gi < GRID; gi++) {
        for (let gj = 0; gj < GRID; gj++) {
            const px = -craterRadius + (gi + 0.5) * step;
            const pz = -craterRadius + (gj + 0.5) * step;

            // Skip points outside crater
            if (px * px + pz * pz > craterRadius * craterRadius * 0.85) continue;
            // Skip deeply shadowed points
            if (px < shadowBoundaryX - craterRadius * 0.1) continue;

            // Check if this point is closest to this rover (Voronoi cell)
            let closestId = null;
            let closestDist = Infinity;
            for (const [id, s] of Object.entries(allStates)) {
                const d = (s.x - px) ** 2 + (s.z - pz) ** 2;
                if (d < closestDist) { closestDist = d; closestId = id; }
            }
            if (closestId !== state._id) continue;

            // Weight: higher for unexplored, near ice deposits, near shadow boundary
            let weight = 1.0;
            // Near shadow boundary = high science value (volatile access)
            const distToBoundary = Math.abs(px - shadowBoundaryX);
            if (distToBoundary < craterRadius * 0.2) weight += 2.0;
            // Near undiscovered ice deposits
            for (const dep of iceDeposits) {
                const dd = Math.sqrt((dep.x - px) ** 2 + (dep.z - pz) ** 2);
                if (dd < craterRadius * 0.15 && !dep.discovered) weight += 3.0 * dep.richness;
            }

            cx += px * weight;
            cz += pz * weight;
            totalWeight += weight;
        }
    }

    if (totalWeight > 0) {
        return { x: cx / totalWeight, z: cz / totalWeight };
    }
    // Fallback: random safe point
    return {
        x: craterRadius * 0.3 + Math.random() * craterRadius * 0.3,
        z: (Math.random() - 0.5) * craterRadius * 0.5,
    };
}

function tickLocalSim(dt) {
    const craterRadius = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 750;
    const speed = 4.5 * simSpeed;
    const drainRate = 0.05 * simSpeed;
    const shadowDrainMult = 5;
    const time = clock.getElapsedTime();
    const DISCOVERY_RANGE = 50;

    // Advance shadow
    shadowBoundaryX += missionConfig.shadowSpeed * dt * simSpeed * 0.3;
    updateShadow(shadowBoundaryX);

    // Tag each state with its ID for cross-referencing
    for (const [id, state] of Object.entries(roverStates)) {
        state._id = id;
    }

    for (const [id, state] of Object.entries(roverStates)) {
        // Check shadow
        state.in_shadow = state.x < shadowBoundaryX;

        // Battery drain
        const drain = drainRate * (state.in_shadow ? shadowDrainMult : 1) * dt;
        state.battery = Math.max(0, state.battery - drain);
        if (state.in_shadow) {
            state.sensor_health = Math.max(0, state.sensor_health - 0.3 * simSpeed * dt);
        }

        // === ICE DEPOSIT DISCOVERY ===
        for (const dep of iceDeposits) {
            if (!dep.discovered) {
                const dd = Math.sqrt((dep.x - state.x) ** 2 + (dep.z - state.z) ** 2);
                if (dd < DISCOVERY_RANGE) {
                    dep.discovered = true;
                    dep.discoveredBy = id;
                    // Animate marker appearance
                    if (dep._marker) dep._marker.material.opacity = 0.9;
                    if (dep._ring) dep._ring.material.opacity = 0.5;
                    addLogEntry('award', `<b>${id.toUpperCase()}</b> discovered ice deposit! Richness: ${(dep.richness * 100).toFixed(0)}%`);
                }
            }
        }

        // === RETARGET using Voronoi coverage + potential fields ===
        if (time > state._retargetTime) {
            state._retargetTime = time + 4 + Math.random() * 6;

            if (state.in_shadow || state.battery < 30) {
                // SURVIVAL MODE: flee shadow
                state._tx = craterRadius * 0.5 + Math.random() * craterRadius * 0.3;
                state._tz = (Math.random() - 0.5) * craterRadius * 0.5;
                state.task = state.in_shadow ? 'EVADING SHADOW' : 'LOW BATTERY — RTB';
                state._mode = 'survival';
            } else if (state.battery > 60) {
                // EXPLORATION MODE: Voronoi centroid targeting (Cortés 2004)
                const voronoiTarget = computeVoronoiTarget(state, roverStates, craterRadius);
                state._tx = voronoiTarget.x;
                state._tz = voronoiTarget.z;

                // Determine task based on position
                const distToShadow = state._tx - shadowBoundaryX;
                if (distToShadow < craterRadius * 0.2) {
                    state.task = 'SHADOW BOUNDARY SURVEY';
                } else {
                    const nearIce = iceDeposits.find(d => !d.discovered &&
                        Math.sqrt((d.x - state.x) ** 2 + (d.z - state.z) ** 2) < craterRadius * 0.3);
                    if (nearIce) {
                        state._tx = nearIce.x + (Math.random() - 0.5) * 20;
                        state._tz = nearIce.z + (Math.random() - 0.5) * 20;
                        state.task = 'ICE PROSPECTING';
                    } else {
                        const tasks = ['VORONOI COVERAGE', 'TERRAIN MAPPING', 'SPECTROMETRY', 'RELAY POSITIONING'];
                        state.task = tasks[Math.floor(Math.random() * tasks.length)];
                    }
                }
                state._mode = 'explore';
            } else {
                // CONSERVE MODE: minimize movement, stay in safe zone
                state._tx = Math.max(state.x, craterRadius * 0.2) + Math.random() * 30;
                state._tz = state.z + (Math.random() - 0.5) * 40;
                state.task = 'POWER CONSERVE';
                state._mode = 'conserve';
            }
        }

        // === MOVEMENT via Potential Field (Khatib 1986) ===
        const pf = computePotentialField(state, roverStates, craterRadius, time);
        const dx = state._tx - state.x;
        const dz = state._tz - state.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 2 && state.battery > 0) {
            const maxV = speed * (state.battery / 100);
            // Blend goal-directed + potential field forces
            const goalWeight = 0.6;
            const pfWeight = 0.4;
            const dirX = goalWeight * (dx / dist) + pfWeight * pf.fx;
            const dirZ = goalWeight * (dz / dist) + pfWeight * pf.fz;
            const mag = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
            state.vx = (dirX / mag) * maxV;
            state.vz = (dirZ / mag) * maxV;
            state.x += state.vx * dt;
            state.z += state.vz * dt;
        } else {
            state.vx *= 0.9;
            state.vz *= 0.9;
        }

        // Clamp to crater bounds
        const r = Math.sqrt(state.x * state.x + state.z * state.z);
        if (r > craterRadius * 0.95) {
            state.x *= (craterRadius * 0.9) / r;
            state.z *= (craterRadius * 0.9) / r;
        }
    }

    // === Update communications mesh ===
    updateCommsMesh(craterRadius);
    // === Update Voronoi overlay ===
    updateVoronoiOverlay(craterRadius);
    // === Update ice deposit animations ===
    updateIceDeposits(time);
}

function updateCommsMesh(craterRadius) {
    if (!commsMesh) return;
    const COMM_RANGE = craterRadius * 0.7;
    const positions = commsMesh.geometry.attributes.position.array;
    const colors = commsMesh.geometry.attributes.color.array;
    const ids = Object.keys(roverStates);
    let vertexIndex = 0;

    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const a = roverStates[ids[i]];
            const b = roverStates[ids[j]];
            const dist = Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
            if (dist < COMM_RANGE) {
                const ya = craterHeight(a.x, a.z) + 5;
                const yb = craterHeight(b.x, b.z) + 5;
                const idx = vertexIndex * 3;
                positions[idx] = a.x; positions[idx + 1] = ya; positions[idx + 2] = a.z;
                positions[idx + 3] = b.x; positions[idx + 4] = yb; positions[idx + 5] = b.z;

                // Color: green if strong signal, yellow if weak
                const strength = 1.0 - dist / COMM_RANGE;
                const r = 0.3 * (1 - strength) + 0.1;
                const g = 0.8 * strength + 0.3;
                const bl = 0.9;
                colors[idx] = r; colors[idx + 1] = g; colors[idx + 2] = bl;
                colors[idx + 3] = r; colors[idx + 4] = g; colors[idx + 5] = bl;
                vertexIndex += 2;
            }
        }
    }

    commsMesh.geometry.attributes.position.needsUpdate = true;
    commsMesh.geometry.attributes.color.needsUpdate = true;
    commsMesh.geometry.setDrawRange(0, vertexIndex);
}

function updateVoronoiOverlay(craterRadius) {
    if (!voronoiLines) return;
    const positions = voronoiLines.geometry.attributes.position.array;
    const ids = Object.keys(roverStates);
    if (ids.length < 2) return;

    let vertexIndex = 0;
    const GRID = 20;
    const step = craterRadius * 2 / GRID;

    // Sample grid points and draw edges where Voronoi cell boundaries are
    for (let gi = 0; gi < GRID; gi++) {
        for (let gj = 0; gj < GRID; gj++) {
            const px = -craterRadius + (gi + 0.5) * step;
            const pz = -craterRadius + (gj + 0.5) * step;
            if (px * px + pz * pz > craterRadius * craterRadius * 0.85) continue;

            // Find closest rover
            let closest = null, closestDist = Infinity;
            for (const id of ids) {
                const s = roverStates[id];
                const d = (s.x - px) ** 2 + (s.z - pz) ** 2;
                if (d < closestDist) { closestDist = d; closest = id; }
            }

            // Check right neighbor
            if (gi < GRID - 1) {
                const nx = -craterRadius + (gi + 1.5) * step;
                const nz = pz;
                if (nx * nx + nz * nz < craterRadius * craterRadius * 0.85) {
                    let nClosest = null, nClosestDist = Infinity;
                    for (const id of ids) {
                        const s = roverStates[id];
                        const d = (s.x - nx) ** 2 + (s.z - nz) ** 2;
                        if (d < nClosestDist) { nClosestDist = d; nClosest = id; }
                    }
                    if (closest !== nClosest && vertexIndex < (swarmMode ? 5998 : 1998)) {
                        const midX = (px + nx) / 2;
                        const y = craterHeight(midX, pz) + 2;
                        const idx = vertexIndex * 3;
                        positions[idx] = px; positions[idx + 1] = y; positions[idx + 2] = pz;
                        positions[idx + 3] = nx; positions[idx + 4] = y; positions[idx + 5] = nz;
                        vertexIndex += 2;
                    }
                }
            }

            // Check down neighbor
            if (gj < GRID - 1) {
                const nx = px;
                const nz = -craterRadius + (gj + 1.5) * step;
                if (nx * nx + nz * nz < craterRadius * craterRadius * 0.85) {
                    let nClosest = null, nClosestDist = Infinity;
                    for (const id of ids) {
                        const s = roverStates[id];
                        const d = (s.x - nx) ** 2 + (s.z - nz) ** 2;
                        if (d < nClosestDist) { nClosestDist = d; nClosest = id; }
                    }
                    if (closest !== nClosest && vertexIndex < (swarmMode ? 5998 : 1998)) {
                        const midZ = (pz + nz) / 2;
                        const y = craterHeight(px, midZ) + 2;
                        const idx = vertexIndex * 3;
                        positions[idx] = px; positions[idx + 1] = y; positions[idx + 2] = pz;
                        positions[idx + 3] = nx; positions[idx + 4] = y; positions[idx + 5] = nz;
                        vertexIndex += 2;
                    }
                }
            }
        }
    }

    voronoiLines.geometry.attributes.position.needsUpdate = true;
    voronoiLines.geometry.setDrawRange(0, vertexIndex);
}

function updateIceDeposits(time) {
    for (const dep of iceDeposits) {
        if (dep.discovered && dep._marker) {
            dep._marker.rotation.y = time * 1.5;
            dep._marker.position.y += Math.sin(time * 2 + dep.x) * 0.01;
        }
    }
}

// ============================================
// LANDING PAD CONSTRUCTION (ISRU Sintered Regolith)
// Phases: SURVEY → GRADE → COLLECT → SINTER → PLACE → VERIFY
// Based on NASA ISRU capability roadmap — microwave sintering
// of regolith at ~1100°C to form interlocking hex ceramic tiles.
// ============================================
const PAD_PHASES = ['SURVEY', 'GRADE', 'COLLECT', 'SINTER', 'PLACE', 'VERIFY'];
const PAD_PHASE_DURATION = [12, 18, 30, 40, 35, 10]; // seconds at 1× speed
let padTotalTime = 0;
let padPhaseIndex = 0;
let padPhaseTime = 0;
let padHexMeshGroup = null;
let padOutlineCircle = null;
let padGlowRing = null;
let sinterBeamMeshes = [];
let collectionMarkerMeshes = [];

function initLandingPadConstruction(craterRadius, craterDepth) {
    padPhaseIndex = 0;
    padPhaseTime = 0;
    padTotalTime = 0;
    padProgress = 0;
    padPhase = PAD_PHASES[0];
    padCenter = { x: 0, z: 0 };

    // Landing pad outline circle on terrain
    const outlineGeo = new THREE.RingGeometry(padTargetRadius - 1, padTargetRadius + 1, 64);
    outlineGeo.rotateX(-Math.PI / 2);
    const outlineMat = new THREE.MeshBasicMaterial({
        color: 0x4a9eff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false
    });
    padOutlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
    padOutlineMesh.position.set(padCenter.x, craterHeight(padCenter.x, padCenter.z) + 0.5, padCenter.z);
    padOutlineMesh.renderOrder = 3;
    scene.add(padOutlineMesh);

    // Pulsing glow ring
    const glowGeo = new THREE.RingGeometry(padTargetRadius + 2, padTargetRadius + 6, 64);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x4a9eff, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false
    });
    padGlowRing = new THREE.Mesh(glowGeo, glowMat);
    padGlowRing.position.copy(padOutlineMesh.position);
    padGlowRing.renderOrder = 2;
    scene.add(padGlowRing);

    // Generate hex tile layout (concentric rings)
    padHexMeshGroup = new THREE.Group();
    padHexMeshGroup.position.set(padCenter.x, craterHeight(padCenter.x, padCenter.z) + 0.3, padCenter.z);
    const hexSize = 6;
    const hexH = hexSize * Math.sqrt(3);
    padTiles = [];
    // Center tile
    padTiles.push({ q: 0, r: 0, x: 0, z: 0, placed: false, sintered: false });
    // Concentric hex rings
    for (let ring = 1; ring <= 7; ring++) {
        let hx = ring, hz = 0;
        const dirs = [[0,1],[-1,1],[-1,0],[0,-1],[1,-1],[1,0]];
        for (let d = 0; d < 6; d++) {
            for (let s = 0; s < ring; s++) {
                const cx = hx * hexSize * 1.5;
                const cz = (hx * 0.5 + hz) * hexH;
                const dist = Math.sqrt(cx * cx + cz * cz);
                if (dist < padTargetRadius - hexSize) {
                    padTiles.push({ q: hx, r: hz, x: cx, z: cz, placed: false, sintered: false });
                }
                hx += dirs[d][0];
                hz += dirs[d][1];
            }
        }
    }

    // Create hex tile meshes (invisible initially)
    const hexShape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = Math.cos(angle) * (hexSize * 0.92);
        const pz = Math.sin(angle) * (hexSize * 0.92);
        if (i === 0) hexShape.moveTo(px, pz);
        else hexShape.lineTo(px, pz);
    }
    hexShape.closePath();
    const hexExtrudeGeo = new THREE.ExtrudeGeometry(hexShape, { depth: 0.8, bevelEnabled: false });
    hexExtrudeGeo.rotateX(-Math.PI / 2);

    padTileMeshes = [];
    for (const tile of padTiles) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x8a7a6a, emissive: 0x221100, emissiveIntensity: 0,
            roughness: 0.7, metalness: 0.3, transparent: true, opacity: 0
        });
        const mesh = new THREE.Mesh(hexExtrudeGeo, mat);
        mesh.position.set(tile.x, 0, tile.z);
        mesh.userData.tile = tile;
        padHexMeshGroup.add(mesh);
        padTileMeshes.push(mesh);
    }
    scene.add(padHexMeshGroup);

    // Collection zones (4 zones around pad perimeter)
    collectionZones = [];
    collectionZoneMeshes = [];
    for (let i = 0; i < 4; i++) {
        const angle = (Math.PI / 2) * i + Math.PI / 4;
        const cx = Math.cos(angle) * (padTargetRadius + 30);
        const cz = Math.sin(angle) * (padTargetRadius + 30);
        collectionZones.push({ x: cx, z: cz, collected: 0, capacity: 25 });
        // visual marker
        const ringGeo = new THREE.RingGeometry(8, 12, 6);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xf0ad4e, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(cx, craterHeight(cx, cz) + 0.5, cz);
        ringMesh.renderOrder = 3;
        scene.add(ringMesh);
        collectionZoneMeshes.push(ringMesh);
    }

    addLogEntry('system', `<b>LANDING PAD CONSTRUCTION</b> initiated. Target radius: ${padTargetRadius}m. ${padTiles.length} hex tiles planned.`);
    addLogEntry('system', `<b>Phase 1: SURVEY</b> — Rovers scanning construction site topography.`);
    if (narratorEnabled) narrate('Landing pad construction has begun. Fifteen rovers will survey, grade, collect regolith, sinter tiles, and assemble the pad.');
}

function tickConstructionSim(dt) {
    const craterRadius = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 750;
    const speed = 3.5 * simSpeed;
    const drainRate = 0.03 * simSpeed;
    const time = clock.getElapsedTime();
    const scaledDt = dt * simSpeed;

    // Advance shadow (slower in construction mode)
    shadowBoundaryX += missionConfig.shadowSpeed * dt * simSpeed * 0.15;
    updateShadow(shadowBoundaryX);

    // Tag each state with its ID
    for (const [id, state] of Object.entries(roverStates)) { state._id = id; }

    // Advance construction phase timing
    padPhaseTime += scaledDt;
    padTotalTime += scaledDt;
    const totalPhaseTime = PAD_PHASE_DURATION.reduce((a,b) => a+b, 0);
    padProgress = Math.min(100, (padTotalTime / totalPhaseTime) * 100);

    // Check phase transitions
    if (padPhaseIndex < PAD_PHASES.length - 1 && padPhaseTime >= PAD_PHASE_DURATION[padPhaseIndex]) {
        padPhaseTime = 0;
        padPhaseIndex++;
        padPhase = PAD_PHASES[padPhaseIndex];
        addLogEntry('system', `<b>Phase ${padPhaseIndex + 1}: ${padPhase}</b> — ${getPhaseDescription(padPhaseIndex)}`);
        if (narratorEnabled) narrate(`Construction phase: ${padPhase}. ${getPhaseDescription(padPhaseIndex)}`);
    }

    // Update swarm HUD elements
    const el = id => document.getElementById(id);
    if (el('swarm-pad-progress')) el('swarm-pad-progress').textContent = padProgress.toFixed(0) + '%';
    if (el('swarm-phase')) el('swarm-phase').textContent = padPhase;

    // Determine tiles to reveal based on progress
    const tilesTarget = Math.floor((padProgress / 100) * padTiles.length);

    // Animate tile placement
    for (let i = 0; i < padTiles.length; i++) {
        const tile = padTiles[i];
        const mesh = padTileMeshes[i];
        if (!mesh) continue;

        if (i < tilesTarget && !tile.placed) {
            tile.placed = true;
            tile._animStart = time + (i % 8) * 0.08;
            tile._animBaseY = mesh.position.y;
        }
        // Animate tile appearing (no gsap dependency)
        if (tile.placed && tile._animStart !== undefined) {
            const elapsed = time - tile._animStart;
            if (elapsed >= 0) {
                // Fade in opacity over 0.6s
                mesh.material.opacity = Math.min(0.9, elapsed / 0.6 * 0.9);
                // Drop from +3 above with bounce easing over 0.5s
                if (elapsed < 0.5) {
                    const t = elapsed / 0.5;
                    // Simple bounce approximation
                    const bounce = t < 0.6 ? (t / 0.6) * (t / 0.6) : t < 0.8 ? 1 - (1 - t) * 4 * 0.3 + 0.7 : 1 - (1 - t) * 2 * 0.1 + 0.9;
                    const eased = Math.min(1, Math.max(0, bounce));
                    mesh.position.y = tile._animBaseY + 3 * (1 - eased);
                } else {
                    mesh.position.y = tile._animBaseY;
                    delete tile._animStart; // animation done
                }
            }
        }

        if (tile.placed && padPhaseIndex >= 3) { // SINTER phase
            // Glow effect during sintering
            const sinterProgress = Math.min(1, (padPhaseIndex - 3 + padPhaseTime / PAD_PHASE_DURATION[3]) / 2);
            mesh.material.emissiveIntensity = padPhaseIndex === 3 ?
                0.5 + Math.sin(time * 4 + i * 0.3) * 0.3 : sinterProgress * 0.1;
            mesh.material.color.setHex(padPhaseIndex >= 4 ? 0xa09080 : 0x8a7a6a);
            tile.sintered = padPhaseIndex >= 4;
        }
    }

    // Outline pulse
    if (padOutlineMesh) {
        padOutlineMesh.material.opacity = 0.3 + Math.sin(time * 2) * 0.2;
        const phaseColors = [0x4a9eff, 0x4a9eff, 0xf0ad4e, 0xff6b35, 0x00d47e, 0x76b900];
        padOutlineMesh.material.color.setHex(phaseColors[padPhaseIndex] || 0x4a9eff);
    }
    if (padGlowRing) {
        padGlowRing.material.opacity = 0.08 + Math.sin(time * 1.5) * 0.06;
        padGlowRing.scale.setScalar(1 + Math.sin(time * 1.2) * 0.03);
    }

    // Collection zone pulse in COLLECT phase
    if (padPhaseIndex === 2) {
        collectionZoneMeshes.forEach((m, i) => {
            m.material.opacity = 0.3 + Math.sin(time * 3 + i) * 0.2;
            collectionZones[i].collected = Math.min(collectionZones[i].capacity,
                collectionZones[i].collected + scaledDt * 0.8);
        });
    }

    // Rover movement — role-based behavior per phase
    for (const [id, state] of Object.entries(roverStates)) {
        state.in_shadow = state.x < shadowBoundaryX;
        const drain = drainRate * (state.in_shadow ? 4 : 1) * dt;
        state.battery = Math.max(0, state.battery - drain);

        // Phase-based tasking for construction
        if (time > state._retargetTime) {
            state._retargetTime = time + 2 + Math.random() * 3;
            assignConstructionTask(state, id, craterRadius, time);
        }

        // Movement using potential fields
        const pf = computePotentialField(state, roverStates, craterRadius, time);
        const dx = state._tx - state.x;
        const dz = state._tz - state.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 2 && state.battery > 0) {
            const maxV = speed * (state.battery / 100);
            const goalW = 0.65, pfW = 0.35;
            const dirX = goalW * (dx / dist) + pfW * pf.fx;
            const dirZ = goalW * (dz / dist) + pfW * pf.fz;
            const mag = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
            state.vx = (dirX / mag) * maxV;
            state.vz = (dirZ / mag) * maxV;
            state.x += state.vx * dt;
            state.z += state.vz * dt;
        } else {
            state.vx *= 0.9;
            state.vz *= 0.9;
        }

        // Clamp to crater
        const r = Math.sqrt(state.x * state.x + state.z * state.z);
        if (r > craterRadius * 0.95) {
            state.x *= (craterRadius * 0.9) / r;
            state.z *= (craterRadius * 0.9) / r;
        }
    }

    updateCommsMesh(craterRadius);
    updateVoronoiOverlay(craterRadius);

    // Construction completion check
    if (padProgress >= 100 && padPhase !== 'COMPLETE') {
        padPhase = 'COMPLETE';
        addLogEntry('award', `<b>LANDING PAD COMPLETE!</b> ${padTiles.length} sintered regolith hex tiles placed and verified. Pad integrity: 100%.`);
        if (narratorEnabled) narrate('Landing pad construction complete! All hexagonal regolith tiles have been sintered and verified. The pad is ready for future landings.');
        if (padOutlineMesh) padOutlineMesh.material.color.setHex(0x76b900);
    }
}

function assignConstructionTask(state, id, craterRadius, time) {
    const roverIdx = Object.keys(roverStates).indexOf(id);
    const phase = padPhaseIndex;

    if (state.in_shadow || state.battery < 20) {
        state._tx = craterRadius * 0.4 + Math.random() * 20;
        state._tz = (Math.random() - 0.5) * craterRadius * 0.3;
        state.task = state.in_shadow ? 'EVADING SHADOW' : 'LOW BATTERY — RTB';
        return;
    }

    switch(phase) {
        case 0: // SURVEY
            // Rovers spiral outward scanning terrain
            const surveyAngle = (roverIdx / 15) * Math.PI * 2 + time * 0.1;
            const surveyR = padTargetRadius * (0.3 + (time % 20) / 20 * 0.7);
            state._tx = padCenter.x + Math.cos(surveyAngle) * surveyR;
            state._tz = padCenter.z + Math.sin(surveyAngle) * surveyR;
            state.task = 'TOPO SURVEY — LIDAR';
            break;
        case 1: // GRADE
            // Rovers converge on pad area, grading surface
            const gradeAngle = (roverIdx / 15) * Math.PI * 2;
            const gradeR = padTargetRadius * 0.5 + Math.random() * padTargetRadius * 0.4;
            state._tx = padCenter.x + Math.cos(gradeAngle) * gradeR;
            state._tz = padCenter.z + Math.sin(gradeAngle) * gradeR;
            state.task = 'GRADING SURFACE';
            break;
        case 2: // COLLECT
            // Rovers shuttle between collection zones and pile points
            const zone = collectionZones[roverIdx % collectionZones.length];
            state._tx = zone.x + (Math.random() - 0.5) * 15;
            state._tz = zone.z + (Math.random() - 0.5) * 15;
            state.task = 'COLLECTING FEEDSTOCK';
            break;
        case 3: // SINTER
            // Rovers orbit pad perimeter, directing solar/microwave energy
            const sinterAngle = (roverIdx / 15) * Math.PI * 2 + time * 0.15;
            const sinterR = padTargetRadius * 0.7;
            state._tx = padCenter.x + Math.cos(sinterAngle) * sinterR;
            state._tz = padCenter.z + Math.sin(sinterAngle) * sinterR;
            state.task = 'SINTERING — 1100°C';
            break;
        case 4: // PLACE
            // Rovers pick up and place tiles from center outward
            const placeAngle = (roverIdx / 15) * Math.PI * 2 + time * 0.05;
            const placeR = padTargetRadius * (0.2 + padPhaseTime / PAD_PHASE_DURATION[4] * 0.6);
            state._tx = padCenter.x + Math.cos(placeAngle) * placeR;
            state._tz = padCenter.z + Math.sin(placeAngle) * placeR;
            state.task = 'PLACING HEX TILE';
            break;
        case 5: // VERIFY
            // Rovers scan completed pad
            const verifyAngle = (roverIdx / 15) * Math.PI * 2 + time * 0.2;
            state._tx = padCenter.x + Math.cos(verifyAngle) * padTargetRadius * 0.6;
            state._tz = padCenter.z + Math.sin(verifyAngle) * padTargetRadius * 0.6;
            state.task = 'INTEGRITY VERIFY';
            break;
    }
}

function getPhaseDescription(phaseIndex) {
    const descs = [
        'Rovers scanning construction site with LIDAR for topographic survey.',
        'Surface grading to create level foundation — removing loose regolith.',
        'Collecting regolith feedstock from surrounding terrain for sintering.',
        'Microwave sintering regolith at ~1100°C to form ceramic hex tiles.',
        'Placing interlocking hex tiles in concentric rings from center outward.',
        'Verifying pad surface integrity and structural compaction.'
    ];
    return descs[phaseIndex] || '';
}

function updateRovers(time) {
    for (const [id, state] of Object.entries(roverStates)) {
        const mesh = roverMeshes[id];
        if (!mesh) continue;
        const targetY = craterHeight(state.x, state.z) + 2;
        mesh.position.x += (state.x - mesh.position.x) * 0.18;
        mesh.position.z += (state.z - mesh.position.z) * 0.18;
        mesh.position.y += (targetY - mesh.position.y) * 0.25;
        if (Math.abs(state.vx) > 0.01 || Math.abs(state.vz) > 0.01) {
            const angle = Math.atan2(state.vx, state.vz);
            let diff = angle - mesh.rotation.y;
            while (diff > Math.PI) diff -= Math.PI*2;
            while (diff < -Math.PI) diff += Math.PI*2;
            mesh.rotation.y += diff * 0.08;
        }
        const dr = mesh.userData.dangerRing;
        if (dr) dr.material.opacity = state.in_shadow ? 0.3 + Math.sin(time * 5) * 0.2 : dr.material.opacity * 0.9;
        const tip = mesh.userData.tip;
        if (tip) tip.material.emissiveIntensity = state.in_shadow ? 2.5 : 0.8 + Math.sin(time * 3) * 0.4;
        const hl = mesh.userData.headlight;
        if (hl) hl.intensity = state.in_shadow ? 2.0 : 0.5;
        const bt = mesh.userData.beaconTip;
        if (bt) bt.material.opacity = 0.4 + Math.sin(time * 2 + state.x * 0.1) * 0.3;
        const trail = roverTrails[id];
        if (trail && trail.count < 3000) {
            const p = trail.line.geometry.attributes.position.array;
            const i = trail.count;
            p[i*3] = mesh.position.x; p[i*3+1] = mesh.position.y + 0.5; p[i*3+2] = mesh.position.z;
            trail.count++;
            trail.line.geometry.attributes.position.needsUpdate = true;
            trail.line.geometry.setDrawRange(0, trail.count);
        }
    }
}

// ============================================
// HUD
// ============================================
function initHUD() {
    const container = document.getElementById('rover-cards');
    container.innerHTML = '';

    if (swarmMode) {
        // Swarm aggregate HUD — no individual rover cards
        container.innerHTML =
            '<div class="swarm-hud">' +
                '<div class="swarm-header">' +
                    '<span class="swarm-icon">&#9670;</span>' +
                    '<span class="swarm-title">SWARM — ' + SWARM_COUNT + ' UNITS</span>' +
                    '<span class="swarm-mode-badge">' + (constructionMode ? 'CONSTRUCTION' : 'EXPLORATION') + '</span>' +
                '</div>' +
                '<div class="swarm-stats-row">' +
                    '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-active">' + SWARM_COUNT + '</span><span class="swarm-stat-lbl">ACTIVE</span></div>' +
                    '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-avg-bat">100%</span><span class="swarm-stat-lbl">AVG BAT</span></div>' +
                    '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-min-bat">100%</span><span class="swarm-stat-lbl">MIN BAT</span></div>' +
                    '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-coverage">0%</span><span class="swarm-stat-lbl">COVERAGE</span></div>' +
                    (constructionMode ?
                        '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-pad-progress">0%</span><span class="swarm-stat-lbl">PAD</span></div>' +
                        '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-phase">SURVEY</span><span class="swarm-stat-lbl">PHASE</span></div>'
                    :
                        '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-ice">0</span><span class="swarm-stat-lbl">ICE</span></div>' +
                        '<div class="swarm-stat"><span class="swarm-stat-val" id="swarm-in-shadow">0</span><span class="swarm-stat-lbl">IN SHADOW</span></div>'
                    ) +
                '</div>' +
            '</div>';
    } else {
        const rovers = activeRovers();
        for (const r of rovers) {
            const state = roverStates[r.id];
            if (!state) continue;
            const hexColor = '#' + r.color.toString(16).padStart(6, '0');
            const card = document.createElement('div');
            card.className = 'rover-pill';
            card.id = 'rover-card-' + r.id;
            card.style.borderTopColor = hexColor;
            card.innerHTML =
                '<div class="rp-header">' +
                    '<div class="rp-name-group">' +
                        '<span class="rp-dot" style="background:' + hexColor + '"></span>' +
                        '<span class="rp-name" style="color:' + hexColor + '">' + r.name + '</span>' +
                    '</div>' +
                    '<button class="rp-pov pov-btn" data-rover="' + r.id + '">POV</button>' +
                '</div>' +
                '<div class="rp-battery">' +
                    '<div class="rp-bat-bar"><div class="rp-bat-fill battery-fill high" id="batbar-' + r.id + '" style="width:' + state.battery + '%"></div></div>' +
                    '<span class="rp-bat-val" id="bat-' + r.id + '">' + state.battery.toFixed(0) + '%</span>' +
                '</div>' +
                '<div class="rp-task" id="task-' + r.id + '">' + (state.task || 'IDLE') + '</div>' +
                '<div class="rp-meta">' +
                    '<span id="sensor-' + r.id + '">100%</span>' +
                    '<span id="pos-' + r.id + '">(0,0)</span>' +
                    '<span id="spd-' + r.id + '">0</span>' +
                    '<span id="dist-' + r.id + '">0</span>' +
                '</div>';
            card.querySelector('.rp-pov').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleRoverPOV(r.id);
            });
            container.appendChild(card);
        }
    }
    document.getElementById('mission-status').textContent = 'MISSION ACTIVE';
    document.getElementById('mission-status').className = 'status-active';
    if (selectedCrater) {
        document.getElementById('mission-title').textContent = 'REGOLITH \u2014 ' + selectedCrater.name.toUpperCase();
    }
    updateSpeedDisplay();
}

function updateHUD() {
    if (!missionActive) return;
    if (missionStartTime) {
        const elapsed = (Date.now() - missionStartTime) / 1000 * simSpeed;
        const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
        const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(elapsed % 60).toString().padStart(2, '0');
        document.getElementById('mission-clock').textContent = 'T+ ' + h + ':' + m + ':' + s;
    }

    if (swarmMode) {
        // Aggregate swarm stats
        const states = Object.values(roverStates);
        const active = states.filter(s => s.battery > 0).length;
        const avgBat = states.reduce((sum, s) => sum + s.battery, 0) / states.length;
        const minBat = Math.min(...states.map(s => s.battery));
        const inShadow = states.filter(s => s.in_shadow).length;

        const el = id => document.getElementById(id);
        if (el('swarm-active')) el('swarm-active').textContent = active + '/' + states.length;
        if (el('swarm-avg-bat')) el('swarm-avg-bat').textContent = avgBat.toFixed(0) + '%';
        if (el('swarm-min-bat')) el('swarm-min-bat').textContent = minBat.toFixed(0) + '%';
        if (el('swarm-in-shadow')) el('swarm-in-shadow').textContent = inShadow;
        if (el('swarm-ice')) el('swarm-ice').textContent = iceDeposits.filter(d => d.discovered).length + '/' + iceDeposits.length;

        // Coverage stat
        if (selectedCrater) {
            const R = selectedCrater.diameter_km * CRATER_SCALE;
            const cellSize = R * 0.1;
            const maxCells = Math.pow(Math.floor(R * 2 / cellSize), 2) * 0.7;
            const covPct = Math.min(100, (missionStats.coverageCells.size / maxCells) * 100);
            if (el('swarm-coverage')) el('swarm-coverage').textContent = covPct.toFixed(0) + '%';
        }
        return;
    }

    for (const [id, state] of Object.entries(roverStates)) {
        const bat = document.getElementById('bat-' + id);
        const batBar = document.getElementById('batbar-' + id);
        const sensor = document.getElementById('sensor-' + id);
        const pos = document.getElementById('pos-' + id);
        const task = document.getElementById('task-' + id);
        const card = document.getElementById('rover-card-' + id);
        if (bat) bat.textContent = state.battery.toFixed(0) + '%';
        if (sensor) sensor.textContent = state.sensor_health.toFixed(0) + '%';
        if (pos) pos.textContent = '(' + state.x.toFixed(0) + ', ' + state.z.toFixed(0) + ')';
        if (task) task.textContent = state.task || 'IDLE';
        if (batBar) {
            batBar.style.width = state.battery + '%';
            batBar.className = 'battery-fill ' + (state.battery > 60 ? 'high' : state.battery > 30 ? 'medium' : 'low');
        }
        if (card) card.classList.toggle('in-shadow', !!state.in_shadow);
    }
}

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { error: '✕', success: '✓', audit: '◈', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ') + '</span><span>' + message + '</span>';
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, duration);
    // Keep max 5 toasts
    while (container.children.length > 5) container.removeChild(container.firstChild);
}

// ============================================
// VIEW TABS (Camera Switching)
// ============================================
function initViewTabs() {
    const container = document.getElementById('view-tabs');
    if (!container) return;
    if (swarmMode) {
        container.innerHTML = '<button class="view-tab active" data-view="orbit" onclick="switchView(\'orbit\')">ORBIT</button>';
        return;
    }
    container.innerHTML = '<button class="view-tab active" data-view="orbit" onclick="switchView(\'orbit\')">ORBIT</button>';
    const rovers = activeRovers();
    for (const r of rovers) {
        const hexColor = '#' + r.color.toString(16).padStart(6, '0');
        const btn = document.createElement('button');
        btn.className = 'view-tab';
        btn.dataset.view = r.id;
        btn.innerHTML = '<span class="vt-dot" style="background:' + hexColor + '"></span>' + r.name.replace('ROVER-', '');
        btn.onclick = () => switchView(r.id);
        container.appendChild(btn);
    }
}

window.switchView = function(view) {
    if (view === 'orbit') {
        if (povRoverId) exitPOV();
    } else {
        toggleRoverPOV(view);
    }
    updateViewTabs();
};

function updateViewTabs() {
    document.querySelectorAll('.view-tab').forEach(tab => {
        const v = tab.dataset.view;
        tab.classList.toggle('active', (v === 'orbit' && !povRoverId) || v === povRoverId);
    });
}

// ============================================
// SIDE PANEL TOGGLE
// ============================================
window.toggleSidePanel = function() {
    const panel = document.getElementById('side-panel');
    if (panel) {
        sidePanelOpen = !sidePanelOpen;
        panel.classList.toggle('collapsed', !sidePanelOpen);
    }
};

// ============================================
// END MISSION + POST-MISSION SUMMARY
// ============================================
window.endMission = function() {
    if (!missionActive) return;
    missionActive = false;
    if (telemetryWs) try { telemetryWs.close(); } catch(e) {}
    if (negotiationWs) try { negotiationWs.close(); } catch(e) {}
    telemetryWs = null; negotiationWs = null;
    showPostMission();
};

function showPostMission() {
    const overlay = document.getElementById('post-mission');
    if (!overlay) return;
    overlay.style.display = '';

    const R = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 750;
    const cellSize = R * 0.1;
    const maxCells = Math.pow(Math.floor(R * 2 / cellSize), 2) * 0.7;
    const coveragePct = Math.min(100, (missionStats.coverageCells.size / maxCells) * 100);
    const totalDist = Object.values(missionStats.totalDistance).reduce((a, b) => a + b, 0);
    const elapsed = missionStartTime ? (Date.now() - missionStartTime) / 1000 : 0;
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = Math.floor(elapsed % 60);

    // Avg Nemotron
    let avgNemo = 0;
    if (nemotronHistory.length > 0) {
        const vals = nemotronHistory.map(h => ((h.helpfulness||0)+(h.correctness||0)+(h.coherence||0)+(h.complexity||0)+(h.verbosity||0))/5);
        avgNemo = vals.reduce((a,b)=>a+b,0) / vals.length;
    }

    const el = id => document.getElementById(id);
    if (el('pm-crater-name')) el('pm-crater-name').textContent = selectedCrater ? selectedCrater.name : '';
    if (el('pm-scenario-name')) {
        const sc = SCENARIOS[missionConfig.scenario] || SCENARIOS.exploration;
        el('pm-scenario-name').textContent = sc.name;
    }
    if (el('pm-coverage')) el('pm-coverage').textContent = coveragePct.toFixed(1) + '%';
    if (el('pm-distance')) el('pm-distance').textContent = totalDist.toFixed(0) + ' m';
    if (el('pm-ice')) el('pm-ice').textContent = missionStats.iceFound + '/' + iceDeposits.length;
    if (el('pm-avg-nemotron')) el('pm-avg-nemotron').textContent = avgNemo.toFixed(2);
    if (el('pm-duration')) el('pm-duration').textContent = h + 'h ' + m + 'm ' + s + 's';
    if (el('pm-decisions')) el('pm-decisions').textContent = totalAIDecisions.toString();

    // Per-rover summary
    const roverGrid = el('pm-rover-grid');
    if (roverGrid) {
        roverGrid.innerHTML = '';
        if (swarmMode) {
            // Aggregate summary for swarm
            const states = Object.values(roverStates);
            const active = states.filter(s => s.battery > 0).length;
            const avgBat = states.reduce((s, r) => s + r.battery, 0) / states.length;
            const avgSensor = states.reduce((s, r) => s + r.sensor_health, 0) / states.length;
            roverGrid.innerHTML =
                '<div class="pm-rover">' +
                    '<div class="pm-rover-name" style="color:#4a9eff">SWARM AGGREGATE (' + states.length + ' UNITS)</div>' +
                    '<div class="pm-rover-stat"><span>Active</span><span>' + active + '/' + states.length + '</span></div>' +
                    '<div class="pm-rover-stat"><span>Avg Battery</span><span>' + avgBat.toFixed(1) + '%</span></div>' +
                    '<div class="pm-rover-stat"><span>Avg Sensors</span><span>' + avgSensor.toFixed(1) + '%</span></div>' +
                    (constructionMode ? '<div class="pm-rover-stat"><span>Pad Complete</span><span>' + padProgress.toFixed(1) + '%</span></div>' : '') +
                '</div>';
        } else {
            for (const r of activeRovers()) {
                const state = roverStates[r.id];
                if (!state) continue;
                const hexColor = '#' + r.color.toString(16).padStart(6, '0');
                const dist = (missionStats.totalDistance[r.id] || 0).toFixed(0);
                const div = document.createElement('div');
                div.className = 'pm-rover';
                div.innerHTML =
                    '<div class="pm-rover-name" style="color:' + hexColor + '">' + r.name + '</div>' +
                    '<div class="pm-rover-stat"><span>Battery</span><span>' + state.battery.toFixed(1) + '%</span></div>' +
                    '<div class="pm-rover-stat"><span>Distance</span><span>' + dist + ' m</span></div>' +
                    '<div class="pm-rover-stat"><span>Sensors</span><span>' + state.sensor_health.toFixed(1) + '%</span></div>' +
                    '<div class="pm-rover-stat"><span>Last Task</span><span>' + (state.task || 'IDLE') + '</span></div>';
                roverGrid.appendChild(div);
            }
        }
    }

    // Nemotron trend chart
    const chart = el('pm-nemotron-chart');
    if (chart && nemotronHistory.length > 0) {
        chart.innerHTML = '';
        const maxBars = 30;
        const data = nemotronHistory.slice(-maxBars);
        const maxScore = 4;
        data.forEach(h => {
            const avg = ((h.helpfulness||0)+(h.correctness||0)+(h.coherence||0)+(h.complexity||0)+(h.verbosity||0))/5;
            const bar = document.createElement('div');
            bar.className = 'pm-chart-bar';
            bar.style.height = ((avg / maxScore) * 100) + '%';
            const norm = avg / maxScore;
            bar.style.background = norm > 0.7 ? '#00d47e' : norm > 0.4 ? '#f0ad4e' : '#ff3b5c';
            bar.title = 'Avg: ' + avg.toFixed(2);
            chart.appendChild(bar);
        });
    }
}

// ============================================
// DOWNLOAD MISSION REPORT
// ============================================
window.downloadMissionReport = function() {
    const R = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 750;
    const cellSize = R * 0.1;
    const maxCells = Math.pow(Math.floor(R * 2 / cellSize), 2) * 0.7;
    const coveragePct = Math.min(100, (missionStats.coverageCells.size / maxCells) * 100);
    const totalDist = Object.values(missionStats.totalDistance).reduce((a, b) => a + b, 0);
    const elapsed = missionStartTime ? (Date.now() - missionStartTime) / 1000 : 0;

    const report = {
        mission: {
            crater: selectedCrater ? selectedCrater.name : 'unknown',
            scenario: missionConfig.scenario,
            numRovers: missionConfig.numRovers,
            shadowSpeed: missionConfig.shadowSpeed,
            elapsedSeconds: elapsed,
        },
        performance: {
            coveragePercent: +coveragePct.toFixed(2),
            totalDistanceMeters: +totalDist.toFixed(1),
            iceDiscovered: missionStats.iceFound,
            totalIce: iceDeposits.length,
            aiDecisions: totalAIDecisions,
        },
        nemotronHistory: nemotronHistory,
        rovers: Object.entries(roverStates).map(([id, s]) => ({
            id,
            battery: s.battery,
            sensorHealth: s.sensor_health,
            distance: missionStats.totalDistance[id] || 0,
            lastTask: s.task,
            inShadow: s.in_shadow,
        })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'regolith-' + (selectedCrater ? selectedCrater.name.toLowerCase() : 'mission') + '-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

function addLogEntry(type, message, time) {
    const log = document.getElementById('negotiation-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    entry.innerHTML = '<span class="log-time">' + (time || getElapsedTime()) + '</span><div class="log-type">' + type.toUpperCase() + '</div><div>' + message + '</div>';
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    // Narrator hook
    if (typeof narrateEvent === 'function') narrateEvent(type, message);
    // Toast for important events
    const clean = message.replace(/<[^>]+>/g, '');
    if (type === 'danger') showToast(clean, 'error', 6000);
    else if (type === 'award') showToast(clean, 'success', 5000);
    else if (type === 'audit') showToast(clean, 'audit', 3500);
    // Keep log bounded
    while (log.children.length > 150) log.removeChild(log.firstChild);
}

function getElapsedTime() {
    if (!missionStartTime) return '00:00';
    const elapsed = (Date.now() - missionStartTime) / 1000;
    return Math.floor(elapsed / 60).toString().padStart(2, '0') + ':' + Math.floor(elapsed % 60).toString().padStart(2, '0');
}

function updateAuditGauges(scores) {
    const gaugeIds = ['helpfulness', 'correctness', 'coherence', 'complexity', 'verbosity'];
    for (const id of gaugeIds) {
        // Legacy bottom-bar gauges
        const gauge = document.getElementById('gauge-' + id);
        if (gauge) {
            const value = gauge.querySelector('.score-val');
            if (value) {
                const score = scores[id] || 0;
                value.textContent = score.toFixed(1);
                const norm = score / 4.0;
                value.style.color = norm > 0.7 ? '#00d47e' : norm > 0.4 ? '#f0ad4e' : '#ff3b5c';
            }
        }
        // NVIDIA panel bars
        const nvItem = document.getElementById('nv-' + id);
        if (nvItem) {
            const score = scores[id] || 0;
            const norm = score / 4.0;
            const fill = nvItem.querySelector('.nv-bar-fill');
            const val = nvItem.querySelector('.nv-val');
            if (fill) {
                fill.style.width = (norm * 100) + '%';
                fill.style.background = norm > 0.7 ? '#76b900' : norm > 0.4 ? '#f0ad4e' : '#ff3b5c';
            }
            if (val) {
                val.textContent = score.toFixed(1);
                val.style.color = norm > 0.7 ? '#76b900' : norm > 0.4 ? '#f0ad4e' : '#ff3b5c';
            }
        }
    }
    // Track for post-mission analytics
    nemotronHistory.push({ time: getElapsedTime(), ...scores });
    totalAIDecisions++;

    // Update NVIDIA panel prediction & decision count
    const nvDecisions = document.getElementById('nv-total-decisions');
    if (nvDecisions) nvDecisions.textContent = totalAIDecisions + ' decisions audited';
    updateNvidiaPrediction();
}

// ============================================
// WEBSOCKETS
// ============================================
function connectWebSockets() {
    const wsBase = 'ws://' + window.location.host;

    if (telemetryWs) try { telemetryWs.close(); } catch(e) {}
    telemetryWs = new WebSocket(wsBase + '/ws/telemetry');
    telemetryWs.onopen = () => {
        telemetryWs._ka = setInterval(() => {
            if (telemetryWs.readyState === WebSocket.OPEN) telemetryWs.send('ping');
        }, 10000);
    };
    telemetryWs.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.ping) return;
            if (data.rovers) {
                for (const [id, state] of Object.entries(data.rovers)) {
                    if (roverStates[id]) {
                        // Frontend is position authority — only merge non-position fields
                        // This prevents the "position reset" jitter where backend
                        // fights with local sim over rover x/z coordinates
                        const local = roverStates[id];
                        if (state.task && state.task !== 'IDLE') local.task = state.task;
                        if (state.in_shadow !== undefined) local.in_shadow = state.in_shadow;
                        // Don't merge: x, z, vx, vz, _tx, _tz, battery (local sim owns these)
                    }
                }
            }
            if (data.shadow_boundary_x !== undefined) updateShadow(data.shadow_boundary_x);
        } catch(err) {
            // ignore parse errors
        }
    };
    telemetryWs.onclose = () => {
        if (telemetryWs._ka) clearInterval(telemetryWs._ka);
        if (missionActive) setTimeout(connectWebSockets, 3000);
    };
    telemetryWs.onerror = () => {}; // suppress console errors

    if (negotiationWs) try { negotiationWs.close(); } catch(e) {}
    negotiationWs = new WebSocket(wsBase + '/ws/negotiation');
    negotiationWs.onopen = () => {
        negotiationWs._ka = setInterval(() => {
            if (negotiationWs.readyState === WebSocket.OPEN) negotiationWs.send('ping');
        }, 10000);
    };
    negotiationWs.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.ping) return;
            if (data.type === 'log') addLogEntry(data.log_type || 'system', data.message, data.time);
            if (data.type === 'audit') updateAuditGauges(data.scores);
            if (data.type === 'status') {
                const el = document.getElementById('mission-status');
                if (el) { el.textContent = data.status; el.className = data.class || 'status-active'; }
            }
        } catch(err) {
            // ignore parse errors
        }
    };
    negotiationWs.onclose = () => { if (negotiationWs._ka) clearInterval(negotiationWs._ka); };
    negotiationWs.onerror = () => {};

    addLogEntry('system', 'Mission deployed to <b>' + selectedCrater.name + '</b> crater (' + selectedCrater.diameter_km + 'km diameter). Shadow advancing at ' + missionConfig.shadowSpeed + ' m/s.');
    addLogEntry('system', '<b>' + missionConfig.numRovers + '</b> rovers deployed. Initial battery: ' + missionConfig.initialBattery + '%. Duration: ' + missionConfig.missionDuration + 's.');
    if (swarmMode) {
        addLogEntry('system', '<b>' + SWARM_COUNT + '</b> swarm rovers deployed (' + (constructionMode ? 'CONSTRUCTION' : 'EXPLORATION') + ' mode). Aggregate tracking only — individual agent identities not monitored.');
    }
}

// ============================================
// ANIMATION LOOP
// ============================================
let lastFrameTime = 0;

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    const dt = Math.min(time - lastFrameTime, 0.1);
    lastFrameTime = time;

    if (currentState === AppState.ORBIT || currentState === AppState.CONFIG) {
        if (moonGlobe) moonGlobe.rotation.y += 0.00015;
        craterMarkers.forEach(m => {
            const s = 1.0 + Math.sin(time * 2 + m.crater.lat) * 0.1;
            m.ring.scale.setScalar(s);
            if (m.pulseRing) {
                const ps = 1.0 + Math.sin(time * 3 + m.crater.lat * 0.5) * 0.3;
                m.pulseRing.scale.setScalar(ps);
            }
        });
        updateCraterOverlays();
        controls.update();
    } else if (currentState === AppState.ZOOMING) {
        updateZoom(time);
    } else if (currentState === AppState.SIMULATION) {
        // Local simulation tick
        if (constructionMode) {
            tickConstructionSim(dt);
        } else {
            tickLocalSim(dt);
        }

        if (craterMaterial) { craterMaterial.uniforms.uTime.value = time; craterMaterial.uniforms.uCameraPosition.value.copy(camera.position); }
        if (shadowMaterial) shadowMaterial.uniforms.uTime.value = time;
        if (dustParticles) dustParticles.material.uniforms.uTime.value = time;
        updateRovers(time);
        updatePOVCamera(dt);
        updateFreeCam(dt);
        updateMinimap();
        updateMissionAnalytics(dt);
        updateHUD();
        updateMissionGoals();
        if (!povRoverId) controls.update();
    }

    renderer.render(scene, camera);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================
// ROVER POV CAMERA SYSTEM
// Click any rover card → first-person chase cam
// ============================================
function toggleRoverPOV(roverId) {
    const povHud = document.getElementById('pov-hud');
    if (povRoverId === roverId) {
        // Exit POV
        povRoverId = null;
        controls.enabled = true;
        if (povHud) povHud.style.display = 'none';
        document.querySelectorAll('.pov-btn').forEach(b => b.classList.remove('active'));
        updateViewTabs();
        return;
    }
    povRoverId = roverId;
    controls.enabled = false;
    if (povHud) povHud.style.display = '';
    // Highlight active POV button
    document.querySelectorAll('.pov-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.rover === roverId);
    });
    updateViewTabs();
}

window.exitPOV = function() {
    toggleRoverPOV(povRoverId);
};

function updatePOVCamera(dt) {
    if (!povRoverId) return;
    const mesh = roverMeshes[povRoverId];
    const state = roverStates[povRoverId];
    if (!mesh || !state) return;

    // Chase camera: behind and above the rover, looking forward
    const forward = new THREE.Vector3(
        Math.sin(mesh.rotation.y),
        0,
        Math.cos(mesh.rotation.y)
    );
    const targetCamPos = new THREE.Vector3(
        mesh.position.x - forward.x * 25 + 0,
        mesh.position.y + 12,
        mesh.position.z - forward.z * 25
    );
    const targetLookAt = new THREE.Vector3(
        mesh.position.x + forward.x * 40,
        mesh.position.y + 3,
        mesh.position.z + forward.z * 40
    );

    camera.position.lerp(targetCamPos, povSmooth + dt * 2);
    const currentTarget = controls.target.clone();
    currentTarget.lerp(targetLookAt, povSmooth + dt * 2);
    camera.lookAt(currentTarget);

    // Update POV HUD overlay
    const povName = document.getElementById('pov-rover-name');
    const povBat = document.getElementById('pov-battery');
    const povSen = document.getElementById('pov-sensors');
    const povTask = document.getElementById('pov-task');
    const povPos = document.getElementById('pov-position');
    const povShadow = document.getElementById('pov-shadow');
    const povSpeed = document.getElementById('pov-speed');
    if (povName) {
        const r = ROVER_PALETTE.find(p => p.id === povRoverId);
        const hexCol = r ? '#' + r.color.toString(16).padStart(6, '0') : '#4a9eff';
        povName.textContent = r ? r.name : povRoverId.toUpperCase();
        povName.style.color = hexCol;
    }
    if (povBat) povBat.textContent = state.battery.toFixed(1) + '%';
    if (povSen) povSen.textContent = state.sensor_health.toFixed(1) + '%';
    if (povTask) povTask.textContent = state.task || 'IDLE';
    if (povPos) povPos.textContent = `(${state.x.toFixed(1)}, ${state.z.toFixed(1)})`;
    if (povShadow) {
        const dist = (state.x - shadowBoundaryX).toFixed(0);
        povShadow.textContent = state.in_shadow ? 'IN SHADOW ⚠' : dist + 'm to shadow';
        povShadow.style.color = state.in_shadow ? '#ff4757' : '#2ed573';
    }
    if (povSpeed) {
        const spd = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
        povSpeed.textContent = spd.toFixed(2) + ' m/s';
    }
}

// ============================================
// TACTICAL MINIMAP (2D radar overlay)
// Shows rover positions, ice, shadow boundary
// ============================================
function initMinimap() {
    minimapCanvas = document.getElementById('minimap-canvas');
    if (!minimapCanvas) return;
    minimapCtx = minimapCanvas.getContext('2d');
    minimapCanvas.width = 170;
    minimapCanvas.height = 170;
}

function updateMinimap() {
    if (!minimapCtx || !selectedCrater) return;
    const ctx = minimapCtx;
    const w = 170, h = 170;
    const R = selectedCrater.diameter_km * CRATER_SCALE;
    const scale = (w * 0.45) / R;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(8, 12, 28, 0.85)';
    ctx.beginPath();
    ctx.arc(w/2, h/2, w * 0.47, 0, Math.PI * 2);
    ctx.fill();

    // Crater rim circle
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w/2, h/2, R * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Grid lines
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.08)';
    ctx.lineWidth = 0.5;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(w/2 + i * R * 0.25 * scale, h/2 - R * scale);
        ctx.lineTo(w/2 + i * R * 0.25 * scale, h/2 + R * scale);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(w/2 - R * scale, h/2 + i * R * 0.25 * scale);
        ctx.lineTo(w/2 + R * scale, h/2 + i * R * 0.25 * scale);
        ctx.stroke();
    }

    // Shadow zone
    const shadowX = w/2 + shadowBoundaryX * scale;
    ctx.fillStyle = 'rgba(100, 0, 180, 0.15)';
    ctx.fillRect(0, h/2 - R * scale, Math.max(0, shadowX), R * scale * 2);
    // Shadow boundary line
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(shadowX, h/2 - R * scale);
    ctx.lineTo(shadowX, h/2 + R * scale);
    ctx.stroke();
    ctx.setLineDash([]);

    // Landing pad (construction mode)
    if (constructionMode && padCenter) {
        const padMX = w/2 + padCenter.x * scale;
        const padMZ = h/2 + padCenter.z * scale;
        const padR = padTargetRadius * scale;
        // Pad outline
        ctx.strokeStyle = padPhase === 'COMPLETE' ? '#76b900' : 'rgba(74, 158, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(padMX, padMZ, padR, 0, Math.PI * 2);
        ctx.stroke();
        // Fill progress arc
        ctx.strokeStyle = padPhase === 'COMPLETE' ? '#76b900' : '#f0ad4e';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(padMX, padMZ, padR - 2, -Math.PI/2, -Math.PI/2 + (padProgress/100) * Math.PI * 2);
        ctx.stroke();
        // Collection zones
        for (const zone of collectionZones) {
            ctx.fillStyle = 'rgba(240, 173, 78, 0.3)';
            ctx.beginPath();
            ctx.arc(w/2 + zone.x * scale, h/2 + zone.z * scale, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Ice deposits
    for (const dep of iceDeposits) {
        const mx = w/2 + dep.x * scale;
        const my = h/2 + dep.z * scale;
        if (dep.discovered) {
            ctx.fillStyle = 'rgba(0, 204, 255, 0.8)';
            ctx.beginPath();
            // Diamond shape
            ctx.moveTo(mx, my - 4);
            ctx.lineTo(mx + 3, my);
            ctx.lineTo(mx, my + 4);
            ctx.lineTo(mx - 3, my);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillStyle = 'rgba(0, 204, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(mx, my, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Voronoi boundaries (faint)
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.12)';
    ctx.lineWidth = 0.5;
    const ids = Object.keys(roverStates);
    const GRID = 16;
    const step = R * 2 / GRID;
    for (let gi = 0; gi < GRID; gi++) {
        for (let gj = 0; gj < GRID; gj++) {
            const px = -R + (gi + 0.5) * step;
            const pz = -R + (gj + 0.5) * step;
            if (px * px + pz * pz > R * R * 0.85) continue;
            let closest = null, closestDist = Infinity;
            for (const id of ids) {
                const s = roverStates[id];
                const d = (s.x - px) ** 2 + (s.z - pz) ** 2;
                if (d < closestDist) { closestDist = d; closest = id; }
            }
            // Check right neighbor
            if (gi < GRID - 1) {
                const nx = -R + (gi + 1.5) * step;
                let nClosest = null, nDist = Infinity;
                for (const id of ids) {
                    const s = roverStates[id];
                    const d = (s.x - nx) ** 2 + (s.z - pz) ** 2;
                    if (d < nDist) { nDist = d; nClosest = id; }
                }
                if (closest !== nClosest) {
                    ctx.beginPath();
                    ctx.moveTo(w/2 + px * scale, h/2 + pz * scale);
                    ctx.lineTo(w/2 + nx * scale, h/2 + pz * scale);
                    ctx.stroke();
                }
            }
        }
    }

    // Communication links
    ctx.strokeStyle = 'rgba(46, 213, 115, 0.25)';
    ctx.lineWidth = 0.7;
    const COMM_R = R * 0.7;
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const a = roverStates[ids[i]], b = roverStates[ids[j]];
            const dist = Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
            if (dist < COMM_R) {
                ctx.beginPath();
                ctx.moveTo(w/2 + a.x * scale, h/2 + a.z * scale);
                ctx.lineTo(w/2 + b.x * scale, h/2 + b.z * scale);
                ctx.stroke();
            }
        }
    }

    // Rovers
    const allPalettes = isSwarmMode() ? SWARM_PALETTE : ROVER_PALETTE;
    for (const [id, state] of Object.entries(roverStates)) {
        const r = allPalettes.find(p => p.id === id);
        if (!r) continue;
        const mx = w/2 + state.x * scale;
        const my = h/2 + state.z * scale;
        const hexColor = '#' + r.color.toString(16).padStart(6, '0');

        // Direction indicator
        if (Math.abs(state.vx) > 0.01 || Math.abs(state.vz) > 0.01) {
            const angle = Math.atan2(state.vz, state.vx);
            ctx.strokeStyle = hexColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(mx + Math.cos(angle) * 8, my + Math.sin(angle) * 8);
            ctx.stroke();
        }

        // Rover dot
        ctx.fillStyle = hexColor;
        ctx.beginPath();
        ctx.arc(mx, my, povRoverId === id ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();

        // POV indicator
        if (povRoverId === id) {
            ctx.strokeStyle = hexColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(mx, my, 7, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '7px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(id[0].toUpperCase(), mx, my - 7);
    }

    // North indicator
    ctx.fillStyle = 'rgba(74, 158, 255, 0.6)';
    ctx.font = '8px Orbitron, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', w/2, 14);
    ctx.fillText('+X SAFE', w - 18, h/2 + 3);
}

// ============================================
// MISSION ANALYTICS
// Real-time coverage, distance, energy stats
// ============================================
function updateMissionAnalytics(dt) {
    if (!missionActive || !selectedCrater) return;
    const R = selectedCrater.diameter_km * CRATER_SCALE;
    const cellSize = R * 0.1; // Coverage grid cell size

    for (const [id, state] of Object.entries(roverStates)) {
        // Track distance traveled
        if (!missionStats.totalDistance[id]) missionStats.totalDistance[id] = 0;
        if (!missionStats.energyUsed[id]) missionStats.energyUsed[id] = 0;
        const spd = Math.sqrt(state.vx * state.vx + state.vz * state.vz);
        missionStats.totalDistance[id] += spd * dt;
        missionStats.energyUsed[id] += (100 - state.battery);

        // Track coverage (grid cells visited)
        const cx = Math.floor(state.x / cellSize);
        const cz = Math.floor(state.z / cellSize);
        missionStats.coverageCells.add(`${cx},${cz}`);
    }

    // Count discovered ice
    missionStats.iceFound = iceDeposits.filter(d => d.discovered).length;

    // Update analytics panel
    const totalDist = Object.values(missionStats.totalDistance).reduce((a, b) => a + b, 0);
    const maxCells = Math.pow(Math.floor(R * 2 / cellSize), 2) * 0.7; // ~70% of grid is within crater
    const coveragePct = Math.min(100, (missionStats.coverageCells.size / maxCells) * 100);

    const el = (id) => document.getElementById(id);
    if (el('stat-coverage')) el('stat-coverage').textContent = coveragePct.toFixed(1) + '%';
    if (el('stat-distance')) el('stat-distance').textContent = totalDist.toFixed(0) + ' m';
    if (el('stat-ice')) el('stat-ice').textContent = missionStats.iceFound + '/' + iceDeposits.length;

    const avgBat = Object.values(roverStates).reduce((s, r) => s + r.battery, 0) / Object.keys(roverStates).length;
    if (el('stat-avg-battery')) el('stat-avg-battery').textContent = avgBat.toFixed(0) + '%';

    // Update per-rover speed and distance in HUD cards
    for (const [id, state] of Object.entries(roverStates)) {
        const spdEl = document.getElementById('spd-' + id);
        const distEl = document.getElementById('dist-' + id);
        if (spdEl) spdEl.textContent = Math.sqrt(state.vx * state.vx + state.vz * state.vz).toFixed(1) + ' m/s';
        if (distEl) distEl.textContent = (missionStats.totalDistance[id] || 0).toFixed(0) + ' m';
    }
}

// ============================================
// TERRAIN HEATMAP OVERLAY (science value visualization)
// Toggle with 'H' key or button
// ============================================
let heatmapMesh = null;
let heatmapVisible = false;

function createHeatmapOverlay(craterRadius) {
    const size = craterRadius * 2.2;
    const res = 128;
    const canvas = document.createElement('canvas');
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(res, res);

    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            const wx = (x / res - 0.5) * size;
            const wz = (y / res - 0.5) * size;
            const r = Math.sqrt(wx * wx + wz * wz);
            if (r > craterRadius * 1.0) {
                const idx = (y * res + x) * 4;
                imgData.data[idx] = 0; imgData.data[idx+1] = 0; imgData.data[idx+2] = 0; imgData.data[idx+3] = 0;
                continue;
            }

            // Science value: higher near shadow boundary, ice deposits, crater floor
            let value = 0;
            // Shadow proximity
            const distToShadow = Math.abs(wx - shadowBoundaryX);
            if (distToShadow < craterRadius * 0.2) value += 0.4;
            // Ice proximity
            for (const dep of iceDeposits) {
                const dd = Math.sqrt((dep.x - wx) ** 2 + (dep.z - wz) ** 2);
                if (dd < craterRadius * 0.15) value += 0.3 * dep.richness;
            }
            // Depth bonus (deeper = more interesting)
            const depth = -craterHeight(wx, wz);
            value += Math.max(0, depth / (selectedCrater.depth_km * DEPTH_SCALE)) * 0.3;
            // In shadow: high risk
            if (wx < shadowBoundaryX) value = -0.5; // negative = danger

            value = Math.max(-1, Math.min(1, value));

            const idx = (y * res + x) * 4;
            if (value < 0) {
                // Danger: red
                imgData.data[idx] = 200;
                imgData.data[idx+1] = 30;
                imgData.data[idx+2] = 60;
            } else {
                // Science value: blue → green → yellow
                imgData.data[idx] = Math.floor(value * 255);
                imgData.data[idx+1] = Math.floor((0.5 + value * 0.5) * 200);
                imgData.data[idx+2] = Math.floor((1 - value) * 150);
            }
            imgData.data[idx+3] = Math.floor(Math.abs(value) * 120);
        }
    }

    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    heatmapMesh = new THREE.Mesh(geo, mat);
    heatmapMesh.position.y = 4;
    heatmapMesh.renderOrder = 3;
    heatmapMesh.visible = false;
    scene.add(heatmapMesh);
}

window.toggleHeatmap = function() {
    if (!heatmapMesh && selectedCrater) {
        createHeatmapOverlay(selectedCrater.diameter_km * CRATER_SCALE);
    }
    if (heatmapMesh) {
        heatmapVisible = !heatmapVisible;
        heatmapMesh.visible = heatmapVisible;
        const btn = document.getElementById('heatmap-btn');
        if (btn) btn.classList.toggle('active', heatmapVisible);
        addLogEntry('system', heatmapVisible ? 'Terrain heatmap <b>ENABLED</b> — science value overlay' : 'Terrain heatmap <b>DISABLED</b>');
    }
};

// ============================================
// FREE CAMERA CONTROLS (WASD/Arrow Keys)
// Moves camera when not in POV mode
// ============================================
document.addEventListener('keydown', (e) => {
    keysDown[e.key.toLowerCase()] = true;
    if (e.key === 'h' || e.key === 'H') {
        if (currentState === AppState.SIMULATION) window.toggleHeatmap();
    }
    if (e.key === 'n' || e.key === 'N') {
        if (currentState === AppState.SIMULATION) window.toggleNarrator();
    }
    if (e.key === 'Escape' && povRoverId) {
        window.exitPOV();
    }
});
document.addEventListener('keyup', (e) => {
    keysDown[e.key.toLowerCase()] = false;
});

function updateFreeCam(dt) {
    if (currentState !== AppState.SIMULATION || povRoverId) return;
    const speed = freeCamSpeed * dt * (keysDown['shift'] ? 3 : 1);

    // Get camera-aligned forward/right vectors (projected to XZ plane)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let moved = false;
    const delta = new THREE.Vector3();

    if (keysDown['w'] || keysDown['arrowup']) { delta.add(forward.clone().multiplyScalar(speed)); moved = true; }
    if (keysDown['s'] || keysDown['arrowdown']) { delta.add(forward.clone().multiplyScalar(-speed)); moved = true; }
    if (keysDown['a'] || keysDown['arrowleft']) { delta.add(right.clone().multiplyScalar(-speed)); moved = true; }
    if (keysDown['d'] || keysDown['arrowright']) { delta.add(right.clone().multiplyScalar(speed)); moved = true; }
    if (keysDown['q'] || keysDown['e']) {
        const upDelta = (keysDown['e'] ? 1 : -1) * speed;
        delta.y += upDelta;
        moved = true;
    }

    if (moved) {
        camera.position.add(delta);
        controls.target.add(delta);
    }
}

// ============================================
// AI MISSION NARRATOR (Web Speech API)
// Zero-cost real-time voice commentary
// ============================================
window.toggleNarrator = function() {
    narratorEnabled = !narratorEnabled;
    const btn = document.getElementById('narrator-btn');
    const indicator = document.getElementById('narrator-indicator');
    if (btn) btn.classList.toggle('active', narratorEnabled);
    if (indicator) indicator.style.display = narratorEnabled ? 'flex' : 'none';
    
    if (narratorEnabled) {
        narrate('AI Mission Narrator online. Monitoring swarm operations at ' + (selectedCrater ? selectedCrater.name : 'lunar south pole') + ' crater.');
        addLogEntry('system', 'AI Narrator <b>ENABLED</b> — real-time voice commentary [N to toggle]');
    } else {
        speechSynthesis.cancel();
        narratorQueue = [];
        narratorSpeaking = false;
        addLogEntry('system', 'AI Narrator <b>DISABLED</b>');
    }
};

function narrate(text) {
    if (!narratorEnabled || !('speechSynthesis' in window)) return;
    // Throttle: min 4s between narrations
    const now = Date.now();
    if (now - lastNarratorEvent < 4000) {
        // Queue it for later
        if (narratorQueue.length < 5) narratorQueue.push(text);
        return;
    }
    lastNarratorEvent = now;
    _speakNow(text);
}

function _speakNow(text) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 0.85;
    utter.volume = 0.9;
    // Prefer a deeper/professional voice
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Daniel') || v.name.includes('Alex') || v.name.includes('Google UK English Male'));
    if (preferred) utter.voice = preferred;
    utter.onstart = () => { narratorSpeaking = true; };
    utter.onend = () => {
        narratorSpeaking = false;
        // Play queued
        if (narratorQueue.length > 0) {
            const next = narratorQueue.shift();
            setTimeout(() => _speakNow(next), 500);
        }
    };
    speechSynthesis.speak(utter);
}

// Hook narrator into log entries
const _originalAddLogEntry = addLogEntry;
// We monkey-patch addLogEntry to also narrate important events
const _baseAddLogEntry = addLogEntry;

// Narrator event triggers — integrated into the simulation loop
function narrateEvent(type, message) {
    if (!narratorEnabled) return;
    // Strip HTML
    const clean = message.replace(/<[^>]+>/g, '');
    let narration = '';
    switch(type) {
        case 'danger':
            narration = 'Warning! ' + clean;
            break;
        case 'award':
            narration = clean;
            break;
        case 'audit':
            // Summarize for voice
            const match = clean.match(/Help: ([\d.]+).*Correct: ([\d.]+)/);
            if (match) narration = `Nemotron audit scores: helpfulness ${match[1]}, correctness ${match[2]}. ${clean.includes('PASS') ? 'Audit passed.' : 'Audit failed.'}`;
            break;
        case 'cfp':
            narration = 'New contract for proposals. ' + clean;
            break;
        default:
            // Only narrate system messages about shadow or ice
            if (clean.includes('shadow') || clean.includes('ice') || clean.includes('deployed') || clean.includes('ENABLED') || clean.includes('rescue'))
                narration = clean;
    }
    if (narration) narrate(narration);
}

// ============================================
// SCENARIO APPLICATION
// Apply scenario modifiers when mission starts
// ============================================
function applyScenario() {
    const sc = SCENARIOS[missionConfig.scenario] || SCENARIOS.exploration;
    
    // Log scenario objectives
    addLogEntry('system', `<b>MISSION: ${sc.name.toUpperCase()}</b> — ${sc.description}`);
    sc.objectives.forEach((obj, i) => {
        addLogEntry('system', `Objective ${i+1}: ${obj}`);
    });

    if (narratorEnabled) {
        narrate(`Mission scenario: ${sc.name}. ${sc.description}. ${sc.objectives.length} objectives to complete.`);
    }

    // Apply scenario-specific modifiers
    if (sc.modifiers.strandedRover && Object.keys(roverStates).length >= 2) {
        // In rescue mode, place one rover deep in shadow
        const roverIds = Object.keys(roverStates);
        const strandedId = roverIds[roverIds.length - 1];
        const state = roverStates[strandedId];
        state.x = shadowBoundaryX - 80;
        state.z = 0;
        state.battery = 25;
        state.task = 'STRANDED — CRITICAL';
        state.vx = 0;
        state.vz = 0;
        state._tx = state.x;
        state._tz = state.z;
        if (roverMeshes[strandedId]) {
            roverMeshes[strandedId].position.x = state.x;
            roverMeshes[strandedId].position.z = state.z;
        }
        addLogEntry('danger', `⚠ <b>${strandedId.toUpperCase()}</b> is STRANDED in the shadow zone! Battery at 25%. Initiate rescue!`);
        if (narratorEnabled) narrate(`Emergency! ${strandedId} is stranded in the shadow zone with critical battery. All rovers must coordinate a rescue.`);
    }

    if (sc.modifiers.raceMode) {
        // In race mode, position all rovers near shadow boundary
        const roverIds = Object.keys(roverStates);
        roverIds.forEach((id, i) => {
            const state = roverStates[id];
            state.x = shadowBoundaryX + 40 + (i * 30);
            state.z = -50 + (i * 50);
            state._tx = state.x + 150;
            state._tz = state.z;
            if (roverMeshes[id]) {
                roverMeshes[id].position.x = state.x;
                roverMeshes[id].position.z = state.z;
            }
        });
        addLogEntry('danger', '⚠ Shadow advancing at HIGH SPEED! All rovers must evacuate immediately!');
        if (narratorEnabled) narrate('Shadow race initiated! The shadow wall is advancing rapidly. All rovers must reach the safe zone immediately!');
    }
}

// ============================================
// NVIDIA PREDICTION (synthesised from Nemotron audit history)
// ============================================
function updateNvidiaPrediction() {
    if (nemotronHistory.length === 0) return;
    // Compute rolling average from last 10 audits
    const recent = nemotronHistory.slice(-10);
    const avgScore = recent.reduce((sum, h) => {
        return sum + ((h.helpfulness||0)+(h.correctness||0)+(h.coherence||0)+(h.complexity||0)+(h.verbosity||0))/5;
    }, 0) / recent.length;

    // Map audit quality to success likelihood
    const successPct = Math.min(98, Math.max(5, avgScore / 4.0 * 100 + (Math.random() - 0.5) * 5));
    const riskPct = Math.max(2, 100 - successPct);

    const el = id => document.getElementById(id);
    if (el('nv-success-fill')) el('nv-success-fill').style.width = successPct + '%';
    if (el('nv-success-pct')) el('nv-success-pct').textContent = successPct.toFixed(0) + '%';
    if (el('nv-risk-fill')) el('nv-risk-fill').style.width = riskPct + '%';
    if (el('nv-risk-pct')) el('nv-risk-pct').textContent = riskPct.toFixed(0) + '%';

    // Identify potential failure modes
    const failures = [];
    const lastH = nemotronHistory[nemotronHistory.length - 1];
    if ((lastH.coherence || 0) < 2.0) failures.push('Low coherence — coordination risk');
    if ((lastH.correctness || 0) < 2.0) failures.push('Low correctness — navigation errors');
    if ((lastH.helpfulness || 0) < 1.5) failures.push('Low helpfulness — inefficient task allocation');
    const avgBat = Object.values(roverStates).reduce((s, r) => s + r.battery, 0) / Math.max(1, Object.keys(roverStates).length);
    if (avgBat < 40) failures.push('Battery critical — mission endurance at risk');
    const inShadow = Object.values(roverStates).filter(s => s.in_shadow).length;
    if (inShadow > 2) failures.push(`${inShadow} rovers in shadow zone`);

    const failEl = el('nv-failures');
    if (failEl) {
        failEl.innerHTML = failures.length > 0 ?
            failures.map(f => '<div class="nv-fail-item">&#9888; ' + f + '</div>').join('') :
            '<div class="nv-fail-item nv-ok">&#10003; No critical risks detected</div>';
    }
}

// ============================================
// MISSION GOALS / OBJECTIVES TRACKING
// ============================================
function initMissionGoals() {
    const goalsPanel = document.getElementById('mission-goals');
    const listEl = document.getElementById('mission-objectives-list');
    if (!goalsPanel || !listEl) return;

    const sc = SCENARIOS[missionConfig.scenario] || SCENARIOS.exploration;
    listEl.innerHTML = '';
    sc.objectives.forEach((obj, i) => {
        const item = document.createElement('div');
        item.className = 'mg-objective';
        item.id = 'mg-obj-' + i;
        item.innerHTML = '<span class="mg-check">&#9675;</span><span class="mg-obj-text">' + obj + '</span>';
        listEl.appendChild(item);
    });

    goalsPanel.style.display = '';
}

function updateMissionGoals() {
    if (!missionActive) return;
    const sc = SCENARIOS[missionConfig.scenario] || SCENARIOS.exploration;
    if (!sc) return;

    // Compute progress per objective based on simulation state
    let completed = 0;
    const total = sc.objectives.length;

    // Generic progress heuristics based on scenario metrics
    const R = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 750;
    const cellSize = R * 0.1;
    const maxCells = Math.pow(Math.floor(R * 2 / cellSize), 2) * 0.7;
    const coveragePct = Math.min(100, (missionStats.coverageCells.size / maxCells) * 100);
    const iceFound = missionStats.iceFound;
    const totalIce = iceDeposits.length;
    const avgBat = Object.values(roverStates).reduce((s, r) => s + r.battery, 0) / Math.max(1, Object.keys(roverStates).length);

    if (constructionMode) {
        // Construction-specific objective completion
        const checks = [
            padPhaseIndex >= 1,  // Survey done
            padPhaseIndex >= 2,  // Grading done / collection started
            padPhaseIndex >= 3,  // Collection done / sintering started
            padPhaseIndex >= 4,  // Sintering done / placing started
            padPhase === 'COMPLETE' // Pad verified
        ];
        checks.forEach((done, i) => {
            const el = document.getElementById('mg-obj-' + i);
            if (el) {
                const check = el.querySelector('.mg-check');
                if (done && check) { check.innerHTML = '&#9679;'; el.classList.add('mg-done'); }
            }
            if (done) completed++;
        });
    } else {
        // General mission objective tracking
        const checks = [];
        for (let i = 0; i < total; i++) {
            const obj = sc.objectives[i].toLowerCase();
            let done = false;
            if (obj.includes('discover') || obj.includes('ice')) done = iceFound >= totalIce;
            else if (obj.includes('coverage') || obj.includes('map')) done = coveragePct > 80;
            else if (obj.includes('shadow') || obj.includes('return') || obj.includes('escape')) done = avgBat > 20;
            else if (obj.includes('relay') || obj.includes('communication')) done = coveragePct > 60;
            else if (obj.includes('locate')) done = iceFound > 0;
            else if (obj.includes('mine') || obj.includes('extract')) done = iceFound >= Math.ceil(totalIce * 0.5);
            else done = coveragePct > 50;
            checks.push(done);
        }
        checks.forEach((done, i) => {
            const el = document.getElementById('mg-obj-' + i);
            if (el) {
                const check = el.querySelector('.mg-check');
                if (done && check) { check.innerHTML = '&#9679;'; el.classList.add('mg-done'); }
            }
            if (done) completed++;
        });
    }

    // Update progress bar
    const pct = total > 0 ? (completed / total) * 100 : 0;
    const fill = document.getElementById('mission-progress-fill');
    const pctEl = document.getElementById('mission-progress-pct');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
}

// ============================================
// INTERACTIVE ONBOARDING
// ============================================
let onboardingStep = 0;

window.advanceOnboarding = function(step) {
    const overlay = document.getElementById('onboarding-overlay');
    if (!overlay) return;

    // Hide current step
    const current = document.getElementById('onb-step-' + step);
    if (current) current.style.display = 'none';

    if (step >= 3) {
        // End onboarding
        overlay.style.display = 'none';
        document.getElementById('orbit-instruction').style.display = 'block';
        return;
    }

    // Show next step
    const next = document.getElementById('onb-step-' + (step + 1));
    if (next) next.style.display = '';
    onboardingStep = step + 1;

    // Camera moves for each step
    if (step === 1) {
        // Slowly rotate camera to show south pole
        animateCameraTo(200, -1300, 1300, controls.target.x, controls.target.y, controls.target.z, 2.5);
    } else if (step === 2) {
        // Pull slightly closer
        animateCameraTo(-100, -1350, 1100, controls.target.x, controls.target.y, controls.target.z, 2.5);
    }
};

window.skipOnboarding = function() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.style.display = 'none';
    document.getElementById('orbit-instruction').style.display = 'block';
};

function showOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) {
        overlay.style.display = '';
        onboardingStep = 1;
    }
}

// ============================================
// BOOT
// ============================================
init();
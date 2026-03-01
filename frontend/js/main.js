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
const AppState = { ORBIT: 'ORBIT', CONFIG: 'CONFIG', ZOOMING: 'ZOOMING', LANDING: 'LANDING', SIMULATION: 'SIMULATION', EXPLORE: 'EXPLORE' };
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

// ---- Scene objects ----
let scene, camera, renderer, controls;
let moonGlobe, localTerrain, shadowMesh, dustParticles;
let craterMaterial, shadowMaterial;
let craterMarkers = [];
let roverMeshes = {}, roverTrails = {};
const clock = new THREE.Clock();

// ---- Loading scene ----
let loadingSceneRef = null;
let loadingGlitchInterval = null;
let currentLoadingStage = 0;

// ---- Landing sequence ----
let landerGroup = null;
let landerParticles = null;
let landingTimeline = null;
let landingDustPlume = null;

// ---- Explore mode ----
let exploreMode = false;
let exploreRoverMesh = null;
let exploreState = {
    x: 0, z: 0, y: 0,
    heading: 0,
    speed: 0,
    battery: 100,
    maxSpeed: 5,
    acceleration: 3,
    turnRate: 1.5,
    friction: 0.8,
};

// ---- Mission state ----
let missionStartTime = null;
let missionActive = false;
let telemetryWs = null, negotiationWs = null;
let roverStates = {};
let shadowBoundaryX = -250;

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
function activeRovers() { return ROVER_PALETTE.slice(0, missionConfig.numRovers); }

// ============================================
// LOADING PARTICLE SCENE
// ============================================
function initLoadingScene() {
    const canvas = document.getElementById('loading-canvas');
    if (!canvas) return;

    const loadingRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    loadingRenderer.setSize(window.innerWidth, window.innerHeight);
    loadingRenderer.setPixelRatio(1);

    const loadingScene = new THREE.Scene();
    const loadingCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    loadingCamera.position.set(0, 0, 8);

    // Create particle sphere
    const COUNT = 800;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        const r = 2.5 + (Math.random() - 0.5) * 0.3;
        pos[i*3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = r * Math.cos(phi);
        pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
        const temp = Math.random();
        const b = 0.5 + Math.random() * 0.5;
        col[i*3] = b * (temp < 0.5 ? 0.6 : 0.8);
        col[i*3+1] = b * (temp < 0.5 ? 0.8 : 0.9);
        col[i*3+2] = b;
        sizes[i] = 1.5 + Math.random() * 2.5;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 2, vertexColors: true, transparent: true, opacity: 0.7, sizeAttenuation: true
    }));
    loadingScene.add(points);

    // Second shell for depth
    const geo2 = new THREE.BufferGeometry();
    const pos2 = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        const r = 3.5 + Math.random() * 1.5;
        pos2[i*3] = r * Math.sin(phi) * Math.cos(theta);
        pos2[i*3+1] = r * Math.cos(phi);
        pos2[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
    }
    geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    const shell2 = new THREE.Points(geo2, new THREE.PointsMaterial({
        size: 1, color: 0x4a9eff, transparent: true, opacity: 0.2, sizeAttenuation: true
    }));
    loadingScene.add(shell2);

    let frameId;
    function loadingAnimate() {
        frameId = requestAnimationFrame(loadingAnimate);
        points.rotation.y += 0.003;
        points.rotation.x += 0.001;
        shell2.rotation.y -= 0.002;
        loadingRenderer.render(loadingScene, loadingCamera);
    }
    loadingAnimate();

    loadingSceneRef = { renderer: loadingRenderer, frameId, scene: loadingScene };

    // Glitch effect interval
    loadingGlitchInterval = setInterval(() => {
        const content = document.getElementById('loading-content');
        if (content) {
            content.classList.add('loading-glitch');
            setTimeout(() => content.classList.remove('loading-glitch'), 150);
        }
    }, 2500 + Math.random() * 2000);
}

function cleanupLoadingScene() {
    if (loadingSceneRef) {
        cancelAnimationFrame(loadingSceneRef.frameId);
        loadingSceneRef.renderer.dispose();
        loadingSceneRef = null;
    }
    if (loadingGlitchInterval) {
        clearInterval(loadingGlitchInterval);
        loadingGlitchInterval = null;
    }
}

// ============================================
// INIT
// ============================================
function init() {
    initLoadingScene();
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
            cleanupLoadingScene();
            if (typeof gsap !== 'undefined' && loadingEl) {
                const tl = gsap.timeline({
                    onComplete: () => {
                        loadingEl.style.display = 'none';
                        const orbitInst = document.getElementById('orbit-instruction');
                        orbitInst.style.display = 'block';
                        orbitInst.style.opacity = '0';
                        gsap.to(orbitInst, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' });
                    }
                });
                tl.to('#loading-content', { opacity: 0, scale: 0.95, duration: 0.6, ease: 'power2.in' })
                  .to('#loading-canvas', { opacity: 0, duration: 0.5, ease: 'power2.in' }, '-=0.3')
                  .to('#loading-indicator', { opacity: 0, duration: 0.4 });
            } else {
                if (loadingEl) loadingEl.style.display = 'none';
                document.getElementById('orbit-instruction').style.display = 'block';
            }
            addCraterMarkers();
            console.log('NASA Moon + crater markers loaded');
        },
        (progress) => {
            const pct = progress.total ? Math.round(progress.loaded / progress.total * 100) : 0;
            const bar = document.getElementById('loading-bar-fill');
            const pctEl = document.getElementById('loading-pct');
            if (bar) bar.style.width = pct + '%';
            if (pctEl) pctEl.textContent = pct + '%';

            // Multi-stage loading messages
            let targetStage = 0;
            if (pct >= 85) targetStage = 4;
            else if (pct >= 65) targetStage = 3;
            else if (pct >= 40) targetStage = 2;
            else if (pct >= 15) targetStage = 1;

            if (targetStage !== currentLoadingStage) {
                const stages = document.querySelectorAll('.loading-stage');
                if (stages.length > 0) {
                    stages[currentLoadingStage]?.classList.remove('active');
                    stages[currentLoadingStage]?.classList.add('done');
                    stages[targetStage]?.classList.add('active');
                    currentLoadingStage = targetStage;
                }
            }
        },
        (error) => {
            console.warn('Moon GLB failed:', error);
            cleanupLoadingScene();
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

    const panel = document.getElementById('config-panel');
    panel.classList.add('visible');
    if (typeof gsap !== 'undefined') {
        gsap.fromTo(panel, { x: 500, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
    }
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
};

window.cancelConfig = function() {
    const panel = document.getElementById('config-panel');
    if (typeof gsap !== 'undefined') {
        gsap.to(panel, { x: 500, opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: () => panel.classList.remove('visible') });
    } else {
        panel.classList.remove('visible');
    }
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
    if (t >= 1.0) startLandingSequence();
}

// ============================================
// TRANSITION TO SIMULATION
// ============================================
function transitionToSimulation() {
    currentState = AppState.SIMULATION;
    if (moonGlobe) moonGlobe.visible = false;

    const craterRadius = selectedCrater.diameter_km * CRATER_SCALE;
    const craterDepth = selectedCrater.depth_km * DEPTH_SCALE;

    createLocalTerrain(craterRadius, craterDepth);
    createShadowOverlay(craterRadius);
    createDustParticles(craterRadius, craterDepth);

    camera.position.set(0, craterRadius * 0.5, craterRadius * 0.7);
    camera.lookAt(0, -craterDepth * 0.3, 0);
    controls.target.set(0, -craterDepth * 0.3, 0);
    controls.enabled = true;
    controls.minDistance = 20;
    controls.maxDistance = craterRadius * 2;

    initRoverStates(craterRadius);
    createRovers(craterRadius, craterDepth);

    // Frontier technique overlays
    generateIceDeposits(craterRadius, craterDepth);
    createIceMarkers(craterRadius, craterDepth);
    createCommsMesh();
    createVoronoiOverlay(craterRadius);

    document.getElementById('rover-strip').style.display = '';
    document.getElementById('side-panel').style.display = '';
    document.getElementById('bottom-bar').style.display = '';
    document.getElementById('sim-controls').style.display = 'flex';
    document.getElementById('minimap-container').style.display = 'block';
    // GSAP staggered entrance
    if (typeof gsap !== 'undefined') {
        gsap.from('#sim-controls', { y: -50, opacity: 0, duration: 0.5, ease: 'power2.out' });
        gsap.from('#rover-strip', { y: 50, opacity: 0, duration: 0.5, delay: 0.1, ease: 'power2.out' });
        gsap.from('#side-panel', { x: -50, opacity: 0, duration: 0.5, delay: 0.15, ease: 'power2.out' });
        gsap.from('#bottom-bar', { y: 50, opacity: 0, duration: 0.4, delay: 0.2, ease: 'power2.out' });
        gsap.from('#minimap-container', { scale: 0.7, opacity: 0, duration: 0.4, delay: 0.25, ease: 'back.out(1.4)' });
    }
    initHUD();
    initViewTabs();
    initMinimap();

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

    // Auto-launch tour on first ever mission
    if (!localStorage.getItem('regolith_tour_done')) {
        setTimeout(() => startTour(), 1500);
    }
}

// ============================================
// BACK TO MAP
// ============================================
window.backToMap = function() {
    missionActive = false;
    if (exploreMode) window.toggleExploreMode();
    if (exploreRoverMesh) { scene.remove(exploreRoverMesh); exploreRoverMesh = null; }
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

    const label = createTextSprite(name, color);
    label.position.set(0, 48, 0);
    label.scale.set(240, 60, 1); // Counterscale group.scale for readable labels
    group.add(label);

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
        group.scale.setScalar(ROVER_MESH_SCALE);
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
    const maxLinks = 15; // max rover pairs
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
    const positions = new Float32Array(2000 * 3); // up to 2000 vertices
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
                    if (closest !== nClosest && vertexIndex < 1998) {
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
                    if (closest !== nClosest && vertexIndex < 1998) {
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
    if (typeof gsap !== 'undefined') {
        gsap.fromTo(toast, { x: 120, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'back.out(1.2)' });
        setTimeout(() => {
            gsap.to(toast, { x: 120, opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: () => toast.remove() });
        }, duration);
    } else {
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    // Keep max 5 toasts
    while (container.children.length > 5) container.removeChild(container.firstChild);
}

// ============================================
// VIEW TABS (Camera Switching)
// ============================================
function initViewTabs() {
    const container = document.getElementById('view-tabs');
    if (!container) return;
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
    if (typeof gsap !== 'undefined') {
        gsap.from('.pm-backdrop', { opacity: 0, duration: 0.4 });
        gsap.from('.pm-card', { y: 50, opacity: 0, duration: 0.5, delay: 0.1, ease: 'power3.out' });
        gsap.from('.pm-stat', { y: 20, opacity: 0, stagger: 0.07, duration: 0.3, delay: 0.3, ease: 'power2.out' });
    }

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
        const gauge = document.getElementById('gauge-' + id);
        if (!gauge) continue;
        const score = scores[id] || 0;
        const value = gauge.querySelector('.score-val');
        if (value) {
            value.textContent = score.toFixed(1);
            const norm = score / 4.0;
            value.style.color = norm > 0.7 ? '#00d47e' : norm > 0.4 ? '#f0ad4e' : '#ff3b5c';
        }
    }
    // Track for post-mission analytics
    nemotronHistory.push({ time: getElapsedTime(), ...scores });
    totalAIDecisions++;
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
    } else if (currentState === AppState.LANDING) {
        const dt2 = Math.min(clock.getDelta(), 0.1);
        updateLandingParticles(dt2);
        if (craterMaterial) craterMaterial.uniforms.uTime.value = time;
        if (shadowMaterial) shadowMaterial.uniforms.uTime.value = time;
        if (dustParticles) dustParticles.material.uniforms.uTime.value = time;
        if (landerGroup) camera.lookAt(landerGroup.position);
    } else if (currentState === AppState.SIMULATION) {
        // Local simulation tick
        tickLocalSim(dt);

        if (craterMaterial) { craterMaterial.uniforms.uTime.value = time; craterMaterial.uniforms.uCameraPosition.value.copy(camera.position); }
        if (shadowMaterial) shadowMaterial.uniforms.uTime.value = time;
        if (dustParticles) dustParticles.material.uniforms.uTime.value = time;
        updateRovers(time);
        updatePOVCamera(dt);
        updateFreeCam(dt);
        updateMinimap();
        updateMissionAnalytics(dt);
        updateHUD();
        if (exploreMode) {
            updateExploreRover(dt);
        }
        if (!povRoverId && !exploreMode) controls.update();
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
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
}

function updateMinimap() {
    if (!minimapCtx || !selectedCrater) return;
    const ctx = minimapCtx;
    const w = 180, h = 180;
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
    for (const [id, state] of Object.entries(roverStates)) {
        const r = ROVER_PALETTE.find(p => p.id === id);
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
    if (e.key === 'Escape' && exploreMode) {
        window.toggleExploreMode();
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
// EDUCATIONAL INFO PANEL
// ============================================
window.showEduPanel = function() {
    if (!selectedCrater || !selectedCrater.education) return;
    const panel = document.getElementById('edu-panel');
    if (!panel) return;
    panel.style.display = '';

    document.getElementById('edu-crater-name').textContent = selectedCrater.name + ' — Exploration History';

    // Render timeline
    const timelineEl = document.getElementById('edu-tab-timeline');
    const edu = selectedCrater.education;
    timelineEl.innerHTML = '<div class="edu-timeline">' + edu.history.map(h =>
        '<div class="edu-tl-item">' +
            '<div class="edu-tl-year">' + h.year + '</div>' +
            '<div class="edu-tl-content">' +
                '<div class="edu-tl-mission">' + h.mission + ' <span class="edu-tl-agency">' + h.agency + '</span></div>' +
                '<div class="edu-tl-detail">' + h.detail + '</div>' +
                '<div class="edu-tl-cite">' + h.citation + '</div>' +
            '</div>' +
        '</div>'
    ).join('') + '</div>';

    // Render discoveries
    const discEl = document.getElementById('edu-tab-discoveries');
    discEl.innerHTML = '<ul class="edu-disc-list">' + edu.discoveries.map(d =>
        '<li class="edu-disc-item">' + d + '</li>'
    ).join('') + '</ul>';

    // Render context
    const ctxEl = document.getElementById('edu-tab-context');
    ctxEl.innerHTML = '<div class="edu-context">' + edu.lunarContext + '</div>';

    // Reset tabs
    document.querySelectorAll('.edu-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.edu-tab[data-tab="timeline"]').classList.add('active');
    document.querySelectorAll('.edu-tab-content').forEach(c => c.style.display = 'none');
    document.getElementById('edu-tab-timeline').style.display = '';

    if (typeof gsap !== 'undefined') {
        gsap.from('.edu-backdrop', { opacity: 0, duration: 0.3 });
        gsap.from('.edu-card', { y: 40, opacity: 0, duration: 0.4, delay: 0.1, ease: 'power3.out' });
        gsap.from('.edu-tl-item', { x: -20, opacity: 0, stagger: 0.08, duration: 0.3, delay: 0.2, ease: 'power2.out' });
    }
};

window.closeEduPanel = function() {
    const panel = document.getElementById('edu-panel');
    if (!panel) return;
    if (typeof gsap !== 'undefined') {
        gsap.to('.edu-card', { y: 30, opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: () => panel.style.display = 'none' });
    } else {
        panel.style.display = 'none';
    }
};

window.switchEduTab = function(tab) {
    document.querySelectorAll('.edu-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.edu-tab-content').forEach(c => c.style.display = 'none');
    const el = document.getElementById('edu-tab-' + tab);
    if (el) {
        el.style.display = '';
        if (typeof gsap !== 'undefined') {
            gsap.from(el, { opacity: 0, y: 10, duration: 0.25 });
        }
    }
};

// ============================================
// LANDING SEQUENCE (Cinematic Cutscene)
// ============================================
function createLanderModel() {
    const group = new THREE.Group();

    // Descent stage body
    const bodyGeo = new THREE.CylinderGeometry(6, 8, 5, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.3, metalness: 0.8 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Thrust nozzle
    const nozzleGeo = new THREE.ConeGeometry(3, 4, 8);
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5, metalness: 0.7 });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.position.y = -4.5;
    nozzle.rotation.x = Math.PI;
    group.add(nozzle);

    // Landing legs (4)
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const legGeo = new THREE.CylinderGeometry(0.3, 0.3, 10, 6);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 });
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(Math.cos(angle) * 7, -5, Math.sin(angle) * 7);
        leg.rotation.z = Math.cos(angle) * 0.3;
        leg.rotation.x = Math.sin(angle) * 0.3;
        group.add(leg);

        const padGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.3, 12);
        const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: 0x555555 }));
        pad.position.set(Math.cos(angle) * 9, -9.5, Math.sin(angle) * 9);
        group.add(pad);
    }

    // Antenna
    const antGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 6);
    const ant = new THREE.Mesh(antGeo, new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9 }));
    ant.position.set(0, 5, 0);
    group.add(ant);

    // Solar panels
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x0a2a6a, roughness: 0.15, metalness: 0.85 });
    [-1, 1].forEach(side => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 5), panelMat);
        panel.position.set(side * 10, 1, 0);
        group.add(panel);
    });

    return group;
}

function createLanderParticles() {
    const COUNT = 300;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    const lifetimes = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
        positions[i*3] = (Math.random() - 0.5) * 4;
        positions[i*3+1] = -6 - Math.random() * 20;
        positions[i*3+2] = (Math.random() - 0.5) * 4;
        velocities[i*3] = (Math.random() - 0.5) * 2;
        velocities[i*3+1] = -5 - Math.random() * 15;
        velocities[i*3+2] = (Math.random() - 0.5) * 2;
        lifetimes[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.userData = { velocities, lifetimes };

    const particles = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 3, color: 0xffaa33, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false
    }));

    return particles;
}

function createLandingDust(craterRadius, craterDepth) {
    const COUNT = 500;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        positions[i*3] = Math.cos(angle) * 2;
        positions[i*3+1] = craterHeight(0, 0) + 1;
        positions[i*3+2] = Math.sin(angle) * 2;
        const speed = 5 + Math.random() * 15;
        velocities[i*3] = Math.cos(angle) * speed;
        velocities[i*3+1] = 2 + Math.random() * 5;
        velocities[i*3+2] = Math.sin(angle) * speed;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.userData = { velocities, startTime: 0, active: false };

    const dust = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 2.5, color: 0x998877, transparent: true, opacity: 0,
        blending: THREE.NormalBlending, depthWrite: false
    }));

    return dust;
}

function startLandingSequence() {
    currentState = AppState.LANDING;

    const craterRadius = selectedCrater.diameter_km * CRATER_SCALE;
    const craterDepth = selectedCrater.depth_km * DEPTH_SCALE;

    // Create terrain first
    createLocalTerrain(craterRadius, craterDepth);
    createShadowOverlay(craterRadius);
    createDustParticles(craterRadius, craterDepth);

    const landingY = craterHeight(0, 0) + 10;
    const startY = landingY + 250;

    landerGroup = createLanderModel();
    landerGroup.position.set(0, startY, 0);
    landerGroup.scale.setScalar(0.8);
    scene.add(landerGroup);

    landerParticles = createLanderParticles();
    landerGroup.add(landerParticles);

    landingDustPlume = createLandingDust(craterRadius, craterDepth);
    scene.add(landingDustPlume);

    // Camera choreography
    const camStart = { x: craterRadius * 0.3, y: startY + 100, z: craterRadius * 0.5 };
    camera.position.set(camStart.x, camStart.y, camStart.z);
    camera.lookAt(0, startY, 0);

    if (typeof gsap !== 'undefined') {
        landingTimeline = gsap.timeline({
            onComplete: () => {
                finishLanding(craterRadius, craterDepth);
            }
        });

        // Phase 1: Wide descent (0-2.5s)
        landingTimeline.to(landerGroup.position, { y: landingY + 80, duration: 2.5, ease: 'power1.in' }, 0);
        landingTimeline.to(camera.position, { x: craterRadius * 0.2, y: landingY + 120, z: craterRadius * 0.35, duration: 2.5, ease: 'power1.inOut' }, 0);

        // Phase 2: Deceleration (2.5-4.5s)
        landingTimeline.to(landerGroup.position, { y: landingY + 20, duration: 2, ease: 'power2.out' });
        landingTimeline.to(camera.position, { x: craterRadius * 0.12, y: landingY + 35, z: craterRadius * 0.2, duration: 2, ease: 'power2.inOut' }, '-=2');

        // Phase 3: Final descent + touchdown (4.5-6s)
        landingTimeline.to(landerGroup.position, { y: landingY, duration: 1.5, ease: 'bounce.out' });
        landingTimeline.to(camera.position, { y: landingY + 25, duration: 1.5, ease: 'power2.inOut' }, '-=1.5');

        // Phase 4: Camera shake on impact
        landingTimeline.call(() => {
            if (landingDustPlume) {
                landingDustPlume.material.opacity = 0.6;
                landingDustPlume.geometry.userData.active = true;
                landingDustPlume.geometry.userData.startTime = clock.getElapsedTime();
            }
            // Camera shake
            const originalPos = camera.position.clone();
            gsap.to(camera.position, {
                x: originalPos.x + (Math.random() - 0.5) * 4,
                y: originalPos.y + (Math.random() - 0.5) * 3,
                z: originalPos.z + (Math.random() - 0.5) * 4,
                duration: 0.06, repeat: 6, yoyo: true, ease: 'power1.inOut'
            });
        });

        // Phase 5: Settle (6-7.5s)
        landingTimeline.to({}, { duration: 1.5 });

        // Phase 6: Pull back to overview (7.5-8.5s)
        landingTimeline.to(camera.position, {
            x: 0, y: craterRadius * 0.5, z: craterRadius * 0.7,
            duration: 1.0, ease: 'power2.inOut'
        });
    } else {
        // Fallback: skip to simulation
        finishLanding(craterRadius, craterDepth);
    }
}

function updateLandingParticles(dt) {
    if (landerParticles && landerGroup) {
        const positions = landerParticles.geometry.attributes.position.array;
        const vels = landerParticles.geometry.userData.velocities;
        const lifetimes = landerParticles.geometry.userData.lifetimes;

        for (let i = 0; i < lifetimes.length; i++) {
            lifetimes[i] -= dt * 2;
            if (lifetimes[i] <= 0) {
                // Respawn
                positions[i*3] = (Math.random() - 0.5) * 3;
                positions[i*3+1] = -5;
                positions[i*3+2] = (Math.random() - 0.5) * 3;
                lifetimes[i] = 0.5 + Math.random() * 0.5;
            } else {
                positions[i*3] += vels[i*3] * dt;
                positions[i*3+1] += vels[i*3+1] * dt;
                positions[i*3+2] += vels[i*3+2] * dt;
            }
        }
        landerParticles.geometry.attributes.position.needsUpdate = true;

        // Fade particles as lander approaches ground
        const altitude = landerGroup.position.y - (craterHeight(0, 0) + 10);
        landerParticles.material.opacity = Math.min(0.9, Math.max(0.1, altitude / 100));
    }

    // Dust plume
    if (landingDustPlume && landingDustPlume.geometry.userData.active) {
        const positions = landingDustPlume.geometry.attributes.position.array;
        const vels = landingDustPlume.geometry.userData.velocities;
        const elapsed = clock.getElapsedTime() - landingDustPlume.geometry.userData.startTime;

        for (let i = 0; i < vels.length / 3; i++) {
            positions[i*3] += vels[i*3] * dt * 0.5;
            positions[i*3+1] += vels[i*3+1] * dt * 0.3;
            positions[i*3+2] += vels[i*3+2] * dt * 0.5;
            // Gravity settling
            vels[i*3+1] -= 1.625 * dt;
        }
        landingDustPlume.geometry.attributes.position.needsUpdate = true;
        landingDustPlume.material.opacity = Math.max(0, 0.6 - elapsed * 0.3);
    }
}

function finishLanding(craterRadius, craterDepth) {
    // Clean up lander
    if (landerGroup) { scene.remove(landerGroup); landerGroup = null; }
    if (landerParticles) landerParticles = null;
    if (landingDustPlume) { scene.remove(landingDustPlume); landingDustPlume = null; }
    landingTimeline = null;

    // Continue to simulation
    transitionToSimulation();
}

// ============================================
// CRATER EXPLORATION MODE
// User drives a rover in 3rd person
// ============================================
window.toggleExploreMode = function() {
    if (!missionActive && currentState !== AppState.SIMULATION) return;

    exploreMode = !exploreMode;
    const btn = document.getElementById('explore-btn');
    const hud = document.getElementById('explore-hud');

    if (exploreMode) {
        // Enter explore mode
        if (btn) btn.classList.add('active');
        if (hud) {
            hud.style.display = '';
            if (typeof gsap !== 'undefined') gsap.from(hud, { y: 30, opacity: 0, duration: 0.3 });
        }
        controls.enabled = false;
        povRoverId = null;
        if (document.getElementById('pov-hud')) document.getElementById('pov-hud').style.display = 'none';

        // Create explore rover if not exists
        if (!exploreRoverMesh) {
            exploreRoverMesh = createRoverMesh(0xffffff, 'EXPLORER');
            exploreRoverMesh.scale.setScalar(ROVER_MESH_SCALE * 1.2);
            scene.add(exploreRoverMesh);
        }

        // Position at a safe spot
        const R = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 200;
        exploreState.x = R * 0.3;
        exploreState.z = 0;
        exploreState.y = craterHeight(exploreState.x, exploreState.z) + 2;
        exploreState.heading = Math.PI;
        exploreState.speed = 0;
        exploreState.battery = 100;
        exploreRoverMesh.position.set(exploreState.x, exploreState.y, exploreState.z);
        exploreRoverMesh.visible = true;

        addLogEntry('system', 'EXPLORE MODE — Manual rover control enabled. Use WASD to drive.');
    } else {
        // Exit explore mode
        if (btn) btn.classList.remove('active');
        if (hud) hud.style.display = 'none';
        controls.enabled = true;
        if (exploreRoverMesh) exploreRoverMesh.visible = false;
        addLogEntry('system', 'EXPLORE MODE disabled. Orbit camera restored.');
    }
};

function updateExploreRover(dt) {
    if (!exploreMode || !exploreRoverMesh) return;

    const R = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 200;

    // Steering
    let steer = 0;
    if (keysDown['a'] || keysDown['arrowleft']) steer = -exploreState.turnRate;
    if (keysDown['d'] || keysDown['arrowright']) steer = exploreState.turnRate;

    // Thrust
    if (keysDown['w'] || keysDown['arrowup']) {
        exploreState.speed += exploreState.acceleration * dt;
    } else if (keysDown['s'] || keysDown['arrowdown']) {
        exploreState.speed -= exploreState.acceleration * 2 * dt;
    } else {
        exploreState.speed *= (1 - exploreState.friction * dt);
    }

    const boost = keysDown['shift'] ? 2 : 1;
    exploreState.speed = Math.max(-exploreState.maxSpeed * 0.3, Math.min(exploreState.maxSpeed * boost, exploreState.speed));

    // Turn (scales with speed)
    const turnFactor = Math.min(1, Math.abs(exploreState.speed) / exploreState.maxSpeed);
    exploreState.heading += steer * turnFactor * dt;

    // Move
    const newX = exploreState.x + Math.sin(exploreState.heading) * exploreState.speed * dt;
    const newZ = exploreState.z + Math.cos(exploreState.heading) * exploreState.speed * dt;

    // Slope check
    const h = craterHeight(newX, newZ);
    const dx = craterHeight(newX + 0.5, newZ) - craterHeight(newX - 0.5, newZ);
    const dz = craterHeight(newX, newZ + 0.5) - craterHeight(newX, newZ - 0.5);
    const slopeAngle = Math.atan(Math.sqrt(dx*dx + dz*dz)) * (180 / Math.PI);

    if (slopeAngle <= 30) {
        exploreState.x = newX;
        exploreState.z = newZ;
        exploreState.y = h + 2;
    } else {
        exploreState.speed *= -0.2;
    }

    // Clamp to crater
    const r = Math.sqrt(exploreState.x ** 2 + exploreState.z ** 2);
    if (r > R * 0.95) {
        exploreState.x *= (R * 0.9) / r;
        exploreState.z *= (R * 0.9) / r;
        exploreState.speed *= 0.3;
    }

    // Battery
    exploreState.battery -= 0.02 * Math.abs(exploreState.speed) * dt;
    if (exploreState.x < shadowBoundaryX) exploreState.battery -= 0.1 * dt;
    exploreState.battery = Math.max(0, exploreState.battery);

    // Update mesh
    exploreRoverMesh.position.set(exploreState.x, exploreState.y, exploreState.z);
    exploreRoverMesh.rotation.y = exploreState.heading;

    // Chase camera
    const forward = new THREE.Vector3(Math.sin(exploreState.heading), 0, Math.cos(exploreState.heading));
    const camTarget = new THREE.Vector3(
        exploreState.x - forward.x * 35,
        exploreState.y + 18,
        exploreState.z - forward.z * 35
    );
    const lookTarget = new THREE.Vector3(
        exploreState.x + forward.x * 25,
        exploreState.y + 3,
        exploreState.z + forward.z * 25
    );
    camera.position.lerp(camTarget, 0.07);
    const tempTarget = new THREE.Vector3().copy(controls.target).lerp(lookTarget, 0.07);
    camera.lookAt(tempTarget);

    // Update HUD
    const spdEl = document.getElementById('explore-speed');
    const posEl = document.getElementById('explore-pos');
    const batEl = document.getElementById('explore-battery');
    const slopeEl = document.getElementById('explore-slope');
    const altEl = document.getElementById('explore-alt');
    if (spdEl) spdEl.textContent = Math.abs(exploreState.speed).toFixed(1) + ' m/s';
    if (posEl) posEl.textContent = '(' + exploreState.x.toFixed(0) + ', ' + exploreState.z.toFixed(0) + ')';
    if (batEl) batEl.textContent = exploreState.battery.toFixed(0) + '%';
    if (slopeEl) slopeEl.textContent = slopeAngle.toFixed(1) + '\u00B0';
    if (altEl) altEl.textContent = (-exploreState.y).toFixed(0) + ' m';
}

// ============================================
// BOOT
// ============================================
init();

// ============================================
// INTERACTIVE WALKTHROUGH TOUR
// Guided step-by-step introduction to the UI
// ============================================
const TOUR_STEPS = [
    {
        target: '#top-bar',
        title: 'MISSION HEADER',
        body: 'This bar shows the current crater name, mission elapsed time, and operational status. The scenario badge indicates which mission type is active.',
        position: 'below',
    },
    {
        target: '#sim-controls',
        title: 'CONTROL BAR',
        body: 'Switch camera views, control simulation speed, and access tools from here.<br><br><span class="tour-key">1×–10×</span> adjusts time. <span class="tour-key">THERMAL</span> toggles science heatmap. <span class="tour-key">VOICE</span> enables AI narrator. <span class="tour-key">END MISSION</span> stops and shows analytics.',
        position: 'below',
    },
    {
        target: '#view-tabs',
        title: 'CAMERA VIEWS',
        body: 'Switch between <b>ORBIT</b> (free camera) and individual rover POV cameras. Each rover tab shows a color-coded dot matching its identity on the map.',
        position: 'below',
    },
    {
        target: '#rover-strip',
        title: 'ROVER STATUS STRIP',
        body: 'Each pill shows a rover\'s name, battery bar, and current task. Click <b>POV</b> on any rover to enter its first-person chase camera.<br><br>Rovers that enter the shadow zone will glow red as a warning.',
        position: 'below',
    },
    {
        target: '#side-panel',
        title: 'MISSION LOG',
        body: 'Real-time feed of all swarm events — negotiations (CFP → BID → AWARD), Claude AI decisions, Nemotron audits, and system alerts. Click the toggle to collapse it.',
        position: 'left',
    },
    {
        target: '.bb-nemotron',
        title: 'NEMOTRON AUDIT SCORES',
        body: 'NVIDIA Nemotron-3 Nano evaluates every swarm decision across 5 dimensions, each scored 0–4:<br><br>' +
              '<b>HELP</b> — Mission optimality<br>' +
              '<b>CORR</b> — Logical soundness<br>' +
              '<b>COHR</b> — Situational coherence<br>' +
              '<b>CPLX</b> — Coordination sophistication<br>' +
              '<b>VERB</b> — Communication conciseness<br><br>' +
              'Colors: <span style="color:#00d47e">green</span> > 70%, <span style="color:#f0ad4e">amber</span> > 40%, <span style="color:#ff3b5c">red</span> below.',
        position: 'above',
    },
    {
        target: '.bb-metrics',
        title: 'MISSION METRICS',
        body: '<b>COV</b> — Crater coverage %<br>' +
              '<b>DIST</b> — Total meters traveled<br>' +
              '<b>ICE</b> — Deposits discovered / total<br>' +
              '<b>BATT</b> — Average swarm battery<br><br>' +
              'These update in real-time as rovers explore.',
        position: 'above',
    },
    {
        target: '#minimap-container',
        title: 'TACTICAL MINIMAP',
        body: 'Overhead radar showing all rover positions, ice deposits (diamonds), communication links, Voronoi territories, and the advancing shadow boundary (purple dashed line).',
        position: 'left',
    },
    {
        target: '#canvas-container',
        title: 'KEYBOARD CONTROLS',
        body: 'Navigate the 3D scene with these controls:<br><br>' +
              '<span class="tour-key">W</span><span class="tour-key">A</span><span class="tour-key">S</span><span class="tour-key">D</span> — Move camera<br>' +
              '<span class="tour-key">Q</span><span class="tour-key">E</span> — Altitude up/down<br>' +
              '<span class="tour-key">H</span> — Toggle heatmap<br>' +
              '<span class="tour-key">N</span> — Toggle narrator<br>' +
              '<span class="tour-key">ESC</span> — Exit rover POV<br>' +
              '<span class="tour-key">Shift</span> — Boost speed',
        position: 'center',
    },
];

let tourStep = 0;
let tourActive = false;

window.startTour = function() {
    tourStep = 0;
    tourActive = true;
    document.getElementById('tour-overlay').style.display = '';
    renderTourStep();
};

window.tourNext = function() {
    if (tourStep < TOUR_STEPS.length - 1) {
        tourStep++;
        renderTourStep();
    } else {
        endTour();
    }
};

window.tourPrev = function() {
    if (tourStep > 0) {
        tourStep--;
        renderTourStep();
    }
};

function endTour() {
    tourActive = false;
    const overlay = document.getElementById('tour-overlay');
    overlay.style.display = 'none';
    localStorage.setItem('regolith_tour_done', '1');
}

function renderTourStep() {
    const step = TOUR_STEPS[tourStep];
    const overlay = document.getElementById('tour-overlay');
    const spotlight = document.getElementById('tour-spotlight');
    const card = document.getElementById('tour-card');
    const title = document.getElementById('tour-title');
    const body = document.getElementById('tour-body');
    const prevBtn = document.getElementById('tour-prev');
    const nextBtn = document.getElementById('tour-next');
    const indicator = document.getElementById('tour-step-indicator');

    // Step dots
    indicator.innerHTML = TOUR_STEPS.map((_, i) => {
        const cls = i < tourStep ? 'tour-dot done' : i === tourStep ? 'tour-dot active' : 'tour-dot';
        return '<div class="' + cls + '"></div>';
    }).join('');

    title.textContent = step.title;
    body.innerHTML = step.body;
    prevBtn.style.display = tourStep === 0 ? 'none' : '';
    nextBtn.innerHTML = tourStep === TOUR_STEPS.length - 1 ? 'FINISH &#10003;' : 'NEXT &#8594;';

    // Remove old arrow classes
    card.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');

    // Deferred measurement for accurate card height
    requestAnimationFrame(() => {
        const el = document.querySelector(step.target);
        if (el && step.position !== 'center') {
            const rect = el.getBoundingClientRect();
            const pad = 10;

            const spotProps = {
                left: (rect.left - pad) + 'px',
                top: (rect.top - pad) + 'px',
                width: (rect.width + pad * 2) + 'px',
                height: (rect.height + pad * 2) + 'px',
                display: ''
            };

            if (typeof gsap !== 'undefined') {
                gsap.to(spotlight, { ...spotProps, duration: 0.4, ease: 'power2.out' });
            } else {
                Object.assign(spotlight.style, spotProps);
            }

            const cardW = 340;
            const cardH = card.offsetHeight || 200;
            let cx, cy;
            let pos = step.position;

            // Calculate card position
            if (pos === 'below') {
                cx = rect.left + rect.width / 2 - cardW / 2;
                cy = rect.bottom + 18;
                if (cy + cardH > window.innerHeight - 20) { pos = 'above'; cy = rect.top - cardH - 18; }
            } else if (pos === 'above') {
                cx = rect.left + rect.width / 2 - cardW / 2;
                cy = rect.top - cardH - 18;
                if (cy < 20) { pos = 'below'; cy = rect.bottom + 18; }
            } else if (pos === 'left') {
                cx = rect.left - cardW - 18;
                cy = rect.top + rect.height / 2 - cardH / 2;
                if (cx < 20) { pos = 'right'; cx = rect.right + 18; }
            } else if (pos === 'right') {
                cx = rect.right + 18;
                cy = rect.top + rect.height / 2 - cardH / 2;
                if (cx + cardW > window.innerWidth - 20) { pos = 'left'; cx = rect.left - cardW - 18; }
            }

            cx = Math.max(16, Math.min(window.innerWidth - cardW - 16, cx));
            cy = Math.max(16, Math.min(window.innerHeight - cardH - 16, cy));

            // Arrow direction
            if (pos === 'below') card.classList.add('arrow-top');
            else if (pos === 'above') card.classList.add('arrow-bottom');
            else if (pos === 'left') card.classList.add('arrow-right');
            else if (pos === 'right') card.classList.add('arrow-left');

            if (typeof gsap !== 'undefined') {
                gsap.to(card, { left: cx, top: cy, opacity: 1, duration: 0.35, ease: 'power2.out' });
            } else {
                card.style.left = cx + 'px';
                card.style.top = cy + 'px';
            }
        } else {
            spotlight.style.display = 'none';
            const cardW = 340;
            card.style.left = (window.innerWidth / 2 - cardW / 2) + 'px';
            card.style.top = (window.innerHeight / 2 - 120) + 'px';
        }
    });
}

// ESC closes tour
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tourActive) endTour();
});
window.addEventListener('resize', () => {
    if (tourActive) renderTourStep();
});

// ============================================
// RESEARCH PANEL
// ============================================
window.toggleResearchPanel = function() {
    const panel = document.getElementById('research-panel');
    if (!panel) return;
    const visible = panel.style.display !== 'none';
    if (visible) {
        if (typeof gsap !== 'undefined') {
            gsap.to(panel, { x: 420, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => panel.style.display = 'none' });
        } else {
            panel.style.display = 'none';
        }
    } else {
        panel.style.display = '';
        if (typeof gsap !== 'undefined') {
            gsap.fromTo(panel, { x: 420, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' });
        }
        updateScoreTimeline();
        updateScoreStats();
    }
};

window.switchResearchTab = function(tab) {
    document.querySelectorAll('.rp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    ['scores', 'tuning', 'export'].forEach(id => {
        const el = document.getElementById('rp-tab-' + id);
        if (el) el.style.display = id === tab ? '' : 'none';
    });
    if (tab === 'scores') {
        updateScoreTimeline();
        updateScoreStats();
    }
};

function updateScoreTimeline() {
    const canvas = document.getElementById('score-timeline-canvas');
    if (!canvas || nemotronHistory.length === 0) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = h - (i / 4) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const colors = { helpfulness: '#4a9eff', correctness: '#00d47e', coherence: '#f0ad4e', complexity: '#a855f7', verbosity: '#ff3b5c' };
    const keys = Object.keys(colors);
    const maxPoints = 40;
    const data = nemotronHistory.slice(-maxPoints);
    const step = w / Math.max(data.length - 1, 1);

    for (const key of keys) {
        ctx.strokeStyle = colors[key];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        data.forEach((d, i) => {
            const x = i * step;
            const y = h - ((d[key] || 0) / 4) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

function updateScoreStats() {
    if (nemotronHistory.length === 0) return;
    const el = id => document.getElementById(id);

    const avgs = nemotronHistory.map(h => {
        const vals = [h.helpfulness||0, h.correctness||0, h.coherence||0, h.complexity||0, h.verbosity||0];
        return vals.reduce((a,b) => a+b, 0) / 5;
    });

    const overall = avgs.reduce((a,b) => a+b, 0) / avgs.length;
    const passCount = avgs.filter(a => a >= 2.0).length;
    const best = Math.max(...avgs);
    const worst = Math.min(...avgs);

    // Trend: compare last 5 to previous 5
    let trend = '--';
    if (avgs.length >= 10) {
        const recent = avgs.slice(-5).reduce((a,b) => a+b, 0) / 5;
        const prev = avgs.slice(-10, -5).reduce((a,b) => a+b, 0) / 5;
        const diff = recent - prev;
        trend = (diff >= 0 ? '+' : '') + diff.toFixed(2);
    }

    if (el('rp-total-audits')) el('rp-total-audits').textContent = nemotronHistory.length;
    if (el('rp-pass-rate')) el('rp-pass-rate').textContent = ((passCount / avgs.length) * 100).toFixed(0) + '%';
    if (el('rp-avg-score')) el('rp-avg-score').textContent = overall.toFixed(2) + ' / 4.0';
    if (el('rp-best-audit')) el('rp-best-audit').textContent = best.toFixed(2);
    if (el('rp-worst-audit')) el('rp-worst-audit').textContent = worst.toFixed(2);
    if (el('rp-trend')) el('rp-trend').textContent = trend;
}

// ============================================
// LIVE PARAMETER TUNING
// ============================================
window.tuneParam = function(param, value) {
    const v = parseFloat(value);
    const display = document.getElementById('tune-val-' + param.replace(/([A-Z])/g, (m) => {
        return { shadowSpeed: 'shadow', drainMultiplier: 'drain', agentInterval: 'interval', commRange: 'comm' }[param] || param;
    }));

    switch (param) {
        case 'shadowSpeed':
            missionConfig.shadowSpeed = v;
            if (document.getElementById('tune-val-shadow')) document.getElementById('tune-val-shadow').textContent = v.toFixed(1);
            addLogEntry('system', 'Shadow speed tuned to <b>' + v.toFixed(1) + '</b> m/s');
            break;
        case 'drainMultiplier':
            missionConfig._drainMult = v;
            if (document.getElementById('tune-val-drain')) document.getElementById('tune-val-drain').textContent = v.toFixed(1);
            addLogEntry('system', 'Battery drain multiplier set to <b>' + v.toFixed(1) + 'x</b>');
            break;
        case 'agentInterval':
            missionConfig._agentInterval = v;
            if (document.getElementById('tune-val-interval')) document.getElementById('tune-val-interval').textContent = v.toFixed(0);
            addLogEntry('system', 'Agent decision interval set to <b>' + v.toFixed(0) + 's</b>');
            break;
        case 'commRange':
            missionConfig._commRangePct = v;
            if (document.getElementById('tune-val-comm')) document.getElementById('tune-val-comm').textContent = v.toFixed(0);
            addLogEntry('system', 'Communication range set to <b>' + v.toFixed(0) + '%</b>');
            break;
    }
};

// ============================================
// EVENT INJECTION
// ============================================
window.injectEvent = function(type) {
    const R = selectedCrater ? selectedCrater.diameter_km * CRATER_SCALE : 750;

    switch (type) {
        case 'shadowSurge': {
            const oldSpeed = missionConfig.shadowSpeed;
            missionConfig.shadowSpeed *= 3;
            addLogEntry('danger', 'SHADOW SURGE — Shadow speed tripled to <b>' + missionConfig.shadowSpeed.toFixed(1) + '</b> m/s for 15 seconds!');
            showToast('Shadow surge! Speed x3 for 15s', 'error', 5000);
            setTimeout(() => {
                missionConfig.shadowSpeed = oldSpeed;
                addLogEntry('system', 'Shadow speed returned to <b>' + oldSpeed.toFixed(1) + '</b> m/s');
            }, 15000);
            break;
        }
        case 'batteryDrop': {
            for (const state of Object.values(roverStates)) {
                state.battery = Math.max(5, state.battery - 25);
            }
            addLogEntry('danger', 'BATTERY DROP — All rovers lost 25% battery from solar flare interference!');
            showToast('Solar flare! All rovers -25% battery', 'error', 5000);
            break;
        }
        case 'iceBonus': {
            const x = (Math.random() - 0.3) * R * 0.6;
            const z = (Math.random() - 0.5) * R * 0.6;
            const dep = { x, z, richness: 0.9 + Math.random() * 0.1, discovered: false, discoveredBy: null };
            iceDeposits.push(dep);
            // Create marker
            const y = craterHeight(x, z) + 0.5;
            const geo = new THREE.OctahedronGeometry(2 + dep.richness * 3, 0);
            const mat = new THREE.MeshStandardMaterial({
                color: 0x00ccff, emissive: 0x0066aa, emissiveIntensity: 0.8,
                transparent: true, opacity: 0, roughness: 0.1, metalness: 0.9
            });
            const marker = new THREE.Mesh(geo, mat);
            marker.position.set(x, y + 3, z);
            scene.add(marker);
            dep._marker = marker;
            const ringGeo = new THREE.RingGeometry(3, 5 + dep.richness * 4, 24);
            ringGeo.rotateX(-Math.PI / 2);
            const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
                color: 0x00ccff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
            }));
            ring.position.set(x, y + 0.5, z);
            scene.add(ring);
            dep._ring = ring;
            addLogEntry('award', 'ICE BONUS — Ground-penetrating radar detected a new high-richness deposit!');
            showToast('New ice deposit detected by radar!', 'success', 5000);
            break;
        }
        case 'sensorFail': {
            const ids = Object.keys(roverStates);
            const targetId = ids[Math.floor(Math.random() * ids.length)];
            if (roverStates[targetId]) {
                roverStates[targetId].sensor_health = Math.max(0, roverStates[targetId].sensor_health - 40);
                addLogEntry('danger', '<b>' + targetId.toUpperCase() + '</b> suffered sensor malfunction! Health dropped by 40%.');
                showToast(targetId.toUpperCase() + ' sensor failure! -40%', 'error', 5000);
            }
            break;
        }
    }
};

// ============================================
// DATA EXPORT UTILITIES
// ============================================
window.exportScoreCSV = function() {
    if (nemotronHistory.length === 0) {
        showToast('No audit data to export yet', 'info', 3000);
        return;
    }
    const headers = 'time,helpfulness,correctness,coherence,complexity,verbosity,average\n';
    const rows = nemotronHistory.map(h => {
        const avg = ((h.helpfulness||0)+(h.correctness||0)+(h.coherence||0)+(h.complexity||0)+(h.verbosity||0))/5;
        return [h.time||'', h.helpfulness||0, h.correctness||0, h.coherence||0, h.complexity||0, h.verbosity||0, avg.toFixed(3)].join(',');
    }).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'regolith-nemotron-scores-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Nemotron scores exported as CSV', 'success', 3000);
};

window.exportNegotiationLog = function() {
    const log = document.getElementById('negotiation-log');
    if (!log || log.children.length === 0) {
        showToast('No log entries to export', 'info', 3000);
        return;
    }
    let text = 'PROJECT REGOLITH — NEGOTIATION LOG\n';
    text += 'Crater: ' + (selectedCrater ? selectedCrater.name : 'unknown') + '\n';
    text += 'Scenario: ' + (missionConfig.scenario || 'exploration') + '\n';
    text += 'Exported: ' + new Date().toISOString() + '\n';
    text += '='.repeat(60) + '\n\n';
    for (const entry of log.children) {
        const time = entry.querySelector('.log-time')?.textContent || '';
        const type = entry.querySelector('.log-type')?.textContent || '';
        const msg = entry.textContent.replace(time, '').replace(type, '').trim();
        text += '[' + time + '] ' + type + ': ' + msg + '\n';
    }
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'regolith-negotiation-log-' + Date.now() + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Negotiation log exported', 'success', 3000);
};
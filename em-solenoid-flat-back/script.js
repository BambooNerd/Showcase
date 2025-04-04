// ESモジュールとしてThree.jsとアドオンをインポート
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { allImagesFullPath } from '../em-solenoid-standalone/images.js'; // 画像リストをインポート

// --- DOM Elements ---
const container = document.getElementById('canvas-container');
if (!container) {
    throw new Error('Canvas container not found!');
}

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(6, 5, 7); // Initial camera position from React component

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.minDistance = 2;
controls.maxDistance = 30;

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3); // Increased intensity slightly
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// --- Post-processing ---
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ), 1.5, 0.4, 0.85 );
// React版のBloom設定に近づけるためのパラメータ調整例
bloomPass.threshold = 0.2; // luminanceThreshold
bloomPass.strength = 0.1; // intensity
bloomPass.radius = 0.2; // 見た目で調整 (luminanceSmoothing や mipmapBlur に直接対応するパラメータはない)

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);


// --- Configuration (Copied from React component) ---
const coilRadius = 1.5;
const coilHeight = 5;
const numFieldParticles = 100; // For default particles if images are not loaded
const fieldAnimationSpeed = 0.5;
const particleSize = 0.4; // For default particles
const imageSize = 0.6; // For image particles
const dipoleMomentStrength = 15.0;
const resetDistance = coilHeight * 2.5;
const resetNearPoleDistance = 0.2;
const poleZ = coilHeight / 2;

let currentBackgroundImageUrl = allImagesFullPath && allImagesFullPath.length > 0 ? allImagesFullPath[0] : undefined;

// --- Texture Loader ---
const textureLoader = new THREE.TextureLoader();

// --- Raycaster for Click Detection ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let clickableObjects = []; // Array to hold image planes

// --- Magnetic Dipole Field Calculation (Copied) ---
const dipoleMoment = new THREE.Vector3(0, 0, dipoleMomentStrength);
const tempVec3 = new THREE.Vector3(); // Reusable temporary vector
const insideFieldDirection = new THREE.Vector3(0, 0, 1); // Constant direction inside coil

function magneticDipoleField(position, m, target) {
    const rMagSq = position.lengthSq();
    if (rMagSq < 1e-6) { return target.set(0, 0, 0); } // Avoid division by zero
    const rMag = Math.sqrt(rMagSq);
    const rMag3 = rMagSq * rMag;
    const rMag5 = rMag3 * rMagSq;

    const mDotR = m.dot(position);

    // target = 3 * (m ⋅ position) * position / r⁵ - m / r³
    target.copy(position).multiplyScalar(3 * mDotR / rMag5);
    tempVec3.copy(m).divideScalar(rMag3); // Use temp vector
    target.sub(tempVec3);

    return target;
}

// --- Particle Data ---
let particleType = 'none'; // 'image' or 'default'
// Image Particles
let imageParticlePositions = []; // Flat array [x1, y1, z1, x2, y2, z2, ...]
let imageParticleMeshes = []; // Array to hold the Plane meshes
// Default Particles
let defaultParticlesGeometry = null;
let defaultParticlesMaterial = null;
let defaultParticlesPoints = null;
let defaultParticlePositions = null; // Float32Array

// Reusable vectors for particle updates
const particleCurrentPos = new THREE.Vector3(); // Reusable vector for current position
const particleFieldDir = new THREE.Vector3();   // Reusable vector for field direction
const particleDisplacement = new THREE.Vector3(); // Reusable vector for displacement

// --- Function to set background ---
function setBackground(imageUrl) {
    if (imageUrl) {
        textureLoader.load(
            imageUrl,
            (texture) => {
                scene.background = texture;
                console.log("Background set:", imageUrl);
            },
            undefined, // onProgress callback (optional)
            (error) => {
                console.error('Error loading background texture:', imageUrl, error);
                scene.background = new THREE.Color('#000000'); // Fallback to black
            }
        );
    } else {
        scene.background = new THREE.Color('#000000');
        console.log("Background set to black (no image URL)");
    }
}

// --- Function to reset a particle's position (Common for both types) ---
function resetParticle(index, positionsArr) {
    const i3 = index * 3;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 0.5; // Start near the center bottom
    const startZ = -poleZ - Math.random() * 0.5; // Start below the coil
    positionsArr[i3 + 0] = radius * Math.cos(angle);
    positionsArr[i3 + 1] = radius * Math.sin(angle);
    positionsArr[i3 + 2] = startZ;
}

// --- Initialize Image Particles ---
function initializeImageParticles() {
    particleType = 'image';
    const initialPositions = [];
    const spawnRadius = resetDistance * 0.8; // Start particles further out

    // Clear existing meshes and clickable objects
    imageParticleMeshes.forEach(mesh => scene.remove(mesh));
    imageParticleMeshes = [];
    clickableObjects = [];
    // Clear default particles if they exist
    if (defaultParticlesPoints) {
        scene.remove(defaultParticlesPoints);
        defaultParticlesGeometry.dispose();
        defaultParticlesMaterial.dispose();
        defaultParticlesPoints = null;
        defaultParticlesGeometry = null;
        defaultParticlesMaterial = null;
        defaultParticlePositions = null;
    }

    for (let i = 0; i < numFieldParticles; i++) {
        // Calculate initial random spherical position
        const r = Math.cbrt(Math.random()) * spawnRadius; // Cube root for more uniform distribution
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1); // Uniform spherical distribution
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        initialPositions.push(x, y, z);

        // Create Plane Mesh for each particle
        const imageUrl = allImagesFullPath[i % allImagesFullPath.length]; // Cycle through images
        const geometry = new THREE.PlaneGeometry(imageSize, imageSize);
        const material = new THREE.MeshBasicMaterial({
            map: textureLoader.load(imageUrl),
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending, // Or AdditiveBlending if preferred
            depthWrite: true, // Important for correct rendering with NormalBlending
            opacity: 0.8,
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.position.set(x, y, z);
        plane.userData = { imageUrl: imageUrl }; // Store image URL for click handling
        scene.add(plane);
        imageParticleMeshes.push(plane);
        clickableObjects.push(plane); // Add to clickable objects
    }
    imageParticlePositions = initialPositions;
    console.log("Initialized Image Particles");
}

// --- Update Image Particles ---
function updateImageParticles(deltaTime) {
    if (imageParticlePositions.length === 0 || imageParticleMeshes.length === 0) return;

    const count = imageParticlePositions.length / 3;
    const coilRadiusSq = coilRadius * coilRadius;
    const dtClamped = Math.min(deltaTime, 0.05); // Clamp delta time to avoid large jumps

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        particleCurrentPos.set(imageParticlePositions[i3], imageParticlePositions[i3 + 1], imageParticlePositions[i3 + 2]);

        const radialDistSq = particleCurrentPos.x * particleCurrentPos.x + particleCurrentPos.y * particleCurrentPos.y;
        const currentZ = particleCurrentPos.z;
        const useInsideField = radialDistSq < coilRadiusSq && Math.abs(currentZ) < poleZ;
        const totalDistSq = particleCurrentPos.lengthSq();

        // Reset particle if too far or too close to origin (pole)
        if (totalDistSq > resetDistance * resetDistance || totalDistSq < resetNearPoleDistance * resetNearPoleDistance) {
            resetParticle(i, imageParticlePositions);
            // Update mesh position immediately after reset
            imageParticleMeshes[i].position.set(imageParticlePositions[i3], imageParticlePositions[i3 + 1], imageParticlePositions[i3 + 2]);
            continue;
        }

        // Calculate displacement based on field
        if (useInsideField) {
            // Inside the coil, move straight up
            particleDisplacement.copy(insideFieldDirection).multiplyScalar(fieldAnimationSpeed * dtClamped);
        } else {
            // Outside the coil, use dipole field
            magneticDipoleField(particleCurrentPos, dipoleMoment, particleFieldDir);
            const fieldStrengthSq = particleFieldDir.lengthSq();
            if (fieldStrengthSq < 1e-8) { // If field is negligible, reset
                resetParticle(i, imageParticlePositions);
                imageParticleMeshes[i].position.set(imageParticlePositions[i3], imageParticlePositions[i3 + 1], imageParticlePositions[i3 + 2]);
                continue;
            }
            particleFieldDir.normalize(); // Use normalized direction
            particleDisplacement.copy(particleFieldDir).multiplyScalar(fieldAnimationSpeed * dtClamped);
        }

        // Update position array
        imageParticlePositions[i3 + 0] += particleDisplacement.x;
        imageParticlePositions[i3 + 1] += particleDisplacement.y;
        imageParticlePositions[i3 + 2] += particleDisplacement.z;

        // Update mesh position
        imageParticleMeshes[i].position.set(imageParticlePositions[i3], imageParticlePositions[i3 + 1], imageParticlePositions[i3 + 2]);

        // Billboard effect: Make planes face the camera
        imageParticleMeshes[i].quaternion.copy(camera.quaternion);
        // Optional: Add slight tilt like in the original component
        imageParticleMeshes[i].rotateX(THREE.MathUtils.degToRad(30)); // ★ 傾きを追加
    }
}

// --- Initialize Default Particles ---
function initializeDefaultParticles() {
    particleType = 'default';
    const spawnRadius = resetDistance * 0.8;
    defaultParticlePositions = new Float32Array(numFieldParticles * 3);

    // Clear existing image particles if they exist
    imageParticleMeshes.forEach(mesh => scene.remove(mesh));
    imageParticleMeshes = [];
    clickableObjects = [];
    imageParticlePositions = [];
    // Clear existing default particles if they exist (for re-initialization)
    if (defaultParticlesPoints) {
        scene.remove(defaultParticlesPoints);
        defaultParticlesGeometry.dispose();
        defaultParticlesMaterial.dispose();
    }

    for (let i = 0; i < numFieldParticles; i++) {
        const i3 = i * 3;
        const r = Math.cbrt(Math.random()) * spawnRadius;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        defaultParticlePositions[i3 + 0] = r * Math.sin(phi) * Math.cos(theta);
        defaultParticlePositions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        defaultParticlePositions[i3 + 2] = r * Math.cos(phi);
    }

    defaultParticlesGeometry = new THREE.BufferGeometry();
    defaultParticlesGeometry.setAttribute('position', new THREE.BufferAttribute(defaultParticlePositions, 3));

    // Create particle texture (similar to useParticleTexture in React)
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64; // Reduced size slightly
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(200, 220, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(150, 180, 255, 0.7)');
    gradient.addColorStop(1, 'rgba(100, 120, 200, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const particleTexture = new THREE.CanvasTexture(canvas);
    particleTexture.needsUpdate = true;

    defaultParticlesMaterial = new THREE.PointsMaterial({
        map: particleTexture,
        color: 0xaaaaff,
        size: particleSize,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true
    });

    defaultParticlesPoints = new THREE.Points(defaultParticlesGeometry, defaultParticlesMaterial);
    scene.add(defaultParticlesPoints);
    console.log("Initialized Default Particles");
}

// --- Update Default Particles ---
function updateDefaultParticles(deltaTime) {
    if (!defaultParticlesPoints || !defaultParticlePositions) return;

    const positions = defaultParticlePositions;
    const count = positions.length / 3;
    const coilRadiusSq = coilRadius * coilRadius;
    const dtClamped = Math.min(deltaTime, 0.05);
    let needsUpdate = false;

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        particleCurrentPos.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);

        const radialDistSq = particleCurrentPos.x * particleCurrentPos.x + particleCurrentPos.y * particleCurrentPos.y;
        const currentZ = particleCurrentPos.z;
        const useInsideField = radialDistSq < coilRadiusSq && Math.abs(currentZ) < poleZ;
        const totalDistSq = particleCurrentPos.lengthSq();

        // Reset particle if too far or too close to origin (pole)
        if (totalDistSq > resetDistance * resetDistance || totalDistSq < resetNearPoleDistance * resetNearPoleDistance) {
            resetParticle(i, positions);
            needsUpdate = true;
            continue;
        }

        // Calculate displacement based on field
        if (useInsideField) {
            // Inside the coil, move straight up
            particleDisplacement.copy(insideFieldDirection).multiplyScalar(fieldAnimationSpeed * dtClamped);
        } else {
            // Outside the coil, use dipole field
            magneticDipoleField(particleCurrentPos, dipoleMoment, particleFieldDir);
            const fieldStrengthSq = particleFieldDir.lengthSq();
            if (fieldStrengthSq < 1e-8) { // If field is negligible, reset
                resetParticle(i, positions);
                needsUpdate = true;
                continue;
            }
            particleFieldDir.normalize(); // Use normalized direction
            particleDisplacement.copy(particleFieldDir).multiplyScalar(fieldAnimationSpeed * dtClamped);
        }

        // Update position array
        positions[i3 + 0] += particleDisplacement.x;
        positions[i3 + 1] += particleDisplacement.y;
        positions[i3 + 2] += particleDisplacement.z;
        needsUpdate = true;
    }

    if (needsUpdate) {
        defaultParticlesGeometry.attributes.position.needsUpdate = true;
    }
}


// --- Event Listeners ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight); // Update composer size
    // Update bloom pass resolution on resize
    bloomPass.resolution.set(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

function onMouseClick(event) {
    // Only process clicks if image particles are active
    if (particleType !== 'image') return;

    // Calculate mouse position in normalized device coordinates (-1 to +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, camera);

    // Calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObjects(clickableObjects);

    if (intersects.length > 0) {
        // Find the closest intersected object
        const closestIntersect = intersects[0];
        const clickedObject = closestIntersect.object; // No need to cast in JS

        if (clickedObject.userData && clickedObject.userData.imageUrl) { // Check if userData exists
            console.log("Clicked particle:", clickedObject.userData.imageUrl);
            setBackground(clickedObject.userData.imageUrl);
            currentBackgroundImageUrl = clickedObject.userData.imageUrl; // Update current background URL state
        }
    }
}
window.addEventListener('click', onMouseClick);


// --- Animation Loop ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    controls.update(); // Required if enableDamping is true

    // Update particle positions based on the active type
    if (particleType === 'image') {
        updateImageParticles(deltaTime);
    } else if (particleType === 'default') {
        updateDefaultParticles(deltaTime);
    }

    // renderer.render(scene, camera); // Render using composer instead
    composer.render(deltaTime); // Use composer for post-processing effects
}

// --- Initialization ---
setBackground(currentBackgroundImageUrl); // Set initial background

// Initialize particles based on whether images are available
if (allImagesFullPath && allImagesFullPath.length > 0) {
    initializeImageParticles(); // Create initial image particles
} else {
    console.warn("No images found in images.js, initializing default particles.");
    initializeDefaultParticles(); // Create initial default particles
}

animate(); // Start the animation loop

console.log("EM Solenoid Animation Initialized");

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Realistic solar system data
// Distances in AU (Astronomical Units, 1 AU = Earth-Sun distance = ~149.6 million km)
// Sizes are actual radii in km
const CELESTIAL_DATA = {
    sun: {
        name: 'Sun',
        radius: 696000,  // km
        distance: 0,  // AU
        color: 0xFDB813,
        emissive: 0xFDB813,
        emissiveIntensity: 1,
        rotationSpeed: 0.004,
        info: 'The Sun - Our star, containing 99.86% of the solar system\'s mass'
    },
    mercury: {
        name: 'Mercury',
        radius: 2439.7,
        distance: 0.387,  // AU
        color: 0x8C7853,
        rotationSpeed: 0.01,
        orbitSpeed: 0.04,
        info: 'Mercury - Smallest planet, closest to the Sun'
    },
    venus: {
        name: 'Venus',
        radius: 6051.8,
        distance: 0.723,
        color: 0xFFC649,
        rotationSpeed: -0.002,  // Retrograde rotation
        orbitSpeed: 0.015,
        info: 'Venus - Hottest planet with thick atmosphere'
    },
    earth: {
        name: 'Earth',
        radius: 6371,
        distance: 1.0,
        color: 0x2233FF,
        rotationSpeed: 0.02,
        orbitSpeed: 0.01,
        info: 'Earth - Our home planet, the only known world with life'
    },
    mars: {
        name: 'Mars',
        radius: 3389.5,
        distance: 1.524,
        color: 0xCD5C5C,
        rotationSpeed: 0.018,
        orbitSpeed: 0.008,
        info: 'Mars - The Red Planet with the largest volcano in the solar system'
    },
    jupiter: {
        name: 'Jupiter',
        radius: 69911,
        distance: 5.203,
        color: 0xDAA520,
        rotationSpeed: 0.04,
        orbitSpeed: 0.002,
        info: 'Jupiter - Largest planet, a gas giant with the Great Red Spot'
    },
    saturn: {
        name: 'Saturn',
        radius: 58232,
        distance: 9.537,
        color: 0xFAD5A5,
        rotationSpeed: 0.038,
        orbitSpeed: 0.0009,
        info: 'Saturn - Famous for its spectacular ring system'
    },
    uranus: {
        name: 'Uranus',
        radius: 25362,
        distance: 19.191,
        color: 0x4FD0E7,
        rotationSpeed: 0.03,
        orbitSpeed: 0.0004,
        info: 'Uranus - Ice giant that rotates on its side'
    },
    neptune: {
        name: 'Neptune',
        radius: 24622,
        distance: 30.069,
        color: 0x4169E1,
        rotationSpeed: 0.032,
        orbitSpeed: 0.0001,
        info: 'Neptune - Farthest planet with the strongest winds in the solar system'
    }
};

class SolarSystemViewer {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.celestialBodies = {};
        this.orbits = {};
        this.labels = [];
        this.currentLocation = 'earth';
        this.scaleFactor = 1;
        this.showOrbits = true;
        this.showLabels = true;

        // Scale factors for visualization
        // We need to scale down distances and scale up planet sizes to make them visible
        this.distanceScale = 100;  // 1 AU = 100 units in scene
        this.sizeScale = 0.001;    // Scale for planet sizes (smaller planets would be invisible at true scale)

        this.init();
        this.createCelestialBodies();
        this.setupControls();
        this.setupEventListeners();
        this.animate();
    }

    init() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadow;
        document.getElementById('canvas-container').appendChild(this.renderer.domElement);

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0x333333);
        this.scene.add(ambientLight);

        // Add starfield background
        this.createStarfield();

        // Set initial camera position
        this.camera.position.set(200, 100, 200);
        this.camera.lookAt(0, 0, 0);
    }

    createStarfield() {
        const starsGeometry = new THREE.BufferGeometry();
        const starsMaterial = new THREE.PointsMaterial({
            color: 0xFFFFFF,
            size: 0.7,
            sizeAttenuation: false
        });

        const starsVertices = [];
        for (let i = 0; i < 10000; i++) {
            const x = (Math.random() - 0.5) * 20000;
            const y = (Math.random() - 0.5) * 20000;
            const z = (Math.random() - 0.5) * 20000;
            starsVertices.push(x, y, z);
        }

        starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
        const starField = new THREE.Points(starsGeometry, starsMaterial);
        this.scene.add(starField);
    }

    createCelestialBodies() {
        Object.entries(CELESTIAL_DATA).forEach(([key, data]) => {
            // Calculate scaled radius
            const radius = data.radius * this.sizeScale;

            // Create sphere geometry
            const geometry = new THREE.SphereGeometry(radius, 64, 64);

            // Create material
            const material = new THREE.MeshStandardMaterial({
                color: data.color,
                emissive: data.emissive || 0x000000,
                emissiveIntensity: data.emissiveIntensity || 0,
                roughness: 0.7,
                metalness: 0.3
            });

            const planet = new THREE.Mesh(geometry, material);

            // Position planet
            const distance = data.distance * this.distanceScale * this.scaleFactor;
            planet.position.x = distance;

            // Store additional data
            planet.userData = {
                ...data,
                key: key,
                originalDistance: distance
            };

            this.scene.add(planet);
            this.celestialBodies[key] = planet;

            // Add point light for the Sun
            if (key === 'sun') {
                const sunLight = new THREE.PointLight(0xFFFFFF, 2, 5000);
                sunLight.position.copy(planet.position);
                this.scene.add(sunLight);
                planet.userData.light = sunLight;
            }

            // Create orbit path
            if (data.distance > 0) {
                this.createOrbit(data.distance * this.distanceScale * this.scaleFactor, data.color);
            }

            // Create label
            this.createLabel(key, data.name);
        });
    }

    createOrbit(radius, color) {
        const curve = new THREE.EllipseCurve(
            0, 0,
            radius, radius,
            0, 2 * Math.PI,
            false,
            0
        );

        const points = curve.getPoints(128);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3
        });

        const orbit = new THREE.Line(geometry, material);
        orbit.rotation.x = Math.PI / 2;
        orbit.visible = this.showOrbits;

        this.scene.add(orbit);
        this.orbits[radius] = orbit;
    }

    createLabel(key, name) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.font = 'Bold 24px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(name, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.8
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(20, 5, 1);
        sprite.userData.key = key;
        sprite.visible = this.showLabels;

        this.scene.add(sprite);
        this.labels.push(sprite);
    }

    updateLabelPositions() {
        this.labels.forEach(label => {
            const key = label.userData.key;
            const body = this.celestialBodies[key];
            if (body) {
                const offset = body.userData.radius * this.sizeScale * 2;
                label.position.copy(body.position);
                label.position.y += offset;
            }
        });
    }

    setupControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 10;
        this.controls.maxDistance = 10000;
    }

    setupEventListeners() {
        // Location selector
        document.getElementById('location-select').addEventListener('change', (e) => {
            this.currentLocation = e.target.value;
            this.updateCameraPosition();
        });

        // Scale factor slider
        const scaleSlider = document.getElementById('scale-factor');
        const scaleValue = document.getElementById('scale-value');
        scaleSlider.addEventListener('input', (e) => {
            this.scaleFactor = parseFloat(e.target.value);
            scaleValue.textContent = `${this.scaleFactor}x`;
            this.updatePlanetPositions();
        });

        // Show orbits toggle
        document.getElementById('show-orbits').addEventListener('change', (e) => {
            this.showOrbits = e.target.checked;
            Object.values(this.orbits).forEach(orbit => {
                orbit.visible = this.showOrbits;
            });
        });

        // Show labels toggle
        document.getElementById('show-labels').addEventListener('change', (e) => {
            this.showLabels = e.target.checked;
            this.labels.forEach(label => {
                label.visible = this.showLabels;
            });
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    updateCameraPosition() {
        const body = this.celestialBodies[this.currentLocation];
        if (!body) return;

        const data = CELESTIAL_DATA[this.currentLocation];
        const radius = data.radius * this.sizeScale;
        const offset = radius * 5; // Position camera at 5x planet radius

        // Smoothly move camera to new position
        const targetPosition = body.position.clone();
        targetPosition.y += offset;
        targetPosition.z += offset * 2;

        this.camera.position.lerp(targetPosition, 0.1);
        this.controls.target.copy(body.position);

        // Update info panel
        this.updateInfoPanel(data);
    }

    updateInfoPanel(data) {
        const infoDiv = document.getElementById('planet-details');
        infoDiv.innerHTML = `
            <p><strong>Radius:</strong> ${data.radius.toLocaleString()} km</p>
            <p><strong>Distance from Sun:</strong> ${data.distance} AU</p>
            <p>${data.info}</p>
        `;
    }

    updatePlanetPositions() {
        Object.entries(this.celestialBodies).forEach(([key, body]) => {
            const data = body.userData;
            if (data.distance > 0) {
                const distance = data.distance * this.distanceScale * this.scaleFactor;
                const angle = Date.now() * 0.00001 * (data.orbitSpeed || 0.01);
                body.position.x = Math.cos(angle) * distance;
                body.position.z = Math.sin(angle) * distance;
                body.userData.originalDistance = distance;
            }
        });

        // Update orbits
        Object.keys(this.orbits).forEach(radius => {
            this.scene.remove(this.orbits[radius]);
        });
        this.orbits = {};

        Object.entries(CELESTIAL_DATA).forEach(([key, data]) => {
            if (data.distance > 0) {
                const distance = data.distance * this.distanceScale * this.scaleFactor;
                this.createOrbit(distance, data.color);
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Rotate planets
        Object.entries(this.celestialBodies).forEach(([key, body]) => {
            const data = body.userData;
            body.rotation.y += data.rotationSpeed || 0;

            // Update planet orbital positions
            if (data.distance > 0 && data.orbitSpeed) {
                const angle = Date.now() * 0.00001 * data.orbitSpeed;
                const distance = data.originalDistance || data.distance * this.distanceScale * this.scaleFactor;
                body.position.x = Math.cos(angle) * distance;
                body.position.z = Math.sin(angle) * distance;
            }

            // Update sun light position
            if (data.light) {
                data.light.position.copy(body.position);
            }
        });

        // Update label positions
        this.updateLabelPositions();

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize the viewer when page loads
window.addEventListener('DOMContentLoaded', () => {
    const viewer = new SolarSystemViewer();
});

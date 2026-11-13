import * as THREE from 'three';
import {
  BIOMES,
  LANE_POSITIONS,
  POWERUP_META,
  SEGMENT_LENGTH,
  TRACK_WIDTH,
} from './constants';
import type {ProceduralTextureSet} from './textures';
import type {
  BiomeId,
  CoinSpec,
  ObstacleSpec,
  PowerUpSpec,
  PowerUpType,
  QualityLevel,
  SegmentPattern,
} from './types';

export interface ActiveCoin {
  spec: CoinSpec;
  mesh: THREE.Group;
  collected: boolean;
  magnetized: boolean;
  worldPos: THREE.Vector3;
}

export interface ActivePowerUp {
  spec: PowerUpSpec;
  mesh: THREE.Group;
  collected: boolean;
}

export interface ActiveObstacle {
  spec: ObstacleSpec;
  mesh: THREE.Group;
  smashed: boolean;
  collapsingStarted: boolean;
  collapseProgress: number;
  nearMissAwarded: boolean;
}

export interface ActiveSegment {
  pattern: SegmentPattern;
  group: THREE.Group;
  origin: THREE.Vector3;
  headingRad: number;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  obstacles: ActiveObstacle[];
  coins: ActiveCoin[];
  powerUps: ActivePowerUp[];
  turnHandled: boolean;
}

interface ParticleSlot {
  active: boolean;
  life: number;
  maxLife: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  color: THREE.Color;
}

interface SoaringBird {
  root: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  angle: number;
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

const _dummyObj = new THREE.Object3D();
const _tmpVec = new THREE.Vector3();
const _tmpColor = new THREE.Color();
const _skyTopTarget = new THREE.Color();
const _skyBottomTarget = new THREE.Color();
const _sunTarget = new THREE.Color();
const _moteTargetColor = new THREE.Color();

export class PooledParticles {
  public readonly mesh: THREE.InstancedMesh;
  private readonly slots: ParticleSlot[] = [];
  private cursor = 0;

  constructor(capacity = 220) {
    const geo = new THREE.OctahedronGeometry(0.12, 0);
    const mat = new THREE.MeshBasicMaterial({color: 0xffffff});
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < capacity; i++) {
      this.slots.push({
        active: false,
        life: 0,
        maxLife: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        size: 1,
        color: new THREE.Color(0xffffff),
      });
      _dummyObj.scale.setScalar(0);
      _dummyObj.updateMatrix();
      this.mesh.setMatrixAt(i, _dummyObj.matrix);
      this.mesh.setColorAt(i, _tmpColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  public emit(
    origin: THREE.Vector3,
    count: number,
    colorHex: number,
    speed = 4.5,
    size = 1.0,
    upBias = 2.5
  ): void {
    for (let n = 0; n < count; n++) {
      const slot = this.slots[this.cursor];
      this.cursor = (this.cursor + 1) % this.slots.length;
      slot.active = true;
      slot.life = 0;
      slot.maxLife = 0.35 + Math.random() * 0.35;
      slot.pos.copy(origin);
      slot.pos.x += (Math.random() - 0.5) * 0.35;
      slot.pos.y += Math.random() * 0.25;
      slot.pos.z += (Math.random() - 0.5) * 0.35;
      slot.vel.set(
        (Math.random() - 0.5) * speed * 1.4,
        upBias + Math.random() * speed * 0.9,
        (Math.random() - 0.5) * speed * 1.4
      );
      slot.size = size * (0.7 + Math.random() * 0.6);
      slot.color.setHex(colorHex);
    }
  }

  public update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      dirty = true;
      s.life += dt;
      if (s.life >= s.maxLife) {
        s.active = false;
        _dummyObj.scale.setScalar(0);
        _dummyObj.updateMatrix();
        this.mesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }
      s.vel.y -= 11.5 * dt;
      s.pos.addScaledVector(s.vel, dt);
      const t = 1 - s.life / s.maxLife;
      _dummyObj.position.copy(s.pos);
      _dummyObj.rotation.set(s.life * 6, s.life * 4, 0);
      _dummyObj.scale.setScalar(s.size * t);
      _dummyObj.updateMatrix();
      this.mesh.setMatrixAt(i, _dummyObj.matrix);
      this.mesh.setColorAt(i, s.color);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class TempleWorld {
  public readonly root = new THREE.Group();
  public readonly segments: ActiveSegment[] = [];
  public readonly particles = new PooledParticles(220);

  private readonly skyDome: THREE.Mesh;
  private readonly skyUniforms: {
    uSkyTop: {value: THREE.Color};
    uSkyBottom: {value: THREE.Color};
    uSunColor: {value: THREE.Color};
    uSunDir: {value: THREE.Vector3};
  };
  private readonly windUniform = {value: 0};

  private readonly sunShaftGroup = new THREE.Group();
  private readonly sunShaftMat: THREE.ShaderMaterial;

  private readonly ambientMotes: THREE.Points;
  private readonly motePositions: Float32Array;
  private readonly moteSeeds: Float32Array;
  private readonly moteCount = 140;
  private readonly moteMat: THREE.PointsMaterial;

  private readonly birdsGroup = new THREE.Group();
  private readonly birds: SoaringBird[] = [];

  private readonly riverPlane: THREE.Mesh;
  private readonly lavaPlane: THREE.Mesh;
  private readonly canyonLeft: THREE.Group;
  private readonly canyonRight: THREE.Group;
  private readonly distantTemple: THREE.Group;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private readonly matCoin: THREE.MeshStandardMaterial;
  private readonly matGem: THREE.MeshStandardMaterial;
  private readonly matWood: THREE.MeshStandardMaterial;
  private readonly matRope: THREE.MeshStandardMaterial;
  private readonly matFire: THREE.MeshStandardMaterial;
  private readonly matBlade: THREE.MeshStandardMaterial;
  private readonly matFoliage: THREE.MeshStandardMaterial;
  private readonly matFoliageAlt: THREE.MeshStandardMaterial;
  private readonly matTrunk: THREE.MeshStandardMaterial;
  private readonly matEyeGlow: THREE.MeshStandardMaterial;

  private readonly sharedFloorGeo: THREE.BoxGeometry;
  private readonly sharedCurbGeo: THREE.BoxGeometry;
  private readonly sharedCoinGeo: THREE.CylinderGeometry;
  private readonly sharedGemGeo: THREE.OctahedronGeometry;
  private readonly sharedPillarGeo: THREE.BoxGeometry;

  private quality: QualityLevel = 'high';
  private envTime = 0;

  constructor(private readonly textures: ProceduralTextureSet) {
    this.root.add(this.particles.mesh);

    // 1. Atmospheric Sky Dome Shader (vertical Rayleigh sky scattering + sun halo)
    const startBiome = BIOMES.jungle_temple;
    this.skyUniforms = {
      uSkyTop: {value: new THREE.Color(startBiome.skyTop)},
      uSkyBottom: {value: new THREE.Color(startBiome.skyBottom)},
      uSunColor: {value: new THREE.Color(startBiome.sunColor)},
      uSunDir: {value: new THREE.Vector3(0.45, 0.42, -0.78).normalize()},
    };
    const skyGeo = this.trackGeo(new THREE.SphereGeometry(215, 24, 16));
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vLocalDir;
        void main() {
          vLocalDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSkyTop;
        uniform vec3 uSkyBottom;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        varying vec3 vLocalDir;
        void main() {
          float h = clamp(vLocalDir.y * 0.5 + 0.5, 0.0, 1.0);
          float horizonMix = smoothstep(0.32, 0.85, h);
          vec3 col = mix(uSkyBottom, uSkyTop, horizonMix);
          float sunDot = max(dot(normalize(vLocalDir), normalize(uSunDir)), 0.0);
          float halo = pow(sunDot, 12.0) * 0.35 + pow(sunDot, 96.0) * 0.95;
          col += uSunColor * halo;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.materials.push(skyMat);
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.renderOrder = -10;
    this.root.add(this.skyDome);

    // 2. Volumetric Sun Light Shafts
    this.sunShaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: {value: new THREE.Color(0xfff1c4)},
        uOpacity: {value: 0.14},
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float edge = sin(vUv.x * 3.14159265);
          float vert = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.15, vUv.y);
          float alpha = edge * edge * vert * uOpacity;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });
    this.materials.push(this.sunShaftMat);
    const shaftGeo = this.trackGeo(new THREE.PlaneGeometry(5.5, 24));
    const shaftSpecs = [
      {x: -6, y: 8.5, z: -20, rz: 0.32, ry: 0.25},
      {x: 4, y: 9.5, z: -34, rz: 0.28, ry: -0.2},
      {x: -3, y: 10, z: -50, rz: 0.34, ry: 0.15},
      {x: 7, y: 9, z: -66, rz: 0.3, ry: -0.3},
    ];
    for (const s of shaftSpecs) {
      const m = new THREE.Mesh(shaftGeo, this.sunShaftMat);
      m.position.set(s.x, s.y, s.z);
      m.rotation.set(0.15, s.ry, s.rz);
      this.sunShaftGroup.add(m);
    }
    this.root.add(this.sunShaftGroup);

    // 3. Ambient Floating Environmental Motes (golden pollen / embers)
    this.motePositions = new Float32Array(this.moteCount * 3);
    this.moteSeeds = new Float32Array(this.moteCount);
    for (let i = 0; i < this.moteCount; i++) {
      this.motePositions[i * 3] = (Math.random() - 0.5) * 18;
      this.motePositions[i * 3 + 1] = 0.3 + Math.random() * 6.5;
      this.motePositions[i * 3 + 2] = (Math.random() - 0.5) * 32;
      this.moteSeeds[i] = Math.random() * Math.PI * 2;
    }
    const moteGeo = this.trackGeo(new THREE.BufferGeometry());
    moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
    this.moteMat = new THREE.PointsMaterial({
      color: 0xffe89e,
      map: textures.glowSprite,
      size: 0.36,
      transparent: true,
      opacity: 0.75,
      alphaTest: 0.01,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(this.moteMat);
    this.ambientMotes = new THREE.Points(moteGeo, this.moteMat);
    this.ambientMotes.frustumCulled = false;
    this.root.add(this.ambientMotes);

    // 4. Shared PBR Materials (with normal/roughness & vertex wind-sway shader)
    this.matCoin = new THREE.MeshStandardMaterial({
      color: 0xffd240,
      emissive: 0x6b4500,
      emissiveIntensity: 0.45,
      metalness: 0.92,
      roughness: 0.16,
    });
    this.matGem = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.72,
      metalness: 0.35,
      roughness: 0.1,
    });
    this.matWood = new THREE.MeshStandardMaterial({
      color: 0x5c3e24,
      roughness: 0.88,
      metalness: 0.04,
      normalMap: textures.pathNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
    });
    this.matRope = new THREE.MeshStandardMaterial({
      color: 0x8f7146,
      roughness: 0.94,
      metalness: 0.02,
    });
    this.matFire = new THREE.MeshStandardMaterial({
      color: 0xff7722,
      emissive: 0xff4500,
      emissiveIntensity: 1.9,
      roughness: 0.35,
      metalness: 0.0,
    });
    this.matBlade = new THREE.MeshStandardMaterial({
      color: 0xbac4cf,
      metalness: 0.92,
      roughness: 0.2,
    });

    this.matFoliage = new THREE.MeshStandardMaterial({
      color: 0x397c31,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.applyWindShader(this.matFoliage, 'wind-foliage-a', 0.13);

    this.matFoliageAlt = new THREE.MeshStandardMaterial({
      color: 0x549639,
      roughness: 0.68,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.applyWindShader(this.matFoliageAlt, 'wind-foliage-b', 0.17);

    this.matTrunk = new THREE.MeshStandardMaterial({
      color: 0x4f3a27,
      roughness: 0.9,
      metalness: 0.02,
      normalMap: textures.pathNormal,
      normalScale: new THREE.Vector2(0.65, 0.65),
    });
    this.matEyeGlow = new THREE.MeshStandardMaterial({
      color: 0xff4b2b,
      emissive: 0xff3b1f,
      emissiveIntensity: 2.1,
      roughness: 0.2,
    });
    this.materials.push(
      this.matCoin,
      this.matGem,
      this.matWood,
      this.matRope,
      this.matFire,
      this.matBlade,
      this.matFoliage,
      this.matFoliageAlt,
      this.matTrunk,
      this.matEyeGlow
    );

    // Shared geometries
    this.sharedFloorGeo = new THREE.BoxGeometry(TRACK_WIDTH, 1.1, SEGMENT_LENGTH);
    this.sharedCurbGeo = new THREE.BoxGeometry(0.65, 0.72, SEGMENT_LENGTH);
    this.sharedCoinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.09, 16);
    this.sharedGemGeo = new THREE.OctahedronGeometry(0.34, 0);
    this.sharedPillarGeo = new THREE.BoxGeometry(0.76, 2.2, 0.76);
    this.geometries.push(
      this.sharedFloorGeo,
      this.sharedCurbGeo,
      this.sharedCoinGeo,
      this.sharedGemGeo,
      this.sharedPillarGeo
    );

    // 5. Scenic Canyon Gorge Water & Lava Planes with Normal Maps
    const waterGeo = new THREE.PlaneGeometry(340, 340);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x22b5cc,
      map: textures.waterTexture,
      normalMap: textures.waterNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.14,
      metalness: 0.36,
    });
    this.geometries.push(waterGeo);
    this.materials.push(waterMat);
    this.riverPlane = new THREE.Mesh(waterGeo, waterMat);
    this.riverPlane.rotation.x = -Math.PI / 2;
    this.riverPlane.position.y = -11.5;
    this.riverPlane.receiveShadow = false;
    this.root.add(this.riverPlane);

    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xff5a1f,
      map: textures.lavaTexture,
      emissive: 0xff3b00,
      emissiveIntensity: 1.25,
      roughness: 0.38,
    });
    this.materials.push(lavaMat);
    this.lavaPlane = new THREE.Mesh(waterGeo, lavaMat);
    this.lavaPlane.rotation.x = -Math.PI / 2;
    this.lavaPlane.position.y = -11.3;
    this.lavaPlane.visible = false;
    this.root.add(this.lavaPlane);

    // 6. Sculpted Canyon Cliff Ridges, Waterfalls, Distant Pyramid & Soaring Birds
    this.canyonLeft = this.buildCanyonRidge(textures, -1);
    this.canyonRight = this.buildCanyonRidge(textures, 1);
    this.root.add(this.canyonLeft, this.canyonRight);

    this.distantTemple = this.buildDistantTempleLandmark();
    this.root.add(this.distantTemple);

    this.buildSoaringBirds();
    this.root.add(this.birdsGroup);
  }

  private applyWindShader(
    mat: THREE.MeshStandardMaterial,
    cacheKey: string,
    amplitude: number
  ): void {
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windUniform;
      shader.vertexShader =
        `uniform float uWindTime;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          float windFactor = clamp(position.y + 0.5, 0.0, 2.0);
          float worldHash = float((int(modelMatrix[3][0] * 1.7 + modelMatrix[3][2] * 2.3)) & 15);
          transformed.x += sin(uWindTime * 2.1 + worldHash + position.y * 1.8) * ${amplitude.toFixed(3)} * windFactor;
          transformed.z += cos(uWindTime * 1.6 + worldHash * 0.7 + position.x * 1.4) * ${(amplitude * 0.7).toFixed(3)} * windFactor;
          `
        );
    };
  }

  private buildSoaringBirds(): void {
    const wingGeo = this.trackGeo(new THREE.BoxGeometry(0.65, 0.04, 0.22));
    const birdMat = new THREE.MeshStandardMaterial({
      color: 0x222628,
      roughness: 0.75,
    });
    this.materials.push(birdMat);

    for (let i = 0; i < 5; i++) {
      const root = new THREE.Group();
      const leftWing = new THREE.Mesh(wingGeo, birdMat);
      leftWing.position.x = -0.32;
      const rightWing = new THREE.Mesh(wingGeo, birdMat);
      rightWing.position.x = 0.32;
      root.add(leftWing, rightWing);
      this.birdsGroup.add(root);

      this.birds.push({
        root,
        leftWing,
        rightWing,
        angle: (i / 5) * Math.PI * 2,
        radius: 18 + i * 5,
        height: 15 + (i % 3) * 3.5,
        speed: 0.28 + (i % 2) * 0.1,
        phase: i * 1.4,
      });
    }
  }

  private buildCanyonRidge(textures: ProceduralTextureSet, side: -1 | 1): THREE.Group {
    const group = new THREE.Group();
    const cliffMat = new THREE.MeshStandardMaterial({
      color: 0x455e43,
      roughness: 0.9,
      metalness: 0.02,
      normalMap: textures.stoneNormal,
      normalScale: new THREE.Vector2(1.4, 1.4),
    });
    const cliffCapMat = new THREE.MeshStandardMaterial({
      color: 0x3b6e38,
      roughness: 0.88,
      metalness: 0.02,
    });
    const waterfallMat = new THREE.MeshStandardMaterial({
      color: 0x7ae8ff,
      emissive: 0x26b0cc,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.84,
      roughness: 0.15,
    });
    this.materials.push(cliffMat, cliffCapMat, waterfallMat);

    for (let i = 0; i < 8; i++) {
      const z = -90 + i * 28;
      const xOffset = side * (36 + (i % 3) * 9);
      const height = 18 + (i % 4) * 7;
      const radius = 14 + (i % 3) * 4;

      const peak = new THREE.Mesh(
        this.trackGeo(new THREE.ConeGeometry(radius, height, 7)),
        cliffMat
      );
      peak.position.set(xOffset, height * 0.35 - 11, z);
      peak.rotation.y = i * 0.7;
      group.add(peak);

      // Multi-lobe organic jungle canopy & mossy boulder shoulders hugging the cliff
      for (let c = 0; c < 3; c++) {
        const lobe = new THREE.Mesh(
          this.trackGeo(new THREE.IcosahedronGeometry(radius * (0.28 + (c % 2) * 0.08), 0)),
          cliffCapMat
        );
        const angle = c * 2.1 + i * 0.5;
        lobe.position.set(
          xOffset - side * (radius * 0.25) + Math.cos(angle) * (radius * 0.22),
          height * 0.42 - 9.5 + c * 0.7,
          z + Math.sin(angle) * (radius * 0.22)
        );
        lobe.scale.set(1.15, 0.85, 1.15);
        lobe.rotation.set(c * 0.4, angle, 0);
        group.add(lobe);
      }

      if (i === 3 || i === 6) {
        const fall = new THREE.Mesh(
          this.trackGeo(new THREE.PlaneGeometry(3.5, 16)),
          waterfallMat
        );
        fall.position.set(xOffset - side * (radius * 0.45), -4.5, z);
        fall.rotation.y = side === -1 ? Math.PI * 0.42 : -Math.PI * 0.42;
        group.add(fall);
      }
    }
    return group;
  }

  public setQuality(q: QualityLevel): void {
    this.quality = q;
    this.sunShaftGroup.visible = q !== 'low';
    this.ambientMotes.visible = q !== 'low';
    this.birdsGroup.visible = q !== 'low';
  }

  private buildDistantTempleLandmark(): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x76745e,
      roughness: 0.86,
      metalness: 0.04,
      map: this.textures.stoneAlbedo,
      normalMap: this.textures.stoneNormal,
      normalScale: new THREE.Vector2(1.0, 1.0),
    });
    const goldTrim = new THREE.MeshStandardMaterial({
      color: 0xe8b948,
      emissive: 0x5c3e08,
      emissiveIntensity: 0.55,
      metalness: 0.82,
      roughness: 0.22,
    });
    this.materials.push(mat, goldTrim);

    const tiers = [
      {w: 28, h: 6, y: -6},
      {w: 21, h: 6, y: 0},
      {w: 14, h: 5.5, y: 5.7},
      {w: 8, h: 5, y: 10.8},
    ];
    for (const t of tiers) {
      const geo = new THREE.BoxGeometry(t.w, t.h, t.w);
      this.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = t.y;
      group.add(mesh);
    }
    const crownGeo = new THREE.OctahedronGeometry(2.6, 0);
    this.geometries.push(crownGeo);
    const crown = new THREE.Mesh(crownGeo, goldTrim);
    crown.position.y = 15.8;
    group.add(crown);

    group.position.set(-28, 0, -110);
    return group;
  }

  public updateBackdrop(
    playerPos: THREE.Vector3,
    headingRad: number,
    biomeId: BiomeId,
    dt: number
  ): void {
    this.envTime += dt;
    this.windUniform.value = this.envTime;

    const biome = BIOMES[biomeId];
    const t = 1 - Math.exp(-1.5 * dt);

    // Smoothly blend Sky Dome colors + sun angle
    _skyTopTarget.setHex(biome.skyTop);
    _skyBottomTarget.setHex(biome.skyBottom);
    _sunTarget.setHex(biome.sunColor);
    this.skyUniforms.uSkyTop.value.lerp(_skyTopTarget, t);
    this.skyUniforms.uSkyBottom.value.lerp(_skyBottomTarget, t);
    this.skyUniforms.uSunColor.value.lerp(_sunTarget, t);

    const fwdX = -Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const rightX = Math.cos(headingRad);
    const rightZ = -Math.sin(headingRad);

    this.skyDome.position.copy(playerPos);
    this.skyUniforms.uSunDir.value
      .set(fwdX * 0.72 + rightX * 0.42, 0.42, fwdZ * 0.72 + rightZ * 0.42)
      .normalize();

    // Volumetric sun shafts visible outdoors in Medium/High quality
    this.sunShaftGroup.visible = this.quality !== 'low' && !biome.isCavern;
    if (this.sunShaftGroup.visible) {
      this.sunShaftGroup.position.set(playerPos.x, 0, playerPos.z);
      this.sunShaftGroup.rotation.y = headingRad;
      this.sunShaftMat.uniforms.uColor.value.copy(this.skyUniforms.uSunColor.value);
    }

    // Drifting ambient pollen / firefly / ember motes around player
    if (this.ambientMotes.visible) {
      _moteTargetColor.setHex(biome.hasLava ? 0xff7a33 : biome.isCavern ? 0x6ce8ff : 0xffe89e);
      this.moteMat.color.lerp(_moteTargetColor, t);
      this.ambientMotes.position.set(playerPos.x, 0, playerPos.z);
      const posAttr = this.ambientMotes.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < this.moteCount; i++) {
        const seed = this.moteSeeds[i];
        let y = this.motePositions[i * 3 + 1] + Math.sin(this.envTime * 1.4 + seed) * dt * 0.45;
        if (y > 7.2) y = 0.4;
        if (y < 0.3) y = 6.8;
        this.motePositions[i * 3 + 1] = y;
        this.motePositions[i * 3] += Math.cos(this.envTime * 0.9 + seed) * dt * 0.35;
      }
      posAttr.needsUpdate = true;
    }

    // Soaring canyon birds ahead of the runner outdoors
    this.birdsGroup.visible = this.quality !== 'low' && !biome.isCavern;
    if (this.birdsGroup.visible) {
      this.birdsGroup.position.set(
        playerPos.x + fwdX * 52,
        0,
        playerPos.z + fwdZ * 52
      );
      for (const b of this.birds) {
        b.angle += b.speed * dt;
        const bx = Math.cos(b.angle) * b.radius;
        const bz = Math.sin(b.angle) * b.radius;
        b.root.position.set(bx, b.height + Math.sin(this.envTime + b.phase) * 0.8, bz);
        b.root.rotation.y = -b.angle;
        const flap = Math.sin(this.envTime * 7.5 + b.phase) * 0.48;
        b.leftWing.rotation.z = flap;
        b.rightWing.rotation.z = -flap;
      }
    }

    this.riverPlane.position.x = playerPos.x;
    this.riverPlane.position.z = playerPos.z;
    this.lavaPlane.position.x = playerPos.x;
    this.lavaPlane.position.z = playerPos.z;
    this.riverPlane.visible = !biome.hasLava;
    this.lavaPlane.visible = biome.hasLava;

    this.textures.waterTexture.offset.y -= dt * 0.22;
    this.textures.waterNormal.offset.y -= dt * 0.29;
    this.textures.waterNormal.offset.x += dt * 0.08;
    this.textures.lavaTexture.offset.y -= dt * 0.14;

    this.canyonLeft.position.set(playerPos.x, 0, playerPos.z);
    this.canyonLeft.rotation.y = headingRad;

    this.canyonRight.position.set(playerPos.x, 0, playerPos.z);
    this.canyonRight.rotation.y = headingRad;

    this.distantTemple.position.set(
      playerPos.x + fwdX * 115 - rightX * 32,
      -1,
      playerPos.z + fwdZ * 115 - rightZ * 32
    );
    this.distantTemple.rotation.y = headingRad + 0.35;

    this.particles.update(dt);
  }

  public spawnSegment(
    pattern: SegmentPattern,
    origin: THREE.Vector3,
    headingRad: number
  ): ActiveSegment {
    const biome = BIOMES[pattern.biome];
    const group = new THREE.Group();
    group.position.copy(origin);
    group.rotation.y = headingRad;

    const forward = new THREE.Vector3(-Math.sin(headingRad), 0, -Math.cos(headingRad));
    const right = new THREE.Vector3(Math.cos(headingRad), 0, -Math.sin(headingRad));

    const useFlagstone = biome.hasBridgeDrop;
    const stoneMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.stoneBase),
      map: useFlagstone ? this.textures.stoneAlbedo : this.textures.pathAlbedo,
      normalMap: useFlagstone ? this.textures.stoneNormal : this.textures.pathNormal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: useFlagstone ? this.textures.stoneRoughness : this.textures.pathRoughness,
      roughness: 0.92,
      metalness: pattern.biome === 'golden_kingdom' ? 0.35 : 0.05,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.stoneAccent),
      map: this.textures.stoneAlbedo,
      normalMap: this.textures.stoneNormal,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: this.textures.stoneRoughness,
      roughness: 0.86,
      metalness: pattern.biome === 'golden_kingdom' ? 0.55 : 0.1,
    });
    const mossMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.mossColor),
      normalMap: this.textures.pathNormal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.9,
      metalness: 0.02,
    });
    this.materials.push(stoneMat, trimMat, mossMat);

    // Check for full-width broken_bridge gap
    const fullGap = pattern.obstacles.find(
      (o) => o.type === 'broken_bridge' && o.fullWidth
    );

    if (fullGap) {
      const gapStart = Math.max(2, fullGap.zOffset - 1.65);
      const gapEnd = Math.min(pattern.length - 2, fullGap.zOffset + 1.65);
      const len1 = gapStart;
      const g1 = new THREE.BoxGeometry(TRACK_WIDTH, 1.1, len1);
      this.geometries.push(g1);
      const m1 = new THREE.Mesh(g1, stoneMat);
      m1.position.set(0, -0.55, -len1 / 2);
      m1.receiveShadow = true;
      group.add(m1);

      const len2 = pattern.length - gapEnd;
      const g2 = new THREE.BoxGeometry(TRACK_WIDTH, 1.1, len2);
      this.geometries.push(g2);
      const m2 = new THREE.Mesh(g2, stoneMat);
      m2.position.set(0, -0.55, -(gapEnd + len2 / 2));
      m2.receiveShadow = true;
      group.add(m2);

      for (const edgeZ of [gapStart, gapEnd]) {
        for (let bx = -2.4; bx <= 2.4; bx += 1.2) {
          const chunk = new THREE.Mesh(
            this.trackGeo(new THREE.BoxGeometry(0.9, 0.5, 0.6)),
            trimMat
          );
          chunk.position.set(bx, -0.3, -edgeZ);
          chunk.rotation.set(0.25, bx * 0.2, 0.15);
          group.add(chunk);
        }
      }
    } else {
      const floor = new THREE.Mesh(this.sharedFloorGeo, stoneMat);
      floor.position.set(0, -0.55, -pattern.length / 2);
      floor.receiveShadow = true;
      group.add(floor);
    }

    // Suspension bridge rope cables & timber posts specifically in suspended_bridges biome
    if (pattern.biome === 'suspended_bridges') {
      const postGeo = this.trackGeo(new THREE.CylinderGeometry(0.14, 0.16, 1.65, 8));
      const cableGeo = this.trackGeo(new THREE.CylinderGeometry(0.045, 0.045, pattern.length, 6));
      for (const side of [-1, 1] as const) {
        const edgeX = side * (TRACK_WIDTH / 2 + 0.15);
        for (let pz = 3; pz <= pattern.length - 3; pz += 6.5) {
          const post = new THREE.Mesh(postGeo, this.matWood);
          post.position.set(edgeX, 0.82, -pz);
          post.castShadow = true;
          group.add(post);
        }
        for (const ry of [0.78, 1.32]) {
          const rope = new THREE.Mesh(cableGeo, this.matRope);
          rope.rotation.x = Math.PI / 2;
          rope.position.set(edgeX, ry, -pattern.length / 2);
          group.add(rope);
        }
      }
    } else {
      // Side stone parapets / bridge walls
      for (const side of [-1, 1] as const) {
        const curb = new THREE.Mesh(this.sharedCurbGeo, trimMat);
        curb.position.set(side * (TRACK_WIDTH / 2 + 0.3), 0.16, -pattern.length / 2);
        curb.castShadow = true;
        curb.receiveShadow = true;
        group.add(curb);
      }
    }

    for (const side of [-1, 1] as const) {
      if (biome.hasBridgeDrop) {
        const pier = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(1.1, 12, 1.8)),
          trimMat
        );
        pier.position.set(side * (TRACK_WIDTH / 2 - 0.3), -6.5, -pattern.length * 0.5);
        group.add(pier);
      } else {
        const bank = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(6.5, 1.6, pattern.length)),
          mossMat
        );
        bank.position.set(side * (TRACK_WIDTH / 2 + 3.4), -0.35, -pattern.length / 2);
        bank.rotation.z = side * 0.18;
        bank.receiveShadow = true;
        group.add(bank);
      }
    }

    // Cavern ceiling arches for Underground Ruins & Lava Temple
    if (biome.isCavern) {
      for (const az of [6, 19]) {
        const arch = this.buildTempleArch(trimMat, biome.accentEmissive);
        arch.position.set(0, 0, -az);
        group.add(arch);
      }
    }

    // Carved Tiki / Idol Guardian Pillars flanking the track
    const pillarZList = this.quality === 'low' ? [12] : [5, 18];
    for (const pz of pillarZList) {
      for (const side of [-1, 1] as const) {
        if ((pattern.segmentIndex + pz + side) % 2 === 0 || pattern.turnDirection !== 'none') {
          const idol = this.buildIdolGuardian(trimMat, biome.accentEmissive);
          idol.position.set(side * (TRACK_WIDTH / 2 + 0.45), 0, -pz);
          idol.rotation.y = side === -1 ? Math.PI * 0.32 : -Math.PI * 0.32;
          group.add(idol);
        }
      }
    }

    // Wind-animated tropical jungle foliage, ferns, mushrooms & trees along embankments
    if (!biome.isCavern && !biome.hasBridgeDrop) {
      const plantCount = this.quality === 'low' ? 3 : 6;
      for (let i = 0; i < plantCount; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = -2 - (i * pattern.length) / plantCount;
        const x = side * (TRACK_WIDTH / 2 + 1.5 + (i % 3) * 1.1);
        const fern = this.buildTropicalFernCluster(i % 2 === 0);
        fern.position.set(x, 0.1, z);
        fern.rotation.y = i * 1.1;
        group.add(fern);

        if (i % 3 === 0) {
          const tree = this.buildJungleTree();
          tree.position.set(side * (TRACK_WIDTH / 2 + 4.4), 0.1, z - 1.5);
          group.add(tree);
        }
      }
    } else if (biome.hasBridgeDrop) {
      const cliffRock = this.buildCliffOutcrop(trimMat, mossMat, pattern.segmentIndex % 2 === 0);
      cliffRock.position.set(
        pattern.segmentIndex % 2 === 0 ? -8.5 : 8.5,
        -1.5,
        -pattern.length * 0.6
      );
      group.add(cliffRock);
    }

    // Turn Junction Arch & Visual Turn Indicator
    if (pattern.turnDirection !== 'none') {
      const turnArch = this.buildTurnJunctionArch(
        trimMat,
        pattern.turnDirection,
        biome.accentEmissive
      );
      turnArch.position.set(0, 0, -(pattern.length - 3.0));
      group.add(turnArch);
    }

    // Spawn obstacles
    const obstacles: ActiveObstacle[] = [];
    for (const spec of pattern.obstacles) {
      const obsMesh = this.buildObstacleMesh(spec, trimMat, biome.accentEmissive);
      const x = spec.fullWidth ? 0 : LANE_POSITIONS[spec.lane];
      obsMesh.position.set(x, 0, -spec.zOffset);
      group.add(obsMesh);
      obstacles.push({
        spec,
        mesh: obsMesh,
        smashed: false,
        collapsingStarted: false,
        collapseProgress: 0,
        nearMissAwarded: false,
      });
    }

    // Spawn coins & gems
    const coins: ActiveCoin[] = [];
    for (const cSpec of pattern.coins) {
      const cMesh = this.buildCoinMesh(cSpec.isGem);
      cMesh.position.set(LANE_POSITIONS[cSpec.lane], cSpec.yOffset, -cSpec.zOffset);
      group.add(cMesh);
      coins.push({
        spec: cSpec,
        mesh: cMesh,
        collected: false,
        magnetized: false,
        worldPos: new THREE.Vector3(),
      });
    }

    // Spawn power-ups
    const powerUps: ActivePowerUp[] = [];
    for (const pSpec of pattern.powerUps) {
      const pMesh = this.buildPowerUpMesh(pSpec.type);
      pMesh.position.set(LANE_POSITIONS[pSpec.lane], 1.15, -pSpec.zOffset);
      group.add(pMesh);
      powerUps.push({
        spec: pSpec,
        mesh: pMesh,
        collected: false,
      });
    }

    this.root.add(group);
    const active: ActiveSegment = {
      pattern,
      group,
      origin: origin.clone(),
      headingRad,
      forward,
      right,
      obstacles,
      coins,
      powerUps,
      turnHandled: false,
    };
    this.segments.push(active);
    return active;
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private buildIdolGuardian(stoneMat: THREE.Material, glowColor: number): THREE.Group {
    const g = new THREE.Group();
    const base = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.08, 0.36, 1.08)), stoneMat);
    base.position.y = 0.18;
    base.castShadow = true;
    g.add(base);

    const body = new THREE.Mesh(this.sharedPillarGeo, stoneMat);
    body.position.y = 1.35;
    body.castShadow = true;
    g.add(body);

    const nose = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.18, 0.42, 0.16)), stoneMat);
    nose.position.set(0, 1.56, 0.4);
    g.add(nose);

    const jaw = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.46, 0.22, 0.12)), this.matWood);
    jaw.position.set(0, 1.08, 0.36);
    g.add(jaw);

    const brow = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.92, 0.26, 0.9)), stoneMat);
    brow.position.y = 2.45;
    brow.castShadow = true;
    g.add(brow);

    const eyeMat = this.matEyeGlow.clone();
    eyeMat.color.setHex(glowColor);
    eyeMat.emissive.setHex(glowColor);
    this.materials.push(eyeMat);
    const eyeGeo = this.trackGeo(new THREE.BoxGeometry(0.15, 0.12, 0.12));
    for (const ex of [-0.19, 0.19]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ex, 1.88, 0.37);
      g.add(eye);
    }

    const bowl = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.32, 0.18, 0.2, 8)),
      stoneMat
    );
    bowl.position.y = 2.66;
    g.add(bowl);
    const flame = new THREE.Mesh(this.trackGeo(new THREE.ConeGeometry(0.22, 0.48, 8)), this.matFire);
    flame.position.y = 2.92;
    g.add(flame);

    return g;
  }

  private buildTempleArch(stoneMat: THREE.Material, glowColor: number): THREE.Group {
    const g = new THREE.Group();
    const colGeo = this.trackGeo(new THREE.BoxGeometry(0.95, 5.2, 0.95));
    for (const sx of [-TRACK_WIDTH / 2 - 0.3, TRACK_WIDTH / 2 + 0.3]) {
      const col = new THREE.Mesh(colGeo, stoneMat);
      col.position.set(sx, 2.6, 0);
      col.castShadow = true;
      g.add(col);
    }
    const lintel = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(TRACK_WIDTH + 2.2, 1.0, 1.1)),
      stoneMat
    );
    lintel.position.set(0, 5.2, 0);
    g.add(lintel);

    const gem = new THREE.Mesh(this.sharedGemGeo, this.matGem.clone());
    (gem.material as THREE.MeshStandardMaterial).color.setHex(glowColor);
    (gem.material as THREE.MeshStandardMaterial).emissive.setHex(glowColor);
    this.materials.push(gem.material as THREE.Material);
    gem.position.set(0, 5.2, 0.65);
    g.add(gem);
    return g;
  }

  private buildTurnJunctionArch(
    stoneMat: THREE.Material,
    dir: 'left' | 'right',
    glowColor: number
  ): THREE.Group {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(TRACK_WIDTH + 1.4, 3.8, 1.2)),
      stoneMat
    );
    wall.position.set(0, 1.9, -4.0);
    wall.castShadow = true;
    g.add(wall);

    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xffd95a,
      emissive: glowColor,
      emissiveIntensity: 1.5,
      metalness: 0.7,
      roughness: 0.2,
    });
    this.materials.push(arrowMat);
    const arrowCone = new THREE.Mesh(
      this.trackGeo(new THREE.ConeGeometry(0.75, 1.5, 4)),
      arrowMat
    );
    arrowCone.position.set(0, 2.35, -3.25);
    arrowCone.rotation.z = dir === 'left' ? Math.PI / 2 : -Math.PI / 2;
    g.add(arrowCone);

    return g;
  }

  private buildTropicalFernCluster(withMushroom: boolean): THREE.Group {
    const g = new THREE.Group();
    const leafGeo = this.trackGeo(new THREE.ConeGeometry(0.32, 1.35, 5));
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const frond = new THREE.Mesh(leafGeo, i % 2 === 0 ? this.matFoliage : this.matFoliageAlt);
      frond.position.set(Math.cos(ang) * 0.28, 0.45, Math.sin(ang) * 0.28);
      frond.rotation.z = -Math.cos(ang) * 0.75;
      frond.rotation.x = Math.sin(ang) * 0.75;
      g.add(frond);
    }
    if (withMushroom) {
      const capMat = new THREE.MeshStandardMaterial({color: 0xd95338, roughness: 0.52});
      this.materials.push(capMat);
      const stem = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8)),
        this.matWood
      );
      stem.position.set(0.42, 0.15, 0.2);
      const cap = new THREE.Mesh(
        this.trackGeo(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)),
        capMat
      );
      cap.position.set(0.42, 0.28, 0.2);
      g.add(stem, cap);
    }
    return g;
  }

  private buildJungleTree(): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.18, 0.38, 4.4, 8)),
      this.matTrunk
    );
    trunk.position.y = 2.2;
    trunk.rotation.z = 0.08;
    trunk.castShadow = true;
    g.add(trunk);

    // Central crown hub + 2 staggered tiers of sweeping wind-animated palm fronds
    const hub = new THREE.Mesh(
      this.trackGeo(new THREE.IcosahedronGeometry(0.45, 0)),
      this.matFoliage
    );
    hub.position.set(-0.15, 4.45, 0);
    g.add(hub);

    const frondGeo = this.trackGeo(new THREE.ConeGeometry(0.42, 2.5, 5));
    for (let tier = 0; tier < 2; tier++) {
      const count = tier === 0 ? 7 : 5;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + tier * 0.4;
        const frond = new THREE.Mesh(
          frondGeo,
          (i + tier) % 2 === 0 ? this.matFoliage : this.matFoliageAlt
        );
        const r = tier === 0 ? 1.05 : 0.75;
        frond.position.set(Math.cos(ang) * r - 0.15, 4.35 + tier * 0.25, Math.sin(ang) * r);
        frond.rotation.order = 'YXZ';
        frond.rotation.y = -ang;
        frond.rotation.z = tier === 0 ? -1.24 : -0.82;
        frond.scale.set(0.95, 1.0, 0.32);
        frond.castShadow = true;
        g.add(frond);
      }
    }
    return g;
  }

  private buildCliffOutcrop(
    stoneMat: THREE.Material,
    mossMat: THREE.Material,
    withTree: boolean
  ): THREE.Group {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(this.trackGeo(new THREE.DodecahedronGeometry(3.2, 1)), stoneMat);
    rock.scale.set(1.2, 1.6, 1.3);
    g.add(rock);
    const cap = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(2.8, 3.1, 0.8, 8)), mossMat);
    cap.position.y = 2.6;
    g.add(cap);
    if (withTree) {
      const tree = this.buildJungleTree();
      tree.position.y = 2.9;
      g.add(tree);
    }
    return g;
  }

  private buildObstacleMesh(
    spec: ObstacleSpec,
    stoneMat: THREE.Material,
    glowColor: number
  ): THREE.Group {
    const g = new THREE.Group();
    const width = spec.fullWidth ? TRACK_WIDTH - 0.3 : 1.75;

    switch (spec.type) {
      case 'stone_barrier': {
        const wall = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(width, 0.92, 0.65)),
          stoneMat
        );
        wall.position.y = 0.46;
        wall.castShadow = true;
        wall.receiveShadow = true;
        g.add(wall);
        const cap = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(width + 0.14, 0.18, 0.78)),
          this.matWood
        );
        cap.position.y = 0.96;
        g.add(cap);
        break;
      }

      case 'fallen_tree': {
        const log = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.42, 0.48, width, 12)),
          this.matTrunk
        );
        log.rotation.z = Math.PI / 2;
        log.position.y = 0.44;
        log.castShadow = true;
        g.add(log);
        const mossPatch = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(width * 0.55, 0.18, 0.45)),
          this.matFoliage
        );
        mossPatch.position.set(0.15, 0.86, 0);
        g.add(mossPatch);
        break;
      }

      case 'low_branch': {
        const postGeo = this.trackGeo(new THREE.BoxGeometry(0.42, 3.0, 0.48));
        const halfSpan = width / 2 + 0.1;
        for (const sx of [-halfSpan, halfSpan]) {
          const post = new THREE.Mesh(postGeo, stoneMat);
          post.position.set(sx, 1.5, 0);
          post.castShadow = true;
          g.add(post);
        }
        const beam = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.42, 0.46, width + 0.6, 12)),
          this.matTrunk
        );
        beam.rotation.z = Math.PI / 2;
        beam.position.set(0, 1.52, 0);
        beam.castShadow = true;
        g.add(beam);
        for (let vx = -width * 0.35; vx <= width * 0.35; vx += 0.65) {
          const vine = new THREE.Mesh(
            this.trackGeo(new THREE.ConeGeometry(0.15, 0.45, 5)),
            this.matFoliageAlt
          );
          vine.rotation.x = Math.PI;
          vine.position.set(vx, 1.15, 0.25);
          g.add(vine);
        }
        break;
      }

      case 'fire_trap': {
        const brazier = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.55, 0.72, 0.38, 10)),
          stoneMat
        );
        brazier.position.y = 0.19;
        g.add(brazier);
        const flameCore = new THREE.Mesh(
          this.trackGeo(new THREE.ConeGeometry(0.46, 1.15, 8)),
          this.matFire
        );
        flameCore.position.y = 0.85;
        flameCore.name = 'animatedFlame';
        g.add(flameCore);
        break;
      }

      case 'spike_trap': {
        const plate = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(width, 0.14, 1.1)),
          stoneMat
        );
        plate.position.y = 0.07;
        g.add(plate);
        const spikeGeo = this.trackGeo(new THREE.ConeGeometry(0.14, 0.72, 6));
        for (let sx = -width * 0.35; sx <= width * 0.35; sx += 0.38) {
          for (const sz of [-0.28, 0.28]) {
            const spike = new THREE.Mesh(spikeGeo, this.matBlade);
            spike.position.set(sx, 0.45, sz);
            spike.castShadow = true;
            g.add(spike);
          }
        }
        break;
      }

      case 'rotating_gear': {
        const post = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.22, 0.28, 2.7, 10)),
          stoneMat
        );
        post.position.y = 1.35;
        g.add(post);

        const rotor = new THREE.Group();
        rotor.position.y = 1.25;
        rotor.name = 'rotatingBlade';
        const hub = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.32, 0.32, 0.35, 12)),
          this.matBlade
        );
        hub.rotation.x = Math.PI / 2;
        rotor.add(hub);
        for (let b = 0; b < 4; b++) {
          const blade = new THREE.Mesh(
            this.trackGeo(new THREE.BoxGeometry(1.7, 0.18, 0.08)),
            this.matBlade
          );
          blade.rotation.z = (b * Math.PI) / 4;
          rotor.add(blade);
        }
        g.add(rotor);
        break;
      }

      case 'moving_block': {
        const block = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(1.65, 1.75, 1.25)),
          stoneMat
        );
        block.position.y = 0.88;
        block.castShadow = true;
        block.name = 'movingStone';
        const rune = new THREE.Mesh(
          this.trackGeo(new THREE.OctahedronGeometry(0.35, 0)),
          this.matEyeGlow
        );
        rune.position.set(0, 0.9, 0.65);
        block.add(rune);
        g.add(block);
        break;
      }

      case 'rolling_boulder': {
        const boulder = new THREE.Mesh(
          this.trackGeo(new THREE.DodecahedronGeometry(1.02, 1)),
          stoneMat
        );
        boulder.position.y = 1.02;
        boulder.castShadow = true;
        boulder.name = 'rollingBoulder';
        g.add(boulder);
        break;
      }

      case 'collapsing_tile': {
        const tile = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(1.85, 0.25, 1.8)),
          stoneMat
        );
        tile.position.y = 0.08;
        tile.name = 'collapsingTile';
        const warnMat = new THREE.MeshStandardMaterial({
          color: 0xff9a2e,
          emissive: glowColor,
          emissiveIntensity: 0.9,
        });
        this.materials.push(warnMat);
        const crack = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(1.65, 0.28, 0.12)),
          warnMat
        );
        crack.position.y = 0.08;
        g.add(tile, crack);
        break;
      }

      case 'broken_bridge': {
        if (!spec.fullWidth) {
          const gapWarning = new THREE.Mesh(
            this.trackGeo(new THREE.BoxGeometry(1.8, 0.14, 2.8)),
            this.matFire
          );
          gapWarning.position.y = 0.02;
          g.add(gapWarning);
        }
        break;
      }
    }

    return g;
  }

  private buildCoinMesh(isGem: boolean): THREE.Group {
    const g = new THREE.Group();
    if (isGem) {
      const gem = new THREE.Mesh(this.sharedGemGeo, this.matGem);
      g.add(gem);
    } else {
      const disc = new THREE.Mesh(this.sharedCoinGeo, this.matCoin);
      disc.rotation.x = Math.PI / 2;
      g.add(disc);
      const rim = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(0.33, 0.045, 6, 4)),
        this.matCoin
      );
      g.add(rim);
    }
    return g;
  }

  private buildPowerUpMesh(type: PowerUpType): THREE.Group {
    const g = new THREE.Group();
    const meta = POWERUP_META[type];
    const orbMat = new THREE.MeshStandardMaterial({
      color: meta.hex,
      emissive: meta.hex,
      emissiveIntensity: 1.15,
      metalness: 0.4,
      roughness: 0.15,
    });
    this.materials.push(orbMat);
    const core = new THREE.Mesh(this.trackGeo(new THREE.OctahedronGeometry(0.45, 0)), orbMat);
    const ring = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.62, 0.06, 8, 24)), orbMat);
    g.add(core, ring);
    return g;
  }

  public updateSegmentsAnimation(
    dt: number,
    timeSeconds: number,
    playerWorldPos: THREE.Vector3,
    hasMagnet: boolean
  ): void {
    for (const seg of this.segments) {
      for (const coin of seg.coins) {
        if (coin.collected) continue;
        coin.mesh.rotation.y += dt * 3.2;
        coin.mesh.position.y =
          coin.spec.yOffset + Math.sin(timeSeconds * 3.5 + coin.spec.id) * 0.08;

        if (hasMagnet) {
          coin.mesh.getWorldPosition(coin.worldPos);
          const distSq = coin.worldPos.distanceToSquared(playerWorldPos);
          if (distSq < 110) {
            coin.magnetized = true;
          }
          if (coin.magnetized) {
            _tmpVec.copy(playerWorldPos);
            _tmpVec.y += 0.9;
            seg.group.worldToLocal(_tmpVec);
            coin.mesh.position.lerp(_tmpVec, Math.min(1, dt * 13));
          }
        }
      }

      for (const p of seg.powerUps) {
        if (p.collected) continue;
        p.mesh.rotation.y += dt * 2.5;
        p.mesh.position.y = 1.15 + Math.sin(timeSeconds * 3 + p.spec.id) * 0.12;
      }

      for (const obs of seg.obstacles) {
        if (obs.smashed) continue;
        if (obs.spec.type === 'rotating_gear') {
          const blade = obs.mesh.getObjectByName('rotatingBlade');
          if (blade) blade.rotation.z += dt * 3.6;
        } else if (obs.spec.type === 'fire_trap') {
          const flame = obs.mesh.getObjectByName('animatedFlame');
          if (flame) {
            const s = 0.85 + Math.sin(timeSeconds * 16 + obs.spec.id) * 0.2;
            flame.scale.set(1, s, 1);
          }
        } else if (obs.spec.type === 'moving_block') {
          obs.mesh.position.x = Math.sin(timeSeconds * 2.2 + obs.spec.phase) * 2.15;
        } else if (obs.spec.type === 'rolling_boulder') {
          const rollOffset = ((timeSeconds * 4.5 + obs.spec.phase) % 8) - 4;
          obs.mesh.position.z = -(obs.spec.zOffset - rollOffset);
          const rock = obs.mesh.getObjectByName('rollingBoulder');
          if (rock) rock.rotation.x += dt * 5.0;
        } else if (obs.spec.type === 'collapsing_tile' && obs.collapsingStarted) {
          obs.collapseProgress += dt * 2.5;
          obs.mesh.position.y = -obs.collapseProgress * obs.collapseProgress * 3.0;
        }
      }
    }
  }

  public removeSegment(seg: ActiveSegment): void {
    this.root.remove(seg.group);
    const idx = this.segments.indexOf(seg);
    if (idx !== -1) this.segments.splice(idx, 1);
  }

  public clearAllSegments(): void {
    for (const seg of this.segments) {
      this.root.remove(seg.group);
    }
    this.segments.length = 0;
  }

  public dispose(): void {
    this.clearAllSegments();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

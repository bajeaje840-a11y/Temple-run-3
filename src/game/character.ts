import * as THREE from 'three';
import {CHARACTERS} from './constants';
import type {CharacterId} from './types';

export interface CharacterAnimationState {
  distance: number;
  speed: number;
  isJumping: boolean;
  verticalVel: number;
  isSliding: boolean;
  isDead: boolean;
  deathElapsed: number;
  laneBank: number;
  collectTimer: number;
  hasShield: boolean;
  hasMagnet: boolean;
  isInvincible: boolean;
  isBoosting: boolean;
  groundY: number;
  playerY: number;
}

/**
 * Generates an anatomical sculpted LatheGeometry from normalized [radius, y] contour stops.
 */
function createOrganicLimbGeometry(
  profile: Array<[number, number]>,
  radialSegments = 14
): THREE.LatheGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y));
  const geo = new THREE.LatheGeometry(pts, radialSegments);
  geo.computeVertexNormals();
  return geo;
}

export class AdventurerCharacter {
  public readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();

  // Anatomical spine & head hierarchy
  private readonly pelvis = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hairOrCape = new THREE.Group();

  // Articulated arm chains (Shoulder -> Elbow -> Wrist)
  private readonly leftShoulder = new THREE.Group();
  private readonly leftElbow = new THREE.Group();
  private readonly leftWrist = new THREE.Group();
  private readonly rightShoulder = new THREE.Group();
  private readonly rightElbow = new THREE.Group();
  private readonly rightWrist = new THREE.Group();

  // Articulated leg chains (Hip -> Knee -> Ankle -> Foot)
  private readonly leftHip = new THREE.Group();
  private readonly leftKnee = new THREE.Group();
  private readonly leftAnkle = new THREE.Group();
  private readonly rightHip = new THREE.Group();
  private readonly rightKnee = new THREE.Group();
  private readonly rightAnkle = new THREE.Group();

  private readonly shadowMesh: THREE.Mesh;
  private readonly shieldBubble: THREE.Mesh;
  private readonly magnetRing: THREE.Mesh;
  private readonly goldenAura: THREE.Mesh;

  private readonly sharedGeometries: THREE.BufferGeometry[] = [];
  private readonly sharedMaterials: THREE.Material[] = [];
  private charGeometries: THREE.BufferGeometry[] = [];
  private charMaterials: THREE.Material[] = [];

  private squashY = 1;
  private squashXZ = 1;
  private landKneeFlex = 0;
  private lastFootPhase = 0;

  constructor(characterId: CharacterId, shadowTexture: THREE.Texture) {
    // Contact shadow grounded at y=0.018 relative to track floor
    const shadowGeo = new THREE.CircleGeometry(0.68, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.sharedGeometries.push(shadowGeo);
    this.sharedMaterials.push(shadowMat);
    this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = 0.018;
    this.root.add(this.shadowMesh);

    this.root.add(this.rig);

    // Power-up visual auras attached to root
    const shieldGeo = new THREE.SphereGeometry(1.02, 24, 18);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x2fd69d,
      emissive: 0x10a878,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.26,
      roughness: 0.15,
      metalness: 0.3,
      depthWrite: false,
    });
    this.sharedGeometries.push(shieldGeo);
    this.sharedMaterials.push(shieldMat);
    this.shieldBubble = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldBubble.position.y = 0.96;
    this.shieldBubble.visible = false;
    this.root.add(this.shieldBubble);

    const magnetGeo = new THREE.TorusGeometry(0.86, 0.042, 10, 32);
    const magnetMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.8,
    });
    this.sharedGeometries.push(magnetGeo);
    this.sharedMaterials.push(magnetMat);
    this.magnetRing = new THREE.Mesh(magnetGeo, magnetMat);
    this.magnetRing.rotation.x = Math.PI / 2;
    this.magnetRing.position.y = 0.92;
    this.magnetRing.visible = false;
    this.root.add(this.magnetRing);

    const auraGeo = new THREE.TorusGeometry(0.76, 0.05, 10, 32);
    const auraMat = new THREE.MeshStandardMaterial({
      color: 0xffd95a,
      emissive: 0xffb300,
      emissiveIntensity: 1.4,
      roughness: 0.15,
      metalness: 0.9,
    });
    this.sharedGeometries.push(auraGeo);
    this.sharedMaterials.push(auraMat);
    this.goldenAura = new THREE.Mesh(auraGeo, auraMat);
    this.goldenAura.position.y = 0.96;
    this.goldenAura.visible = false;
    this.root.add(this.goldenAura);

    this.buildCharacterGeometry(characterId);
  }

  public setCharacter(characterId: CharacterId): void {
    while (this.rig.children.length > 0) {
      this.rig.remove(this.rig.children[0]);
    }
    this.pelvis.clear();
    this.spine.clear();
    this.chest.clear();
    this.neck.clear();
    this.head.clear();
    this.hairOrCape.clear();
    this.leftShoulder.clear();
    this.leftElbow.clear();
    this.leftWrist.clear();
    this.rightShoulder.clear();
    this.rightElbow.clear();
    this.rightWrist.clear();
    this.leftHip.clear();
    this.leftKnee.clear();
    this.leftAnkle.clear();
    this.rightHip.clear();
    this.rightKnee.clear();
    this.rightAnkle.clear();

    for (const g of this.charGeometries) g.dispose();
    for (const m of this.charMaterials) m.dispose();
    this.charGeometries = [];
    this.charMaterials = [];

    this.buildCharacterGeometry(characterId);
  }

  private addPart(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number],
    scale?: [number, number, number],
    castShadow = true
  ): THREE.Mesh {
    this.charGeometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildCharacterGeometry(characterId: CharacterId): void {
    const cfg = CHARACTERS[characterId];
    const isFemale = characterId === 'aurelia' || characterId === 'solara';

    const matPrimary = new THREE.MeshStandardMaterial({
      color: cfg.primaryColor,
      roughness: 0.56,
      metalness: 0.08,
    });
    const matSecondary = new THREE.MeshStandardMaterial({
      color: cfg.secondaryColor,
      roughness: 0.74,
      metalness: 0.06,
    });
    const matSkin = new THREE.MeshStandardMaterial({
      color: cfg.skinColor,
      roughness: 0.48,
      metalness: 0.02,
    });
    const matHair = new THREE.MeshStandardMaterial({
      color: cfg.hairColor,
      roughness: 0.62,
      metalness: 0.08,
    });
    const matAccent = new THREE.MeshStandardMaterial({
      color: cfg.accentColor,
      roughness: 0.24,
      metalness: 0.82,
    });
    const matBoot = new THREE.MeshStandardMaterial({
      color: 0x261b14,
      roughness: 0.78,
      metalness: 0.12,
    });
    const matSole = new THREE.MeshStandardMaterial({
      color: 0x161210,
      roughness: 0.92,
      metalness: 0.04,
    });
    const matWhite = new THREE.MeshStandardMaterial({
      color: 0xede8dc,
      roughness: 0.68,
      metalness: 0.02,
    });
    this.charMaterials.push(
      matPrimary,
      matSecondary,
      matSkin,
      matHair,
      matAccent,
      matBoot,
      matSole,
      matWhite
    );

    // 1. Pelvis (center of mass at hip height y = 0.90)
    this.pelvis.position.set(0, 0.9, 0);
    this.rig.add(this.pelvis);

    const pelvisGeo = createOrganicLimbGeometry(
      [
        [0.001, -0.11],
        [isFemale ? 0.165 : 0.16, -0.08],
        [isFemale ? 0.19 : 0.175, 0.0],
        [isFemale ? 0.145 : 0.155, 0.1],
        [0.001, 0.11],
      ],
      16
    );
    this.addPart(this.pelvis, pelvisGeo, matSecondary, [0, 0, 0], undefined, [1.08, 1, 0.78]);

    // Leather utility belt + carved brass buckle + side relic pouch
    this.addPart(
      this.pelvis,
      new THREE.CylinderGeometry(0.162, 0.172, 0.058, 16),
      matBoot,
      [0, 0.09, 0],
      undefined,
      [1.08, 1, 0.8]
    );
    this.addPart(
      this.pelvis,
      new THREE.BoxGeometry(0.08, 0.062, 0.04),
      matAccent,
      [0, 0.09, -0.145]
    );
    this.addPart(
      this.pelvis,
      new THREE.BoxGeometry(0.09, 0.15, 0.13),
      matBoot,
      [0.2, -0.02, 0.01],
      [0, 0, -0.14]
    );
    this.addPart(
      this.pelvis,
      new THREE.BoxGeometry(0.095, 0.035, 0.135),
      matAccent,
      [0.205, 0.03, 0.01],
      [0, 0, -0.14]
    );

    // 2. Lumbar Spine -> Sculpted Ribcage / Chest
    this.spine.position.set(0, 0.11, 0);
    this.pelvis.add(this.spine);

    const waistGeo = createOrganicLimbGeometry(
      [
        [isFemale ? 0.13 : 0.145, 0.0],
        [isFemale ? 0.125 : 0.148, 0.09],
        [isFemale ? 0.155 : 0.175, 0.17],
      ],
      16
    );
    this.addPart(this.spine, waistGeo, matPrimary, [0, 0, 0], undefined, [1.08, 1, 0.78]);

    this.chest.position.set(0, 0.15, 0);
    this.spine.add(this.chest);

    const chestGeo = createOrganicLimbGeometry(
      [
        [isFemale ? 0.145 : 0.168, 0.0],
        [isFemale ? 0.195 : 0.215, 0.13],
        [isFemale ? 0.205 : 0.228, 0.24],
        [0.125, 0.3],
        [0.068, 0.33],
      ],
      18
    );
    this.addPart(this.chest, chestGeo, matPrimary, [0, 0, 0], undefined, [1.08, 1, 0.76]);

    // Collarbone trim & expedition backpack (+Z faces camera)
    this.addPart(
      this.chest,
      new THREE.TorusGeometry(0.09, 0.018, 8, 18),
      matAccent,
      [0, 0.3, -0.01],
      [Math.PI / 2 + 0.18, 0, 0]
    );
    const packGeo = new THREE.BoxGeometry(0.24, 0.26, 0.12);
    this.addPart(this.chest, packGeo, matSecondary, [0, 0.15, 0.165]);
    this.addPart(
      this.chest,
      new THREE.CylinderGeometry(0.048, 0.048, 0.24, 10),
      matAccent,
      [0, 0.02, 0.21],
      [0, 0, Math.PI / 2]
    );
    // Shoulder harness straps wrapping chest
    for (const sx of [-0.11, 0.11]) {
      this.addPart(
        this.chest,
        new THREE.BoxGeometry(0.042, 0.28, 0.25),
        matBoot,
        [sx, 0.16, 0.02]
      );
    }

    // Optional Flowing Cape (Kael / Solara)
    if (cfg.hasCape) {
      this.hairOrCape.position.set(0, 0.29, 0.17);
      this.addPart(
        this.hairOrCape,
        new THREE.BoxGeometry(0.35, 0.66, 0.03),
        matAccent,
        [0, -0.32, 0.04],
        [0.14, 0, 0]
      );
      this.chest.add(this.hairOrCape);
    }

    // 3. Neck & Sculpted Cranium / Jaw / Hair
    this.neck.position.set(0, 0.33, -0.01);
    this.chest.add(this.neck);

    const neckGeo = createOrganicLimbGeometry(
      [
        [0.066, 0.0],
        [0.056, 0.05],
        [0.058, 0.1],
      ],
      12
    );
    this.addPart(this.neck, neckGeo, matSkin, [0, -0.01, 0]);

    this.head.position.set(0, 0.09, 0);
    this.neck.add(this.head);

    // Jaw + Cranium sculpted head
    const craniumGeo = createOrganicLimbGeometry(
      [
        [0.001, -0.02],
        [0.078, 0.01],
        [0.125, 0.07],
        [0.142, 0.14],
        [0.135, 0.21],
        [0.095, 0.265],
        [0.001, 0.285],
      ],
      18
    );
    this.addPart(this.head, craniumGeo, matSkin, [0, 0, 0], undefined, [0.96, 1, 1.06]);

    // Hair volume cap
    this.addPart(
      this.head,
      new THREE.SphereGeometry(0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.65),
      matHair,
      [0, 0.155, 0.02],
      [0.24, 0, 0],
      [0.98, 1, 1.05]
    );

    if (cfg.hasHat) {
      // Wide-brim Relic Hunter Fedora
      this.addPart(
        this.head,
        new THREE.CylinderGeometry(0.28, 0.3, 0.028, 18),
        matSecondary,
        [0, 0.25, 0],
        [-0.08, 0, 0]
      );
      this.addPart(
        this.head,
        new THREE.CylinderGeometry(0.118, 0.15, 0.13, 14),
        matSecondary,
        [0, 0.32, 0],
        [-0.08, 0, 0]
      );
      this.addPart(
        this.head,
        new THREE.CylinderGeometry(0.152, 0.155, 0.028, 14),
        matAccent,
        [0, 0.27, 0],
        [-0.08, 0, 0]
      );
    } else if (!cfg.hasCape) {
      // Athletic sculpted ponytail swinging smoothly behind (+Z faces camera)
      this.hairOrCape.position.set(0, 0.16, 0.15);
      const ponyGeo = createOrganicLimbGeometry(
        [
          [0.001, -0.34],
          [0.036, -0.22],
          [0.068, -0.09],
          [0.042, 0.0],
          [0.001, 0.02],
        ],
        12
      );
      this.addPart(
        this.hairOrCape,
        ponyGeo,
        matHair,
        [0, 0, 0.03],
        [-0.45, 0, 0]
      );
      this.head.add(this.hairOrCape);
    } else {
      // Warrior circlet
      this.addPart(
        this.head,
        new THREE.TorusGeometry(0.148, 0.02, 8, 20),
        matAccent,
        [0, 0.2, 0],
        [Math.PI / 2, 0, 0]
      );
    }

    // 4. Articulated Anatomical Arms (Shoulder -> Elbow -> Wrist/Gloved Hand)
    const upperArmGeo = createOrganicLimbGeometry(
      [
        [0.056, 0.0],
        [0.058, -0.06],
        [0.052, -0.15],
        [0.044, -0.24],
      ],
      12
    );
    const forearmGeo = createOrganicLimbGeometry(
      [
        [0.045, 0.0],
        [0.048, -0.05],
        [0.038, -0.14],
        [0.031, -0.22],
      ],
      12
    );

    const buildArm = (
      shoulderGroup: THREE.Group,
      elbowGroup: THREE.Group,
      wristGroup: THREE.Group,
      side: -1 | 1
    ) => {
      shoulderGroup.position.set(side * (isFemale ? 0.23 : 0.255), 0.26, 0);
      this.chest.add(shoulderGroup);

      // Deltoid sleeve cap + anatomical upper arm
      this.addPart(shoulderGroup, new THREE.SphereGeometry(0.068, 12, 10), matPrimary, [0, 0, 0]);
      this.addPart(shoulderGroup, upperArmGeo.clone(), matSkin, [0, -0.02, 0]);

      elbowGroup.position.set(0, -0.25, 0);
      shoulderGroup.add(elbowGroup);

      // Elbow joint + forearm + leather wrist guard
      this.addPart(elbowGroup, new THREE.SphereGeometry(0.043, 10, 10), matSkin, [0, 0, 0]);
      this.addPart(elbowGroup, forearmGeo.clone(), matSkin, [0, 0, 0]);
      this.addPart(
        elbowGroup,
        new THREE.CylinderGeometry(0.042, 0.044, 0.055, 10),
        matAccent,
        [0, -0.16, 0]
      );

      wristGroup.position.set(0, -0.22, 0);
      elbowGroup.add(wristGroup);

      // Fingerless expedition glove & sculpted hand
      this.addPart(
        wristGroup,
        new THREE.BoxGeometry(0.05, 0.085, 0.068),
        matBoot,
        [0, -0.04, -0.005]
      );
      this.addPart(
        wristGroup,
        new THREE.SphereGeometry(0.026, 8, 8),
        matSkin,
        [side * -0.015, -0.085, -0.015]
      );
    };

    upperArmGeo.dispose();
    forearmGeo.dispose();

    buildArm(this.leftShoulder, this.leftElbow, this.leftWrist, -1);
    buildArm(this.rightShoulder, this.rightElbow, this.rightWrist, 1);

    // 5. Articulated Anatomical Legs (Hip -> Knee -> Ankle -> Sculpted Boot)
    const thighMat = characterId === 'aurelia' ? matSkin : matSecondary;
    const calfMat = characterId === 'aurelia' ? matSkin : matSecondary;

    const thighGeo = createOrganicLimbGeometry(
      [
        [0.084, 0.0],
        [0.082, -0.09],
        [0.072, -0.22],
        [0.058, -0.36],
        [0.054, -0.4],
      ],
      14
    );
    const calfGeo = createOrganicLimbGeometry(
      [
        [0.054, 0.0],
        [0.064, -0.08],
        [0.056, -0.18],
        [0.043, -0.3],
        [0.04, -0.36],
      ],
      14
    );

    const buildLeg = (
      hipGroup: THREE.Group,
      kneeGroup: THREE.Group,
      ankleGroup: THREE.Group,
      side: -1 | 1
    ) => {
      hipGroup.position.set(side * (isFemale ? 0.105 : 0.112), 0.87, 0);
      this.rig.add(hipGroup);

      this.addPart(hipGroup, new THREE.SphereGeometry(0.082, 12, 10), thighMat, [0, -0.02, 0]);
      this.addPart(hipGroup, thighGeo.clone(), thighMat, [0, 0, 0]);

      kneeGroup.position.set(0, -0.39, 0);
      hipGroup.add(kneeGroup);

      // Kneecap + Calf + Sock Cuff
      this.addPart(kneeGroup, new THREE.SphereGeometry(0.055, 10, 10), calfMat, [0, 0, -0.005]);
      this.addPart(kneeGroup, calfGeo.clone(), calfMat, [0, 0, 0]);
      this.addPart(
        kneeGroup,
        new THREE.CylinderGeometry(0.052, 0.05, 0.065, 12),
        matWhite,
        [0, -0.33, 0]
      );

      ankleGroup.position.set(0, -0.39, 0);
      kneeGroup.add(ankleGroup);

      // Sculpted Hiking Boot (Ankle collar + Heel + Toe box + Treaded Sole)
      this.addPart(
        ankleGroup,
        new THREE.CylinderGeometry(0.054, 0.058, 0.08, 12),
        matBoot,
        [0, -0.01, 0]
      );
      this.addPart(
        ankleGroup,
        new THREE.BoxGeometry(0.11, 0.07, 0.16),
        matBoot,
        [0, -0.055, -0.03]
      );
      this.addPart(
        ankleGroup,
        new THREE.SphereGeometry(0.056, 10, 10),
        matBoot,
        [0, -0.058, -0.105],
        undefined,
        [1, 0.65, 1.15]
      );
      this.addPart(
        ankleGroup,
        new THREE.BoxGeometry(0.118, 0.026, 0.235),
        matSole,
        [0, -0.095, -0.045]
      );
    };

    thighGeo.dispose();
    calfGeo.dispose();

    buildLeg(this.leftHip, this.leftKnee, this.leftAnkle, -1);
    buildLeg(this.rightHip, this.rightKnee, this.rightAnkle, 1);
  }

  public triggerJumpSquash(): void {
    this.squashY = 1.18;
    this.squashXZ = 0.88;
  }

  public triggerLandSquash(): void {
    this.squashY = 0.8;
    this.squashXZ = 1.15;
    this.landKneeFlex = 0.45;
  }

  /**
   * Updates biomechanical character animation, returning true on footstep heel strikes.
   */
  public update(dt: number, state: CharacterAnimationState): boolean {
    let stepped = false;

    const dampAlpha = 1 - Math.exp(-15 * dt);
    this.squashY = THREE.MathUtils.lerp(this.squashY, 1, dampAlpha);
    this.squashXZ = THREE.MathUtils.lerp(this.squashXZ, 1, dampAlpha);
    this.landKneeFlex = THREE.MathUtils.lerp(this.landKneeFlex, 0, 1 - Math.exp(-12 * dt));

    // Grounded contact shadow tracks height above floor
    const heightAboveFloor = Math.max(0, state.playerY - state.groundY);
    const shadowScale = Math.max(0.35, 1 - heightAboveFloor * 0.22);
    this.shadowMesh.position.y = -heightAboveFloor + 0.018;
    this.shadowMesh.scale.setScalar(shadowScale);
    (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity =
      0.58 * Math.max(0.15, 1 - heightAboveFloor * 0.28);

    // Power-up visual indicators
    this.shieldBubble.visible = state.hasShield;
    if (state.hasShield) {
      this.shieldBubble.rotation.y += dt * 1.4;
      const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.035;
      this.shieldBubble.scale.setScalar(pulse);
    }

    this.magnetRing.visible = state.hasMagnet;
    if (state.hasMagnet) {
      this.magnetRing.rotation.z += dt * 4.0;
    }

    this.goldenAura.visible = state.isInvincible || state.isBoosting;
    if (this.goldenAura.visible) {
      this.goldenAura.rotation.y += dt * 6;
      this.goldenAura.rotation.x = Math.sin(performance.now() * 0.008) * 0.45;
    }

    if (state.isDead) {
      // Multi-joint stumble and collapse
      const t = Math.min(1, state.deathElapsed * 2.4);
      const ease = 1 - Math.pow(1 - t, 3);
      this.rig.position.y = THREE.MathUtils.lerp(0, -0.45, ease);
      this.rig.rotation.x = THREE.MathUtils.lerp(0, -Math.PI * 0.47, ease);
      this.rig.rotation.z = state.laneBank * 0.35 + Math.sin(t * 6) * 0.12;
      this.spine.rotation.x = -0.35 * ease;
      this.head.rotation.x = 0.45 * ease;
      this.leftShoulder.rotation.set(-1.35 * ease, 0, -0.45 * ease);
      this.rightShoulder.rotation.set(-1.65 * ease, 0, 0.5 * ease);
      this.leftElbow.rotation.x = -0.4;
      this.rightElbow.rotation.x = -0.7;
      this.leftHip.rotation.x = 0.55 * ease;
      this.rightHip.rotation.x = -0.25 * ease;
      this.leftKnee.rotation.x = 0.75 * ease;
      this.rightKnee.rotation.x = 0.3 * ease;
      return false;
    }

    const strideFreq = 1.48;
    const phase = state.distance * strideFreq;

    if (state.isSliding) {
      // Low athletic baseball slide: lead leg extended, trail leg tucked, trailing hand balances
      this.rig.position.y = THREE.MathUtils.lerp(this.rig.position.y, -0.5, dampAlpha);
      this.rig.rotation.x = THREE.MathUtils.lerp(this.rig.rotation.x, 1.05, dampAlpha);
      this.rig.rotation.z = THREE.MathUtils.lerp(
        this.rig.rotation.z,
        state.laneBank * 0.32,
        dampAlpha
      );
      this.pelvis.rotation.set(0, 0.22, 0.08);
      this.spine.rotation.set(-0.22, -0.18, 0);
      this.chest.rotation.set(-0.1, -0.12, 0);
      this.head.rotation.set(-0.75, 0.1, 0);
      this.hairOrCape.rotation.x = 0.65;

      this.leftHip.rotation.set(-0.62, 0, 0.06);
      this.leftKnee.rotation.x = 0.14;
      this.leftAnkle.rotation.x = -0.35;

      this.rightHip.rotation.set(-0.18, 0, -0.06);
      this.rightKnee.rotation.x = 1.25;
      this.rightAnkle.rotation.x = 0.25;

      this.leftShoulder.rotation.set(-0.85, 0, -0.28);
      this.leftElbow.rotation.x = -0.35;
      this.rightShoulder.rotation.set(0.65, 0, 0.32);
      this.rightElbow.rotation.x = -0.45;
    } else if (state.isJumping) {
      // Dynamic parabolic leap: takeoff knee drive transitioning to landing anticipation
      this.rig.position.y = THREE.MathUtils.lerp(this.rig.position.y, 0, dampAlpha);
      const airPitch = THREE.MathUtils.clamp(-state.verticalVel * 0.024, -0.28, 0.28);
      this.rig.rotation.x = THREE.MathUtils.lerp(this.rig.rotation.x, airPitch, dampAlpha);
      this.rig.rotation.z = THREE.MathUtils.lerp(
        this.rig.rotation.z,
        -state.laneBank * 0.26,
        dampAlpha
      );

      const rising = state.verticalVel > 0;
      this.pelvis.rotation.set(0, 0.12, 0);
      this.spine.rotation.set(rising ? -0.12 : -0.2, -0.1, 0);
      this.chest.rotation.set(-0.08, -0.08, 0);
      this.head.rotation.set(0.18, 0.06, 0);
      this.hairOrCape.rotation.x = rising ? 0.5 : 0.72;

      const leadHip = rising ? -0.95 : -0.55;
      const trailHip = rising ? 0.58 : 0.18;
      this.leftHip.rotation.set(leadHip, 0, -0.05);
      this.leftKnee.rotation.x = rising ? 1.28 : 0.62;
      this.leftAnkle.rotation.x = rising ? 0.35 : -0.22;

      this.rightHip.rotation.set(trailHip, 0, 0.05);
      this.rightKnee.rotation.x = rising ? 0.52 : 0.78;
      this.rightAnkle.rotation.x = 0.25;

      this.leftShoulder.rotation.set(rising ? -1.35 : -0.75, 0, -0.24);
      this.leftElbow.rotation.x = -0.95;
      this.rightShoulder.rotation.set(rising ? 0.7 : 0.3, 0, 0.24);
      this.rightElbow.rotation.x = -0.85;
    } else {
      // Grounded Human Sprint Biomechanics
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      const speedNorm = THREE.MathUtils.clamp((state.speed - 8) / 24, 0, 1);

      if ((this.lastFootPhase < 0 && s >= 0) || (this.lastFootPhase > 0 && s <= 0)) {
        stepped = state.speed > 1;
      }
      this.lastFootPhase = s;

      // Double-frequency vertical center-of-mass bounce (lowest at mid-stance, highest at flight)
      const strideBob = Math.abs(c) * (0.065 + speedNorm * 0.025) - this.landKneeFlex * 0.14;
      this.rig.position.y = THREE.MathUtils.lerp(this.rig.position.y, strideBob, 0.68);

      // Progressive sprint lean into velocity + lateral bank into lane switch
      const forwardLean = -0.14 - speedNorm * 0.12;
      this.rig.rotation.x = THREE.MathUtils.lerp(this.rig.rotation.x, forwardLean, dampAlpha);
      this.rig.rotation.z = THREE.MathUtils.lerp(
        this.rig.rotation.z,
        -state.laneBank * 0.34,
        dampAlpha
      );

      // Weight shift: pelvis drops slightly on swing leg & rotates opposite shoulders
      this.pelvis.rotation.set(0.04, s * 0.16, -s * 0.065);
      this.spine.rotation.set(-0.08 - speedNorm * 0.06, -s * 0.12, s * 0.04);
      this.chest.rotation.set(-0.06, -s * 0.12, 0);
      // Stabilized head keeps eyes level on horizon
      this.head.rotation.set(0.16 + speedNorm * 0.08, s * 0.08, -state.laneBank * 0.12);
      this.neck.rotation.x = 0.05;

      // Hair / cape spring bounce
      this.hairOrCape.rotation.x = 0.28 + speedNorm * 0.25 + Math.abs(s) * 0.22;
      this.hairOrCape.rotation.z = Math.sin(phase * 0.5) * 0.08;

      // Asymmetric thigh & knee flexion curve (high drive forward, firm push-off behind)
      const leftHipRot = s * (0.86 + speedNorm * 0.16) + this.landKneeFlex * 0.5;
      const rightHipRot = -s * (0.86 + speedNorm * 0.16) + this.landKneeFlex * 0.5;
      this.leftHip.rotation.set(leftHipRot, 0, -0.03);
      this.rightHip.rotation.set(rightHipRot, 0, 0.03);

      // Knee bends deeply during swing recovery (when hip swings backward/lifting), nearly straightens at heel strike
      this.leftKnee.rotation.x =
        Math.max(0.1, -c * 0.95 + 0.42) + this.landKneeFlex * 0.85;
      this.rightKnee.rotation.x =
        Math.max(0.1, c * 0.95 + 0.42) + this.landKneeFlex * 0.85;

      // Heel-strike dorsiflexion -> toe-off plantarflexion
      this.leftAnkle.rotation.x = THREE.MathUtils.clamp(-s * 0.38 + c * 0.18, -0.45, 0.45);
      this.rightAnkle.rotation.x = THREE.MathUtils.clamp(s * 0.38 - c * 0.18, -0.45, 0.45);

      // Opposite arm swing with natural forward elbow flexion and shoulder sweep
      const armSwing = 0.64 + speedNorm * 0.16;
      const shoulderNeutral = 0.16 + speedNorm * 0.06;
      const rightSwingX = shoulderNeutral + s * armSwing;
      const rightElbowX = 1.24 + s * 0.22 + speedNorm * 0.08;
      if (state.collectTimer > 0) {
        const reach = Math.sin(Math.min(1, state.collectTimer / 0.25) * Math.PI);
        this.rightShoulder.rotation.set(
          THREE.MathUtils.lerp(rightSwingX, 1.38, reach * 0.65),
          THREE.MathUtils.lerp(s * 0.14, 0.12, reach * 0.65),
          0.16 - s * 0.03
        );
        this.rightElbow.rotation.x = THREE.MathUtils.lerp(rightElbowX, 0.72, reach * 0.65);
        this.rightWrist.rotation.x = 0.08;
      } else {
        this.rightShoulder.rotation.set(rightSwingX, s * 0.14, 0.16 - s * 0.03);
        this.rightElbow.rotation.x = rightElbowX;
        this.rightWrist.rotation.x = 0.08;
      }
      this.leftShoulder.rotation.set(shoulderNeutral - s * armSwing, s * 0.14, -0.16 - s * 0.03);
      this.leftElbow.rotation.x = 1.24 - s * 0.22 + speedNorm * 0.08;
      this.leftWrist.rotation.x = 0.08;
    }

    this.rig.scale.set(this.squashXZ, this.squashY, this.squashXZ);
    return stepped;
  }

  public dispose(): void {
    for (const g of this.sharedGeometries) g.dispose();
    for (const m of this.sharedMaterials) m.dispose();
    for (const g of this.charGeometries) g.dispose();
    for (const m of this.charMaterials) m.dispose();
  }
}

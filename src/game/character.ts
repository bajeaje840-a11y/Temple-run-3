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
 * Generates an anatomical sculpted LatheGeometry from [radius, y] contour stops.
 */
function createOrganicLimbGeometry(
  profile: Array<[number, number]>,
  radialSegments = 16
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

  // Articulated 2-segment trailing hair / cape chain
  private readonly hairOrCape = new THREE.Group();
  private readonly hairOrCapeTip = new THREE.Group();

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

  // Damped persistent joint channels for seamless transition between Run/Jump/Slide/Land
  private smoothRigY = 0;
  private smoothRigPitch = -0.16;
  private smoothRigRoll = 0;
  private smoothPelvisPitch = 0.04;
  private smoothPelvisYaw = 0;
  private smoothPelvisRoll = 0;
  private smoothSpinePitch = -0.08;
  private smoothSpineYaw = 0;
  private smoothChestYaw = 0;
  private smoothHeadPitch = 0.16;
  private smoothLeftHip = 0;
  private smoothRightHip = 0;
  private smoothLeftKnee = -0.15;
  private smoothRightKnee = -0.15;
  private smoothLeftAnkle = 0;
  private smoothRightAnkle = 0;
  private smoothLeftShoulder = 0.18;
  private smoothRightShoulder = 0.18;
  private smoothLeftElbow = 1.24;
  private smoothRightElbow = 1.24;
  private smoothTrailBase = -0.35;
  private smoothTrailTip = -0.25;

  constructor(characterId: CharacterId, shadowTexture: THREE.Texture) {
    // Contact shadow grounded at y=0.018 relative to track floor
    const shadowGeo = new THREE.CircleGeometry(0.72, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.62,
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
    this.hairOrCapeTip.clear();
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
      roughness: 0.62,
      metalness: 0.06,
    });
    const matSecondary = new THREE.MeshStandardMaterial({
      color: cfg.secondaryColor,
      roughness: 0.74,
      metalness: 0.05,
    });
    const matSkin = new THREE.MeshStandardMaterial({
      color: cfg.skinColor,
      roughness: 0.44,
      metalness: 0.02,
    });
    const matHair = new THREE.MeshStandardMaterial({
      color: cfg.hairColor,
      roughness: 0.54,
      metalness: 0.1,
    });
    const matAccent = new THREE.MeshStandardMaterial({
      color: cfg.accentColor,
      roughness: 0.24,
      metalness: 0.82,
    });
    const matBoot = new THREE.MeshStandardMaterial({
      color: 0x261b14,
      roughness: 0.66,
      metalness: 0.12,
    });
    const matSole = new THREE.MeshStandardMaterial({
      color: 0x161210,
      roughness: 0.92,
      metalness: 0.04,
    });
    const matWhite = new THREE.MeshStandardMaterial({
      color: 0xede8dc,
      roughness: 0.7,
      metalness: 0.02,
    });
    const matEye = new THREE.MeshStandardMaterial({
      color: 0x1e1815,
      roughness: 0.2,
      metalness: 0.1,
    });
    this.charMaterials.push(
      matPrimary,
      matSecondary,
      matSkin,
      matHair,
      matAccent,
      matBoot,
      matSole,
      matWhite,
      matEye
    );

    // 1. Pelvis (center of mass at hip height y = 0.90)
    this.pelvis.position.set(0, 0.9, 0);
    this.rig.add(this.pelvis);

    const pelvisGeo = createOrganicLimbGeometry(
      [
        [0.001, -0.115],
        [isFemale ? 0.168 : 0.162, -0.08],
        [isFemale ? 0.192 : 0.178, 0.0],
        [isFemale ? 0.145 : 0.156, 0.105],
        [0.001, 0.115],
      ],
      18
    );
    this.addPart(this.pelvis, pelvisGeo, matSecondary, [0, 0, 0], undefined, [1.08, 1, 0.78]);

    // Leather utility belt + brass buckle + thigh holster/relic pouch
    this.addPart(
      this.pelvis,
      new THREE.CylinderGeometry(0.162, 0.172, 0.058, 18),
      matBoot,
      [0, 0.09, 0],
      undefined,
      [1.08, 1, 0.8]
    );
    this.addPart(
      this.pelvis,
      new THREE.BoxGeometry(0.082, 0.062, 0.04),
      matAccent,
      [0, 0.09, -0.145]
    );
    this.addPart(
      this.pelvis,
      new THREE.BoxGeometry(0.092, 0.155, 0.135),
      matBoot,
      [0.2, -0.02, 0.01],
      [0, 0, -0.14]
    );
    this.addPart(
      this.pelvis,
      new THREE.BoxGeometry(0.098, 0.034, 0.138),
      matAccent,
      [0.205, 0.032, 0.01],
      [0, 0, -0.14]
    );

    // 2. Lumbar Spine -> Sculpted Ribcage / Chest
    this.spine.position.set(0, 0.11, 0);
    this.pelvis.add(this.spine);

    const waistGeo = createOrganicLimbGeometry(
      [
        [isFemale ? 0.128 : 0.146, 0.0],
        [isFemale ? 0.124 : 0.148, 0.09],
        [isFemale ? 0.156 : 0.176, 0.17],
      ],
      18
    );
    this.addPart(this.spine, waistGeo, matPrimary, [0, 0, 0], undefined, [1.08, 1, 0.78]);

    this.chest.position.set(0, 0.15, 0);
    this.spine.add(this.chest);

    const chestGeo = createOrganicLimbGeometry(
      [
        [isFemale ? 0.144 : 0.168, 0.0],
        [isFemale ? 0.196 : 0.218, 0.13],
        [isFemale ? 0.206 : 0.23, 0.24],
        [0.126, 0.3],
        [0.068, 0.33],
      ],
      18
    );
    this.addPart(this.chest, chestGeo, matPrimary, [0, 0, 0], undefined, [1.08, 1, 0.76]);

    // Collarbone trim & expedition backpack (+Z faces camera)
    this.addPart(
      this.chest,
      new THREE.TorusGeometry(0.092, 0.018, 8, 18),
      matAccent,
      [0, 0.3, -0.01],
      [Math.PI / 2 + 0.18, 0, 0]
    );
    this.addPart(
      this.chest,
      new THREE.BoxGeometry(0.24, 0.25, 0.11),
      matSecondary,
      [0, 0.15, 0.162]
    );
    this.addPart(
      this.chest,
      new THREE.CylinderGeometry(0.052, 0.052, 0.24, 12),
      matBoot,
      [0, 0.28, 0.175],
      [0, 0, Math.PI / 2]
    );
    this.addPart(
      this.chest,
      new THREE.BoxGeometry(0.08, 0.05, 0.04),
      matAccent,
      [0, 0.16, 0.22]
    );
    for (const sx of [-0.11, 0.11]) {
      this.addPart(
        this.chest,
        new THREE.BoxGeometry(0.042, 0.28, 0.25),
        matBoot,
        [sx, 0.16, 0.02]
      );
    }

    // Articulated 2-segment Flowing Cape (Kael / Solara)
    if (cfg.hasCape) {
      this.hairOrCape.position.set(0, 0.3, 0.175);
      this.addPart(
        this.hairOrCape,
        new THREE.BoxGeometry(0.35, 0.34, 0.026),
        matAccent,
        [0, -0.17, 0.01]
      );
      this.hairOrCapeTip.position.set(0, -0.34, 0.01);
      this.hairOrCape.add(this.hairOrCapeTip);
      this.addPart(
        this.hairOrCapeTip,
        new THREE.BoxGeometry(0.39, 0.36, 0.022),
        matAccent,
        [0, -0.18, 0]
      );
      this.chest.add(this.hairOrCape);
    }

    // 3. Neck & Sculpted Cranium / Face / Hair
    this.neck.position.set(0, 0.33, -0.01);
    this.chest.add(this.neck);

    const neckGeo = createOrganicLimbGeometry(
      [
        [0.066, 0.0],
        [0.056, 0.05],
        [0.058, 0.1],
      ],
      14
    );
    this.addPart(this.neck, neckGeo, matSkin, [0, -0.01, 0]);

    this.head.position.set(0, 0.09, 0);
    this.neck.add(this.head);

    const craniumGeo = createOrganicLimbGeometry(
      [
        [0.001, -0.02],
        [0.078, 0.01],
        [0.124, 0.07],
        [0.142, 0.14],
        [0.135, 0.21],
        [0.095, 0.265],
        [0.001, 0.285],
      ],
      20
    );
    this.addPart(this.head, craniumGeo, matSkin, [0, 0, 0], undefined, [0.96, 1, 1.06]);

    // Sculpted nose bridge, ears, and eyes (-Z faces forward)
    this.addPart(
      this.head,
      new THREE.BoxGeometry(0.028, 0.052, 0.036),
      matSkin,
      [0, 0.115, -0.145],
      [-0.22, 0, 0]
    );
    for (const sx of [-1, 1]) {
      this.addPart(
        this.head,
        new THREE.SphereGeometry(0.024, 8, 8),
        matSkin,
        [sx * 0.134, 0.125, 0.01],
        undefined,
        [0.55, 1.15, 0.8]
      );
      this.addPart(
        this.head,
        new THREE.SphereGeometry(0.015, 8, 8),
        matEye,
        [sx * 0.048, 0.142, -0.132]
      );
    }

    // Hair volume cap
    this.addPart(
      this.head,
      new THREE.SphereGeometry(0.15, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.65),
      matHair,
      [0, 0.155, 0.02],
      [0.24, 0, 0],
      [0.98, 1, 1.05]
    );

    if (cfg.hasHat) {
      // Wide-brim Relic Hunter Fedora
      this.addPart(
        this.head,
        new THREE.CylinderGeometry(0.28, 0.3, 0.028, 20),
        matSecondary,
        [0, 0.25, 0],
        [-0.08, 0, 0]
      );
      this.addPart(
        this.head,
        new THREE.CylinderGeometry(0.118, 0.15, 0.13, 16),
        matSecondary,
        [0, 0.32, 0],
        [-0.08, 0, 0]
      );
      this.addPart(
        this.head,
        new THREE.CylinderGeometry(0.152, 0.155, 0.028, 16),
        matAccent,
        [0, 0.27, 0],
        [-0.08, 0, 0]
      );
    } else if (!cfg.hasCape) {
      // Articulated 2-segment athletic ponytail streaming behind (+Z faces camera)
      this.hairOrCape.position.set(0, 0.175, 0.148);
      const ponyUpperGeo = createOrganicLimbGeometry(
        [
          [0.056, -0.18],
          [0.068, -0.09],
          [0.042, 0.0],
          [0.001, 0.02],
        ],
        12
      );
      this.addPart(this.hairOrCape, ponyUpperGeo, matHair, [0, 0, 0.01]);
      this.addPart(
        this.hairOrCape,
        new THREE.TorusGeometry(0.044, 0.012, 6, 12),
        matAccent,
        [0, -0.01, 0.01],
        [Math.PI / 2, 0, 0]
      );

      this.hairOrCapeTip.position.set(0, -0.17, 0.01);
      this.hairOrCape.add(this.hairOrCapeTip);
      const ponyTipGeo = createOrganicLimbGeometry(
        [
          [0.001, -0.22],
          [0.032, -0.13],
          [0.054, 0.0],
        ],
        12
      );
      this.addPart(this.hairOrCapeTip, ponyTipGeo, matHair, [0, 0, 0]);
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
        [0.06, -0.06],
        [0.052, -0.15],
        [0.044, -0.24],
      ],
      14
    );
    const forearmGeo = createOrganicLimbGeometry(
      [
        [0.045, 0.0],
        [0.049, -0.05],
        [0.038, -0.14],
        [0.031, -0.22],
      ],
      14
    );

    const buildArm = (
      shoulderGroup: THREE.Group,
      elbowGroup: THREE.Group,
      wristGroup: THREE.Group,
      side: -1 | 1
    ) => {
      shoulderGroup.position.set(side * (isFemale ? 0.23 : 0.255), 0.26, 0);
      this.chest.add(shoulderGroup);

      this.addPart(shoulderGroup, new THREE.SphereGeometry(0.068, 12, 10), matPrimary, [0, 0, 0]);
      this.addPart(shoulderGroup, upperArmGeo.clone(), matSkin, [0, -0.02, 0]);

      elbowGroup.position.set(0, -0.25, 0);
      shoulderGroup.add(elbowGroup);

      this.addPart(elbowGroup, new THREE.SphereGeometry(0.043, 10, 10), matSkin, [0, 0, 0]);
      this.addPart(elbowGroup, forearmGeo.clone(), matSkin, [0, 0, 0]);
      this.addPart(
        elbowGroup,
        new THREE.CylinderGeometry(0.042, 0.044, 0.055, 12),
        matAccent,
        [0, -0.16, 0]
      );

      wristGroup.position.set(0, -0.22, 0);
      elbowGroup.add(wristGroup);

      // Fingerless expedition glove + palm + thumb silhouette
      this.addPart(
        wristGroup,
        new THREE.BoxGeometry(0.048, 0.08, 0.066),
        matBoot,
        [0, -0.038, -0.005]
      );
      this.addPart(
        wristGroup,
        new THREE.SphereGeometry(0.026, 8, 8),
        matSkin,
        [0, -0.084, -0.012],
        undefined,
        [0.9, 1.0, 1.15]
      );
      this.addPart(
        wristGroup,
        new THREE.CylinderGeometry(0.011, 0.013, 0.04, 6),
        matSkin,
        [side * -0.026, -0.055, -0.028],
        [0.4, 0, side * 0.45]
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
        [0.085, 0.0],
        [0.083, -0.09],
        [0.072, -0.22],
        [0.058, -0.36],
        [0.054, -0.4],
      ],
      14
    );
    const calfGeo = createOrganicLimbGeometry(
      [
        [0.054, 0.0],
        [0.065, -0.08],
        [0.057, -0.18],
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
    this.squashY = 1.16;
    this.squashXZ = 0.89;
  }

  public triggerLandSquash(): void {
    this.squashY = 0.82;
    this.squashXZ = 1.14;
    this.landKneeFlex = 0.45;
  }

  /**
   * Updates damped biomechanical character animation, returning true on footstep heel strikes.
   */
  public update(dt: number, state: CharacterAnimationState): boolean {
    let stepped = false;

    const dampAlpha = 1 - Math.exp(-16 * dt);
    this.squashY = THREE.MathUtils.lerp(this.squashY, 1, dampAlpha);
    this.squashXZ = THREE.MathUtils.lerp(this.squashXZ, 1, dampAlpha);
    this.landKneeFlex = THREE.MathUtils.lerp(this.landKneeFlex, 0, 1 - Math.exp(-12 * dt));

    // Grounded contact shadow tracks height above floor
    const heightAboveFloor = Math.max(0, state.playerY - state.groundY);
    const shadowScale = Math.max(0.35, 1 - heightAboveFloor * 0.22);
    this.shadowMesh.position.y = -heightAboveFloor + 0.018;
    this.shadowMesh.scale.setScalar(shadowScale);
    (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity =
      0.62 * Math.max(0.15, 1 - heightAboveFloor * 0.28);

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
      const t = Math.min(1, state.deathElapsed * 2.4);
      const ease = 1 - Math.pow(1 - t, 3);
      this.rig.position.y = THREE.MathUtils.lerp(0, -0.45, ease);
      this.rig.rotation.x = THREE.MathUtils.lerp(0, -Math.PI * 0.47, ease);
      this.rig.rotation.z = state.laneBank * 0.35 + Math.sin(t * 6) * 0.12;
      this.spine.rotation.x = -0.35 * ease;
      this.head.rotation.x = 0.45 * ease;
      this.leftShoulder.rotation.set(1.35 * ease, 0, -0.45 * ease);
      this.rightShoulder.rotation.set(1.65 * ease, 0, 0.5 * ease);
      this.leftElbow.rotation.x = 0.4;
      this.rightElbow.rotation.x = 0.7;
      this.leftHip.rotation.x = 0.55 * ease;
      this.rightHip.rotation.x = -0.25 * ease;
      this.leftKnee.rotation.x = -0.75 * ease;
      this.rightKnee.rotation.x = -0.35 * ease;
      return false;
    }

    const strideFreq = 1.48;
    const phase = state.distance * strideFreq;

    let tRigY = 0;
    let tRigPitch = 0;
    let tRigRoll = 0;
    let tPelvisPitch = 0;
    let tPelvisYaw = 0;
    let tPelvisRoll = 0;
    let tSpinePitch = 0;
    let tSpineYaw = 0;
    let tChestYaw = 0;
    let tHeadPitch = 0;
    let tHeadYaw = 0;
    let tHeadRoll = 0;
    let tLeftHip = 0;
    let tRightHip = 0;
    let tLeftKnee = -0.15;
    let tRightKnee = -0.15;
    let tLeftAnkle = 0;
    let tRightAnkle = 0;
    let tLeftShoulder = 0;
    let tRightShoulder = 0;
    let tLeftShoulderZ = -0.15;
    let tRightShoulderZ = 0.15;
    let tLeftShoulderY = 0;
    let tRightShoulderY = 0;
    let tLeftElbow = 1.2;
    let tRightElbow = 1.2;
    let tTrailBase = -0.35;
    let tTrailTip = -0.25;
    let tTrailRoll = 0;

    if (state.isSliding) {
      // Low athletic baseball slide: lead leg extended forward, trail leg tucked cleanly beneath
      tRigY = -0.42;
      tRigPitch = 0.94;
      tRigRoll = state.laneBank * 0.28;
      tPelvisPitch = 0;
      tPelvisYaw = 0.22;
      tPelvisRoll = 0.08;
      tSpinePitch = -0.22;
      tSpineYaw = -0.18;
      tChestYaw = -0.12;
      tHeadPitch = -0.72;
      tHeadYaw = 0.1;

      tLeftHip = 0.42;
      tLeftKnee = -0.16;
      tLeftAnkle = -0.28;

      tRightHip = -0.15;
      tRightKnee = -1.35;
      tRightAnkle = 0.22;

      tLeftShoulder = 0.72;
      tLeftShoulderZ = -0.3;
      tLeftElbow = 0.42;

      tRightShoulder = -0.68;
      tRightShoulderZ = 0.34;
      tRightElbow = 0.55;

      tTrailBase = -0.78;
      tTrailTip = -0.45;
    } else if (state.isJumping) {
      // Dynamic parabolic leap: takeoff knee drive transitioning to landing anticipation
      tRigY = 0;
      tRigPitch = THREE.MathUtils.clamp(state.verticalVel * 0.022, -0.26, 0.26);
      tRigRoll = -state.laneBank * 0.25;

      const rising = state.verticalVel > 0;
      tPelvisYaw = 0.12;
      tSpinePitch = rising ? -0.12 : -0.2;
      tSpineYaw = -0.1;
      tChestYaw = -0.08;
      tHeadPitch = rising ? 0.12 : 0.22;
      tHeadYaw = 0.06;

      // Knees bend BACKWARD (-X rotation) naturally during tuck/recovery
      tLeftHip = rising ? 1.02 : 0.58;
      tLeftKnee = rising ? -1.42 : -0.62;
      tLeftAnkle = rising ? -0.28 : 0.22;

      tRightHip = rising ? -0.56 : -0.18;
      tRightKnee = rising ? -0.62 : -0.85;
      tRightAnkle = -0.22;

      tLeftShoulder = rising ? 1.25 : 0.65;
      tLeftShoulderZ = -0.24;
      tLeftElbow = 1.05;

      tRightShoulder = rising ? -0.65 : -0.25;
      tRightShoulderZ = 0.24;
      tRightElbow = 0.95;

      tTrailBase = rising ? -0.72 : -0.95;
      tTrailTip = rising ? -0.42 : -0.55;
      tTrailRoll = -state.laneBank * 0.18;
    } else {
      // Grounded Human Sprint Biomechanics (sign-verified three.js right-handed axes)
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      const speedNorm = THREE.MathUtils.clamp((state.speed - 8) / 24, 0, 1);

      if ((this.lastFootPhase < 0 && s >= 0) || (this.lastFootPhase > 0 && s <= 0)) {
        stepped = state.speed > 1;
      }
      this.lastFootPhase = s;

      // Double-frequency vertical center-of-mass bounce (lowest at mid-stance, highest at flight)
      tRigY = Math.abs(c) * (0.068 + speedNorm * 0.025) - this.landKneeFlex * 0.15;

      // Forward sprint lean (-X) & lateral bank into lane switch
      tRigPitch = -0.14 - speedNorm * 0.11;
      tRigRoll = -state.laneBank * 0.34;

      // Pelvis list/drop over stance leg & opposite thorax counter-rotation
      tPelvisPitch = 0.04;
      tPelvisYaw = s * 0.17;
      tPelvisRoll = -s * 0.065;
      tSpinePitch = -0.07 - speedNorm * 0.05;
      tSpineYaw = -s * 0.13;
      tChestYaw = -s * 0.12;

      // Stabilized head keeps eyes level on the horizon
      tHeadPitch = 0.16 + speedNorm * 0.08;
      tHeadYaw = s * 0.08;
      tHeadRoll = -state.laneBank * 0.12;

      // Secondary hair / cape flow: negative X trails backward (+Z) in slipstream
      tTrailBase = -0.32 - speedNorm * 0.34 - Math.abs(c) * 0.16;
      tTrailTip = -0.22 - speedNorm * 0.28 + Math.sin(phase * 2.0 - 0.8) * 0.18;
      tTrailRoll = Math.sin(phase) * 0.12 - state.laneBank * 0.24;

      // Asymmetric human hip sweep: +X drives leg forward (-Z), -X pushes off backward (+Z)
      const hipAmp = 0.84 + speedNorm * 0.16;
      tLeftHip = s * hipAmp + this.landKneeFlex * 0.45;
      tRightHip = -s * hipAmp + this.landKneeFlex * 0.45;

      // Human knee bends strictly BACKWARD (-X rotation): deep fold during swing recovery, near-straight on heel strike
      const leftRecovery = Math.max(0, -c) * 0.95 + Math.max(0, -s) * 0.38;
      const rightRecovery = Math.max(0, c) * 0.95 + Math.max(0, s) * 0.38;
      tLeftKnee = -THREE.MathUtils.clamp(0.14 + leftRecovery + this.landKneeFlex * 0.9, 0.1, 1.55);
      tRightKnee = -THREE.MathUtils.clamp(0.14 + rightRecovery + this.landKneeFlex * 0.9, 0.1, 1.55);

      // Ankle dorsiflexion (+X lifts toes) on forward swing/heel strike, plantarflexion (-X) on push-off
      tLeftAnkle = THREE.MathUtils.clamp(s * 0.36 + c * 0.14, -0.45, 0.45);
      tRightAnkle = THREE.MathUtils.clamp(-s * 0.36 - c * 0.14, -0.45, 0.45);

      // Strict opposite arm-leg swing: right shoulder drives forward (+X) as left hip drives forward (+X)
      const armSwing = 0.68 + speedNorm * 0.16;
      const shoulderNeutral = 0.14 + speedNorm * 0.06;
      tRightShoulder = shoulderNeutral + s * armSwing;
      tLeftShoulder = shoulderNeutral - s * armSwing;
      tRightShoulderY = s * 0.14;
      tLeftShoulderY = s * 0.14;
      tRightShoulderZ = 0.15 - s * 0.03;
      tLeftShoulderZ = -0.15 - s * 0.03;

      // Dynamic elbow pump: bends tighter (~85 deg = 1.48 rad) on forward drive, opens slightly on backswing
      tRightElbow = 1.24 + s * 0.24 + speedNorm * 0.08;
      tLeftElbow = 1.24 - s * 0.24 + speedNorm * 0.08;

      if (state.collectTimer > 0) {
        const reach = Math.sin(Math.min(1, state.collectTimer / 0.25) * Math.PI);
        tRightShoulder = THREE.MathUtils.lerp(tRightShoulder, 1.38, reach * 0.65);
        tRightShoulderY = THREE.MathUtils.lerp(tRightShoulderY, 0.12, reach * 0.65);
        tRightElbow = THREE.MathUtils.lerp(tRightElbow, 0.72, reach * 0.65);
      }
    }

    // Smooth exponential joint damping eliminates state-transition snaps
    const jointLambda = state.isSliding ? 32 : state.isJumping ? 24 : 28;
    const bodyLambda = state.isSliding ? 26 : 16;
    const trailLambda = 12;

    this.smoothRigY = THREE.MathUtils.damp(this.smoothRigY, tRigY, bodyLambda, dt);
    this.smoothRigPitch = THREE.MathUtils.damp(this.smoothRigPitch, tRigPitch, bodyLambda, dt);
    this.smoothRigRoll = THREE.MathUtils.damp(this.smoothRigRoll, tRigRoll, bodyLambda, dt);
    this.smoothPelvisPitch = THREE.MathUtils.damp(this.smoothPelvisPitch, tPelvisPitch, jointLambda, dt);
    this.smoothPelvisYaw = THREE.MathUtils.damp(this.smoothPelvisYaw, tPelvisYaw, jointLambda, dt);
    this.smoothPelvisRoll = THREE.MathUtils.damp(this.smoothPelvisRoll, tPelvisRoll, jointLambda, dt);
    this.smoothSpinePitch = THREE.MathUtils.damp(this.smoothSpinePitch, tSpinePitch, jointLambda, dt);
    this.smoothSpineYaw = THREE.MathUtils.damp(this.smoothSpineYaw, tSpineYaw, jointLambda, dt);
    this.smoothChestYaw = THREE.MathUtils.damp(this.smoothChestYaw, tChestYaw, jointLambda, dt);
    this.smoothHeadPitch = THREE.MathUtils.damp(this.smoothHeadPitch, tHeadPitch, jointLambda, dt);

    this.smoothLeftHip = THREE.MathUtils.damp(this.smoothLeftHip, tLeftHip, jointLambda, dt);
    this.smoothRightHip = THREE.MathUtils.damp(this.smoothRightHip, tRightHip, jointLambda, dt);
    this.smoothLeftKnee = THREE.MathUtils.damp(this.smoothLeftKnee, tLeftKnee, jointLambda, dt);
    this.smoothRightKnee = THREE.MathUtils.damp(this.smoothRightKnee, tRightKnee, jointLambda, dt);
    this.smoothLeftAnkle = THREE.MathUtils.damp(this.smoothLeftAnkle, tLeftAnkle, jointLambda, dt);
    this.smoothRightAnkle = THREE.MathUtils.damp(this.smoothRightAnkle, tRightAnkle, jointLambda, dt);

    this.smoothLeftShoulder = THREE.MathUtils.damp(this.smoothLeftShoulder, tLeftShoulder, jointLambda, dt);
    this.smoothRightShoulder = THREE.MathUtils.damp(this.smoothRightShoulder, tRightShoulder, jointLambda, dt);
    this.smoothLeftElbow = THREE.MathUtils.damp(this.smoothLeftElbow, tLeftElbow, jointLambda, dt);
    this.smoothRightElbow = THREE.MathUtils.damp(this.smoothRightElbow, tRightElbow, jointLambda, dt);

    this.smoothTrailBase = THREE.MathUtils.damp(this.smoothTrailBase, tTrailBase, trailLambda, dt);
    this.smoothTrailTip = THREE.MathUtils.damp(this.smoothTrailTip, tTrailTip, trailLambda, dt);

    this.rig.position.y = this.smoothRigY;
    this.rig.rotation.set(this.smoothRigPitch, 0, this.smoothRigRoll);
    this.pelvis.rotation.set(this.smoothPelvisPitch, this.smoothPelvisYaw, this.smoothPelvisRoll);
    this.spine.rotation.set(this.smoothSpinePitch, this.smoothSpineYaw, -this.smoothPelvisRoll * 0.5);
    this.chest.rotation.set(-0.05, this.smoothChestYaw, 0);
    this.neck.rotation.x = 0.05;
    this.head.rotation.set(this.smoothHeadPitch, tHeadYaw, tHeadRoll);

    this.hairOrCape.rotation.set(this.smoothTrailBase, 0, tTrailRoll);
    this.hairOrCapeTip.rotation.set(this.smoothTrailTip, 0, tTrailRoll * 0.6);

    this.leftHip.rotation.set(this.smoothLeftHip, 0, -0.03);
    this.rightHip.rotation.set(this.smoothRightHip, 0, 0.03);
    this.leftKnee.rotation.x = this.smoothLeftKnee;
    this.rightKnee.rotation.x = this.smoothRightKnee;
    this.leftAnkle.rotation.x = this.smoothLeftAnkle;
    this.rightAnkle.rotation.x = this.smoothRightAnkle;

    this.leftShoulder.rotation.set(this.smoothLeftShoulder, tLeftShoulderY, tLeftShoulderZ);
    this.rightShoulder.rotation.set(this.smoothRightShoulder, tRightShoulderY, tRightShoulderZ);
    this.leftElbow.rotation.x = this.smoothLeftElbow;
    this.rightElbow.rotation.x = this.smoothRightElbow;
    this.leftWrist.rotation.x = 0.08;
    this.rightWrist.rotation.x = 0.08;

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

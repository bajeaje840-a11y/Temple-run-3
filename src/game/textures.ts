import * as THREE from 'three';

export interface ProceduralTextureSet {
  stoneAlbedo: THREE.CanvasTexture;
  stoneNormal: THREE.DataTexture;
  stoneRoughness: THREE.CanvasTexture;
  pathAlbedo: THREE.CanvasTexture;
  pathNormal: THREE.DataTexture;
  pathRoughness: THREE.CanvasTexture;
  turfAlbedo: THREE.CanvasTexture;
  turfNormal: THREE.DataTexture;
  barkAlbedo: THREE.CanvasTexture;
  barkNormal: THREE.DataTexture;
  foliageAlbedo: THREE.CanvasTexture;
  torchHaloSprite: THREE.CanvasTexture;
  shadowDisc: THREE.CanvasTexture;
  glowSprite: THREE.CanvasTexture;
  waterTexture: THREE.CanvasTexture;
  waterNormal: THREE.DataTexture;
  lavaTexture: THREE.CanvasTexture;
  dispose: () => void;
}

function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

/**
 * Converts a grayscale height canvas into a tileable tangent-space Normal DataTexture
 * using a wrapping 3x3 Sobel filter (linear color space).
 */
function heightCanvasToNormalMap(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  repeatX: number,
  repeatY: number,
  aniso: number
): THREE.DataTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const ctx = heightCanvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, w, h).data;
  const dst = new Uint8Array(w * h * 4);

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(dst, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));
  const TEX_SIZE = 512;

  // 1. Carved Moss-Edged Temple Stone Flagstones (Albedo + Height -> Normal + Roughness)
  const [stoneCanvas, sCtx] = createCanvas(TEX_SIZE);
  const [stoneHeightCanvas, shCtx] = createCanvas(TEX_SIZE);
  const [stoneRoughCanvas, srCtx] = createCanvas(TEX_SIZE);

  sCtx.fillStyle = '#474337';
  sCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  shCtx.fillStyle = '#1e1e1e';
  shCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  srCtx.fillStyle = '#ededed';
  srCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const rows = 4;
  const cols = 4;
  const tileW = TEX_SIZE / cols;
  const tileH = TEX_SIZE / rows;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (tileW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * tileW + offset + 5;
      const y = r * tileH + 5;
      const w = tileW - 10;
      const h = tileH - 10;

      const shade = 130 + ((r * 23 + c * 41) % 40) - 20;
      const warmTint = ((r + c) % 3) * 6;
      sCtx.fillStyle = `rgb(${shade + 14 + warmTint}, ${shade + 10}, ${shade - 5})`;
      sCtx.fillRect(x, y, w, h);

      // Subtle gradient shading across each carved stone block
      const blockGrad = sCtx.createLinearGradient(x, y, x + w, y + h);
      blockGrad.addColorStop(0, 'rgba(255, 248, 224, 0.14)');
      blockGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
      blockGrad.addColorStop(1, 'rgba(24, 20, 14, 0.18)');
      sCtx.fillStyle = blockGrad;
      sCtx.fillRect(x, y, w, h);

      // Bevel rim highlight + carved Mayan step-fret border groove
      sCtx.strokeStyle = 'rgba(252, 244, 218, 0.3)';
      sCtx.lineWidth = 3;
      sCtx.strokeRect(x + 2, y + 2, w - 4, h - 4);

      sCtx.strokeStyle = 'rgba(38, 34, 24, 0.3)';
      sCtx.lineWidth = 2;
      sCtx.strokeRect(x + 11, y + 11, w - 22, h - 22);

      // Inner corner notches
      sCtx.fillStyle = 'rgba(38, 34, 24, 0.22)';
      sCtx.fillRect(x + 14, y + 14, 10, 10);
      sCtx.fillRect(x + w - 24, y + h - 24, 10, 10);

      // Weathered fracture cracks
      sCtx.strokeStyle = 'rgba(34, 30, 22, 0.44)';
      sCtx.lineWidth = 2;
      sCtx.beginPath();
      sCtx.moveTo(x + w * 0.16, y + h * 0.22);
      sCtx.lineTo(x + w * 0.44, y + h * 0.54);
      sCtx.lineTo(x + w * 0.78, y + h * 0.66);
      sCtx.stroke();

      // Organic moss creeping out of stone mortar seams
      if ((r + c) % 2 === 0) {
        const mossGrad = sCtx.createRadialGradient(x + 8, y + h - 6, 2, x + 8, y + h - 6, 20);
        mossGrad.addColorStop(0, 'rgba(72, 134, 44, 0.65)');
        mossGrad.addColorStop(1, 'rgba(56, 105, 34, 0)');
        sCtx.fillStyle = mossGrad;
        sCtx.beginPath();
        sCtx.arc(x + 8, y + h - 6, 20, 0, Math.PI * 2);
        sCtx.fill();
      }

      // Heightfield bevel + recessed carved groove
      const hGrad = shCtx.createLinearGradient(x, y, x + w, y + h);
      hGrad.addColorStop(0, '#e2e2e2');
      hGrad.addColorStop(1, '#b4b4b4');
      shCtx.fillStyle = hGrad;
      shCtx.fillRect(x, y, w, h);

      shCtx.strokeStyle = '#585858';
      shCtx.lineWidth = 3;
      shCtx.strokeRect(x + 11, y + 11, w - 22, h - 22);
      shCtx.beginPath();
      shCtx.moveTo(x + w * 0.16, y + h * 0.22);
      shCtx.lineTo(x + w * 0.44, y + h * 0.54);
      shCtx.lineTo(x + w * 0.78, y + h * 0.66);
      shCtx.stroke();

      // Polished worn stone centers (lower roughness), rough mortar seams
      srCtx.fillStyle = '#9c9c9c';
      srCtx.fillRect(x + 4, y + 4, w - 8, h - 8);
    }
  }

  for (let i = 0; i < 4200; i++) {
    const gx = (i * 73) % TEX_SIZE;
    const gy = (i * 139) % TEX_SIZE;
    const v = i % 2 === 0 ? 255 : 0;
    sCtx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.06)`;
    sCtx.fillRect(gx, gy, 3, 3);
    shCtx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.11)`;
    shCtx.fillRect(gx, gy, 3, 3);
  }

  const stoneAlbedo = new THREE.CanvasTexture(stoneCanvas);
  stoneAlbedo.colorSpace = THREE.SRGBColorSpace;
  stoneAlbedo.wrapS = stoneAlbedo.wrapT = THREE.RepeatWrapping;
  stoneAlbedo.repeat.set(1.5, 4.5);
  stoneAlbedo.anisotropy = aniso;

  const stoneNormal = heightCanvasToNormalMap(stoneHeightCanvas, 3.6, 1.5, 4.5, aniso);

  const stoneRoughness = new THREE.CanvasTexture(stoneRoughCanvas);
  stoneRoughness.wrapS = stoneRoughness.wrapT = THREE.RepeatWrapping;
  stoneRoughness.repeat.set(1.5, 4.5);
  stoneRoughness.anisotropy = aniso;

  // 2. Dusty Jungle Trail / Ruin Causeway (Albedo + Normal + Roughness)
  const [pathCanvas, pCtx] = createCanvas(TEX_SIZE);
  const [pathHeightCanvas, phCtx] = createCanvas(TEX_SIZE);
  const [pathRoughCanvas, prCtx] = createCanvas(TEX_SIZE);

  const grad = pCtx.createLinearGradient(0, 0, TEX_SIZE, 0);
  grad.addColorStop(0, '#455f2c');
  grad.addColorStop(0.11, '#7c6e52');
  grad.addColorStop(0.5, '#b6a582');
  grad.addColorStop(0.89, '#7c6e52');
  grad.addColorStop(1, '#455f2c');
  pCtx.fillStyle = grad;
  pCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  phCtx.fillStyle = '#909090';
  phCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  prCtx.fillStyle = '#cfcfcf';
  prCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Embedded worn cobble lanes + mossy borders
  for (const laneX of [146, 256, 366]) {
    pCtx.fillStyle = 'rgba(238, 224, 188, 0.18)';
    pCtx.fillRect(laneX - 7, 0, 14, TEX_SIZE);
    phCtx.fillStyle = '#767676';
    phCtx.fillRect(laneX - 7, 0, 14, TEX_SIZE);
    prCtx.fillStyle = '#969696';
    prCtx.fillRect(laneX - 7, 0, 14, TEX_SIZE);
  }

  // Scattered small sunken flagstones along trail
  for (let i = 0; i < 64; i++) {
    const sx = 76 + ((i * 89) % 352);
    const sy = (i * 137) % TEX_SIZE;
    const sw = 22 + (i % 20);
    const sh = 14 + (i % 16);
    pCtx.fillStyle = i % 2 === 0 ? 'rgba(132, 124, 104, 0.42)' : 'rgba(110, 102, 84, 0.36)';
    pCtx.fillRect(sx, sy, sw, sh);
    pCtx.strokeStyle = 'rgba(48, 42, 30, 0.3)';
    pCtx.lineWidth = 1.5;
    pCtx.strokeRect(sx, sy, sw, sh);
    phCtx.fillStyle = '#c4c4c4';
    phCtx.fillRect(sx, sy, sw, sh);
    prCtx.fillStyle = '#a2a2a2';
    prCtx.fillRect(sx, sy, sw, sh);
  }

  for (let i = 0; i < 4800; i++) {
    const px = (i * 97) % TEX_SIZE;
    const py = (i * 193) % TEX_SIZE;
    const rad = 1 + (i % 4);
    pCtx.fillStyle =
      i % 3 === 0 ? 'rgba(54, 48, 34, 0.18)' : 'rgba(234, 220, 188, 0.15)';
    pCtx.fillRect(px, py, rad, rad);
    phCtx.fillStyle = i % 2 === 0 ? 'rgba(220,220,220,0.24)' : 'rgba(42,42,42,0.24)';
    phCtx.fillRect(px, py, rad, rad);
  }

  const pathAlbedo = new THREE.CanvasTexture(pathCanvas);
  pathAlbedo.colorSpace = THREE.SRGBColorSpace;
  pathAlbedo.wrapS = pathAlbedo.wrapT = THREE.RepeatWrapping;
  pathAlbedo.repeat.set(1, 3.5);
  pathAlbedo.anisotropy = aniso;

  const pathNormal = heightCanvasToNormalMap(pathHeightCanvas, 2.7, 1, 3.5, aniso);

  const pathRoughness = new THREE.CanvasTexture(pathRoughCanvas);
  pathRoughness.wrapS = pathRoughness.wrapT = THREE.RepeatWrapping;
  pathRoughness.repeat.set(1, 3.5);
  pathRoughness.anisotropy = aniso;

  // 2b. Furrowed Tropical Tree Bark Albedo + Normal Map
  const [barkCanvas, bCtx] = createCanvas(256);
  const [barkHeightCanvas, bhCtx] = createCanvas(256);
  bCtx.fillStyle = '#6d5036';
  bCtx.fillRect(0, 0, 256, 256);
  bhCtx.fillStyle = '#707070';
  bhCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 90; i++) {
    const bx = (i * 29) % 256;
    const bw = 4 + (i % 7);
    const by = (i * 43) % 256;
    const bh = 48 + (i % 90);
    bCtx.fillStyle = i % 2 === 0 ? 'rgba(42, 28, 16, 0.52)' : 'rgba(138, 106, 74, 0.45)';
    bCtx.fillRect(bx, by, bw, bh);
    bCtx.fillRect(bx, by - 256, bw, bh);

    bhCtx.fillStyle = i % 2 === 0 ? '#323232' : '#c8c8c8';
    bhCtx.fillRect(bx, by, bw, bh);
    bhCtx.fillRect(bx, by - 256, bw, bh);
  }
  // Subtle horizontal palm trunk ring scars & lichen
  for (let y = 16; y < 256; y += 28) {
    bCtx.fillStyle = 'rgba(34, 24, 15, 0.35)';
    bCtx.fillRect(0, y, 256, 4);
    bhCtx.fillStyle = '#424242';
    bhCtx.fillRect(0, y, 256, 4);
  }
  for (let i = 0; i < 16; i++) {
    const mx = (i * 67) % 256;
    const my = (i * 89) % 256;
    bCtx.fillStyle = 'rgba(84, 144, 52, 0.36)';
    bCtx.beginPath();
    bCtx.arc(mx, my, 10 + (i % 8), 0, Math.PI * 2);
    bCtx.fill();
  }

  const barkAlbedo = new THREE.CanvasTexture(barkCanvas);
  barkAlbedo.colorSpace = THREE.SRGBColorSpace;
  barkAlbedo.wrapS = barkAlbedo.wrapT = THREE.RepeatWrapping;
  barkAlbedo.repeat.set(1, 3);
  barkAlbedo.anisotropy = aniso;

  const barkNormal = heightCanvasToNormalMap(barkHeightCanvas, 3.0, 1, 3, aniso);

  // 2b2. Organic Mossy Jungle Turf Albedo + Normal Map (no geometric tile seams)
  const [turfCanvas, tAlbedoCtx] = createCanvas(256);
  const [turfHeightCanvas, thCtx] = createCanvas(256);
  tAlbedoCtx.fillStyle = '#759164';
  tAlbedoCtx.fillRect(0, 0, 256, 256);
  thCtx.fillStyle = '#808080';
  thCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 64; i++) {
    const tx = (i * 53) % 256;
    const ty = (i * 97) % 256;
    const rad = 18 + (i % 24);
    const tg = tAlbedoCtx.createRadialGradient(tx, ty, 2, tx, ty, rad);
    tg.addColorStop(
      0,
      i % 3 === 0 ? 'rgba(54, 88, 36, 0.45)' : i % 3 === 1 ? 'rgba(136, 166, 94, 0.38)' : 'rgba(92, 76, 48, 0.34)'
    );
    tg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    tAlbedoCtx.fillStyle = tg;
    tAlbedoCtx.beginPath();
    tAlbedoCtx.arc(tx, ty, rad, 0, Math.PI * 2);
    tAlbedoCtx.fill();

    thCtx.fillStyle = i % 2 === 0 ? 'rgba(195, 195, 195, 0.25)' : 'rgba(55, 55, 55, 0.25)';
    thCtx.beginPath();
    thCtx.arc(tx, ty, rad * 0.7, 0, Math.PI * 2);
    thCtx.fill();
  }
  // Fine organic grass blades / pebble speckle
  for (let i = 0; i < 1600; i++) {
    const gx = (i * 79) % 256;
    const gy = (i * 151) % 256;
    tAlbedoCtx.fillStyle = i % 2 === 0 ? 'rgba(42, 68, 28, 0.22)' : 'rgba(176, 204, 128, 0.18)';
    tAlbedoCtx.fillRect(gx, gy, 2, 4);
    thCtx.fillStyle = i % 2 === 0 ? 'rgba(220, 220, 220, 0.2)' : 'rgba(45, 45, 45, 0.2)';
    thCtx.fillRect(gx, gy, 2, 4);
  }
  const turfAlbedo = new THREE.CanvasTexture(turfCanvas);
  turfAlbedo.colorSpace = THREE.SRGBColorSpace;
  turfAlbedo.wrapS = turfAlbedo.wrapT = THREE.RepeatWrapping;
  turfAlbedo.repeat.set(2, 6);
  turfAlbedo.anisotropy = aniso;

  const turfNormal = heightCanvasToNormalMap(turfHeightCanvas, 1.8, 2, 6, aniso);

  // 2c. Feathered Tropical Palm / Fern Frond Texture with Alpha Cutout
  const [leafCanvas, lCtx] = createCanvas(256);
  lCtx.clearRect(0, 0, 256, 256);

  // Draw central woody midrib stem
  const stemGrad = lCtx.createLinearGradient(0, 256, 0, 0);
  stemGrad.addColorStop(0, '#5a8e2e');
  stemGrad.addColorStop(1, '#92c94b');
  lCtx.fillStyle = stemGrad;
  lCtx.beginPath();
  lCtx.moveTo(123, 256);
  lCtx.lineTo(133, 256);
  lCtx.lineTo(129, 8);
  lCtx.lineTo(127, 8);
  lCtx.closePath();
  lCtx.fill();

  // Draw pairs of tapered pinnate leaflets along the frond spine
  const leafletPairs = 16;
  for (let i = 0; i < leafletPairs; i++) {
    const t = i / (leafletPairs - 1);
    const baseY = 244 - t * 224;
    const span = Math.sin(t * Math.PI * 0.9 + 0.18) * 116;
    const tipY = baseY - 26 - (1 - t) * 18;
    const leafW = 10 - t * 4;

    for (const side of [-1, 1]) {
      const lGrad = lCtx.createLinearGradient(128, baseY, 128 + side * span, tipY);
      lGrad.addColorStop(0, i % 2 === 0 ? '#2f6d24' : '#3a7d2b');
      lGrad.addColorStop(0.65, '#4f9c37');
      lGrad.addColorStop(1, '#79bf44');
      lCtx.fillStyle = lGrad;

      lCtx.beginPath();
      lCtx.moveTo(128, baseY + leafW * 0.45);
      lCtx.quadraticCurveTo(
        128 + side * span * 0.55,
        baseY - 12,
        128 + side * span,
        tipY
      );
      lCtx.quadraticCurveTo(
        128 + side * span * 0.45,
        baseY - leafW * 0.9,
        128,
        baseY - leafW * 0.6
      );
      lCtx.closePath();
      lCtx.fill();
    }
  }

  const foliageAlbedo = new THREE.CanvasTexture(leafCanvas);
  foliageAlbedo.colorSpace = THREE.SRGBColorSpace;
  foliageAlbedo.anisotropy = aniso;

  // 3. Soft Radial Contact Shadow Disc
  const [shadowCanvas, shadowCtx] = createCanvas(128);
  const shGrad = shadowCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  shGrad.addColorStop(0, 'rgba(0, 0, 0, 0.76)');
  shGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.34)');
  shGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  shadowCtx.fillStyle = shGrad;
  shadowCtx.fillRect(0, 0, 128, 128);
  const shadowDisc = new THREE.CanvasTexture(shadowCanvas);

  // 3b. Soft Radial Glow Sprite for Ambient Pollen & Firefly Motes
  const [glowCanvas, glowCtx] = createCanvas(64);
  const gGrad = glowCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gGrad.addColorStop(0.35, 'rgba(255, 245, 200, 0.72)');
  gGrad.addColorStop(1, 'rgba(255, 230, 150, 0)');
  glowCtx.fillStyle = gGrad;
  glowCtx.fillRect(0, 0, 64, 64);
  const glowSprite = new THREE.CanvasTexture(glowCanvas);
  glowSprite.colorSpace = THREE.SRGBColorSpace;

  // 3c. Warm Torch / Brazier Additive Halo Sprite
  const [torchCanvas, tCtx] = createCanvas(64);
  const thGrad = tCtx.createRadialGradient(32, 32, 2, 32, 32, 31);
  thGrad.addColorStop(0, 'rgba(255, 245, 190, 0.95)');
  thGrad.addColorStop(0.3, 'rgba(255, 150, 42, 0.58)');
  thGrad.addColorStop(0.7, 'rgba(255, 78, 12, 0.18)');
  thGrad.addColorStop(1, 'rgba(255, 60, 0, 0)');
  tCtx.fillStyle = thGrad;
  tCtx.fillRect(0, 0, 64, 64);
  const torchHaloSprite = new THREE.CanvasTexture(torchCanvas);
  torchHaloSprite.colorSpace = THREE.SRGBColorSpace;

  // 4. Shimmering Turquoise River Water Albedo + Normal Map
  const [waterCanvas, wCtx] = createCanvas(256);
  const [waterHeightCanvas, whCtx] = createCanvas(256);
  wCtx.fillStyle = '#1592ad';
  wCtx.fillRect(0, 0, 256, 256);
  whCtx.fillStyle = '#808080';
  whCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 95; i++) {
    const wx = (i * 53) % 256;
    const wy = (i * 37) % 256;
    wCtx.fillStyle = i % 3 === 0 ? 'rgba(185, 250, 255, 0.3)' : 'rgba(14, 114, 144, 0.32)';
    wCtx.beginPath();
    wCtx.ellipse(wx, wy, 28, 7, 0.2, 0, Math.PI * 2);
    wCtx.fill();

    whCtx.fillStyle = i % 2 === 0 ? 'rgba(235,235,235,0.48)' : 'rgba(38,38,38,0.48)';
    whCtx.beginPath();
    whCtx.ellipse(wx, wy, 24, 6, 0.2, 0, Math.PI * 2);
    whCtx.fill();
  }
  const waterTexture = new THREE.CanvasTexture(waterCanvas);
  waterTexture.colorSpace = THREE.SRGBColorSpace;
  waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
  waterTexture.repeat.set(8, 16);

  const waterNormal = heightCanvasToNormalMap(waterHeightCanvas, 2.4, 8, 16, aniso);

  // 5. Molten Lava Texture
  const [lavaCanvas, lvCtx] = createCanvas(256);
  lvCtx.fillStyle = '#330b03';
  lvCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 55; i++) {
    const lx = (i * 61) % 256;
    const ly = (i * 43) % 256;
    const lg = lvCtx.createRadialGradient(lx, ly, 4, lx, ly, 38);
    lg.addColorStop(0, '#ffe875');
    lg.addColorStop(0.45, '#ff5900');
    lg.addColorStop(1, 'rgba(90, 15, 0, 0)');
    lvCtx.fillStyle = lg;
    lvCtx.beginPath();
    lvCtx.arc(lx, ly, 38, 0, Math.PI * 2);
    lvCtx.fill();
  }
  const lavaTexture = new THREE.CanvasTexture(lavaCanvas);
  lavaTexture.colorSpace = THREE.SRGBColorSpace;
  lavaTexture.wrapS = lavaTexture.wrapT = THREE.RepeatWrapping;
  lavaTexture.repeat.set(6, 12);

  return {
    stoneAlbedo,
    stoneNormal,
    stoneRoughness,
    pathAlbedo,
    pathNormal,
    pathRoughness,
    turfAlbedo,
    turfNormal,
    barkAlbedo,
    barkNormal,
    foliageAlbedo,
    torchHaloSprite,
    shadowDisc,
    glowSprite,
    waterTexture,
    waterNormal,
    lavaTexture,
    dispose: () => {
      stoneAlbedo.dispose();
      stoneNormal.dispose();
      stoneRoughness.dispose();
      pathAlbedo.dispose();
      pathNormal.dispose();
      pathRoughness.dispose();
      turfAlbedo.dispose();
      turfNormal.dispose();
      barkAlbedo.dispose();
      barkNormal.dispose();
      foliageAlbedo.dispose();
      torchHaloSprite.dispose();
      shadowDisc.dispose();
      glowSprite.dispose();
      waterTexture.dispose();
      waterNormal.dispose();
      lavaTexture.dispose();
    },
  };
}

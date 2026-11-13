import * as THREE from 'three';

export interface ProceduralTextureSet {
  stoneAlbedo: THREE.CanvasTexture;
  stoneNormal: THREE.DataTexture;
  stoneRoughness: THREE.CanvasTexture;
  pathAlbedo: THREE.CanvasTexture;
  pathNormal: THREE.DataTexture;
  pathRoughness: THREE.CanvasTexture;
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

  sCtx.fillStyle = '#5c584a';
  sCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  shCtx.fillStyle = '#252525';
  shCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  srCtx.fillStyle = '#e8e8e8';
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

      const shade = 132 + ((r * 19 + c * 37) % 36) - 18;
      sCtx.fillStyle = `rgb(${shade + 14}, ${shade + 10}, ${shade - 4})`;
      sCtx.fillRect(x, y, w, h);

      // Subtle bevel rim highlight + recessed mortar edge
      sCtx.strokeStyle = 'rgba(248, 240, 214, 0.28)';
      sCtx.lineWidth = 3;
      sCtx.strokeRect(x + 2, y + 2, w - 4, h - 4);

      // Carved inner Mayan border groove
      sCtx.strokeStyle = 'rgba(42, 38, 28, 0.25)';
      sCtx.lineWidth = 2;
      sCtx.strokeRect(x + 12, y + 12, w - 24, h - 24);

      // Weathered fracture cracks
      sCtx.strokeStyle = 'rgba(38, 34, 26, 0.4)';
      sCtx.lineWidth = 2;
      sCtx.beginPath();
      sCtx.moveTo(x + w * 0.18, y + h * 0.2);
      sCtx.lineTo(x + w * 0.44, y + h * 0.52);
      sCtx.lineTo(x + w * 0.74, y + h * 0.68);
      sCtx.stroke();

      // Organic moss creeping out of stone mortar seams
      if ((r + c) % 2 === 0) {
        sCtx.fillStyle = 'rgba(72, 128, 46, 0.48)';
        sCtx.beginPath();
        sCtx.arc(x + 6, y + h - 4, 16, 0, Math.PI * 2);
        sCtx.fill();
      }

      // Heightfield bevel + recessed carved groove
      const hGrad = shCtx.createLinearGradient(x, y, x + w, y + h);
      hGrad.addColorStop(0, '#dcdcdc');
      hGrad.addColorStop(1, '#b6b6b6');
      shCtx.fillStyle = hGrad;
      shCtx.fillRect(x, y, w, h);

      shCtx.strokeStyle = '#606060';
      shCtx.lineWidth = 3;
      shCtx.strokeRect(x + 12, y + 12, w - 24, h - 24);
      shCtx.beginPath();
      shCtx.moveTo(x + w * 0.18, y + h * 0.2);
      shCtx.lineTo(x + w * 0.44, y + h * 0.52);
      shCtx.lineTo(x + w * 0.74, y + h * 0.68);
      shCtx.stroke();

      // Polished worn stone centers (lower roughness), rough mortar seams
      srCtx.fillStyle = '#a4a4a4';
      srCtx.fillRect(x + 4, y + 4, w - 8, h - 8);
    }
  }

  for (let i = 0; i < 3600; i++) {
    const gx = (i * 73) % TEX_SIZE;
    const gy = (i * 139) % TEX_SIZE;
    const v = i % 2 === 0 ? 255 : 0;
    sCtx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.055)`;
    sCtx.fillRect(gx, gy, 3, 3);
    shCtx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.1)`;
    shCtx.fillRect(gx, gy, 3, 3);
  }

  const stoneAlbedo = new THREE.CanvasTexture(stoneCanvas);
  stoneAlbedo.colorSpace = THREE.SRGBColorSpace;
  stoneAlbedo.wrapS = stoneAlbedo.wrapT = THREE.RepeatWrapping;
  stoneAlbedo.repeat.set(1.5, 4.5);
  stoneAlbedo.anisotropy = aniso;

  const stoneNormal = heightCanvasToNormalMap(stoneHeightCanvas, 3.2, 1.5, 4.5, aniso);

  const stoneRoughness = new THREE.CanvasTexture(stoneRoughCanvas);
  stoneRoughness.wrapS = stoneRoughness.wrapT = THREE.RepeatWrapping;
  stoneRoughness.repeat.set(1.5, 4.5);
  stoneRoughness.anisotropy = aniso;

  // 2. Dusty Jungle Trail / Ruin Causeway (Albedo + Normal + Roughness)
  const [pathCanvas, pCtx] = createCanvas(TEX_SIZE);
  const [pathHeightCanvas, phCtx] = createCanvas(TEX_SIZE);
  const [pathRoughCanvas, prCtx] = createCanvas(TEX_SIZE);

  const grad = pCtx.createLinearGradient(0, 0, TEX_SIZE, 0);
  grad.addColorStop(0, '#4f6435');
  grad.addColorStop(0.11, '#84775c');
  grad.addColorStop(0.5, '#b0a07f');
  grad.addColorStop(0.89, '#84775c');
  grad.addColorStop(1, '#4f6435');
  pCtx.fillStyle = grad;
  pCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  phCtx.fillStyle = '#909090';
  phCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  prCtx.fillStyle = '#cfcfcf';
  prCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Embedded worn cobble patches & runner lane grooves
  for (const laneX of [146, 256, 366]) {
    pCtx.fillStyle = 'rgba(235, 222, 186, 0.16)';
    pCtx.fillRect(laneX - 5, 0, 10, TEX_SIZE);
    phCtx.fillStyle = '#787878';
    phCtx.fillRect(laneX - 5, 0, 10, TEX_SIZE);
    prCtx.fillStyle = '#9e9e9e';
    prCtx.fillRect(laneX - 5, 0, 10, TEX_SIZE);
  }

  for (let i = 0; i < 4200; i++) {
    const px = (i * 97) % TEX_SIZE;
    const py = (i * 193) % TEX_SIZE;
    const rad = 1 + (i % 4);
    pCtx.fillStyle =
      i % 3 === 0 ? 'rgba(58, 52, 38, 0.16)' : 'rgba(230, 216, 184, 0.14)';
    pCtx.fillRect(px, py, rad, rad);
    phCtx.fillStyle = i % 2 === 0 ? 'rgba(215,215,215,0.24)' : 'rgba(45,45,45,0.24)';
    phCtx.fillRect(px, py, rad, rad);
  }

  // Scattered small sunken flagstones along center trail
  for (let i = 0; i < 48; i++) {
    const sx = 86 + ((i * 89) % 340);
    const sy = (i * 137) % TEX_SIZE;
    const sw = 24 + (i % 18);
    const sh = 16 + (i % 14);
    pCtx.fillStyle = 'rgba(135, 128, 108, 0.35)';
    pCtx.fillRect(sx, sy, sw, sh);
    phCtx.fillStyle = '#bdbdbd';
    phCtx.fillRect(sx, sy, sw, sh);
  }

  const pathAlbedo = new THREE.CanvasTexture(pathCanvas);
  pathAlbedo.colorSpace = THREE.SRGBColorSpace;
  pathAlbedo.wrapS = pathAlbedo.wrapT = THREE.RepeatWrapping;
  pathAlbedo.repeat.set(1, 3.5);
  pathAlbedo.anisotropy = aniso;

  const pathNormal = heightCanvasToNormalMap(pathHeightCanvas, 2.4, 1, 3.5, aniso);

  const pathRoughness = new THREE.CanvasTexture(pathRoughCanvas);
  pathRoughness.wrapS = pathRoughness.wrapT = THREE.RepeatWrapping;
  pathRoughness.repeat.set(1, 3.5);
  pathRoughness.anisotropy = aniso;

  // 3. Soft Radial Contact Shadow Disc
  const [shadowCanvas, shadowCtx] = createCanvas(128);
  const shGrad = shadowCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  shGrad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  shGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.3)');
  shGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  shadowCtx.fillStyle = shGrad;
  shadowCtx.fillRect(0, 0, 128, 128);
  const shadowDisc = new THREE.CanvasTexture(shadowCanvas);

  // 3b. Soft Radial Glow Sprite for Ambient Pollen & Firefly Motes
  const [glowCanvas, glowCtx] = createCanvas(64);
  const gGrad = glowCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gGrad.addColorStop(0.35, 'rgba(255, 245, 200, 0.7)');
  gGrad.addColorStop(1, 'rgba(255, 230, 150, 0)');
  glowCtx.fillStyle = gGrad;
  glowCtx.fillRect(0, 0, 64, 64);
  const glowSprite = new THREE.CanvasTexture(glowCanvas);
  glowSprite.colorSpace = THREE.SRGBColorSpace;

  // 4. Shimmering Turquoise River Water Albedo + Normal Map
  const [waterCanvas, wCtx] = createCanvas(256);
  const [waterHeightCanvas, whCtx] = createCanvas(256);
  wCtx.fillStyle = '#1592ad';
  wCtx.fillRect(0, 0, 256, 256);
  whCtx.fillStyle = '#808080';
  whCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 85; i++) {
    const wx = (i * 53) % 256;
    const wy = (i * 37) % 256;
    wCtx.fillStyle = i % 3 === 0 ? 'rgba(180, 248, 255, 0.28)' : 'rgba(16, 118, 146, 0.3)';
    wCtx.beginPath();
    wCtx.ellipse(wx, wy, 28, 7, 0.2, 0, Math.PI * 2);
    wCtx.fill();

    whCtx.fillStyle = i % 2 === 0 ? 'rgba(235,235,235,0.45)' : 'rgba(40,40,40,0.45)';
    whCtx.beginPath();
    whCtx.ellipse(wx, wy, 24, 6, 0.2, 0, Math.PI * 2);
    whCtx.fill();
  }
  const waterTexture = new THREE.CanvasTexture(waterCanvas);
  waterTexture.colorSpace = THREE.SRGBColorSpace;
  waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
  waterTexture.repeat.set(8, 16);

  const waterNormal = heightCanvasToNormalMap(waterHeightCanvas, 2.2, 8, 16, aniso);

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
      shadowDisc.dispose();
      glowSprite.dispose();
      waterTexture.dispose();
      waterNormal.dispose();
      lavaTexture.dispose();
    },
  };
}

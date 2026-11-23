import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.resolve(process.cwd(), 'public/icons');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter none
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // rounded corner radius
  const cx = size / 2;
  const cy = size / 2;
  const half = size / 2 - 0.5;

  // Two circles motif: top-left hollow circle (Carregado), bottom-right solid white circle (Disparado) + connector
  const c1x = size * 0.34;
  const c1y = size * 0.34;
  const c1r = size * 0.14;
  const c1Stroke = Math.max(1.2, size * 0.055);

  const c2x = size * 0.65;
  const c2y = size * 0.65;
  const c2r = size * 0.16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      // Signed distance to rounded rect
      const dx = Math.abs(px - cx) - (half - r);
      const dy = Math.abs(py - cy) - (half - r);
      const qx = Math.max(dx, 0);
      const qy = Math.max(dy, 0);
      const sdf = Math.hypot(qx, qy) + Math.min(Math.max(dx, dy), 0) - r;
      const bgAlpha = clamp(0.5 - sdf);

      if (bgAlpha <= 0) continue;

      // Subtle blue gradient (#2563EB -> #1D4ED8)
      const t = py / size;
      let R = Math.round(37 * (1 - t) + 29 * t);
      let G = Math.round(99 * (1 - t) + 78 * t);
      let B = Math.round(235 * (1 - t) + 216 * t);

      // Connector line between c1 and c2 (L-shaped vertical + horizontal)
      let fgAlpha = 0;
      const lineW = Math.max(1, size * 0.045);
      const onVert =
        Math.abs(px - c1x) <= lineW / 2 && py >= c1y + c1r && py <= c2y;
      const onHoriz =
        Math.abs(py - c2y) <= lineW / 2 && px >= c1x && px <= c2x - c2r;
      if (onVert || onHoriz) {
        fgAlpha = Math.max(fgAlpha, 0.55);
      }

      // Hollow ring at (c1x, c1y)
      const d1 = Math.hypot(px - c1x, py - c1y);
      const ringDist = Math.abs(d1 - c1r) - c1Stroke / 2;
      const ringAlpha = clamp(0.5 - ringDist) * 0.9;
      fgAlpha = Math.max(fgAlpha, ringAlpha);

      // Solid dot at (c2x, c2y)
      const d2 = Math.hypot(px - c2x, py - c2y) - c2r;
      const dotAlpha = clamp(0.5 - d2);
      fgAlpha = Math.max(fgAlpha, dotAlpha);

      // Blend white foreground onto blue background
      R = Math.round(R * (1 - fgAlpha) + 255 * fgAlpha);
      G = Math.round(G * (1 - fgAlpha) + 255 * fgAlpha);
      B = Math.round(B * (1 - fgAlpha) + 255 * fgAlpha);

      const idx = (y * size + x) * 4;
      rgba[idx] = R;
      rgba[idx + 1] = G;
      rgba[idx + 2] = B;
      rgba[idx + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

export function generateIcons() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const png = renderIcon(size);
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    // Keep the designed icons in public/icons; only draw a placeholder when one is missing.
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, png);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateIcons();
  console.log(`Generated PNG icons (${SIZES.join(', ')}) in public/icons/`);
}

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'textures', 'street');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
const png = (w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const hash = (x, y) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const noise = (x, y) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const fbm = (x, y) => noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;

const fill = (w, h, sample) => {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = sample(x, y, w, h);
      const i = (y * w + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
};
const clamp = (n) => Math.max(0, Math.min(255, n | 0));

const asphalt = (x, y, w, h) => {
  const n = fbm(x / 28, y / 28);
  const crack = Math.abs(Math.sin((x + noise(y / 9, 2) * 18) * 0.17)) < 0.035 ? -28 : 0;
  const grit = (hash(x, y) - 0.5) * 16;
  const v = 38 + n * 22 + crack + grit;
  return [clamp(v), clamp(v), clamp(v + 2)];
};
const sidewalk = (x, y, w, h) => {
  const seam = (x % 128 < 3) || (y % 128 < 3) ? -26 : 0;
  const n = fbm(x / 40, y / 40);
  const grit = (hash(x, y) - 0.5) * 12;
  const v = 168 + n * 18 + seam + grit;
  return [clamp(v), clamp(v - 1), clamp(v - 4)];
};
const facade = (x, y, w, h) => {
  const course = y % 46 < 2 ? -18 : 0;
  const joint = x % 92 < 2 && (Math.floor(y / 46) % 2 === 0 ? x % 92 < 2 : (x + 46) % 92 < 2) ? -14 : 0;
  const n = fbm(x / 36, y / 36);
  const v = 112 + n * 26 + course + joint + (hash(x, y) - 0.5) * 8;
  return [clamp(v + 6), clamp(v + 2), clamp(v - 4)];
};
const wood = (x, y, w, h) => {
  const plank = y % 36 < 2 ? -30 : 0;
  const grain = Math.sin(x * 0.35 + noise(0, y / 8) * 6) * 8;
  const n = fbm(x / 22, y / 48);
  const v = 92 + n * 28 + plank + grain;
  return [clamp(v + 28), clamp(v + 8), clamp(v - 18)];
};
const paint = (x, y) => {
  const n = fbm(x / 18, y / 18);
  const v = 210 + n * 24 + (hash(x, y) - 0.5) * 10;
  return [clamp(v), clamp(v), clamp(v)];
};
const windowPane = (x, y, w, h) => {
  const col = x / (w / 2);
  const row = y / (h / 3);
  const marginX = (col % 1) < 0.08 || (col % 1) > 0.92;
  const marginY = (row % 1) < 0.1 || (row % 1) > 0.9;
  if (marginX || marginY || x < 4 || y < 4 || x > w - 5 || y > h - 5) return [8, 8, 10];
  const glow = 200 + fbm(x / 30, y / 30) * 40;
  const warm = hash(Math.floor(col), Math.floor(row));
  return [clamp(glow), clamp(glow * (0.62 + warm * 0.12)), clamp(glow * 0.28)];
};

mkdirSync(outDir, { recursive: true });
const size = 256;
const write = (name, sample) => {
  writeFileSync(join(outDir, name), png(size, size, fill(size, size, sample)));
};
write('asphalt.png', asphalt);
write('sidewalk.png', sidewalk);
write('facade.png', facade);
write('wood.png', wood);
write('paint.png', paint);
write('window.png', windowPane);
console.log(outDir);

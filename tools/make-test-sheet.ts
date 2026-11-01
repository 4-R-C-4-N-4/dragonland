// Generates a tiny test sprite sheet (16x16, 5 frames) for one unit, with a minimal PNG encoder
// using node:zlib (no new deps). Used to prove the art-pass swap-in (implementation.md §10,
// milestone 6) without real art. Output goes to assets/sprites-test/<unitId>.png + .json.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FRAME = 16;
const FRAMES = 5; // idle, walk, attack, hit, death (1 frame each, simplest possible sheet)
const W = FRAME * FRAMES;
const H = FRAME;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const COLORS: [number, number, number][] = [
  [90, 160, 90], // idle green
  [90, 90, 200], // walk blue
  [220, 90, 90], // attack red
  [240, 220, 90], // hit yellow
  [80, 80, 80], // death gray
];

function buildPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(W, 0);
  ihdrData.writeUInt32BE(H, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    const rowStart = y * (W * 4 + 1);
    raw[rowStart] = 0; // no filter
    for (let x = 0; x < W; x++) {
      const frameIdx = Math.floor(x / FRAME);
      const [r, g, b] = COLORS[frameIdx]!;
      const cx = x % FRAME;
      const inCircle = (cx - FRAME / 2) ** 2 + (y - FRAME / 2) ** 2 < (FRAME / 2 - 1) ** 2;
      const off = rowStart + 1 + x * 4;
      raw[off] = inCircle ? r : 0;
      raw[off + 1] = inCircle ? g : 0;
      raw[off + 2] = inCircle ? b : 0;
      raw[off + 3] = inCircle ? 255 : 0;
    }
  }
  const idat = chunk('IDAT', deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function buildJson(unitId: string): string {
  const names = ['idle', 'walk', 'attack', 'hit', 'death'];
  const frames = names.map((name, i) => ({
    filename: `${unitId}_${name}.png`,
    frame: { x: i * FRAME, y: 0, w: FRAME, h: FRAME },
    duration: 100,
  }));
  const frameTags = names.map((name, i) => ({ name, from: i, to: i }));
  return JSON.stringify({ frames, meta: { frameTags } }, null, 2);
}

function main(): void {
  const unitId = process.argv[2] ?? 'dog';
  const outDirArg = process.argv[3] ?? 'assets/sprites-test';
  const outDir = join(process.cwd(), outDirArg);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${unitId}.png`), buildPng());
  writeFileSync(join(outDir, `${unitId}.json`), buildJson(unitId));
  console.log(`wrote ${outDir}/${unitId}.png + .json`);
}

main();

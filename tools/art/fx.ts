// FX pipeline: art/fx/<fx>.yaml -> art/raw/fx/<fx>/<hash>-n.png -> assets/fx/<fx>.png + .json.
// Self-contained sibling to the unit pipeline in cli.ts/config.ts/process.ts: fx sheets are a
// single horizontal strip on magenta (no team cloth, no outline), so they get their own slicer
// instead of reusing the 5-row unit grid in process.ts. See docs/art-pipeline.md.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import {
  FX_OUT, FX_RAW, ROOT, buildFxPrompt, fxPickKey, fxRawDir, listFxIds, listFxRaw, loadFxSpec, loadFxStyle, loadPicks, savePicks,
  specHash, type FxSpec, type FxStyle,
} from './config';
import { classify, Px, type Rgba } from './process';

function readPng(path: string): Rgba {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

function writePng(path: string, img: Rgba): void {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).copy(png.data);
  writeFileSync(path, PNG.sync.write(png));
}

// ---------- slicing (pure, tested) ----------

export interface FxSliceResult {
  frameW: number;
  frameH: number;
  frames: number;
  body: Rgba; // frames laid out left-to-right, magenta -> transparent
}

/**
 * Slice a single horizontal strip of `frames` equal cells on a magenta background into a
 * transparent sprite strip. No outline, no team mask (fx sheets never carry team cloth).
 */
export function sliceFxStrip(img: Rgba, frames: number): FxSliceResult {
  if (frames < 1) throw new Error('frames must be >= 1');
  const { width: W, height: H, data } = img;
  if (W % frames !== 0) throw new Error(`strip width ${W} is not divisible by ${frames} frames`);
  const frameW = W / frames;
  const frameH = H;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const cls = classify(data[p]!, data[p + 1]!, data[p + 2]!);
      if (cls === Px.Bg) continue;
      out[p] = data[p]!;
      out[p + 1] = data[p + 1]!;
      out[p + 2] = data[p + 2]!;
      out[p + 3] = 255;
    }
  }
  return { frameW, frameH, frames, body: { width: W, height: H, data: out } };
}

/** Aseprite-style JSON for an fx strip, consumed by src/render/fx.ts: a single 'play' tag. */
export function fxAsepriteJson(fxId: string, image: string, res: FxSliceResult, frameMs: number) {
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; duration: number }> = {};
  for (let i = 0; i < res.frames; i++) {
    frames[`${fxId} ${i}`] = { frame: { x: i * res.frameW, y: 0, w: res.frameW, h: res.frameH }, duration: frameMs };
  }
  return {
    frames,
    meta: {
      app: 'dragonland art pipeline',
      image,
      format: 'RGBA8888',
      size: { w: res.body.width, h: res.body.height },
      scale: '1',
      frameTags: [{ name: 'play', from: 0, to: res.frames - 1, direction: 'forward' }],
    },
  };
}

// ---------- generation (mirrors cli.ts's unit flow; kept separate: fx has no refs/anchor) ----------

interface FxPlan {
  id: string;
  spec: FxSpec;
  dir: string;
  prompt: string;
  hash: string;
  existing: string[];
}

function plan(id: string): FxPlan {
  const spec = loadFxSpec(id);
  const style = loadFxStyle();
  const prompt = buildFxPrompt(spec, style);
  const hash = specHash(prompt, []);
  return { id, spec, dir: fxRawDir(id), prompt, hash, existing: listFxRaw(id).filter((f) => f.startsWith(`${hash}-`)) };
}

function newestGenerated(since: number): string | undefined {
  const base = join(homedir(), '.codex', 'generated_images');
  if (!existsSync(base)) return undefined;
  let best: { p: string; t: number } | undefined;
  for (const d of readdirSync(base)) {
    const dir = join(base, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.png')) continue;
      const p = join(dir, f);
      const t = statSync(p).mtimeMs;
      if (t >= since && (!best || t > best.t)) best = { p, t };
    }
  }
  return best?.p;
}

function generateOne(p: FxPlan, index: number): string {
  mkdirSync(p.dir, { recursive: true });
  const name = `${p.hash}-${index}.png`;
  const rel = relative(ROOT, join(p.dir, name));
  writeFileSync(join(p.dir, `${p.hash}.prompt.txt`), `${p.prompt}\n`);
  const instruction =
    `Use your image generation tool to create ONE image:\n\n${p.prompt}\n\n` +
    `Save the resulting PNG to ${rel} (copy it from wherever the image tool writes it). Do not modify any other file. Then run: file ${rel}`;
  const args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-'];
  const started = Date.now();
  process.stdout.write(`  fx/${p.id}: generating ${name} ... `);
  const res = spawnSync('codex', args, { cwd: ROOT, input: instruction, encoding: 'utf8', timeout: 420_000, maxBuffer: 64 * 1024 * 1024 });
  const out = join(p.dir, name);
  if (!existsSync(out)) {
    const fallback = newestGenerated(started);
    if (fallback) copyFileSync(fallback, out);
  }
  if (!existsSync(out)) {
    console.log('FAILED');
    throw new Error(`codex produced no image for fx/${p.id} (exit ${res.status}).\n${(res.stderr ?? '').slice(-1500)}`);
  }
  console.log(`ok (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  return name;
}

function runPlan(p: FxPlan, n: number, force: boolean): void {
  const missing = force ? n : Math.max(0, n - p.existing.length);
  if (!missing) {
    console.log(`  fx/${p.id}: up to date (${p.existing.length} candidates for spec ${p.hash}); use --force for more`);
    return;
  }
  mkdirSync(p.dir, { recursive: true });
  const used = new Set(readdirSync(p.dir));
  for (let k = 1, made = 0; made < missing; k++) {
    if (used.has(`${p.hash}-${k}.png`)) continue;
    generateOne(p, k);
    made++;
  }
}

function resolveFxIds(args: string[]): string[] {
  if (args.includes('all')) return listFxIds();
  const all = listFxIds();
  for (const a of args) if (!all.includes(a)) throw new Error(`unknown fx id '${a}' (have: ${all.join(', ')})`);
  return [...new Set(args)];
}

export function cmdFxGen(args: string[]): void {
  let n = 1;
  let force = false;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-n') n = Number(args[++i]);
    else if (a === '--force') force = true;
    else ids.push(a);
  }
  const targets = resolveFxIds(ids);
  if (!targets.length) throw new Error('usage: fx gen <fx|all> [-n 1] [--force]');
  for (const id of targets) runPlan(plan(id), n, force);
}

export function cmdFxPick(args: string[]): void {
  const [id, which] = args;
  if (!id || !which) throw new Error('usage: fx pick <fx> <file>');
  const files = listFxRaw(id);
  const file = files.find((f) => f === which || f === `${which}.png`);
  if (!file) throw new Error(`no candidate '${which}' for fx/${id}; have: ${files.join(', ') || 'none'}`);
  const picks = loadPicks();
  picks[fxPickKey(id)] = file;
  savePicks(picks);
  console.log(`picked fx/${id} = ${file}`);
}

export function cmdFxProcess(args: string[]): void {
  const picks = loadPicks();
  const ids = args.length ? resolveFxIds(args) : listFxIds();
  let failures = 0;
  for (const id of ids) {
    const pick = picks[fxPickKey(id)];
    if (!pick) {
      console.log(`  fx/${id}: no pick`);
      continue;
    }
    const spec = loadFxSpec(id);
    try {
      const res = sliceFxStrip(readPng(join(fxRawDir(id), pick)), spec.frames);
      mkdirSync(FX_OUT, { recursive: true });
      writePng(join(FX_OUT, `${id}.png`), res.body);
      writeFileSync(join(FX_OUT, `${id}.json`), JSON.stringify(fxAsepriteJson(id, `${id}.png`, res, 80), null, 1) + '\n');
      console.log(`  fx/${id}: ${pick} -> assets/fx/${id}.png (${res.frames} frames, ${res.frameW}x${res.frameH})`);
    } catch (e) {
      failures++;
      console.log(`  fx/${id}: FAILED ${e instanceof Error ? e.message : e}`);
    }
  }
  if (failures) process.exitCode = 1;
}

export function cmdFxStatus(): void {
  const picks = loadPicks();
  for (const id of listFxIds()) {
    const p = plan(id);
    const all = listFxRaw(id);
    const pick = picks[fxPickKey(id)];
    console.log(
      `${id.padEnd(14)} spec ${p.hash}  candidates ${String(p.existing.length).padStart(2)} current / ${String(all.length).padStart(2)} total   ` +
        (pick ? `pick ${pick}${pick.startsWith(`${p.hash}-`) ? '' : ' (older spec)'}` : 'no pick'),
    );
  }
}

export function cmdFx(args: string[]): void {
  const [sub, ...rest] = args;
  if (sub === 'gen') cmdFxGen(rest);
  else if (sub === 'pick') cmdFxPick(rest);
  else if (sub === 'process') cmdFxProcess(rest);
  else if (sub === 'status' || !sub) cmdFxStatus();
  else throw new Error(`unknown fx subcommand '${sub}' (gen|pick|process|status)`);
}

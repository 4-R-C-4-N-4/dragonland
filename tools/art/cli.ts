#!/usr/bin/env tsx
// Dragonland art pipeline CLI. See docs/art-pipeline.md.
//
//   npm run art -- status                     every unit: pick, stale?, candidates
//   npm run art -- gen <id|batchN|--stale> [-n 2] [--force]   Codex image generation (sequential)
//   npm run art -- pick <id> <file|#>         choose the candidate the game uses
//   npm run art -- process [id...]            picks -> assets/sprites (+ candidates -> art/.cache)
//   npm run art -- review                     write art/review.html (open /art/review.html in `npm run dev`)
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import {
  ANIMS, ART, CACHE, OUT, RAW, ROOT, buildPrompt, listRaw, listUnits, loadBatches, loadPicks, loadSizes, loadStyle, loadUnit,
  rawDir, referencesFor, savePicks, specHash, type UnitSpec,
} from './config';
import { asepriteJson, processSheet, type ProcessResult, type Rgba } from './process';

function readPng(path: string): Rgba {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

function writePng(path: string, img: Rgba): void {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).copy(png.data);
  writeFileSync(path, PNG.sync.write(png));
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function resolveIds(args: string[]): string[] {
  const batches = loadBatches();
  const all = listUnits();
  const ids: string[] = [];
  for (const a of args) {
    if (batches[a]) ids.push(...batches[a]!);
    else if (all.includes(a)) ids.push(a);
    else throw new Error(`unknown unit or batch '${a}' (units: ${all.join(', ')}; batches: ${Object.keys(batches).join(', ')})`);
  }
  return [...new Set(ids)];
}

interface GenPlan {
  spec: UnitSpec;
  prompt: string;
  refs: { role: string; path: string }[];
  hash: string;
  existing: string[];
}

function plan(id: string): GenPlan {
  const style = loadStyle();
  const spec = loadUnit(id);
  const picks = loadPicks();
  const refs = referencesFor(spec, style, picks);
  const prompt = buildPrompt(spec, style, refs);
  const hash = specHash(prompt, refs);
  const existing = listRaw(id).filter((f) => f.startsWith(`${hash}-`));
  return { spec, prompt, refs, hash, existing };
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

function generateOne(p: GenPlan, index: number): string {
  const dir = rawDir(p.spec.id);
  mkdirSync(dir, { recursive: true });
  const name = `${p.hash}-${index}.png`;
  const rel = relative(ROOT, join(dir, name));
  writeFileSync(join(dir, `${p.hash}.prompt.txt`), `${p.prompt}\n\nreferences:\n${p.refs.map((r) => `  ${r.role}: ${relative(ROOT, r.path)}`).join('\n')}\n`);
  const instruction =
    `Use your image generation tool to create ONE image${p.refs.length ? ' (use the attached image(s) as references as described)' : ''}:\n\n${p.prompt}\n\n` +
    `Save the resulting PNG to ${rel} (copy it from wherever the image tool writes it). Do not modify any other file. Then run: file ${rel}`;
  const args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
  for (const r of p.refs) args.push('-i', r.path);
  args.push('-'); // prompt from stdin (an -i list would otherwise swallow a positional prompt)
  const started = Date.now();
  process.stdout.write(`  ${p.spec.id}: generating ${name} ... `);
  const res = spawnSync('codex', args, { cwd: ROOT, input: instruction, encoding: 'utf8', timeout: 420_000, maxBuffer: 64 * 1024 * 1024 });
  const out = join(dir, name);
  if (!existsSync(out)) {
    const fallback = newestGenerated(started);
    if (fallback) copyFileSync(fallback, out);
  }
  if (!existsSync(out)) {
    console.log('FAILED');
    throw new Error(`codex produced no image for ${p.spec.id} (exit ${res.status}).\n${(res.stderr ?? '').slice(-1500)}`);
  }
  console.log(`ok (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  return name;
}

function cmdGen(args: string[]): void {
  let n = 2;
  let force = false;
  let stale = false;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-n') n = Number(args[++i]);
    else if (a === '--force') force = true;
    else if (a === '--stale') stale = true;
    else ids.push(a);
  }
  const targets = stale ? listUnits().filter((id) => plan(id).existing.length === 0) : resolveIds(ids);
  if (!targets.length) return console.log('nothing to generate');
  const style = loadStyle();
  // The style anchor must exist before anything that references it.
  targets.sort((a, b) => (a === style.anchor ? -1 : b === style.anchor ? 1 : 0));
  for (const id of targets) {
    if (id !== style.anchor && !loadPicks()[style.anchor]) {
      console.log(`  ${id}: skipped — pick the style anchor '${style.anchor}' first (npm run art -- pick ${style.anchor} <file>)`);
      continue;
    }
    const p = plan(id);
    const missing = force ? n : Math.max(0, n - p.existing.length);
    if (!missing) {
      console.log(`  ${id}: up to date (${p.existing.length} candidates for spec ${p.hash}); use --force for more`);
      continue;
    }
    const used = new Set(listRaw(id));
    let k = 1;
    for (let made = 0; made < missing; k++) {
      if (used.has(`${p.hash}-${k}.png`)) continue;
      generateOne(p, k);
      made++;
    }
  }
}

function cmdPick(args: string[]): void {
  const [id, which] = args;
  if (!id || !which) throw new Error('usage: pick <id> <file|#n (1-based, newest first)>');
  const files = listRaw(id);
  const byAge = [...files].sort((a, b) => statSync(join(rawDir(id), b)).mtimeMs - statSync(join(rawDir(id), a)).mtimeMs);
  const file = which.startsWith('#') ? byAge[Number(which.slice(1)) - 1] : files.find((f) => f === which || f === `${which}.png`);
  if (!file) throw new Error(`no candidate '${which}' for ${id}; have: ${files.join(', ') || 'none'}`);
  const picks = loadPicks();
  picks[id] = file;
  savePicks(picks);
  console.log(`picked ${id} = ${file}`);
}

function processOne(id: string, rawFile: string, outDir: string, outName: string): ProcessResult {
  const style = loadStyle();
  const sizes = loadSizes();
  const spec = loadUnit(id);
  const height = sizes.height[spec.size];
  if (!height) throw new Error(`${id}: size '${spec.size}' missing from sizes.yaml`);
  const res = processSheet(readPng(join(rawDir(id), rawFile)), {
    targetHeight: height,
    rows: style.layout.rows,
    framesPerRow: style.layout.framesPerRow,
    alphaCut: sizes.alphaCut,
    outline: (sizes as { outline?: string }).outline ? hexRgb((sizes as { outline?: string }).outline!) : null,
  });
  mkdirSync(outDir, { recursive: true });
  writePng(join(outDir, `${outName}.png`), res.body);
  writePng(join(outDir, `${outName}.mask.png`), res.mask);
  const json = asepriteJson(id, `${outName}.png`, res, style.layout.rows, style.layout.framesPerRow, sizes.frameMs);
  writeFileSync(join(outDir, `${outName}.json`), JSON.stringify(json, null, 1) + '\n');
  return res;
}

function cmdProcess(args: string[]): void {
  const picks = loadPicks();
  const ids = args.length ? resolveIds(args) : listUnits();
  let failures = 0;
  for (const id of ids) {
    // Candidates -> cache (for review)
    mkdirSync(join(CACHE, id), { recursive: true });
    for (const f of listRaw(id)) {
      try {
        processOne(id, f, join(CACHE, id), f.replace(/\.png$/, ''));
      } catch (e) {
        writeFileSync(join(CACHE, id, `${f.replace(/\.png$/, '')}.error.txt`), String(e instanceof Error ? e.message : e));
      }
    }
    const pick = picks[id];
    if (!pick) continue;
    try {
      const res = processOne(id, pick, OUT, id);
      console.log(`  ${id}: ${pick} -> assets/sprites/${id}.png (${res.frameW}x${res.frameH} frames, scale ${res.scale.toFixed(3)})${res.warnings.length ? `\n     ! ${res.warnings.join('\n     ! ')}` : ''}`);
    } catch (e) {
      failures++;
      console.log(`  ${id}: FAILED ${e instanceof Error ? e.message : e}`);
    }
  }
  // Remove game sheets for units that no longer have a pick.
  for (const f of existsSync(OUT) ? readdirSync(OUT) : []) {
    const id = f.split('.')[0]!;
    if (listUnits().includes(id) && !picks[id] && /\.(png|json)$/.test(f)) rmSync(join(OUT, f));
  }
  if (failures) process.exitCode = 1;
}

function cmdStatus(): void {
  const picks = loadPicks();
  for (const id of listUnits()) {
    const p = plan(id);
    const all = listRaw(id);
    const pickFresh = picks[id]?.startsWith(`${p.hash}-`);
    console.log(
      `${id.padEnd(9)} spec ${p.hash}  candidates ${String(p.existing.length).padStart(2)} current / ${String(all.length).padStart(2)} total   ` +
        (picks[id] ? `pick ${picks[id]}${pickFresh ? '' : ' (older spec)'}` : 'no pick'),
    );
  }
}

function cmdReview(): void {
  const picks = loadPicks();
  // Batch order first (what's being vetted), then everything else.
  const batchOrder = Object.values(loadBatches()).flat();
  const ordered = [...new Set([...batchOrder, ...listUnits()])].filter((id) => listUnits().includes(id));
  const units = ordered.map((id) => {
    const p = plan(id);
    const cands = listRaw(id)
      .map((f) => {
        const base = f.replace(/\.png$/, '');
        const json = join(CACHE, id, `${base}.json`);
        const err = join(CACHE, id, `${base}.error.txt`);
        return {
          file: f,
          current: f.startsWith(`${p.hash}-`),
          picked: picks[id] === f,
          sheet: existsSync(json) ? `/art/.cache/${id}/${base}` : null,
          error: existsSync(err) ? readFileSync(err, 'utf8') : null,
          raw: `/art/raw/${id}/${f}`,
          mtime: statSync(join(rawDir(id), f)).mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return { id, name: p.spec.name, size: p.spec.size, hash: p.hash, cands };
  });
  const tpl = readFileSync(join(ROOT, 'tools/art/review.template.html'), 'utf8');
  writeFileSync(join(ART, 'review.html'), tpl.replace('/*DATA*/null', JSON.stringify({ units, anims: ANIMS })));
  console.log('wrote art/review.html — run `npm run dev` and open http://localhost:5173/art/review.html');
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'gen') cmdGen(rest);
  else if (cmd === 'pick') cmdPick(rest);
  else if (cmd === 'process') cmdProcess(rest);
  else if (cmd === 'review') cmdReview();
  else if (cmd === 'status' || !cmd) cmdStatus();
  else throw new Error(`unknown command ${cmd}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
void RAW;

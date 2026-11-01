#!/usr/bin/env tsx
// Dragonland art pipeline CLI. See docs/art-pipeline.md.
//
//   npm run art -- status                                    units, spec hash, candidates, picks
//   npm run art -- gen <id|batchN|--stale> [-n 2] [--force]   full sheets (sequential Codex calls)
//   npm run art -- gen <id|batchN> --anim walk [-n 2]          regenerate ONE animation of picked units
//   npm run art -- pick <id> <file> [--anim walk]              choose a candidate (--anim walk none = drop override)
//   npm run art -- process [id...]                           picks -> assets/sprites (+ candidates -> art/.cache)
//   npm run art -- review                                    write art/review.html (open /art/review.html in `npm run dev`)
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import {
  ANIMS, ART, CACHE, OUT, ROOT, animKey, animRawDir, buildAnimPrompt, buildPrompt, listAnimRaw, listRaw, listUnits, loadBatches,
  loadPicks, loadSizes, loadStyle, loadUnit, rawDir, referencesFor, savePicks, specHash, type Anim, type UnitSpec,
} from './config';
import { asepriteJson, packRows, processSheet, rowFigureHeight, type ProcessResult, type Rgba, type RowRef } from './process';

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
  label: string;
  dir: string;
  prompt: string;
  refs: { role: string; path: string }[];
  hash: string;
  existing: string[];
}

function plan(id: string): GenPlan & { spec: UnitSpec } {
  const style = loadStyle();
  const spec = loadUnit(id);
  const refs = referencesFor(spec, style, loadPicks());
  const prompt = buildPrompt(spec, style, refs);
  const hash = specHash(prompt, refs);
  return { spec, label: id, dir: rawDir(id), prompt, refs, hash, existing: listRaw(id).filter((f) => f.startsWith(`${hash}-`)) };
}

/** Plan for regenerating one animation, based on the unit's picked full sheet (attached as reference). */
function planAnim(id: string, anim: Anim): GenPlan | null {
  const pick = loadPicks()[id];
  if (!pick || !loadStyle().animations?.[anim]) return null;
  const refs = [{ role: 'character', path: join(rawDir(id), pick) }];
  const prompt = buildAnimPrompt(loadUnit(id), loadStyle(), anim);
  const hash = specHash(prompt, refs);
  return { label: animKey(id, anim), dir: animRawDir(id, anim), prompt, refs, hash, existing: listAnimRaw(id, anim).filter((f) => f.startsWith(`${hash}-`)) };
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
  mkdirSync(p.dir, { recursive: true });
  const name = `${p.hash}-${index}.png`;
  const rel = relative(ROOT, join(p.dir, name));
  writeFileSync(join(p.dir, `${p.hash}.prompt.txt`), `${p.prompt}\n\nreferences:\n${p.refs.map((r) => `  ${r.role}: ${relative(ROOT, r.path)}`).join('\n')}\n`);
  const instruction =
    `Use your image generation tool to create ONE image${p.refs.length ? ' (use the attached image(s) as references as described)' : ''}:\n\n${p.prompt}\n\n` +
    `Save the resulting PNG to ${rel} (copy it from wherever the image tool writes it). Do not modify any other file. Then run: file ${rel}`;
  const args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
  for (const r of p.refs) args.push('-i', r.path);
  args.push('-'); // prompt from stdin (an -i list would otherwise swallow a positional prompt)
  const started = Date.now();
  process.stdout.write(`  ${p.label}: generating ${name} ... `);
  const res = spawnSync('codex', args, { cwd: ROOT, input: instruction, encoding: 'utf8', timeout: 420_000, maxBuffer: 64 * 1024 * 1024 });
  const out = join(p.dir, name);
  if (!existsSync(out)) {
    const fallback = newestGenerated(started);
    if (fallback) copyFileSync(fallback, out);
  }
  if (!existsSync(out)) {
    console.log('FAILED');
    throw new Error(`codex produced no image for ${p.label} (exit ${res.status}).\n${(res.stderr ?? '').slice(-1500)}`);
  }
  console.log(`ok (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  return name;
}

function runPlan(p: GenPlan, n: number, force: boolean): void {
  const missing = force ? n : Math.max(0, n - p.existing.length);
  if (!missing) return console.log(`  ${p.label}: up to date (${p.existing.length} candidates for spec ${p.hash}); use --force for more`);
  mkdirSync(p.dir, { recursive: true });
  const used = new Set(readdirSync(p.dir));
  for (let k = 1, made = 0; made < missing; k++) {
    if (used.has(`${p.hash}-${k}.png`)) continue;
    generateOne(p, k);
    made++;
  }
}

function cmdGen(args: string[]): void {
  let n = 2;
  let force = false;
  let stale = false;
  let anim: Anim | null = null;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-n') n = Number(args[++i]);
    else if (a === '--force') force = true;
    else if (a === '--stale') stale = true;
    else if (a === '--anim') anim = args[++i] as Anim;
    else ids.push(a);
  }
  if (anim && !ANIMS.includes(anim)) throw new Error(`--anim must be one of ${ANIMS.join(', ')}`);
  if (anim) {
    for (const id of resolveIds(ids)) {
      const p = planAnim(id, anim);
      if (!p) console.log(`  ${id}: skipped — no picked sheet to base the ${anim} on`);
      else runPlan(p, n, force);
    }
    return;
  }
  const style = loadStyle();
  const targets = stale ? listUnits().filter((id) => plan(id).existing.length === 0) : resolveIds(ids);
  if (!targets.length) return console.log('nothing to generate');
  // The style anchor must exist before anything that references it.
  targets.sort((a, b) => (a === style.anchor ? -1 : b === style.anchor ? 1 : 0));
  for (const id of targets) {
    if (id !== style.anchor && !loadPicks()[style.anchor]) {
      console.log(`  ${id}: skipped — pick the style anchor '${style.anchor}' first (npm run art -- pick ${style.anchor} <file>)`);
      continue;
    }
    runPlan(plan(id), n, force);
  }
}

function cmdPick(args: string[]): void {
  let anim: Anim | null = null;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--anim') anim = args[++i] as Anim;
    else pos.push(args[i]!);
  }
  const [id, which] = pos;
  if (!id || !which) throw new Error('usage: pick <id> <file> [--anim walk]   (file "none" with --anim drops the override)');
  const picks = loadPicks();
  const key = anim ? animKey(id, anim) : id;
  if (anim && which === 'none') {
    delete picks[key];
    savePicks(picks);
    return console.log(`dropped ${key} override`);
  }
  const files = anim ? listAnimRaw(id, anim) : listRaw(id);
  const file = files.find((f) => f === which || f === `${which}.png`);
  if (!file) throw new Error(`no candidate '${which}' for ${key}; have: ${files.join(', ') || 'none'}`);
  picks[key] = file;
  savePicks(picks);
  console.log(`picked ${key} = ${file}`);
}

function processMain(id: string, rawPath: string): ProcessResult {
  const style = loadStyle();
  const sizes = loadSizes();
  const spec = loadUnit(id);
  const height = sizes.height[spec.size] && Math.round(sizes.height[spec.size]! * (spec.heightScale ?? 1));
  if (!height) throw new Error(`${id}: size '${spec.size}' missing from sizes.yaml`);
  return processSheet(readPng(rawPath), {
    targetHeight: height,
    rows: style.layout.rows,
    framesPerRow: style.layout.framesPerRow,
    alphaCut: sizes.alphaCut,
    outline: sizes.outline ? hexRgb(sizes.outline) : null,
  });
}

/** Process a single-animation strip at the same on-screen size as that animation in the main sheet. */
function processAnimStrip(anim: Anim, rawPath: string, main: ProcessResult): ProcessResult {
  const style = loadStyle();
  const sizes = loadSizes();
  const a = style.animations?.[anim];
  if (!a) throw new Error(`style.yaml has no animations.${anim}`);
  const row = Math.max(0, style.layout.rows.indexOf(anim));
  return processSheet(readPng(rawPath), {
    targetHeight: rowFigureHeight(main, row, style.layout.framesPerRow),
    rows: [anim],
    framesPerRow: a.frames,
    alphaCut: sizes.alphaCut,
    outline: sizes.outline ? hexRgb(sizes.outline) : null,
  });
}

/** Write <outName>.png/.mask.png/.json: the main sheet, with any animation overrides swapped in. */
function writeSheet(id: string, main: ProcessResult, overrides: Partial<Record<Anim, ProcessResult>>, outDir: string, outName: string): void {
  const style = loadStyle();
  const sizes = loadSizes();
  mkdirSync(outDir, { recursive: true });
  let body: Rgba;
  let mask: Rgba;
  let json: unknown;
  if (Object.keys(overrides).length === 0) {
    body = main.body;
    mask = main.mask;
    json = asepriteJson(id, `${outName}.png`, main, style.layout.rows, style.layout.framesPerRow, sizes.frameMs);
  } else {
    const rows: RowRef[] = style.layout.rows.map((anim, r) => {
      const o = overrides[anim];
      return o
        ? { anim, res: o, row: 0, frames: style.animations?.[anim]?.frames ?? style.layout.framesPerRow }
        : { anim, res: main, row: r, frames: style.layout.framesPerRow };
    });
    ({ body, mask, json } = packRows(id, `${outName}.png`, rows, sizes.frameMs));
  }
  writePng(join(outDir, `${outName}.png`), body);
  writePng(join(outDir, `${outName}.mask.png`), mask);
  writeFileSync(join(outDir, `${outName}.json`), JSON.stringify(json, null, 1) + '\n');
}

function tryWrite(errPath: string, fn: () => void): void {
  try {
    fn();
    if (existsSync(errPath)) rmSync(errPath);
  } catch (e) {
    writeFileSync(errPath, String(e instanceof Error ? e.message : e));
  }
}

function cmdProcess(args: string[]): void {
  const picks = loadPicks();
  const ids = args.length ? resolveIds(args) : listUnits();
  let failures = 0;
  for (const id of ids) {
    const cache = join(CACHE, id);
    mkdirSync(cache, { recursive: true });
    // Full-sheet candidates -> cache (for review)
    for (const f of listRaw(id)) {
      const base = f.replace(/\.png$/, '');
      tryWrite(join(cache, `${base}.error.txt`), () => writeSheet(id, processMain(id, join(rawDir(id), f)), {}, cache, base));
    }
    const pick = picks[id];
    if (!pick) continue;
    let main: ProcessResult;
    try {
      main = processMain(id, join(rawDir(id), pick));
    } catch (e) {
      failures++;
      console.log(`  ${id}: FAILED ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const overrides: Partial<Record<Anim, ProcessResult>> = {};
    const notes: string[] = [...main.warnings];
    for (const anim of ANIMS) {
      // Animation-override candidates -> cache, each shown inside the picked sheet.
      for (const f of listAnimRaw(id, anim)) {
        const base = `${anim}-${f.replace(/\.png$/, '')}`;
        tryWrite(join(cache, `${base}.error.txt`), () => writeSheet(id, main, { [anim]: processAnimStrip(anim, join(animRawDir(id, anim), f), main) }, cache, base));
      }
      const ap = picks[animKey(id, anim)];
      if (!ap) continue;
      try {
        overrides[anim] = processAnimStrip(anim, join(animRawDir(id, anim), ap), main);
        notes.push(...overrides[anim]!.warnings.map((w) => `${anim}: ${w}`));
      } catch (e) {
        failures++;
        notes.push(`${anim} override FAILED (${e instanceof Error ? e.message : e}); keeping the sheet's own ${anim}`);
      }
    }
    writeSheet(id, main, overrides, OUT, id);
    const ov = Object.keys(overrides) as Anim[];
    console.log(
      `  ${id}: ${pick}${ov.length ? ` + ${ov.map((a) => `${a}:${picks[animKey(id, a)]}`).join(' ')}` : ''} -> assets/sprites/${id}.png` +
        (notes.length ? `\n     ! ${notes.join('\n     ! ')}` : ''),
    );
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
    const anims = ANIMS.map((a) => (listAnimRaw(id, a).length ? `${a}:${listAnimRaw(id, a).length}${picks[animKey(id, a)] ? '*' : ''}` : '')).filter(Boolean);
    console.log(
      `${id.padEnd(9)} spec ${p.hash}  candidates ${String(p.existing.length).padStart(2)} current / ${String(all.length).padStart(2)} total   ` +
        (picks[id] ? `pick ${picks[id]}${pickFresh ? '' : ' (older spec)'}` : 'no pick') +
        (anims.length ? `   overrides ${anims.join(' ')} (* picked)` : ''),
    );
  }
}

function cmdReview(): void {
  const picks = loadPicks();
  // Batch order first (what's being vetted), then everything else.
  const batchOrder = Object.values(loadBatches()).flat();
  const ordered = [...new Set([...batchOrder, ...listUnits()])].filter((id) => listUnits().includes(id));
  const card = (id: string, label: string, base: string, raw: string, current: boolean, picked: boolean, cmd: string, mtime: number) => {
    const json = join(CACHE, id, `${base}.json`);
    const err = join(CACHE, id, `${base}.error.txt`);
    return {
      file: label,
      current,
      picked,
      sheet: existsSync(json) ? `/art/.cache/${id}/${base}` : null,
      error: existsSync(err) ? readFileSync(err, 'utf8') : null,
      raw,
      cmd,
      mtime,
    };
  };
  const units = ordered.map((id) => {
    const p = plan(id);
    const cands = listRaw(id).map((f) =>
      card(id, f, f.replace(/\.png$/, ''), `/art/raw/${id}/${f}`, f.startsWith(`${p.hash}-`), picks[id] === f, `npm run art -- pick ${id} ${f}`, statSync(join(rawDir(id), f)).mtimeMs),
    );
    for (const anim of ANIMS) {
      const ap = planAnim(id, anim);
      for (const f of listAnimRaw(id, anim)) {
        cands.push(
          card(id, `${anim}: ${f}`, `${anim}-${f.replace(/\.png$/, '')}`, `/art/raw/${id}/${anim}/${f}`, ap ? f.startsWith(`${ap.hash}-`) : false,
            picks[animKey(id, anim)] === f, `npm run art -- pick ${id} ${f} --anim ${anim}`, statSync(join(animRawDir(id, anim), f)).mtimeMs),
        );
      }
    }
    cands.sort((a, b) => b.mtime - a.mtime);
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

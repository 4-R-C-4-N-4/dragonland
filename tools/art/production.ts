// Resumable, serialized first-pass art production. Human/isolated visual review remains separate.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { ART, CACHE, ROOT, listUnits, listRaw, loadUnit, loadPicks, loadSizes, loadStyle, rawDir } from './config';
import { processSheet, asepriteJson } from './process';

export function productionOrder(specs: { id: string; evolvesFrom?: string }[], picks: Record<string, string>): string[] {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const visiting = new Set<string>(), done = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (done.has(id) || picks[id]) return;
    if (visiting.has(id)) throw new Error(`evolution reference cycle at ${id}`);
    const spec = byId.get(id);
    if (!spec) throw new Error(`missing evolution reference ${id}`);
    visiting.add(id);
    if (spec.evolvesFrom) visit(spec.evolvesFrom);
    visiting.delete(id); done.add(id); order.push(id);
  };
  specs.forEach((s) => visit(s.id));
  return order;
}

interface ProductionEntry {
  id: string;
  candidate: string | null;
  technical: 'pass' | 'failed';
  visualReview: 'pending';
  warnings: string[];
  error?: string;
}

function command(args: string[]): void {
  const result = spawnSync('npm', ['run', '-s', 'art', '--', ...args], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`art ${args.join(' ')} failed (${result.status}): ${result.error?.message ?? ''}`);
}

export function runProduction(limit = Infinity): void {
  mkdirSync(CACHE, { recursive: true });
  const lockPath = join(CACHE, 'production.lock');
  const lock = openSync(lockPath, 'wx'); // do not race Codex's newest-generated-image fallback
  const reportPath = join(ART, 'reviews', 'production.json');
  mkdirSync(join(ART, 'reviews'), { recursive: true });
  const report: ProductionEntry[] = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : [];
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  try {
    const order = productionOrder(listUnits().map(loadUnit), loadPicks()).slice(0, limit);
    console.log(`Art queue: ${order.length} missing species. Existing picks will not be regenerated.`);
    for (const id of order) {
      const entry: ProductionEntry = { id, candidate: null, technical: 'failed', visualReview: 'pending', warnings: [] };
      const spec = loadUnit(id), sizes = loadSizes(), style = loadStyle();
      const outline = sizes.outline ? parseInt(sizes.outline.slice(1), 16) : null;
      for (let attempt = 1; attempt <= 3 && !entry.candidate; attempt++) {
        // n=1 first; subsequent attempts preserve failures and ask for one additional source.
        command(['gen', id, '-n', String(attempt)]);
        for (const candidate of listRaw(id).slice().reverse()) {
          try {
            const image = PNG.sync.read(readFileSync(join(rawDir(id), candidate)));
            const processed = processSheet(image, {
              targetHeight: Math.round(sizes.height[spec.size]! * (spec.heightScale ?? 1)),
              rows: style.layout.rows, framesPerRow: style.layout.framesPerRow,
              alphaCut: sizes.alphaCut,
              outline: outline === null ? null : [(outline >> 16) & 255, (outline >> 8) & 255, outline & 255],
            });
            const json = asepriteJson(id, id + '.png', processed, style.layout.rows, style.layout.framesPerRow, sizes.frameMs);
            for (const { frame } of Object.values(json.frames)) {
              let opaque = 0;
              for (let y = frame.y; y < frame.y + frame.h; y++) for (let x = frame.x; x < frame.x + frame.w; x++) {
                if (processed.body.data[(y * processed.body.width + x) * 4 + 3]) opaque++;
              }
              if (!opaque) throw new Error('empty processed frame');
            }
            entry.candidate = candidate; entry.technical = 'pass'; entry.warnings = processed.warnings;
            delete entry.error;
            break;
          } catch (error) { entry.error = String(error); }
        }
      }
      const previous = report.findIndex((r) => r.id === id);
      if (previous >= 0) report.splice(previous, 1, entry); else report.push(entry);
      save();
      if (!entry.candidate) throw new Error(`${id}: no technically usable source after 3 attempts; ${entry.error}`);
      // Provisional picks allow evolution references. This is NOT independent visual approval.
      command(['pick', id, entry.candidate]); command(['process', id]); command(['review']);
      console.log(`READY FOR INDEPENDENT REVIEW: ${id} ${entry.candidate}`);
    }
    save();
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  if (!(limit > 0) || (Number.isFinite(limit) && !Number.isInteger(limit))) throw new Error('limit must be a positive integer');
  runProduction(limit);
}

// Screenshot every Dragonland screen. Usage: node shots.mjs [outDir] ; env URL, W, H
// Optional QA dependency; keep it outside the game bundle.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
import fs from 'node:fs';
const OUT = process.argv[2] ?? 'shots';
const BASE = process.env.URL ?? 'http://localhost:5180/';
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
const failures = [];
const checks = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 200)); });
let n = 0;
const shot = async name => { await page.waitForTimeout(350);
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  checks.push({ name, ...size });
  if (size.content > size.width + 1) failures.push(`${name}: horizontal overflow ${size.content} > ${size.width}`); await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` }); console.log('shot', name); };
const KEY = 'dragonland.war.v1';
const war = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const setWar = async fn => { await page.evaluate(([k, src]) => { const w = JSON.parse(localStorage.getItem(k)); (new Function('w', src))(w); localStorage.setItem(k, JSON.stringify(w)); }, [KEY, fn]); };
const go = async (q = '?mode=war&seed=17') => { await page.goto(BASE + q); await page.waitForTimeout(600); };
const clickText = async (re, sel = 'button') => { const b = page.locator(sel).filter({ hasText: re }).first(); await b.click(); };
const resume = async () => { await go(); const c = page.locator('button').filter({ hasText: /^Continue|^See how/ }); if (await c.count()) await c.first().click(); await page.waitForTimeout(700); };
const ONLY = process.env.STEPS ? process.env.STEPS.split(',') : null;
const step = async (name, fn) => { if (ONLY && !['title', 'setup', ...ONLY].includes(name)) return; try { await fn(); } catch (e) { failures.push(`${name}: ${String(e).split('\n')[0]}`); console.log('STEP FAILED', name, String(e).split('\n')[0]); await shot('FAILED-' + name).catch(() => {}); } };

await go();
await page.evaluate(k => { localStorage.removeItem(k); localStorage.setItem('dragonland.mode', 'war'); }, KEY);
await go();
await step('title', async () => { await shot('title'); });
await step('setup', async () => {
  await clickText(/^New war/);
  await page.locator('.dl-war-start__token').filter({ hasText: /^Eagle/ }).click();
  await page.locator('.dl-war-start__name input').fill('Ivy');
  await page.locator('.dl-war-start__name input').blur(); await page.evaluate(() => scrollTo(0, 0));
  await shot('setup');
  await page.locator('.dl-war-start__actions button').filter({ hasText: /Begin|Start|March/ }).click();
  await page.locator('.dl-world-map__canvas canvas').waitFor();
  await page.waitForTimeout(900);
});
const fresh = await page.evaluate(k => localStorage.getItem(k), KEY);
await step('map', async () => { await shot('map-fresh'); });
await step('map-order', async () => {
  await page.locator('[data-key="march-reedhaven"]').click();
  await shot('map-march-queued');
  await page.locator('[data-key="end-turn"]').click();
  await shot('map-end-confirm');
  await page.locator('[data-key^="quick-leave-"]').first().click();
  await shot('map-guard-left');
  await page.locator('[data-key^="garrison-"]').first().click();
  await shot('map-node-detail');
});
await step('map-turn2', async () => {
  await page.locator('[data-key^="division-"]').first().click();
  await page.locator('[data-key="end-turn"]').click();
  await page.waitForTimeout(1200);
  const c = page.locator('[data-key="end-confirm"]'); if (await c.count()) await c.click();
  await page.waitForTimeout(1200);
  await shot('map-turn2-report');
});
await step('menu', async () => { await page.locator('.dl-game-menu__toggle').click(); await shot('menu-open'); await page.keyboard.press('Escape'); });

// Battle: contact with two enemy generals, player attacks.
await step('battle', async () => {
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, fresh]);
  await setWar(`
    const own = w.divisions.find(d => d.factionId === 'player');
    const foe = w.divisions.find(d => d.factionId !== 'player' && d.generals.length);
    const spare = w.generals.find(g => g.factionId === foe.factionId && !w.divisions.some(d => d.generals.includes(g.id)));
    foe.generals = [foe.generals[0], spare.id]; foe.atNode = 'reedhaven'; own.atNode = 'reedhaven'; own.previousNode = 'dawnkeep';
    for (const g of w.generals.filter(g => foe.generals.includes(g.id) || own.generals.includes(g.id))) g.nodeId = 'reedhaven';
    w.generals.find(g => own.generals.includes(g.id) && !g.isHero).hp = 900;
    w.pendingBattle = { id: 'qa-shots', cause: 'contact', nodeId: 'reedhaven', attacker: own.id, defender: foe.id, wild: [], processedSkirmishIds: [] };
    w.phase = 'battle';`);
  await resume();
  await shot('battle-choice');
  await page.locator('[data-key^="pick-"]').nth(1).click();
  await page.waitForTimeout(500);
  await shot('prepare');
  await page.getByRole('button', { name: /Fight/ }).click();
  await page.waitForTimeout(700); await shot('battle-loading'); const t0 = Date.now(); await page.waitForSelector('.dl-campaign__loading', { state: 'detached', timeout: 60000 }); console.log('battle loaded in', Date.now() - t0, 'ms'); await page.waitForTimeout(3000);
  await shot('battle-live');
  await page.keyboard.press('Space'); await page.waitForTimeout(600);
  await shot('battle-paused');
  await page.keyboard.press('Space'); await page.keyboard.press('f');
  for (let i = 0; i < 240; i++) { const w = await war(); if (!w.pendingBattle || w.pendingBattle.processedSkirmishIds.length) break; if (i % 6 === 0) await page.keyboard.press('s'); await page.waitForTimeout(500); if (i === 20) await shot('battle-mid'); }
  await page.waitForTimeout(800);
  await shot('aftermath');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot('battle-choice-2');
  const saved = await page.evaluate(k => localStorage.getItem(k), KEY);
  await resume();
  if (await page.evaluate(k => localStorage.getItem(k), KEY) !== saved) throw new Error('Reload changed saved battle');
  if (await page.locator('.dl-outcomes').count()) throw new Error('Reload replayed aftermath');
});
await step('wild', async () => {
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, fresh]);
  await setWar(`
    const own = w.divisions.find(d => d.factionId === 'player'); own.atNode = 'reedhaven'; own.previousNode = 'dawnkeep';
    for (const g of w.generals.filter(g => own.generals.includes(g.id))) g.nodeId = 'reedhaven';
    w.pendingBattle = { id: 'wild-1-reedhaven-' + own.id, cause: 'wild', nodeId: 'reedhaven', attacker: own.id, defender: null, wild: [{ unitId: 'dog', count: 12 }], processedSkirmishIds: [] };
    w.phase = 'battle';`);
  await resume();
  await shot('wild-choice');
});
await step('admin', async () => {
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, fresh]);
  await setWar(`
    const foe = w.divisions.find(d => d.factionId !== 'player' && d.generals.length);
    const cap = w.generals.find(g => g.id === foe.generals[0]); foe.generals = []; cap.hp = 0; cap.troops = cap.troops.slice(0, 12); cap.nodeId = 'dawnkeep';
    w.factions.find(f => f.isPlayer).captives.push(cap.id);
    w.phase = 'admin'; w.turn = 8; w.week = 2;`);
  await resume();
  await shot('admin-muster');
  await setWar(`w.phase = 'orders';`);
  await resume();
  await shot('map-prisoners');
});
await step('title-save', async () => {
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, fresh]);
  await go(); await page.locator('.dl-game-menu__toggle').click(); await clickText(/title/i, '.dl-game-menu__list button');
  await shot('title-with-save');
});
for (const phase of ['won', 'lost']) await step('over-' + phase, async () => {
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, fresh]);
  await setWar(`w.phase = '${phase}'; w.turn = 23; ${phase === 'won' ? "for (const n of w.nodes) n.owner = 'player';" : "w.generals.find(g => g.isHero).hp = 0;"}`);
  await go();
  await shot('over-' + phase);
});
if (!process.env.WAR_ONLY) {
  await step('run', async () => {
    await go('?mode=run'); await shot('skirmish');
    const begin = page.locator('[data-testid="begin-run"]');
    if (await begin.count()) await begin.click();
    await shot('skirmish-choice');
    await page.locator('[data-enc]').first().click();
    await shot('skirmish-prepare');
  });
  await step('sandbox', async () => {
    await go('?mode=sandbox'); await shot('sandbox');
    await page.getByRole('button', { name: /Suggested army/i }).click();
    await shot('sandbox-populated');
  });
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ viewport: { width: W, height: H }, checks, errors, failures }, null, 2));
await browser.close();
if (errors.length || failures.length) { console.error(failures); process.exitCode = 1; }

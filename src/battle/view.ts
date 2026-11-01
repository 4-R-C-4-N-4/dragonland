// Battle view entry point (implementation.md §2.9-2.11, contract in src/battle/types.ts).
import { Application } from 'pixi.js';
import { createBattle, issueCommand, fireSpecial, setPaused } from '../sim';
import type { BattleView, BattleViewOptions, StartBattleView } from './types';
import { createAiController } from '../ai/policy';
import { startLoop } from './loop';
import { Battlefield } from '../render/battlefield';
import { Hud } from '../render/hud';
import { Selection } from './selection';
import { attachInput } from './input';
import { fitCamera, clampCamera, clampZoom, screenToWorld } from './camera';
import type { Camera } from './camera';

export const startBattleView: StartBattleView = async (root, opts) => {
  const { data, setup, labels, onFinished } = opts;
  const world = createBattle(data, setup);
  const ai = createAiController(data, 1);

  const app = new Application();
  await app.init({ resizeTo: root, antialias: true, background: '#1a2a1a' });
  root.appendChild(app.canvas);

  const battlefield = new Battlefield(app.renderer, data, data.constants.FIELD_W, data.constants.FIELD_H);
  battlefield.ensureSprites(world);
  app.stage.addChild(battlefield.world2screen);

  const selection = new Selection(data.constants.MAX_SQUADS);
  const hud = new Hud(data, labels, {
    onSelectSquad: (slot, additive) => (additive ? selection.toggle(slot) : selection.selectOnly(slot)),
    onSelectAll: () => selection.selectAll(),
    onCommand: (cmd) => {
      const sel = selection.selectedSlots();
      if (sel === 'all') {
        issueCommand(world, 0, 'all', cmd);
      } else {
        for (const slot of sel) {
          const sq = world.squads.find((s) => s.side === 0 && s.slot === slot);
          if (sq) issueCommand(world, 0, sq.id, cmd);
        }
      }
    },
    onSpecial: () => fireSpecial(world, 0),
    onPauseToggle: () => setPaused(world, !world.paused),
    onSpeedToggle: () => loopHandle.setSpeed(loopHandle.getSpeed() === 1 ? 2 : 1),
  });
  app.stage.addChild(hud.root);

  // Camera setup.
  let cam: Camera = fitCamera({
    fieldW: data.constants.FIELD_W,
    fieldH: data.constants.FIELD_H * 0.6,
    viewportW: app.renderer.width,
    viewportH: app.renderer.height,
    minZoom: 0.3,
    maxZoom: 3,
  });

  function camOpts() {
    return {
      fieldW: data.constants.FIELD_W,
      fieldH: data.constants.FIELD_H * 0.6,
      viewportW: app.renderer.width,
      viewportH: app.renderer.height,
      minZoom: 0.3,
      maxZoom: 3,
    };
  }

  let dragging = false;
  let dragStart = { x: 0, y: 0, camX: 0, camY: 0 };
  const canvas = app.canvas;

  function isOverHud(x: number, y: number): boolean {
    // Simple heuristic: bottom 70px and top 110px-left strip reserved for HUD controls.
    return y > canvas.height - 70 || (y < 110 && x < 400) || (y < 110 && x > canvas.width - 220) || (x < 110 && y > 50 && y < 110);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (isOverHud(e.offsetX, e.offsetY)) return;
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - dragStart.x) / cam.zoom;
    const dy = (e.clientY - dragStart.y) / cam.zoom;
    cam = clampCamera({ x: dragStart.camX - dx, y: dragStart.camY - dy, zoom: cam.zoom }, camOpts());
  });
  window.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const zoom = clampZoom(cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9), camOpts());
      cam = clampCamera({ ...cam, zoom }, camOpts());
    },
    { passive: false },
  );

  const detachInput = attachInput(window.document, world, selection, {
    onSpeedToggle: () => {
      const next = loopHandle.getSpeed() === 1 ? 2 : 1;
      loopHandle.setSpeed(next);
    },
  });

  let finished = false;
  let resultShownAt: number | null = null;

  const loopHandle = startLoop({
    world,
    data,
    ai,
    onTick: (w) => {
      battlefield.applyEvents(w);
      battlefield.ensureSprites(w);
    },
    onFrame: (w, alpha) => {
      const vw = app.renderer.width;
      const vh = app.renderer.height;
      battlefield.render(w, cam, alpha, vw, vh, 1 / 60);
      hud.layout(vw, vh);
      hud.update(w, selection.selectedSlots());

      if (w.phase === 'duel') {
        const gL = w.ents.x[w.generals[0].entity]!;
        const gR = w.ents.x[w.generals[1].entity]!;
        const midX = (gL + gR) / 2;
        const midY = (w.ents.y[w.generals[0].entity]! + w.ents.y[w.generals[1].entity]!) / 2;
        cam = clampCamera({ x: midX, y: midY, zoom: Math.min(2, camOpts().maxZoom) }, camOpts());
      }

      if (w.result && resultShownAt === null) {
        resultShownAt = performance.now();
      }
      if (resultShownAt !== null && !finished && performance.now() - resultShownAt > 2000) {
        finished = true;
        onFinished(w);
      }
    },
  });

  return {
    destroy(): void {
      loopHandle.stop();
      detachInput();
      battlefield.destroy();
      app.destroy(true, { children: true });
    },
  };
};

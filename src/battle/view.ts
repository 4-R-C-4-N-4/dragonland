// Battle view entry point (implementation.md §2.9-2.11, contract in src/battle/types.ts).
import { Application, Graphics } from 'pixi.js';
import { createBattle, issueCommand, issueApproach, fireSpecial, setPaused } from '../sim';
import type { BattleView, BattleViewOptions, StartBattleView } from './types';
import { createAiController } from '../ai/policy';
import { startLoop } from './loop';
import { Battlefield } from '../render/battlefield';
import { projectGround, projectedBounds } from '../render/projection';
import { Hud } from '../render/hud';
import { Selection } from './selection';
import { bindDragEvents } from './pointerInput';
import { attachInput } from './input';
import { fitCamera, clampCamera, clampZoom } from './camera';
import type { Camera } from './camera';
import { resolveBattleColors } from '../render/colorUi';
import { DEFAULT_PLAYER_COLOR, DEFAULT_ENEMY_COLOR } from '../data/colors';

export const startBattleView: StartBattleView = async (root, opts) => {
  const { data, setup, labels, onFinished } = opts;
  const world = createBattle(data, setup);
  const ai = createAiController(data, 1);
  const sideColors = resolveBattleColors(setup, DEFAULT_PLAYER_COLOR, DEFAULT_ENEMY_COLOR);

  const app = new Application();
  await app.init({ resizeTo: root, antialias: true, background: '#1a2a1a' });
  root.appendChild(app.canvas);

  const battlefield = new Battlefield(app.renderer, data, data.constants.FIELD_W, data.constants.FIELD_H, sideColors);
  await battlefield.preloadSheetImages();
  battlefield.ensureSprites(world);
  app.stage.addChild(battlefield.world2screen);

  // Screen-space vignette so the area outside the field doesn't read as a flat void.
  const vignette = new Graphics();
  app.stage.addChild(vignette);
  let lastVignetteW = -1;
  let lastVignetteH = -1;
  function redrawVignette(w: number, h: number): void {
    if (w === lastVignetteW && h === lastVignetteH) return;
    lastVignetteW = w;
    lastVignetteH = h;
    vignette.clear();
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const inset = (i / steps) * Math.min(w, h) * 0.5;
      vignette.rect(inset, inset, w - inset * 2, h - inset * 2).stroke({ color: 0x000000, alpha: 0.05, width: Math.min(w, h) / steps });
    }
  }

  const selection = new Selection(data.constants.MAX_SQUADS);
  const hud = new Hud(data, labels, sideColors, {
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
    onApproach: (approach) => {
      const sel = selection.selectedSlots();
      if (sel === 'all') issueApproach(world, 0, 'all', approach);
      else for (const slot of sel) {
        const sq = world.squads.find((s) => s.side === 0 && s.slot === slot);
        if (sq) issueApproach(world, 0, sq.id, approach);
      }
    },
    onSpecial: () => fireSpecial(world, 0),
    onPauseToggle: () => setPaused(world, !world.paused),
    onSpeedToggle: () => {
      const next = loopHandle.getSpeed() === 1 ? 2 : 1;
      loopHandle.setSpeed(next);
      hud.setSpeedLabel(next);
    },
  });
  app.stage.addChild(hud.root);

  // Reserve the actual responsive HUD, not a stale fixed-height input/camera band.
  const TOP_BAND = 68;
  function bottomBandHeight(): number {
    hud.layout(app.renderer.width, app.renderer.height);
    return hud.getBottomBandHeight();
  }

  function camOpts() {
    const vw = app.renderer.width;
    const vh = app.renderer.height;
    const usableH = Math.max(100, vh - TOP_BAND - bottomBandHeight());
    return {
      fieldW: projectedBounds(battlefield.projection).width,
      fieldH: projectedBounds(battlefield.projection).height,
      viewportW: vw,
      viewportH: usableH,
      minZoom: 0.3,
      maxZoom: 3,
    };
  }

  // Camera setup: fit the field between the HUD bands, then keep the vertical offset so the
  // field sits centered in the usable strip (not hidden behind the top bar).
  let cam: Camera = fitCamera(camOpts());
  let camYOffset = 0;
  let cameraViewportW = 0;
  let cameraViewportH = 0;

  function recomputeCamera(): void {
    const opts = camOpts();
    cam = fitCamera(opts);
    camYOffset = (TOP_BAND - bottomBandHeight()) / 2;
    cameraViewportW = app.renderer.width;
    cameraViewportH = app.renderer.height;
  }
  recomputeCamera();
  const onResize = (): void => recomputeCamera();
  window.addEventListener('resize', onResize);

  let dragging = false;
  let dragStart = { x: 0, y: 0, camX: 0, camY: 0 };
  const canvas = app.canvas;

  function isOverHud(x: number, y: number): boolean {
    return y < TOP_BAND || y > app.renderer.height - bottomBandHeight();
  }

  const detachDrag = bindDragEvents(canvas, window, {
    down: (e) => {
      if (isOverHud(e.offsetX, e.offsetY)) return;
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
    },
    move: (e) => {
      if (!dragging) return;
      const dx = (e.clientX - dragStart.x) / cam.zoom;
      const dy = (e.clientY - dragStart.y) / cam.zoom;
      cam = clampCamera({ x: dragStart.camX - dx, y: dragStart.camY - dy, zoom: cam.zoom }, camOpts());
    },
    end: () => { dragging = false; },
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (isOverHud(e.offsetX, e.offsetY)) return;
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
    onFrame: (w, alpha, elapsedS) => {
      const vw = app.renderer.width;
      const vh = app.renderer.height;
      if (vw !== cameraViewportW || vh !== cameraViewportH) recomputeCamera();
      redrawVignette(vw, vh);
      battlefield.render(w, cam, alpha, vw, vh, elapsedS, selection.selectedSlots());
      battlefield.world2screen.position.y += camYOffset;
      hud.layout(vw, vh);
      hud.update(w, selection.selectedSlots());

      if (w.phase === 'duel') {
        const gL = w.ents.x[w.generals[0].entity]!;
        const gR = w.ents.x[w.generals[1].entity]!;
        const left = projectGround(battlefield.projection, gL, w.ents.y[w.generals[0].entity]!);
        const right = projectGround(battlefield.projection, gR, w.ents.y[w.generals[1].entity]!);
        const midX = (left[0] + right[0]) / 2;
        const midY = (left[1] + right[1]) / 2;
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

  let destroyed = false;
  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loopHandle.stop();
      detachInput();
      detachDrag();
      window.removeEventListener('resize', onResize);
      battlefield.destroy();
      app.destroy(true, { children: true });
    },
  };
};

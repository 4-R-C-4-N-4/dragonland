// Battle view entry point (implementation.md §2.9-2.11, contract in src/battle/types.ts).
import { Application, Graphics, Sprite } from 'pixi.js';
import { createBattle, issueCommand, issueApproach, fireSpecial, setPaused } from '../sim';
import type { BattleView, BattleViewOptions, StartBattleView } from './types';
import { loadBiomePlate, fitPlate } from '../render/biomePlate';
import { createAiController } from '../ai/policy';
import { startLoop } from './loop';
import { Battlefield } from '../render/battlefield';
import { projectGround, projectedBounds } from '../render/projection';
import { Hud } from '../render/hud';
import { Selection } from './selection';
import { bindDragEvents } from './pointerInput';
import { attachInput } from './input';
import { createQuitDialog } from './quitDialog';
import { fitCamera, clampCamera, clampZoom, duelCamera } from './camera';
import type { Camera } from './camera';
import { resolveBattleColors } from '../render/colorUi';
import { DEFAULT_PLAYER_COLOR, DEFAULT_ENEMY_COLOR } from '../data/colors';

/** Battle speed chosen last (F / speed button), carried into the next battle this session. */
let lastSpeed: 1 | 2 = 1;

export const startBattleView: StartBattleView = async (root, opts) => {
  const { data, setup, labels, onFinished } = opts;
  const world = createBattle(data, setup);
  const ai = createAiController(data, 1);
  let finished = false;
  let destroyed = false;
  let quitDialog: ReturnType<typeof createQuitDialog> | undefined;
  const blocked = () => destroyed || finished || !!world.result || !!quitDialog?.isOpen();
  const sideColors = resolveBattleColors(setup, DEFAULT_PLAYER_COLOR, DEFAULT_ENEMY_COLOR);

  // Startup can fail before a handle reaches the caller. Register each acquired resource
  // immediately, and release all of them even if an individual cleanup throws.
  const cleanups: (() => void)[] = [];
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    let failed = false;
    let failure: unknown;
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
    cleanups.length = 0;
    if (failed) throw failure;
  }

  const app = new Application();
  cleanups.push(() => {
    // Pixi's canvas getter and Application.destroy require a renderer; init may
    // reject before creating one, leaving only the stage to release.
    const canvas = app.renderer ? app.canvas : undefined;
    try {
      if (app.renderer) app.destroy(true, { children: true });
      else app.stage.destroy({ children: true });
    } finally {
      if (canvas && root.contains(canvas)) canvas.remove();
    }
  });
  try {
    await app.init({ resizeTo: root, antialias: true, background: '#1a2a1a' });
    // Block, not inline: an inline canvas adds line-height below itself and overflows its host.
    app.canvas.style.display = 'block';
    root.appendChild(app.canvas);

    // Biome backdrop sits behind the field. Decoration only: failure is ignored.
    let plate: Sprite | null = null;
    if (opts.biome) {
      const texture = await loadBiomePlate(opts.biome);
      if (destroyed) throw new Error('Battle view destroyed during startup');
      if (texture) {
        plate = new Sprite(texture);
        app.stage.addChild(plate);
        fitPlate(plate, texture, app.renderer.width, app.renderer.height);
        cleanups.push(() => { plate?.destroy(); plate = null; });
      }
    }

    const battlefield = new Battlefield(app.renderer, data, data.constants.FIELD_W, data.constants.FIELD_H, sideColors);
    cleanups.push(() => battlefield.destroy());
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

    if (opts.onQuit) quitDialog = createQuitDialog(root, world, {
      message: opts.quitMessage, confirmLabel: opts.quitConfirmLabel,
      onQuit: () => {
        if (destroyed || finished || world.result) return;
        opts.onQuit!(world);
        finished = true;
      },
    });
    if (quitDialog) cleanups.push(() => quitDialog!.destroy());
    const selection = new Selection(data.constants.MAX_SQUADS);
    const hud = new Hud(data, labels, sideColors, {
      onSelectSquad: (slot, additive) => { if (!blocked()) additive ? selection.toggle(slot) : selection.selectOnly(slot); },
      onSelectAll: () => { if (!blocked()) selection.selectAll(); },
      onCommand: (cmd) => {
        if (blocked()) return;
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
        if (blocked()) return;
        const sel = selection.selectedSlots();
        if (sel === 'all') issueApproach(world, 0, 'all', approach);
        else for (const slot of sel) {
          const sq = world.squads.find((s) => s.side === 0 && s.slot === slot);
          if (sq) issueApproach(world, 0, sq.id, approach);
        }
      },
      onSpecial: () => { if (!blocked()) fireSpecial(world, 0); },
      onPauseToggle: () => { if (!blocked()) setPaused(world, !world.paused); },
      onQuit: quitDialog?.open,
      onSpeedToggle: () => {
        if (blocked()) return;
        const next = loopHandle.getSpeed() === 1 ? 2 : 1;
        loopHandle.setSpeed(next);
        hud.setSpeedLabel(next);
        lastSpeed = next;
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
    cleanups.push(() => window.removeEventListener('resize', onResize));

    let dragging = false;
    let dragStart = { x: 0, y: 0, camX: 0, camY: 0 };
    const canvas = app.canvas;

    function isOverHud(x: number, y: number): boolean {
      return y < TOP_BAND || y > app.renderer.height - bottomBandHeight();
    }

    const detachDrag = bindDragEvents(canvas, window, {
      down: (e) => {
        if (blocked() || isOverHud(e.offsetX, e.offsetY)) return;
        dragging = true;
        dragStart = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
      },
      move: (e) => {
        if (blocked() || !dragging) return;
        const dx = (e.clientX - dragStart.x) / cam.zoom;
        const dy = (e.clientY - dragStart.y) / cam.zoom;
        cam = clampCamera({ x: dragStart.camX - dx, y: dragStart.camY - dy, zoom: cam.zoom }, camOpts());
      },
      end: () => { dragging = false; },
    });
    cleanups.push(detachDrag);
    const onWheel = (e: WheelEvent): void => {
      if (blocked() || isOverHud(e.offsetX, e.offsetY)) return;
      e.preventDefault();
      const zoom = clampZoom(cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9), camOpts());
      cam = clampCamera({ ...cam, zoom }, camOpts());
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    cleanups.push(() => canvas.removeEventListener('wheel', onWheel));

    const detachInput = attachInput(window.document, world, selection, {
      isBlocked: blocked,
      onQuit: quitDialog?.open,
      onSpeedToggle: () => {
        if (blocked()) return;
        const next = loopHandle.getSpeed() === 1 ? 2 : 1;
        loopHandle.setSpeed(next);
        hud.setSpeedLabel(next);
        lastSpeed = next;
      },
    });

    cleanups.push(detachInput);

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
        if (plate) fitPlate(plate, plate.texture, vw, vh);
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
          cam = duelCamera([left[0], left[1]], [right[0], right[1]], camOpts());
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
    // Keep the speed the player last chose for the next battle in this session.
    if (lastSpeed === 2) { loopHandle.setSpeed(2); hud.setSpeedLabel(2); }

    cleanups.push(() => loopHandle.stop());
    return { destroy };
  } catch (error) {
    try { destroy(); } catch { /* Preserve the startup error if cleanup also fails. */ }
    throw error;
  }
};

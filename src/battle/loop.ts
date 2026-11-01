// Fixed-step game loop (implementation.md §2.9). Drives sim ticks from requestAnimationFrame,
// accumulates wall time, supports 1x/2x speed and pause, exposes interpolation alpha + perf stats.
import type { GameData } from '../data';
import { step, setPaused } from '../sim';
import type { World } from '../sim';
import type { AiController } from '../ai/policy';

export interface LoopStats {
  fps: number;
  tickMs: number;
}

export interface LoopHandle {
  stop(): void;
  setSpeed(mult: 1 | 2): void;
  getSpeed(): 1 | 2;
  getAlpha(): number;
  getStats(): LoopStats;
}

const MAX_TICKS_PER_FRAME = 8;

export interface LoopOptions {
  world: World;
  data: GameData;
  ai: AiController;
  onTick?: (world: World) => void;
  onFrame?: (world: World, alpha: number) => void;
  resultShownCb?: (world: World) => void;
}

export function startLoop(opts: LoopOptions): LoopHandle {
  const { world, ai } = opts;
  const dt = 1 / opts.data.constants.SIM_HZ;
  let speed: 1 | 2 = 1;
  let acc = 0;
  let last = performance.now();
  let alpha = 0;
  let stopped = false;
  let rafId = 0;

  let fps = 0;
  let tickMs = 0;
  let frameCount = 0;
  let frameAccum = 0;

  function frame(now: number): void {
    if (stopped) return;
    const frameDt = Math.min(0.1, (now - last) / 1000);
    last = now;

    frameAccum += frameDt;
    frameCount++;
    if (frameAccum >= 0.5) {
      fps = frameCount / frameAccum;
      frameCount = 0;
      frameAccum = 0;
    }

    if (!world.paused) {
      acc += frameDt * speed;
      let ticks = 0;
      const t0 = performance.now();
      while (acc >= dt && ticks < MAX_TICKS_PER_FRAME) {
        ai.update(world);
        step(world);
        opts.onTick?.(world);
        acc -= dt;
        ticks++;
      }
      if (ticks > 0) tickMs = (performance.now() - t0) / ticks;
      if (acc > dt) acc = dt; // drop overflow to avoid spiral of death
      alpha = acc / dt;
    } else {
      alpha = 1;
    }

    opts.onFrame?.(world, alpha);
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return {
    stop(): void {
      stopped = true;
      cancelAnimationFrame(rafId);
    },
    setSpeed(mult: 1 | 2): void {
      speed = mult;
    },
    getSpeed(): 1 | 2 {
      return speed;
    },
    getAlpha(): number {
      return alpha;
    },
    getStats(): LoopStats {
      return { fps, tickMs };
    },
  };
}

export function togglePause(world: World): void {
  setPaused(world, !world.paused);
}

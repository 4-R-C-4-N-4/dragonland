// Battlefield renderer: ground plane, per-entity sprites (placeholder + sheet swap-in),
// camera transform, depth sort, cosmetic FX (hit flash, projectiles, specials, damage numbers).
import { AnimatedSprite, Container, Graphics, Rectangle, Sprite, Text, Texture, type Renderer } from 'pixi.js';
import type { GameData } from '../data';
import type { World } from '../sim';
import type { Camera } from '../battle/camera';
import { lerp, pickAnimation } from '../battle/helpers';
import { worldToScreen } from '../battle/camera';
import { buildPlaceholderTextures, placeholderKey } from './placeholder';
import { discoverSheets, type AnimationName, type ParsedSheet } from './spriteSheets';
import { getDebugState } from '../debug/state';

export const Y_SQUASH = 0.6;

interface EntitySprite {
  container: Container;
  body: Sprite | AnimatedSprite;
  shadow: Graphics;
  usesSheet: boolean;
  anim: AnimationName | null;
  lastHp: number;
  hitFlashT: number;
  attackFlashT: number;
  dying: boolean;
  deathT: number;
}

export class Battlefield {
  readonly world2screen: Container = new Container(); // camera-transformed world content
  readonly ground: Graphics = new Graphics();
  readonly ents: Container = new Container();
  readonly fx: Container = new Container();
  readonly debugLayer: Container = new Container();
  readonly squadLayer: Container = new Container();

  private placeholders: Map<string, Texture>;
  private sheets: Map<string, ParsedSheet>;
  private sheetTextures = new Map<string, Record<AnimationName, Texture[]>>();
  private sprites: (EntitySprite | undefined)[] = [];
  private damageNumbers: { text: Text; t: number; vy: number }[] = [];

  constructor(
    private renderer: Renderer,
    private data: GameData,
    private fieldW: number,
    private fieldH: number,
  ) {
    this.placeholders = buildPlaceholderTextures(renderer, data);
    this.sheets = discoverSheets((msg) => console.warn(msg));
    this.world2screen.addChild(this.ground, this.ents, this.fx, this.squadLayer, this.debugLayer);
    this.ents.sortableChildren = true;
    this.drawGround();
  }

  private drawGround(): void {
    const g = this.ground;
    g.clear();
    g.rect(0, 0, this.fieldW, this.fieldH * Y_SQUASH);
    g.fill({ color: 0x3b5c2e });
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      const y = (i / stripes) * this.fieldH * Y_SQUASH;
      g.rect(0, y, this.fieldW, 1);
      g.fill({ color: 0x000000, alpha: 0.05 });
    }
  }

  private sheetTexturesFor(sheet: ParsedSheet): Record<AnimationName, Texture[]> {
    const cached = this.sheetTextures.get(sheet.unitId);
    if (cached) return cached;
    const baseTex = Texture.from(sheet.imageUrl);
    const out = {} as Record<AnimationName, Texture[]>;
    for (const [name, anim] of Object.entries(sheet.animations) as [AnimationName, ParsedSheet['animations'][AnimationName]][]) {
      out[name] = anim.frames.map((f) => new Texture({ source: baseTex.source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
    }
    this.sheetTextures.set(sheet.unitId, out);
    return out;
  }

  private makeEntitySprite(unitId: string, side: 0 | 1, isGeneral: boolean, isFlying: boolean): EntitySprite {
    const container = new Container();
    const shadow = new Graphics();
    if (isFlying) {
      shadow.ellipse(0, 10, isGeneral ? 14 : 7, isGeneral ? 5 : 3).fill({ color: 0x000000, alpha: 0.3 });
    }
    const sheet = this.sheets.get(unitId);
    let body: Sprite | AnimatedSprite;
    let usesSheet = false;
    if (sheet) {
      const frames = this.sheetTexturesFor(sheet);
      body = new AnimatedSprite(frames.idle);
      (body as AnimatedSprite).animationSpeed = 0.15;
      (body as AnimatedSprite).loop = true;
      (body as AnimatedSprite).play();
      body.anchor.set(0.5, 1);
      const scale = (isGeneral ? 40 : 20) / Math.max(sheet.frameW, sheet.frameH);
      body.scale.set(scale);
      usesSheet = true;
    } else {
      const tex = this.placeholders.get(placeholderKey(unitId, side)) ?? Texture.WHITE;
      body = new Sprite(tex);
      body.anchor.set(0.5, 0.5);
    }
    if (isFlying) body.y -= isGeneral ? 20 : 10;
    container.addChild(shadow, body);
    return { container, body, shadow, usesSheet, anim: usesSheet ? 'idle' : null, lastHp: -1, hitFlashT: 0, attackFlashT: 0, dying: false, deathT: 0 };
  }

  /** Call once before the loop starts (after world is created) to build sprite pool. */
  ensureSprites(world: World): void {
    const ents = world.ents;
    this.sprites.length = ents.count;
    for (let i = 0; i < ents.count; i++) {
      if (this.sprites[i]) continue;
      const unitIdx = ents.unit[i]!;
      const internalUnitId = this.data.units[unitIdx]?.id ?? '';
      const unitDef = this.data.unitById.get(internalUnitId);
      const sprite = this.makeEntitySprite(internalUnitId, ents.side[i] as 0 | 1, ents.isGeneral[i] === 1, unitDef?.flying ?? false);
      this.sprites[i] = sprite;
      this.ents.addChild(sprite.container);
    }
  }

  setAnim(sprite: EntitySprite, name: AnimationName, sheet: ParsedSheet): void {
    if (!sprite.usesSheet || sprite.anim === name) return;
    const body = sprite.body as AnimatedSprite;
    const frames = this.sheetTexturesFor(sheet);
    body.textures = frames[name];
    body.loop = sheet.animations[name].loop;
    body.gotoAndPlay(0);
    sprite.anim = name;
  }

  /** Per-frame render update: interpolated positions, FX timers, depth sort. dt = wall seconds since last frame. */
  render(world: World, cam: Camera, alpha: number, viewportW: number, viewportH: number, dt: number): void {
    this.world2screen.position.set(viewportW / 2, viewportH / 2);
    this.world2screen.scale.set(cam.zoom);
    this.world2screen.pivot.set(cam.x, cam.y * Y_SQUASH);

    const ents = world.ents;
    for (let i = 0; i < ents.count; i++) {
      const sp = this.sprites[i];
      if (!sp) continue;
      if (ents.alive[i] === 0) {
        if (!sp.dying) {
          sp.dying = true;
          sp.deathT = 0;
        }
        sp.deathT += dt;
        const fade = Math.max(0, 1 - sp.deathT / 1.2);
        sp.container.alpha = fade;
        sp.container.scale.set(fade);
        if (fade <= 0) sp.container.visible = false;
      }
      const x = lerp(ents.prevX[i]!, ents.x[i]!, sp.dying ? 1 : alpha);
      const y = lerp(ents.prevY[i]!, ents.y[i]!, sp.dying ? 1 : alpha);
      const [sx, sy] = [x, y * Y_SQUASH];
      sp.container.position.set(sx, sy);
      sp.container.zIndex = y;

      if (sp.hitFlashT > 0) {
        sp.hitFlashT -= dt;
        sp.body.tint = 0xff8080;
      } else if (sp.attackFlashT > 0) {
        sp.attackFlashT -= dt;
        sp.body.tint = 0xffffff;
      } else {
        sp.body.tint = 0xffffff;
      }
      if (sp.usesSheet) {
        const speed = Math.hypot(ents.vx[i]!, ents.vy[i]!);
        const unitIdx = ents.unit[i]!;
        const unitId = this.data.units[unitIdx]?.id ?? '';
        const sheet = this.sheets.get(unitId);
        if (sheet && !sp.dying) {
          const anim = pickAnimation({ alive: true, speed, recentAttack: sp.attackFlashT > 0, recentHit: sp.hitFlashT > 0, dying: false });
          this.setAnim(sp, anim, sheet);
        } else if (sheet && sp.dying) {
          this.setAnim(sp, 'death', sheet);
        }
      }
    }

    // Damage numbers.
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i]!;
      d.t += dt;
      d.text.y -= d.vy * dt;
      d.text.alpha = Math.max(0, 1 - d.t / 1.0);
      if (d.t > 1.0) {
        d.text.destroy();
        this.damageNumbers.splice(i, 1);
      }
    }

    if (getDebugState().overlay) this.renderDebug(world, alpha);
    else this.debugLayer.removeChildren();
  }

  /** Apply one tick's sim events for cosmetic effects: flashes, projectiles, special FX, damage numbers. */
  applyEvents(world: World): void {
    for (const ev of world.events) {
      if (ev.type === 'hit') {
        const targetSp = this.sprites[ev.target];
        if (targetSp) targetSp.hitFlashT = 0.15;
        const attackerSp = this.sprites[ev.attacker];
        if (attackerSp) attackerSp.attackFlashT = 0.15;
        if (ev.ranged) this.spawnProjectile(world, ev.attacker, ev.target);
        this.spawnDamageNumber(world, ev.target, ev.amount);
      } else if (ev.type === 'special') {
        this.spawnSpecialFx(ev.x, ev.y, ev.radius, ev.kind, ev.dirX, ev.dirY);
      } else if (ev.type === 'duelBlow') {
        const side = ev.attacker;
        const g = world.generals[side === 0 ? 1 : 0];
        this.spawnDamageNumber(world, g.entity, ev.amount);
      }
    }
  }

  private spawnProjectile(world: World, from: number, to: number): void {
    const ents = world.ents;
    const g = new Graphics();
    g.circle(0, 0, 3).fill({ color: 0xffe066 });
    g.position.set(ents.x[from]!, ents.y[from]! * Y_SQUASH);
    this.fx.addChild(g);
    const targetX = ents.x[to]!;
    const targetY = ents.y[to]! * Y_SQUASH;
    let t = 0;
    const dur = 0.15;
    const startX = g.x;
    const startY = g.y;
    const tick = (): void => {
      t += 1 / 60;
      const a = Math.min(1, t / dur);
      g.position.set(lerp(startX, targetX, a), lerp(startY, targetY, a));
      if (a >= 1) {
        g.destroy();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }

  private spawnSpecialFx(x: number, y: number, radius: number, kind: string, dirX: number, dirY: number): void {
    const g = new Graphics();
    if (kind === 'cone') {
      const angle = Math.atan2(dirY, dirX);
      const half = (35 * Math.PI) / 180;
      g.moveTo(0, 0);
      g.arc(0, 0, radius, angle - half, angle + half);
      g.lineTo(0, 0);
      g.fill({ color: 0xffa500, alpha: 0.35 });
    } else {
      g.circle(0, 0, radius).fill({ color: kind === 'radiusHeal' ? 0x66ff99 : 0xff6666, alpha: 0.3 });
    }
    g.position.set(x, y * Y_SQUASH);
    this.fx.addChild(g);
    let t = 0;
    const tick = (): void => {
      t += 1 / 60;
      g.alpha = Math.max(0, 0.35 - t * 0.5);
      if (t > 0.7) g.destroy();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private spawnDamageNumber(world: World, entity: number, amount: number): void {
    const ents = world.ents;
    const text = new Text({ text: Math.round(amount).toString(), style: { fill: 0xffee88, fontSize: 12, fontWeight: 'bold' } });
    text.anchor.set(0.5);
    text.position.set(ents.x[entity]!, ents.y[entity]! * Y_SQUASH - 16);
    this.fx.addChild(text);
    this.damageNumbers.push({ text, t: 0, vy: 20 });
  }

  private renderDebug(world: World, _alpha: number): void {
    this.debugLayer.removeChildren();
    const g = new Graphics();
    const cell = this.data.constants.GRID_CELL;
    for (let x = 0; x <= this.fieldW; x += cell) {
      g.moveTo(x, 0).lineTo(x, this.fieldH * Y_SQUASH);
    }
    for (let y = 0; y <= this.fieldH; y += cell) {
      g.moveTo(0, y * Y_SQUASH).lineTo(this.fieldW, y * Y_SQUASH);
    }
    g.stroke({ color: 0x00ffff, width: 1, alpha: 0.15 });
    this.debugLayer.addChild(g);

    const ents = world.ents;
    const lines = new Graphics();
    for (let i = 0; i < ents.count; i++) {
      if (ents.alive[i] === 0) continue;
      const target = ents.target[i]!;
      if (target >= 0 && ents.alive[target] === 1) {
        lines.moveTo(ents.x[i]!, ents.y[i]! * Y_SQUASH).lineTo(ents.x[target]!, ents.y[target]! * Y_SQUASH);
      }
    }
    lines.stroke({ color: 0xff00ff, width: 1, alpha: 0.25 });
    this.debugLayer.addChild(lines);

    for (const sq of world.squads) {
      const label = new Text({
        text: `${sq.name} [${sq.disposition}/${sq.command}] ${sq.alive}/${sq.total}`,
        style: { fill: 0xffffff, fontSize: 10 },
      });
      label.anchor.set(0.5, 1);
      label.position.set(sq.centroidX, sq.centroidY * Y_SQUASH - 30);
      this.debugLayer.addChild(label);
    }
  }

  destroy(): void {
    for (const sp of this.sprites) sp?.container.destroy();
    this.world2screen.destroy({ children: true });
  }
}

export function worldPointToScreen(wx: number, wy: number, cam: Camera, viewportW: number, viewportH: number): [number, number] {
  return worldToScreen(wx, wy * Y_SQUASH, cam, viewportW, viewportH);
}

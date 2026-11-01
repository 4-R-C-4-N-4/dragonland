// Battlefield renderer: ground plane, per-entity sprites (placeholder + sheet swap-in),
// camera transform, depth sort, cosmetic FX (hit flash, projectiles, specials, damage numbers),
// per-squad banners + per-troop squad markers (implementation.md §7.3).
//
// Colour identity (designer feedback: "wouldn't know at a glance whose squad is whose"):
// every troop gets a squad-coloured ground disc + squad-coloured outline/halo, plus a thin
// team-coloured rim; generals get a big team-coloured banner + team-coloured ground ring; squad
// banners use squad colour with a team-coloured border, and player vs enemy banners use different
// SHAPES so sides stay distinguishable even with close colour picks.
import {
  AnimatedSprite,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TilingSprite,
  type Renderer,
} from 'pixi.js';
import type { GameData } from '../data';
import type { Command, Disposition } from '../data/schemas';
import type { World, SquadState, Side } from '../sim';
import type { Camera } from '../battle/camera';
import { lerp, pickAnimation } from '../battle/helpers';
import { worldToScreen } from '../battle/camera';
import { buildPlaceholderTextures, type UnitPlaceholder } from './placeholder';
import { discoverSheets, type AnimationName, type ParsedSheet } from './spriteSheets';
import { getDebugState } from '../debug/state';
import type { FrameObject } from 'pixi.js';

interface SheetLayers {
  body: Record<AnimationName, FrameObject[]>;
  cloth: Record<AnimationName, FrameObject[]> | null;
  outline: Record<AnimationName, FrameObject[]> | null;
}

/**
 * White silhouette dilated by 1px (8-neighbourhood) of a loaded sheet image, for a tintable outline.
 * Returns null outside the browser or if the image resource isn't drawable.
 */
function outlineSourceFor(base: Texture): Texture['source'] | null {
  const res = base.source.resource as CanvasImageSource | undefined;
  if (typeof document === 'undefined' || !res) return null;
  const w = base.source.width, h = base.source.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) g.drawImage(res, dx, dy);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t.source;
}
import { squadColorNumberFor, teamColorNumber, contrastMono, type SideColors } from './colorUi';

export const Y_SQUASH = 0.65;

interface EntitySprite {
  container: Container;
  body: Sprite | AnimatedSprite;
  shadow: Graphics;
  ground: Sprite; // thin team-colour rim under the troop
  disc: Sprite; // squad-colour disc under the troop, inside the rim
  halo: Sprite | AnimatedSprite | null; // squad-colour outline/silhouette behind the body
  cloth: AnimatedSprite | null; // art-pass team-cloth mask layer, tinted squad colour
  selOuter: Sprite; // selection double-ring, outer (white)
  selInner: Sprite; // selection double-ring, inner (black)
  usesSheet: boolean;
  anim: AnimationName | null;
  lastHp: number;
  hitFlashT: number;
  attackFlashT: number;
  lungeT: number;
  dying: boolean;
  deathT: number;
  squadIdx: number;
  side: Side;
}

interface SquadBanner {
  root: Container;
  border: Sprite;
  flag: Sprite;
  number: Text;
  glyph: Sprite;
  dispo: Sprite;
  cmd: Sprite;
  lastDispo: Disposition | null;
  lastCommand: Command | null;
}

export type SelectedSlots = number[] | 'all';

export class Battlefield {
  readonly world2screen: Container = new Container(); // camera-transformed world content
  readonly ground: Container = new Container();
  readonly ents: Container = new Container();
  readonly fx: Container = new Container();
  readonly debugLayer: Container = new Container();
  readonly squadLayer: Container = new Container();

  private placeholders: Map<string, UnitPlaceholder>;
  private sheets: Map<string, ParsedSheet>;
  private sheetTextures = new Map<string, SheetLayers>();
  private sprites: (EntitySprite | undefined)[] = [];
  private damageNumbers: { text: Text; t: number; vy: number }[] = [];
  private squadBanners = new Map<string, SquadBanner>();

  private genericDisc: Texture; // generic ellipse, used for the ground rim/disc under every troop
  private dispoTex: Record<Disposition, Texture>;
  private cmdTex: Record<Command, Texture>;
  private squareFlagTex: Texture; // player squad-banner shape
  private pennantFlagTex: Texture; // enemy squad-banner shape
  private generalBannerTex: Texture;
  private generalRingTex: Texture;

  private onSquadClick?: (slot: number, additive: boolean) => void;

  constructor(
    private renderer: Renderer,
    private data: GameData,
    private fieldW: number,
    private fieldH: number,
    private sideColors: [SideColors, SideColors],
  ) {
    this.placeholders = buildPlaceholderTextures(renderer, data);
    this.sheets = discoverSheets((msg) => console.warn(msg));
    this.genericDisc = this.bakeEllipseTexture(1, 1);
    this.dispoTex = this.bakeDispoTextures();
    this.cmdTex = this.bakeCmdTextures();
    this.squareFlagTex = this.bakeSquareFlagTexture();
    this.pennantFlagTex = this.bakePennantFlagTexture();
    this.generalBannerTex = this.bakeGeneralBannerTexture();
    this.generalRingTex = this.bakeEllipseRingTexture(26, 10, 3);
    this.world2screen.addChild(this.ground, this.ents, this.fx, this.squadLayer, this.debugLayer);
    this.ents.sortableChildren = true;
    this.drawGround();
  }

  setSquadClickHandler(fn: (slot: number, additive: boolean) => void): void {
    this.onSquadClick = fn;
  }

  private teamColor(side: Side): number {
    return teamColorNumber(this.sideColors[side]);
  }

  private squadColor(side: Side, slot: number): number {
    return squadColorNumberFor(this.sideColors[side], slot);
  }

  // ---------- baked textures (colour-agnostic; tinted per-entity at runtime) ----------

  private bakeEllipseTexture(rx: number, ry: number): Texture {
    const g = new Graphics();
    g.ellipse(0, 0, rx, ry).fill({ color: 0xffffff });
    const tex = this.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  private bakeEllipseRingTexture(rx: number, ry: number, width: number): Texture {
    const g = new Graphics();
    g.ellipse(0, 0, rx, ry).stroke({ color: 0xffffff, width });
    const tex = this.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  private bakeDispoTextures(): Record<Disposition, Texture> {
    const mk = (draw: (g: Graphics) => void): Texture => {
      const g = new Graphics();
      draw(g);
      const tex = this.renderer.generateTexture(g);
      g.destroy();
      return tex;
    };
    return {
      fierce: mk((g) => {
        g.poly([0, -6, 5, 5, -5, 5]).fill({ color: 0xffffff });
      }),
      guard: mk((g) => {
        g.poly([0, -6, 5, -3, 5, 3, 0, 6, -5, 3, -5, -3]).fill({ color: 0xffffff });
      }),
      mixed: mk((g) => {
        g.poly([0, -6, 5, 0, 0, 6, -5, 0]).fill({ color: 0xffffff });
      }),
    };
  }

  private bakeCmdTextures(): Record<Command, Texture> {
    const mk = (draw: (g: Graphics) => void): Texture => {
      const g = new Graphics();
      draw(g);
      const tex = this.renderer.generateTexture(g);
      g.destroy();
      return tex;
    };
    return {
      advance: mk((g) => {
        g.poly([-4, -5, 4, 0, -4, 5]).fill({ color: 0xffffff });
      }),
      hold: mk((g) => {
        g.rect(-4, -4, 8, 8).fill({ color: 0xffffff });
      }),
      fallBack: mk((g) => {
        g.poly([4, -5, -4, 0, 4, 5]).fill({ color: 0xffffff });
      }),
    };
  }

  /** Player squad banner: a square flag (distinguishes it by shape from the enemy's pennant). */
  private bakeSquareFlagTexture(): Texture {
    const g = new Graphics();
    g.rect(-1, -18, 2, 22).fill({ color: 0xffffff });
    g.rect(1, -18, 15, 14).fill({ color: 0xffffff, alpha: 0.95 });
    const tex = this.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  /** Enemy squad banner: a swallowtail pennant. */
  private bakePennantFlagTexture(): Texture {
    const g = new Graphics();
    g.rect(-1, -18, 2, 22).fill({ color: 0xffffff });
    g.poly([1, -18, 1, -4, 8, -8, 15, -4, 15, -18]).fill({ color: 0xffffff, alpha: 0.95 });
    const tex = this.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  private bakeGeneralBannerTexture(): Texture {
    const g = new Graphics();
    g.rect(-2, -34, 4, 36).fill({ color: 0xffffff });
    g.poly([2, -34, 2, -10, 26, -22]).fill({ color: 0xffffff, alpha: 0.95 });
    const tex = this.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  private drawGround(): void {
    this.ground.removeChildren();
    const g = new Graphics();
    g.rect(0, 0, this.fieldW, this.fieldH * Y_SQUASH).fill({ color: 0x3b5c2e });
    const base = this.renderer.generateTexture(g);
    g.destroy();
    this.ground.addChild(new Sprite(base));

    // Baked grass-tuft/noise tile, tiled across the field for cheap ground detail.
    const tileSize = 96;
    const tg = new Graphics();
    let s = 1234567;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return (s % 10000) / 10000;
    };
    for (let i = 0; i < 26; i++) {
      const x = rnd() * tileSize;
      const y = rnd() * tileSize;
      const shade = rnd() > 0.5 ? 0x2f4a24 : 0x4a6c3a;
      tg.rect(x, y, 2, 2).fill({ color: shade, alpha: 0.5 });
    }
    for (let i = 0; i < 6; i++) {
      const x = rnd() * tileSize;
      const y = rnd() * tileSize;
      tg.moveTo(x, y).lineTo(x - 1, y - 5);
      tg.moveTo(x + 2, y).lineTo(x + 1, y - 4);
    }
    tg.stroke({ color: 0x5a7a44, width: 1, alpha: 0.35 });
    const tileTex = this.renderer.generateTexture(tg);
    tg.destroy();
    const tiling = new TilingSprite({ texture: tileTex, width: this.fieldW, height: this.fieldH * Y_SQUASH });
    this.ground.addChild(tiling);

    // Darker edge frame so the field reads as a bounded ground plane.
    const edge = new Graphics();
    const w = this.fieldW;
    const h = this.fieldH * Y_SQUASH;
    const t = 18;
    edge.rect(0, 0, w, t).fill({ color: 0x000000, alpha: 0.22 });
    edge.rect(0, h - t, w, t).fill({ color: 0x000000, alpha: 0.22 });
    edge.rect(0, 0, t, h).fill({ color: 0x000000, alpha: 0.2 });
    edge.rect(w - t, 0, t, h).fill({ color: 0x000000, alpha: 0.2 });
    this.ground.addChild(edge);
  }

  /** Frame lists (with per-frame durations) for body, team-cloth mask and outline layers. */
  private sheetTexturesFor(sheet: ParsedSheet): SheetLayers {
    const cached = this.sheetTextures.get(sheet.unitId);
    if (cached) return cached;
    // Pixi v8: Texture.from(url) only works for already-loaded assets; preloadSheetImages() runs first.
    const baseTex = Assets.get<Texture>(sheet.imageUrl);
    if (!baseTex) throw new Error(`sprite sheet ${sheet.unitId}: image not preloaded`);
    baseTex.source.scaleMode = 'nearest'; // crisp pixel art
    const maskTex = sheet.maskUrl ? Assets.get<Texture>(sheet.maskUrl) : undefined;
    if (maskTex) maskTex.source.scaleMode = 'nearest';
    const outlineSource = outlineSourceFor(baseTex);
    const layer = (src: Texture['source']) => {
      const out = {} as Record<AnimationName, FrameObject[]>;
      for (const [name, anim] of Object.entries(sheet.animations) as [AnimationName, ParsedSheet['animations'][AnimationName]][]) {
        out[name] = anim.frames.map((f) => ({ texture: new Texture({ source: src, frame: new Rectangle(f.x, f.y, f.w, f.h) }), time: f.durationMs }));
      }
      return out;
    };
    const layers: SheetLayers = { body: layer(baseTex.source), cloth: maskTex ? layer(maskTex.source) : null, outline: outlineSource ? layer(outlineSource) : null };
    this.sheetTextures.set(sheet.unitId, layers);
    return layers;
  }

  /** Load every discovered sheet image; sheets whose image fails to load are dropped (placeholder kept). */
  async preloadSheetImages(): Promise<void> {
    for (const [unitId, sheet] of [...this.sheets]) {
      try {
        await Assets.load<Texture>(sheet.imageUrl);
        if (sheet.maskUrl) await Assets.load<Texture>(sheet.maskUrl).catch(() => console.warn(`sprite sheet ${unitId}: mask failed to load`));
      } catch (e) {
        console.warn(`sprite sheet ${unitId}: image failed to load, keeping placeholder`, e);
        this.sheets.delete(unitId);
      }
    }
  }

  private makeEntitySprite(unitId: string, side: Side, isGeneral: boolean, isFlying: boolean, squadIdx: number): EntitySprite {
    const container = new Container();
    const shadow = new Graphics();
    if (isFlying) {
      shadow.ellipse(0, 10, isGeneral ? 20 : 10, isGeneral ? 7 : 4).fill({ color: 0x000000, alpha: 0.3 });
    }

    const placeholder = this.placeholders.get(unitId);
    const sheet = this.sheets.get(unitId);
    const footY = isGeneral ? 2 : 1;
    const discRx = isGeneral ? 20 : sheet ? 13 : (placeholder?.baseR ?? 10) * 1.35;
    const discRy = discRx * 0.42;

    // Team-coloured rim (slightly larger, under everything) + squad-coloured disc on top of it.
    const ground = new Sprite(this.genericDisc);
    ground.anchor.set(0.5);
    ground.width = discRx * 2 * 1.22;
    ground.height = discRy * 2 * 1.22;
    ground.y = footY;
    ground.alpha = 0.55;

    const disc = new Sprite(this.genericDisc);
    disc.anchor.set(0.5);
    disc.width = discRx * 2;
    disc.height = discRy * 2;
    disc.y = footY;
    disc.alpha = 0.75;

    const selOuter = new Sprite(this.bakeEllipseRingTexture(discRx + 5, discRy + 2.2, 2.2));
    selOuter.anchor.set(0.5);
    selOuter.y = footY;
    selOuter.tint = 0xffffff;
    selOuter.visible = false;
    const selInner = new Sprite(this.bakeEllipseRingTexture(discRx + 3, discRy + 1.2, 1.6));
    selInner.anchor.set(0.5);
    selInner.y = footY;
    selInner.tint = 0x000000;
    selInner.visible = false;

    let body: Sprite | AnimatedSprite;
    let halo: Sprite | AnimatedSprite | null = null;
    let cloth: AnimatedSprite | null = null;
    let usesSheet = false;
    if (sheet) {
      // Sheets are produced at game-pixel scale by the art pipeline (art/sizes.yaml), so draw 1:1.
      const layers = this.sheetTexturesFor(sheet);
      const mk = (frames: FrameObject[]) => {
        const s = new AnimatedSprite(frames);
        s.loop = true;
        s.anchor.set(0.5, 1);
        s.y = footY + 1;
        s.play();
        return s;
      };
      body = mk(layers.body.idle);
      usesSheet = true;
      // Squad-colour outline: a white 1px-dilated silhouette layer behind the body, tinted.
      if (layers.outline) halo = mk(layers.outline.idle);
      // Team cloth (tabard, cape...) tinted with the squad colour on top of the body.
      if (layers.cloth) cloth = mk(layers.cloth.idle);
    } else {
      const tex = placeholder?.body ?? Texture.WHITE;
      body = new Sprite(tex);
      body.anchor.set(0.5, 0.5);
      if (placeholder) {
        const outlineSprite = new Sprite(placeholder.outline);
        outlineSprite.anchor.set(0.5);
        halo = outlineSprite;
      }
    }
    if (isFlying) {
      body.y -= isGeneral ? 28 : 14;
      if (halo) halo.y = body.y;
      if (cloth) cloth.y = body.y;
    }
    container.addChild(ground, selOuter, selInner, disc, shadow);
    if (halo) container.addChild(halo);
    container.addChild(body);
    if (cloth) container.addChild(cloth);
    return {
      container,
      body,
      cloth,
      shadow,
      ground,
      disc,
      halo,
      selOuter,
      selInner,
      usesSheet,
      anim: usesSheet ? 'idle' : null,
      lastHp: -1,
      hitFlashT: 0,
      attackFlashT: 0,
      lungeT: 0,
      dying: false,
      deathT: 0,
      squadIdx,
      side,
    };
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
      const side = ents.side[i] as Side;
      const sprite = this.makeEntitySprite(internalUnitId, side, ents.isGeneral[i] === 1, unitDef?.flying ?? false, ents.squad[i]!);
      const slot = sprite.squadIdx >= 0 ? world.squads[sprite.squadIdx]?.slot ?? 0 : 0;
      const squadTint = this.squadColor(side, slot);
      const teamTint = this.teamColor(side);
      sprite.disc.tint = squadTint;
      sprite.ground.tint = teamTint;
      if (sprite.halo) sprite.halo.tint = squadTint;
      if (sprite.cloth) sprite.cloth.tint = squadTint;
      if (ents.isGeneral[i] === 1) {
        // Generals: a large team-colour banner + a team-colour ground ring (not a squad disc).
        sprite.disc.tint = teamTint;
        sprite.disc.width = 40 * 2;
        sprite.disc.height = 40 * 2 * 0.42;
        sprite.disc.alpha = 0;
        sprite.ground.texture = this.generalRingTex;
        sprite.ground.width = this.generalRingTex.width;
        sprite.ground.height = this.generalRingTex.height;
        sprite.ground.anchor.set(0.5);
        sprite.ground.alpha = 0.9;
        sprite.ground.tint = teamTint;
        const banner = new Sprite(this.generalBannerTex);
        banner.anchor.set(0.5, 1);
        banner.tint = teamTint;
        banner.y = -(sprite.halo ? 20 : 24) - 2;
        sprite.container.addChild(banner);
      }
      this.sprites[i] = sprite;
      this.ents.addChild(sprite.container);
    }
  }

  setAnim(sprite: EntitySprite, name: AnimationName, sheet: ParsedSheet): void {
    if (!sprite.usesSheet || sprite.anim === name) return;
    const layers = this.sheetTexturesFor(sheet);
    const loop = sheet.animations[name].loop;
    const apply = (s: Sprite | AnimatedSprite | null, frames: Record<AnimationName, FrameObject[]> | null) => {
      if (!s || !frames || !(s instanceof AnimatedSprite)) return;
      s.textures = frames[name];
      s.loop = loop;
      s.gotoAndPlay(0);
    };
    apply(sprite.body, layers.body);
    apply(sprite.halo, layers.outline);
    apply(sprite.cloth, layers.cloth);
    sprite.anim = name;
  }

  /** Sheets are drawn facing right; mirror toward the current target / movement / enemy side. */
  private faceSheet(sp: EntitySprite, world: World, i: number): void {
    const ents = world.ents;
    const t = ents.target[i]!;
    let dir = ents.side[i] === 0 ? 1 : -1;
    if (t >= 0 && ents.alive[t]) dir = ents.x[t]! >= ents.x[i]! ? 1 : -1;
    else if (Math.abs(ents.vx[i]!) > 2) dir = ents.vx[i]! > 0 ? 1 : -1;
    for (const s of [sp.body, sp.halo, sp.cloth]) if (s) s.scale.x = Math.abs(s.scale.x) * dir;
  }

  /** Per-frame render update: interpolated positions, FX timers, depth sort, banners. */
  render(world: World, cam: Camera, alpha: number, viewportW: number, viewportH: number, dt: number, selected: SelectedSlots): void {
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
        sp.container.scale.set(fade, fade * 0.6 + 0.4); // small fall/flatten
        sp.selOuter.visible = false;
        sp.selInner.visible = false;
        if (fade <= 0) sp.container.visible = false;
      }
      const x = lerp(ents.prevX[i]!, ents.x[i]!, sp.dying ? 1 : alpha);
      const y = lerp(ents.prevY[i]!, ents.y[i]!, sp.dying ? 1 : alpha);
      let [sx, sy] = [x, y * Y_SQUASH];
      if (sp.lungeT > 0) {
        sp.lungeT -= dt;
        const t = Math.max(0, sp.lungeT) / 0.12;
        const dirx = ents.target[i]! >= 0 ? Math.sign((ents.x[ents.target[i]!] ?? x) - x) : 1;
        sx += dirx * 3 * Math.sin(t * Math.PI);
      }
      sp.container.position.set(sx, sy);
      sp.container.zIndex = y;

      if (!sp.dying) {
        const isSel = sp.squadIdx >= 0 && (selected === 'all' || (ents.side[i] === 0 && selected.includes(world.squads[sp.squadIdx]?.slot ?? -1)));
        const showSel = !ents.isGeneral[i] && ents.side[i] === 0 && isSel;
        sp.selOuter.visible = showSel;
        sp.selInner.visible = showSel;
      }

      if (sp.hitFlashT > 0) {
        sp.hitFlashT -= dt;
        sp.body.tint = 0xffffff;
        sp.body.alpha = 0.55 + 0.45 * (1 - sp.hitFlashT / 0.15);
      } else if (sp.attackFlashT > 0) {
        sp.attackFlashT -= dt;
        sp.body.tint = 0xffffff;
        sp.body.alpha = 1;
      } else {
        sp.body.tint = 0xffffff;
        sp.body.alpha = 1;
      }
      if (sp.usesSheet) {
        const speed = Math.hypot(ents.vx[i]!, ents.vy[i]!);
        const unitIdx = ents.unit[i]!;
        const unitId = this.data.units[unitIdx]?.id ?? '';
        const sheet = this.sheets.get(unitId);
        if (sheet && !sp.dying) {
          const anim = pickAnimation({ alive: true, speed, recentAttack: sp.attackFlashT > 0, recentHit: sp.hitFlashT > 0, dying: false });
          this.setAnim(sp, anim, sheet);
          this.faceSheet(sp, world, i);
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

    this.renderSquadBanners(world, selected);

    if (getDebugState().overlay) this.renderDebug(world, alpha);
    else this.debugLayer.removeChildren();
  }

  private renderSquadBanners(world: World, selected: SelectedSlots): void {
    const seen = new Set<string>();
    for (const sq of world.squads) {
      seen.add(sq.id);
      let b = this.squadBanners.get(sq.id);
      if (!b) {
        b = this.makeSquadBanner(sq);
        this.squadBanners.set(sq.id, b);
        this.squadLayer.addChild(b.root);
      }
      if (sq.alive <= 0) {
        b.root.visible = false;
        continue;
      }
      b.root.visible = true;
      // Position above the tallest troop near the centroid.
      b.root.position.set(sq.centroidX, sq.centroidY * Y_SQUASH - 34);
      if (b.lastDispo !== sq.disposition) {
        b.dispo.texture = this.dispoTex[sq.disposition];
        b.lastDispo = sq.disposition;
      }
      if (b.lastCommand !== sq.command) {
        b.cmd.texture = this.cmdTex[sq.command];
        b.lastCommand = sq.command;
      }
      const isSel = sq.side === 0 && (selected === 'all' || selected.includes(sq.slot));
      b.flag.alpha = isSel ? 1 : 0.85;
      b.flag.scale.set(isSel ? 1.15 : 1);
      b.border.scale.set(b.flag.scale.x);
    }
    for (const [id, b] of this.squadBanners) {
      if (!seen.has(id)) {
        b.root.destroy({ children: true });
        this.squadBanners.delete(id);
      }
    }
  }

  private makeSquadBanner(sq: SquadState): SquadBanner {
    const root = new Container();
    const squadTint = this.squadColor(sq.side, sq.slot);
    const teamTint = this.teamColor(sq.side);
    const textColor = contrastMono(this.sideColors[sq.side].squads[sq.slot] ?? this.sideColors[sq.side].team);
    // Player = square flag; enemy = swallowtail pennant — distinguishable by shape, not just colour.
    const shapeTex = sq.side === 0 ? this.squareFlagTex : this.pennantFlagTex;
    const border = new Sprite(shapeTex);
    border.anchor.set(0.5, 1);
    border.tint = teamTint;
    border.scale.set(1.18);
    const flag = new Sprite(shapeTex);
    flag.anchor.set(0.5, 1);
    flag.tint = squadTint;
    const number = new Text({
      text: String(sq.slot + 1),
      style: { fill: textColor, fontSize: 11, fontWeight: 'bold', fontFamily: 'system-ui, Arial, sans-serif' },
    });
    number.anchor.set(0.5);
    number.position.set(8, -11);
    const glyph = new Sprite(this.dispoTex[sq.disposition]); // small per-side glyph echo (reuse dispo shape)
    glyph.anchor.set(0.5);
    glyph.tint = textColor;
    glyph.visible = false; // reserved; dispo/cmd icons below already communicate state
    const dispo = new Sprite(this.dispoTex[sq.disposition]);
    dispo.anchor.set(0.5);
    dispo.tint = 0x1a1a1a;
    dispo.position.set(-6, -16);
    dispo.scale.set(0.8);
    const cmd = new Sprite(this.cmdTex[sq.command]);
    cmd.anchor.set(0.5);
    cmd.tint = 0x1a1a1a;
    cmd.position.set(5, -25);
    cmd.scale.set(0.8);
    root.addChild(border, flag, number, glyph, dispo, cmd);
    if (sq.side === 0) {
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = { contains: (x: number, y: number) => x >= -14 && x <= 18 && y >= -30 && y <= 2 };
      root.on('pointertap', (e: { nativeEvent?: { shiftKey?: boolean; ctrlKey?: boolean } }) => {
        const additive = !!(e.nativeEvent?.shiftKey || e.nativeEvent?.ctrlKey);
        this.onSquadClick?.(sq.slot, additive);
      });
    }
    return { root, border, flag, number, glyph, dispo, cmd, lastDispo: null, lastCommand: null };
  }

  /** Apply one tick's sim events for cosmetic effects: flashes, projectiles, special FX, damage numbers. */
  applyEvents(world: World): void {
    for (const ev of world.events) {
      if (ev.type === 'hit') {
        const targetSp = this.sprites[ev.target];
        if (targetSp) targetSp.hitFlashT = 0.15;
        const attackerSp = this.sprites[ev.attacker];
        if (attackerSp) {
          attackerSp.attackFlashT = 0.15;
          attackerSp.lungeT = 0.12;
        }
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
    const fromX = ents.x[from]!;
    const fromY = ents.y[from]! * Y_SQUASH;
    const targetX = ents.x[to]!;
    const targetY = ents.y[to]! * Y_SQUASH;
    const ang = Math.atan2(targetY - fromY, targetX - fromX);
    g.moveTo(-6, 0).lineTo(6, 0).stroke({ color: 0xffe066, width: 2 });
    g.rotation = ang;
    g.position.set(fromX, fromY);
    this.fx.addChild(g);
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
    if (!getDebugState().overlay) return; // damage numbers are debug-only (spec §7.5)
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
      label.position.set(sq.centroidX, sq.centroidY * Y_SQUASH - 46);
      this.debugLayer.addChild(label);
    }
  }

  destroy(): void {
    for (const sp of this.sprites) sp?.container.destroy();
    for (const b of this.squadBanners.values()) b.root.destroy({ children: true });
    this.squadBanners.clear();
    this.world2screen.destroy({ children: true });
  }
}

export function worldPointToScreen(wx: number, wy: number, cam: Camera, viewportW: number, viewportH: number): [number, number] {
  return worldToScreen(wx, wy * Y_SQUASH, cam, viewportW, viewportH);
}

import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Texture } from 'pixi.js';
import { Battlefield, worldPointToScreen } from '../../src/render/battlefield';
import { createProjection, depthScale, projectGround } from '../../src/render/projection';
import { groundToScreen } from '../../src/battle/camera';
import { FxTimeline, overlayPoints, overlayScatterCount, timedWavePoints } from '../../src/render/fx';
import { createBattle, issueApproach, issueCommand } from '../../src/sim';
import { getGameData } from '../../src/data';
import { updateDebugState } from '../../src/debug/state';

function harness() {
  const data = getGameData();
  const world = createBattle(data, { seed: 1, sides: [
    { generalId: 'paladin', formationId: 'line', squads: [{ id: 's', name: 's', disposition: 'mixed', troops: [{ troopId: 't', name: 't', unitId: data.units[0]!.id }] }] },
    { generalId: 'dragon', formationId: 'line', squads: [{ id: 'e', name: 'e', disposition: 'mixed', troops: [
      { troopId: 'e0', name: 'e0', unitId: 'dog' }, { troopId: 'e1', name: 'e1', unitId: 'dog' },
    ] }] },
  ] });
  const projection = createProjection(data.constants.FIELD_W, data.constants.FIELD_H);
  const field = Object.assign(Object.create(Battlefield.prototype), {
    renderer: { generateTexture: () => new Texture() }, placeholders: new Map(), genericDisc: Texture.EMPTY,
    data, projection, squadColor: () => 0xaabbcc, fieldW: projection.fieldW, fieldH: projection.fieldH,
    world2screen: new Container(), ground: new Container(), routeGuide: new Graphics(), routeSignature: '', routeAge: 0,
    sideColors: [], fxSeed: 1,
    routePaths: [], ents: new Container(), fx: new Container(), debugLayer: new Container(),
    sprites: [], damageNumbers: [], sheets: new Map(), fxTimeline: new FxTimeline(), fxSheets: new Map(), fxTextures: new Map(),
  });
  updateDebugState({ overlay: false });
  const draw = (dt = 0, selected: number[] | 'all' = 'all') => field.render(world, { x: 650, y: 210, zoom: 1.2 }, 0.5, 800, 600, dt, selected);
  return { data, world, field, projection, draw };
}

function sprite(field: ReturnType<typeof harness>['field']) {
  return field.makeEntitySprite('', 0, false, true, 0);
}

describe('actual battlefield projection', () => {
  it('places interpolated feet and all attached art at uniform depth scale; camera pivot is already projected', () => {
    const { world, field, projection, draw } = harness();
    for (let i = 0; i < world.ents.count; i++) {
      field.sprites[i] = sprite(field);
      world.ents.prevX[i] = 100; world.ents.x[i] = 300;
      world.ents.prevY[i] = 0; world.ents.y[i] = projection.fieldH;
    }
    draw();
    expect([field.world2screen.pivot.x, field.world2screen.pivot.y]).toEqual([650, 210]);
    for (const [i, sp] of field.sprites.entries()) {
      expect([sp.container.x, sp.container.y]).toEqual(projectGround(projection, 200, projection.fieldH / 2));
      expect(sp.container.scale.x).toBeCloseTo(depthScale(projection, projection.fieldH / 2));
      expect(sp.container.scale.y).toBe(sp.container.scale.x);
      expect(sp.container.zIndex).toBe(projection.fieldH * 0.75 / 2);
      expect(sp.body.scale.x).toBe(sp.body.scale.y);
      for (const child of [sp.body, sp.ground, sp.disc, sp.selOuter, sp.selInner, sp.shadow]) expect(child.parent).toBe(sp.container);
      expect(sp.selOuter.visible).toBe(world.ents.isGeneral[i] === 0 && world.ents.side[i] === 0);
    }
  });

  it('multiplies death fade by depth scale without flattening upright art', () => {
    const { world, field, projection, draw } = harness();
    field.sprites[0] = sprite(field);
    world.ents.alive[0] = 0; world.ents.y[0] = projection.fieldH;
    draw(0.3);
    expect(field.sprites[0].container.scale.x).toBeCloseTo(1.05 * 0.75);
    expect(field.sprites[0].container.scale.y).toBeCloseTo(1.05 * 0.75);
  });

  it('exports the same camera and HUD composition', () => {
    const { projection } = harness();
    const cam = { x: 700, y: 150, zoom: 1.4 };
    expect(worldPointToScreen(123, 234, cam, 800, 600, projection, -70)).toEqual(groundToScreen(123, 234, projection, cam, 800, 600, -70));
  });

  it('projects delayed FX once at placement and keeps sprite sizing uniform', () => {
    const { field, projection } = harness();
    field.fxTimeline.schedule(0.2, () => field.placeFxInstance(123, 234, null, 'strike', 0));
    field.fxTimeline.update(0.1);
    expect(field.fx.children).toHaveLength(0);
    field.fxTimeline.update(0.11);
    const fx = field.fx.children[0];
    expect([fx.x, fx.y]).toEqual(projectGround(projection, 123, 234));
    expect(fx.scale.x).toBeCloseTo(depthScale(projection, 234));
    expect(fx.scale.y).toBe(fx.scale.x);
  });

  it('projects static ground bands, detail, lane cues and the boundary through one mapping', () => {
    const { field, projection } = harness();
    const poly = vi.spyOn(Graphics.prototype, 'poly');
    const move = vi.spyOn(Graphics.prototype, 'moveTo');
    field.drawGround();
    const quads = poly.mock.calls.map((c) => c[0] as number[]);
    expect(quads[0]).toEqual([
      ...projectGround(projection, 0, 0), ...projectGround(projection, projection.fieldW, 0),
      ...projectGround(projection, projection.fieldW, projection.fieldH / 12), ...projectGround(projection, 0, projection.fieldH / 12),
    ]);
    expect(quads.length).toBeGreaterThan(100);
    for (const quad of quads.slice(12, -1)) {
      // Horizontal detail narrows toward the far edge; its sides follow the trapezoid.
      expect(quad[2]! - quad[0]!).toBeLessThan(quad[4]! - quad[6]!);
      expect(quad[5]! - quad[1]!).toBeCloseTo(1.5);
    }
    const laneY = projection.fieldH * field.data.behaviors.approach.laneFraction;
    expect(move.mock.calls).toContainEqual(projectGround(projection, 20, laneY));
    expect(quads.at(-1)).toEqual([
      ...projectGround(projection, 0, 0), ...projectGround(projection, projection.fieldW, 0),
      ...projectGround(projection, projection.fieldW, projection.fieldH), ...projectGround(projection, 0, projection.fieldH),
    ]);
    const old = field.ground.children[0];
    field.drawGround();
    expect(old.destroyed).toBe(true);
    expect(field.ground.children).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('keeps snapshot, overlay and future wave positions flat until actual placement', () => {
    const { world, field, projection } = harness();
    field.lastWorld = world;
    const base = { type: 'special' as const, side: 0 as const, specialId: 'test', fx: '', x: 100, y: 100, dirX: 1, dirY: 0.2, width: 30, affected: [] };
    field.spawnSpecialFx({ ...base, areas: ['general'], areaTargets: [{ area: 'general', targets: [{ entity: 0, x: 123, y: 234 }] }] });
    expect([field.fx.children[0].x, field.fx.children[0].y]).toEqual(projectGround(projection, 123, 234));
    field.fx.removeChildren();
    field.spawnSpecialFx({ ...base, areas: ['field'] });
    const overlay = overlayPoints(projection.fieldW, projection.fieldH, field.fxSeed, overlayScatterCount(projection.fieldW, projection.fieldH));
    expect(field.fx.children.slice(1).map((c: Container) => [c.x, c.y])).toEqual(overlay.map(([x, y]) => projectGround(projection, x, y)));
    field.fx.removeChildren();
    field.spawnSpecialFx({ ...base, areas: ['wave'] });
    const wave = timedWavePoints(base.x, base.y, base.dirX, base.dirY, base.width, projection.fieldW, projection.fieldH, field.fxSeed);
    expect(field.fx.children).toHaveLength(2); // flash and first stamp
    field.fxTimeline.update(0.11);
    const stamps = field.fx.children.slice(1);
    expect(stamps.length).toBeGreaterThan(1);
    expect(stamps.map((c: Container) => [c.x, c.y])).toEqual(wave.slice(0, stamps.length).map(({ x, y }) => projectGround(projection, x, y)));
  });

  it('draws one aura per recipient for combined heal/buff while retaining distinct impact kinds', () => {
    const { world, field } = harness();
    field.lastWorld = world;
    const spawn = vi.spyOn(field, 'placeFxInstance').mockImplementation(() => {});
    const ally = world.generals[0].entity, enemy = world.generals[1].entity;
    const target = (entity: number) => ({ entity, x: world.ents.x[entity]!, y: world.ents.y[entity]! });
    field.spawnSpecialFx({ type: 'special', side: 0, specialId: 'combined', fx: '', x: 100, y: 300, dirX: 1, dirY: 0, width: 0,
      areas: ['heal', 'buff', 'general', 'debuff'], affected: [ally, enemy], areaTargets: [
        { area: 'heal', targets: [target(ally)] }, { area: 'buff', targets: [target(ally)] },
        { area: 'general', targets: [target(enemy)] }, { area: 'debuff', targets: [target(enemy)] },
      ],
    });
    expect(spawn.mock.calls.map((c) => [c[0], c[3]])).toEqual([
      [world.ents.x[ally], 'aura'], [world.ents.x[enemy], 'strike'], [world.ents.x[enemy], 'aura'],
    ]);
  });

  it('places projectiles on the projected flat trajectory at each elapsed step', () => {
    const { world, field, projection } = harness();
    world.ents.x[0] = 100; world.ents.y[0] = 20;
    world.ents.x[1] = 900; world.ents.y[1] = 400;
    field.spawnProjectile(world, 0, 1);
    const projectile = field.fx.children[0];
    expect([projectile.x, projectile.y]).toEqual(projectGround(projection, 100, 20));
    field.fxTimeline.update(0.075);
    expect([projectile.x, projectile.y]).toEqual(projectGround(projection, 500, 210));
    expect(projectile.scale.x).toBeCloseTo(depthScale(projection, 210));
    expect(projectile.scale.x).toBe(projectile.scale.y);
  });

  it('uses a living member role target and direct route, and clears on deselection', () => {
    const { world, field, projection, draw } = harness();
    const sq = world.squads[0]!;
    const member = sq.members[0]!;
    const enemy = world.squads[1]!.members[0]!;
    world.ents.x[enemy] = world.ents.x[member]! + 300;
    world.ents.y[enemy] = world.ents.y[member]!;
    expect(world.ents.target[member]).toBe(-1);
    draw();
    expect(field.routePaths[0]).toHaveLength(2);
    expect(field.routePaths[0].at(-1)).toEqual(projectGround(projection, world.ents.x[enemy]!, world.ents.y[enemy]!));
    const guide = field.routeGuide;
    draw(0, []);
    expect(field.routePaths).toHaveLength(0);
    expect(field.routeGuide).toBe(guide);
  });

  it('refreshes moving and dead targets while retaining the original guide expiry', () => {
    const { world, field, projection, draw } = harness();
    const [enemy, other] = world.squads[1]!.members;
    world.ents.x[enemy!] = 800; world.ents.y[enemy!] = 200;
    world.ents.x[other!] = 1100; world.ents.y[other!] = 300;
    draw();
    const guide = field.routeGuide;
    world.ents.x[enemy!] = 850; world.ents.y[enemy!] = 250;
    draw(0.5);
    expect(field.routePaths[0].at(-1)).toEqual(projectGround(projection, 850, 250));
    expect(field.routeGuide.alpha).toBeCloseTo(2 / 3);
    world.ents.alive[enemy!] = 0;
    draw(0.5);
    expect(field.routePaths[0].at(-1)).toEqual(projectGround(projection, 1100, 300));
    expect(field.routeGuide.alpha).toBeCloseTo(1 / 3);
    draw(0.5);
    expect(field.routeGuide.alpha).toBe(0);
    const paths = field.routePaths;
    const clear = vi.spyOn(guide, 'clear');
    world.ents.x[other!] = 1150;
    draw(0.1);
    expect(clear).not.toHaveBeenCalled();
    expect(field.routePaths).toBe(paths);
    expect(field.routeGuide).toBe(guide);
    expect(field.routeGuide.alpha).toBe(0);
  });

  it('shows the actual far troop for queued Advance from paused Hold', () => {
    const { world, field, projection, draw } = harness();
    world.squads[0]!.command = 'hold'; world.paused = true;
    const enemy = world.squads[1]!.members[0]!;
    world.ents.x[enemy] = 800; world.ents.y[enemy] = 300;
    draw();
    expect(field.routePaths).toHaveLength(0);
    issueCommand(world, 0, 's', 'advance');
    draw();
    expect(field.routePaths[0].at(-1)).toEqual(projectGround(projection, 800, 300));
    expect(world.squads[0]!.command).toBe('hold');
    expect(world.commandLog).toEqual([]);
    expect(world.tick).toBe(0);
  });

  it('shows queued paused intent, freezes and expires guides, holds without an advance arrow', () => {
    const { world, field, projection, draw } = harness();
    world.paused = true;
    issueApproach(world, 0, 's', 'farFlank');
    draw();
    expect(field.routePaths).toHaveLength(1);
    expect(field.routePaths[0]).toHaveLength(4);
    expect(field.routePaths[0][1][1]).toBeCloseTo(projection.fieldH * field.data.behaviors.approach.laneFraction * 0.75);
    draw(5);
    expect(field.routeGuide.alpha).toBeGreaterThan(0);
    issueCommand(world, 0, 's', 'hold');
    draw();
    expect(field.routePaths).toHaveLength(0);
    issueCommand(world, 0, 's', 'fallBack');
    draw();
    expect(field.routePaths[0].at(-1)).toEqual(projectGround(projection, world.generals[0].startX, world.generals[0].startY));
    world.paused = false;
    draw(1.6);
    expect(field.routeGuide.alpha).toBe(0);
  });
});

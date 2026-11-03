import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Texture } from 'pixi.js';
import { createProjection } from '../../src/render/projection';
import { Battlefield } from '../../src/render/battlefield';
import { getGameData } from '../../src/data';
import { createBattle } from '../../src/sim';
import { updateDebugState } from '../../src/debug/state';

const transform = () => ({ set: vi.fn() });

describe('uncluttered battlefield', () => {
  it('does not add a decorative flag to general sprites', () => {
    const data = getGameData();
    const world = createBattle(data, { seed: 1, sides: [
      { generalId: 'paladin', formationId: 'line', squads: [] },
      { generalId: 'dragon', formationId: 'line', squads: [] },
    ] });
    const makeSprite = () => ({
      container: { addChild: vi.fn() }, disc: {}, ground: { anchor: transform() },
      halo: null, cloth: null, squadIdx: -1,
    });
    const field = Object.assign(Object.create(Battlefield.prototype), {
      data, sprites: [], makeEntitySprite: vi.fn(makeSprite), teamColor: () => 0x00aaff,
      squadColor: () => 0x00aaff, generalRingTex: Texture.EMPTY, generalBannerTex: Texture.EMPTY,
      ents: { addChild: vi.fn() },
    });
    field.ensureSprites(world);
    expect(field.sprites).toHaveLength(2);
    for (const sprite of field.sprites) expect(sprite.container.addChild).not.toHaveBeenCalled();
    expect(field.ents.addChild).toHaveBeenCalledTimes(2);
  });

  it('renders without creating floating squad banners', () => {
    const world = createBattle(getGameData(), { seed: 1, sides: [
      { generalId: 'paladin', formationId: 'line', squads: [] },
      { generalId: 'dragon', formationId: 'line', squads: [] },
    ] });
    world.ents.count = 0;
    const renderSquadBanners = vi.fn();
    const field = Object.assign(Object.create(Battlefield.prototype), {
      world2screen: { position: transform(), scale: transform(), pivot: transform() },
      projection: createProjection(1600, 600), routeGuide: new Graphics(), routeSignature: '', routeAge: 0, routePaths: [],
      damageNumbers: [], renderSquadBanners, debugLayer: new Container(),
    });
    updateDebugState({ overlay: false });
    field.render(world, { x: 0, y: 0, zoom: 1 }, 1, 800, 600, 1 / 60, 'all');
    expect(renderSquadBanners).not.toHaveBeenCalled();
  });
});

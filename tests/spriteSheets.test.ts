import { describe, expect, it } from 'vitest';
import { collectSheets, parseAsepriteSheet } from '../src/render/spriteSheets';

const hashJson = {
  frames: {
    'dog 0.aseprite': { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 120 },
    'dog 1.aseprite': { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 120 },
    'dog 2.aseprite': { frame: { x: 32, y: 0, w: 16, h: 16 }, duration: 80 },
    'dog 3.aseprite': { frame: { x: 48, y: 0, w: 16, h: 16 } },
  },
  meta: {
    frameTags: [
      { name: 'idle', from: 0, to: 1, direction: 'forward' },
      { name: 'Walk', from: 1, to: 3, direction: 'pingpong' },
      { name: 'attack', from: 2, to: 3, direction: 'forward' },
    ],
  },
};

describe('sprite sheet hook', () => {
  it('parses Aseprite hash JSON with tags, falls back to idle for missing animations', () => {
    const s = parseAsepriteSheet('dog', 'dog.png', hashJson);
    expect(s.frameW).toBe(16);
    expect(s.animations.idle.frames).toHaveLength(2);
    expect(s.animations.walk.frames.map((f) => f.x)).toEqual([16, 32, 48, 32]);
    expect(s.animations.attack.loop).toBe(false);
    expect(s.animations.death.frames).toBe(s.animations.idle.frames);
    expect(s.animations.attack.frames[1]!.durationMs).toBe(100);
  });

  it('parses array JSON without tags', () => {
    const s = parseAsepriteSheet('x', 'x.png', { frames: [{ frame: { x: 0, y: 0, w: 20, h: 24 } }] });
    expect(s.animations.walk.frames).toHaveLength(1);
    expect(s.frameH).toBe(24);
  });

  it('pairs json with png and reports problems instead of throwing', () => {
    const errors: string[] = [];
    const sheets = collectSheets(
      { '/assets/sprites/dog.json': { default: hashJson }, '/assets/sprites/cat.json': { default: hashJson }, '/assets/sprites/bad.json': { default: {} } },
      { '/assets/sprites/dog.png': '/u/dog.png', '/assets/sprites/bad.png': '/u/bad.png' },
      (m) => errors.push(m),
    );
    expect([...sheets.keys()]).toEqual(['dog']);
    expect(sheets.get('dog')!.imageUrl).toBe('/u/dog.png');
    expect(errors).toHaveLength(2);
  });
});

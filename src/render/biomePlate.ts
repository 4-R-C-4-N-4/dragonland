// Biome backdrops for the battle stage. Decoration only: a missing or failed plate
// leaves the plain background colour, and never blocks a battle from starting.
import { Assets, Sprite, Texture } from 'pixi.js';
import plains from '../../assets/backgrounds/plains.jpg';
import forest from '../../assets/backgrounds/forest.jpg';
import mountain from '../../assets/backgrounds/mountain.jpg';
import swamp from '../../assets/backgrounds/swamp.jpg';
import ruins from '../../assets/backgrounds/ruins.jpg';

export type BattleBiome = 'plains' | 'forest' | 'mountain' | 'swamp' | 'ruins' | 'settled';

const urls: Record<Exclude<BattleBiome, 'settled'>, string> = { plains, forest, mountain, swamp, ruins };

/** Settled nodes (castles and towns) reuse the plains plate rather than shipping a sixth. */
function urlFor(biome: BattleBiome): string {
  return urls[biome === 'settled' ? 'plains' : biome];
}

export async function loadBiomePlate(biome: BattleBiome): Promise<Texture | null> {
  try { return await Assets.load<Texture>(urlFor(biome)); } catch { return null; }
}

/** Cover-fit the plate to the viewport so terrain never stretches. */
export function fitPlate(sprite: Sprite, texture: Texture, width: number, height: number): void {
  const scale = Math.max(width / texture.width, height / texture.height);
  sprite.scale.set(scale);
  sprite.x = (width - texture.width * scale) / 2;
  sprite.y = (height - texture.height * scale) / 2;
}

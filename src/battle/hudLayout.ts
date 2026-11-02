/** Screen-space geometry only. No renderer or simulation state is needed. */
export interface HudRect { x: number; y: number; width: number; height: number }
export type HudButton = 'all' | 'advance' | 'hold' | 'fallBack' | 'direct' | 'farFlank' | 'nearFlank' | 'pause' | 'speed' | 'special';
export interface HudLayout {
  compact: boolean;
  bottomBand: HudRect;
  generals: [HudRect, HudRect];
  timer: HudRect;
  cards: HudRect[];
  detail: HudRect;
  orderHeading: HudRect;
  approachHeading: HudRect;
  buttons: Record<HudButton, HudRect>;
}

/** Four deployment slots; sizes below 800×600 are outside the battle viewport contract. */
export function getHudLayout(width: number, height: number): HudLayout {
  const compact = width < 1100;
  const bandHeight = compact ? 230 : 256;
  const y = height - bandHeight;
  const rect = (x: number, top: number, w: number, h = 40): HudRect => ({ x, y: top, width: w, height: h });
  const controlY = y + (compact ? 176 : 202);
  const cardWidth = compact ? (width - 108) / 4 : 146;
  return {
    compact,
    bottomBand: rect(0, y, width, bandHeight),
    generals: [rect(14, 6, 260, 60), rect(width - 274, 6, 260, 60)],
    timer: rect(width / 2 - 90, 6, 180, 54),
    cards: Array.from({ length: 4 }, (_, i) => rect(10 + i * (cardWidth + 8), y + 8, cardWidth, compact ? 54 : 108)),
    detail: rect(10, y + (compact ? 70 : 124), width - (compact ? 20 : 270), 44),
    orderHeading: rect(10, controlY - 22, 250, 18),
    approachHeading: rect(280, controlY - 22, 268, 18),
    buttons: {
      all: rect(width - 66, y + 8, 56),
      advance: rect(10, controlY, 84), hold: rect(102, controlY, 66), fallBack: rect(176, controlY, 84),
      direct: rect(280, controlY, 84), farFlank: rect(372, controlY, 84), nearFlank: rect(464, controlY, 84),
      pause: rect(width - 146, y + (compact ? 120 : 124), 72),
      speed: rect(width - 66, y + (compact ? 120 : 124), 56),
      special: rect(width - 110, controlY, 100),
    },
  };
}

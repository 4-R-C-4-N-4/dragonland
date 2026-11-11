import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { War, WorldNode, WorldOrder } from '../world/types';
import { visibleNodes } from '../ai/strategy';
import { hasGarrison } from '../world/movement';
import { garrisonAt } from '../world/garrison';
import { nodeTone, type NodeTone } from './worldTone';
import mapUrl from '../../assets/backgrounds/worldmap.jpg';

/** Colour is ownership; shape is kind (see the DOM legend in src/ui/world). */
export const TONE_COLORS: Record<NodeTone, number> = { own: 0x5bc86d, enemy: 0xea4b50, neutral: 0xd8cfb8 };
const OUTLINE = 0x05070a;
/** Ember: everything the player can act on (march targets, queued marches, the selection). */
const HIGHLIGHT = 0xf5a93a;
const ORDER = 0xffc558;
const DISPLAY_FONT = 'Cinzel, Georgia, serif';
const LABEL_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const BANNER_ACTION: Record<WorldOrder['type'], string> = { march: 'March', search: 'Search', rest: 'Rest', hold: 'Hold' };

let parchment: Texture | null = null;
/** Preload the map plate once; callers may ignore it and get a plain background. */
export async function loadWorldMapArt(): Promise<void> {
  if (!parchment) parchment = await Assets.load<Texture>(mapUrl);
}

export interface WorldMapView {
  factionId: string;
  selectedNode: string | null;
  selectedDivision: string | null;
  /** Nodes the selected division can march to this turn. */
  targets: ReadonlySet<string>;
  /** The faction's queued orders, drawn as arrows and banner suffixes. */
  orders: readonly WorldOrder[];
  onNode: (id: string) => void;
  onDivision: (id: string) => void;
}

function drawShape(g: Graphics, kind: WorldNode['kind'], x: number, y: number): Graphics {
  switch (kind) {
    case 'castle': return g.rect(x - 13, y - 13, 26, 26);
    case 'town': return g.poly([x, y - 14, x + 14, y, x, y + 14, x - 14, y]);
    case 'village': return g.circle(x, y, 9);
    case 'lair': return g.poly([x, y - 13, x + 13, y + 10, x - 13, y + 10]);
  }
}

/**
 * Draws the authored world layout; callers own the Pixi application lifecycle. Returns the
 * march-target rings so the caller can pulse them.
 */
export function drawWorldMap(stage: Container, war: War, view: WorldMapView, width = 680, height = 460): Graphics[] {
  const pulses: Graphics[] = [];
  const { factionId } = view;
  stage.removeChildren().forEach(child => child.destroy({ children: true }));
  const root = new Container();
  stage.addChild(root);
  // Parchment plate behind everything, cover-fitted so the terrain never stretches.
  if (parchment) {
    const plate = new Sprite(parchment);
    const scale = Math.max(width / parchment.width, height / parchment.height);
    plate.scale.set(scale);
    plate.x = (width - parchment.width * scale) / 2;
    plate.y = (height - parchment.height * scale) / 2;
    root.addChild(plate);
    // Dim the plate a little so nodes, banners and orders read first.
    root.addChild(new Graphics().rect(0, 0, width, height).fill({ color: 0x05070a, alpha: 0.26 }));
  }
  const bounds = war.nodes.reduce((b, n) => ({ minX: Math.min(b.minX, n.x), maxX: Math.max(b.maxX, n.x), minY: Math.min(b.minY, n.y), maxY: Math.max(b.maxY, n.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  // Names sit above nodes and banners below, so leave room on every side but no wide right gutter.
  const sx = (x: number) => 48 + (x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX) * Math.max(1, width - 96);
  const sy = (y: number) => 38 + (y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY) * Math.max(1, height - 86);
  const compact = width < 640;
  const positions = new Map(war.nodes.map(n => [n.id, { x: sx(n.x), y: sy(n.y) }]));
  const division = war.divisions.find(d => d.id === view.selectedDivision);

  const routes = new Graphics();
  for (const route of war.routes) {
    const a = positions.get(route.from), b = positions.get(route.to); if (!a || !b) continue;
    routes.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x05070a, width: 6, alpha: 0.5 });
    routes.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xe9dfc6, width: 2, alpha: 0.7 });
  }
  if (division) {
    const from = positions.get(division.atNode);
    for (const id of view.targets) { const to = positions.get(id); if (from && to) routes.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: HIGHLIGHT, width: 4, alpha: 0.85 }); }
  }
  root.addChild(routes);

  // Queued marches: an arrow from the division's node towards its destination.
  const arrows = new Graphics();
  for (const order of view.orders) {
    if (order.type !== 'march') continue;
    const d = war.divisions.find(x => x.id === order.division);
    const a = d && positions.get(d.atNode), b = positions.get(order.toNode); if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 1) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const tip = { x: b.x - ux * 18, y: b.y - uy * 18 };
    arrows.moveTo(a.x + ux * 16, a.y + uy * 16).lineTo(tip.x - ux * 8, tip.y - uy * 8).stroke({ color: 0x05070a, width: 9, alpha: 0.6 });
    arrows.moveTo(a.x + ux * 16, a.y + uy * 16).lineTo(tip.x - ux * 8, tip.y - uy * 8).stroke({ color: ORDER, width: 5, alpha: 1 });
    arrows.poly([tip.x, tip.y, tip.x - ux * 14 - uy * 8, tip.y - uy * 14 + ux * 8, tip.x - ux * 14 + uy * 8, tip.y - uy * 14 - ux * 8]).fill({ color: ORDER });
  }
  root.addChild(arrows);

  for (const node of war.nodes) {
    const p = positions.get(node.id)!;
    const tone = TONE_COLORS[nodeTone(node, factionId)];
    // A dark plinth with a rim in the owner's colour, so ownership reads on any terrain.
    root.addChild(new Graphics().circle(p.x, p.y, 19).fill({ color: 0x05070a, alpha: 0.72 }).stroke({ color: tone, width: 2, alpha: 0.9 }));
    if (view.targets.has(node.id)) { const ring = new Graphics().circle(p.x, p.y, 25).fill({ color: HIGHLIGHT, alpha: 0.2 }).stroke({ color: HIGHLIGHT, width: 3 }); pulses.push(ring); root.addChild(ring); }
    if (view.selectedNode === node.id) root.addChild(new Graphics().circle(p.x, p.y, 24).stroke({ color: 0xffffff, width: 3, alpha: 0.95 }));
    const shape = drawShape(new Graphics(), node.kind, p.x, p.y).fill({ color: tone }).stroke({ color: OUTLINE, width: 2 });
    root.addChild(shape);
    // A generous invisible hit circle so small villages stay easy to click.
    const hit = new Graphics().circle(p.x, p.y, 24).fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = 'static'; hit.cursor = 'pointer'; hit.on('pointertap', () => view.onNode(node.id)); root.addChild(hit);
    // Centred above the node: horizontal neighbours on one road never collide this way.
    const label = new Text({ text: node.name, style: { fontFamily: DISPLAY_FONT, fontWeight: '700', fontSize: compact ? 12 : 15, fill: 0xfff6e0, stroke: { color: 0x05070a, width: 5 } } });
    label.x = Math.max(2, Math.min(p.x - label.width / 2, width - label.width - 2)); label.y = p.y - 21 - label.height; root.addChild(label);
    // Only say a castle is held when the engine would actually stop a capture there.
    const stationed = node.owner === factionId ? garrisonAt(war, node.id, factionId).length : 0;
    if (stationed) {
      const defended = node.kind === 'castle' && hasGarrison(war, node.id, factionId);
      const g = new Text({ text: defended ? `+${stationed} held` : `+${stationed} not defending`, style: { fontFamily: LABEL_FONT, fontSize: 12, fontWeight: '700', fill: defended ? 0xbff0c6 : 0xf5c26b, stroke: { color: 0x05070a, width: 4 } } });
      g.x = Math.min(p.x + 22, width - g.width - 2); g.y = p.y - 8; root.addChild(g);
    }
  }

  const visible = visibleNodes(war, factionId);
  const stacked = new Map<string, number>();
  for (const d of war.divisions) {
    if (!d.generals.length || (d.factionId !== factionId && !visible.has(d.atNode))) continue;
    const p = positions.get(d.atNode); if (!p) continue;
    const own = d.factionId === factionId;
    const lead = war.generals.find(g => g.id === d.generals[0])?.name ?? '?';
    const order = own ? view.orders.find(o => o.division === d.id) : undefined;
    const suffix = own ? ` · ${BANNER_ACTION[order?.type ?? 'hold']}` : '';
    const text = new Text({ text: `${lead} ×${d.generals.length}${suffix}`.toUpperCase(), style: { fontFamily: LABEL_FONT, fontSize: compact ? 11 : 13, fontWeight: '700', letterSpacing: 0.6, fill: 0xffffff } });
    const row = stacked.get(d.atNode) ?? 0; stacked.set(d.atNode, row + 1);
    const pad = 6, x = Math.max(2, Math.min(p.x - (text.width + pad * 2) / 2, width - text.width - pad * 2 - 2)), y = p.y + 22 + row * 21;
    const selected = d.id === view.selectedDivision;
    const bg = new Graphics().rect(x, y, text.width + pad * 2, 19).fill({ color: own ? 0x1f7a35 : 0xa3262b, alpha: 0.97 }).stroke({ color: selected ? HIGHLIGHT : OUTLINE, width: selected ? 2.5 : 1 });
    text.x = x + pad; text.y = y + 1;
    root.addChild(bg, text);
    if (own) { bg.eventMode = 'static'; bg.cursor = 'pointer'; bg.on('pointertap', () => view.onDivision(d.id)); }
  }
  return pulses;
}

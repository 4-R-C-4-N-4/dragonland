import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { War, WorldNode, WorldOrder } from '../world/types';
import { visibleNodes } from '../ai/strategy';
import { garrisonAt } from '../world/garrison';
import { nodeTone, type NodeTone } from '../ui/world/presentation';
import mapUrl from '../../assets/backgrounds/worldmap.jpg';

/** Colour is ownership; shape is kind (see the DOM legend in src/ui/world). */
export const TONE_COLORS: Record<NodeTone, number> = { own: 0x4f9e52, enemy: 0xb23a3a, neutral: 0xb8a888 };
const OUTLINE = 0x1a130e;
const HIGHLIGHT = 0xf0c050;
const ORDER = 0x9be07a;
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

/** Draws the authored world layout; callers own the Pixi application lifecycle. */
export function drawWorldMap(stage: Container, war: War, view: WorldMapView, width = 680, height = 460): void {
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
    routes.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x5a4632, width: 3, alpha: 0.85 });
  }
  if (division) {
    const from = positions.get(division.atNode);
    for (const id of view.targets) { const to = positions.get(id); if (from && to) routes.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: HIGHLIGHT, width: 4, alpha: 0.75 }); }
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
    arrows.moveTo(a.x + ux * 16, a.y + uy * 16).lineTo(tip.x - ux * 8, tip.y - uy * 8).stroke({ color: ORDER, width: 5, alpha: 0.95 });
    arrows.poly([tip.x, tip.y, tip.x - ux * 14 - uy * 8, tip.y - uy * 14 + ux * 8, tip.x - ux * 14 + uy * 8, tip.y - uy * 14 - ux * 8]).fill({ color: ORDER });
  }
  root.addChild(arrows);

  for (const node of war.nodes) {
    const p = positions.get(node.id)!;
    if (view.targets.has(node.id)) root.addChild(new Graphics().circle(p.x, p.y, 21).fill({ color: HIGHLIGHT, alpha: 0.18 }).stroke({ color: HIGHLIGHT, width: 2 }));
    if (view.selectedNode === node.id) root.addChild(new Graphics().circle(p.x, p.y, 22).stroke({ color: 0xffffff, width: 3, alpha: 0.9 }));
    const shape = drawShape(new Graphics(), node.kind, p.x, p.y).fill({ color: TONE_COLORS[nodeTone(node, factionId)] }).stroke({ color: OUTLINE, width: 2 });
    root.addChild(shape);
    // A generous invisible hit circle so small villages stay easy to click.
    const hit = new Graphics().circle(p.x, p.y, 20).fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = 'static'; hit.cursor = 'pointer'; hit.on('pointertap', () => view.onNode(node.id)); root.addChild(hit);
    // Centred above the node: horizontal neighbours on one road never collide this way.
    const label = new Text({ text: node.name, style: { fontFamily: 'Georgia', fontSize: compact ? 11 : 13, fill: 0xf3e6cf, stroke: { color: 0x14100e, width: 4 } } });
    label.x = Math.max(2, Math.min(p.x - label.width / 2, width - label.width - 2)); label.y = p.y - 17 - label.height; root.addChild(label);
    const held = node.owner === factionId ? garrisonAt(war, node.id, factionId).length : 0;
    if (held) {
      const g = new Text({ text: `+${held} held`, style: { fontSize: 10, fontWeight: '700', fill: 0xbfe8b0, stroke: { color: 0x14100e, width: 3 } } });
      g.x = Math.min(p.x + 16, width - g.width - 2); g.y = p.y - 6; root.addChild(g);
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
    const text = new Text({ text: `${lead} ×${d.generals.length}${suffix}`, style: { fontSize: compact ? 10 : 11, fontWeight: '700', fill: 0xffffff } });
    const row = stacked.get(d.atNode) ?? 0; stacked.set(d.atNode, row + 1);
    const pad = 4, x = Math.max(2, Math.min(p.x - (text.width + pad * 2) / 2, width - text.width - pad * 2 - 2)), y = p.y + 17 + row * 20;
    const selected = d.id === view.selectedDivision;
    const bg = new Graphics().roundRect(x, y, text.width + pad * 2, 17, 4).fill({ color: own ? 0x2f6b33 : 0x8a2626, alpha: 0.95 }).stroke({ color: selected ? HIGHLIGHT : OUTLINE, width: selected ? 2 : 1 });
    text.x = x + pad; text.y = y + 1;
    root.addChild(bg, text);
    if (own) { bg.eventMode = 'static'; bg.cursor = 'pointer'; bg.on('pointertap', () => view.onDivision(d.id)); }
  }
}

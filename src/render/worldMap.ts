import { Application, Container, Graphics, Text } from 'pixi.js';
import type { War, WorldNode } from '../world/types';
import { visibleNodes } from '../ai/strategy';

const colors: Record<WorldNode['kind'], number> = { castle: 0xd5a33a, town: 0x8fc06b, village: 0xc7b994, lair: 0x9d6ca8 };

/** Draws the authored world layout; callers own the Pixi application lifecycle. */
export function drawWorldMap(stage: Container, war: War, factionId: string, onNode: (id: string) => void, width = 680, height = 460): void {
  stage.removeChildren().forEach(child => child.destroy({ children: true }));
  const root = new Container();
  stage.addChild(root);
  const bounds = war.nodes.reduce((b, n) => ({ minX: Math.min(b.minX, n.x), maxX: Math.max(b.maxX, n.x), minY: Math.min(b.minY, n.y), maxY: Math.max(b.maxY, n.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const sx = (x: number) => 28 + (x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX) * Math.max(1, width - 56);
  const sy = (y: number) => 28 + (y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY) * Math.max(1, height - 56);
  const positions = new Map(war.nodes.map(n => [n.id, { x: sx(n.x), y: sy(n.y) }]));
  const routes = new Graphics();
  for (const route of war.routes) { const a = positions.get(route.from), b = positions.get(route.to); if (a && b) routes.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x76634b, width: 3, alpha: 0.8 }); }
  root.addChild(routes);
  for (const node of war.nodes) {
    const p = positions.get(node.id)!;
    const dot = new Graphics().circle(p.x, p.y, node.kind === 'castle' ? 13 : 9).fill({ color: colors[node.kind] }).stroke({ color: node.owner === factionId ? 0x73bd68 : 0x261d16, width: 3 });
    dot.eventMode = 'static'; dot.cursor = 'pointer'; dot.on('pointertap', () => onNode(node.id)); root.addChild(dot);
    const label = new Text({ text: node.name, style: { fontFamily: 'Georgia', fontSize: 13, fill: 0xecdfc9, stroke: { color: 0x14100e, width: 3 } } });
    label.x = Math.max(4, Math.min(p.x + 10, width - label.width - 8)); label.y = p.y - 8; root.addChild(label);
  }
  const visible = visibleNodes(war, factionId);
  for (const division of war.divisions) {
    if (division.factionId !== factionId && !visible.has(division.atNode)) continue;
    const p = positions.get(division.atNode); if (!p || !division.generals.length) continue;
    const names = division.generals.map(id => war.generals.find(g => g.id === id)?.name).filter(Boolean);
    const banner = new Text({ text: `${division.factionId === factionId ? '◆' : '▲'} ${names[0] ?? division.id}`, style: { fontSize: 11, fill: division.factionId === factionId ? 0x8fc06b : 0xe57d66, stroke: { color: 0x14100e, width: 3 } } });
    banner.x = p.x + 9; banner.y = p.y + 8; root.addChild(banner);
  }
}

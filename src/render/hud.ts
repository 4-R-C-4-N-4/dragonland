// Screen-space HUD drawn in Pixi (implementation.md §6/§7.3-7.5). Real button chrome,
// no overlapping text, layout() repositions on resize. Text objects are updated only on change.
import { Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import type { GameData } from '../data';
import type { World } from '../sim';
import { canFireSpecial, getSquadIntent } from '../sim';
import { formatTimer } from '../battle/helpers';
import type { Approach, Command } from '../data/schemas';
import { squadColorNumberFor, teamColorNumber, contrastMono, type SideColors } from './colorUi';

export interface HudCallbacks {
  onSelectSquad(slot: number, additive: boolean): void;
  onSelectAll(): void;
  onCommand(cmd: 'advance' | 'hold' | 'fallBack'): void;
  onApproach(approach: Approach): void;
  onSpecial(): void;
  onPauseToggle(): void;
  onSpeedToggle(): void;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
const MIN_TOUCH = 40;

interface Bar {
  bg: Graphics;
  fg: Graphics;
  w: number;
  h: number;
  lastFrac: number;
}

function makeBar(w: number, h: number, color: number): Bar {
  const bg = new Graphics().roundRect(0, 0, w, h, h / 2).fill({ color: 0x1a1a1a, alpha: 0.85 });
  const fg = new Graphics();
  const wrap = { bg, fg, w, h, lastFrac: -1 };
  setBar(wrap, 1, color);
  return wrap;
}

function setBar(bar: Bar, frac: number, color: number): void {
  const f = Math.max(0, Math.min(1, frac));
  if (Math.abs(f - bar.lastFrac) < 0.002) return;
  bar.lastFrac = f;
  bar.fg.clear();
  const w = Math.max(bar.h, bar.w * f);
  if (f > 0) bar.fg.roundRect(0, 0, w, bar.h, bar.h / 2).fill({ color });
}

function hitArea(c: Container, w: number, h: number): void {
  c.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= w && y >= 0 && y <= h };
  c.eventMode = 'static';
  c.cursor = 'pointer';
}

/** A real button: rounded-rect background + label + optional key hint, with hover/pressed/active states. */
class Button {
  readonly root = new Container();
  private bg: Graphics;
  private label: Text;
  private hint: Text | null = null;
  private w: number;
  private h: number;
  private hovered = false;
  private pressed = false;
  private active = false;
  private dimmed = false;
  private glow = 0;

  constructor(
    w: number,
    h: number,
    text: string,
    keyHint: string | null,
    onClick: () => void,
  ) {
    this.w = w;
    this.h = h;
    this.bg = new Graphics();
    this.label = new Text({ text, style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold', fontFamily: FONT } });
    this.label.anchor.set(0.5);
    this.label.position.set(w / 2, h / 2);
    this.root.addChild(this.bg, this.label);
    if (keyHint) {
      this.hint = new Text({ text: keyHint, style: { fill: 0xbbbbbb, fontSize: 9, fontWeight: 'bold', fontFamily: FONT } });
      this.hint.position.set(4, 3);
      this.root.addChild(this.hint);
    }
    hitArea(this.root, w, h);
    this.root.on('pointerover', () => (this.hovered = true));
    this.root.on('pointerout', () => {
      this.hovered = false;
      this.pressed = false;
    });
    this.root.on('pointerdown', () => (this.pressed = true));
    this.root.on('pointerup', () => (this.pressed = false));
    this.root.on('pointerupoutside', () => (this.pressed = false));
    this.root.on('pointertap', onClick);
    this.redraw();
  }

  setActive(v: boolean): void {
    if (this.active === v) return;
    this.active = v;
    this.redraw();
  }

  setDimmed(v: boolean): void {
    if (this.dimmed === v) return;
    this.dimmed = v;
    this.redraw();
  }

  setGlow(pulse: number): void {
    this.glow = pulse;
    this.redraw();
  }

  setPosition(x: number, y: number): void {
    this.root.position.set(x, y);
  }

  setLabel(text: string): void {
    if (this.label.text !== text) this.label.text = text;
  }

  tick(): void {
    if (this.hovered || this.pressed) this.redraw();
  }

  private redraw(): void {
    const bg = this.bg;
    bg.clear();
    let fill = 0x2a3a2f;
    if (this.active) fill = 0x3f6b3a;
    if (this.pressed) fill = 0x1c281e;
    else if (this.hovered) fill = this.active ? 0x4f7f48 : 0x384a3d;
    bg.roundRect(0, 0, this.w, this.h, 6).fill({ color: fill, alpha: this.dimmed ? 0.55 : 0.92 });
    const borderColor = this.active ? 0x8fe07a : 0x5a6a5c;
    bg.roundRect(0.5, 0.5, this.w - 1, this.h - 1, 6).stroke({ color: borderColor, width: this.active ? 2 : 1, alpha: this.dimmed ? 0.5 : 0.9 });
    if (this.glow > 0) {
      bg.roundRect(-2, -2, this.w + 4, this.h + 4, 8).stroke({ color: 0xffee88, width: 2, alpha: this.glow * 0.8 });
    }
    this.label.alpha = this.dimmed ? 0.6 : 1;
  }
}

interface SquadCard {
  root: Container;
  bg: Graphics;
  numHint: Text;
  name: Text;
  dispo: Text;
  command: Text;
  approach: Text;
  bar: Bar;
  countLabel: Text;
  lastKey: string;
}

export class Hud {
  readonly root = new Container();
  private screenLayer = new Container(); // top/bottom bars, fixed in screen space
  private timerText: Text;
  private phaseText: Text;
  private pauseBtn: Button;
  private speedBtn: Button;
  private specialBtn: Button;
  private specialMeter: Bar;
  private pauseOverlay: Container;
  private resultBanner: Container;
  private duelBanner: Container;
  private squadCards: SquadCard[] = [];
  private generalHp: [Bar, Bar];
  private generalMp: [Bar, Bar];
  private generalHpLabel: [Text, Text];
  private generalMpLabel: [Text, Text];
  private generalLabel: [Text, Text];
  private generalLevel: [Text, Text];
  private topBg: Graphics;
  private bottomBg: Graphics;
  private cmdButtons: { advance: Button; hold: Button; fallBack: Button; all: Button };
  private approachButtons: Record<Approach, Button>;
  private lastTimerStr = '';
  private lastPhaseStr = '';
  private width = 0;
  private height = 0;
  private topH = 68;
  private bottomH = 172;

  constructor(
    private data: GameData,
    private labels: { player: string; enemy: string },
    private sideColors: [SideColors, SideColors],
    private cb: HudCallbacks,
  ) {
    this.topBg = new Graphics();
    this.bottomBg = new Graphics();
    this.root.addChild(this.topBg, this.bottomBg);

    this.timerText = new Text({ text: '0:00', style: { fill: 0xffffff, fontSize: 24, fontWeight: 'bold', fontFamily: FONT } });
    this.timerText.anchor.set(0.5, 0);
    this.phaseText = new Text({ text: '', style: { fill: 0xffee88, fontSize: 13, fontWeight: 'bold', fontFamily: FONT } });
    this.phaseText.anchor.set(0.5, 0);
    this.root.addChild(this.timerText, this.phaseText);

    this.pauseBtn = new Button(72, MIN_TOUCH, 'Pause', 'SPACE', () => cb.onPauseToggle());
    this.speedBtn = new Button(56, MIN_TOUCH, '1x', 'F', () => cb.onSpeedToggle());
    this.specialBtn = new Button(100, MIN_TOUCH, 'Special', 'S', () => cb.onSpecial());
    this.root.addChild(this.pauseBtn.root, this.speedBtn.root, this.specialBtn.root);
    this.specialMeter = makeBar(90, 8, 0xffcc00);
    const specialMeterC = new Container();
    specialMeterC.addChild(this.specialMeter.bg, this.specialMeter.fg);
    this.root.addChild(specialMeterC);
    this._specialMeterC = specialMeterC;

    this.generalHp = [makeBar(120, 12, 0x44cc44), makeBar(120, 12, 0x44cc44)];
    this.generalMp = [makeBar(120, 7, 0x4488ff), makeBar(120, 7, 0x4488ff)];
    this.generalHpLabel = [
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 9, fontFamily: FONT } }),
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 9, fontFamily: FONT } }),
    ];
    this.generalMpLabel = [
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 8, fontFamily: FONT } }),
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 8, fontFamily: FONT } }),
    ];
    this.generalLabel = [
      new Text({ text: labels.player, style: { fill: 0xffffff, fontSize: 14, fontWeight: 'bold', fontFamily: FONT } }),
      new Text({ text: labels.enemy, style: { fill: 0xffffff, fontSize: 14, fontWeight: 'bold', fontFamily: FONT } }),
    ];
    this.generalLevel = [
      new Text({ text: '', style: { fill: 0xbbbbbb, fontSize: 10, fontFamily: FONT } }),
      new Text({ text: '', style: { fill: 0xbbbbbb, fontSize: 10, fontFamily: FONT } }),
    ];
    for (const s of [0, 1] as const) {
      const c = new Container();
      const badgeColor = teamColorNumber(this.sideColors[s]);
      const badge = new Graphics().circle(16, 16, 16).fill({ color: badgeColor }).circle(16, 16, 16).stroke({ color: 0xffffff, width: 2, alpha: 0.6 });
      c.addChild(badge, this.generalLabel[s], this.generalLevel[s], this.generalHp[s].bg, this.generalHp[s].fg, this.generalHpLabel[s]);
      c.addChild(this.generalMp[s].bg, this.generalMp[s].fg, this.generalMpLabel[s]);
      this.root.addChild(c);
      if (s === 0) this._genRoot0 = c;
      else this._genRoot1 = c;
    }

    for (let slot = 0; slot < this.data.constants.MAX_SQUADS; slot++) {
      const root = new Container();
      const bg = new Graphics();
      const numHint = new Text({ text: String(slot + 1), style: { fill: 0x111111, fontSize: 13, fontWeight: 'bold', fontFamily: FONT } });
      numHint.anchor.set(0.5);
      const name = new Text({ text: '', style: { fill: 0xffffff, fontSize: 12, fontWeight: 'bold', fontFamily: FONT } });
      const dispo = new Text({ text: '', style: { fill: 0xffee88, fontSize: 11, fontFamily: FONT } });
      const command = new Text({ text: '', style: { fill: 0x9fd9ff, fontSize: 11, fontFamily: FONT } });
      const approach = new Text({ text: '', style: { fill: 0x9fd9ff, fontSize: 11, fontFamily: FONT } });
      const bar = makeBar(118, 8, 0x44cc44);
      const countLabel = new Text({ text: '', style: { fill: 0xdddddd, fontSize: 10, fontFamily: FONT } });
      root.addChild(bg, numHint, name, dispo, command, approach, bar.bg, bar.fg, countLabel);
      const card: SquadCard = { root, bg, numHint, name, dispo, command, approach, bar, countLabel, lastKey: '' };
      hitArea(root, 146, 108);
      root.on('pointertap', (e: FederatedPointerEvent) => {
        const additive = !!(e.shiftKey || e.ctrlKey);
        cb.onSelectSquad(slot, additive);
      });
      this.squadCards.push(card);
      this.root.addChild(root);
    }

    const all = new Button(56, MIN_TOUCH, 'All', 'A', () => cb.onSelectAll());
    const advance = new Button(84, MIN_TOUCH, 'Advance', 'Q', () => cb.onCommand('advance'));
    const hold = new Button(66, MIN_TOUCH, 'Hold', 'W', () => cb.onCommand('hold'));
    const fallBack = new Button(84, MIN_TOUCH, 'Fall Back', 'E', () => cb.onCommand('fallBack'));
    this.cmdButtons = { advance, hold, fallBack, all };
    this.root.addChild(all.root, advance.root, hold.root, fallBack.root);
    this.approachButtons = {
      direct: new Button(84, MIN_TOUCH, 'Direct', 'R', () => cb.onApproach('direct')),
      farFlank: new Button(84, MIN_TOUCH, 'Far Flank', 'T', () => cb.onApproach('farFlank')),
      nearFlank: new Button(84, MIN_TOUCH, 'Near Flank', 'Y', () => cb.onApproach('nearFlank')),
    };
    for (const button of Object.values(this.approachButtons)) this.root.addChild(button.root);

    this.pauseOverlay = new Container();
    const dim = new Graphics();
    const txt = new Text({ text: 'PAUSED — issue orders', style: { fill: 0xffffff, fontSize: 30, fontWeight: 'bold', fontFamily: FONT } });
    txt.anchor.set(0.5);
    const hint = new Text({
      text: 'SPACE resume · 1–4 select · Q/W/E orders · R/T/Y direct/far/near flank · disposition locked',
      style: { fill: 0xcccccc, fontSize: 14, fontFamily: FONT },
    });
    hint.anchor.set(0.5);
    this.pauseOverlay.addChild(dim, txt, hint);
    this._pauseDim = dim;
    this._pauseTxt = txt;
    this._pauseHint = hint;
    this.pauseOverlay.visible = false;
    this.pauseOverlay.eventMode = 'none'; // never blocks HUD clicks while paused
    this.root.addChild(this.pauseOverlay);

    this.resultBanner = new Container();
    this.resultBanner.visible = false;
    this.root.addChild(this.resultBanner);

    this.duelBanner = new Container();
    this.duelBanner.visible = false;
    this.root.addChild(this.duelBanner);
  }

  private _genRoot0!: Container;
  private _genRoot1!: Container;
  private _pauseDim!: Graphics;
  private _pauseTxt!: Text;
  private _pauseHint!: Text;
  private _specialMeterC!: Container;

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;

    this.topBg.clear();
    this.topBg.rect(0, 0, width, this.topH).fill({ color: 0x0c140c, alpha: 0.88 });
    this.topBg.rect(0, this.topH - 1, width, 1).fill({ color: 0x000000, alpha: 0.5 });
    this.bottomBg.clear();
    this.bottomBg.rect(0, height - this.bottomH, width, this.bottomH).fill({ color: 0x0c140c, alpha: 0.9 });
    this.bottomBg.rect(0, height - this.bottomH, width, 1).fill({ color: 0x000000, alpha: 0.5 });

    this.timerText.position.set(width / 2, 8);
    this.phaseText.position.set(width / 2, 36);

    this._genRoot0.position.set(14, 10);
    this._genRoot1.position.set(Math.max(250, width - 250), 10);
    this.layoutGeneral(this._genRoot0, 0);
    this.layoutGeneral(this._genRoot1, 1);
    this._specialMeterC.position.set(14, 52);

    this.pauseBtn.setPosition(width - 170, height - this.bottomH + 14);
    this.speedBtn.setPosition(width - 90, height - this.bottomH + 14);
    this.specialBtn.setPosition(width - 170, height - this.bottomH + 64);

    const cardW = 146;
    const cardGap = 8;
    const startX = 10;
    const bannerTop = height - this.bottomH + 8;
    this.squadCards.forEach((c, i) => c.root.position.set(startX + i * (cardW + cardGap), bannerTop));

    const cmdX = startX + 4 * (cardW + cardGap) + 14;
    const cmdY = bannerTop;
    const colGap = 8;
    const rowGap = 6;
    const colW = 84;
    this.cmdButtons.all.setPosition(cmdX, cmdY);
    this.cmdButtons.advance.setPosition(cmdX + colW + colGap, cmdY);
    this.cmdButtons.hold.setPosition(cmdX, cmdY + MIN_TOUCH + rowGap);
    this.cmdButtons.fallBack.setPosition(cmdX + colW + colGap, cmdY + MIN_TOUCH + rowGap);

    this.approachButtons.direct.setPosition(cmdX, cmdY + 110);
    this.approachButtons.farFlank.setPosition(cmdX + colW + colGap, cmdY + 110);
    this.approachButtons.nearFlank.setPosition(cmdX + 2 * (colW + colGap), cmdY + 110);

    this._pauseDim.clear();
    this._pauseDim.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.45 });
    this._pauseTxt.position.set(width / 2, height / 2 - 14);
    this._pauseHint.position.set(width / 2, height / 2 + 20);
  }

  private layoutGeneral(c: Container, side: 0 | 1): void {
    const labelX = side === 0 ? 38 : 38;
    this.generalLabel[side].position.set(labelX, 1);
    this.generalLevel[side].position.set(labelX, 16);
    this.generalHp[side].bg.position.set(labelX, 30);
    this.generalHp[side].fg.position.set(labelX, 30);
    this.generalHpLabel[side].position.set(labelX + 122, 31);
    this.generalMp[side].bg.position.set(labelX, 46);
    this.generalMp[side].fg.position.set(labelX, 46);
    this.generalMpLabel[side].position.set(labelX + 122, 46);
  }

  update(world: World, selectedSlots: number[] | 'all'): void {
    if (this.width === 0) return;
    const timerStr = world.phase === 'fight' || world.phase === 'duel' ? formatTimer(this.data.constants.SKIRMISH_TIME_S - world.fightTimeS) : '';
    if (timerStr !== this.lastTimerStr) {
      this.timerText.text = timerStr;
      this.lastTimerStr = timerStr;
    }
    let phaseStr = '';
    if (world.phase === 'deploy') {
      phaseStr = `DEPLOY ${Math.max(0, Math.ceil(world.deployRemainingS))}`;
    } else if (world.phase === 'duel') {
      phaseStr = 'DUEL';
    } else if (world.phase === 'fight') {
      phaseStr = '';
    }
    if (phaseStr !== this.lastPhaseStr) {
      this.phaseText.text = phaseStr;
      this.lastPhaseStr = phaseStr;
    }

    for (const s of [0, 1] as const) {
      const g = world.generals[s];
      const ents = world.ents;
      const hp = ents.hp[g.entity]!;
      const maxHp = ents.maxHp[g.entity]!;
      setBar(this.generalHp[s], hp / maxHp, hp / maxHp < 0.3 ? 0xcc4444 : 0x44cc44);
      setBar(this.generalMp[s], g.mp / g.maxMp, 0x4488ff);
      const hpStr = `${Math.round(hp)}/${Math.round(maxHp)}`;
      if (this.generalHpLabel[s].text !== hpStr) this.generalHpLabel[s].text = hpStr;
      const mpStr = `MP ${Math.round(g.mp)}/${Math.round(g.maxMp)}`;
      if (this.generalMpLabel[s].text !== mpStr) this.generalMpLabel[s].text = mpStr;
      const lvlStr = `Lv.${g.def.level ?? 1}`;
      if (this.generalLevel[s].text !== lvlStr) this.generalLevel[s].text = lvlStr;
    }

    const canFire = canFireSpecial(world, 0);
    setBar(this.specialMeter, world.generals[0].meter / this.data.constants.SPECIAL_METER_MAX, canFire ? 0x00ff66 : 0xffcc00);
    this.specialBtn.setDimmed(!canFire);
    const pulse = canFire ? 0.5 + 0.5 * Math.sin(performance.now() / 200) : 0;
    this.specialBtn.setGlow(pulse);

    this.squadCards.forEach((c, slot) => {
      const sq = world.squads.find((s) => s.side === 0 && s.slot === slot);
      if (!sq) {
        c.root.visible = false;
        return;
      }
      c.root.visible = true;
      const selected = selectedSlots === 'all' || selectedSlots.includes(slot);
      const intent = getSquadIntent(world, sq.index);
      const key = `${sq.name}|${sq.disposition}|${intent.command}|${intent.approach}|${intent.pending}|${selected}|${sq.alive}|${sq.total}`;
      if (key === c.lastKey) return;
      c.lastKey = key;

      c.bg.clear();
      const hue = squadColorNumberFor(this.sideColors[0], slot);
      const textColor = contrastMono(this.sideColors[0].squads[slot] ?? this.sideColors[0].team);
      c.bg.roundRect(0, 0, 146, 108, 8).fill({ color: selected ? 0x27392a : 0x15201a, alpha: 0.92 });
      c.bg.roundRect(0.5, 0.5, 145, 107, 8).stroke({ color: selected ? 0x8fe07a : 0x3c4a3f, width: selected ? 2 : 1 });
      c.bg.roundRect(0, 0, 6, 108, 3).fill({ color: hue });
      c.bg.circle(16, 16, 11).fill({ color: hue });
      c.numHint.position.set(16, 16);
      c.numHint.style.fill = textColor;

      c.name.position.set(32, 7);
      const dispoLabel = sq.disposition === 'fierce' ? 'Fierce' : sq.disposition === 'guard' ? 'Guard' : 'Mixed';
      if (c.name.text !== sq.name) c.name.text = sq.name;
      c.dispo.position.set(32, 26);
      c.dispo.text = `${dispoLabel} (locked)`;
      c.command.position.set(32, 42);
      c.command.text = `${commandLabel(intent.command)}${intent.pending ? ' *' : ''}`;
      c.approach.position.set(32, 58);
      c.approach.text = approachLabel(intent.approach);
      c.bar.bg.position.set(14, 82);
      c.bar.fg.position.set(14, 82);
      setBar(c.bar, sq.alive / Math.max(1, sq.total), sq.alive / Math.max(1, sq.total) < 0.3 ? 0xcc4444 : 0x44cc44);
      c.countLabel.position.set(14, 92);
      c.countLabel.text = `${sq.alive}/${sq.total}`;
    });

    this.cmdButtons.all.setActive(selectedSlots === 'all');
    const intents = world.squads.filter((s) => s.side === 0 && (selectedSlots === 'all' || selectedSlots.includes(s.slot))).map((s) => getSquadIntent(world, s.index));
    for (const cmd of ['advance', 'hold', 'fallBack'] as const) {
      this.cmdButtons[cmd].setActive(intents.length > 0 && intents.every((i) => i.command === cmd));
    }
    for (const approach of ['direct', 'farFlank', 'nearFlank'] as const) {
      this.approachButtons[approach].setActive(intents.length > 0 && intents.every((i) => i.approach === approach));
    }
    this.pauseBtn.setActive(world.paused);
    for (const b of [this.pauseBtn, this.speedBtn, this.specialBtn, this.cmdButtons.all, this.cmdButtons.advance, this.cmdButtons.hold, this.cmdButtons.fallBack, ...Object.values(this.approachButtons)]) b.tick();

    this.pauseOverlay.visible = world.paused && world.phase !== 'result';

    if (world.result) {
      this.resultBanner.visible = true;
      this.resultBanner.removeChildren();
      const winner = world.result.winner === 0 ? this.labels.player : this.labels.enemy;
      const reason = world.result.reason === 'duel' ? 'duel' : 'general defeated';
      const bg = new Graphics().rect(0, this.height / 2 - 40, this.width, 80).fill({ color: 0x000000, alpha: 0.65 });
      const t = new Text({ text: `${winner} wins (${reason})`, style: { fill: 0xffee88, fontSize: 28, fontWeight: 'bold', fontFamily: FONT } });
      t.anchor.set(0.5);
      t.position.set(this.width / 2, this.height / 2);
      this.resultBanner.addChild(bg, t);
    } else {
      this.resultBanner.visible = false;
    }

    if (world.phase === 'duel') {
      this.duelBanner.visible = true;
      if (this.duelBanner.children.length === 0) {
        const t = new Text({ text: 'DUEL', style: { fill: 0xff4444, fontSize: 36, fontWeight: 'bold', fontFamily: FONT } });
        t.anchor.set(0.5);
        this.duelBanner.addChild(t);
      }
      (this.duelBanner.getChildAt(0) as Text).position.set(this.width / 2, 100);
    } else {
      this.duelBanner.visible = false;
    }
  }

  setSpeedLabel(mult: 1 | 2): void {
    this.speedBtn.setLabel(`${mult}x`);
  }
}

function approachLabel(approach: Approach): string {
  return approach === 'direct' ? 'Direct' : approach === 'farFlank' ? 'Far Flank' : 'Near Flank';
}

function commandLabel(cmd: Command): string {
  return cmd === 'advance' ? 'Advance' : cmd === 'hold' ? 'Hold' : 'Fall Back';
}

// Screen-space HUD drawn in Pixi (implementation.md §6/§7.3-7.5). Real button chrome,
// no overlapping text, layout() repositions on resize. Text objects are updated only on change.
import { Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import type { GameData } from '../data';
import type { World } from '../sim';
import { canFireSpecial, getSquadIntent } from '../sim';
import { formatTimer } from '../battle/helpers';
import { getHudLayout, type HudLayout } from '../battle/hudLayout';
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
  onQuit?(): void;
}

/** Theme label face (src/ui/common/theme.css); the battle view loads it before building the HUD. */
const FONT = '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif';
const DISPLAY_FONT = 'Cinzel, Georgia, serif';
const MIN_TOUCH = 40;

interface Bar {
  bg: Graphics;
  fg: Graphics;
  w: number;
  h: number;
  lastFrac: number;
  lastColor: number;
}

function makeBar(w: number, h: number, color: number): Bar {
  const bg = new Graphics().roundRect(0, 0, w, h, 1).fill({ color: 0x05070a, alpha: 0.85 });
  const fg = new Graphics();
  const wrap = { bg, fg, w, h, lastFrac: -1, lastColor: -1 };
  setBar(wrap, 1, color);
  return wrap;
}

function setBar(bar: Bar, frac: number, color: number): void {
  const f = Math.max(0, Math.min(1, frac));
  if (Math.abs(f - bar.lastFrac) < 0.002 && color === bar.lastColor) return;
  bar.lastFrac = f;
  bar.lastColor = color;
  bar.fg.clear();
  const w = Math.max(bar.h, bar.w * f);
  if (f > 0) bar.fg.roundRect(0, 0, w, bar.h, 1).fill({ color });
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
    this.label = new Text({ text, style: { fill: 0xffffff, fontSize: 15, fontWeight: 'bold', fontFamily: FONT } });
    this.label.anchor.set(0.5);
    this.label.position.set(w / 2, h / 2);
    this.root.addChild(this.bg, this.label);
    if (keyHint) {
      this.hint = new Text({ text: keyHint, style: { fill: 0xbbbbbb, fontSize: 11, fontWeight: 'bold', fontFamily: FONT } });
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
    let fill = 0x191e29;
    if (this.active) fill = 0x4a3410;
    if (this.pressed) fill = 0x0d1017;
    else if (this.hovered) fill = this.active ? 0x5e4316 : 0x252c3b;
    bg.roundRect(0, 0, this.w, this.h, 2).fill({ color: fill, alpha: this.dimmed ? 0.55 : 0.92 });
    const borderColor = this.active ? 0xf5a93a : 0x56627c;
    bg.roundRect(0.5, 0.5, this.w - 1, this.h - 1, 2).stroke({ color: borderColor, width: this.active ? 2 : 1, alpha: this.dimmed ? 0.5 : 0.9 });
    if (this.glow > 0) {
      bg.roundRect(-2, -2, this.w + 4, this.h + 4, 4).stroke({ color: 0xf5c26b, width: 2, alpha: this.glow * 0.8 });
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
  private timerText: Text;
  private phaseText: Text;
  private pauseBtn: Button;
  private speedBtn: Button;
  private specialBtn: Button;
  private quitBtn: Button | null = null;
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
  private bottomH = 230;
  private geometry: HudLayout | null = null;
  private orderHeading = new Text({ text: 'Order', style: { fill: 0xffffff, fontSize: 15, fontWeight: 'bold', fontFamily: FONT } });
  private approachHeading = new Text({ text: 'Approach', style: { fill: 0xffffff, fontSize: 15, fontWeight: 'bold', fontFamily: FONT } });
  private detailTitle = new Text({ text: '', style: { fill: 0xf5c26b, fontSize: 14, fontWeight: 'bold', fontFamily: FONT } });
  private detailIntent = new Text({ text: '', style: { fill: 0x9fd9ff, fontSize: 14, fontFamily: FONT } });

  constructor(
    private data: GameData,
    private labels: { player: string; enemy: string },
    private sideColors: [SideColors, SideColors],
    private cb: HudCallbacks,
  ) {
    this.topBg = new Graphics();
    this.bottomBg = new Graphics();
    this.root.addChild(this.topBg, this.bottomBg, this.orderHeading, this.approachHeading, this.detailTitle, this.detailIntent);

    this.timerText = new Text({ text: '0:00', style: { fill: 0xffffff, fontSize: 24, fontWeight: 'bold', fontFamily: FONT } });
    this.timerText.anchor.set(0.5, 0);
    this.phaseText = new Text({ text: '', style: { fill: 0xf5c26b, fontSize: 15, fontWeight: 'bold', fontFamily: FONT } });
    this.phaseText.anchor.set(0.5, 0);
    this.root.addChild(this.timerText, this.phaseText);

    this.pauseBtn = new Button(72, MIN_TOUCH, 'Pause', 'SPACE', () => cb.onPauseToggle());
    this.speedBtn = new Button(56, MIN_TOUCH, '1x', 'F', () => cb.onSpeedToggle());
    this.specialBtn = new Button(100, MIN_TOUCH, 'Special', 'S', () => cb.onSpecial());
    this.root.addChild(this.pauseBtn.root, this.speedBtn.root, this.specialBtn.root);
    if (cb.onQuit) {
      this.quitBtn = new Button(96, MIN_TOUCH, 'Quit battle', 'Esc', () => cb.onQuit?.());
      this.root.addChild(this.quitBtn.root);
    }
    this.generalHp = [makeBar(120, 12, 0x44cc44), makeBar(120, 12, 0x44cc44)];
    this.generalMp = [makeBar(120, 7, 0x4488ff), makeBar(120, 7, 0x4488ff)];
    this.generalHpLabel = [
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 11, fontFamily: FONT } }),
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 11, fontFamily: FONT } }),
    ];
    this.generalMpLabel = [
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 13, fontFamily: FONT } }),
      new Text({ text: '', style: { fill: 0xffffff, fontSize: 13, fontFamily: FONT } }),
    ];
    this.generalLabel = [
      new Text({ text: labels.player, style: { fill: 0xffffff, fontSize: 16, fontWeight: 'bold', fontFamily: FONT } }),
      new Text({ text: labels.enemy, style: { fill: 0xffffff, fontSize: 16, fontWeight: 'bold', fontFamily: FONT } }),
    ];
    this.generalLevel = [
      new Text({ text: '', style: { fill: 0xbbbbbb, fontSize: 12, fontFamily: FONT } }),
      new Text({ text: '', style: { fill: 0xbbbbbb, fontSize: 12, fontFamily: FONT } }),
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
      const numHint = new Text({ text: String(slot + 1), style: { fill: 0x111111, fontSize: 15, fontWeight: 'bold', fontFamily: FONT } });
      numHint.anchor.set(0.5);
      const name = new Text({ text: '', style: { fill: 0xffffff, fontSize: 14, fontWeight: 'bold', fontFamily: FONT } });
      const dispo = new Text({ text: '', style: { fill: 0xf5c26b, fontSize: 13, fontFamily: FONT } });
      const command = new Text({ text: '', style: { fill: 0x9fd9ff, fontSize: 13, fontFamily: FONT } });
      const approach = new Text({ text: '', style: { fill: 0x9fd9ff, fontSize: 13, fontFamily: FONT } });
      const bar = makeBar(118, 8, 0x44cc44);
      const countLabel = new Text({ text: '', style: { fill: 0xdddddd, fontSize: 12, fontFamily: FONT } });
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
      style: { fill: 0xcccccc, fontSize: 16, fontFamily: FONT },
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

  layout(width: number, height: number): void {
    if (this.geometry && this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.geometry = getHudLayout(width, height);
    this.bottomH = this.geometry.bottomBand.height;

    this.topBg.clear();
    this.topBg.rect(0, 0, width, this.topH).fill({ color: 0x090b10, alpha: 0.88 });
    this.topBg.rect(0, this.topH - 1, width, 1).fill({ color: 0x000000, alpha: 0.5 });
    this.bottomBg.clear();
    this.bottomBg.rect(0, height - this.bottomH, width, this.bottomH).fill({ color: 0x090b10, alpha: 0.9 });
    this.bottomBg.rect(0, height - this.bottomH, width, 1).fill({ color: 0x000000, alpha: 0.5 });

    const layout = this.geometry!;
    this.timerText.position.set(layout.timer.x + layout.timer.width / 2, layout.timer.y);
    this.phaseText.position.set(layout.timer.x + layout.timer.width / 2, layout.timer.y + 30);
    [this._genRoot0, this._genRoot1].forEach((root, side) => {
      const r = layout.generals[side]!;
      root.position.set(r.x, r.y);
      this.layoutGeneral(root, side as 0 | 1);
    });
    const buttons = { ...this.cmdButtons, ...this.approachButtons, pause: this.pauseBtn, speed: this.speedBtn, special: this.specialBtn };
    if (this.quitBtn) this.quitBtn.setPosition(layout.buttons.quit.x, layout.buttons.quit.y);
    for (const key of Object.keys(buttons) as (keyof typeof buttons)[]) {
      const r = layout.buttons[key];
      buttons[key].setPosition(r.x, r.y);
    }
    this.squadCards.forEach((c, i) => {
      const r = layout.cards[i];
      if (!r) return;
      c.root.position.set(r.x, r.y);
      hitArea(c.root, r.width, r.height);
      c.lastKey = ''; // size changes invalidate the card chrome and text placement
    });
    this.orderHeading.position.set(layout.orderHeading.x, layout.orderHeading.y);
    this.approachHeading.position.set(layout.approachHeading.x, layout.approachHeading.y);
    this.detailTitle.position.set(layout.detail.x, layout.detail.y);
    this.detailIntent.position.set(layout.detail.x, layout.detail.y + 22);

    this._pauseDim.clear();
    const fieldHeight = Math.max(0, height - this.topH - this.bottomH);
    const fieldCenterY = this.topH + fieldHeight / 2;
    this._pauseDim.rect(0, this.topH, width, fieldHeight).fill({ color: 0x000000, alpha: 0.45 });
    this._pauseTxt.position.set(width / 2, fieldCenterY - 14);
    this._pauseHint.position.set(width / 2, fieldCenterY + 20);
    fitText(this._pauseHint, width - 32);
    for (const label of this.generalLabel) fitText(label, 210);
  }

  private layoutGeneral(c: Container, side: 0 | 1): void {
    const labelX = 38;
    this.generalLabel[side].position.set(labelX, 1);
    this.generalLevel[side].position.set(labelX, 16);
    this.generalHp[side].bg.position.set(labelX, 30);
    this.generalHp[side].fg.position.set(labelX, 30);
    this.generalHpLabel[side].position.set(labelX + 122, 31);
    this.generalMp[side].bg.position.set(labelX, 54);
    this.generalMp[side].fg.position.set(labelX, 54);
    this.generalMpLabel[side].position.set(labelX, 41);
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
      setBar(this.generalHp[s], hp / maxHp, hp / maxHp < 0.3 ? 0xea4b50 : 0x5bc86d);
      const fullMp = g.maxMp > 0 && g.mp >= g.maxMp - 1e-9;
      setBar(this.generalMp[s], g.maxMp > 0 ? g.mp / g.maxMp : 0, fullMp ? 0x7cc0ff : 0x4ea6ff);
      const hpStr = `${Math.round(hp)}/${Math.round(maxHp)}`;
      if (this.generalHpLabel[s].text !== hpStr) this.generalHpLabel[s].text = hpStr;
      const mpState = fullMp ? 'FULL' : world.phase === 'deploy' ? 'Waiting' : world.phase === 'result' ? 'Ended' : world.paused ? 'Paused' : 'Recharging';
      const mpStr = `MP ${fullMp ? Math.round(g.maxMp) : Math.floor(g.mp)}/${Math.round(g.maxMp)} · ${mpState}`;
      if (this.generalMpLabel[s].text !== mpStr) this.generalMpLabel[s].text = mpStr;
      const lvlStr = `Lv.${g.def.level ?? 1}`;
      if (this.generalLevel[s].text !== lvlStr) this.generalLevel[s].text = lvlStr;
    }

    const canFire = canFireSpecial(world, 0);
    this.quitBtn?.setDimmed(!!world.result);
    this.specialBtn.setLabel(canFire ? 'Cast Special' : 'Recharge MP');
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
      const r = this.geometry!.cards[slot]!;
      const compact = this.geometry!.compact;
      c.bg.roundRect(0, 0, r.width, r.height, 3).fill({ color: selected ? 0x2c2110 : 0x11141c, alpha: 0.92 });
      c.bg.roundRect(0.5, 0.5, r.width - 1, r.height - 1, 3).stroke({ color: selected ? 0xf5a93a : 0x2b3344, width: selected ? 2 : 1 });
      c.bg.roundRect(0, 0, 6, r.height, 3).fill({ color: hue });
      c.bg.circle(16, 16, 11).fill({ color: hue });
      c.numHint.position.set(16, 16);
      c.numHint.style.fill = textColor;

      c.name.position.set(32, 7);
      const dispoLabel = sq.disposition === 'fierce' ? 'Fierce' : sq.disposition === 'guard' ? 'Guard' : 'Mixed';
      setNameText(c.name, sq.name, r.width - 40);
      c.dispo.position.set(32, 26);
      c.dispo.text = `${dispoLabel} (fixed)`;
      c.dispo.visible = !compact;
      c.command.visible = !compact;
      c.approach.visible = !compact;
      c.command.position.set(32, 42);
      c.command.text = commandLabel(intent.command);
      c.approach.position.set(32, 58);
      c.approach.text = approachLabel(intent.approach);
      c.bar.bg.position.set(14, compact ? 30 : 82);
      c.bar.fg.position.set(14, compact ? 30 : 82);
      setBar(c.bar, sq.alive / Math.max(1, sq.total), sq.alive / Math.max(1, sq.total) < 0.3 ? 0xcc4444 : 0x44cc44);
      c.countLabel.position.set(14, compact ? 40 : 92);
      c.countLabel.text = `${sq.alive}/${sq.total}`;
    });

    this.cmdButtons.all.setActive(selectedSlots === 'all');
    const intents = world.squads.filter((s) => s.side === 0 && (selectedSlots === 'all' || selectedSlots.includes(s.slot))).map((s) => getSquadIntent(world, s.index));
    const squads = world.squads.filter((s) => s.side === 0 && (selectedSlots === 'all' || selectedSlots.includes(s.slot)));
    const consensus = (values: string[], mixed: string): string => values.length === 0 ? 'None selected' : values.every((v) => v === values[0]) ? values[0]! : mixed;
    const selection = selectedSlots === 'all' ? 'All squads' : squads.length === 1 ? squads[0]!.name : `${squads.length} squads selected`;
    const disposition = consensus(squads.map((s) => s.disposition === 'fierce' ? 'Fierce' : s.disposition === 'guard' ? 'Guard' : 'Mixed'), 'Mixed dispositions');
    const pending = intents.some((i) => i.pending) ? (world.paused ? ' · Pending on resume' : ' · Pending next tick') : '';
    setNameText(this.detailTitle, selection, this.geometry!.detail.width, ` · Disposition: ${disposition} (fixed)`);
    this.detailIntent.text = `Order: ${consensus(intents.map((i) => commandLabel(i.command)), 'Mixed orders')} · Approach: ${consensus(intents.map((i) => approachLabel(i.approach)), 'Mixed approaches')}${pending}`;
    for (const cmd of ['advance', 'hold', 'fallBack'] as const) {
      this.cmdButtons[cmd].setActive(intents.length > 0 && intents.every((i) => i.command === cmd));
    }
    for (const approach of ['direct', 'farFlank', 'nearFlank'] as const) {
      this.approachButtons[approach].setActive(intents.length > 0 && intents.every((i) => i.approach === approach));
    }
    this.pauseBtn.setActive(world.paused);
    this.quitBtn?.tick();
    for (const b of [this.pauseBtn, this.speedBtn, this.specialBtn, this.cmdButtons.all, this.cmdButtons.advance, this.cmdButtons.hold, this.cmdButtons.fallBack, ...Object.values(this.approachButtons)]) b.tick();

    this.pauseOverlay.visible = world.paused && world.phase !== 'result';

    if (world.result) {
      this.resultBanner.visible = true;
      this.resultBanner.removeChildren();
      const winner = world.result.winner === 0 ? this.labels.player : this.labels.enemy;
      const won = world.result.winner === 0;
      const reason = world.result.reason === 'duel' ? 'Settled by a duel between the generals' : won ? 'The enemy general has fallen' : 'Your general has fallen';
      const bg = new Graphics().rect(0, this.height / 2 - 62, this.width, 124).fill({ color: 0x05070a, alpha: 0.82 });
      bg.rect(0, this.height / 2 - 62, this.width, 2).fill({ color: won ? 0xf5a93a : 0xea4b50 }).rect(0, this.height / 2 + 60, this.width, 2).fill({ color: won ? 0xf5a93a : 0xea4b50 });
      const t = new Text({ text: `${winner} wins`, style: { fill: won ? 0xf5c26b : 0xe3e6ee, fontSize: 46, fontWeight: '900', fontFamily: DISPLAY_FONT, letterSpacing: 2 } });
      t.anchor.set(0.5);
      t.position.set(this.width / 2, this.height / 2 - 12);
      const sub = new Text({ text: reason.toUpperCase(), style: { fill: 0xe3e6ee, fontSize: 16, fontWeight: 'bold', fontFamily: FONT, letterSpacing: 2 } });
      sub.anchor.set(0.5);
      sub.position.set(this.width / 2, this.height / 2 + 32);
      this.resultBanner.addChild(bg, t, sub);
    } else {
      this.resultBanner.visible = false;
    }

    if (world.phase === 'duel') {
      this.duelBanner.visible = true;
      if (this.duelBanner.children.length === 0) {
        const t = new Text({ text: 'DUEL', style: { fill: 0xff5a4a, fontSize: 44, fontWeight: '900', fontFamily: DISPLAY_FONT, letterSpacing: 6, stroke: { color: 0x05070a, width: 6 } } });
        t.anchor.set(0.5);
        this.duelBanner.addChild(t);
      }
      (this.duelBanner.getChildAt(0) as Text).position.set(this.width / 2, 100);
    } else {
      this.duelBanner.visible = false;
    }
  }

  /** Screen-space reservation consumed by the battle camera/input owner after layout(). */
  getBottomBandHeight(): number {
    return this.bottomH;
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

/** Bound names at native font size, reserving space for the complete status suffix. */
function setNameText(text: Text, name: string, width: number, suffix = ''): void {
  const chars = Array.from(name);
  let length = Math.min(chars.length, 32);
  const display = () => `${chars.slice(0, length).join('')}${length < chars.length ? '…' : ''}${suffix}`;
  text.scale.set(1);
  text.text = display();
  while (text.width > width && length > 0) {
    length--;
    text.text = display();
  }
}

/** Fit fixed labels to their assigned horizontal space. Names use ellipsis instead. */
function fitText(text: Text, width: number): void {
  text.scale.set(1);
  if (text.width > width) text.scale.set(width / text.width, 1);
}

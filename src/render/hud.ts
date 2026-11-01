// Screen-space HUD drawn in Pixi (implementation.md §6). Updates text only on change.
import { Container, Graphics, Text } from 'pixi.js';
import type { GameData } from '../data';
import type { World } from '../sim';
import { canFireSpecial } from '../sim';
import { formatTimer } from '../battle/helpers';
import type { Selection } from '../battle/selection';

export interface HudCallbacks {
  onSelectSquad(slot: number, additive: boolean): void;
  onSelectAll(): void;
  onCommand(cmd: 'advance' | 'hold' | 'fallBack'): void;
  onSpecial(): void;
  onPauseToggle(): void;
  onSpeedToggle(): void;
}

interface Bar {
  bg: Graphics;
  fg: Graphics;
  w: number;
  h: number;
}

function makeBar(w: number, h: number, color: number): Bar {
  const bg = new Graphics().rect(0, 0, w, h).fill({ color: 0x222222 });
  const fg = new Graphics().rect(0, 0, w, h).fill({ color });
  const c = new Container();
  c.addChild(bg, fg);
  return { bg, fg, w, h };
}

function setBar(bar: Bar, frac: number, color: number): void {
  bar.fg.clear();
  bar.fg.rect(0, 0, Math.max(0, bar.w * Math.max(0, Math.min(1, frac))), bar.h).fill({ color });
}

function hitArea(c: Container, w: number, h: number): void {
  c.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= w && y >= 0 && y <= h };
  c.eventMode = 'static';
  c.cursor = 'pointer';
}

export class Hud {
  readonly root = new Container();
  private timerText: Text;
  private pauseBtn: Text;
  private speedBtn: Text;
  private specialBtn: Container;
  private specialLabel: Text;
  private specialMeter: Bar;
  private pauseOverlay: Container;
  private resultBanner: Container;
  private duelBanner: Container;
  private squadBanners: { root: Container; label: Text; hp: Bar }[] = [];
  private generalHp: [Bar, Bar];
  private generalMp: [Bar, Bar];
  private generalLabel: [Text, Text];
  private lastTimerStr = '';
  private width = 0;
  private height = 0;

  constructor(
    private data: GameData,
    private labels: { player: string; enemy: string },
    private cb: HudCallbacks,
  ) {
    this.timerText = new Text({ text: '0:00', style: { fill: 0xffffff, fontSize: 22, fontWeight: 'bold' } });
    this.timerText.anchor.set(0.5, 0);
    this.root.addChild(this.timerText);

    this.pauseBtn = this.makeButton('Pause', () => cb.onPauseToggle());
    this.speedBtn = this.makeButton('1x', () => cb.onSpeedToggle());

    this.specialBtn = new Container();
    this.specialLabel = new Text({ text: 'SPECIAL', style: { fill: 0xffffff, fontSize: 12, fontWeight: 'bold' } });
    this.specialLabel.anchor.set(0.5);
    this.specialMeter = makeBar(90, 10, 0xffcc00);
    this.specialBtn.addChild(this.specialMeter.bg, this.specialMeter.fg, this.specialLabel);
    this.specialLabel.position.set(45, -14);
    hitArea(this.specialBtn, 90, 10);
    this.specialBtn.on('pointertap', () => cb.onSpecial());
    this.root.addChild(this.specialBtn);

    this.generalHp = [makeBar(140, 10, 0x44cc44), makeBar(140, 10, 0x44cc44)];
    this.generalMp = [makeBar(140, 6, 0x4488ff), makeBar(140, 6, 0x4488ff)];
    this.generalLabel = [
      new Text({ text: labels.player, style: { fill: 0xffffff, fontSize: 13 } }),
      new Text({ text: labels.enemy, style: { fill: 0xffffff, fontSize: 13 } }),
    ];
    for (const s of [0, 1] as const) {
      const c = new Container();
      const badge = new Graphics().circle(0, 0, 14).fill({ color: s === 0 ? 0x3a7bd5 : 0xd5423a });
      c.addChild(badge, this.generalLabel[s], this.generalHp[s].bg, this.generalHp[s].fg, this.generalMp[s].bg, this.generalMp[s].fg);
      this.generalLabel[s].position.set(20, -10);
      this.generalHp[s].bg.position.set(20, 6);
      this.generalHp[s].fg.position.set(20, 6);
      this.generalMp[s].bg.position.set(20, 18);
      this.generalMp[s].fg.position.set(20, 18);
      this.root.addChild(c);
      (this as unknown as { [k: string]: Container }).__generalRoot = c;
      if (s === 0) this._genRoot0 = c;
      else this._genRoot1 = c;
    }

    for (let slot = 0; slot < this.data.constants.MAX_SQUADS; slot++) {
      const root = new Container();
      const bg = new Graphics().roundRect(0, 0, 150, 46, 4).fill({ color: 0x111111, alpha: 0.7 });
      const label = new Text({ text: '', style: { fill: 0xffffff, fontSize: 11 } });
      label.position.set(6, 4);
      const hp = makeBar(130, 6, 0x44cc44);
      hp.bg.position.set(6, 34);
      hp.fg.position.set(6, 34);
      root.addChild(bg, label, hp.bg, hp.fg);
      hitArea(root, 150, 46);
      root.on('pointertap', (e: { nativeEvent?: { shiftKey?: boolean; ctrlKey?: boolean } }) => {
        const additive = !!(e.nativeEvent?.shiftKey || e.nativeEvent?.ctrlKey);
        cb.onSelectSquad(slot, additive);
      });
      this.squadBanners.push({ root, label, hp });
      this.root.addChild(root);
    }

    const allBtn = this.makeButton('All', () => cb.onSelectAll());
    const advBtn = this.makeButton('Advance', () => cb.onCommand('advance'));
    const holdBtn = this.makeButton('Hold', () => cb.onCommand('hold'));
    const backBtn = this.makeButton('Fall Back', () => cb.onCommand('fallBack'));
    this._cmdButtons = [allBtn, advBtn, holdBtn, backBtn];

    this.pauseOverlay = new Container();
    const dim = new Graphics();
    const txt = new Text({ text: 'PAUSED — issue orders', style: { fill: 0xffffff, fontSize: 28, fontWeight: 'bold' } });
    txt.anchor.set(0.5);
    this.pauseOverlay.addChild(dim, txt);
    this._pauseDim = dim;
    this._pauseTxt = txt;
    this.pauseOverlay.visible = false;
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
  private _cmdButtons!: Text[];
  private _pauseDim!: Graphics;
  private _pauseTxt!: Text;

  private makeButton(label: string, onClick: () => void): Text {
    const t = new Text({ text: label, style: { fill: 0xffffff, fontSize: 14, fontWeight: 'bold' } });
    t.eventMode = 'static';
    t.cursor = 'pointer';
    const bg = new Graphics();
    t.addChild(bg);
    t.on('pointertap', onClick);
    this.root.addChild(t);
    return t;
  }

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.timerText.position.set(width / 2, 8);
    this._genRoot0.position.set(10, 10);
    this._genRoot1.position.set(width - 170, 10);
    this.pauseBtn.position.set(width - 70, height - 70);
    this.speedBtn.position.set(width - 70, height - 40);
    this.specialBtn.position.set(10, 60);

    const bannerY = height - 56;
    this.squadBanners.forEach((b, i) => b.root.position.set(10 + i * 158, bannerY));
    const [allBtn, advBtn, holdBtn, backBtn] = this._cmdButtons;
    allBtn!.position.set(10 + 4 * 158 + 10, bannerY);
    advBtn!.position.set(10 + 4 * 158 + 10, bannerY + 20);
    holdBtn!.position.set(10 + 4 * 158 + 80, bannerY + 20);
    backBtn!.position.set(10 + 4 * 158 + 10, bannerY + 36);

    this._pauseDim.clear();
    this._pauseDim.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.35 });
    this._pauseTxt.position.set(width / 2, height / 2);
  }

  update(world: World, selectedSlots: number[] | 'all'): void {
    if (this.width === 0) return;
    const timerStr = world.phase === 'fight' ? formatTimer(this.data.constants.SKIRMISH_TIME_S - world.fightTimeS) : '';
    if (timerStr !== this.lastTimerStr) {
      this.timerText.text = timerStr;
      this.lastTimerStr = timerStr;
    }

    for (const s of [0, 1] as const) {
      const g = world.generals[s];
      const ents = world.ents;
      setBar(this.generalHp[s], ents.hp[g.entity]! / ents.maxHp[g.entity]!, 0x44cc44);
      setBar(this.generalMp[s], g.mp / g.maxMp, 0x4488ff);
    }

    const canFire = canFireSpecial(world, 0);
    setBar(this.specialMeter, world.generals[0].meter / this.data.constants.SPECIAL_METER_MAX, canFire ? 0x00ff66 : 0xffcc00);
    this.specialBtn.alpha = canFire ? 1 : 0.6;

    this.squadBanners.forEach((b, slot) => {
      const sq = world.squads.find((s) => s.side === 0 && s.slot === slot);
      if (!sq) {
        b.root.visible = false;
        return;
      }
      b.root.visible = true;
      const selected = selectedSlots === 'all' || selectedSlots.includes(slot);
      (b.root.getChildAt(0) as Graphics).tint = selected ? 0xffee88 : 0xffffff;
      const dispoIcon = sq.disposition === 'fierce' ? '!' : sq.disposition === 'guard' ? 'G' : '~';
      const newLabel = `${slot + 1} ${sq.name} [${dispoIcon}] ${sq.command}\n${sq.alive}/${sq.total}`;
      if (b.label.text !== newLabel) b.label.text = newLabel;
      setBar(b.hp, sq.alive / Math.max(1, sq.total), 0x44cc44);
    });

    this.pauseOverlay.visible = world.paused && world.phase !== 'result';

    if (world.result) {
      this.resultBanner.visible = true;
      this.resultBanner.removeChildren();
      const winner = world.result.winner === 0 ? this.labels.player : this.labels.enemy;
      const reason = world.result.reason === 'duel' ? 'duel' : 'general defeated';
      const bg = new Graphics().rect(0, this.height / 2 - 40, this.width, 80).fill({ color: 0x000000, alpha: 0.6 });
      const t = new Text({ text: `${winner} wins (${reason})`, style: { fill: 0xffee88, fontSize: 28, fontWeight: 'bold' } });
      t.anchor.set(0.5);
      t.position.set(this.width / 2, this.height / 2);
      this.resultBanner.addChild(bg, t);
    } else {
      this.resultBanner.visible = false;
    }

    if (world.phase === 'duel') {
      this.duelBanner.visible = true;
      if (this.duelBanner.children.length === 0) {
        const t = new Text({ text: 'DUEL', style: { fill: 0xff4444, fontSize: 36, fontWeight: 'bold' } });
        t.anchor.set(0.5);
        this.duelBanner.addChild(t);
      }
      (this.duelBanner.getChildAt(0) as Text).position.set(this.width / 2, 100);
    } else {
      this.duelBanner.visible = false;
    }
  }
}

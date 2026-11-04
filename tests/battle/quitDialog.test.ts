import { afterEach, expect, it, vi } from 'vitest';
import { createQuitDialog } from '../../src/battle/quitDialog';
import { attachInput } from '../../src/battle/input';
import { Selection } from '../../src/battle/selection';
import { dom, ElementMock, key } from '../helpers/dom';
import type { World } from '../../src/sim';
afterEach(() => vi.unstubAllGlobals());
function fixture(paused = false) {
  vi.stubGlobal('document', dom);
  const root = new ElementMock(), world = { paused, result: null } as unknown as World;
  const onQuit = vi.fn();
  const dialog = createQuitDialog(root as unknown as HTMLElement, world, { onQuit, message: 'Forfeit this run?', confirmLabel: 'Forfeit run' });
  return { root, world, onQuit, dialog };
}
it.each([false, true])('pauses, labels, focuses Continue and restores prior pause (%s) on cancel', paused => {
  const { root, world, dialog, onQuit } = fixture(paused);
  dialog.open();
  expect(world.paused).toBe(true);
  expect(dialog.isOpen()).toBe(true);
  const modal = root.querySelector('dialog')!;
  expect(modal.getAttribute('aria-labelledby')).toBeTruthy();
  expect(modal.getAttribute('aria-describedby')).toBeTruthy();
  expect(dom.activeElement?.textContent).toBe('Continue battle');
  const cancel = new Event('cancel', { cancelable: true }); modal.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(world.paused).toBe(paused);
  expect(onQuit).not.toHaveBeenCalled();
  dialog.destroy(); expect(root.children).toHaveLength(0);
});
it('blocks keyboard behind the dialog; first Escape opens and prevents default, second cancels natively', () => {
  const { world, dialog } = fixture();
  const target = new EventTarget(), speed = vi.fn();
  const detach = attachInput(target as unknown as Document, world, new Selection(4), { onSpeedToggle: speed, onQuit: dialog.open, isBlocked: dialog.isOpen });
  expect(key(target, 'Escape').defaultPrevented).toBe(true);
  for (const k of [' ', 'f', 's', '1', 'q', 'Escape']) key(target, k);
  expect(world.paused).toBe(true); expect(speed).not.toHaveBeenCalled();
  detach(); dialog.destroy(); expect(world.paused).toBe(true);
});
it('confirms once, disallows quitting after results, and recovers from callback errors', () => {
  const { root, world, dialog, onQuit } = fixture();
  onQuit.mockImplementationOnce(() => { throw new Error('storage full'); });
  dialog.open(); root.querySelectorAll('button')[1]!.click();
  expect(dialog.isOpen()).toBe(true);
  expect(root.querySelector('[role=status]')?.textContent ?? root.children[0]!.children.map(c => c.textContent).join('')).toContain('storage full');
  dom.activeElement!.click(); // Continue remains available after failure.
  dialog.open(); root.querySelectorAll('button')[1]!.click();
  dialog.open(); expect(onQuit).toHaveBeenCalledTimes(2);
  dialog.destroy();
  const next = fixture(); next.world.result = {} as never; next.dialog.open();
  expect(next.dialog.isOpen()).toBe(false); next.dialog.destroy();
});

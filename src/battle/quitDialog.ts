import type { World } from '../sim';
import { setPaused } from '../sim';
import './quitDialog.css';

let nextDialogId = 0;

/** Native modal owns focus/inertness; destroy deliberately leaves an abandoned world paused. */
export function createQuitDialog(root: HTMLElement, world: World, opts: {
  onQuit(): void;
  message?: string;
  confirmLabel?: string;
}): { open(): void; isOpen(): boolean; destroy(): void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'dl-quit-dialog';
  const title = document.createElement('h2');
  const message = document.createElement('p');
  const error = document.createElement('p');
  const actions = document.createElement('div');
  const proceed = document.createElement('button');
  const confirm = document.createElement('button');
  const id = `dl-quit-${nextDialogId++}`;
  title.setAttribute('id', `${id}-title`);
  message.setAttribute('id', `${id}-message`);
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-message`);
  error.setAttribute('role', 'status');
  title.textContent = 'Quit battle?';
  message.textContent = opts.message ?? 'Leave this battle? Troops already fallen will remain lost.';
  proceed.textContent = 'Continue battle';
  proceed.setAttribute('autofocus', '');
  confirm.textContent = opts.confirmLabel ?? 'Quit battle';
  confirm.className = 'dl-quit-confirm';
  actions.className = 'dl-quit-actions';
  actions.append(proceed, confirm);
  dialog.append(title, message, error, actions);
  root.appendChild(dialog);
  let opened = false, destroyed = false, confirmed = false, priorPaused = false;
  let priorFocus: HTMLElement | null = null;
  function cancel(): void {
    if (!opened || destroyed || confirmed) return;
    opened = false;
    dialog.close();
    setPaused(world, priorPaused);
    if (priorFocus?.isConnected) priorFocus.focus();
  }
  function onCancel(e: Event): void { e.preventDefault(); cancel(); }
  function onConfirm(): void {
    if (!opened || destroyed || confirmed || world.result) return;
    try {
      opts.onQuit();
      confirmed = true;
      opened = false;
      if (!destroyed) dialog.close();
    } catch (e) {
      error.textContent = `Could not quit: ${e instanceof Error ? e.message : String(e)}`;
      proceed.focus();
    }
  }
  function onClose(): void { if (opened) cancel(); }
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onClose);
  proceed.addEventListener('click', cancel);
  confirm.addEventListener('click', onConfirm);
  return {
    open(): void {
      if (destroyed || confirmed || opened || world.result) return;
      priorPaused = world.paused;
      priorFocus = document.activeElement as HTMLElement | null;
      error.textContent = '';
      setPaused(world, true);
      opened = true;
      dialog.showModal();
      proceed.focus();
    },
    isOpen: () => opened,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      opened = false;
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      proceed.removeEventListener('click', cancel);
      confirm.removeEventListener('click', onConfirm);
      dialog.remove();
    },
  };
}

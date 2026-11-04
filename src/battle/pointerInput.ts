// Keep window-scoped input lifetimes bound to a single battle view.
export function bindDragEvents(
  canvas: EventTarget,
  windowTarget: EventTarget,
  callbacks: { down(event: PointerEvent): void; move(event: PointerEvent): void; end(): void },
): () => void {
  const down: EventListener = (event) => callbacks.down(event as PointerEvent);
  const move: EventListener = (event) => callbacks.move(event as PointerEvent);
  const end: EventListener = () => callbacks.end();
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('lostpointercapture', end);
  windowTarget.addEventListener('pointermove', move);
  windowTarget.addEventListener('pointerup', end);
  windowTarget.addEventListener('pointercancel', end);
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('lostpointercapture', end);
    windowTarget.removeEventListener('pointermove', move);
    windowTarget.removeEventListener('pointerup', end);
    windowTarget.removeEventListener('pointercancel', end);
    callbacks.end();
  };
}

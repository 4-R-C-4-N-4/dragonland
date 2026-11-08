// Pure camera math (pan/zoom clamp) — testable without Pixi/DOM.
import { projectGround, unprojectGround, type FieldProjection } from '../render/projection';
export interface Camera {
  x: number; // projected-plane center x
  y: number; // projected-plane center y
  zoom: number;
}

export interface CameraClampOpts {
  fieldW: number;
  fieldH: number;
  viewportW: number;
  viewportH: number;
  minZoom: number;
  maxZoom: number;
}

export function clampZoom(zoom: number, opts: CameraClampOpts): number {
  return Math.max(opts.minZoom, Math.min(opts.maxZoom, zoom));
}

/** Keeps the camera center within the field bounds given the current zoom/viewport. */
export function clampCamera(cam: Camera, opts: CameraClampOpts): Camera {
  const zoom = clampZoom(cam.zoom, opts);
  const halfVw = opts.viewportW / 2 / zoom;
  const halfVh = opts.viewportH / 2 / zoom;
  // If the view is bigger than the field, center on the field.
  const minX = Math.min(opts.fieldW / 2, halfVw);
  const maxX = Math.max(opts.fieldW / 2, opts.fieldW - halfVw);
  const minY = Math.min(opts.fieldH / 2, halfVh);
  const maxY = Math.max(opts.fieldH / 2, opts.fieldH - halfVh);
  const x = halfVw * 2 >= opts.fieldW ? opts.fieldW / 2 : Math.max(halfVw, Math.min(opts.fieldW - halfVw, cam.x));
  const y = halfVh * 2 >= opts.fieldH ? opts.fieldH / 2 : Math.max(halfVh, Math.min(opts.fieldH - halfVh, cam.y));
  void minX;
  void maxX;
  void minY;
  void maxY;
  return { x, y, zoom };
}

/** Camera framed to show the entire field inside the viewport (initial view). */
export function fitCamera(opts: CameraClampOpts): Camera {
  const zoom = clampZoom(Math.min(opts.viewportW / opts.fieldW, opts.viewportH / opts.fieldH) * 0.95, opts);
  return clampCamera({ x: opts.fieldW / 2, y: opts.fieldH / 2, zoom }, opts);
}

/**
 * Duel framing in projected space: centre between the two generals and zoom in up to 2x, but
 * never so far that either leaves the view (half-viewport margin around their gap).
 */
export function duelCamera(a: [number, number], b: [number, number], opts: CameraClampOpts): Camera {
  const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
  const fit = Math.min(dx > 0 ? (opts.viewportW * 0.6) / dx : Infinity, dy > 0 ? (opts.viewportH * 0.6) / dy : Infinity);
  const zoom = clampZoom(Math.min(2, fit), opts);
  return clampCamera({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, zoom }, opts);
}

/** World-space point -> screen-space point for a given camera + viewport. */
export function worldToScreen(wx: number, wy: number, cam: Camera, viewportW: number, viewportH: number): [number, number] {
  return [(wx - cam.x) * cam.zoom + viewportW / 2, (wy - cam.y) * cam.zoom + viewportH / 2];
}

export function screenToWorld(sx: number, sy: number, cam: Camera, viewportW: number, viewportH: number): [number, number] {
  return [(sx - viewportW / 2) / cam.zoom + cam.x, (sy - viewportH / 2) / cam.zoom + cam.y];
}

/** Ground-space simulation point through perspective and camera into the full screen. */
export function groundToScreen(wx: number, wy: number, projection: FieldProjection, cam: Camera, viewportW: number, viewportH: number, hudOffsetY = 0): [number, number] {
  const [px, py] = projectGround(projection, wx, wy);
  const [sx, sy] = worldToScreen(px, py, cam, viewportW, viewportH);
  return [sx, sy + hudOffsetY];
}

/** Exact inverse of groundToScreen, including the screen-space HUD centering offset. */
export function screenToGround(sx: number, sy: number, projection: FieldProjection, cam: Camera, viewportW: number, viewportH: number, hudOffsetY = 0): [number, number] {
  const [px, py] = screenToWorld(sx, sy - hudOffsetY, cam, viewportW, viewportH);
  return unprojectGround(projection, px, py);
}

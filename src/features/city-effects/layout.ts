export interface ScreenPoint { x: number; y: number }
export interface ScreenRect { left: number; top: number; right: number; bottom: number }
export interface LayoutMarker extends ScreenPoint { key: string; preview: boolean }

// The marker has a fixed 42×46 box; leave ten pixels between adjacent badges.
export const MARKER_WIDTH = 42;
export const MARKER_HEIGHT = 46;
const GAP = 10;
const STEP_X = MARKER_WIDTH + GAP;
const STEP_Y = MARKER_HEIGHT + GAP;
const PAD_X = MARKER_WIDTH / 2 + 5;
const PAD_Y = MARKER_HEIGHT / 2 + 5;

const conflicts = (a: ScreenPoint, b: ScreenPoint) => Math.abs(a.x - b.x) < STEP_X && Math.abs(a.y - b.y) < STEP_Y;
const intersects = (p: ScreenPoint, r: ScreenRect) => p.x + PAD_X > r.left && p.x - PAD_X < r.right && p.y + PAD_Y > r.top && p.y - PAD_Y < r.bottom;

/** Stable, nearest-free screen placement. Coordinates outside the map stay there:
 * panning must never pin offscreen projects to the viewport edge. The geographic
 * anchor is unchanged; the view draws a leader to badges that need an offset. */
export function layoutEffectMarkers(markers: readonly LayoutMarker[], width: number, height: number, obstacles: readonly ScreenRect[] = []): Map<string, ScreenPoint> {
  const result = new Map<string, ScreenPoint>();
  const occupied: ScreenPoint[] = [];
  const grid: ScreenPoint[] = [];
  for (let y = PAD_Y; y <= height - PAD_Y; y += STEP_Y) {
    for (let x = PAD_X; x <= width - PAD_X; x += STEP_X) grid.push({ x, y });
  }
  // Decisions precede preview; immutable keys make order independent of UI arrays.
  const ordered = [...markers].sort((a, b) => Number(a.preview) - Number(b.preview) || a.key.localeCompare(b.key));
  let needsPacking = false;
  for (const marker of ordered) {
    if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y) || marker.x < 0 || marker.x > width || marker.y < 0 || marker.y > height) {
      result.set(marker.key, marker);
      continue;
    }
    const origin = { x: Math.max(PAD_X, Math.min(width - PAD_X, marker.x)), y: Math.max(PAD_Y, Math.min(height - PAD_Y, marker.y)) };
    const distance = (point: ScreenPoint) => (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
    const candidates = [origin, ...grid].sort((a, b) => distance(a) - distance(b));
    const free = (p: ScreenPoint) => !occupied.some(other => conflicts(p, other));
    const unobstructed = candidates.find(p => free(p) && !obstacles.some(r => intersects(p, r)));
    const available = unobstructed ?? candidates.find(free);
    if (!unobstructed) needsPacking = true;
    const next = available ?? origin;
    result.set(marker.key, next);
    occupied.push(next);
  }
  // Unsnapped original positions can fragment free space. If that happened,
  // pack the visible set into the same regular grid to recover its full capacity.
  const visible = ordered.filter(m => Number.isFinite(m.x) && Number.isFinite(m.y) && m.x >= 0 && m.x <= width && m.y >= 0 && m.y <= height);
  if (needsPacking && grid.length >= visible.length) {
    const clear = grid.filter(p => !obstacles.some(r => intersects(p, r)));
    const remaining = clear.length >= visible.length ? clear : [...grid];
    for (const marker of visible) {
      remaining.sort((a, b) => (a.x - marker.x) ** 2 + (a.y - marker.y) ** 2 - ((b.x - marker.x) ** 2 + (b.y - marker.y) ** 2));
      result.set(marker.key, remaining.shift()!);
    }
  }
  return result;
}

import { GRID_COLS, MIN_H, MIN_W } from "./types";

/** Where a widget sits on the dashboard grid, in grid units. */
export interface GridRect { x: number; y: number; w: number; h: number }

function overlaps(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function isFree(rect: GridRect, others: GridRect[]): boolean {
  return !others.some((o) => overlaps(rect, o));
}

/**
 * The empty position closest to where a widget was asked to go. A position below
 * every other widget is always empty, so this always finds one.
 */
export function nearestFreeSpot(others: GridRect[], w: number, h: number, x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, GRID_COLS - w);
  const wantX = Math.max(0, Math.min(maxX, x));
  const wantY = Math.max(0, y);
  if (isFree({ x: wantX, y: wantY, w, h }, others)) return { x: wantX, y: wantY };

  const lowest = others.reduce((max, o) => Math.max(max, o.y + o.h), 0);
  const lastRow = Math.max(lowest, wantY);
  let best = { x: wantX, y: lastRow };
  let bestScore = Infinity;
  for (let row = 0; row <= lastRow; row++) {
    for (let col = 0; col <= maxX; col++) {
      if (!isFree({ x: col, y: row, w, h }, others)) continue;
      // A column is about twice as wide as a row is tall, so a column counts double
      // to make "closest" match the distance seen on screen.
      const score = ((col - wantX) * 2) ** 2 + (row - wantY) ** 2;
      if (score < bestScore) { bestScore = score; best = { x: col, y: row }; }
    }
  }
  return best;
}

function overlapArea(a: GridRect, b: GridRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Places one widget at `target` and moves the widgets in its way, so a widget can
 * be dropped anywhere, including onto other widgets.
 *
 * - A same-size widget mostly covered by the moved one swaps into the moved
 *   widget's old place (two same-size widgets trade places).
 * - Any other widget in the way is pushed down, and so on down the dashboard.
 * - Widgets not in the way keep their place, so gaps the user left stay.
 *
 * Always works from the layout as it was when the drag began, so dragging back
 * restores the widgets that were pushed aside.
 */
export function placeWithPush<T extends GridRect & { id: string }>(
  items: T[], movedId: string, target: GridRect, allowSwap = true,
): T[] {
  const orig = items.find((i) => i.id === movedId);
  if (!orig) return items;
  const moved = { ...orig, ...target };
  const rest = items.filter((i) => i.id !== movedId).map((i) => ({ ...i }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: T[] = [moved];
  let swapped = false;
  for (let k = 0; k < rest.length; k++) {
    const it = rest[k];
    if (!placed.some((p) => overlaps(p, it))) { placed.push(it); continue; }
    // Swap: a widget of the same size, mostly under the moved one, takes its old
    // place. Different sizes are pushed down instead, which is easier to predict.
    if (allowSwap && !swapped && it.w === moved.w && it.h === moved.h) {
      const cover = overlapArea(moved, it) / Math.min(it.w * it.h, moved.w * moved.h);
      const cand = { ...it, x: Math.min(orig.x, GRID_COLS - it.w), y: orig.y };
      const waiting = rest.slice(k + 1);
      if (cover >= 0.5 && isFree(cand, placed) && isFree(cand, waiting)) {
        swapped = true;
        placed.push(cand);
        continue;
      }
    }
    // Push down below whatever it collides with, until it is clear.
    while (placed.some((p) => overlaps(p, it))) {
      it.y = Math.max(...placed.filter((p) => overlaps(p, it)).map((p) => p.y + p.h));
    }
    placed.push(it);
  }
  // Same order as the input, so React keys and saved order stay stable.
  const byId = new Map(placed.map((p) => [p.id, p]));
  return items.map((i) => byId.get(i.id) ?? i);
}

/**
 * Moves every widget up as far as it can go without overlapping another, so no
 * empty rows are left above a widget. Widgets are settled top to bottom (then
 * left to right), so the order on screen is kept.
 */
export function compactUp<T extends GridRect & { id: string }>(items: T[]): T[] {
  const sorted = items.map((i) => ({ ...i })).sort((a, b) => a.y - b.y || a.x - b.x);
  const settled: T[] = [];
  for (const it of sorted) {
    while (it.y > 0 && isFree({ ...it, y: it.y - 1 }, settled)) it.y -= 1;
    settled.push(it);
  }
  const byId = new Map(settled.map((p) => [p.id, p]));
  return items.map((i) => byId.get(i.id) ?? i);
}

/**
 * The size closest to the one asked for that does not run into another widget.
 * Keeps the current size if no smaller size fits, which only happens when the
 * widget already overlapped another before the resize began.
 */
export function largestFreeSize(
  others: GridRect[], widget: GridRect, wantW: number, wantH: number,
): { w: number; h: number } {
  let best = { w: widget.w, h: widget.h };
  let bestLoss = Infinity;
  for (let w = wantW; w >= MIN_W; w--) {
    for (let h = wantH; h >= MIN_H; h--) {
      const loss = wantW - w + (wantH - h);
      if (loss < bestLoss && isFree({ x: widget.x, y: widget.y, w, h }, others)) {
        bestLoss = loss;
        best = { w, h };
      }
    }
  }
  return best;
}

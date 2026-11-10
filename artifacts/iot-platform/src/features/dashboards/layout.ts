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

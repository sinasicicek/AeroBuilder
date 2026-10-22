/**
 * Build-plate packing (2D shelf/skyline, multi-plate).
 *
 * Every printable part is exported centred on the plate by itself — correct for
 * printing one file at a time, but it makes any multi-file preview look like a
 * pile. This helper computes non-overlapping positions so the parts can be laid
 * out side by side, both for the `plate_all.stl` export and for the STL viewer.
 *
 * A whole aircraft does not fit one bed (the parts' total footprint is larger
 * than a 220×220 plate), so the packer spills onto extra plates instead of
 * pushing parts past the bed edge. `plate` in each placement is the page index.
 */
export interface PlateSize {
  w: number;
  h: number;
}

export interface PlatePlacement {
  x: number;
  y: number;
  row: number;
  /** plate (page) index, 0-based */
  plate: number;
  /** false when the part alone is bigger than the usable bed */
  fits: boolean;
}

export interface PlateArrangement {
  placements: PlatePlacement[];
  rows: number;
  plates: number;
  /** true when at least one part is larger than the bed by itself */
  overflow: boolean;
  /** bounding size of the packed result, plates included */
  used: { w: number; h: number };
}

/**
 * Packs boxes into rows (tallest first, so rows stay balanced), starting a new
 * plate whenever the next row would leave the bed. Returns one placement per
 * input size, in input order.
 */
export function arrangeOnPlates(
  sizes: PlateSize[],
  bedW: number,
  bedH: number,
  gap = 5,
  margin = 2,
  plateGap = 20,
): PlateArrangement {
  const availW = bedW - 2 * margin;
  const availH = bedH - 2 * margin;

  const order = sizes.map((s, i) => ({ i, ...s })).sort((a, b) => b.h - a.h || b.w - a.w);
  const placements: PlatePlacement[] = new Array(sizes.length);

  let plate = 0;
  let plateX = 0;
  let cursor = margin;      // x inside the current row
  let rowY = margin;        // y of the current row
  let rowH = 0;             // height of the current row
  let rowsInPlate = 0;
  let rowsTotal = 0;
  let overflow = false;
  let maxBottom = 0;
  let maxRight = 0;

  const nextRow = () => {
    cursor = margin;
    rowY += rowH + gap;
    rowH = 0;
    rowsTotal++;
  };
  const nextPlate = () => {
    plate++;
    plateX = plate * (bedW + plateGap);
    cursor = margin;
    rowY = margin;
    rowH = 0;
    rowsInPlate = 0;
    rowsTotal++;
  };

  for (const item of order) {
    const w = Math.max(item.w, 0.1);
    const h = Math.max(item.h, 0.1);

    // 1) Row is full → open the next row on this plate
    if (cursor > margin && cursor + w > availW) nextRow();

    // 2) Row would leave the bed → open a new plate (an empty plate means the
    //    part itself is too big: that is a genuine overflow)
    if (rowY + Math.max(rowH, h) > bedH - margin) {
      if (rowsInPlate > 0) nextPlate();
      else overflow = true;
    }
    if (w > availW || h > availH) overflow = true;

    const x = plateX + cursor;
    placements[item.i] = { x, y: rowY, row: rowsTotal, plate, fits: w <= availW && h <= availH };

    cursor += w + gap;
    rowH = Math.max(rowH, h);
    rowsInPlate++;
    if (rowY + rowH > maxBottom) maxBottom = rowY + rowH;
    if (x + w - plateX > maxRight) maxRight = x + w - plateX;
  }

  return {
    placements,
    rows: sizes.length ? rowsTotal + 1 : 0,
    plates: plate + 1,
    overflow,
    used: { w: plate * (bedW + plateGap) + maxRight, h: maxBottom },
  };
}

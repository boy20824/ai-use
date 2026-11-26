export type PerPage = 3 | 4 | 6
export type Orientation = 'landscape' | 'portrait'
export interface Layout {
  perPage: PerPage
  orientation: Orientation
}
interface Size {
  width: number
  height: number
}
interface Grid {
  cols: number
  rows: number
}

export function orientationFor(perPage: PerPage): Orientation {
  return perPage === 6 ? 'portrait' : 'landscape'
}

export const ORIGINAL_LAYOUT = { perPage: 3, orientation: orientationFor(3) } as const
const A4 = { width: 11906, height: 16838 }
const originalMargins = {
  top: 1134,
  right: 1440,
  bottom: 993,
  left: 1440,
  header: 851,
  footer: 567,
}
const tightMargins = { top: 1500, right: 567, bottom: 567, left: 567, header: 851, footer: 284 }
export const DOCX_LAYOUT = {
  columnWidth: (A4.height - originalMargins.left - originalMargins.right) / 3,
  // Keep the original 720 twips of clearance for header/footer and body paragraphs.
  imageHeight: A4.width - originalMargins.top - originalMargins.bottom - 720,
} as const
const grids: Record<PerPage, Grid[]> = {
  3: [
    { cols: 3, rows: 1 },
    { cols: 1, rows: 3 },
  ],
  4: [
    { cols: 4, rows: 1 },
    { cols: 2, rows: 2 },
    { cols: 1, rows: 4 },
  ],
  6: [
    { cols: 3, rows: 2 },
    { cols: 2, rows: 3 },
  ],
}

export function isOriginalLayout({ perPage, orientation }: Layout) {
  return perPage === 3 && orientation === 'landscape'
}

export function pageGeometry(layout: Layout) {
  const size = layout.orientation === 'landscape' ? { width: A4.height, height: A4.width } : A4
  return { ...size, margins: { ...(isOriginalLayout(layout) ? originalMargins : tightMargins) } }
}

export function cellSize(layout: Layout, { cols, rows }: Grid) {
  if (isOriginalLayout(layout)) {
    const columnWidth = Math.floor(DOCX_LAYOUT.columnWidth)
    const rowHeight = DOCX_LAYOUT.imageHeight
    return { columnWidth, rowHeight, width: columnWidth, height: rowHeight }
  }
  const { width, height, margins } = pageGeometry(layout)
  const columnWidth = Math.floor((width - margins.left - margins.right) / cols)
  // Leave room for the page break and the final body paragraph.
  const rowHeight = Math.floor((height - margins.top - margins.bottom - 450) / rows)
  // Allow clearance for the inline image's paragraph inside the exact-height row.
  return { columnWidth, rowHeight, width: columnWidth - 40, height: rowHeight - 80 }
}

export function imageScaleLimit(layout: Layout) {
  return isOriginalLayout(layout) ? Infinity : 15
}

export function fitImage(
  width: number,
  height: number,
  cell: Size,
  { maxTwipsPerPx = Infinity }: { maxTwipsPerPx?: number } = {},
) {
  const scale = Math.min(cell.width / width, cell.height / height, maxTwipsPerPx)
  return { cx: width * scale, cy: height * scale, scale, dpi: 1440 / scale }
}

export function summarizeSliceFit(
  sliceSizes: readonly Size[],
  cell: Size,
  maxTwipsPerPx = Infinity,
): { dpi: number; heightTip?: { height: number; percent: number } } | undefined {
  const options = { maxTwipsPerPx }
  let smallest: { slice: Size; fit: ReturnType<typeof fitImage> } | undefined
  for (const slice of sliceSizes) {
    const fit = fitImage(slice.width, slice.height, cell, options)
    if (!smallest || fit.scale < smallest.fit.scale) smallest = { slice, fit }
  }
  if (!smallest) return

  const { slice, fit } = smallest
  const summary = { dpi: fit.dpi }
  if (fit.cx * fit.cy >= 0.85 * cell.width * cell.height) return summary

  const height = Math.round((slice.width * cell.height) / cell.width)
  if (height < 1) return summary
  const scaleRatio = fitImage(slice.width, height, cell, options).scale / fit.scale
  if (scaleRatio < 1.1) return summary

  return { ...summary, heightTip: { height, percent: Math.round((scaleRatio - 1) * 100) } }
}

export function chooseGrid(
  perPage: PerPage,
  orientation: Orientation,
  sliceSizes: readonly Size[],
) {
  const layout = { perPage, orientation }
  let best = grids[perPage][0]
  if (
    isOriginalLayout(layout) ||
    (perPage === 6 && orientation === 'landscape') ||
    !sliceSizes.length
  )
    return { ...best }
  let bestScale = 0
  for (const grid of grids[perPage]) {
    const cell = cellSize(layout, grid)
    const scale = sliceSizes.reduce(
      (smallest, { width, height }) => Math.min(smallest, fitImage(width, height, cell).scale),
      Infinity,
    )
    if (scale > bestScale || (scale === bestScale && grid.cols < best.cols)) {
      best = grid
      bestScale = scale
    }
  }
  return { ...best }
}

export function pagesNeeded(total: number, perPage: PerPage) {
  return Math.ceil(total / perPage)
}

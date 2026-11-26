import { describe, expect, it } from 'vitest'
import {
  cellSize,
  chooseGrid,
  DOCX_LAYOUT,
  fitImage,
  imageScaleLimit,
  orientationFor,
  ORIGINAL_LAYOUT,
  pageGeometry,
  pagesNeeded,
  summarizeSliceFit,
  type Orientation,
  type PerPage,
} from './layout'

describe('A4 screenshot layout', () => {
  it.each([
    [3, 'landscape'],
    [4, 'landscape'],
    [6, 'portrait'],
  ] as const)('uses %s images per page in %s', (perPage, orientation) => {
    expect(orientationFor(perPage)).toBe(orientation)
  })

  it('keeps the original section geometry, three columns, and uncapped image sizing', () => {
    expect(pageGeometry(ORIGINAL_LAYOUT)).toEqual({
      width: 16838,
      height: 11906,
      margins: { top: 1134, left: 1440, right: 1440, bottom: 993, header: 851, footer: 567 },
    })
    expect(DOCX_LAYOUT).toEqual({ columnWidth: 13958 / 3, imageHeight: 9059 })
    const grid = chooseGrid(3, 'landscape', [{ width: 2000, height: 100 }])
    expect(grid).toEqual({ cols: 3, rows: 1 })
    const cell = cellSize(ORIGINAL_LAYOUT, grid)
    expect(cell).toEqual({ columnWidth: 4652, rowHeight: 9059, width: 4652, height: 9059 })
    expect(fitImage(10, 10, cell, { maxTwipsPerPx: imageScaleLimit(ORIGINAL_LAYOUT) }).cx).toBe(
      4652,
    )
  })

  it.each<[PerPage, Orientation, number, number, number]>([
    [3, 'portrait', 100, 3000, 3],
    [3, 'portrait', 3000, 100, 1],
    [4, 'portrait', 100, 3000, 4],
    [4, 'portrait', 500, 1000, 2],
    [4, 'portrait', 3000, 100, 1],
    [4, 'landscape', 100, 3000, 4],
    [4, 'landscape', 1000, 1000, 2],
    [4, 'landscape', 3000, 100, 1],
    [6, 'portrait', 100, 3000, 3],
    [6, 'portrait', 500, 1000, 3],
    [6, 'portrait', 1080, 1350, 2],
    [6, 'portrait', 1080, 1792, 3],
    [6, 'portrait', 1000, 1000, 2],
    [6, 'portrait', 3000, 100, 2],
    [6, 'landscape', 100, 3000, 3],
    [6, 'landscape', 1000, 1000, 3],
    [6, 'landscape', 1000, 500, 3],
    [6, 'landscape', 3000, 100, 3],
  ])(
    'fits %i slices in %s for %i × %i pixels (%i columns)',
    (perPage, orientation, width, height, cols) => {
      expect(chooseGrid(perPage, orientation, [{ width, height }])).toEqual({
        cols,
        rows: perPage / cols,
      })
    },
  )

  it.each(['landscape', 'portrait'] as const)(
    'keeps six-up grids multi-row and multi-column in %s',
    (orientation) => {
      const sizes = [
        { width: 100, height: 3000 },
        { width: 1000, height: 1000 },
        { width: 3000, height: 100 },
      ]
      for (const slices of [[], ...sizes.map((size) => [size]), sizes]) {
        const { cols, rows } = chooseGrid(6, orientation, slices)
        expect(cols).toBeGreaterThan(1)
        expect(rows).toBeGreaterThan(1)
        expect(cols * rows).toBe(6)
      }
    },
  )

  it('maximizes the worst fit across all slices and breaks exact ties toward fewer columns', () => {
    const tall = { width: 100, height: 3000 }
    const wide = { width: 3000, height: 100 }
    expect(chooseGrid(4, 'landscape', [tall, wide])).toEqual({ cols: 2, rows: 2 })
    expect(chooseGrid(4, 'landscape', [wide, tall])).toEqual({ cols: 2, rows: 2 })
    const tie = { width: 3550, height: 4693 }
    const layout = { perPage: 3, orientation: 'portrait' } as const
    for (const grid of [
      { cols: 1, rows: 3 },
      { cols: 3, rows: 1 },
    ]) {
      expect(fitImage(tie.width, tie.height, cellSize(layout, grid)).scale).toBe(1)
    }
    expect(chooseGrid(3, 'portrait', [tie])).toEqual({ cols: 1, rows: 3 })
    expect(chooseGrid(6, 'portrait', [tall, wide])).toEqual({ cols: 2, rows: 3 })
    expect(chooseGrid(6, 'portrait', [tie])).toEqual({ cols: 2, rows: 3 })
  })

  it('fits width or height proportionally and caps the scale at 15 twips per pixel for new layouts', () => {
    const cell = { width: 4000, height: 3000 }
    expect(fitImage(800, 400, cell)).toEqual({ cx: 4000, cy: 2000, scale: 5, dpi: 288 })
    expect(fitImage(400, 1200, cell)).toEqual({ cx: 1000, cy: 3000, scale: 2.5, dpi: 576 })
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (const perPage of [3, 4, 6] as const) {
        if (perPage === 3 && orientation === 'landscape') continue
        const maxTwipsPerPx = imageScaleLimit({ perPage, orientation })
        expect(fitImage(100, 50, cell, { maxTwipsPerPx })).toEqual({
          cx: 1500,
          cy: 750,
          scale: 15,
          dpi: 96,
        })
      }
    }
  })

  it.each<[number, PerPage, number]>([
    [0, 3, 0],
    [6, 3, 2],
    [7, 3, 3],
    [7, 4, 2],
    [7, 6, 2],
    [12, 6, 2],
  ])('needs %i slices at %i per page (%i pages)', (total, perPage, pages) =>
    expect(pagesNeeded(total, perPage)).toBe(pages),
  )
})

describe('slice height tip', () => {
  const cell = { width: 400, height: 300 }

  it('uses the cropped width of the smallest-scale slice and the rounded height', () => {
    const wide = { width: 400, height: 20 }
    const tall = { width: 202, height: 401 }
    expect(summarizeSliceFit([wide, tall], cell)).toEqual({
      dpi: 1924.8,
      heightTip: { height: 152, percent: 164 },
    })
  })

  it('requires strictly less than 85% cell utilisation', () => {
    expect(summarizeSliceFit([{ width: 340, height: 300 }], cell)).toEqual({ dpi: 1440 })
    expect(summarizeSliceFit([{ width: 339, height: 300 }], cell)).toEqual({
      dpi: 1440,
      heightTip: { height: 254, percent: 18 },
    })
  })

  it('uses the scale limit and requires at least 10% improvement before rounding', () => {
    const sizes = [{ width: 10, height: 10 }]
    const wideCell = { width: 200, height: 100 }
    expect(summarizeSliceFit(sizes, wideCell, 10.99)).toEqual({ dpi: 144 })
    expect(summarizeSliceFit(sizes, wideCell, 11)).toEqual({
      dpi: 144,
      heightTip: { height: 5, percent: 10 },
    })
  })

  it('omits the tip when the current fit already hits the width or scale limit', () => {
    expect(summarizeSliceFit([{ width: 100, height: 10 }], cell)).toEqual({ dpi: 360 })
    expect(summarizeSliceFit([{ width: 10, height: 10 }], cell, 15)).toEqual({ dpi: 96 })
    expect(summarizeSliceFit([], cell)).toBeUndefined()
  })
})

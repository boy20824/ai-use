import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  clampScroll,
  edgeVelocity,
  nearbyCuts,
  sourceRow,
  sourceScale,
  visibleTiles,
} from './scrollGeometry'
import { defaultCuts } from './core'

describe('source scroll geometry', () => {
  it('uses native pixels or fit width, never upscales; maps border/padding-adjusted scroll coordinates', () => {
    expect(sourceScale(400, 800)).toBe(1)
    expect(sourceScale(1200, 600)).toBe(0.5)
    expect(sourceRow(257, 107, 1000, 1)).toBe(1150)
    expect(sourceRow(257, 107, 1000, 0.5)).toBe(2300)
    expect(clampScroll(-1, 50003, 700)).toBe(0)
    expect(clampScroll(1e9, 50003, 700)).toBe(49303)
    expect(clampScroll(10, 50, 700)).toBe(0)
    expect(edgeVelocity(100, 100, 700)).toBe(-720)
    expect(edgeVelocity(800, 100, 700)).toBe(720)
    expect(edgeVelocity(450, 100, 700)).toBe(0)
  })
  it('bounds tile/cut DOM across every scroll position of 50003 rows, including fit and wide memory bands', () => {
    const manifest = [1, 0.5, 0.1].map((scale) => {
      let maxTiles = 0,
        maxLines = 0
      for (let scroll = 0; scroll < 50003 * scale; scroll += 137) {
        const tiles = visibleTiles(800, 50003, scale, scroll, 700)
        expect(tiles.every((t) => t.end - t.start <= 2048 && t.end <= 50003 && t.start >= 0)).toBe(
          true,
        )
        maxTiles = Math.max(maxTiles, tiles.length)
        maxLines = Math.max(
          maxLines,
          nearbyCuts(defaultCuts(50003), (scroll - 44) / scale, (scroll + 744) / scale).length,
        )
      }
      expect(maxTiles).toBeLessThanOrEqual(Math.ceil(700 / scale / 2048) + 3)
      return { scale, maxTiles, maxLines, sourceHeight: 50003, viewportHeight: 700 }
    })
    expect(
      visibleTiles(100000, 50003, 1, 1000, 700).every(
        (t) => (t.end - t.start) * 100000 * 4 <= 16 * 1024 ** 2,
      ),
    ).toBe(true)
    mkdirSync('evidence/splitter-scroll', { recursive: true })
    writeFileSync(
      'evidence/splitter-scroll/geometry.json',
      JSON.stringify(manifest, null, 2) + '\n',
    )
  })
})

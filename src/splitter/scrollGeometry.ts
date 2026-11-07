import { bandRows } from './core'

export const TILE_ROWS = 2048
export const clampScroll = (scroll: number, height: number, viewport: number) =>
  Math.max(0, Math.min(scroll, Math.max(0, height - viewport)))
export const sourceScale = (width: number, available: number) =>
  Math.min(1, Math.max(1, available) / width)
export function sourceRow(clientY: number, contentTop: number, scroll: number, scale: number) {
  return (clientY - contentTop + scroll) / scale
}
export function visibleTiles(
  width: number,
  height: number,
  scale: number,
  scroll: number,
  viewport: number,
) {
  const rows = Math.min(TILE_ROWS, bandRows(width))
  const first = Math.max(0, Math.floor(scroll / scale / rows) - 1)
  const last = Math.min(Math.ceil(height / rows), Math.ceil((scroll + viewport) / scale / rows) + 1)
  return Array.from({ length: Math.max(0, last - first) }, (_, i) => ({
    start: (first + i) * rows,
    end: Math.min(height, (first + i + 1) * rows),
  }))
}
export function nearbyCuts(cuts: number[], top: number, bottom: number) {
  // Binary search avoids scanning every cut on each scroll frame.
  let low = 0,
    high = cuts.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (cuts[mid] < top) low = mid + 1
    else high = mid
  }
  const result: number[] = []
  for (let i = low; i < cuts.length && cuts[i] <= bottom; i++) result.push(i)
  return result
}
export function edgeVelocity(pointer: number, top: number, height: number) {
  const edge = Math.min(48, height / 3)
  if (edge <= 0) return 0
  if (pointer < top + edge) return -720 * Math.min(1, (top + edge - pointer) / edge)
  if (pointer > top + height - edge)
    return 720 * Math.min(1, (pointer - top - height + edge) / edge)
  return 0
}

import { prefersReducedMotion } from './usePointerMotion'

export function animateCount(el: HTMLElement, to: number, duration = 600): () => void {
  if (prefersReducedMotion() || to <= 0 || duration <= 0) {
    el.textContent = String(to)
    return () => {}
  }

  el.textContent = '0'
  const start = performance.now()
  let frame = requestAnimationFrame(tick)

  function tick(now: number) {
    const progress = Math.min(1, Math.max(0, (now - start) / duration))
    el.textContent = String(Math.round(to * (1 - (1 - progress) ** 3)))
    if (progress < 1) frame = requestAnimationFrame(tick)
  }

  return () => cancelAnimationFrame(frame)
}

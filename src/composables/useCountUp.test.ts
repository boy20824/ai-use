// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { animateCount } from './useCountUp'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  { reducedMotion: true, value: 12 },
  { reducedMotion: false, value: 0 },
])(
  'writes $value immediately with reduced motion set to $reducedMotion',
  ({ reducedMotion, value }) => {
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }))
    const requestFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    const el = document.createElement('span')

    animateCount(el, value)

    expect(el.textContent).toBe(String(value))
    expect(requestFrame).not.toHaveBeenCalled()
  },
)

it('eases from zero to the final count in 600 milliseconds', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.spyOn(performance, 'now').mockReturnValue(100)
  const requestFrame = vi.fn<(callback: FrameRequestCallback) => number>()
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  const el = document.createElement('span')

  animateCount(el, 24)
  expect(el.textContent).toBe('0')

  requestFrame.mock.calls[0]![0](400)
  expect(el.textContent).toBe('21')
  requestFrame.mock.calls[1]![0](700)
  expect(el.textContent).toBe('24')
  expect(requestFrame).toHaveBeenCalledTimes(2)
})

it('cancels the pending frame when cleaned up', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(42))
  const cancelFrame = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)

  const cancel = animateCount(document.createElement('span'), 24)
  cancel()

  expect(cancelFrame).toHaveBeenCalledWith(42)
})

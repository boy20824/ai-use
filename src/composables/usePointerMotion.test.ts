// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'
import { useCorgiMotion, useSpotlight } from './usePointerMotion'

let app: App | undefined

function mountMotion(reducedMotion: boolean, fineHover: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches:
        (query === '(prefers-reduced-motion: reduce)' && reducedMotion) ||
        (query === '(hover: hover) and (pointer: fine)' && fineHover),
    })),
  )
  let corgi!: ReturnType<typeof useCorgiMotion>
  const host = document.createElement('div')
  app = createApp({
    setup() {
      corgi = useCorgiMotion()
      const { onMove } = useSpotlight()
      return () =>
        h('div', {
          onPointermove: [corgi.onParallax, onMove],
        })
    },
  })
  app.mount(host)
  const target = host.firstElementChild as HTMLElement
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 100))
  return { corgi, target }
}

afterEach(() => {
  app?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  { reducedMotion: true, fineHover: true },
  { reducedMotion: false, fineHover: false },
])(
  'disables pointer motion with reduced motion $reducedMotion and fine hover $fineHover',
  ({ reducedMotion, fineHover }) => {
    const { corgi, target } = mountMotion(reducedMotion, fineHover)
    corgi.hopOnce()
    target.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 60 }))

    expect(corgi.hopping.value).toBe(false)
    expect(corgi.parallaxStyle.value).toEqual({ '--rx': '0.00deg', '--ry': '0.00deg' })
    expect(target.style.getPropertyValue('--mx')).toBe('')
    expect(target.style.getPropertyValue('--my')).toBe('')
  },
)

it('hops with fine hover and can hop again after the scoped animation ends', () => {
  const { corgi } = mountMotion(false, true)
  corgi.hopOnce()
  expect(corgi.hopping.value).toBe(true)

  corgi.onHopEnd({ animationName: 'corgi-breathe-scope' })
  expect(corgi.hopping.value).toBe(true)
  corgi.onHopEnd({ animationName: 'corgi-hop-scope' })
  expect(corgi.hopping.value).toBe(false)

  corgi.hopOnce()
  expect(corgi.hopping.value).toBe(true)
})

it('clamps parallax to four degrees and tracks the spotlight relative to the target', () => {
  const { corgi, target } = mountMotion(false, true)
  target.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 60 }))
  expect(target.style.getPropertyValue('--mx')).toBe('30px')
  expect(target.style.getPropertyValue('--my')).toBe('40px')

  target.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 180 }))
  expect(corgi.parallaxStyle.value).toEqual({ '--rx': '-4.00deg', '--ry': '4.00deg' })
  target.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }))
  expect(corgi.parallaxStyle.value).toEqual({ '--rx': '4.00deg', '--ry': '-4.00deg' })

  corgi.resetParallax()
  expect(corgi.parallaxStyle.value).toEqual({ '--rx': '0.00deg', '--ry': '0.00deg' })
})

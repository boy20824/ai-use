import { computed, onMounted, ref, type CSSProperties } from 'vue'

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  )
}

export function hasFineHover() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false)
  )
}

export function useCorgiMotion() {
  const hopping = ref(false)
  const rx = ref(0)
  const ry = ref(0)
  const enabled = ref(false)

  onMounted(() => {
    enabled.value = !prefersReducedMotion() && hasFineHover()
  })

  function hopOnce() {
    if (!enabled.value || hopping.value) return
    hopping.value = true
  }

  function onHopEnd(event: Pick<AnimationEvent, 'animationName'>) {
    // Vue appends a scope identifier to keyframe names in scoped styles.
    if (event.animationName !== 'corgi-hop' && !event.animationName.startsWith('corgi-hop-')) return
    hopping.value = false
  }

  function onParallax(event: PointerEvent) {
    if (!enabled.value) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1
    rx.value = Math.max(-4, Math.min(4, -ny * 4))
    ry.value = Math.max(-4, Math.min(4, nx * 4))
  }

  function resetParallax() {
    rx.value = 0
    ry.value = 0
  }

  const parallaxStyle = computed((): CSSProperties => ({
    '--rx': `${rx.value.toFixed(2)}deg`,
    '--ry': `${ry.value.toFixed(2)}deg`,
  }))

  return { hopping, parallaxStyle, hopOnce, onHopEnd, onParallax, resetParallax }
}

export function useSpotlight() {
  const enabled = ref(false)
  onMounted(() => {
    enabled.value = !prefersReducedMotion() && hasFineHover()
  })

  function onMove(event: PointerEvent) {
    if (!enabled.value) return
    const el = event.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${event.clientX - rect.left}px`)
    el.style.setProperty('--my', `${event.clientY - rect.top}px`)
  }

  return { onMove }
}

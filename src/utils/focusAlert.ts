export function focusAlert(element: HTMLElement | null | undefined) {
  element?.scrollIntoView({ block: 'nearest' })
  element?.focus({ preventScroll: true })
}

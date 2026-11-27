import { nextTick } from 'vue'

export async function restoreMoveFocus(button: HTMLButtonElement) {
  await nextTick()
  if (document.activeElement !== document.body && document.activeElement !== button) return
  const opposite = button.parentElement?.querySelector<HTMLButtonElement>(
    button.dataset.move === 'up' ? '[data-move="down"]' : '[data-move="up"]',
  )
  const target = button.disabled ? opposite : button
  if (target && !target.disabled) target.focus()
}

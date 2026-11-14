import { vi } from 'vitest'
import type { Router } from 'vue-router'

// Existing workbench regression tests explicitly accept the new leave dialog.
export async function confirmedNavigation(router: Router, path: string) {
  let finished = false
  const navigation = router.push(path).finally(() => {
    finished = true
  })
  await vi.waitFor(() => {
    if (finished) return
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((element) =>
      element.textContent?.includes('離開工作台？'),
    )
    const confirm = dialog?.querySelector<HTMLButtonElement>('.btn-primary')
    if (!confirm) throw new Error('Waiting for navigation or leave confirmation')
    confirm.click()
  })
  await navigation
}

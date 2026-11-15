// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'

let app: App
let host: HTMLDivElement
afterEach(() => {
  app?.unmount()
  host?.remove()
})
async function mount(tone?: 'danger' | 'default') {
  const open = ref(false)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h('div', [
        h(
          'button',
          {
            onClick: () => {
              open.value = true
            },
          },
          'Open',
        ),
        open.value
          ? h(
              ConfirmDialog,
              {
                title: 'Mock delete',
                tone,
                onCancel: () => {
                  open.value = false
                },
                onConfirm: () => {
                  open.value = false
                },
              },
              () => 'Mock content will be lost.',
            )
          : null,
        h('button', 'Outside'),
      ]),
  })
  app.mount(host)
  const opener = host.querySelector('button')!
  opener.focus()
  opener.click()
  await nextTick()
  return opener
}
function key(key: string, shiftKey = false) {
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
  )
}
it('moves focus inside, cancels with Escape, and restores the opener', async () => {
  const opener = await mount()
  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
    'Mock delete',
  )
  expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain(
    'will be lost',
  )
  key('Escape')
  await nextTick()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
})
it('cycles Tab and Shift+Tab within the dialog and blocks outside focus', async () => {
  await mount()
  const buttons = host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
  buttons[0]!.focus()
  key('Tab')
  expect(document.activeElement).toBe(buttons[1])
  key('Tab')
  expect(document.activeElement).toBe(buttons[0])
  key('Tab', true)
  expect(document.activeElement).toBe(buttons[1])
  key('Tab', true)
  expect(document.activeElement).toBe(buttons[0])
  const outside = [...host.querySelectorAll<HTMLButtonElement>('button')].at(-1)!
  expect(outside.textContent).toBe('Outside')
  outside.focus()
  expect(host.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true)
})
it('restores focus after clicking cancel or confirming', async () => {
  const opener = await mount()
  host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-secondary')!.click()
  await nextTick()
  expect(document.activeElement).toBe(opener)
  opener.click()
  await nextTick()
  host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-primary')!.click()
  await nextTick()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('uses danger styling for destructive confirmation and restores focus on confirm', async () => {
  const opener = await mount('danger')
  const confirm = host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-danger')!
  expect(confirm).not.toBeNull()
  expect(confirm.classList.contains('btn-primary')).toBe(false)
  confirm.click()
  await nextTick()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

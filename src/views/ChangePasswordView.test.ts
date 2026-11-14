// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import ChangePasswordView from './ChangePasswordView.vue'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  apiRequest: request,
}))

let app: App | undefined
let host: HTMLDivElement
function mount() {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(ChangePasswordView)
  app.mount(host)
}
async function fill(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function submit() {
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
  await vi.waitFor(() => expect(host.querySelector('button')!.disabled).toBe(false))
  await nextTick()
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.resetAllMocks()
})

describe('change password form', () => {
  it('validates the new password and confirmation before sending', async () => {
    mount()
    await fill('current-password', 'current-password')
    for (const secret of ['', '   ', '密'.repeat(25)]) {
      await fill('new-password', secret)
      await fill('confirm-password', secret)
      await submit()
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        secret.trim() ? '72 個 UTF-8 位元組' : '非空白',
      )
      expect(request).not.toHaveBeenCalled()
    }
    await fill('new-password', 'short')
    await fill('confirm-password', 'different')
    await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('不一致')
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['a', 'short', ' a '])(
    'submits short password %j unchanged and clears all password fields after success',
    async (password) => {
      request.mockResolvedValue(new Response(null, { status: 204 }))
      mount()
      expect(host.querySelector('#new-password')?.getAttribute('minlength')).toBe('1')
      expect(host.querySelector('#confirm-password')?.getAttribute('minlength')).toBe('1')
      await fill('current-password', 'current-password')
      await fill('new-password', password)
      await fill('confirm-password', password)
      await submit()
      expect(request).toHaveBeenCalledWith('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'current-password',
          newPassword: password,
        }),
      })
      expect(host.querySelector('[role="status"]')?.textContent).toContain('密碼已更新')
      expect([...host.querySelectorAll('input')].every((input) => input.value === '')).toBe(true)
    },
  )

  it('shows a generic API error and clears password fields on failure', async () => {
    request.mockResolvedValue(new Response(null, { status: 400 }))
    mount()
    await fill('current-password', 'current-password')
    await fill('new-password', 'replacement-password')
    await fill('confirm-password', 'replacement-password')
    await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('無法變更密碼')
    expect([...host.querySelectorAll('input')].every((input) => input.value === '')).toBe(true)
  })

  it('displays the breached-password message returned by the API and clears passwords', async () => {
    const message = '新密碼曾出現在資料外洩中，請使用其他密碼。'
    request.mockResolvedValue(
      Response.json({ error: 'breached-password', message }, { status: 400 }),
    )
    mount()
    await fill('current-password', 'current-password')
    await fill('new-password', 'replacement-password')
    await fill('confirm-password', 'replacement-password')
    await submit()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(message)
    expect([...host.querySelectorAll('input')].every((input) => input.value === '')).toBe(true)
  })
})

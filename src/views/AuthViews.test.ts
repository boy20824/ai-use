// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import RegisterView from './RegisterView.vue'
import LoginView from './LoginView.vue'

const session = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
vi.mock('@/stores/session', () => ({ useSessionStore: () => session }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))
let app: App | undefined
let host: HTMLDivElement
function mount(view: typeof RegisterView | typeof LoginView) {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(view)
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
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
it('rejects eight characters and immediately enters the workspace after registering with twelve', async () => {
  session.register.mockResolvedValue({ ok: true })
  mount(RegisterView)
  expect(host.querySelector('#register-password')?.getAttribute('minlength')).toBe('12')
  await fill('register-name', 'Mock User')
  await fill('register-nickname', 'Mock')
  await fill('register-username', 'mock-user')
  await fill('register-password', '12345678')
  await fill('register-confirm', '12345678')
  await submit()
  expect(host.textContent).toContain('密碼至少需要 12 個字元')
  expect(session.register).not.toHaveBeenCalled()
  await fill('register-password', 'mock-pass-12')
  await fill('register-confirm', 'mock-pass-12')
  await submit()
  expect(session.register).toHaveBeenCalledWith(
    expect.objectContaining({ password: 'mock-pass-12' }),
  )
  expect(push).toHaveBeenCalledWith('/')
})
it('does not fetch private release notes on the public login page and allows legacy passwords', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  session.login.mockResolvedValue('ok')
  mount(LoginView)
  await nextTick()
  expect(fetch).not.toHaveBeenCalled()
  await fill('username', 'mock-user')
  await fill('password', 'short')
  await submit()
  expect(session.login).toHaveBeenCalledWith('mock-user', 'short')
  expect(push).toHaveBeenCalledWith('/')
})

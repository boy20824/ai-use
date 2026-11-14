// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import RegisterView from './RegisterView.vue'
import LoginView from './LoginView.vue'
import MembersView from './MembersView.vue'

const session = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn() }))
const push = vi.hoisted(() => vi.fn())
const request = vi.hoisted(() => vi.fn())
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  apiRequest: request,
}))
vi.mock('@/stores/session', () => ({ useSessionStore: () => session }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))
let app: App | undefined
let host: HTMLDivElement
function mount(view: typeof RegisterView | typeof LoginView | typeof MembersView) {
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
it.each(['a', '12345678', ' a '])(
  'registers short non-blank password %j and immediately enters the workspace',
  async (password) => {
    session.register.mockResolvedValue({ ok: true })
    mount(RegisterView)
    expect(host.querySelector('#register-password')?.getAttribute('minlength')).toBe('1')
    await fill('register-name', 'Mock User')
    await fill('register-nickname', 'Mock')
    await fill('register-username', 'mock-user')
    expect(host.querySelector('#register-confirm')?.getAttribute('minlength')).toBe('1')
    for (const secret of ['', '   ', '密'.repeat(25)]) {
      await fill('register-password', secret)
      await fill('register-confirm', secret)
      await submit()
      expect(host.textContent).toContain(secret.trim() ? '72 個 UTF-8 位元組' : '請填寫密碼')
      expect(session.register).not.toHaveBeenCalled()
    }
    await fill('register-password', password)
    await fill('register-confirm', password)
    await submit()
    expect(session.register).toHaveBeenCalledWith(
      expect.objectContaining({ password, confirmPassword: password }),
    )
    expect(push).toHaveBeenCalledWith('/')
  },
)
it.each(['a', '12345678', ' a '])(
  'creates members with short non-blank password %j unchanged while blocking blank and oversized passwords',
  async (password) => {
    request.mockImplementation(async () => Response.json({ members: [] }))
    mount(MembersView)
    await vi.waitFor(() => expect(host.textContent).not.toContain('正在讀取會員'))
    host.querySelector<HTMLButtonElement>('button')!.click()
    await nextTick()
    request.mockClear()
    expect(host.querySelector('#member-password')?.getAttribute('minlength')).toBe('1')
    await fill('member-name', 'Mock User')
    await fill('member-nickname', 'Mock')
    await fill('member-username', 'mock-user')
    for (const secret of ['', '   ', '密'.repeat(25)]) {
      await fill('member-password', secret)
      await submit()
      expect(host.textContent).toContain(secret.trim() ? '72 個 UTF-8 位元組' : '請填寫密碼')
      expect(request).not.toHaveBeenCalled()
    }
    await fill('member-password', password)
    await submit()
    expect(request).toHaveBeenCalledWith('/api/members', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Mock User',
        nickname: 'Mock',
        username: 'mock-user',
        password,
      }),
    })
  },
)
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

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

it('registers with account and nickname only and immediately enters the workspace', async () => {
  session.register.mockResolvedValue({ ok: true })
  mount(RegisterView)
  expect(Array.from(host.querySelectorAll('form input'), (input) => input.id)).toEqual([
    'register-username',
    'register-nickname',
  ])
  expect(host.querySelector('label[for="register-username"]')?.textContent).toContain('知識互聯網')
  expect(host.querySelector('label[for="register-nickname"]')?.textContent?.trim()).toBe(
    '使用者綽號',
  )
  expect(host.querySelector('input[type="password"]')).toBeNull()
  await fill('register-username', 'mock-user')
  await fill('register-nickname', '模擬綽號')
  await submit()
  expect(session.register).toHaveBeenCalledWith({ username: 'mock-user', nickname: '模擬綽號' })
  expect(push).toHaveBeenCalledWith('/')
})

it('creates members with the same account and nickname fields as registration', async () => {
  request.mockImplementation(async () => Response.json({ members: [] }))
  mount(MembersView)
  await vi.waitFor(() => expect(host.textContent).not.toContain('正在讀取會員'))
  host.querySelector<HTMLButtonElement>('button')!.click()
  await nextTick()
  expect(Array.from(host.querySelectorAll('form input'), (input) => input.id)).toEqual([
    'member-username',
    'member-nickname',
  ])
  expect(host.querySelector('label[for="member-username"]')?.textContent).toContain('知識互聯網')
  expect(host.querySelector('label[for="member-nickname"]')?.textContent?.trim()).toBe('使用者綽號')
  expect(host.querySelector('input[type="password"]')).toBeNull()
  await fill('member-username', 'mock-user')
  await fill('member-nickname', '模擬綽號')
  await submit()
  expect(request).toHaveBeenCalledWith('/api/members', {
    method: 'POST',
    body: JSON.stringify({ nickname: '模擬綽號', username: 'mock-user' }),
  })
})

it('logs in with only the account and keeps release notes private', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  session.login.mockResolvedValue('ok')
  mount(LoginView)
  await nextTick()
  expect(fetch).not.toHaveBeenCalled()
  expect(host.querySelectorAll('form input')).toHaveLength(1)
  expect(host.querySelector('input[type="password"]')).toBeNull()
  expect(host.querySelector('label[for="username"]')?.textContent).toContain('知識互聯網')
  await fill('username', 'mock-user')
  await submit()
  expect(session.login).toHaveBeenCalledWith('mock-user')
  expect(push).toHaveBeenCalledWith('/')
})

it('marks login busy only while the request is pending and redirects as soon as it succeeds', async () => {
  let resolveLogin!: (result: 'ok') => void
  const login = new Promise<'ok'>((resolve) => {
    resolveLogin = resolve
  })
  session.login.mockReturnValue(login)
  mount(LoginView)
  await fill('username', 'mock-user')
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!

  await submit()
  expect(session.login).toHaveBeenCalledWith('mock-user')
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.querySelector('.btn-spinner')).not.toBeNull()
  expect(push).not.toHaveBeenCalled()

  resolveLogin('ok')
  await login
  expect(push).toHaveBeenCalledWith('/')
  await nextTick()
  expect(button.disabled).toBe(false)
  expect(button.getAttribute('aria-busy')).toBe('false')
  expect(button.querySelector('.btn-spinner')).toBeNull()
})

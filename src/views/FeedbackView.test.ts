// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import FeedbackView from './FeedbackView.vue'
const mocks = vi.hoisted(() => ({
  request: vi.fn(async () => Response.json({})),
  list: vi.fn(),
  sysadmin: false,
}))
vi.mock('@/services/api', () => ({
  apiRequest: mocks.request,
  apiPagedList: mocks.list,
  apiErrorMessage: async () => 'Mock error',
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({
    user: { id: 'mock-user' },
    get isSysadmin() {
      return mocks.sysadmin
    },
  }),
}))
let app: App
let host: HTMLDivElement
afterEach(() => {
  app?.unmount()
  host?.remove()
  mocks.sysadmin = false
  vi.clearAllMocks()
})
async function mount(own = true) {
  mocks.list.mockResolvedValue([
    {
      id: 'mock-post',
      authorId: own ? 'mock-user' : 'other',
      title: 'Mock suggestion',
      content: 'Mock content',
      adminReply: 'Mock reply',
      status: 'pending',
      createdAt: '',
      updatedAt: '',
    },
  ])
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(FeedbackView)
  app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('article')).not.toBeNull())
}
function click(text: string, root: ParentNode = host) {
  const button = [...root.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )!
  button.click()
}
it.each([true, false])('confirms deletion for own=%s and keeps the post on cancel', async (own) => {
  mocks.sysadmin = !own
  await mount(own)
  click('刪除')
  await nextTick()
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Mock suggestion')
  expect(mocks.request).not.toHaveBeenCalled()
  click('取消', host.querySelector('[role="dialog"]')!)
  await nextTick()
  expect(host.querySelector('article')?.textContent).toContain('Mock content')
  expect(mocks.request).not.toHaveBeenCalled()
  click('刪除')
  await nextTick()
  click('確定', host.querySelector('[role="dialog"]')!)
  await vi.waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('/api/feedback/mock-post', { method: 'DELETE' }),
  )
})
it('submits directly with a short edit/delete hint beside the button', async () => {
  await mount()
  expect(host.querySelector('button[type="submit"]')?.parentElement?.textContent).toContain(
    '送出後仍可編輯或刪除自己的留言',
  )
  for (const [id, value] of [
    ['feedback-title', 'Mock title'],
    ['feedback-content', 'Mock suggestion'],
  ]) {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!
    input.value = value!
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/feedback',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, h, nextTick, type App } from 'vue'
import { RouterView } from 'vue-router'
import { router } from '@/router'
import {
  categoryEditDenied,
  createdCategoryNotice,
  editPermissionHint,
} from '@/stores/categoryNotices'
import type { CaseCategory } from '@/types/domain'

const sample: CaseCategory = {
  id: 'mock',
  name: 'Mock existing',
  updatedAt: '',
  summary: '',
  templateCount: 0,
  steps: [
    { id: 'mock-step', body: 'Mock step', templateIds: [] },
    { id: 'scenario-step', body: 'Mock scenario step', templateIds: [] },
  ],
  baseSteps: [{ stepId: 'mock-step', sortOrder: 0 }],
  modules: [
    {
      id: 'scenario',
      categoryId: 'mock',
      name: 'Mock scenario',
      sortOrder: 0,
      steps: [{ stepId: 'scenario-step', sortOrder: 0 }],
    },
  ],
}
let app: App | undefined
let host: HTMLDivElement
async function mount(role: 'user' | 'sysadmin', path: string, empty = false) {
  const categories = empty ? [] : [sample]
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/auth/me') {
      return Response.json({
        user: {
          id: 'mock-user',
          role,
          displayName: 'Mock display name',
          canManageCategories: false,
        },
      })
    }
    if (url === '/api/categories' && init.method === 'POST') {
      const input = JSON.parse(String(init.body))
      const created = { ...sample, id: 'created', name: input.name }
      categories.push(created)
      return Response.json({ category: created }, { status: 201 })
    }
    if (url === '/api/categories') return Response.json({ categories })
    if (url.endsWith('/impact')) return Response.json({ impact: { base: [], modules: [{}] } })
    if (url.startsWith('/api/templates')) return Response.json({ templates: [] })
    if (url === '/api/release-notes') return Response.json({ items: [] })
    if (url === '/api/auth/logout') return Response.json({})
    throw new Error(`Unexpected mock request: ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push(path)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router)
  app.mount(host)
  await nextTick()
  return fetch
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  categoryEditDenied.value = false
  createdCategoryNotice.value = null
  vi.unstubAllGlobals()
})
const statuses = () =>
  [...host.querySelectorAll('[role="status"]')].map((node) => node.textContent?.trim())
function input(selector: string, value: string) {
  const target = host.querySelector<HTMLInputElement>(selector)!
  target.value = value
  target.dispatchEvent(new Event('input', { bubbles: true }))
}
async function submit() {
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}

it('shows the permission hint to a clerk on the workbench and home page', async () => {
  await mount('user', '/categories/mock')
  await vi.waitFor(() => expect(host.textContent).toContain(editPermissionHint))
  await router.push('/')
  await nextTick()
  expect(host.textContent).toContain(editPermissionHint)
})

it.each(['user', 'sysadmin'] as const)(
  'matches the %s permissions on the empty browser',
  async (role) => {
    await mount(role, '/categories', true)
    await vi.waitFor(() => expect(host.textContent).toContain('還沒有案件範本'))
    if (role === 'user') {
      expect(host.textContent).toContain('你目前可以填寫並產出文件')
      expect(host.textContent).toContain(editPermissionHint)
    } else {
      expect(host.textContent).not.toContain(editPermissionHint)
      expect(host.querySelector('.side-account .account-identity p')?.textContent).toBe(
        'Mock display name',
      )
    }
  },
)

it('keeps the editor route guard and shows the redirect notice once without URL or storage state', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  try {
    await mount('user', '/categories/mock/edit')
    expect(router.currentRoute.value.fullPath).toBe('/categories/mock')
    expect(statuses()).toContain('你的帳號沒有編輯權限')
    await router.push('/categories')
    await router.push('/categories/mock')
    await nextTick()
    expect(statuses()).not.toContain('你的帳號沒有編輯權限')
    expect(host.textContent).toContain(editPermissionHint)
    expect(setItem).not.toHaveBeenCalled()
  } finally {
    setItem.mockRestore()
  }
})

it('uses the real create route and announces the new template once at its workbench', async () => {
  await mount('sysadmin', '/categories/new')
  await vi.waitFor(() => expect(host.querySelector('#category-name')).not.toBeNull())
  input('#category-name', 'Mock newly created')
  await submit()
  input('#category-step-0', 'Mock step')
  await submit()
  await vi.waitFor(() => expect(statuses()).toContain('已建立「Mock newly created」'))
  expect(router.currentRoute.value.fullPath).toBe('/categories/created')
  expect(host.textContent).not.toContain(editPermissionHint)
  expect(
    [...host.querySelectorAll('a')]
      .find((node) => node.textContent?.trim() === '編輯這個案件範本')
      ?.getAttribute('href'),
  ).toBe('/categories/created/edit')
  await router.push('/categories')
  await router.push('/categories/created')
  await nextTick()
  expect(statuses()).not.toContain('已建立「Mock newly created」')
  expect(host.textContent).toContain('編輯這個案件範本')
})

it('asks before logout from a dirty wizard and does not prompt twice', async () => {
  const fetch = await mount('sysadmin', '/categories/new')
  await vi.waitFor(() => expect(host.querySelector('#category-name')).not.toBeNull())
  input('#category-name', 'Mock draft before logout')
  const buttons = (label: string, root: ParentNode = host) =>
    [...root.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)!
  buttons('登出').click()
  await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull())
  buttons('繼續編輯', host.querySelector('[role="dialog"]')!).click()
  await nextTick()
  expect(fetch.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(false)
  buttons('登出').click()
  await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull())
  buttons('放棄修改', host.querySelector('[role="dialog"]')!).click()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'))
  expect(fetch.mock.calls.filter(([url]) => url === '/api/auth/logout')).toHaveLength(1)
})

it('opens a scenario step directly from the workbench without adding URL state', async () => {
  await mount('sysadmin', '/categories/mock')
  const link = () =>
    host.querySelector<HTMLAnchorElement>('[aria-label="編輯此步驟：Mock scenario step"]')
  await vi.waitFor(() =>
    expect(host.querySelector('.case-edit-actions .btn-primary')).not.toBeNull(),
  )
  const scenario = [...host.querySelectorAll('label')].find(
    (node) => node.textContent?.trim() === 'Mock scenario',
  )
  scenario!.querySelector('input')!.click()
  await nextTick()
  expect(link()?.getAttribute('href')).toBe('/categories/mock/edit')
  link()!.click()
  await vi.waitFor(() => expect(host.querySelector('[role="dialog"] .btn-primary')).not.toBeNull())
  host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-primary')!.click()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories/mock/edit'))
  expect(router.options.history.state.editStepId).toBe('scenario-step')
  const editorInput = () => host.querySelector<HTMLInputElement>('input[maxlength="500"]')
  await vi.waitFor(() => expect(editorInput()?.value).toBe('Mock scenario step'))
  expect(document.activeElement).toBe(editorInput())
  expect(router.currentRoute.value.fullPath).toBe('/categories/mock/edit')
  expect(host.querySelector('[aria-current="step"]')?.textContent?.trim()).toBe('步驟與範本')
})

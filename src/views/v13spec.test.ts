// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import CategoryView from './CategoryView.vue'

const mocks = vi.hoisted(() => {
  const category = {
    id: 'mock-flow',
    name: '模擬流程',
    summary: '',
    group: 'criminal',
    templateCount: 0,
    variants: [
      { id: 'stop', name: '攔查' },
      { id: 'crash', name: '肇事' },
    ],
    fields: [{ id: 'alcohol', name: '酒測值', key: '酒測值', type: 'number' }],
    steps: [
      {
        id: 'stop-step',
        order: 0,
        title: '攔查專屬',
        body: '攔查專屬',
        variantIds: ['stop'],
        items: ['檢查證件'],
        note: '主動攔查',
        templateIds: [],
      },
      {
        id: 'common',
        order: 1,
        title: '共同步驟',
        body: '共同步驟',
        variantIds: [],
        items: ['共同細項'],
        note: '<script>mock</script>',
        templateIds: [],
      },
      {
        id: 'crash-step',
        order: 2,
        title: '肇事專屬',
        body: '肇事專屬',
        variantIds: ['crash'],
        items: [],
        note: '',
        templateIds: [],
      },
    ],
  }
  return { category }
})
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ byId: () => mocks.category, ready: true }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({ items: [], byId: () => undefined }),
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({
    authenticated: true,
    canEditCategory: false,
    canDeleteCategory: false,
  }),
}))

let app: App | undefined
let host: HTMLDivElement
async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id', component: CategoryView },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await router.push('/categories/mock-flow')
  await router.isReady()
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  await nextTick()
  return router
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
})
function input(label: string) {
  const element = [...host.querySelectorAll('label')]
    .find((el) => el.textContent?.includes(label))
    ?.querySelector('input')
  if (!element) throw new Error(`missing ${label}`)
  return element
}
async function check(element: HTMLInputElement, checked: boolean) {
  element.checked = checked
  element.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

describe('workflow acceptance UI', () => {
  it('shows common steps first, adds only selected variants, and escapes notes', async () => {
    await mount()
    expect(host.textContent).toContain('共同步驟')
    expect(host.textContent).not.toContain('攔查專屬')
    expect(host.textContent).not.toContain('肇事專屬')
    expect(host.querySelector('script')).toBeNull()
    expect(host.textContent).toContain('<script>mock</script>')
    await check(input('攔查'), true)
    const headings = [...host.querySelectorAll('h3')].map((el) => el.textContent?.trim())
    expect(headings).toEqual(['基本資料', '共同步驟', '攔查專屬'])
    expect(host.textContent).not.toContain('肇事專屬')
    expect(host.textContent).toContain('檢查證件')
    expect(host.textContent).toContain('主動攔查')
  })

  it('updates the green completed card and progress and clears input/completion on navigation', async () => {
    const router = await mount()
    await check(input('本步驟已完成'), true)
    expect(host.querySelector('progress')?.value).toBe(1)
    expect(host.querySelector('li.bg-emerald-50')?.textContent).toContain('✓ 共同步驟')
    const field = host.querySelector('input[type="number"]') as HTMLInputElement
    expect(field).not.toBeNull()
    field.value = '0.35'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await router.push('/categories/another-mock')
    await nextTick()
    expect((host.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('')
    expect(host.querySelector('progress')?.value).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('prints only the chosen step through an escaped print-only document', async () => {
    await mount()
    const print = vi.fn(() => {
      const document = window.document.querySelector('#sop-print')
      expect(document?.textContent).toContain('共同步驟')
      expect(document?.textContent).toContain('共同細項')
      expect(document?.textContent).toContain('<script>mock</script>')
      expect(document?.querySelector('script')).toBeNull()
      expect(document?.textContent).not.toContain('基本資料')
      expect(document?.textContent).not.toContain('標記完成')
    })
    Object.defineProperty(window, 'print', { value: print, configurable: true })
    const button = [...host.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('列印 SOP'),
    )!
    button.click()
    await nextTick()
    expect(print).toHaveBeenCalledOnce()
    await nextTick()
    expect(document.querySelector('#sop-print')).toBeNull()
  })
})

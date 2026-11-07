// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App, type Ref } from 'vue'
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
    get baseSteps() {
      return this.steps
        .filter((s) => !s.variantIds.length)
        .map((s) => ({ stepId: s.id, sortOrder: s.order }))
    },
    get modules() {
      return this.variants.map((v, i) => ({
        ...v,
        categoryId: this.id,
        sortOrder: i,
        steps: this.steps
          .filter((s) => s.variantIds.includes(v.id))
          .map((s) => ({ stepId: s.id, sortOrder: s.order })),
      }))
    },
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
        templateIds: [] as string[],
      },
      {
        id: 'common',
        order: 1,
        title: '共同步驟',
        body: '共同步驟',
        variantIds: [],
        items: ['共同細項'],
        note: '<script>mock</script>',
        templateIds: [] as string[],
      },
      {
        id: 'crash-step',
        order: 2,
        title: '肇事專屬',
        body: '肇事專屬',
        variantIds: ['crash'],
        items: [],
        note: '',
        templateIds: [] as string[],
      },
    ],
  }
  return { category, bytesFor: vi.fn(), download: vi.fn() }
})
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ byId: () => mocks.category, ready: true }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    items: [],
    byId: (id: string) =>
      id === 'test-template' ? { id, fileName: 'test.docx', placeholders: [] } : undefined,
    bytesFor: mocks.bytesFor,
  }),
}))
vi.mock('@/services/docxTemplates', () => ({
  renderDocx: () => new Uint8Array(),
  templateMimeType: 'test/docx',
}))
vi.mock('@/utils/download', () => ({ downloadBytes: mocks.download, downloadBlob: mocks.download }))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({
    authenticated: true,
    canEditCategory: false,
    canDeleteCategory: false,
  }),
}))

let app: App | undefined
let host: HTMLDivElement
async function mount(selectedId?: Ref<string>) {
  host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/categories/:id',
        component: selectedId
          ? { render: () => h(CategoryView, { selectedId: selectedId.value, embedded: true }) }
          : CategoryView,
      },
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
  mocks.bytesFor.mockReset()
  mocks.download.mockReset()
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

  it('shows a shared step when either module is selected and dedupes their union', async () => {
    const combined = {
      ...mocks.category.steps[0]!,
      id: 'combined',
      title: '同時符合步驟',
      variantIds: ['stop', 'crash'],
    }
    mocks.category.steps.push(combined)
    try {
      await mount()
      expect(host.textContent).not.toContain('同時符合步驟')
      await check(input('攔查'), true)
      expect(host.textContent).toContain('同時符合步驟')
      await check(input('肇事'), true)
      expect(host.textContent).toContain('同時符合步驟')
      expect(host.textContent).toContain('攔查專屬')
      expect(host.textContent).toContain('肇事專屬')
      expect(
        [...host.querySelectorAll('h3')].filter((h) => h.textContent?.trim() === '同時符合步驟'),
      ).toHaveLength(1)
      await check(input('攔查'), false)
      expect(host.textContent).toContain('同時符合步驟')
      await check(input('攔查'), true)
      await check(input('肇事'), false)
      expect(host.textContent).toContain('同時符合步驟')
      await check(input('攔查'), false)
      expect(host.textContent).not.toContain('同時符合步驟')
    } finally {
      mocks.category.steps.pop()
    }
  })

  it('shows every step without chips when the workflow has no variants', async () => {
    const variants = mocks.category.variants
    const steps = mocks.category.steps
    mocks.category.variants = []
    mocks.category.steps = steps.map((step) => ({ ...step, variantIds: [] }))
    try {
      await mount()
      expect(host.querySelector('[aria-label="情境模組選擇"]')).toBeNull()
      for (const step of steps) expect(host.textContent).toContain(step.title)
    } finally {
      mocks.category.variants = variants
      mocks.category.steps = steps
    }
  })

  it('toggles accessible completion checkboxes and clears them and fields on case navigation', async () => {
    const router = await mount()
    expect(host.querySelector('progress')).toBeNull()
    const completed = input('已完成')
    expect(completed.getAttribute('aria-label')).toBe('共同步驟：已完成')
    expect(completed.classList.contains('focus-control')).toBe(true)
    await check(completed, true)
    expect(host.querySelector('.fixed-step')?.classList.contains('bg-tone-ok')).toBe(true)
    expect(host.querySelector('.fixed-step h3')?.classList.contains('line-through')).toBe(true)
    await check(completed, false)
    expect(host.querySelector('.fixed-step')?.classList.contains('bg-tone-ok')).toBe(false)
    await check(completed, true)
    await check(input('攔查'), true)
    const field = host.querySelector('input[type="number"]') as HTMLInputElement
    expect(field).not.toBeNull()
    field.value = '0.35'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await router.push('/categories/another-mock')
    await nextTick()
    expect((host.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('')
    expect(input('已完成').checked).toBe(false)
    expect(input('攔查').checked).toBe(false)
    expect(host.textContent).not.toContain('攔查專屬')
    await router.push('/categories/mock-flow')
    expect(input('已完成').checked).toBe(false)
    expect(host.querySelector('progress')).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('resets completion when the embedded template selection changes', async () => {
    const selected = ref('mock-flow')
    await mount(selected)
    await check(input('已完成'), true)
    selected.value = 'another-template'
    await nextTick()
    expect(input('已完成').checked).toBe(false)
    selected.value = 'mock-flow'
    await nextTick()
    expect(input('已完成').checked).toBe(false)
  })

  it.each(['resolve', 'reject'])(
    'ignores stale async generation %s after switching away and back',
    async (outcome) => {
      const step = mocks.category.steps[1]!
      step.templateIds.push('test-template')
      let resolve!: (value: Uint8Array) => void
      let reject!: (error: Error) => void
      mocks.bytesFor.mockReturnValue(
        new Promise<Uint8Array>((yes, no) => {
          resolve = yes
          reject = no
        }),
      )
      try {
        const router = await mount()
        await check(input('已完成'), true)
        for (const field of host.querySelectorAll<HTMLInputElement>(
          '#panel-steps input[type="text"], #panel-steps input[type="number"]',
        )) {
          field.value = field.type === 'number' ? '0.35' : '測試姓名'
          field.dispatchEvent(new Event('input', { bubbles: true }))
        }
        await nextTick()
        const button = [...host.querySelectorAll('button')].find(
          (el) => el.textContent?.trim() === '產生',
        )!
        button.click()
        await nextTick()
        expect(mocks.bytesFor).toHaveBeenCalledOnce()
        await router.push('/categories/other')
        await router.push('/categories/mock-flow')
        expect(input('已完成').checked).toBe(false)
        await check(input('已完成'), true)
        if (outcome === 'resolve') resolve(new Uint8Array())
        else reject(new Error('stale error'))
        await Promise.resolve()
        await nextTick()
        await nextTick()
        expect(input('已完成').checked).toBe(true)
        expect(mocks.download).not.toHaveBeenCalled()
        expect(host.querySelector('.step-content [role="status"]')).toBeNull()
      } finally {
        step.templateIds.pop()
      }
    },
  )

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

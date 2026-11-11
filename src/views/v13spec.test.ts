// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App, type Ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import CategoryView from './CategoryView.vue'

const mocks = vi.hoisted(() => {
  const category = {
    combinationOrders: [] as { moduleIds: string[]; stepIds: string[] }[],
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
        templateIds: ['basic-template'] as string[],
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
  return {
    category,
    library: [] as { id: string; fileName: string; placeholders: string[] }[],
    bytesFor: vi.fn(),
    download: vi.fn(),
    render: vi.fn(() => new Uint8Array()),
    zip: vi.fn(async () => new Blob()),
  }
})
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({ byId: () => mocks.category, ready: true }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    get items() {
      return mocks.library
    },
    byId: (id: string) =>
      mocks.library.find((item) => item.id === id) ??
      (id === 'test-template' || id === 'basic-template'
        ? { id, fileName: 'test.docx', placeholders: id === 'basic-template' ? ['酒測值'] : [] }
        : undefined),
    bytesFor: mocks.bytesFor,
  }),
}))
vi.mock('@/services/docxTemplates', () => ({
  renderDocx: mocks.render,
  zipGeneratedFiles: mocks.zip,
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
          '#panel-steps input[type="text"], #panel-steps input[type="number"], .shared-fields-panel input[type="text"], .shared-fields-panel input[type="number"]',
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

it('keeps #21 completion checkboxes functional with saved cross-source order and browser-only values', async () => {
  mocks.category.combinationOrders = [
    { moduleIds: ['stop', 'crash'], stepIds: ['crash-step', 'common', 'stop-step'] },
  ]
  try {
    const router = await mount()
    await check(input('肇事'), true)
    await check(input('攔查'), true)
    expect(
      [...host.querySelectorAll('.fixed-step h3')].map((el) => el.textContent?.trim()),
    ).toEqual(['肇事專屬', '共同步驟', '攔查專屬'])
    const completion = host.querySelector('[aria-label="共同步驟：已完成"]') as HTMLInputElement
    await check(completion, true)
    expect(completion.checked).toBe(true)
    expect(completion.closest('.fixed-step')?.classList.contains('bg-tone-ok')).toBe(true)
    await check(completion, false)
    expect(completion.closest('.fixed-step')?.classList.contains('bg-tone-ok')).toBe(false)
    await check(completion, true)
    const field = host.querySelector('input[type="number"]') as HTMLInputElement
    field.value = '0.35'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await router.push('/categories/another-mock')
    await router.push('/categories/mock-flow')
    await check(input('攔查'), true)
    await check(input('肇事'), true)
    expect(
      (host.querySelector('[aria-label="共同步驟：已完成"]') as HTMLInputElement).checked,
    ).toBe(false)
    expect((host.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  } finally {
    mocks.category.combinationOrders = []
  }
})

it('places scenario inputs in their steps, preserves shared values through combination ordering, and generates each selected context', async () => {
  const original = mocks.category.steps
  mocks.library.push(
    { id: 'base-x', fileName: 'base.docx', placeholders: ['酒測值', '姓名', '日期'] },
    { id: 'shared-template', fileName: 'same.docx', placeholders: ['酒測值', '專屬', '日期_民國'] },
    { id: 'n-only', fileName: 'n.docx', placeholders: ['Z'] },
  )
  mocks.category.steps = original.map((step) => ({
    ...step,
    templateIds:
      step.id === 'common'
        ? ['base-x']
        : step.id === 'stop-step'
          ? ['shared-template']
          : ['shared-template', 'n-only'],
  }))
  mocks.category.combinationOrders = [
    { moduleIds: ['stop', 'crash'], stepIds: ['crash-step', 'common', 'stop-step'] },
  ]
  mocks.bytesFor.mockResolvedValue(new Uint8Array([1]))
  mocks.render.mockClear()
  mocks.zip.mockClear()
  const fill = async (element: HTMLInputElement, value: string) => {
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  const stepRow = (title: string) =>
    [...host.querySelectorAll('.fixed-step')].find(
      (row) => row.querySelector('h3')?.textContent?.trim() === title,
    )!
  try {
    const router = await mount()
    expect(host.querySelector('.basic-data-row')?.textContent).not.toContain('酒測值')
    expect(host.querySelector('.basic-data-row')?.textContent).not.toContain('專屬')
    await fill(host.querySelector('#step-common-1')!, 'Mock name')
    await fill(host.querySelector('input[type="number"]')!, '0.35')
    await check(input('攔查'), true)
    expect(host.textContent).not.toContain('n.docx')
    expect(host.querySelector('#step-stop-step-1')).not.toBeNull()
    await fill(host.querySelector('#step-stop-step-1')!, 'D-value')
    expect(
      (stepRow('攔查專屬').querySelector('input[type="number"]') as HTMLInputElement).value,
    ).toBe('0.35')
    const generateD = [...stepRow('攔查專屬').querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '產生',
    )!
    expect(generateD.disabled).toBe(false)
    await check(input('肇事'), true)
    expect([...host.querySelectorAll('.fixed-step h3')].map((h) => h.textContent?.trim())).toEqual([
      '肇事專屬',
      '共同步驟',
      '攔查專屬',
    ])
    expect((host.querySelector('#step-stop-step-1') as HTMLInputElement).value).toBe('D-value')
    expect((host.querySelector('#step-crash-step-1') as HTMLInputElement).value).toBe('D-value')
    expect(generateD.disabled).toBe(false) // Missing N fields cannot block D.
    await fill(host.querySelector('#step-crash-step-1')!, 'F-value')
    await fill(host.querySelector('#step-crash-step-2')!, 'Z-value')
    generateD.click()
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
    expect(mocks.render).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ 酒測值: '0.35', 專屬: 'F-value' }),
    )
    host.querySelector<HTMLButtonElement>('#tab-overview')!.click()
    await nextTick()
    const documentList = [...host.querySelectorAll('#panel-overview li')].filter((li) =>
      li.querySelector('input[type="checkbox"]'),
    )
    expect(documentList).toHaveLength(4)
    expect(documentList.filter((li) => li.textContent?.includes('same.docx'))).toHaveLength(2)
    const baseRow = documentList.find((li) => li.textContent?.includes('base.docx'))!
    const zRow = documentList.find((li) => li.textContent?.includes('n.docx'))!
    await check(baseRow.querySelector('input')!, false)
    await check(zRow.querySelector('input')!, false)
    const stopRow = documentList.find((li) => li.textContent?.includes('攔查專屬'))!
    await check(stopRow.querySelector('input')!, false)
    mocks.render.mockClear()
    const generateChecked = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '產生勾選文件',
    )!
    generateChecked.click()
    await vi.waitFor(() => expect(mocks.zip).toHaveBeenCalledOnce())
    expect(mocks.render).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ 酒測值: '0.35', 專屬: 'F-value' }),
    )
    expect(mocks.zip).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: '產生-same.docx' }),
    ])
    await vi.waitFor(() => expect(generateChecked.disabled).toBe(false))
    await check(stopRow.querySelector('input')!, true)
    mocks.render.mockClear()
    generateChecked.click()
    await vi.waitFor(() => expect(mocks.zip).toHaveBeenCalledTimes(2))
    expect(mocks.render).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ 專屬: 'F-value' }),
    )
    expect(mocks.render).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ 專屬: 'F-value' }),
    )
    expect(mocks.zip).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: '產生-same.docx' }),
      expect.objectContaining({ name: '產生-same.docx' }),
    ])
    await router.push('/categories/another-mock')
    await check(input('攔查'), true)
    expect((host.querySelector('#step-stop-step-1') as HTMLInputElement).value).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  } finally {
    mocks.category.steps = original
    mocks.category.combinationOrders = []
    mocks.library.splice(0)
  }
})

it('shows the exact parallel hint in steps and full overview only when enabled', async () => {
  const original = mocks.category.steps
  mocks.category.steps = original.map((step) => ({
    ...step,
    canRunInParallel: step.id === 'common',
  }))
  try {
    await mount()
    expect(host.querySelectorAll('.fixed-step')).toHaveLength(1)
    expect(host.querySelector('.fixed-step')?.textContent).toContain('可請其他人同步處理')
    await check(input('攔查'), true)
    const stop = [...host.querySelectorAll('.fixed-step')].find((row) =>
      row.querySelector('h3')?.textContent?.includes('攔查專屬'),
    )!
    expect(stop.textContent).not.toContain('此步驟可請其他人同步進行')
    host.querySelector<HTMLButtonElement>('#tab-overview')!.click()
    await nextTick()
    const overview = host.querySelector('[aria-label="完整流程總覽"]')!
    expect(overview.textContent).toContain('此步驟可請其他人同步進行')
    expect(
      [...overview.querySelectorAll('li')].filter((li) =>
        li.textContent?.includes('此步驟可請其他人同步進行'),
      ),
    ).toHaveLength(1)
  } finally {
    mocks.category.steps = original
  }
})

it('keeps temporary document selection and fields isolated and resets its checkmark when re-added', async () => {
  mocks.library.push({ id: 'temporary', fileName: 'temporary.docx', placeholders: ['臨時欄位'] })
  try {
    await mount()
    host.querySelector<HTMLButtonElement>('#tab-overview')!.click()
    await nextTick()
    const picker = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '從範本庫選取',
    )!
    picker.click()
    await nextTick()
    const temporaryPicker = [...host.querySelectorAll('label')]
      .find((label) => label.textContent?.trim() === 'temporary.docx')!
      .querySelector('input')!
    await check(temporaryPicker, true)
    const documentRow = () =>
      [...host.querySelectorAll('#panel-overview li')].find((row) =>
        row.textContent?.includes('本次暫加'),
      )!
    expect(documentRow().querySelector('input')!.checked).toBe(true)
    const field = host.querySelector('[aria-label="本次暫加"] input') as HTMLInputElement
    field.value = 'transient'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await check(documentRow().querySelector('input')!, false)
    expect(host.querySelector('[aria-label="本次暫加"]')).toBeNull()
    await check(temporaryPicker, false)
    await check(temporaryPicker, true)
    expect(documentRow().querySelector('input')!.checked).toBe(true)
    expect((host.querySelector('[aria-label="本次暫加"] input') as HTMLInputElement).value).toBe(
      'transient',
    )
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  } finally {
    mocks.library.splice(0)
  }
})

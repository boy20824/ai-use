// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, shallowRef, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import CategoryFormView from './CategoryFormView.vue'
import type { TemplateSummary } from '@/storage'
import type { CaseCategory } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  templates: [] as TemplateSummary[],
  addFiles: vi.fn(),
  create: vi.fn(async () => ({ id: 'created' })),
  update: vi.fn(async () => {}),
  reloadTemplates: vi.fn(async () => {}),
  byId: vi.fn<() => CaseCategory | undefined>(() => undefined),
}))
vi.mock('@/stores/categories', () => ({
  useCategoryStore: () => ({
    ready: true,
    byId: mocks.byId,
    create: mocks.create,
    update: mocks.update,
    reload: async () => {},
  }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    get items() {
      return mocks.templates
    },
    byId: (id: string) => mocks.templates.find((item) => item.id === id),
    reload: mocks.reloadTemplates,
    addFiles: mocks.addFiles,
  }),
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ canEditCategory: true }),
}))

let app: App | undefined
let host: HTMLDivElement
const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.templates = []
  mocks.create.mockClear()
  mocks.update.mockClear()
  mocks.reloadTemplates.mockClear()
  mocks.byId.mockReset()
  mocks.addFiles.mockReset()
  if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor)
  else Reflect.deleteProperty(document, 'execCommand')
})
function button(text: string) {
  const element = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!element) throw new Error(`Missing button: ${text}`)
  return element
}
async function type(selector: string, value: string) {
  const element = host.querySelector(selector) as HTMLInputElement
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function submit() {
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}
async function mountForm(path = '/categories/new') {
  host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/new', name: 'category-new', component: CategoryFormView },
      { path: '/categories/:id/edit', name: 'category-edit', component: CategoryFormView },
      { path: '/categories/:id', component: { render: () => h('div') } },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await router.push(path)
  await router.isReady()
  app = createApp({ render: () => h(RouterView) }).use(router)
  app.mount(host)
  await nextTick()
  return router
}
async function mountFields() {
  await mountForm()
  await type('#category-name', '公共危險')
  await submit()
  expect(button('建立案件範本')).toBeDefined()
  await type('#category-step-0', 'Mock step')
  button('新增欄位').click()
  await nextTick()
  await type('[aria-label="欄位名稱"]', '  酒測值  ')
}

it('skips optional variants, copies the trimmed key and saves a standalone base field', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  await mountFields()
  expect(host.querySelector('input[aria-label="欄位鍵"]')).toBeNull()
  expect(host.querySelector('code')?.textContent).toBe('{{酒測值}}')
  button('複製').click()
  await vi.waitFor(() => expect(button('已複製')).toBeDefined())
  expect(writeText).toHaveBeenCalledWith('{{酒測值}}')
  await submit()
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      fields: [expect.objectContaining({ key: '酒測值', name: '酒測值', scope: 'base' })],
    }),
  )
})

it('keeps create views narrow throughout the wizard', async () => {
  await mountForm()
  await type('#category-name', '公共危險')
  for (let step = 1; step <= 2; step++) {
    expect(host.querySelector('form')?.classList.contains('max-w-3xl')).toBe(true)
    expect(host.querySelector('form')?.classList.contains('xl:max-w-none')).toBe(false)
    if (step < 2) await submit()
  }
})

it('opens a read-only check for base and module tags, escapes marker text and restores focus', async () => {
  mocks.byId.mockReturnValue({
    id: 'existing',
    name: 'Mock',
    summary: '',
    updatedAt: '',
    templateCount: 2,
    builtinFields: { 姓名: true },
    steps: [
      { id: 'base', body: 'Mock 基本步驟', templateIds: ['base-doc'] },
      { id: 'module-step', body: 'Mock 模組步驟', templateIds: ['module-doc'] },
    ],
    baseSteps: [{ stepId: 'base', sortOrder: 0 }],
    modules: [
      {
        id: 'module',
        categoryId: 'existing',
        name: 'Mock 模組',
        sortOrder: 0,
        steps: [{ stepId: 'module-step', sortOrder: 0 }],
      },
    ],
  })
  mocks.templates = ['base-doc', 'module-doc'].map((id) => ({
    id,
    fileName: `${id}.docx`,
    kind: 'docx',
    mimeType: 'mock/docx',
    sizeBytes: 0,
    addedAt: '',
    origin: 'upload',
    usages: [],
    placeholders:
      id === 'base-doc' ? ['姓名', '地址'] : ['姓名', '員警姓名', '案發地址', '<img src=x>'],
  }))
  await mountForm('/categories/existing/edit')
  const open = button('重複欄位檢查')
  const panel = document.getElementById(open.getAttribute('aria-controls')!)!
  open.focus()
  open.click()
  await nextTick()
  expect(open.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(panel.querySelector('h2'))
  expect([...panel.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
    '標記',
    '出現位置',
    '次數',
  ])
  const rows = [...panel.querySelectorAll('tbody tr')]
  const row = (name: string) => rows.find((item) => item.querySelector('th')?.textContent === name)!
  expect([...row('姓名').querySelectorAll('li')].map((item) => item.textContent)).toEqual([
    '基本 SOP',
    '基本 SOP－Mock 基本步驟－base-doc.docx',
    'Mock 模組－Mock 模組步驟－module-doc.docx',
  ])
  expect(row('姓名').querySelector('td:last-child')?.textContent?.trim()).toBe('3共用')
  expect(row('員警姓名').querySelector('td:last-child')?.textContent?.trim()).toBe('1')
  expect(row('<img src=x>')).toBeDefined()
  expect(panel.querySelector('img, input')).toBeNull()
  expect(panel.textContent).toContain('姓名／員警姓名')
  expect(panel.textContent).toContain('地址／案發地址')
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
  await nextTick()
  expect(open.getAttribute('aria-expanded')).toBe('false')
  expect(panel.style.display).toBe('none')
  expect(document.activeElement).toBe(open)
  expect(mocks.update).not.toHaveBeenCalled()
})

it('widens only the existing SOP step and preserves its reorder across internal transitions', async () => {
  mocks.byId.mockReturnValue({
    id: 'existing',
    name: '公共危險',
    summary: '',
    updatedAt: '',
    templateCount: 0,
    steps: ['A', 'B'].map((id) => ({ id, body: id, templateIds: [] })),
    baseSteps: ['A', 'B'].map((stepId, sortOrder) => ({ stepId, sortOrder })),
    modules: [],
  })
  const router = await mountForm('/categories/existing/edit')
  const form = host.querySelector('form')!
  expect(form.classList.contains('xl:max-w-none')).toBe(true)
  expect(button('步驟與範本').getAttribute('aria-current')).toBe('step')
  expect(form.classList.contains('max-w-3xl')).toBe(true)
  const editor = host.querySelector('[aria-label="這個情境的步驟順序"]')!
  expect(editor.parentElement?.classList.contains('xl:grid-cols-2')).toBe(true)
  expect(editor.parentElement?.classList.contains('grid-cols-2')).toBe(false)
  const move = editor.querySelector('[aria-label="B：上移"]') as HTMLButtonElement
  move.click()
  await nextTick()
  const order = () =>
    [...editor.querySelectorAll('[data-step-id]')].map((li) => li.getAttribute('data-step-id'))
  expect(order()).toEqual(['B', 'A'])
  button('情境').click()
  await nextTick()
  expect(button('情境').getAttribute('aria-current')).toBe('step')
  expect(button('新增情境').closest('section')?.style.display).not.toBe('none')
  expect((editor as HTMLElement).style.display).toBe('none')
  expect(form.classList.contains('xl:max-w-none')).toBe(false)
  button('名稱與分類').click()
  await nextTick()
  expect(button('名稱與分類').getAttribute('aria-current')).toBe('step')
  expect(
    host.querySelector<HTMLInputElement>('#category-name')?.closest('section')?.style.display,
  ).not.toBe('none')
  expect(host.querySelector('[aria-label="這個情境的步驟順序"]')).toBe(editor)
  const navigation = router.push('/categories')
  await vi.waitFor(() => expect(host.querySelector('[role=dialog]')).not.toBeNull())
  button('繼續編輯').click()
  await navigation
  expect(router.currentRoute.value.path).toBe('/categories/existing/edit')
  button('步驟與範本').click()
  await nextTick()
  expect(form.classList.contains('xl:max-w-none')).toBe(true)
  expect(order()).toEqual(['B', 'A'])
  expect(editor.textContent).toContain('順序尚未儲存')
})

it.each(['unavailable', 'rejected'])(
  'falls back when the clipboard is %s and cleans up',
  async (mode) => {
    vi.stubGlobal(
      'navigator',
      mode === 'unavailable'
        ? {}
        : {
            clipboard: {
              writeText: vi.fn(async () => {
                throw new Error('denied')
              }),
            },
          },
    )
    const copy = vi.fn(() => {
      const area = document.querySelector(
        'textarea[aria-label="複製欄位寫法"]',
      ) as HTMLTextAreaElement
      expect(area.value).toBe('{{酒測值}}')
      return true
    })
    Object.defineProperty(document, 'execCommand', { value: copy, configurable: true })
    await mountFields()
    button('複製').click()
    await vi.waitFor(() => expect(button('已複製')).toBeDefined())
    expect(copy).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea[aria-label="複製欄位寫法"]')).toBeNull()
  },
)

it('shows a manual-copy message when both clipboard methods fail', async () => {
  vi.stubGlobal('navigator', {})
  Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true })
  await mountFields()
  button('複製').click()
  await nextTick()
  expect(host.textContent).toContain('無法自動複製')
  expect(host.textContent).not.toContain('已複製')
})

it('accepts PDF reference attachments and refreshes their usage after category creation', async () => {
  mocks.templates = [
    {
      kind: 'pdf',
      id: 'mock-pdf',
      fileName: '作業規定（Mock）.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 64,
      addedAt: '',
      placeholders: [],
      origin: 'upload',
      usages: [],
    },
  ]
  await mountForm()
  await type('#category-name', 'Mock PDF')
  await submit()
  button('從範本庫選取').click()
  await nextTick()
  const label = [...host.querySelectorAll('label')].find((item) =>
    item.textContent?.includes('作業規定（Mock）.pdf'),
  )!
  expect(label.textContent).toContain('參考文件')
  const checkbox = label.querySelector<HTMLInputElement>('input')!
  checkbox.checked = true
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  expect(checkbox.checked).toBe(true)
  expect(host.querySelector('input[type="file"]')?.getAttribute('accept')).toContain('.pdf')
  await type('#category-step-0', 'Mock PDF step')
  button('建立案件範本').click()
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      steps: [expect.objectContaining({ templateIds: ['mock-pdf'] })],
    }),
  )
  await vi.waitFor(() => expect(mocks.reloadTemplates).toHaveBeenCalledOnce())
})

it.each(['manual', 'builtin', 'both'])(
  'locks the system date and confirms moving %s name from base to using steps',
  async (mode) => {
    mocks.byId.mockReturnValue({
      id: 'existing',
      name: 'Mock removal',
      summary: '',
      updatedAt: '',
      templateCount: 3,
      builtinFields: { 姓名: mode !== 'manual' },
      fields: [
        { id: 'date', key: '日期', type: 'text', scope: 'base' },
        ...(mode !== 'builtin'
          ? [
              {
                id: 'name',
                key: '姓名',
                name: 'Mock 員警姓名',
                type: 'text' as const,
                scope: 'base' as const,
              },
            ]
          : []),
        { id: 'unused', key: 'MockUnused', type: 'text', scope: 'base' },
      ],
      steps: [
        { id: 'base', body: 'Mock base', templateIds: ['doc1', 'pdf'] },
        { id: 'scenario', body: 'Mock scenario', templateIds: ['doc1', 'doc2'] },
        { id: 'unused-step', body: 'Mock unreferenced', templateIds: ['unattached'] },
      ],
      baseSteps: [{ stepId: 'base', sortOrder: 0 }],
      modules: [
        {
          id: 'module',
          categoryId: 'existing',
          name: 'Mock module',
          sortOrder: 0,
          steps: [{ stepId: 'scenario', sortOrder: 0 }],
        },
      ],
    })
    mocks.templates = ['doc1', 'doc2', 'pdf', 'unattached'].map((id) => ({
      id,
      kind: id === 'pdf' ? 'pdf' : 'docx',
      fileName: `${id}.mock`,
      mimeType: 'mock/docx',
      sizeBytes: 0,
      addedAt: '',
      origin: 'upload',
      usages: [],
      placeholders: ['姓名', '姓名'],
    }))
    await mountForm('/categories/existing/edit')
    const dateRow = host.querySelector('[aria-label="系統日期欄位"]')!
    expect(dateRow.textContent).toContain('日期為系統必要欄位')
    expect(dateRow.querySelector('button')!.disabled).toBe(true)
    expect(host.querySelectorAll('[aria-label="系統日期欄位"]')).toHaveLength(1)
    const removeName = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) =>
        button.textContent?.trim() === '移除欄位' &&
        button.parentElement?.textContent?.includes('{{姓名}}'),
    )!
    expect(removeName.disabled).toBe(false)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    removeName.click()
    await nextTick()
    expect(confirm).toHaveBeenCalledWith(
      '有 2 份範本使用 {{姓名}}，移除後會改成在使用它的步驟內填寫',
    )
    expect(removeName.isConnected).toBe(true)
    confirm.mockReturnValue(true)
    removeName.click()
    await nextTick()
    expect(removeName.isConnected).toBe(false)
    const unused = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) =>
        button.textContent?.trim() === '移除欄位' &&
        button.parentElement?.textContent?.includes('{{MockUnused}}'),
    )!
    unused.click()
    await nextTick()
    expect(confirm).toHaveBeenCalledTimes(2)
    await submit()
    expect(mocks.update).toHaveBeenCalledWith(
      'existing',
      expect.objectContaining({
        builtinFields: { 姓名: false },
        fields: [expect.objectContaining({ key: '日期' })],
      }),
    )
    expect(JSON.stringify(mocks.update.mock.calls)).not.toMatch(/stepDateOverrides|values/)
  },
)

it('starts with one blank step, skips the explanation-only page, and creates into the workbench', async () => {
  const router = await mountForm()
  expect(host.querySelector('[aria-label="表單區段"]')?.textContent).not.toContain('情境模組')
  expect(host.querySelector('[aria-label="情境設定"]')).toBeNull()
  await type('#category-name', 'Mock new case')
  await submit()
  expect(host.querySelectorAll('[id^="category-step-"]')).toHaveLength(1)
  expect((host.querySelector('#category-step-0') as HTMLTextAreaElement).value).toBe('')
  button('上一步').click()
  await nextTick()
  expect((host.querySelector('#category-name') as HTMLInputElement).value).toBe('Mock new case')
  await submit()
  await type('#category-step-0', 'Mock first step')
  await submit()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories/created'))
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ steps: [expect.objectContaining({ body: 'Mock first step' })] }),
  )
})
it('confirms removing a wizard step and keeps its values on cancel', async () => {
  await mountForm()
  await type('#category-name', 'Mock new case')
  await submit()
  await type('#category-step-0', 'Mock retained step')
  button('移除').click()
  await nextTick()
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Mock retained step')
  host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-secondary')!.click()
  await nextTick()
  expect((host.querySelector('#category-step-0') as HTMLTextAreaElement).value).toBe(
    'Mock retained step',
  )
  button('移除').click()
  await nextTick()
  host.querySelector<HTMLButtonElement>('[role="dialog"] .btn-danger')!.click()
  await nextTick()
  expect(host.querySelector('#category-step-0')).toBeNull()
})

async function mountStepEditor() {
  const current = shallowRef<CaseCategory>({
    id: 'existing',
    name: 'Mock existing',
    summary: '',
    updatedAt: '',
    templateCount: 0,
    steps: [{ id: 'step', body: 'Mock original step', templateIds: [] }],
    baseSteps: [{ stepId: 'step', sortOrder: 0 }],
    modules: [],
  })
  mocks.byId.mockImplementation(() => current.value)
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/impact')) {
      return Response.json({ impact: { base: [{}], modules: [] } })
    }
    const category = mocks.byId()!
    const step = { ...category.steps[0], ...JSON.parse(String(init.body)) }
    current.value = { ...category, steps: [step] }
    return Response.json({ step })
  })
  vi.stubGlobal('fetch', fetch)
  const router = await mountForm('/categories/existing/edit')
  expect(button('步驟與範本').getAttribute('aria-current')).toBe('step')
  return { router, fetch }
}
function stepInput() {
  return host.querySelector<HTMLInputElement>('input[maxlength="500"]')
}
const dialog = () => host.querySelector('[role="dialog"]')
async function decide(label: string) {
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  const target = [...dialog()!.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label,
  )
  expect(target).toBeDefined()
  target!.click()
  await nextTick()
}

it('opens the step editor at its name and restores focus when Escape closes a clean editor', async () => {
  await mountStepEditor()
  const opener = button('編輯這個步驟')
  opener.click()
  await vi.waitFor(() => expect(stepInput()).not.toBeNull())
  expect(document.activeElement).toBe(stepInput())
  stepInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  expect(stepInput()).toBeNull()
  expect(dialog()).toBeNull()
})

it.each(['儲存並繼續', '放棄'])(
  'prompts before saving metadata with a step draft and handles %s',
  async (decision) => {
    const { router, fetch } = await mountStepEditor()
    await type('#category-name', 'Mock renamed')
    button('編輯這個步驟').click()
    await nextTick()
    await type('input[maxlength="500"]', 'Mock revised step')
    await submit()
    expect(dialog()?.textContent).toContain('編輯區還有未儲存的步驟修改，要一起儲存嗎？')
    await decide('取消')
    expect(stepInput()?.value).toBe('Mock revised step')
    expect(mocks.update).not.toHaveBeenCalled()
    await submit()
    await decide(decision)
    await vi.waitFor(() =>
      expect([...host.querySelectorAll('[role="status"]')].at(-1)?.textContent).toBe('已儲存'),
    )
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      'existing',
      expect.objectContaining({
        name: 'Mock renamed',
        steps: [
          expect.objectContaining({
            body: decision === '放棄' ? 'Mock original step' : 'Mock revised step',
          }),
        ],
      }),
    )
    const stepSave = fetch.mock.calls.filter(([, init]) => init.method === 'PATCH')
    expect(stepSave).toHaveLength(decision === '放棄' ? 0 : 1)
    if (stepSave.length) {
      expect(fetch.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mocks.update.mock.invocationCallOrder[0]!,
      )
    }
    await router.push('/categories')
    expect(router.currentRoute.value.path).toBe('/categories')
    expect(dialog()).toBeNull()
  },
)

it('keeps a dirty step open on Escape until discard is confirmed', async () => {
  await mountStepEditor()
  const opener = button('編輯這個步驟')
  opener.click()
  await nextTick()
  await type('input[maxlength="500"]', 'Mock unsaved step')
  const escape = () =>
    stepInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  escape()
  await decide('繼續編輯')
  expect(stepInput()?.value).toBe('Mock unsaved step')
  escape()
  await decide('放棄修改')
  await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  expect(stepInput()).toBeNull()
})

it('guards the cancel link and refresh only while the new wizard has unsaved inputs', async () => {
  const router = await mountForm()
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(unload()).toBe(false)
  await router.push('/categories')
  expect(router.currentRoute.value.path).toBe('/categories')
  expect(dialog()).toBeNull()
  await router.push('/categories/new')
  await type('#category-name', 'Mock draft')
  expect(unload()).toBe(true)
  const cancel = [...host.querySelectorAll('a')].find((a) => a.textContent?.trim() === '取消')!
  cancel.click()
  await decide('繼續編輯')
  expect(router.currentRoute.value.path).toBe('/categories/new')
  expect((host.querySelector('#category-name') as HTMLInputElement).value).toBe('Mock draft')
  cancel.click()
  await decide('放棄修改')
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories'))
  expect(unload()).toBe(false)
})

it.each([true, false])('uses the copy table across wizard sections (edit: %s)', async (edit) => {
  if (edit) {
    await mountStepEditor()
    button('編輯這個步驟').click()
    await nextTick()
    expect(host.textContent).toContain('編輯步驟（儲存後立即生效）')
    expect(button('儲存這個步驟')).toBeDefined()
    expect(button('儲存名稱與欄位')).toBeDefined()
    expect(host.textContent).toContain('從這裡拿掉（步驟本身還在）')
  } else {
    await mountForm()
    await type('#category-name', 'Mock new')
    await submit()
    button('新增步驟').click()
    await nextTick()
    expect(document.activeElement?.id).toBe('category-step-1')
    expect(button('建立案件範本')).toBeDefined()
  }
  expect(host.querySelector('details summary')?.textContent).toBe('怎麼寫欄位標記')
  expect(host.textContent).toContain('步驟內容（每行一項）')
  expect(host.textContent).not.toMatch(/引用|實體|案類|類別名稱/)
  expect(
    host.querySelector(
      '[aria-label*="引用"], [aria-label*="實體"], [aria-label*="案類"], [aria-label*="類別名稱"]',
    ),
  ).toBeNull()
})

it('keeps both drafts when the step save fails and renders the friendly API error', async () => {
  const { fetch } = await mountStepEditor()
  await type('#category-name', 'Mock renamed')
  button('編輯這個步驟').click()
  await vi.waitFor(() => expect(host.textContent).toContain('這個步驟用在'))
  await type('input[maxlength="500"]', 'Mock revised step')
  fetch.mockResolvedValueOnce(Response.json({ message: '這個類別名稱已經存在。' }, { status: 409 }))
  await submit()
  await decide('儲存並繼續')
  await vi.waitFor(() =>
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('這個案件範本名稱已經存在。'),
  )
  expect(mocks.update).not.toHaveBeenCalled()
  expect(stepInput()?.value).toBe('Mock revised step')
  expect((host.querySelector('#category-name') as HTMLInputElement).value).toBe('Mock renamed')
  expect(host.textContent).not.toMatch(/引用|實體|案類|類別名稱/)
})

function checkError(field: Element, message: string) {
  const error = document.getElementById(field.getAttribute('aria-describedby')!)!
  expect(field.getAttribute('aria-invalid')).toBe('true')
  expect(error.getAttribute('role')).toBe('alert')
  expect(error.textContent?.trim()).toBe(message)
  expect(document.activeElement).toBe(error)
  return error
}

it('uses focused, scrolled Chinese required errors beside the name and the numbered blank step', async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
  await mountForm()
  expect(host.querySelector('form')!.noValidate).toBe(true)
  button('下一步').click()
  await nextTick()
  const checkField = (selector: string, message: string) => {
    const field = host.querySelector(selector)!
    const error = checkError(field, message)
    expect(field.nextElementSibling).toBe(error)
    expect(scroll.mock.contexts).toContain(error)
  }
  await vi.waitFor(() => checkField('#category-name', '請填寫案件範本名稱。'))
  await type('#category-name', 'Mock name')
  await submit()
  await type('#category-step-0', 'Mock first')
  button('新增步驟').click()
  await nextTick()
  button('建立案件範本').click()
  await vi.waitFor(() => checkField('#category-step-1', '第 2 個步驟還沒有填內容。'))
  expect(host.querySelector('#category-step-0')?.hasAttribute('aria-invalid')).toBe(false)
  expect(mocks.create).not.toHaveBeenCalled()
})

it('switches to the name tab and focuses the duplicate-name error under the field', async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
  await mountStepEditor()
  const message = '這個案件範本名稱已經存在。'
  mocks.update.mockRejectedValueOnce(new Error(message))
  await submit()
  const field = host.querySelector<HTMLInputElement>('#category-name')!
  await vi.waitFor(() => {
    const error = checkError(field, message)
    expect(field.nextElementSibling).toBe(error)
    expect(scroll.mock.contexts).toContain(error)
  })
  expect(button('名稱與分類').getAttribute('aria-current')).toBe('step')
})

it('focuses and scrolls a rejected upload error directly below its file control', async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
  await mountForm()
  await type('#category-name', 'Mock name')
  await submit()
  button('從範本庫選取').click()
  await nextTick()
  const message = 'mock.txt：只支援 Word 或 PDF 範本。'
  mocks.addFiles.mockResolvedValueOnce({ ids: [], rejected: [message], formatNotice: '' })
  const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', {
    value: { files: [new File(['mock'], 'mock.txt')] },
  })
  fileInput.parentElement!.dispatchEvent(drop)
  await vi.waitFor(() => {
    const error = checkError(fileInput, message)
    expect(fileInput.parentElement?.nextElementSibling).toBe(error)
    expect(scroll.mock.contexts).toContain(error)
  })
})

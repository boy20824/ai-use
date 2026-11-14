// @vitest-environment happy-dom
import { confirmedNavigation } from '@/test/confirmedNavigation'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import PizZip from 'pizzip'
import JSZip from 'jszip'
import CategoryFormView from './CategoryFormView.vue'
import CategoryView from './CategoryView.vue'
import type { CaseCategory } from '@/types/domain'
import { useCategoryStore } from '@/stores/categories'
import { fieldMappingIssues } from '@/workbench/fieldMapping'
import { listPlaceholders } from '@/services/docxTemplates'
import { buildDocx, kaiBoldRPr, paragraph, run, wordDocument } from '../../shared/docxFixture'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  downloadBytes: vi.fn(),
  downloadBlob: vi.fn(),
  library: [] as { id: string; fileName: string; placeholders: string[]; data: Uint8Array }[],
}))
vi.mock('@/services/api', () => ({
  apiRequest: mocks.request,
  apiErrorMessage: async () => 'Mock API failure',
}))
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ authenticated: true, canEditCategory: true, isSysadmin: false }),
}))
vi.mock('@/stores/templates', () => ({
  useTemplateStore: () => ({
    get items() {
      return mocks.library
    },
    byId: (id: string) => mocks.library.find((t) => t.id === id),
    bytesFor: async (id: string) => mocks.library.find((t) => t.id === id)?.data,
    reload: async () => {},
  }),
}))
vi.mock('@/utils/download', () => ({
  downloadBytes: mocks.downloadBytes,
  downloadBlob: mocks.downloadBlob,
}))
let app: App | undefined
let host: HTMLDivElement
// Mock artifacts stay in a temporary directory so tests do not change workspace evidence.
const evidence = mkdtempSync('/tmp/ai-use-base-fields-')
function snapshot(name: string) {
  mkdirSync(evidence, { recursive: true })
  const clone = host.cloneNode(true) as HTMLElement
  host.querySelectorAll('input').forEach((input, i) => {
    const copy = clone.querySelectorAll('input')[i]!
    copy.setAttribute('value', input.value)
    if (input.checked) copy.setAttribute('checked', '')
  })
  host.querySelectorAll('select').forEach((select, i) => {
    for (const option of clone.querySelectorAll('select')[i]!.options) {
      if (option.value === select.value) option.setAttribute('selected', '')
      else option.removeAttribute('selected')
    }
  })
  writeFileSync(
    `${evidence}/${name}.html`,
    `<!doctype html><meta charset="utf-8">${clone.outerHTML}`,
  )
}
function assertScenarioAlignment() {
  const css = readFileSync('src/style.css', 'utf8')
  const rules =
    css.match(/\.case-workbench \.scenario-choice(?: > input\[type='checkbox'\])? \{[^}]+\}/g) ?? []
  expect(rules).toHaveLength(2)
  const style = document.createElement('style')
  style.textContent = rules.join('\n')
  document.head.append(style)
  try {
    const labels = host.querySelectorAll('[aria-label="情境模組選擇"] > label')
    expect(labels).toHaveLength(2)
    expect(host.querySelector('[aria-label="情境模組選擇"]')?.classList.contains('flex-wrap')).toBe(
      true,
    )
    const checks = [...labels].map((label) => {
      const checkbox = label.querySelector('input')!
      expect(checkbox.type).toBe('checkbox')
      expect(checkbox.parentElement).toBe(label)
      const labelStyle = getComputedStyle(label)
      const checkboxStyle = getComputedStyle(checkbox)
      expect(labelStyle.display).toBe('inline-flex')
      expect(labelStyle.alignItems).toBe('center')
      expect(labelStyle.gap).toBe('0.5rem')
      expect(labelStyle.paddingLeft).toBe('24px')
      expect(labelStyle.maxWidth).toBe('100%')
      expect(labelStyle.minWidth).toBe('0')
      expect(labelStyle.overflowWrap).toBe('anywhere')
      expect(checkboxStyle.flexGrow).toBe('0')
      expect(checkboxStyle.flexShrink).toBe('0')
      expect(checkboxStyle.margin).toBe('0px')
      expect(checkbox.classList.contains('field')).toBe(false)
      return {
        label: label.textContent?.trim(),
        checked: checkbox.checked,
        display: labelStyle.display,
        alignItems: labelStyle.alignItems,
        gap: labelStyle.gap,
        paddingLeft: labelStyle.paddingLeft,
        maxWidth: labelStyle.maxWidth,
        overflowWrap: labelStyle.overflowWrap,
        flexGrow: checkboxStyle.flexGrow,
        flexShrink: checkboxStyle.flexShrink,
        margin: checkboxStyle.margin,
      }
    })
    writeFileSync(
      `${evidence}/scenario-checkbox-css.txt`,
      `${rules.join('\n')}\n${JSON.stringify(checks, null, 2)}\nDOM/CSS assertions in happy-dom; no browser geometry or screenshot claim.\n`,
    )
  } finally {
    style.remove()
  }
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
function button(text: string, root: ParentNode = host) {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
async function click(text: string, root: ParentNode = host) {
  button(text, root).click()
  await settle()
}
async function input(element: Element, value: string) {
  ;(element as HTMLInputElement).value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function check(element: Element, checked: boolean) {
  ;(element as HTMLInputElement).checked = checked
  element.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}
async function submit() {
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await settle()
}
function row(title: string) {
  const found = [...host.querySelectorAll('.fixed-step')].find(
    (li) => li.querySelector('h3')?.textContent?.trim() === title,
  )
  if (!found) throw new Error(`Missing step ${title}`)
  return found
}
async function field(root: ParentNode, label: string, value: string) {
  const found = [...root.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)
  if (!found) throw new Error(`Missing field ${label}`)
  await input(document.getElementById(found.getAttribute('for')!)!, value)
}
afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('maintainer mapping/save/reopen, step field entry and shared values, production DOCX/ZIP, deselection and memory clearing', async () => {
  let saved: CaseCategory = {
    id: 'mock',
    name: 'Mock acceptance',
    summary: '',
    updatedAt: '',
    templateCount: 3,
    fields: [{ id: 'legacy-y', key: 'Y', name: 'Mock Y label', type: 'number' }],
    steps: [
      { id: 'base', body: 'Base Mock', templateIds: ['base'] },
      { id: 'd', body: 'D Mock', templateIds: [] },
      { id: 'f', body: 'F Mock', templateIds: ['same', 'z'] },
    ],
    baseSteps: [{ stepId: 'base', sortOrder: 0 }],
    modules: ['m', 'n'].map((id, sortOrder) => ({
      id,
      categoryId: 'mock',
      name: id.toUpperCase(),
      sortOrder,
      steps: [{ stepId: id === 'm' ? 'd' : 'f', sortOrder: 0 }],
    })),
  }
  mocks.library = [
    ['base', '{{X}}'],
    ['same', '{{X}}/{{Y}}/{{日期}}/{{日期_民國}}/{{年}}/{{月}}/{{日}}'],
    ['z', '{{Z}}'],
  ].map(([id, text]) => {
    const data = buildDocx({ document: wordDocument(paragraph(run(kaiBoldRPr, text!))) })
    return { id: id!, fileName: `${id}.docx`, placeholders: listPlaceholders(data), data }
  })
  mocks.request.mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url === '/api/categories') return Response.json({ categories: [saved] })
    if (url.endsWith('/impact'))
      return Response.json({ impact: { base: [], modules: [{ name: 'M' }] } })
    if (url === '/api/categories/mock/steps/d' && init?.method === 'PATCH') {
      saved.steps = saved.steps.map((s) => (s.id === 'd' ? { ...s, ...body } : s))
      return Response.json({ step: saved.steps[1] })
    }
    if (url === '/api/categories/mock' && init?.method === 'PATCH') {
      saved = { ...saved, ...body }
      return Response.json({ category: saved })
    }
    throw new Error(`Unexpected mock request ${url}`)
  })
  const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
  const indexedDbOpen = vi.fn(() => {
    throw new Error('Case values must not use IndexedDB')
  })
  vi.stubGlobal('indexedDB', { open: indexedDbOpen })
  const pinia = createPinia()
  const categories = useCategoryStore(pinia)
  await categories.load()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id/edit', name: 'category-edit', component: CategoryFormView },
      { path: '/categories/:id', component: CategoryView },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await confirmedNavigation(router, '/categories/mock/edit')
  await router.isReady()
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router)
  app.mount(host)
  await nextTick()
  await submit()
  await submit()
  for (const name of ['X']) {
    await click('新增欄位')
    await input(
      [...host.querySelectorAll('[aria-label="欄位名稱"]')].at(-1)!,
      name === 'X' ? '{{X}}' : name,
    )
  }
  expect(host.querySelector('code')?.textContent).toBe('{{X}}')
  await input(host.querySelector('[aria-label="欄位名稱"]')!, 'X')
  await click('M')
  expect(
    [...host.querySelectorAll('button')].some(
      (button) => button.textContent?.trim() === '新增欄位',
    ),
  ).toBe(false)
  expect(host.querySelector('[aria-label="基本 SOP 細項欄位"]')).toBeNull()
  expect(host.querySelector('[aria-label="既有欄位定義（保留）"]')?.textContent).toContain('{{Y}}')
  snapshot('maintainer-scenario-auto-only')
  const panel = [...host.querySelectorAll('section')].find(
    (s) => s.querySelector('h3')?.textContent === 'M',
  )!
  await click('編輯共用步驟', panel)
  await check(host.querySelector('input[value="same"]')!, true)
  const parallel = [...host.querySelectorAll('label')]
    .find((l) => l.textContent?.includes('此步驟可請其他人同步進行'))!
    .querySelector('input')!
  await check(parallel, true)
  await click('儲存共用步驟')
  expect(saved.steps.find((s) => s.id === 'd')).toMatchObject({
    templateIds: ['same'],
    canRunInParallel: true,
  })
  // Saving a step reloads the category; unsaved base definitions survive.
  expect(host.querySelectorAll('[aria-label="欄位名稱"]')).toHaveLength(0)
  await click('維護基本 SOP')
  expect(host.querySelectorAll('[aria-label="欄位名稱"]')).toHaveLength(1)
  await submit()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories/mock'))
  await confirmedNavigation(router, '/categories/mock/edit')
  await settle()
  await submit()
  await submit()
  expect([...host.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['{{X}}', '{{Y}}'])
  expect(host.querySelectorAll('[aria-label="欄位名稱"]')).toHaveLength(1)
  await input(host.querySelector('[aria-label="欄位名稱"]')!, 'Mock X label')
  expect(host.querySelector('code')?.textContent).toBe('{{X}}')
  // The exact X mapping is used by both base and scenario documents.
  const remove = button('移除欄位', host.querySelector('[aria-label="欄位名稱"]')!.parentElement!)
  expect(remove.disabled).toBe(false)
  const confirm = vi.fn(() => false)
  vi.stubGlobal('confirm', confirm)
  remove.click()
  await settle()
  expect(confirm).toHaveBeenCalledWith('有 2 份範本使用 {{X}}，移除後會改成在使用它的步驟內填寫')
  expect(host.querySelector('[aria-label="欄位名稱"]')).not.toBeNull()
  confirm.mockReturnValue(true)
  remove.click()
  await settle()
  expect(host.querySelector('[aria-label="欄位名稱"]')).toBeNull()
  snapshot('maintainer-reopened')
  await submit()
  expect(saved.fields?.find((field) => field.id === 'legacy-y')).toEqual({
    id: 'legacy-y',
    key: 'Y',
    name: 'Mock Y label',
    type: 'number',
  })
  await settle()
  expect(saved.fields?.some((field) => field.key === 'X')).toBe(false)
  expect(host.querySelector('.basic-data-row')?.textContent).not.toContain('Mock X label')
  expect(host.querySelector('.basic-data-row')?.textContent).not.toContain('Mock Y label')
  expect(host.querySelector('#step-d-0')).toBeNull()
  await check(host.querySelector('[aria-label="情境模組選擇"] input[value="m"]')!, true)
  expect(row('D Mock').textContent).toContain('可請其他人同步處理')
  expect(row('D Mock').querySelector('input[type="number"]')).not.toBeNull()
  expect(host.querySelector('#step-f-0')).toBeNull()
  expect(host.querySelector('.basic-data-row input[placeholder="請輸入姓名"]')).toBeNull()
  await field(row('Base Mock'), 'X', 'Mock Shared X')
  const dates = host.querySelectorAll('.basic-data-row select')
  for (const [i, value] of ['115', '11', '7'].entries()) {
    ;(dates[i] as HTMLSelectElement).value = value
    dates[i]!.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
  }
  const parallelD = host.querySelector('.parallel-work-item')!
  const details = parallelD.querySelector('details')!
  details.open = true
  await field(parallelD, 'Mock Y label', '24.5')
  expect((row('D Mock').querySelector('input[type="number"]') as HTMLInputElement).value).toBe(
    '24.5',
  )
  details.open = false
  details.open = true
  expect((parallelD.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('24.5')
  assertScenarioAlignment()
  snapshot('workbench-m-selected')
  await click('產生', parallelD)
  await vi.waitFor(() => expect(mocks.downloadBytes).toHaveBeenCalledOnce())
  const data = mocks.downloadBytes.mock.calls[0]![0] as Uint8Array
  const xml = new PizZip(data).file('word/document.xml')!.asText()
  expect(xml).toContain('Mock Shared X/24.5/115年11月7日/115/11/7/115/11/7')
  expect(xml).toContain('<w:b')
  writeFileSync(`${evidence}/d.docx`, data)
  writeFileSync(`${evidence}/d-document.xml`, xml)
  writeFileSync(`${evidence}/d-text.txt`, xml.replace(/<[^>]+>/g, ''))
  await check(host.querySelector('[aria-label="情境模組選擇"] input[value="n"]')!, true)
  await field(row('F Mock'), 'Mock Y label', '99.25')
  expect(saved.fields?.some((field) => field.key === 'Z')).toBe(false)
  await field(row('F Mock'), 'Z', 'Mock Only N')
  saved.combinationOrders = [{ moduleIds: ['m', 'n'], stepIds: ['f', 'base', 'd'] }]
  await categories.reload()
  await settle()
  expect(host.querySelector('.fixed-step h3')?.textContent?.trim()).toBe('F Mock')
  expect((row('D Mock').querySelector('input[type="number"]') as HTMLInputElement).value).toBe(
    '99.25',
  )
  await click('全部文件總覽')
  snapshot('overview-reordered')
  await click('產生勾選文件')
  await vi.waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledOnce())
  const zip = await JSZip.loadAsync(
    await (mocks.downloadBlob.mock.calls[0]![0] as Blob).arrayBuffer(),
  )
  const xmls = await Promise.all(
    Object.values(zip.files).map(async (f) =>
      new PizZip(await f.async('uint8array')).file('word/document.xml')!.asText(),
    ),
  )
  writeFileSync(`${evidence}/repeated-step-documents.xml.txt`, xmls.join('\n\n'))
  expect(xmls.filter((x) => x.includes('Mock Shared X/99.25/'))).toHaveLength(2)
  expect(xmls.some((x) => x.includes('Mock Shared X/99.25/'))).toBe(true)
  expect(xmls.some((x) => x.includes('Mock Only N'))).toBe(true)
  expect(Object.keys(zip.files)).toHaveLength(4)
  expect(xmls.every((xml) => !xml.includes('{{') && !xml.includes('}}'))).toBe(true)
  await click('範本步驟')
  await check(host.querySelector('[aria-label="情境模組選擇"] input[value="n"]')!, false)
  await check(host.querySelector('[aria-label="情境模組選擇"] input[value="m"]')!, false)
  expect(host.textContent).not.toContain('Mock Y label')
  expect(host.querySelector('#step-d-0')).toBeNull()
  snapshot('workbench-deselected')
  await click('全部文件總覽')
  await click('產生勾選文件')
  await vi.waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledTimes(2))
  const deselected = await JSZip.loadAsync(
    await (mocks.downloadBlob.mock.calls[1]![0] as Blob).arrayBuffer(),
  )
  expect(Object.keys(deselected.files)).toHaveLength(1)
  expect(JSON.stringify(mocks.request.mock.calls)).not.toMatch(
    /Mock Person|Mock Shared X|24\.5|99\.25|Mock Only N/,
  )
  await confirmedNavigation(router, '/categories/mock/edit')
  await settle()
  await confirmedNavigation(router, '/categories/mock')
  await settle()
  await check(host.querySelector('[aria-label="情境模組選擇"] input[value="m"]')!, true)
  expect((row('D Mock').querySelector('input[type="number"]') as HTMLInputElement).value).toBe('')
  expect(storageWrite).not.toHaveBeenCalled()
  expect(indexedDbOpen).not.toHaveBeenCalled()
  storageWrite.mockRestore()
  // Legacy settings with broken keys are diagnosed, never guessed from a label.
  saved.fields!.find((field) => field.id === 'legacy-y')!.key = 'LegacyY'
  await categories.reload()
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('{{LegacyY}}')
  snapshot('workbench-legacy-mapping-error')
  writeFileSync(
    `${evidence}/unmatched-legacy.json`,
    JSON.stringify(
      {
        source: 'mock fixtures only; no production categories, cases or accounts inspected',
        unmatched: saved.fields!.filter((field) => field.key === 'LegacyY'),
        preserved: true,
      },
      null,
      2,
    ),
  )
})

it('reports manual keys with no output instead of silently ignoring their definitions', async () => {
  const field = { id: 'orphan', key: 'Orphan', name: 'Mock orphan', type: 'text' as const }
  for (const templates of [[], [{ id: 'empty', fileName: 'empty.docx', placeholders: [] }]]) {
    expect(fieldMappingIssues([field], templates)[0]).toContain('{{Orphan}}')
    expect(fieldMappingIssues([field], templates)[0]).toContain('偵測到的欄位：無')
  }
  let retained: CaseCategory | undefined
  mocks.request.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      retained = { ...retained!, ...JSON.parse(String(init.body)) }
      return Response.json({ category: retained })
    }
    return Response.json({
      categories: [
        retained ??
          (retained = {
            id: 'empty',
            name: 'Mock no output',
            summary: '',
            updatedAt: '',
            templateCount: 0,
            fields: [field],
            steps: [],
            baseSteps: [],
            modules: [],
          }),
      ],
    })
  })
  const pinia = createPinia()
  await useCategoryStore(pinia).load()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id/edit', name: 'category-edit', component: CategoryFormView },
      { path: '/categories/:id', component: CategoryView },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await confirmedNavigation(router, '/categories/empty/edit')
  await router.isReady()
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router)
  app.mount(host)
  await nextTick()
  await submit()
  await submit()
  await submit()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('{{Orphan}}')
  expect(retained?.fields).toEqual([field])
  snapshot('workbench-retained-no-output')
  await confirmedNavigation(router, '/categories/empty/edit')
  await settle()
  await submit()
  await submit()
  expect(host.querySelector('[aria-label="既有欄位定義（保留）"]')?.textContent).toContain(
    '{{Orphan}}',
  )
  snapshot('maintainer-retained-no-output')
  writeFileSync(
    `${evidence}/unmatched-orphan.json`,
    JSON.stringify(
      {
        source: 'mock fixture only',
        unmatched: retained?.fields,
        preservedAfterSave: true,
      },
      null,
      2,
    ),
  )
  await confirmedNavigation(router, '/categories/empty')
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('{{Orphan}}')
  snapshot('workbench-no-output-error')
})

it('saves a base field without templates, reopens it, and later consumes the exact tag through production generation', async () => {
  let saved: CaseCategory = {
    id: 'standalone',
    name: 'Mock standalone',
    summary: '',
    updatedAt: '',
    templateCount: 0,
    fields: [{ id: 'legacy', key: 'LegacyScenario', name: 'Legacy label', type: 'number' }],
    steps: [
      { id: 'base', body: 'Mock base', templateIds: [] },
      {
        id: 'unused',
        body: 'Mock retained unreferenced',
        title: 'Mock retained unreferenced',
        items: ['Mock item'],
        note: 'Mock note',
        order: 1,
        variantIds: [],
        canRunInParallel: true,
        templateIds: [],
      },
    ],
    baseSteps: [{ stepId: 'base', sortOrder: 0 }],
    modules: [],
  }
  const untouched = structuredClone(saved.steps[1])
  mocks.library = []
  mocks.request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/categories') return Response.json({ categories: [saved] })
    if (url.endsWith('/impact')) return Response.json({ impact: { base: ['base'], modules: [] } })
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url === '/api/categories/standalone' && init?.method === 'PATCH') {
      saved = { ...saved, ...body }
      return Response.json({ category: saved })
    }
    if (url === '/api/categories/standalone/steps/base' && init?.method === 'PATCH') {
      saved.steps[0] = { ...saved.steps[0]!, ...body }
      return Response.json({ step: saved.steps[0] })
    }
    throw new Error(`Unexpected request ${url}`)
  })
  const storageWrite = vi.spyOn(Storage.prototype, 'setItem')
  const indexedDbOpen = vi.fn(() => {
    throw new Error('No persistent case values')
  })
  vi.stubGlobal('indexedDB', { open: indexedDbOpen })
  const pinia = createPinia()
  await useCategoryStore(pinia).load()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id/edit', name: 'category-edit', component: CategoryFormView },
      { path: '/categories/:id', component: CategoryView },
      { path: '/categories', component: { render: () => h('div') } },
    ],
  })
  await confirmedNavigation(router, '/categories/standalone/edit')
  await router.isReady()
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RouterView) })
    .use(pinia)
    .use(router)
  app.mount(host)
  await nextTick()
  await submit()
  await submit()
  expect(host.textContent).not.toContain('共用步驟實體（含未引用步驟）')
  await click('新增欄位')
  await input(host.querySelector('[aria-label="欄位名稱"]')!, '身分證')
  snapshot('base-no-template-before-save')
  await submit()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories/standalone'))
  expect(saved.fields).toEqual([
    { id: 'legacy', key: 'LegacyScenario', name: 'Legacy label', type: 'number' },
    expect.objectContaining({ key: '身分證', name: '身分證', scope: 'base' }),
  ])
  expect(host.querySelector('.basic-data-row')?.textContent).toContain('身分證')
  const savedField = structuredClone(saved.fields![1])
  await confirmedNavigation(router, '/categories/standalone/edit')
  await settle()
  await submit()
  await submit()
  expect((host.querySelector('[aria-label="欄位名稱"]') as HTMLInputElement).value).toBe('身分證')
  expect(host.querySelector('[aria-label="既有欄位定義（保留）"]')?.textContent).toContain(
    'Legacy label',
  )
  snapshot('base-reopened-without-template')
  // Attach a real mock DOCX through the mounted normal step editor, without a matching tag.
  const data = buildDocx({ document: wordDocument(paragraph(run(kaiBoldRPr, '{{Other}}'))) })
  mocks.library = [
    { id: 'late', fileName: 'mock-late.docx', placeholders: listPlaceholders(data), data },
  ]
  await confirmedNavigation(router, '/categories/standalone')
  await confirmedNavigation(router, '/categories/standalone/edit')
  await settle()
  await submit()
  await submit()
  await click('編輯共用步驟')
  await check(host.querySelector('input[value="late"]')!, true)
  await click('儲存共用步驟')
  await submit()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories/standalone'))
  expect(saved.fields![1]).toEqual(savedField)
  snapshot('base-unmatched-template-save-success')
  // Later attach a second mock DOCX containing the exact tag through the normal step editor.
  const exact = buildDocx({ document: wordDocument(paragraph(run(kaiBoldRPr, '{{身分證}}'))) })
  mocks.library.push({
    id: 'exact',
    fileName: 'mock-exact.docx',
    placeholders: listPlaceholders(exact),
    data: exact,
  })
  await confirmedNavigation(router, '/categories/standalone/edit')
  await settle()
  await submit()
  await submit()
  await click('編輯共用步驟')
  await check(host.querySelector('input[value="late"]')!, false)
  await check(host.querySelector('input[value="exact"]')!, true)
  await click('儲存共用步驟')
  await submit()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories/standalone'))
  await settle()
  await field(host.querySelector('.basic-data-row')!, '身分證', 'MOCK_SHARED_ID_26')
  expect(row('Mock base').querySelector('#step-base-0')).toBeNull()
  snapshot('base-exact-tag-shared-value')
  await click('產生', row('Mock base'))
  await vi.waitFor(() => expect(mocks.downloadBytes).toHaveBeenCalledOnce())
  const generated = mocks.downloadBytes.mock.calls[0]![0] as Uint8Array
  const xml = new PizZip(generated).file('word/document.xml')!.asText()
  expect(xml).toContain('MOCK_SHARED_ID_26')
  expect(xml).not.toContain('{{')
  expect(saved.steps[1]).toEqual(untouched)
  expect(saved.steps[0]!.templateIds).toEqual(['exact'])
  expect(saved.baseSteps).toEqual([{ stepId: 'base', sortOrder: 0 }])
  expect(saved.fields![0]).not.toHaveProperty('scope')
  expect(JSON.stringify(mocks.request.mock.calls)).not.toContain('MOCK_SHARED_ID_26')
  expect(storageWrite).not.toHaveBeenCalled()
  expect(indexedDbOpen).not.toHaveBeenCalled()
  writeFileSync(`${evidence}/base-exact-source.docx`, exact)
  writeFileSync(`${evidence}/base-generated.docx`, generated)
  writeFileSync(`${evidence}/base-generated-document.xml`, xml)
  writeFileSync(`${evidence}/preserved-mock-config.json`, JSON.stringify(saved, null, 2))
})

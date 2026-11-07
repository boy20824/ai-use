// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
// The requested /workspace/evidence is read-only in this executor. Override in a writable executor.
const evidence = process.env.STEP_FIELDS_EVIDENCE_DIR || '/workspace/ai-use/evidence/step-fields'
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
    const checks = [...labels].map((label) => {
      const checkbox = label.querySelector('input')!
      expect(checkbox.type).toBe('checkbox')
      expect(checkbox.parentElement).toBe(label)
      const labelStyle = getComputedStyle(label)
      const checkboxStyle = getComputedStyle(checkbox)
      expect(labelStyle.display).toBe('inline-flex')
      expect(labelStyle.alignItems).toBe('center')
      expect(labelStyle.gap).toBe('0.5rem')
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

it('maintainer mapping/save/reopen, step-local entry, production DOCX/ZIP, deselection and memory clearing', async () => {
  let saved: CaseCategory = {
    id: 'mock',
    name: 'Mock acceptance',
    summary: '',
    updatedAt: '',
    templateCount: 3,
    fields: [],
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
    ],
  })
  await router.push('/categories/mock/edit')
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
  for (const name of ['X', 'Y', 'Z']) {
    await click('新增欄位')
    await input(
      [...host.querySelectorAll('[aria-label="欄位名稱"]')].at(-1)!,
      name === 'X' ? '{{X}}' : name,
    )
  }
  expect(host.querySelector('code')?.textContent).toBe('{{X}}')
  await input(host.querySelector('[aria-label="欄位名稱"]')!, 'X')
  await click('M')
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
  // Saving a step reloads the category; unsaved manual definitions must survive.
  expect(host.querySelectorAll('[aria-label="欄位名稱"]')).toHaveLength(3)
  const type = host.querySelectorAll('[aria-label="欄位型別"]')[1] as HTMLSelectElement
  type.value = 'number'
  type.dispatchEvent(new Event('change', { bubbles: true }))
  // A manual name that does not match scanned Y must give an actionable error.
  await input(host.querySelectorAll('[aria-label="欄位名稱"]')[1]!, 'WrongY')
  await submit()
  expect(router.currentRoute.value.path).toBe('/categories/mock/edit')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('{{WrongY}}')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('重新上傳')
  snapshot('maintainer-mapping-error')
  await input(host.querySelectorAll('[aria-label="欄位名稱"]')[1]!, 'Y')
  await submit()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/categories/mock'))
  await router.push('/categories/mock/edit')
  await settle()
  await submit()
  await submit()
  expect([...host.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
    '{{X}}',
    '{{Y}}',
    '{{Z}}',
  ])
  await input(host.querySelectorAll('[aria-label="欄位名稱"]')[1]!, 'Mock Y label')
  expect(host.querySelectorAll('code')[1]?.textContent).toBe('{{Y}}')
  snapshot('maintainer-reopened')
  await submit()
  expect(saved.fields?.[1]).toMatchObject({ key: 'Y', name: 'Mock Y label', type: 'number' })
  await settle()
  expect(host.querySelector('.basic-data-row')?.textContent).toContain('X')
  expect(host.querySelector('.basic-data-row')?.textContent).not.toContain('Mock Y label')
  expect(host.querySelector('#step-d-0')).toBeNull()
  await check(host.querySelector('[aria-label="情境模組選擇"] input[value="m"]')!, true)
  expect(row('D Mock').textContent).toContain('此步驟可請其他人同步進行')
  expect(row('D Mock').querySelector('input[type="number"]')).not.toBeNull()
  expect(host.querySelector('#step-f-0')).toBeNull()
  await field(host.querySelector('.basic-data-row')!, '姓名', 'Mock Person')
  await field(host.querySelector('.basic-data-row')!, 'X', 'Mock Shared X')
  const dates = host.querySelectorAll('.basic-data-row select')
  for (const [i, value] of ['115', '11', '7'].entries()) {
    ;(dates[i] as HTMLSelectElement).value = value
    dates[i]!.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
  }
  await field(row('D Mock'), 'Mock Y label', '24.5')
  assertScenarioAlignment()
  snapshot('workbench-m-selected')
  await click('產生', row('D Mock'))
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
  await field(row('F Mock'), 'Z', 'Mock Only N')
  saved.combinationOrders = [{ moduleIds: ['m', 'n'], stepIds: ['f', 'base', 'd'] }]
  await categories.reload()
  await settle()
  expect(host.querySelector('.fixed-step h3')?.textContent?.trim()).toBe('F Mock')
  expect((row('D Mock').querySelector('input[type="number"]') as HTMLInputElement).value).toBe(
    '24.5',
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
  expect(xmls.some((x) => x.includes('Mock Shared X/24.5/'))).toBe(true)
  expect(xmls.some((x) => x.includes('Mock Shared X/99.25/'))).toBe(true)
  expect(xmls.some((x) => x.includes('Mock Only N'))).toBe(true)
  expect(Object.keys(zip.files)).toHaveLength(4)
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
  await router.push('/categories/mock/edit')
  await settle()
  await router.push('/categories/mock')
  await settle()
  await check(host.querySelector('[aria-label="情境模組選擇"] input[value="m"]')!, true)
  expect((row('D Mock').querySelector('input[type="number"]') as HTMLInputElement).value).toBe('')
  expect(storageWrite).not.toHaveBeenCalled()
  expect(indexedDbOpen).not.toHaveBeenCalled()
  storageWrite.mockRestore()
  // Legacy settings with broken keys are diagnosed, never guessed from a label.
  saved.fields![1]!.key = 'LegacyY'
  await categories.reload()
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('{{LegacyY}}')
  snapshot('workbench-legacy-mapping-error')
})

it('reports manual keys with no output instead of silently ignoring their definitions', async () => {
  const field = { id: 'orphan', key: 'Orphan', name: 'Mock orphan', type: 'text' as const }
  for (const templates of [[], [{ id: 'empty', fileName: 'empty.docx', placeholders: [] }]]) {
    expect(fieldMappingIssues([field], templates)[0]).toContain('{{Orphan}}')
    expect(fieldMappingIssues([field], templates)[0]).toContain('偵測到的欄位：無')
  }
  mocks.request.mockImplementation(async () =>
    Response.json({
      categories: [
        {
          id: 'empty',
          name: 'Mock no output',
          summary: '',
          updatedAt: '',
          templateCount: 0,
          fields: [field],
          steps: [],
          baseSteps: [],
          modules: [],
        },
      ],
    }),
  )
  const pinia = createPinia()
  await useCategoryStore(pinia).load()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/categories/:id/edit', name: 'category-edit', component: CategoryFormView },
      { path: '/categories/:id', component: CategoryView },
    ],
  })
  await router.push('/categories/empty/edit')
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
  expect(mocks.request.mock.calls.every(([, init]) => !init?.method)).toBe(true)
  snapshot('maintainer-no-output-error')
  await router.push('/categories/empty')
  await settle()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('{{Orphan}}')
  snapshot('workbench-no-output-error')
})

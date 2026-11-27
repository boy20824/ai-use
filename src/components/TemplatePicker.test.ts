// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import TemplatePicker from './TemplatePicker.vue'

const items = [
  { id: 'first', fileName: 'First.docx', kind: 'docx' },
  { id: 'report', fileName: 'Mock<Report>.docx', kind: 'docx' },
  { id: 'third', fileName: 'Third.docx', kind: 'docx' },
  { id: 'reference', fileName: 'MockReference.pdf', kind: 'pdf' },
] as const

function mount(initialSelection: string[] = []) {
  const host = document.createElement('div')
  const selection = ref(initialSelection)
  const app = createApp({
    render: () =>
      h(TemplatePicker, {
        items,
        idPrefix: 'mock-picker',
        modelValue: selection.value,
        'onUpdate:modelValue': (ids) => (selection.value = ids),
      }),
  })
  app.mount(host)
  const boxes = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  return { host, selection, boxes, unmount: () => app.unmount() }
}

it('searches the displayed filename without regard to case', async () => {
  const { host, boxes, unmount } = mount(['reference'])
  try {
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
    expect(host.querySelector(`label[for="${search.id}"]`)?.textContent).toBe('搜尋範本')
    expect(search.placeholder).toBe('請輸入檔名')
    async function searchFor(value: string) {
      search.value = value
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
    }
    await searchFor('  MOCKREPORT  ')
    expect(boxes().map((box) => box.value)).toEqual(['report'])
    expect(host.textContent).toContain('已選 1 份，共 4 份')
    await searchFor('unmatched')
    expect(boxes()).toHaveLength(0)
    expect(host.textContent).toContain('沒有符合的範本')
  } finally {
    unmount()
  }
})

it('pins checked rows in library order while preserving the model order', async () => {
  const { host, selection, boxes, unmount } = mount(['reference', 'report'])
  try {
    expect(boxes().map((box) => box.value)).toEqual(['report', 'reference', 'first', 'third'])
    expect(boxes().map((box) => box.checked)).toEqual([true, true, false, false])
    expect(boxes()[1]!.closest('label')?.textContent).toContain('參考文件')

    const third = boxes().find((box) => box.value === 'third')!
    third.checked = true
    third.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(boxes().map((box) => box.value)).toEqual(['report', 'third', 'reference', 'first'])
    expect(selection.value).toEqual(['reference', 'report', 'third'])
    expect(host.textContent).toContain('已選 3 份，共 4 份')

    third.checked = false
    third.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(boxes().map((box) => box.value)).toEqual(['report', 'reference', 'first', 'third'])
    expect(selection.value).toEqual(['reference', 'report'])
  } finally {
    unmount()
  }
})

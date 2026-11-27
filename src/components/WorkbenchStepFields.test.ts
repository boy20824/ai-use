// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import WorkbenchStepFields from './WorkbenchStepFields.vue'

vi.mock('@/stores/templates', () => ({ useTemplateStore: () => ({}) }))

it('lists each missing field once for the step and lets users jump to it', () => {
  const host = document.createElement('div')
  const focus = vi.fn()
  const app = createApp({
    render: () =>
      h(WorkbenchStepFields, {
        fields: [],
        values: {},
        prefix: 'mock',
        missing: ['姓名', '姓名', '日期'],
        templates: ['one', 'two'].map((id) => ({
          id,
          fileName: `${id}.docx`,
          placeholders: ['姓名'],
        })),
        busy: false,
        message: '',
        messageTone: 'ok',
        onFocusField: focus,
      }),
  })
  app.mount(host)
  try {
    const hints = host.querySelectorAll('p.text-xs.text-ink-muted')
    expect(hints).toHaveLength(1)
    const hint = hints[0]!
    expect(hint.className).toBe('mt-2 text-xs text-ink-muted')
    expect(hint.textContent).toBe(' 請先填寫： 姓名、日期')
    const buttons = [...hint.querySelectorAll('button')]
    expect(buttons.map((button) => button.className)).toEqual([
      'focus-control underline',
      'focus-control underline',
    ])
    for (const [index, key] of ['姓名', '日期'].entries()) {
      buttons[index]!.click()
      expect(focus).toHaveBeenLastCalledWith(key)
    }
    const generate = [...host.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      b.textContent?.trim().startsWith('產生'),
    )
    expect(generate).toHaveLength(3)
    expect(generate.every((button) => button.disabled)).toBe(true)
    expect(generate.slice(1).map((button) => button.title)).toEqual([
      '姓名、姓名、日期',
      '姓名、姓名、日期',
    ])
  } finally {
    app.unmount()
  }
})

it('shows placeholder counts and keeps field names collapsed by default', () => {
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(WorkbenchStepFields, {
        fields: [],
        values: {},
        prefix: 'mock',
        missing: [],
        templates: [
          { id: 'with-fields', fileName: 'With fields.docx', placeholders: ['姓名', '案號'] },
          { id: 'no-fields', fileName: 'No fields.docx', placeholders: [] },
        ],
        busy: false,
        message: '',
        messageTone: 'ok',
      }),
  })
  app.mount(host)
  try {
    const details = [...host.querySelectorAll('details')]
    expect(details.map((item) => item.querySelector('summary')?.textContent?.trim())).toEqual([
      '2 個欄位',
      '沒有偵測到欄位',
    ])
    expect(details.map((item) => item.open)).toEqual([false, false])
    expect(details[0]?.textContent).toContain('姓名、案號')
    const generate = [...host.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === '產生',
    )
    expect(generate.map((button) => button.title)).toEqual(['產出 .docx', '產出 .docx'])
  } finally {
    app.unmount()
  }
})

// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import WorkbenchStepFields from './WorkbenchStepFields.vue'

vi.mock('@/stores/templates', () => ({ useTemplateStore: () => ({}) }))

it('explains missing fields beside each disabled generate action and lets users jump to them', () => {
  const host = document.createElement('div')
  const focus = vi.fn()
  const app = createApp({
    render: () =>
      h(WorkbenchStepFields, {
        fields: [],
        values: {},
        prefix: 'mock',
        missing: ['姓名', '姓名'],
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
    const generate = [...host.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      b.textContent?.trim().startsWith('產生'),
    )
    expect(generate).toHaveLength(3)
    for (const button of generate) {
      expect(button.disabled).toBe(true)
      const hint = button.parentElement!.querySelector('p')!
      expect(hint.textContent).toContain('請先填寫：')
      expect(hint.querySelectorAll('button')).toHaveLength(1)
      hint.querySelector('button')!.click()
      expect(focus).toHaveBeenLastCalledWith('姓名')
    }
  } finally {
    app.unmount()
  }
})

// @vitest-environment happy-dom
import { createApp } from 'vue'
import { describe, expect, it } from 'vitest'
import FeedbackText from './FeedbackText.vue'

describe('feedback text', () => {
  it('renders a stored payload as text and keeps line breaks', () => {
    const payload = '第一行\n<img src=x onerror="alert(1)"><script>alert(1)</script>'
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(FeedbackText, { text: payload })
    app.mount(host)
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('script')).toBeNull()
    expect(host.textContent).toBe(payload)
    expect(host.querySelector('span')?.className).toContain('whitespace-pre-wrap')
    app.unmount()
    host.remove()
  })
})

// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { createApp, h } from 'vue'
import PageIntro from './PageIntro.vue'

it('stacks below md and restores the horizontal actions at md', () => {
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(PageIntro, { title: 'Mock', description: 'Mock description' }, () =>
        h('button', 'Mock action'),
      ),
  })
  app.mount(host)
  try {
    expect(host.querySelector('header')?.classList).toContain('flex-col')
    expect(host.querySelector('header')?.classList).toContain('md:flex-row')
    const actions = host.querySelector('header > div:last-child')!
    expect(actions.classList).toContain('w-full')
    expect(actions.classList).toContain('md:w-auto')
    expect(actions.classList).toContain('md:shrink-0')
  } finally {
    app.unmount()
  }
})

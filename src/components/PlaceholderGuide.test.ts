// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { createApp } from 'vue'
import PlaceholderGuide from './PlaceholderGuide.vue'

it('links to both ASCII mock URLs with Chinese download filenames', () => {
  const host = document.createElement('div')
  const app = createApp(PlaceholderGuide)
  app.mount(host)
  try {
    expect(
      [...host.querySelectorAll('a[href^="/templates/"]')].map((link) => [
        link.getAttribute('href'),
        link.textContent?.trim(),
        link.getAttribute('download'),
      ]),
    ).toEqual([
      [
        '/templates/scene-photos-template.docx',
        '下載 刑案現場照片（可插入圖片）Mock 範本',
        '刑案現場照片（可插入圖片）.docx',
      ],
      [
        '/templates/delivery-certificate-photos-template.docx',
        '下載 送達證書黏貼照片（可插入圖片）Mock 範本',
        '送達證書黏貼照片（可插入圖片）.docx',
      ],
    ])
  } finally {
    app.unmount()
  }
})

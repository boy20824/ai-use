import { writeFile } from 'node:fs/promises'
import { buildPhotoTemplate } from '../shared/photoTemplateFixture.ts'
await writeFile(
  new URL('../public/templates/scene-photos-template.docx', import.meta.url),
  buildPhotoTemplate(),
)
console.log('已建立 刑案現場照片（可插入圖片）Mock 範本。')

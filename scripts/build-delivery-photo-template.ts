import { writeFile } from 'node:fs/promises'
import { buildDeliveryPhotoTemplate } from '../shared/deliveryPhotoTemplateFixture.ts'

await writeFile(
  new URL('../public/templates/delivery-certificate-photos-template.docx', import.meta.url),
  buildDeliveryPhotoTemplate(),
)
console.log('已建立 Mock 送達證書黏貼單範本。')

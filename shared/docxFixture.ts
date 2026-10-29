import PizZip from 'pizzip'

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`

const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`

export function wordDocument(innerBody: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${innerBody}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/></w:sectPr></w:body>
</w:document>`
}

export function wordHeader(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${inner}</w:hdr>`
}

export function wordFooter(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${inner}</w:ftr>`
}

export function buildDocx(parts: {
  document: string
  header?: string
  footer?: string
}): Uint8Array {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('_rels/.rels', packageRels)
  zip.file('word/_rels/document.xml.rels', documentRels)
  zip.file('word/document.xml', parts.document)
  zip.file('word/header1.xml', parts.header ?? wordHeader('<w:p/>'))
  zip.file('word/footer1.xml', parts.footer ?? wordFooter('<w:p/>'))
  const output = zip.generate({ type: 'uint8array' })
  return output instanceof Uint8Array ? output : new Uint8Array(output)
}

export const kaiBoldRPr = `<w:rPr><w:rFonts w:ascii="標楷體" w:eastAsia="標楷體" w:hAnsi="標楷體"/><w:b/><w:i/><w:u w:val="single"/><w:color w:val="1F4E79"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>`

export const differentRPr = `<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="新細明體" w:hAnsi="Times New Roman"/><w:i/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>`

export function paragraph(runs: string): string {
  return `<w:p>${runs}</w:p>`
}

export function run(rPr: string, text: string): string {
  return `<w:r>${rPr}<w:t>${text}</w:t></w:r>`
}

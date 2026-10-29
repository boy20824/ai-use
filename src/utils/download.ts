export function downloadBytes(data: Uint8Array, fileName: string, mimeType: string) {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  downloadBlob(new Blob([copy], { type: mimeType }), fileName)
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const serverSrc = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(serverSrc, '../..')
const frontendSrc = path.join(repoRoot, 'src')

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (entry.endsWith('.ts')) files.push(full)
  }
  return files
}

function specifiers(source: string): string[] {
  const found: string[] = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier) found.push(specifier)
    }
  }
  return found
}

describe('server image boundary', () => {
  it('does not import the frontend src tree', () => {
    const offenders: string[] = []
    for (const file of walk(serverSrc)) {
      const source = readFileSync(file, 'utf8')
      for (const specifier of specifiers(source)) {
        if (!specifier.startsWith('.')) continue
        const resolved = path.resolve(path.dirname(file), specifier)
        const insideFrontend =
          resolved === frontendSrc || resolved.startsWith(frontendSrc + path.sep)
        if (insideFrontend) {
          offenders.push(`${path.relative(repoRoot, file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('copies docx XML normalization into the runtime image', () => {
    const dockerfile = readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain(
      'COPY --from=build /app/server/src/docxXml.ts /app/server/src/docxXml.ts',
    )
  })
})

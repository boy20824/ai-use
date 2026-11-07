import { createHash } from 'node:crypto'

/** Only a five-character k-anonymous prefix leaves this process. */
export async function checkPasswordBreach(
  password: string,
): Promise<'safe' | 'compromised' | 'unavailable'> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
          headers: { 'Add-Padding': 'true' },
          signal: controller.signal,
          redirect: 'error',
        })
        if (!response.ok) return 'unavailable' as const
        const body = await response.text()
        const lines = body.trim().split(/\r?\n/)
        // Validate the entire response before trusting any result, including a match.
        if (!lines.every((line) => /^[A-F0-9]{35}:\d+$/.test(line))) return 'unavailable' as const
        return lines.some((line) => {
          const [suffix, count] = line.split(':')
          return suffix === hash.slice(5) && /[1-9]/.test(count!)
        })
          ? ('compromised' as const)
          : ('safe' as const)
      })(),
      new Promise<'unavailable'>((resolve) => {
        timer = setTimeout(() => {
          resolve('unavailable')
          controller.abort()
        }, 3000)
      }),
    ])
  } catch {
    // Never expose upstream errors or hash material to logs or audit records.
    return 'unavailable'
  } finally {
    clearTimeout(timer)
  }
}

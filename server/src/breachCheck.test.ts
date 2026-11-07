import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkPasswordBreach } from './breachCheck.ts'

const password = 'test-only-new-password'
const hash = createHash('sha1').update(password).digest('hex').toUpperCase()
const suffix = hash.slice(5)
const other = '0'.repeat(35)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Pwned Passwords range check', () => {
  it.each([
    [`${suffix}:12\r\n${other}:0\r\n`, 'compromised'],
    [`${other}:10`, 'safe'],
    [`${suffix}:0\r\n${other}:10`, 'safe'],
    ['', 'unavailable'],
    ['upstream response details', 'unavailable'],
    [`${suffix}:5\ninvalid`, 'unavailable'],
    [`${suffix}:-1`, 'unavailable'],
  ])('parses range response %#', async (body, expected) => {
    const fetch = vi.fn().mockResolvedValue(new Response(body))
    vi.stubGlobal('fetch', fetch)
    expect(await checkPasswordBreach(password)).toBe(expected)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
      {
        headers: { 'Add-Padding': 'true' },
        signal: expect.any(AbortSignal),
        redirect: 'error',
      },
    )
    const sent = JSON.stringify(fetch.mock.calls)
    for (const secret of [password, hash, suffix]) expect(sent).not.toContain(secret)
  })

  it.each(['network', 'status', 'body'])('fails open on %s failure', async (failure) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        if (failure === 'network') throw new Error(password + hash)
        if (failure === 'status') return new Response('private upstream details', { status: 503 })
        return {
          ok: true,
          text: async () => {
            throw new Error(suffix)
          },
        }
      }),
    )
    expect(await checkPasswordBreach(password)).toBe('unavailable')
  })

  it.each(['headers', 'body'])(
    'times out after 3 seconds waiting for %s, even if abort is ignored',
    async (phase) => {
      vi.useFakeTimers()
      const pending = new Promise<never>(() => {})
      const fetch = vi.fn().mockReturnValue(
        phase === 'headers'
          ? pending
          : Promise.resolve({
              ok: true,
              text: () => pending,
            }),
      )
      vi.stubGlobal('fetch', fetch)
      const result = checkPasswordBreach(password)
      const settled = vi.fn()
      void result.then(settled)
      await vi.advanceTimersByTimeAsync(2999)
      expect(settled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await result).toBe('unavailable')
      expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    },
  )
})
